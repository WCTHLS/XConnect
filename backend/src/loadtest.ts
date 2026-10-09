/**
 * Standalone load-test harness, not part of `pnpm test` — run it directly:
 *
 *   pnpm --filter @confpresence/api exec tsx src/loadtest.ts --devices=500 --rooms=5
 *
 * Simulates N devices spread across several rooms (one presenter plus attendees per room),
 * each polling its own live state and uploading sensor batches at the same cadence the real
 * app uses (3s live poll, 10s batch upload), plus one admin dashboard poller hitting
 * /api/admin/overview. Prints per-endpoint latency percentiles and error counts at the end,
 * which is what tells you whether the server is keeping up or falling behind.
 *
 * The target server must be running WITHOUT auth configured (no FIREBASE_PROJECT_ID /
 * AUTH_AUTHORITY in its env), since every request below is unsigned — that's the existing
 * "POC mode" path index.ts already supports. If the target does have auth enabled, pass
 * --token=<a real bearer token> and every request will carry it (one shared identity across
 * all simulated devices is fine; deviceId, not the signed-in user, is what the engine keys on).
 */

type Options = {
  devices: number;
  rooms: number;
  durationSec: number;
  rampSec: number;
  url: string;
  session: string;
  pollMs: number;
  batchMs: number;
  adminMs: number;
  authToken?: string;
};

type Role = "presenter" | "attendee";

type SimDevice = {
  deviceId: string;
  rotatingId: string;
  role: Role;
  roomId: string;
  displayName: string;
};

type Metric = {
  ok: number;
  failed: number;
  latencies: number[];
  statusCounts: Map<number, number>;
};

function parseArgs(): Options {
  const args = new Map<string, string>();
  for (const arg of process.argv.slice(2)) {
    const m = arg.match(/^--([^=]+)=(.*)$/);
    if (m) args.set(m[1], m[2]);
  }
  return {
    devices: Number(args.get("devices") ?? 500),
    rooms: Number(args.get("rooms") ?? 5),
    durationSec: Number(args.get("duration") ?? 60),
    rampSec: Number(args.get("ramp") ?? 10),
    url: (args.get("url") ?? "http://localhost:3000").replace(/\/+$/, ""),
    session: args.get("session") ?? "loadtest-session",
    pollMs: Number(args.get("poll-interval") ?? 3000),
    batchMs: Number(args.get("batch-interval") ?? 10000),
    adminMs: Number(args.get("admin-interval") ?? 5000),
    authToken: args.get("token"),
  };
}

const opts = parseArgs();
const metrics = new Map<string, Metric>();

function recordMetric(name: string, ms: number, status: number) {
  let m = metrics.get(name);
  if (!m) {
    m = { ok: 0, failed: 0, latencies: [], statusCounts: new Map() };
    metrics.set(name, m);
  }
  m.latencies.push(ms);
  if (status >= 200 && status < 300) m.ok++;
  else m.failed++;
  m.statusCounts.set(status, (m.statusCounts.get(status) ?? 0) + 1);
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

async function timedRequest(name: string, path: string, init?: RequestInit): Promise<Response | null> {
  const start = performance.now();
  try {
    const res = await fetch(`${opts.url}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(opts.authToken ? { Authorization: `Bearer ${opts.authToken}` } : {}),
        ...(init?.headers ?? {}),
      },
    });
    recordMetric(name, performance.now() - start, res.status);
    return res;
  } catch {
    recordMetric(name, performance.now() - start, 0);
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 12)}`;
}

function jitter(ms: number): number {
  return ms + (Math.random() - 0.5) * ms * 0.2;
}

// Each room gets its own fixed Wi-Fi neighborhood (3 fake APs) so attendees in the same room
// report similar fingerprints and the engine's Wi-Fi similarity scoring has something real to
// chew on, the same way the September multi-room test did — a single-room-shaped load test
// undercounts cost, since the per-poll work scales with total system size, not per-room size.
function wifiNeighborhoodFor(roomIndex: number) {
  return [
    { bssid: `aa:bb:${roomIndex.toString(16).padStart(2, "0")}:01:01:01`, ssid: `Conference-5G-${roomIndex}`, rssi: -50, frequency: 5180 },
    { bssid: `aa:bb:${roomIndex.toString(16).padStart(2, "0")}:02:01:01`, ssid: `Conference-2.4G-${roomIndex}`, rssi: -60, frequency: 2412 },
    { bssid: `aa:bb:${roomIndex.toString(16).padStart(2, "0")}:03:01:01`, ssid: "Venue-Guest", rssi: -70, frequency: 5200 },
  ];
}

function buildRooms(): Map<string, SimDevice[]> {
  const rooms = new Map<string, SimDevice[]>();
  const perRoom = Math.floor(opts.devices / opts.rooms);
  let remaining = opts.devices - perRoom * opts.rooms;

  for (let r = 0; r < opts.rooms; r++) {
    const roomId = `loadtest-room-${r + 1}`;
    const count = perRoom + (remaining-- > 0 ? 1 : 0);
    const members: SimDevice[] = [];
    for (let i = 0; i < count; i++) {
      members.push({
        deviceId: randomId(`ldt-r${r}-${i}`),
        rotatingId: randomId(`rot-r${r}-${i}`),
        role: i === 0 ? "presenter" : "attendee",
        roomId,
        displayName: i === 0 ? `Presenter ${r + 1}` : `Attendee ${r + 1}-${i}`,
      });
    }
    rooms.set(roomId, members);
  }
  return rooms;
}

async function joinDevice(device: SimDevice) {
  await timedRequest("join", "/api/session/join", {
    method: "POST",
    body: JSON.stringify({
      sessionId: opts.session,
      deviceId: device.deviceId,
      role: device.role,
      roomId: device.roomId,
      displayName: device.displayName,
    }),
  });
}

async function leaveDevice(device: SimDevice) {
  await timedRequest("leave", "/api/session/leave", {
    method: "POST",
    body: JSON.stringify({ deviceId: device.deviceId }),
  });
}

async function pollDevice(device: SimDevice) {
  if (device.role === "presenter") {
    await timedRequest(
      "poll_room",
      `/api/rooms/${device.roomId}/live?sessionId=${opts.session}&deviceId=${device.deviceId}`
    );
  } else {
    await timedRequest("poll_device", `/api/devices/${device.deviceId}/live?sessionId=${opts.session}`);
  }
}

async function sendBatch(device: SimDevice, roomMembers: SimDevice[]) {
  const others = roomMembers.filter((m) => m.deviceId !== device.deviceId);
  const peerCount = Math.min(60, others.length);
  const sampled = [...others].sort(() => Math.random() - 0.5).slice(0, peerCount);
  const now = new Date().toISOString();

  const hasWifi = device.role === "presenter" || Math.random() > 0.1;
  const roomIndex = Number(device.roomId.split("-").pop()) - 1;

  await timedRequest("batch", "/api/observations", {
    method: "POST",
    body: JSON.stringify({
      sessionId: opts.session,
      deviceId: device.deviceId,
      displayName: device.displayName,
      rotatingId: device.rotatingId,
      role: device.role,
      roomId: device.roomId,
      capturedAt: now,
      peers: sampled.map((peer) => ({
        rotatingId: peer.rotatingId,
        rssi: -60 - Math.round(Math.random() * 25),
        seenAt: now,
      })),
      ...(hasWifi ? { wifiFingerprint: wifiNeighborhoodFor(roomIndex).map((ap) => ({ ...ap, rssi: ap.rssi - Math.round(Math.random() * 8) })) } : {}),
    }),
  });
}

async function runDevice(device: SimDevice, roomMembers: SimDevice[], stopAt: number) {
  await sleep(Math.random() * opts.rampSec * 1000);
  await joinDevice(device);

  let nextPoll = Date.now() + jitter(opts.pollMs);
  let nextBatch = Date.now() + jitter(opts.batchMs);

  while (Date.now() < stopAt) {
    const now = Date.now();
    const waits: Promise<unknown>[] = [];
    if (now >= nextPoll) {
      waits.push(pollDevice(device));
      nextPoll = now + jitter(opts.pollMs);
    }
    if (now >= nextBatch) {
      waits.push(sendBatch(device, roomMembers));
      nextBatch = now + jitter(opts.batchMs);
    }
    await Promise.all(waits);
    await sleep(100);
  }

  await leaveDevice(device);
}

async function runAdminPoller(stopAt: number) {
  while (Date.now() < stopAt) {
    await timedRequest("admin_overview", "/api/admin/overview");
    await sleep(jitter(opts.adminMs));
  }
}

function printProgress() {
  const totalOk = [...metrics.values()].reduce((sum, m) => sum + m.ok, 0);
  const totalFailed = [...metrics.values()].reduce((sum, m) => sum + m.failed, 0);
  console.log(`... ${totalOk} ok, ${totalFailed} failed so far`);
}

function printSummary() {
  console.log("\n=== Load test results ===");
  console.log(`${opts.devices} devices, ${opts.rooms} rooms, ${opts.durationSec}s, target ${opts.url}\n`);

  const rows: string[] = [];
  rows.push(
    ["endpoint", "count", "errors", "p50", "p90", "p95", "p99", "max"].join("\t")
  );
  for (const [name, m] of [...metrics.entries()].sort()) {
    const sorted = [...m.latencies].sort((a, b) => a - b);
    rows.push(
      [
        name,
        String(m.ok + m.failed),
        String(m.failed),
        percentile(sorted, 50).toFixed(0),
        percentile(sorted, 90).toFixed(0),
        percentile(sorted, 95).toFixed(0),
        percentile(sorted, 99).toFixed(0),
        (sorted[sorted.length - 1] ?? 0).toFixed(0),
      ].join("\t")
    );
  }
  console.log(rows.join("\n"));
  console.log("(all latencies in ms)\n");

  for (const [name, m] of metrics.entries()) {
    if (m.failed === 0) continue;
    const breakdown = [...m.statusCounts.entries()]
      .filter(([status]) => status < 200 || status >= 300)
      .map(([status, count]) => `${status === 0 ? "network error" : status}: ${count}`)
      .join(", ");
    console.log(`${name} errors: ${breakdown}`);
  }
}

async function main() {
  console.log(`Starting load test: ${opts.devices} devices across ${opts.rooms} rooms against ${opts.url}`);
  console.log(`Ramp-up ${opts.rampSec}s, run ${opts.durationSec}s, poll every ${opts.pollMs}ms, batch every ${opts.batchMs}ms\n`);

  const rooms = buildRooms();
  const stopAt = Date.now() + opts.rampSec * 1000 + opts.durationSec * 1000;

  const devicePromises: Promise<void>[] = [];
  for (const roomMembers of rooms.values()) {
    for (const device of roomMembers) {
      devicePromises.push(runDevice(device, roomMembers, stopAt));
    }
  }

  const progressTimer = setInterval(printProgress, 10_000);
  await Promise.all([...devicePromises, runAdminPoller(stopAt)]);
  clearInterval(progressTimer);

  printSummary();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
