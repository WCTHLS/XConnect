import cors from "cors";
import { desc, eq, inArray, isNull } from "drizzle-orm";
import express from "express";
import { z } from "zod";
import { db, schema } from "./db/index.js";
import { PocInferenceEngine } from "./inference.js";

const app = express();
const engine = new PocInferenceEngine({ db });
const port = Number(process.env.PORT ?? process.env.API_PORT ?? 3000);

console.log(db ? "🗄️  Postgres persistence enabled" : "⚠️  No DATABASE_URL set — running in-memory only (POC mode)");

// PocInferenceEngine's "which occurrence is active for this code" tracking lives only in
// memory, so a server restart silently orphans whatever was active at the time — those rows
// would otherwise sit with ended_at: NULL forever, looking "active" in history indefinitely.
// A fresh boot is itself a natural "nothing is actually active anymore" boundary, so close
// them out right here rather than leaving stale rows behind.
if (db) {
  db.update(schema.sessions)
    .set({ endedAt: new Date() })
    .where(isNull(schema.sessions.endedAt))
    .then((result) => {
      if (result.count > 0) console.log(`🧹 Closed ${result.count} session(s) left open from before this restart`);
    })
    .catch((err) => console.error("[db] failed to close orphaned sessions on startup:", err));
}

app.use(cors());
app.use(express.json({ limit: "256kb" }));

const joinSchema = z.object({
  sessionId: z.string().min(1),
  deviceId: z.string().min(8),
  displayName: z.string().optional(),
  role: z.enum(["presenter", "attendee"]),
  roomId: z.string().min(1).optional()
});

const leaveSchema = z.object({
  deviceId: z.string().min(8)
});

const uwbTokenSchema = z.object({
  deviceId: z.string().min(8),
  discoveryTokenBase64: z.string().min(1)
});

const wifiApSchema = z.object({
  bssid: z.string().min(1),
  ssid: z.string().optional(),
  rssi: z.number().min(-127).max(20),
  frequency: z.number().optional()
});

const ultrasonicObservationSchema = z.object({
  token: z.string().min(1),
  confidence: z.number().min(0).max(1),
  detectedAt: z.string().datetime(),
  frequency: z.number().optional()
});

const batchSchema = z.object({
  sessionId: z.string().min(1),
  deviceId: z.string().min(8),
  displayName: z.string().optional(),
  rotatingId: z.string().min(8),
  role: z.enum(["presenter", "attendee"]),
  roomId: z.string().min(1).optional(),
  capturedAt: z.string().datetime(),
  motionState: z.enum(["moving", "still", "unknown"]).optional(),
  motionVariance: z.number().min(0).optional(),
  ultrasonicObservation: ultrasonicObservationSchema.optional(),
  ultrasonicEmittedToken: z.string().optional(),
  peers: z.array(z.object({
    rotatingId: z.string().min(8),
    rssi: z.number().min(-127).max(20),
    seenAt: z.string().datetime()
  })).max(100),
  wifiFingerprint: z.array(wifiApSchema).max(50).optional()
});

app.get("/health", (_request, response) => response.json({ ok: true }));
app.get("/api/health", (_request, response) => response.json({ ok: true }));

app.post("/api/session/join", (request, response) => {
  const parsed = joinSchema.safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ error: parsed.error.flatten() });

  const { sessionId: code, deviceId, role, roomId, displayName } = parsed.data;
  const sessionId = engine.resolveSessionCode(code);
  engine.join(deviceId, role, roomId, displayName, sessionId);

  const roleEmoji = role === "presenter" ? "👑 [PRESENTER]" : "👤 [ATTENDEE]";
  console.log(`🟢 ${roleEmoji} ${displayName || deviceId} joined room '${roomId || "unassigned"}' (Session: ${code})`);

  return response.status(201).json({ ok: true });
});

app.post("/api/admin/session/end", (request, response) => {
  const parsed = z.object({ sessionId: z.string().min(1) }).safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ error: parsed.error.flatten() });

  const ended = engine.endSession(parsed.data.sessionId);
  console.log(ended ? `🛑 [SESSION] '${parsed.data.sessionId}' ended by admin` : `⚠️  [SESSION] '${parsed.data.sessionId}' had no active occurrence to end`);

  return response.json({ ok: true, ended });
});

app.get("/api/admin/sessions", async (request, response) => {
  if (!db) return response.status(503).json({ error: "History requires Postgres persistence (DATABASE_URL not set)" });

  // No code param (or blank) means "show everything" rather than requiring a search term.
  const code = String(request.query.code ?? "").trim();

  const rows = await db
    .select({ id: schema.sessions.id, code: schema.sessions.code })
    .from(schema.sessions)
    .where(code ? eq(schema.sessions.code, code) : undefined)
    .orderBy(desc(schema.sessions.createdAt));

  const sessionIds = rows.map((r) => r.id);
  const roomRows = sessionIds.length
    ? await db
        .select({ sessionId: schema.rooms.sessionId, roomId: schema.rooms.id })
        .from(schema.rooms)
        .where(inArray(schema.rooms.sessionId, sessionIds))
    : [];

  const roomsBySession = new Map<string, string[]>();
  for (const r of roomRows) {
    const list = roomsBySession.get(r.sessionId) ?? [];
    list.push(r.roomId);
    roomsBySession.set(r.sessionId, list);
  }

  const membershipRows = sessionIds.length
    ? await db
        .select({
          sessionId: schema.roomMembership.sessionId,
          deviceId: schema.roomMembership.deviceId,
          role: schema.roomMembership.role,
          displayName: schema.devices.displayName,
          startedAt: schema.roomMembership.startedAt,
          endedAt: schema.roomMembership.endedAt
        })
        .from(schema.roomMembership)
        .leftJoin(schema.devices, eq(schema.devices.deviceId, schema.roomMembership.deviceId))
        .where(inArray(schema.roomMembership.sessionId, sessionIds))
    : [];

  const hostsBySession = new Map<string, Set<string>>();
  const attendeesBySession = new Map<string, Set<string>>();
  // The session row's own started_at/ended_at are just admin bookkeeping (when the code was
  // first minted / explicitly ended or auto-expired) — the data people actually care about is
  // when rooms were really active, so derive that from room_membership instead.
  const roomTimesBySession = new Map<string, { startedAt: Date; endedAt: Date | null; stillOpen: boolean }>();
  const intervalsBySession = new Map<string, { start: number; end: number }[]>();
  const now = Date.now();
  for (const m of membershipRows) {
    if (m.role === "presenter") {
      const set = hostsBySession.get(m.sessionId) ?? new Set<string>();
      set.add(m.displayName || m.deviceId);
      hostsBySession.set(m.sessionId, set);
    } else {
      const set = attendeesBySession.get(m.sessionId) ?? new Set<string>();
      set.add(m.deviceId);
      attendeesBySession.set(m.sessionId, set);
    }

    const times = roomTimesBySession.get(m.sessionId);
    if (!times) {
      roomTimesBySession.set(m.sessionId, { startedAt: m.startedAt, endedAt: m.endedAt, stillOpen: !m.endedAt });
    } else {
      if (m.startedAt < times.startedAt) times.startedAt = m.startedAt;
      if (!m.endedAt) {
        times.stillOpen = true;
      } else if (!times.endedAt || m.endedAt > times.endedAt) {
        times.endedAt = m.endedAt;
      }
    }

    const list = intervalsBySession.get(m.sessionId) ?? [];
    list.push({ start: m.startedAt.getTime(), end: m.endedAt ? m.endedAt.getTime() : now });
    intervalsBySession.set(m.sessionId, list);
  }

  // Real occupied time, not a naive first-start-to-last-end span — a room that empties out
  // between two separate visits (presenter leaves, comes back later) must not have that gap
  // counted as if something were active the whole time. Merge overlapping/adjacent intervals
  // across every room/device in the session and sum only the merged, actually-occupied ranges.
  const durationBySession = new Map<string, number>();
  for (const [sessionId, intervals] of intervalsBySession) {
    const sorted = [...intervals].sort((a, b) => a.start - b.start);
    let total = 0;
    let curStart = sorted[0].start;
    let curEnd = sorted[0].end;
    for (let i = 1; i < sorted.length; i++) {
      const iv = sorted[i];
      if (iv.start <= curEnd) {
        curEnd = Math.max(curEnd, iv.end);
      } else {
        total += curEnd - curStart;
        curStart = iv.start;
        curEnd = iv.end;
      }
    }
    total += curEnd - curStart;
    durationBySession.set(sessionId, total);
  }

  const sessions = rows.map((r) => {
    const times = roomTimesBySession.get(r.id);
    return {
      id: r.id,
      code: r.code,
      hasActivity: Boolean(times),
      startedAt: times?.startedAt ?? null,
      endedAt: times && !times.stillOpen ? times.endedAt : null,
      stillOpen: times?.stillOpen ?? false,
      durationMs: durationBySession.get(r.id),
      rooms: roomsBySession.get(r.id) ?? [],
      hosts: [...(hostsBySession.get(r.id) ?? [])],
      attendeeCount: (attendeesBySession.get(r.id) ?? new Set()).size
    };
  });

  return response.json({ sessions });
});

app.get("/api/admin/history", async (request, response) => {
  if (!db) return response.status(503).json({ error: "History requires Postgres persistence (DATABASE_URL not set)" });

  const sessionId = String(request.query.sessionId ?? "").trim();
  if (!sessionId) return response.status(400).json({ error: "sessionId query param is required" });

  const [session] = await db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId));
  if (!session) return response.status(404).json({ error: "No session found with that ID" });

  const rows = await db
    .select({
      deviceId: schema.roomMembership.deviceId,
      displayName: schema.devices.displayName,
      roomId: schema.roomMembership.roomId,
      role: schema.roomMembership.role,
      startedAt: schema.roomMembership.startedAt,
      endedAt: schema.roomMembership.endedAt,
      lastConfidence: schema.roomMembership.lastConfidence,
      ultrasonicVerified: schema.roomMembership.ultrasonicVerified,
      motionAnomalyFlag: schema.roomMembership.motionAnomalyFlag
    })
    .from(schema.roomMembership)
    .leftJoin(schema.devices, eq(schema.devices.deviceId, schema.roomMembership.deviceId))
    .where(eq(schema.roomMembership.sessionId, sessionId))
    .orderBy(schema.roomMembership.roomId, schema.roomMembership.startedAt);

  const roomsById = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = roomsById.get(row.roomId) ?? [];
    list.push(row);
    roomsById.set(row.roomId, list);
  }

  const rooms = [...roomsById.entries()].map(([roomId, members]) => ({
    roomId,
    members: members.map((m) => ({
      deviceId: m.deviceId,
      displayName: m.displayName || m.deviceId,
      role: m.role,
      startedAt: m.startedAt,
      endedAt: m.endedAt,
      durationMs: m.endedAt ? new Date(m.endedAt).getTime() - new Date(m.startedAt).getTime() : undefined,
      lastConfidence: m.lastConfidence,
      ultrasonicVerified: m.ultrasonicVerified,
      motionAnomalyFlag: m.motionAnomalyFlag
    }))
  }));

  return response.json({
    sessionId: session.id,
    code: session.code,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    rooms
  });
});

app.post("/api/session/leave", (request, response) => {
  const parsed = leaveSchema.safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ error: parsed.error.flatten() });
  
  engine.leave(parsed.data.deviceId);
  console.log(`🔴 [LEAVE] Device ${parsed.data.deviceId} left session`);
  
  return response.json({ ok: true });
});

app.post("/api/uwb/token", (request, response) => {
  const parsed = uwbTokenSchema.safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ error: parsed.error.flatten() });
  
  engine.setUwbToken(parsed.data.deviceId, parsed.data.discoveryTokenBase64);
  console.log(`📡 [UWB] Discovery token registered for device ${parsed.data.deviceId}`);
  
  return response.status(202).json({ ok: true });
});

app.post("/api/observations", (request, response) => {
  const parsed = batchSchema.safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ error: parsed.error.flatten() });

  const sessionId = engine.resolveSessionCode(parsed.data.sessionId);
  engine.ingest({ ...parsed.data, sessionId });

  const { displayName, deviceId, role, peers, wifiFingerprint, roomId, motionVariance, ultrasonicObservation, ultrasonicEmittedToken } = parsed.data;
  const name = displayName || deviceId.slice(-8);
  const apCount = wifiFingerprint?.length ?? 0;
  const motionLabel = motionVariance === undefined ? "n/a" : motionVariance.toFixed(4);
  const acousticLabel = ultrasonicObservation ? `🔊 Ultrasonic heard: '${ultrasonicObservation.token}' (${Math.round(ultrasonicObservation.confidence * 100)}%)` : ultrasonicEmittedToken ? `🔊 Ultrasonic emitting: '${ultrasonicEmittedToken}'` : "";

  console.log(`📡 [SENSOR] ${name} (${role}): ${peers.length} BLE peers heard, ${apCount} Wi-Fi APs scanned, motion variance ${motionLabel} ${acousticLabel ? `| ${acousticLabel}` : ""} -> Room: ${roomId || "auto"}`);
  
  return response.status(202).json({ ok: true, peerCount: peers.length });
});

// These four routes are read-only views of live state — they must never have the side effect
// of starting a session, only join()/ingest() (someone actually participating) can do that.
// peekActiveSession() returns undefined instead of minting when the code has nothing active.

app.get("/api/rooms", (request, response) => {
  const sessionId = engine.peekActiveSession(String(request.query.sessionId ?? "poc-session"));
  return response.json({ rooms: sessionId ? engine.listRooms(sessionId) : [] });
});

let lastLogTime = 0;
app.get("/api/rooms/:roomId/live", (request, response) => {
  const code = String(request.query.sessionId ?? "poc-session");
  const sessionId = engine.peekActiveSession(code);
  if (!sessionId) {
    return response.json({ sessionId: code, roomId: request.params.roomId, estimatedMemberDeviceIds: [], members: [], updatedAt: new Date().toISOString() });
  }
  const state = engine.roomState(sessionId, request.params.roomId);

  // Throttle periodic room state summary logging to once every 15s to keep console clean
  const now = Date.now();
  if (now - lastLogTime > 15_000 && state.members && state.members.length > 0) {
    lastLogTime = now;
    const names = state.members.map((m: { displayName?: string; deviceId: string }) => m.displayName || m.deviceId.slice(-6)).join(", ");
    console.log(`📊 [ROOM '${request.params.roomId}'] ${state.members.length} Confirmed In-Room: [${names}]`);
  }

  return response.json(state);
});

app.get("/api/devices/:deviceId/live", (request, response) => {
  const code = String(request.query.sessionId ?? "poc-session");
  const sessionId = engine.peekActiveSession(code);
  if (!sessionId) {
    return response.json({ sessionId: code, roomId: "unknown", estimatedMemberDeviceIds: [], members: [], updatedAt: new Date().toISOString() });
  }
  return response.json(engine.deviceRoomState(sessionId, request.params.deviceId));
});

app.get("/api/admin/overview", (request, response) => {
  const sessionId = engine.peekActiveSession(String(request.query.sessionId ?? "poc-session"));
  const rooms = sessionId
    ? engine.listRooms(sessionId).map((roomId) => engine.roomState(sessionId, roomId)).filter((state) => state.members && state.members.length > 0)
    : [];
  return response.json({ rooms });
});

app.listen(port, "0.0.0.0", () => {
  console.log(`🚀 ConfPresence POC API listening on http://0.0.0.0:${port}`);
  console.log(`✨ Live Streaming Logs initialized. All connected device events will appear below.`);
});
