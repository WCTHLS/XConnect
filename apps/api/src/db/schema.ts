import { bigserial, boolean, pgTable, primaryKey, real, text, timestamp } from "drizzle-orm/pg-core";

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  name: text("name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  endedAt: timestamp("ended_at", { withTimezone: true })
});

export const rooms = pgTable(
  "rooms",
  {
    id: text("id").notNull(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id),
    label: text("label"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [primaryKey({ columns: [table.sessionId, table.id] })]
);

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
  sessionId: text("session_id")
    .notNull()
    .references(() => sessions.id),
  roomId: text("room_id"),
  deviceId: text("device_id")
    .notNull()
    .references(() => devices.deviceId),
  field: text("field").notNull(),
  value: boolean("value").notNull(),
  changedAt: timestamp("changed_at", { withTimezone: true }).notNull()
});

export const roomMembership = pgTable("room_membership", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .references(() => sessions.id),
  roomId: text("room_id").notNull(),
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
