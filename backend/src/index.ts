import cors from "cors";
import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import express from "express";
import { z } from "zod";
import { authEnabled, authenticate, forgetCachedUser, requireAdmin } from "./auth.js";
import { db, schema } from "./db/index.js";
import { PocInferenceEngine } from "./inference.js";
import { pushEnabled, registerInstallation, sendToEmails } from "./notifications.js";

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

// Called once after sign-in (and again whenever the push token changes) so this device can
// receive notifications. Registration is keyed by installationId (the client's own deviceId),
// not tied to any particular room/session — it's account-level, same as auth itself.
app.post("/api/push/register", async (request, response) => {
  if (!request.user) return response.status(401).json({ error: "unauthenticated" });
  if (!pushEnabled) return response.status(503).json({ error: "Push notifications are not configured" });

  const parsed = z.object({ installationId: z.string().min(8), pushChannel: z.string().min(1) }).safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ error: parsed.error.flatten() });

  try {
    await registerInstallation(parsed.data.installationId, request.user.id, request.user.email, parsed.data.pushChannel);
    console.log(`🔔 [PUSH] Registered device for ${request.user.email || request.user.id}`);
    return response.json({ ok: true });
  } catch (err) {
    console.error("[push] registration failed:", err);
    return response.status(500).json({ error: "Registration failed" });
  }
});

// Admin-only: send a plain notification right now to every device signed in under the given
// emails. No scheduling yet — this is the notification pipe on its own.
app.post("/api/admin/notifications/send", async (request, response) => {
  if (!pushEnabled) return response.status(503).json({ error: "Push notifications are not configured" });

  const parsed = z
    .object({ emails: z.array(z.string().email()).min(1).max(100), title: z.string().min(1).max(80), message: z.string().min(1).max(500) })
    .safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ error: parsed.error.flatten() });

  try {
    const { matchedEmails, unmatchedEmails } = await sendToEmails(parsed.data.emails, parsed.data.title, parsed.data.message);
    console.log(`🔔 [PUSH] Sent "${parsed.data.title}" to ${matchedEmails.length}/${parsed.data.emails.length} email(s)`);
    return response.json({ ok: true, matchedEmails, unmatchedEmails });
  } catch (err) {
    console.error("[push] send failed:", err);
    return response.status(500).json({ error: "Send failed" });
  }
});

// Admin-only: every known account with an email, for the notification screen's recipient
// picker — accounts get created on first sign-in (see loadVerifiers()/auth.ts), so this is
// "everyone who has ever signed in," not a managed user directory.
app.get("/api/admin/users", async (_request, response) => {
  if (!db) return response.status(503).json({ error: "User list requires Postgres persistence (DATABASE_URL not set)" });

  const rows = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      displayName: schema.users.displayName,
      preferredName: schema.users.preferredName
    })
    .from(schema.users)
    .where(isNotNull(schema.users.email));

  const users = rows.map((u) => ({
    id: u.id,
    email: u.email as string,
    name: u.preferredName || u.displayName || (u.email as string)
  }));
  return response.json({ users });
});

// ---------------------------------------------------------------------------------------------
// Check-in invitations
//
// An invite is an RSVP to a session label, sent before any room exists. It never records
// attendance: accepting only means "I plan to be there". Whether someone was actually present
// still comes exclusively from room_membership, written by sensor-verified presence.
// ---------------------------------------------------------------------------------------------

const normalizeEmail = (email: string) => email.trim().toLowerCase();

/** Admin-only: invite a list of addresses to a session, and push a prompt to whoever has the app. */
app.post("/api/admin/invites", async (request, response) => {
  if (!db) return response.status(503).json({ error: "Invites require Postgres persistence (DATABASE_URL not set)" });

  const parsed = z
    .object({
      sessionId: z.string().min(1),
      emails: z.array(z.string().email()).min(1),
      title: z.string().min(1).optional(),
      message: z.string().min(1).optional(),
      // ISO 8601 instant for when the event is scheduled. Validated by actually parsing it
      // rather than by pattern, so "2026-02-30T10:00:00Z" is rejected rather than silently
      // becoming March 2nd the way `new Date` would roll it over.
      eventAt: z
        .string()
        .refine((v) => !Number.isNaN(Date.parse(v)), { message: "eventAt must be a valid ISO date-time" })
        .optional()
        .nullable(),
      inviteRole: z.enum(["attendee", "presenter"]).optional(),
      roomCode: z.string().min(1).optional()
    })
    .refine((v) => v.inviteRole !== "presenter" || Boolean(v.roomCode?.trim()), {
      message: "A presenter invite must name the room they are assigned to",
      path: ["roomCode"]
    })
    .safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ error: parsed.error.flatten() });

  const sessionCode = parsed.data.sessionId.trim();
  const eventAt = parsed.data.eventAt ? new Date(parsed.data.eventAt) : null;
  const inviteRole = parsed.data.inviteRole ?? "attendee";
  // Only a presenter invite carries a room; storing one on an attendee invite would imply an
  // assignment that nothing honours.
  const roomCode = inviteRole === "presenter" ? parsed.data.roomCode!.trim() : null;
  const title = parsed.data.title?.trim() || "Check-in request";
  const message =
    parsed.data.message?.trim() ||
    (parsed.data.inviteRole === "presenter"
      ? `You're assigned to host ${parsed.data.roomCode?.trim()} in ${sessionCode}.`
      : `You've been invited to check in to ${sessionCode}.`);
  // Dedupe case-insensitively: the same address picked from the list and typed by hand is one
  // invite, and two rows differing only by case would both violate the unique constraint anyway.
  const emails = [...new Set(parsed.data.emails.map(normalizeEmail))];

  const now = new Date();
  for (const email of emails) {
    await db
      .insert(schema.sessionInvites)
      .values({
        sessionCode,
        email,
        status: "pending",
        invitedByUserId: request.user?.id,
        title,
        message,
        eventAt,
        inviteRole,
        roomCode,
        createdAt: now
      })
      // Re-inviting resets the invite to pending and clears the old answer, which is what
      // "ask them again" means. The alternative (keeping a stale decline) would make a re-invite
      // silently do nothing visible.
      .onConflictDoUpdate({
        target: [schema.sessionInvites.sessionCode, schema.sessionInvites.email],
        set: { status: "pending", respondedAt: null, title, message, eventAt, inviteRole, roomCode, createdAt: now, invitedByUserId: request.user?.id }
      });
  }

  // Link any invite to an existing account up front, so the admin roster can show a real name
  // before the person has responded (or even opened the app).
  const knownUsers = await db
    .select({ id: schema.users.id, email: schema.users.email })
    .from(schema.users)
    .where(isNotNull(schema.users.email));
  for (const user of knownUsers) {
    const email = normalizeEmail(user.email as string);
    if (!emails.includes(email)) continue;
    await db
      .update(schema.sessionInvites)
      .set({ userId: user.id })
      .where(and(eq(schema.sessionInvites.sessionCode, sessionCode), eq(schema.sessionInvites.email, email)));
  }

  // The push is a best-effort nudge, not the invite itself — the invite is the row above, and the
  // app also polls for it. A push failure (or push not being configured at all) must not lose the
  // invite, so it is reported back rather than thrown.
  let pushResult: { matchedEmails: string[]; unmatchedEmails: string[] } | null = null;
  let pushError: string | null = null;
  if (pushEnabled) {
    try {
      pushResult = await sendToEmails(emails, title, message);
    } catch (err: any) {
      pushError = err?.message || "Push send failed";
    }
  } else {
    pushError = "Push notifications are not configured on this server";
  }

  console.log(`✉️  [INVITE] ${emails.length} invite(s) to '${sessionCode}' by ${request.user?.email || "unknown"}${pushError ? ` (push: ${pushError})` : ""}`);

  return response.json({
    ok: true,
    invited: emails.length,
    pushed: pushResult?.matchedEmails ?? [],
    notReachableByPush: pushResult?.unmatchedEmails ?? emails,
    pushError
  });
});

/** Admin-only: the response roster for a session — who accepted, declined, or hasn't answered. */
app.get("/api/admin/invites", async (request, response) => {
  if (!db) return response.status(503).json({ error: "Invites require Postgres persistence (DATABASE_URL not set)" });

  const sessionCode = String(request.query.sessionId ?? "").trim();

  const rows = await db
    .select({
      id: schema.sessionInvites.id,
      sessionCode: schema.sessionInvites.sessionCode,
      email: schema.sessionInvites.email,
      status: schema.sessionInvites.status,
      eventAt: schema.sessionInvites.eventAt,
      title: schema.sessionInvites.title,
      message: schema.sessionInvites.message,
      inviteRole: schema.sessionInvites.inviteRole,
      roomCode: schema.sessionInvites.roomCode,
      createdAt: schema.sessionInvites.createdAt,
      respondedAt: schema.sessionInvites.respondedAt,
      userName: schema.users.displayName,
      preferredName: schema.users.preferredName
    })
    .from(schema.sessionInvites)
    .leftJoin(schema.users, eq(schema.users.id, schema.sessionInvites.userId))
    .where(sessionCode ? eq(schema.sessionInvites.sessionCode, sessionCode) : undefined)
    .orderBy(desc(schema.sessionInvites.createdAt));

  const invites = rows.map((r) => ({
    id: r.id,
    sessionId: r.sessionCode,
    email: r.email,
    // Falls back to the address when the invite hasn't been matched to an account yet.
    displayName: r.preferredName || r.userName || r.email,
    status: r.status as "pending" | "accepted" | "declined",
    eventAt: r.eventAt,
    title: r.title,
    message: r.message,
    inviteRole: r.inviteRole as "attendee" | "presenter",
    roomCode: r.roomCode,
    createdAt: r.createdAt,
    respondedAt: r.respondedAt
  }));

  return response.json({
    invites,
    counts: {
      total: invites.length,
      accepted: invites.filter((i) => i.status === "accepted").length,
      declined: invites.filter((i) => i.status === "declined").length,
      pending: invites.filter((i) => i.status === "pending").length
    }
  });
});

/**
 * Admin-only: edit a whole batch of already-sent invites, identified by its session code.
 *
 * The batch is the unit, not the individual invite: everyone invited to a session shares its
 * schedule and wording, so editing one person's copy would silently desync the group.
 *
 * `reAsk` is the admin's explicit choice. Without it, edits only correct the details and every
 * existing reply stands, which is what a typo fix should do. With it, replies are cleared and
 * everyone is asked again, which is what a moved start time usually warrants.
 */
app.patch("/api/admin/invites", async (request, response) => {
  if (!db) return response.status(503).json({ error: "Invites require Postgres persistence (DATABASE_URL not set)" });

  const parsed = z
    .object({
      sessionId: z.string().min(1),
      newSessionId: z.string().min(1).optional(),
      title: z.string().min(1).optional(),
      message: z.string().min(1).optional(),
      eventAt: z
        .string()
        .refine((v) => !Number.isNaN(Date.parse(v)), { message: "eventAt must be a valid ISO date-time" })
        .optional()
        .nullable(),
      /** Presenter batches only; ignored for attendee invites, which have no room. */
      roomCode: z.string().min(1).optional(),
      reAsk: z.boolean().optional()
    })
    .safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ error: parsed.error.flatten() });

  const from = parsed.data.sessionId.trim();
  const to = (parsed.data.newSessionId ?? parsed.data.sessionId).trim();
  const reAsk = parsed.data.reAsk === true;

  const batch = await db
    .select({ email: schema.sessionInvites.email })
    .from(schema.sessionInvites)
    .where(eq(schema.sessionInvites.sessionCode, from));
  if (batch.length === 0) return response.status(404).json({ error: `No invites found for "${from}"` });

  // Renaming the session moves every row onto a new (session_code, email) key. If the target
  // code already has an invite for one of these people, the unique constraint would reject the
  // whole update — so say which addresses clash rather than surfacing a raw database error.
  if (to !== from) {
    const emails = batch.map((b) => b.email);
    const clashes = await db
      .select({ email: schema.sessionInvites.email })
      .from(schema.sessionInvites)
      .where(and(eq(schema.sessionInvites.sessionCode, to), inArray(schema.sessionInvites.email, emails)));
    if (clashes.length > 0) {
      return response.status(409).json({
        error: `"${to}" already has invites for: ${clashes.map((c) => c.email).join(", ")}`
      });
    }
  }

  const changes: Record<string, unknown> = {};
  if (parsed.data.title !== undefined) changes.title = parsed.data.title.trim();
  if (parsed.data.message !== undefined) changes.message = parsed.data.message.trim();
  // `undefined` means "not supplied, leave it"; an explicit null means "clear the schedule".
  if (parsed.data.eventAt !== undefined) changes.eventAt = parsed.data.eventAt ? new Date(parsed.data.eventAt) : null;
  if (to !== from) changes.sessionCode = to;
  if (reAsk) {
    changes.status = "pending";
    changes.respondedAt = null;
  }
  if (Object.keys(changes).length === 0 && parsed.data.roomCode === undefined) {
    return response.json({ ok: true, updated: 0, sessionId: to, pushError: null });
  }

  // Skipped when only a room reassignment was asked for: an empty `.set()` is a driver error,
  // not a no-op.
  const result =
    Object.keys(changes).length > 0
      ? await db.update(schema.sessionInvites).set(changes).where(eq(schema.sessionInvites.sessionCode, from))
      : { count: 0 };

  // Room reassignment is applied separately and only to presenter rows. A batch can hold both
  // kinds, and an attendee invite must never carry a room — it would imply an assignment that
  // nothing honours. Runs against the destination code, since the update above may have moved
  // these rows already.
  if (parsed.data.roomCode !== undefined) {
    await db
      .update(schema.sessionInvites)
      .set({ roomCode: parsed.data.roomCode.trim() })
      .where(and(eq(schema.sessionInvites.sessionCode, to), eq(schema.sessionInvites.inviteRole, "presenter")));
  }

  // Only notify when replies were actually cleared — an edit that left answers alone doesn't
  // need to buzz everyone's phone.
  let pushError: string | null = null;
  if (reAsk) {
    const title = (changes.title as string | undefined) ?? "Check-in request updated";
    const message = (changes.message as string | undefined) ?? `The details for ${to} changed. Please reply again.`;
    if (pushEnabled) {
      try {
        await sendToEmails(batch.map((b) => b.email), title, message);
      } catch (err: any) {
        pushError = err?.message || "Push send failed";
      }
    } else {
      pushError = "Push notifications are not configured on this server";
    }
  }

  console.log(`✏️  [INVITE] '${from}'${to !== from ? ` renamed to '${to}'` : ""} edited by ${request.user?.email || "unknown"}${reAsk ? " (replies cleared, re-asked)" : ""}`);

  return response.json({ ok: true, updated: result.count, sessionId: to, pushError });
});

/**
 * The signed-in person's own invites, matched on their account's email address. Returns answered
 * ones as well as outstanding ones: the app shows pending invites as action cards and the rest as
 * a history of what they replied, so filtering to pending here would leave that history empty.
 */
app.get("/api/me/invites", async (request, response) => {
  if (!request.user) return response.status(401).json({ error: "unauthenticated" });
  if (!db) return response.json({ invites: [] });
  if (!request.user.email) return response.json({ invites: [] });

  const rows = await db
    .select({
      id: schema.sessionInvites.id,
      sessionCode: schema.sessionInvites.sessionCode,
      status: schema.sessionInvites.status,
      title: schema.sessionInvites.title,
      message: schema.sessionInvites.message,
      eventAt: schema.sessionInvites.eventAt,
      inviteRole: schema.sessionInvites.inviteRole,
      roomCode: schema.sessionInvites.roomCode,
      createdAt: schema.sessionInvites.createdAt,
      respondedAt: schema.sessionInvites.respondedAt
    })
    .from(schema.sessionInvites)
    .where(eq(schema.sessionInvites.email, normalizeEmail(request.user.email)))
    .orderBy(desc(schema.sessionInvites.createdAt));

  return response.json({
    invites: rows.map((r) => ({
      id: r.id,
      sessionId: r.sessionCode,
      title: r.title,
      message: r.message,
      status: r.status as "pending" | "accepted" | "declined",
      eventAt: r.eventAt,
      inviteRole: r.inviteRole as "attendee" | "presenter",
      roomCode: r.roomCode,
      createdAt: r.createdAt,
      respondedAt: r.respondedAt
    }))
  });
});

/** Accept or decline one of your own invites. */
app.post("/api/me/invites/respond", async (request, response) => {
  if (!request.user) return response.status(401).json({ error: "unauthenticated" });
  if (!db) return response.status(503).json({ error: "Invites require Postgres persistence (DATABASE_URL not set)" });
  if (!request.user.email) return response.status(400).json({ error: "This account has no email address to match an invite against" });

  const parsed = z
    .object({ inviteId: z.number().int().positive(), response: z.enum(["accepted", "declined"]) })
    .safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ error: parsed.error.flatten() });

  // Scoped by the caller's own email as well as the id, so an invite id can't be used to answer
  // on someone else's behalf.
  const result = await db
    .update(schema.sessionInvites)
    .set({ status: parsed.data.response, respondedAt: new Date(), userId: request.user.id })
    .where(
      and(
        eq(schema.sessionInvites.id, parsed.data.inviteId),
        eq(schema.sessionInvites.email, normalizeEmail(request.user.email))
      )
    );

  const responded = result.count > 0;
  console.log(responded
    ? `📬 [INVITE] ${request.user.email} ${parsed.data.response} invite ${parsed.data.inviteId}`
    : `⚠️  [INVITE] ${request.user.email} tried to answer invite ${parsed.data.inviteId}, which isn't theirs`);

  if (!responded) return response.status(404).json({ error: "No invite found for this account" });
  return response.json({ ok: true, status: parsed.data.response });
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

// Presenter rejoin flow: a server-truth check for "do I already have a room open anywhere",
// so the Home screen can offer Rejoin/End instead of letting someone start a second room while
// an old one is still live. Authenticated only — there's no meaningful "my rooms" without a
// signed-in user to own them.
app.get("/api/me/active-rooms", (request, response) => {
  if (!request.user) return response.status(401).json({ error: "unauthenticated" });
  return response.json({ rooms: engine.myActiveRooms(request.user.id) });
});

app.post("/api/me/rooms/end", (request, response) => {
  if (!request.user) return response.status(401).json({ error: "unauthenticated" });
  const parsed = z.object({ sessionId: z.string().min(1), roomId: z.string().min(1) }).safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ error: parsed.error.flatten() });

  const ended = engine.endRoomIfOwner(parsed.data.sessionId, parsed.data.roomId, request.user.id);
  console.log(ended
    ? `🛑 [SELF-END] ${request.user.email || request.user.id} ended their room '${parsed.data.roomId}'`
    : `⚠️  [SELF-END] ${request.user.email || request.user.id} tried to end '${parsed.data.roomId}' but doesn't own it`);

  return response.json({ ok: true, ended });
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
