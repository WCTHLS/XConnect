import cors from "cors";
import { desc, eq, inArray, isNull } from "drizzle-orm";
import express from "express";
import { z } from "zod";
import { authEnabled, authenticate, forgetCachedUser, requireAdmin } from "./auth.js";
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
console.log(authEnabled ? "🔐 Sign-in required" : "⚠️  No sign-in configured (FIREBASE_PROJECT_ID or AUTH_AUTHORITY/AUTH_AUDIENCE), API is open (POC mode)");
app.use(authenticate);
app.use("/api/admin", requireAdmin);

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

app.get("/api/me", (request, response) => {
  if (!request.user) return response.json({ authEnabled, isAdmin: !authEnabled });
  return response.json({ authEnabled, ...request.user });
});

// A name of one's own, stored here rather than at the identity provider: it works the same for
// email, Google and Microsoft accounts, and survives the token refresh that rewrites display_name.
app.patch("/api/me", async (request, response) => {
  if (!request.user) return response.status(401).json({ error: "unauthenticated" });
  if (!db) return response.status(503).json({ error: "Changing your name requires Postgres persistence (DATABASE_URL not set)" });

  const parsed = z.object({ preferredName: z.string().max(60) }).safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ error: parsed.error.flatten() });

  // Blank clears it, falling back to whatever the account is called.
  const preferredName = parsed.data.preferredName.trim() || null;
  await db.update(schema.users).set({ preferredName }).where(eq(schema.users.id, request.user.id));
  forgetCachedUser(request.user.id);

  console.log(`\u{270F}\u{FE0F}  [NAME] ${request.user.email || request.user.id} is now '${preferredName ?? request.user.accountName}'`);
  return response.json({ authEnabled, ...request.user, name: preferredName ?? request.user.accountName });
});

app.post("/api/session/join", (request, response) => {
  const parsed = joinSchema.safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ error: parsed.error.flatten() });

  const { sessionId: code, deviceId, role, roomId } = parsed.data;
  // A signed-in person's name comes from their account, not from whatever the app typed.
  const displayName = request.user?.name ?? parsed.data.displayName;
  if (role === "presenter" && roomId) {
    const conflict = engine.presenterConflict(code, roomId, deviceId, request.user?.id);
    if (conflict) {
      console.log(`⛔ [JOIN] ${displayName || deviceId} rejected: room '${roomId}' already has presenter ${conflict.presenterName} (Session: ${code})`);
      return response.status(409).json({ error: "room_has_presenter", presenterName: conflict.presenterName });
    }
  }
  engine.join(deviceId, role, roomId, displayName, code, request.user?.id, request.user?.email);

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

app.post("/api/admin/rooms/end", (request, response) => {
  const parsed = z.object({ sessionId: z.string().min(1), roomId: z.string().min(1) }).safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ error: parsed.error.flatten() });

  const { sessionId, roomId } = parsed.data;
  const ended = engine.endRoom(sessionId, roomId);
  console.log(ended ? `🛑 [ROOM] '${roomId}' under '${sessionId}' ended by admin` : `⚠️  [ROOM] '${roomId}' under '${sessionId}' was not active`);

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
          userId: schema.roomMembership.userId,
          role: schema.roomMembership.role,
          displayName: schema.devices.displayName,
          userName: schema.users.displayName,
          preferredName: schema.users.preferredName,
          startedAt: schema.roomMembership.startedAt,
          endedAt: schema.roomMembership.endedAt
        })
        .from(schema.roomMembership)
        .leftJoin(schema.devices, eq(schema.devices.deviceId, schema.roomMembership.deviceId))
        .leftJoin(schema.users, eq(schema.users.id, schema.roomMembership.userId))
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
      set.add(m.preferredName || m.userName || m.displayName || m.deviceId);
      hostsByRoom.set(m.roomId, set);
    } else {
      const set = attendeesByRoom.get(m.roomId) ?? new Set<string>();
      set.add(m.userId ?? m.deviceId);
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
      userId: schema.roomMembership.userId,
      userName: schema.users.displayName,
      preferredName: schema.users.preferredName,
      email: schema.users.email,
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
    .leftJoin(schema.users, eq(schema.users.id, schema.roomMembership.userId))
    .where(eq(schema.roomMembership.roomId, roomOccurrenceId))
    .orderBy(schema.roomMembership.startedAt);

  const members = rows.map((m) => ({
    // Group by person when there's an account, so several leaves and joins (or a new phone)
    // total up as one attendee; older rows without a user fall back to the device.
    deviceId: m.userId ?? m.deviceId,
    email: m.email ?? undefined,
    displayName: m.preferredName || m.userName || m.displayName || m.deviceId,
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
    const conflict = engine.presenterConflict(parsed.data.sessionId, parsed.data.roomId, parsed.data.deviceId, request.user?.id);
    if (conflict) return response.status(409).json({ error: "room_has_presenter", presenterName: conflict.presenterName });
  }
  const accepted = engine.ingest(request.user?.name ? { ...parsed.data, displayName: request.user.name } : parsed.data, request.user?.id, request.user?.email);
  if (!accepted) return response.status(202).json({ ok: true, roomEnded: true });

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

app.get("/api/sessions/active", (_request, response) => {
  return response.json({ sessions: engine.listActiveSessionLabels() });
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

// Deliberately not scoped to a session label: the admin watches every active room across the
// whole event, not just the session code their own app is set to. Each room's state carries its
// own label so the screen can tell two same-named rooms apart.
//
// Deliberately NOT filtered to rooms with live members: a room whose only presenter has gone
// stale (backgrounded, force-closed without a graceful leave) still shows here with 0 members —
// hiding it would leave the admin with no way to ever discover and close a room stuck in that
// state, since this endpoint is also what "Manage Rooms" reads from.
app.get("/api/admin/overview", (_request, response) => {
  const rooms = engine
    .listActiveRooms()
    .map(({ sessionLabel, roomCode }) => engine.roomState(sessionLabel, roomCode));
  return response.json({ rooms });
});

app.listen(port, "0.0.0.0", () => {
  console.log(`🚀 ConfPresence POC API listening on http://0.0.0.0:${port}`);
  console.log(`✨ Live Streaming Logs initialized. All connected device events will appear below.`);
});
