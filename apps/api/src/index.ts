import cors from "cors";
import express from "express";
import { z } from "zod";
import { db } from "./db/index.js";
import { PocInferenceEngine } from "./inference.js";

const app = express();
const engine = new PocInferenceEngine({ db });
const port = Number(process.env.PORT ?? process.env.API_PORT ?? 3000);

console.log(db ? "🗄️  Postgres persistence enabled" : "⚠️  No DATABASE_URL set — running in-memory only (POC mode)");

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
  
  const { sessionId, deviceId, role, roomId, displayName } = parsed.data;
  engine.join(deviceId, role, roomId, displayName, sessionId);
  
  const roleEmoji = role === "presenter" ? "👑 [PRESENTER]" : "👤 [ATTENDEE]";
  console.log(`🟢 ${roleEmoji} ${displayName || deviceId} joined room '${roomId || "unassigned"}' (Session: ${parsed.data.sessionId})`);
  
  return response.status(201).json({ ok: true });
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
  
  engine.ingest(parsed.data);
  
  const { displayName, deviceId, role, peers, wifiFingerprint, roomId, motionVariance, ultrasonicObservation, ultrasonicEmittedToken } = parsed.data;
  const name = displayName || deviceId.slice(-8);
  const apCount = wifiFingerprint?.length ?? 0;
  const motionLabel = motionVariance === undefined ? "n/a" : motionVariance.toFixed(4);
  const acousticLabel = ultrasonicObservation ? `🔊 Ultrasonic heard: '${ultrasonicObservation.token}' (${Math.round(ultrasonicObservation.confidence * 100)}%)` : ultrasonicEmittedToken ? `🔊 Ultrasonic emitting: '${ultrasonicEmittedToken}'` : "";

  console.log(`📡 [SENSOR] ${name} (${role}): ${peers.length} BLE peers heard, ${apCount} Wi-Fi APs scanned, motion variance ${motionLabel} ${acousticLabel ? `| ${acousticLabel}` : ""} -> Room: ${roomId || "auto"}`);
  
  return response.status(202).json({ ok: true, peerCount: peers.length });
});

app.get("/api/rooms", (request, response) => {
  const sessionId = String(request.query.sessionId ?? "poc-session");
  return response.json({ rooms: engine.listRooms(sessionId) });
});

let lastLogTime = 0;
app.get("/api/rooms/:roomId/live", (request, response) => {
  const sessionId = String(request.query.sessionId ?? "poc-session");
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
  const sessionId = String(request.query.sessionId ?? "poc-session");
  return response.json(engine.deviceRoomState(sessionId, request.params.deviceId));
});

app.get("/api/admin/overview", (request, response) => {
  const sessionId = String(request.query.sessionId ?? "poc-session");
  const rooms = engine
    .listRooms(sessionId)
    .map((roomId) => engine.roomState(sessionId, roomId))
    .filter((state) => state.members && state.members.length > 0);
  return response.json({ rooms });
});

app.listen(port, "0.0.0.0", () => {
  console.log(`🚀 ConfPresence POC API listening on http://0.0.0.0:${port}`);
  console.log(`✨ Live Streaming Logs initialized. All connected device events will appear below.`);
});
