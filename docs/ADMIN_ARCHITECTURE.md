# Admin architecture

How the admin layer works: session identity, live room inference, Postgres persistence,
history/PDF export, and deployment. Covers `apps/api/src/inference.ts`, `apps/api/src/index.ts`,
`apps/api/src/db/schema.ts`, and `apps/mobile/src/screens/AdminScreen.tsx`.

## Model

XConnect is built for one admin running one event with several rooms, not a multi-tenant
system — there is no per-organizer account system, and a session ID is a convenience for
grouping an event's data, not a security boundary between different admins' devices.

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

## Session identity: code vs. occurrence

A presenter types a short, reusable string — a **code**, e.g. `poc-session-1`. Reusing that
code on a different day must not silently merge two unrelated events' data, so identity is
split into two layers:

| Term | Looks like | Meaning |
|---|---|---|
| `code` | `poc-session-1` | What a human types. Not unique — identifies a recurring event name. |
| `sessionId` | `poc-session-1__mu4qm03v` | Auto-generated per real occurrence: `` `${safeCode}__${now.toString(36)}` ``. Every downstream row is keyed by this. |

`activeSessionsByCode` (an in-memory `Map<code, {sessionId, lastActivityAt}>`) tracks which
occurrence a code currently resolves to. Two entry points touch it:

| Function | Called from | Behavior |
|---|---|---|
| `resolveSessionCode()` | `POST /api/session/join`, `POST /api/observations` | Mints a new `sessionId` if none is active for that code (or the old one went quiet), else bumps `lastActivityAt` and reuses it. Only participating devices reach this. |
| `peekActiveSession()` | `GET /api/admin/overview`, `GET /api/rooms*` | Read-only. Returns the active `sessionId` or `undefined` — never mints. Fixes a bug where opening the admin Live tab could start a phantom session. |

Lifecycle:

1. **First join** — no entry for the code, so a fresh `sessionId` is minted and a `sessions`
   row is fire-and-forget inserted with that code attached.
2. **Reuse** — same code, still within `SESSION_AUTO_EXPIRY_MS` (8 hours) of last activity,
   returns the same occurrence.
3. **Auto-expiry** — survives a lunch break, but forces a fresh occurrence by the next day
   even if nobody explicitly ended it.
4. **Explicit end** — `POST /api/admin/session/end` calls `endSession()`, which removes the
   code from the map and stamps `ended_at` immediately.
5. **Restart cleanup** — `activeSessionsByCode` is wiped by any server restart. Startup runs
   `UPDATE sessions SET ended_at = now() WHERE ended_at IS NULL` so nothing is left looking
   permanently "active" in History.

**Why this mattered:** the code-carrying insert from `resolveSessionCode()` and a redundant
code-less upsert from `join()` were once two independent fire-and-forget writes to the same
row — whichever's `ON CONFLICT DO NOTHING` landed first on the pooled connection won,
sometimes permanently shadowing the code. Fixed with a `pendingSessionCreation` map that
other writers await before their own insert.

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
| `sessions` | one row per occurrence | on first join for a code; `ended_at` set on explicit end, auto-expiry, or server restart |
| `rooms` | one row per room per session | alongside the session row |
| `devices` | one row per device, ever | identity/liveness only, never heartbeat data |
| `room_membership` | one row per closed stay | when a stay ends: grace-period trim, an explicit presenter `leave()`, or session end |
| `state_change_events` | one row per meaningful transition | a boolean flag flipping (`connected`, `ultrasonic_verified`, `motion_anomaly_flag`), never a per-poll snapshot |

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
| `GET /api/admin/sessions?code=` | "What occurrences exist for this code (or all codes)?" — a search list with room names, hosts, attendee count, and total duration per occurrence. |
| `GET /api/admin/history?sessionId=` | "Who was in which room, for how long, during this one occurrence?" — the full room-by-room, member-by-member breakdown behind a selected list entry. |

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

- **Live** — polls `/api/admin/overview` every 5s, rendering each active room's roster with
  role badges, confidence, and the ultrasonic-verified / motion-anomaly flags.
- **History** — search by code (blank = everything), select an occurrence, expand a room to
  see aggregated per-attendee totals, download the PDF, or end an ongoing session via
  `POST /api/admin/session/end`.

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
