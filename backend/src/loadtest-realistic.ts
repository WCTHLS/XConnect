/**
 * Realistic-behavior variant of loadtest.ts — run it directly:
 *
 *   pnpm exec tsx src/loadtest-realistic.ts --url=http://localhost:3001 --devices=500 --rooms=5
 *
 * loadtest.ts stays the fixed baseline (uniform devices, everyone joins once and stays to the
 * end) so its numbers remain comparable across runs. This one models how a real room's
 * membership and sensor data actually move:
 *
 *  - BLE peer counts and Wi-Fi AP visibility vary batch to batch, instead of always maxing out.
 *  - Each device has a motion profile (sedentary / active / mixed), so some report mostly-still
 *    samples and others mostly-moving, with variance to match.
 *  - Ultrasonic tokens are emitted every batch but only heard intermittently (acoustic dropout).
 *  - Attendees churn: some leave early. Some of those come back on the same device after a gap
 *    (half going quiet without a leave call, half leaving explicitly), and the rest are replaced
 *    by a fresh attendee.
 *  - Each room's presenter can step out (goes quiet, no leave call) and rejoin the same room,
 *    same deviceId, mid-session.
 *  - Joins are staggered over the ramp-up window, and end-of-test leaves are spread out too.
 *
 * Same auth requirement as loadtest.ts: the target must run without auth configured, or pass
 * --token=<a real bearer token>.
 *
 * Extra flags on top of loadtest.ts's:
 *   --churn=2              attendee departures per room per minute, on average (0 disables)
 *   --return-rate=0.4      fraction of departures that come back on the same device
 *   --leave-spread=8000    max random delay (ms) before each end-of-test leave
 *   --presenter-rejoin=true   set to false to keep presenters connected start to finish
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
  churnPerMin: number;
  returnRate: number;
  leaveSpreadMs: number;
  presenterRejoin: boolean;
};

type Role = "presenter" | "attendee";
type MotionProfile = "sedentary" | "active" | "mixed";

type SimDevice = {
  deviceId: string;
  rotatingId: string;
  role: Role;
  roomId: string;
  displayName: string;
  motionProfile: MotionProfile;
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
    churnPerMin: Number(args.get("churn") ?? 2),
    returnRate: Number(args.get("return-rate") ?? 0.4),
    leaveSpreadMs: Number(args.get("leave-spread") ?? 8000),
    presenterRejoin: (args.get("presenter-rejoin") ?? "true") !== "false",
  };
}

const opts = parseArgs();
const metrics = new Map<string, Metric>();
const counters = { churned: 0, returnedQuiet: 0, returnedAfterLeave: 0, presenterRejoins: 0 };

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
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function randomId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 12)}`;
}

function jitter(ms: number): number {
  return ms + (Math.random() - 0.5) * ms * 0.2;
}

function roomIndexFor(roomId: string): number {
  return Number(roomId.split("-").pop()) - 1;
}

function wifiNeighborhoodFor(roomIndex: number) {
  return [
    { bssid: `aa:bb:${roomIndex.toString(16).padStart(2, "0")}:01:01:01`, ssid: `Conference-5G-${roomIndex}`, rssi: -50, frequency: 5180 },
    { bssid: `aa:bb:${roomIndex.toString(16).padStart(2, "0")}:02:01:01`, ssid: `Conference-2.4G-${roomIndex}`, rssi: -60, frequency: 2412 },
    { bssid: `aa:bb:${roomIndex.toString(16).padStart(2, "0")}:03:01:01`, ssid: "Venue-Guest", rssi: -70, frequency: 5200 },
  ];
}

// Modeled on a human room label so it goes through the server's real token-normalization path.
function roomUltrasonicToken(roomIndex: number): string {
  return `Room ${roomIndex + 1}`;
}

function assignMotionProfile(): MotionProfile {
  const r = Math.random();
  if (r < 0.3) return "sedentary";
  if (r < 0.6) return "active";
  return "mixed";
}

function motionSampleFor(profile: MotionProfile): { motionState: "moving" | "still" | "unknown"; motionVariance: number } {
  // Mirrors the real client before it has collected enough samples.
  if (Math.random() < 0.03) return { motionState: "unknown", motionVariance: 0 };

  const stillProb = profile === "sedentary" ? 0.85 : profile === "active" ? 0.2 : 0.5;
  const isStill = Math.random() < stillProb;
  const variance = isStill ? Math.random() * 0.02 : 0.05 + Math.random() * 0.25;
  return { motionState: isStill ? "still" : "moving", motionVariance: Number(variance.toFixed(4)) };
}

function ultrasonicSampleFor(roomIndex: number) {
  const emittedToken = roomUltrasonicToken(roomIndex);
  if (Math.random() > 0.75) return { ultrasonicEmittedToken: emittedToken, ultrasonicObservation: undefined };

  return {
    ultrasonicEmittedToken: emittedToken,
    ultrasonicObservation: {
      token: emittedToken,
      confidence: Number((0.55 + Math.random() * 0.4).toFixed(2)),
      detectedAt: new Date().toISOString(),
      frequency: 19000 + Math.round(Math.random() * 1000),
    },
  };
}

function makeDevice(roomId: string, role: Role, label: string): SimDevice {
  const roomIndex = roomIndexFor(roomId);
  return {
    deviceId: randomId(`ldt-r${roomIndex}`),
    rotatingId: randomId(`rot-r${roomIndex}`),
    role,
    roomId,
    displayName: label,
    motionProfile: assignMotionProfile(),
  };
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
      const role: Role = i === 0 ? "presenter" : "attendee";
      members.push(makeDevice(roomId, role, i === 0 ? `Presenter ${r + 1}` : `Attendee ${r + 1}-${i}`));
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
  const now = new Date().toISOString();
  const roomIndex = roomIndexFor(device.roomId);

  const maxPeers = Math.min(60, others.length);
  const peerCount = maxPeers === 0 ? 0 : Math.max(1, Math.round(maxPeers * (0.3 + Math.random() * 0.7)));
  const sampled = [...others].sort(() => Math.random() - 0.5).slice(0, peerCount);

  const hasWifi = device.role === "presenter" || Math.random() > 0.15;
  const allAPs = wifiNeighborhoodFor(roomIndex);
  const apCount = hasWifi ? Math.max(1, Math.round(allAPs.length * (0.4 + Math.random() * 0.6))) : 0;
  const apSubset = [...allAPs].sort(() => Math.random() - 0.5).slice(0, apCount);

  const { motionState, motionVariance } = motionSampleFor(device.motionProfile);
  const { ultrasonicEmittedToken, ultrasonicObservation } = ultrasonicSampleFor(roomIndex);

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
      motionState,
      motionVariance,
      ultrasonicEmittedToken,
      ...(ultrasonicObservation ? { ultrasonicObservation } : {}),
      peers: sampled.map((peer) => ({
        rotatingId: peer.rotatingId,
        rssi: -60 - Math.round(Math.random() * 25),
        seenAt: now,
      })),
      ...(apSubset.length > 0 ? { wifiFingerprint: apSubset.map((ap) => ({ ...ap, rssi: ap.rssi - Math.round(Math.random() * 8) })) } : {}),
    }),
  });
}

function removeFromRoom(roomMembers: SimDevice[], device: SimDevice) {
  const idx = roomMembers.indexOf(device);
  if (idx !== -1) roomMembers.splice(idx, 1);
}

// churnPerMin is per room, so each attendee slot churns at churnPerMin / slotsInRoom. Exponential
// dwell around that mean: mostly moderate stays, a few short, a rare long one.
function churnDwellMs(churnPerMin: number, slotsInRoom: number): number {
  return -Math.log(1 - Math.random()) * ((60_000 * slotsInRoom) / churnPerMin);
}

async function runStint(device: SimDevice, roomMembers: SimDevice[], until: number) {
  let nextPoll = Date.now() + jitter(opts.pollMs);
  let nextBatch = Date.now() + jitter(opts.batchMs);

  while (Date.now() < until) {
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
}

async function runAttendeeSlot(initial: SimDevice, roomMembers: SimDevice[], slotsInRoom: number, stopAt: number) {
  await sleep(Math.random() * opts.rampSec * 1000);

  let device = initial;
  await joinDevice(device);
  roomMembers.push(device);

  while (true) {
    const dwellUntil = opts.churnPerMin > 0 ? Date.now() + churnDwellMs(opts.churnPerMin, slotsInRoom) : Infinity;
    await runStint(device, roomMembers, Math.min(stopAt, dwellUntil));

    if (Date.now() >= stopAt) {
      await sleep(Math.random() * opts.leaveSpreadMs);
      await leaveDevice(device);
      removeFromRoom(roomMembers, device);
      break;
    }

    if (Math.random() < opts.returnRate) {
      // Same device steps out and comes back. Half go quiet (phone locked, out of range) with no
      // leave call; half leave explicitly. The gap spans both sides of the 45s membership grace.
      const explicitLeave = Math.random() < 0.5;
      if (explicitLeave) await leaveDevice(device);
      removeFromRoom(roomMembers, device);
      await sleep(Math.min(5000 + Math.random() * 70_000, Math.max(0, stopAt - Date.now())));

      if (Date.now() >= stopAt) {
        if (!explicitLeave) await leaveDevice(device);
        break;
      }
      await joinDevice(device);
      roomMembers.push(device);
      if (explicitLeave) counters.returnedAfterLeave++;
      else counters.returnedQuiet++;
      continue;
    }

    await leaveDevice(device);
    removeFromRoom(roomMembers, device);
    counters.churned++;
    await sleep(1000 + Math.random() * 4000);
    device = makeDevice(device.roomId, "attendee", `Attendee ${roomIndexFor(device.roomId) + 1}-${randomId("c")}`);
    await joinDevice(device);
    roomMembers.push(device);
  }
}

async function runPresenterSlot(device: SimDevice, roomMembers: SimDevice[], stopAt: number) {
  await sleep(Math.random() * opts.rampSec * 1000);
  await joinDevice(device);
  roomMembers.push(device);

  const remainingMs = stopAt - Date.now();
  const canRejoin = opts.presenterRejoin && remainingMs > 20_000;
  const rejoinAt = canRejoin ? Date.now() + remainingMs * (0.25 + Math.random() * 0.35) : Infinity;

  await runStint(device, roomMembers, Math.min(stopAt, rejoinAt));

  if (canRejoin && Date.now() < stopAt) {
    // A step-out is the app going quiet (phone locked, backgrounded, network drop), NOT an explicit
    // leave — the server treats a presenter's leave as "end this room". The gap spans both sides
    // of the 45s membership grace, so some rejoins continue the same stay and some open a new one,
    // but always inside the same room occurrence.
    removeFromRoom(roomMembers, device);
    await sleep(Math.min(5000 + Math.random() * 70_000, Math.max(0, stopAt - Date.now())));
    if (Date.now() < stopAt) {
      // Same deviceId + room: presenterConflict excludes the device's own record, so this succeeds.
      await joinDevice(device);
      roomMembers.push(device);
      counters.presenterRejoins++;
      await runStint(device, roomMembers, stopAt);
    }
  }

  await sleep(Math.random() * opts.leaveSpreadMs);
  await leaveDevice(device);
  removeFromRoom(roomMembers, device);
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
  console.log(
    `... ${totalOk} ok, ${totalFailed} failed so far (replaced ${counters.churned}, ` +
      `returned ${counters.returnedQuiet} quiet + ${counters.returnedAfterLeave} after leave, presenter rejoins ${counters.presenterRejoins})`
  );
}

function printSummary() {
  console.log("\n=== Realistic load test results ===");
  console.log(`${opts.devices} devices, ${opts.rooms} rooms, ${opts.durationSec}s, target ${opts.url}`);
  console.log(
    `churn ${opts.churnPerMin}/room/min, return rate ${opts.returnRate}: ${counters.churned} replaced, ` +
      `${counters.returnedQuiet} returned after going quiet, ${counters.returnedAfterLeave} returned after leaving\n` +
      `presenter rejoin ${opts.presenterRejoin ? "on" : "off"} (${counters.presenterRejoins} rejoins)\n`
  );

  const rows: string[] = [];
  rows.push(["endpoint", "count", "errors", "p50", "p90", "p95", "p99", "max"].join("\t"));
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
  console.log(`Starting realistic load test: ${opts.devices} devices across ${opts.rooms} rooms against ${opts.url}`);
  console.log(
    `Ramp-up ${opts.rampSec}s, run ${opts.durationSec}s, poll every ${opts.pollMs}ms, batch every ${opts.batchMs}ms, ` +
      `churn ${opts.churnPerMin}/room/min, presenter rejoin ${opts.presenterRejoin ? "on" : "off"}\n`
  );

  const rooms = buildRooms();
  const stopAt = Date.now() + opts.rampSec * 1000 + opts.durationSec * 1000;

  const slotPromises: Promise<void>[] = [];
  for (const roomMembers of rooms.values()) {
    // Each slot pushes itself onto the live roster when it actually joins, so start it empty.
    const initialMembers = [...roomMembers];
    roomMembers.length = 0;
    const attendeeSlots = initialMembers.filter((d) => d.role === "attendee").length;

    for (const device of initialMembers) {
      slotPromises.push(
        device.role === "presenter"
          ? runPresenterSlot(device, roomMembers, stopAt)
          : runAttendeeSlot(device, roomMembers, attendeeSlots, stopAt)
      );
    }
  }

  const progressTimer = setInterval(printProgress, 10_000);
  await Promise.all([...slotPromises, runAdminPoller(stopAt)]);
  clearInterval(progressTimer);

  printSummary();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
