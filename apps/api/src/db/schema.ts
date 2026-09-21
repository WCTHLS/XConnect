import { bigserial, boolean, pgTable, real, text, timestamp } from "drizzle-orm/pg-core";

// A grouping label for rooms, not a lifecycle entity. New rows use the human-typed label as
// both `id` and `code`; rows from before rooms became the primary entity keep their old
// per-occurrence ids, with the typed label in `code`.
export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  code: text("code"),
  name: text("name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  endedAt: timestamp("ended_at", { withTimezone: true })
});

// The primary entity. One row per real occurrence of a room: `id` is auto-generated
// (`${safeCode}__${timestamp36}`), `code` is the human-typed room name ("room-a") and is
// deliberately NOT unique — the same name reused tomorrow is a different occurrence.
// `sessionId` is just an optional grouping label (sessions.id), never part of a room's identity.
export const rooms = pgTable("rooms", {
  id: text("id").primaryKey(),
  code: text("code").notNull(),
  sessionId: text("session_id").references(() => sessions.id),
  label: text("label"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  endedAt: timestamp("ended_at", { withTimezone: true })
});

// Identity/liveness only. Heartbeat-level status (motion, connection state, confidence)
// deliberately stays in-memory in PocInferenceEngine, never persisted here — only meaningful
// state changes (stateChangeEvents below) and attendance metrics (roomMembership) are durable.
export const devices = pgTable("devices", {
  deviceId: text("device_id").primaryKey(),
  displayName: text("display_name"),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow()
});

// One row per meaningful boolean state transition (not a snapshot, not per-poll) — e.g. a
// device's motion-anomaly flag flipping, its room connection starting/ending, or (once the
// client-side staleness bug is fixed) its ultrasonic-verified status changing. `field` names
// which signal changed; `value` is the value it changed to.
export const stateChangeEvents = pgTable("state_change_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  roomId: text("room_id")
    .notNull()
    .references(() => rooms.id),
  deviceId: text("device_id")
    .notNull()
    .references(() => devices.deviceId),
  field: text("field").notNull(),
  value: boolean("value").notNull(),
  changedAt: timestamp("changed_at", { withTimezone: true }).notNull()
});

export const roomMembership = pgTable("room_membership", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  roomId: text("room_id")
    .notNull()
    .references(() => rooms.id),
  deviceId: text("device_id")
    .notNull()
    .references(() => devices.deviceId),
  role: text("role").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  lastConfidence: real("last_confidence"),
  ultrasonicVerified: boolean("ultrasonic_verified"),
  motionAnomalyFlag: boolean("motion_anomaly_flag")
});
