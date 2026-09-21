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

// PocInferenceEngine's "which occurrence is active for this room" tracking lives only in
// memory, so a server restart silently orphans whatever was active at the time — those rows
// would otherwise sit with ended_at: NULL forever, looking "active" in history indefinitely.
// A fresh boot is itself a natural "nothing is actually active anymore" boundary, so close
// them out right here rather than leaving stale rows behind.
if (db) {
  db.update(schema.rooms)
    .set({ endedAt: new Date() })
    .where(isNull(schema.rooms.endedAt))
    .then((result) => {
      if (result.count > 0) console.log(`🧹 Closed ${result.count} room(s) left open from before this restart`);
    })
    .catch((err) => console.error("[db] failed to close orphaned rooms on startup:", err));
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
  if (role === "presenter" && roomId) {
    const conflict = engine.presenterConflict(code, roomId, deviceId);
    if (conflict) {
      console.log(`⛔ [JOIN] ${displayName || deviceId} rejected: room '${roomId}' already has presenter ${conflict.presenterName} (Session: ${code})`);
      return response.status(409).json({ error: "room_has_presenter", presenterName: conflict.presenterName });
    }
  }
  engine.join(deviceId, role, roomId, displayName, code);

  const roleEmoji = role === "presenter" ? "👑 [PRESENTER]" : "👤 [ATTENDEE]";
  console.log(`🟢 ${roleEmoji} ${displayName || deviceId} joined room '${roomId || "unassigned"}' (Session: ${code})`);

  return response.status(201).json({ ok: true });
});

app.post("/api/admin/session/end", (request, response) => {
  const parsed = z.object({ sessionId: z.string().min(1) }).safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ error: parsed.error.flatten() });

  const ended = engine.endSession(parsed.data.sessionId);
  console.log(ended ? `🛑 [SESSION] all rooms under '${parsed.data.sessionId}' ended by admin` : `⚠️  [SESSION] '${parsed.data.sessionId}' had no active rooms to end`);

  return response.json({ ok: true, ended });
});

// History is room-centric: each entry is one occurrence of one room (rooms.id). The optional
// `code` filter matches the session label the room was grouped under.
app.get("/api/admin/sessions", async (request, response) => {
  if (!db) return response.status(503).json({ error: "History requires Postgres persistence (DATABASE_URL not set)" });

  // No code param (or blank) means "show everything" rather than requiring a search term.
  const code = String(request.query.code ?? "").trim();

  const rows = await db
    .select({
      id: schema.rooms.id,
      roomCode: schema.rooms.code,
      sessionLabel: schema.sessions.code
    })
    .from(schema.rooms)
    .leftJoin(schema.sessions, eq(schema.sessions.id, schema.rooms.sessionId))
    .where(code ? eq(schema.sessions.code, code) : undefined)
    .orderBy(desc(schema.rooms.createdAt));

  const roomIds = rows.map((r) => r.id);
  const membershipRows = roomIds.length
    ? await db
        .select({
          roomId: schema.roomMembership.roomId,
          deviceId: schema.roomMembership.deviceId,
          role: schema.roomMembership.role,
          displayName: schema.devices.displayName,
          startedAt: schema.roomMembership.startedAt,
          endedAt: schema.roomMembership.endedAt
        })
        .from(schema.roomMembership)
        .leftJoin(schema.devices, eq(schema.devices.deviceId, schema.roomMembership.deviceId))
        .where(inArray(schema.roomMembership.roomId, roomIds))
    : [];

  const hostsByRoom = new Map<string, Set<string>>();
  const attendeesByRoom = new Map<string, Set<string>>();
  // The room row's own started_at/ended_at are just bookkeeping (when the occurrence was minted /
  // explicitly ended) — the data people actually care about is when someone was really in the
  // room, so derive that from room_membership instead.
  const timesByRoom = new Map<string, { startedAt: Date; endedAt: Date | null; stillOpen: boolean }>();
  const intervalsByRoom = new Map<string, { start: number; end: number }[]>();
  const now = Date.now();
  for (const m of membershipRows) {
    if (m.role === "presenter") {
      const set = hostsByRoom.get(m.roomId) ?? new Set<string>();
      set.add(m.displayName || m.deviceId);
      hostsByRoom.set(m.roomId, set);
    } else {
      const set = attendeesByRoom.get(m.roomId) ?? new Set<string>();
      set.add(m.deviceId);
      attendeesByRoom.set(m.roomId, set);
    }

    const times = timesByRoom.get(m.roomId);
    if (!times) {
      timesByRoom.set(m.roomId, { startedAt: m.startedAt, endedAt: m.endedAt, stillOpen: !m.endedAt });
    } else {
      if (m.startedAt < times.startedAt) times.startedAt = m.startedAt;
      if (!m.endedAt) {
        times.stillOpen = true;
      } else if (!times.endedAt || m.endedAt > times.endedAt) {
        times.endedAt = m.endedAt;
      }
    }

    const list = intervalsByRoom.get(m.roomId) ?? [];
    list.push({ start: m.startedAt.getTime(), end: m.endedAt ? m.endedAt.getTime() : now });
    intervalsByRoom.set(m.roomId, list);
  }

  // Real occupied time, not a naive first-start-to-last-end span — a room that empties out
  // between two separate visits (presenter leaves, comes back later) must not have that gap
  // counted as if something were active the whole time. Merge overlapping/adjacent intervals
  // across every device in the room and sum only the merged, actually-occupied ranges.
  const durationByRoom = new Map<string, number>();
  for (const [roomId, intervals] of intervalsByRoom) {
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
    durationByRoom.set(roomId, total);
  }

  const sessions = rows.map((r) => {
    const times = timesByRoom.get(r.id);
    return {
      id: r.id,
      code: r.sessionLabel ?? r.roomCode,
      hasActivity: Boolean(times),
      startedAt: times?.startedAt ?? null,
      endedAt: times && !times.stillOpen ? times.endedAt : null,
      stillOpen: times?.stillOpen ?? false,
      durationMs: durationByRoom.get(r.id),
      rooms: [r.roomCode],
      hosts: [...(hostsByRoom.get(r.id) ?? [])],
      attendeeCount: (attendeesByRoom.get(r.id) ?? new Set()).size
    };
  });

  return response.json({ sessions });
});

app.get("/api/admin/history", async (request, response) => {
  if (!db) return response.status(503).json({ error: "History requires Postgres persistence (DATABASE_URL not set)" });

  // `roomId` is the room occurrence ID; `sessionId` is accepted as the same thing for older clients.
  const roomOccurrenceId = String(request.query.roomId ?? request.query.sessionId ?? "").trim();
  if (!roomOccurrenceId) return response.status(400).json({ error: "roomId query param is required" });

  const [room] = await db
    .select({
      id: schema.rooms.id,
      roomCode: schema.rooms.code,
      startedAt: schema.rooms.startedAt,
      endedAt: schema.rooms.endedAt,
      sessionLabel: schema.sessions.code
    })
    .from(schema.rooms)
    .leftJoin(schema.sessions, eq(schema.sessions.id, schema.rooms.sessionId))
    .where(eq(schema.rooms.id, roomOccurrenceId));
  if (!room) return response.status(404).json({ error: "No room found with that ID" });

  const rows = await db
    .select({
      deviceId: schema.roomMembership.deviceId,
      displayName: schema.devices.displayName,
      role: schema.roomMembership.role,
      startedAt: schema.roomMembership.startedAt,
      endedAt: schema.roomMembership.endedAt,
      lastConfidence: schema.roomMembership.lastConfidence,
      ultrasonicVerified: schema.roomMembership.ultrasonicVerified,
      motionAnomalyFlag: schema.roomMembership.motionAnomalyFlag
    })
    .from(schema.roomMembership)
    .leftJoin(schema.devices, eq(schema.devices.deviceId, schema.roomMembership.deviceId))
    .where(eq(schema.roomMembership.roomId, roomOccurrenceId))
    .orderBy(schema.roomMembership.startedAt);

  const members = rows.map((m) => ({
    deviceId: m.deviceId,
    displayName: m.displayName || m.deviceId,
    role: m.role,
    startedAt: m.startedAt,
    endedAt: m.endedAt,
    durationMs: m.endedAt ? new Date(m.endedAt).getTime() - new Date(m.startedAt).getTime() : undefined,
    lastConfidence: m.lastConfidence,
    ultrasonicVerified: m.ultrasonicVerified,
    motionAnomalyFlag: m.motionAnomalyFlag
  }));

  return response.json({
    sessionId: room.id,
    code: room.sessionLabel ?? room.roomCode,
    startedAt: room.startedAt,
    endedAt: room.endedAt,
    rooms: members.length ? [{ roomId: room.roomCode, members }] : []
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

  if (parsed.data.role === "presenter" && parsed.data.roomId) {
    const conflict = engine.presenterConflict(parsed.data.sessionId, parsed.data.roomId, parsed.data.deviceId);
    if (conflict) return response.status(409).json({ error: "room_has_presenter", presenterName: conflict.presenterName });
  }
  engine.ingest(parsed.data);

  const { displayName, deviceId, role, peers, wifiFingerprint, roomId, motionVariance, ultrasonicObservation, ultrasonicEmittedToken } = parsed.data;
  const name = displayName || deviceId.slice(-8);
  const apCount = wifiFingerprint?.length ?? 0;
  const motionLabel = motionVariance === undefined ? "n/a" : motionVariance.toFixed(4);
  const acousticLabel = ultrasonicObservation ? `🔊 Ultrasonic heard: '${ultrasonicObservation.token}' (${Math.round(ultrasonicObservation.confidence * 100)}%)` : ultrasonicEmittedToken ? `🔊 Ultrasonic emitting: '${ultrasonicEmittedToken}'` : "";

  console.log(`📡 [SENSOR] ${name} (${role}): ${peers.length} BLE peers heard, ${apCount} Wi-Fi APs scanned, motion variance ${motionLabel} ${acousticLabel ? `| ${acousticLabel}` : ""} -> Room: ${roomId || "auto"}`);
  
  return response.status(202).json({ ok: true, peerCount: peers.length });
});

// These four routes are read-only views of live state — they never create rooms, only
// presenters joining/sending batches do. `sessionId` is the session label the room is grouped under.

app.get("/api/rooms", (request, response) => {
  const label = String(request.query.sessionId ?? "poc-session");
  return response.json({ rooms: engine.listRooms(label) });
});

let lastLogTime = 0;
app.get("/api/rooms/:roomId/live", (request, response) => {
  const label = String(request.query.sessionId ?? "poc-session");
  const state = engine.roomState(label, request.params.roomId);
  // A presenter passes its own deviceId so an admin ending the session can switch it off too.
  const askingDeviceId = String(request.query.deviceId ?? "");
  if (askingDeviceId && engine.roomEndedNotice(askingDeviceId)) {
    return response.json({ ...state, roomEnded: true });
  }

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
  const label = String(request.query.sessionId ?? "poc-session");
  const state = engine.deviceRoomState(label, request.params.deviceId);
  return response.json(engine.roomEndedNotice(request.params.deviceId) ? { ...state, roomEnded: true } : state);
});

app.get("/api/admin/overview", (request, response) => {
  const label = String(request.query.sessionId ?? "poc-session");
  const rooms = engine
    .listRooms(label)
    .map((roomId) => engine.roomState(label, roomId))
    .filter((state) => state.members && state.members.length > 0);
  return response.json({ rooms });
});

app.listen(port, "0.0.0.0", () => {
  console.log(`🚀 ConfPresence POC API listening on http://0.0.0.0:${port}`);
  console.log(`✨ Live Streaming Logs initialized. All connected device events will appear below.`);
});
