# Admin architecture

How the admin layer works: room identity, live room inference, Postgres persistence,
history/PDF export, and deployment. Covers `apps/api/src/inference.ts`, `apps/api/src/index.ts`,
`apps/api/src/db/schema.ts`, and `apps/mobile/src/screens/AdminScreen.tsx`.

## Model

XConnect is built for one admin running one event with several rooms, not a multi-tenant
system — there is no per-organizer account system, and a session label is a convenience for
grouping an event's rooms, not a security boundary between different admins' devices. The room
occurrence is the primary entity.

Three pieces do the work:

- **Mobile app** — presenters and attendees report BLE peers, Wi-Fi APs, motion, and
  ultrasonic tokens every 10s. The Admin screen polls for the results.
- **`PocInferenceEngine`** — an in-memory graph engine (Express API) that turns raw signals
  into "who is in which room, with what confidence" on every request.
- **Postgres** — durable record of sessions, rooms, devices, and closed room stays, written
  fire-and-forget, never on the hot read path.

The engine is the source of truth for *live* state; Postgres is the source of truth for
*past* state. The admin screen's Live and History tabs are reads against two different
systems, not two views of the same table.

## Room identity: name vs. occurrence

A presenter types a short, reusable **room name**, e.g. `room-a`. Reusing that name on a
different day, or under a different session label, must not merge two unrelated rooms' data, so
identity is split into two layers:

| Term | Looks like | Meaning |
|---|---|---|
| `code` | `room-a` | What a human types. Not unique. |
| `rooms.id` | `room-a__mu4qm03v` | Auto-generated per real occurrence: `` `${safeCode}__${now.toString(36)}` ``. Every membership and state-change row points at this. |

A **session label** (`sessions.id`, the string typed into the app's session field) is only a
grouping label for rooms. It is not part of any room's identity, has no lifecycle of its own,
and `rooms.session_id` is a nullable foreign key to it.

`activeRoomsByKey` (an in-memory `Map<"label::roomName", {roomId, lastActivityAt}>`) tracks which
occurrence a room name currently resolves to. `resolveRoom()` is the only place that mints one,
and only presenters (join/ingest) and membership tracking reach it. Read-only views (the admin
Live tab, `GET /api/rooms*`) never create rooms.

Lifecycle:

1. **First presenter join** for a label and room name mints a new `rooms.id` and fire-and-forget
   inserts the `sessions` label row (if new) and the `rooms` row.
2. **Reuse** — the same label and name within `ROOM_AUTO_EXPIRY_MS` (8 hours) of last activity
   resolves to the same occurrence.
3. **Auto-expiry** — survives a lunch break, forces a fresh occurrence by the next day.
4. **Presenter leaves** — `leave()` ends that room's occurrence: open stays are closed at once
   and `rooms.ended_at` is stamped.
5. **Admin ends a session** — `POST /api/admin/session/end` calls `endSession(label)`, which ends
   every active room under that label.
6. **Restart cleanup** — the active-room map is wiped by any server restart. Startup runs
   `UPDATE rooms SET ended_at = now() WHERE ended_at IS NULL` so nothing looks permanently active.

Two rooms with the same name in different sessions are therefore two separate occurrences, with
separate presenters, rosters, and history. Live inference also scopes presenters by session label,
so they can no longer show up as one room with two hosts.

Room rows are created by one fire-and-forget write, tracked in `pendingRoomCreation`. Writers that
reference the room by foreign key (membership rows, state-change events) await it first, since on
a pooled connection their insert could otherwise reach Postgres before the room row exists.

## Sign-in and users

Two providers run **side by side**, each enabled by its own settings. A token is routed to
whichever one issued it, so both are equally valid:

- **Firebase Auth** — email/password and Google. The app has its own sign-in screen and talks to
  Firebase's REST API directly. Google uses `expo-auth-session` (PKCE) against Google, then trades
  the result for a Firebase session.
- **Microsoft** — an ordinary Entra ID app registration (account types: any organizational
  directory *and* personal Microsoft accounts), reached straight from the app with
  `expo-auth-session`, not through Firebase. Firebase refuses manually supplied Microsoft
  credentials because it cannot verify their audience, and its own Microsoft handshake would
  require the native Firebase SDK.

Either way the tokens are kept in secure storage and sent as `Authorization: Bearer ...` on every
call (`authFetch` in `apps/mobile/src/services/auth.ts`). A session records which provider signed
it in, since that decides how it is refreshed.

`apps/api/src/auth.ts` builds one verifier per configured provider, picks the one whose issuer
matches the token, checks the signature and audience against that provider's published keys, then
upserts the person into `users` (name, email) at most every 5 minutes. `request.user` is then
available to the routes.

| Setting | Where | Meaning |
|---|---|---|
| `FIREBASE_PROJECT_ID` | API env | Firebase project ID; turns on Firebase token checking |
| `AUTH_AUTHORITY` | API env | `https://login.microsoftonline.com/common/v2.0` for work and personal Microsoft accounts |
| `AUTH_AUDIENCE` | API env | The Microsoft app registration's Application (client) ID |
| `ADMIN_EMAILS` | API env | Comma-separated emails that become admins on first sign-in |
| `FIREBASE_API_KEY`, `GOOGLE_ANDROID_CLIENT_ID` | `apps/mobile/src/config/authConfig.ts` | Firebase web API key and the Android OAuth client; empty hides email and Google |
| `AUTH_AUTHORITY`, `AUTH_CLIENT_ID` | `apps/mobile/src/config/authConfig.ts` | Same authority and client ID as the API; empty hides the Microsoft button |

- With neither provider configured the API is open and the app has no login, the same "unset means
  POC mode" switch as `DATABASE_URL`.
- A multi-tenant Microsoft authority advertises a literal `{tenantid}` template as its issuer, and
  each token carries its signer's own tenant GUID, so the issuer is matched by shape. A
  single-tenant authority (Entra External ID) advertises its real issuer and is compared exactly,
  which is what the eventual move to Azure will use.
- Microsoft's `sub` is per-application, so the stable `oid` claim identifies the person instead.
- Running two providers means one person who signs in with Google one day and Microsoft the next
  is two rows in `users`. Accepted deliberately; it disappears once everything moves to Entra.
- `/api/admin/*` requires an admin. The Admin screen asks `GET /api/me` and shows "not an admin"
  instead of the PIN when sign-in is on.
- A person's name comes from their account, never from whatever the app sends. They can override
  it with `PATCH /api/me { preferredName }`, stored as `users.preferred_name`, which wins wherever
  a name is shown (live roster, History, the PDF). Blank clears it. The provider's own name stays
  in `users.display_name`, refreshed from every token, so the real account is always recoverable.
  This works the same for email, Google and Microsoft accounts, which matters because a provider's
  name often can't be changed from here at all.
- `room_membership.user_id` ties each stay to a person. History groups by person, so several
  leaves and joins, or a new phone, add up as one attendee. Overlapping stays are merged so time
  is not counted twice. Older rows without a user fall back to the device.
- The same person joining as presenter from a new device replaces their old presenter device, and
  is never blocked by their own stale one.
- Bluetooth and ultrasonic identifiers stay anonymous per-device tokens; only the server links
  them to a person.

## Live monitoring: how a room's roster is computed

Every poll re-derives the room from scratch out of a 30-second sliding window of recent
BLE/Wi-Fi/ultrasonic reports — there is no stored "roster," only signals in, membership out.

1. **Cluster** — a BLE proximity graph is built from recent peer sightings; the connected
   component containing the room's presenter is that room's candidate member set.
2. **Presenter exclusion** — any device with `role === "presenter"` is unconditionally
   skipped when building a *different* room's roster. Fixed after two co-located presenters
   bled into each other's rosters (their own affinity check, built for attendees,
   degenerated into comparing a presenter to itself).
3. **Multi-room affinity** — for attendees near more than one active presenter, hop-distance
   and Wi-Fi cosine similarity combine into an affinity score per candidate room; the
   attendee is assigned to whichever wins by more than a 0.15 margin.
4. **Ultrasonic hard gate** — if the attendee's heard acoustic token matches the presenter's
   emitted one within the last 45s, confidence jumps to 0.98–0.99 regardless of radio
   signal strength.

| Signal | Role |
|---|---|
| BLE mesh | Who can hear whom — the graph's edges. |
| Wi-Fi fingerprint | Cosine similarity of nearby AP RSSI; tie-breaks which room a borderline attendee belongs to. |
| Ultrasonic token | 18.5–19.5kHz FSK handshake; hearing the exact room token is near-proof of co-location. |
| Motion variance | Flags inactivity when a device is still for ≥90% of its recent windows — a phone left on a desk, not a person. |

Every call to `roomState()` also calls `trackRoomMembership()`, which measures how long a
device has been continuously present — this is the one place live computation touches
persistence.

## Persistence model

Nothing on the hot read path (`roomState()`, `/api/admin/overview`) ever awaits the
database — every write is `.catch(console.error)`'d and fired without blocking. If
`DATABASE_URL` is unset, the engine still works, purely in-memory.

| Table | Grain | Written when |
|---|---|---|
| `sessions` | one row per session label | grouping label only, created with its first room |
| `rooms` | one row per room occurrence (primary entity) | on a presenter's first join; `ended_at` set on presenter leave, session end, or server restart |
| `devices` | one row per device, ever | identity/liveness only, never heartbeat data |
| `room_membership` | one row per closed stay, FK to `rooms.id` | when a stay ends: grace-period trim, an explicit presenter `leave()`, or session end |
| `state_change_events` | one row per meaningful transition, FK to `rooms.id` | a boolean flag flipping (`connected`, `ultrasonic_verified`, `motion_anomaly_flag`), never a per-poll snapshot |

Two ways a stay closes:

- **Passive** — `trim()` runs on every `ingest()` call and reaps any membership whose
  `lastSeenAt` is older than `ROOM_MEMBERSHIP_GRACE_MS` (45s): a normal disconnect or app
  backgrounding.
- **Immediate** — when a presenter explicitly leaves, `endRoom(roomId)` closes every open
  stay in that room right away (presenter and every attendee) instead of waiting 45 seconds.
  The mobile app confirms this with the user before letting them flip the sharing switch
  off, since it closes the room for everyone else too.

```ts
// apps/api/src/inference.ts
leave(deviceId) {
  const device = this.devices.get(deviceId);
  if (device?.role === "presenter" && device.roomId) {
    this.endRoom(device.roomId); // close every stay in the room now
  }
  this.devices.delete(deviceId);
  ...
}
```

## History, duration, and the PDF report

Two endpoints back the History tab, answering different questions:

| Route | Answers |
|---|---|
| `GET /api/admin/sessions?code=` | "Which room occurrences exist (optionally under this session label)?" — one entry per room occurrence, with host, attendee count, and total duration. |
| `GET /api/admin/history?roomId=` | "Who was in this room, for how long?" — the member-by-member breakdown for one room occurrence (`sessionId=` is accepted as an alias). |

### Real occupied time, not a naive span

Duration is never `latest end − earliest start` — that would count a gap where a presenter
left and came back later as if the room were occupied the whole time. Instead, every stay's
`[start, end]` interval is sorted and merged, and only the merged, actually-occupied ranges
are summed. The same algorithm runs in two places on purpose: server-side for the occurrence
list's total, client-side for a single room's summary card.

```ts
// merge overlapping/adjacent intervals, sum only the merged ranges
for (i = 1; i < sorted.length; i++) {
  if (iv.start <= curEnd) curEnd = Math.max(curEnd, iv.end);
  else { total += curEnd - curStart; curStart = iv.start; curEnd = iv.end; }
}
total += curEnd - curStart;
```

### PDF export

The "Download PDF" button in a selected occurrence's detail view builds a self-contained
HTML report from the already-loaded `HistoryDetail` — the same per-attendee aggregation the
on-screen list uses, so the two can't drift apart — then hands it to `expo-print`'s
`printToFileAsync()` and shares the result via `expo-sharing`'s native share sheet.

## The admin screen itself

A 4-digit PIN gate sits in front of everything (local-only, not a real auth boundary), then
two tabs:

- **Live** — polls `/api/admin/overview` every 5s. Deliberately unscoped: it shows every active
  room across **all** session codes, not just the one the admin's own app is set to, so each card
  names its session. Rendering covers each room's roster with
  role badges, confidence, and the ultrasonic-verified / motion-anomaly flags.
- **History** — search by session label (blank = everything), select a room occurrence, expand it to
  see aggregated per-attendee totals, download the PDF. Ending a session from the admin screen
  ends every active room under its label via `POST /api/admin/session/end`.

Both tabs read two structurally different things through the same UI shell: Live is a
window into `PocInferenceEngine`'s live memory; History is a query against Postgres. There
is no code path where one falls back to the other.

## Known limitations

**Ultrasonic badge reflects the last poll, not "ever verified" for a stay.**
`room_membership.ultrasonic_verified` is whatever the value was on the last poll before a
stay closed, not whether it was ever true during that stay. An intermittent acoustic gate
can close on a "false" poll and lose the badge in History even though it was true minutes
earlier.

**Custom room names can't be verified acoustically.**
The ultrasonic broadcast only carries 4 M-FSK symbols (12 bits): one for a preset-family
prefix code, one checksum, leaving two symbols for room-specific characters — enough for
`room-a` → `RM-A`, not enough for an arbitrary custom room name, which falls into a lossy
generic bucket the decoder can't reconstruct. The server compares against the full, un-lossy
uploaded token, so custom rooms structurally can't pass the hard gate today.

## Deployment

The root `Dockerfile` only copies `packages/shared` and `apps/api` — the mobile app is never
part of the server image, so mobile-only changes redeploy the API unchanged.

| Piece | Where |
|---|---|
| API (Docker, Express) | Render Web Service, tracks a branch, auto-deploys on push |
| Postgres | Render-managed instance, connected via `DATABASE_URL` (internal URL for the service, external URL for running migrations from a laptop) |
| Local dev | Docker Postgres on `localhost:5432`, same schema, same `drizzle-kit migrate` flow |

Because persistence is entirely gated on whether `DATABASE_URL` is set, pointing the same
code at local Docker vs. a managed Render instance is a config change, never a code change.
