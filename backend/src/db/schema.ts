import { bigserial, boolean, pgTable, real, text, timestamp, unique } from "drizzle-orm/pg-core";

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

// A signed-in person (Entra External ID). `id` is the token's stable object id, so the same
// person is the same row across app relaunches and phones. Names and emails live here so
// history can total a person's time across several leaves and joins.
export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email"),
  // The name the provider gave. Refreshed from every sign-in token, so never edit it directly.
  displayName: text("display_name"),
  // A name the person chose for themselves. Wins over display_name everywhere a name is shown,
  // and survives token refreshes. Null means "just use the account's name".
  preferredName: text("preferred_name"),
  isAdmin: boolean("is_admin").notNull().default(false),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow()
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

// One row per device registered for push notifications via Azure Notification Hubs.
// `installationId` is the id we hand Notification Hubs itself (currently the device's own
// `deviceId` — see deviceIdentity.ts client-side), so this table is purely local bookkeeping for
// "does this email have any registered device" (the admin send-notification UI's "no device
// registered" indicator) — Notification Hubs itself is what actually resolves a send's email tag
// filter to devices, this table is never queried to build that filter.
export const pushInstallations = pgTable("push_installations", {
  installationId: text("installation_id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  email: text("email"),
  platform: text("platform"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});

// An admin's check-in invitation to one person for one session label, sent ahead of time — so it
// is keyed by `sessionCode` (a label someone typed) rather than by rooms.id, which does not exist
// yet when the invite goes out and may never exist if nobody starts the room.
//
// This is an RSVP, NOT attendance. Accepting means "I plan to be there"; whether someone was
// actually in the room still comes only from room_membership, written by sensor-verified
// presence. Nothing here should ever be read as a presence record.
//
// Keyed by email because the invite is addressed before we know whether that person has an
// account: `userId` stays null until someone signed in with that address responds.
export const sessionInvites = pgTable(
  "session_invites",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    sessionCode: text("session_code").notNull(),
    // Always stored lowercased and trimmed, so lookups never depend on how it was typed.
    email: text("email").notNull(),
    userId: text("user_id").references(() => users.id),
    // "pending" | "accepted" | "declined" — pending is the absence of a response, not a response.
    status: text("status").notNull().default("pending"),
    invitedByUserId: text("invited_by_user_id").references(() => users.id),
    title: text("title"),
    message: text("message"),
    // When the event itself is scheduled for. Nullable because it is optional on the invite, and
    // because invites created before this column existed have no value for it. Purely
    // informational: nothing schedules or expires off the back of it yet.
    eventAt: timestamp("event_at", { withTimezone: true }),
    // "attendee" (default) or "presenter". A presenter invite is a room assignment: it carries
    // `roomCode`, and accepting it lets them start broadcasting that room without retyping it.
    inviteRole: text("invite_role").notNull().default("attendee"),
    // Only meaningful for a presenter invite. Deliberately a plain typed room name, matching how
    // rooms work everywhere else here: it names a room that need not exist yet, since the whole
    // point is assigning it before anyone starts broadcasting.
    roomCode: text("room_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    respondedAt: timestamp("responded_at", { withTimezone: true })
  },
  table => ({
    // Re-inviting the same address to the same session updates that invite rather than stacking
    // duplicates, which would make the admin's responded/not-responded counts meaningless.
    sessionEmail: unique("session_invites_session_email").on(table.sessionCode, table.email)
  })
);

export const roomMembership = pgTable("room_membership", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  roomId: text("room_id")
    .notNull()
    .references(() => rooms.id),
  deviceId: text("device_id")
    .notNull()
    .references(() => devices.deviceId),
  // Nullable: rows from before accounts existed have no user.
  userId: text("user_id").references(() => users.id),
  role: text("role").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  lastConfidence: real("last_confidence"),
  ultrasonicVerified: boolean("ultrasonic_verified"),
  motionAnomalyFlag: boolean("motion_anomaly_flag")
});
