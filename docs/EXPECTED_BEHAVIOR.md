# Expected behavior — a tester's reference

Written for: anyone manually testing this app who isn't already deep in the codebase. This
is not a step-by-step test script (see [TEST_PLAN.md](TEST_PLAN.md) for the sensor-accuracy
protocol) — it's a reference for **what's correct** when you hit something that looks odd,
so you can tell "that's a bug" from "that's the design, working as intended." A lot of this
app's behavior involves timing windows that look like bugs until you know the number behind
them.

## Sign-in

- Google, Microsoft, and email/password sign-in are all independently optional — if a button
  is missing, that provider just isn't configured on this build, not a bug.
- Signing up with email/password requires a matching **confirm password** field — mismatched
  passwords block submission with "Passwords don't match," not a server round-trip.
- A password field's **Show/Hide** toggle affects both the password and confirm-password
  fields together, not independently.
- Microsoft sign-in opens a browser page ("Trying to sign you in…") that should return to the
  app automatically within a few seconds. If it hangs indefinitely:
  - Expected if you're running the app via **Expo Go** — Microsoft sign-in only works in a
    real dev-client/release build (see [AUTH_IMPLEMENTATION.md](AUTH_IMPLEMENTATION.md)).
  - Otherwise, likely an org-account restriction (conditional access / admin consent) on
    that specific Microsoft account, not an app bug.
- A `401` from the API while signed in should sign the user out automatically and return
  them to the login screen — not show a raw error.

## Role selection (Attendee / Presenter / Admin)

- **Attendee**: the session code field is a **picker of currently-active sessions**, not
  free text. Selecting a code is only possible once a presenter has actually started sharing
  under it — an empty list showing "No active sessions right now" is correct if no presenter
  is live yet, not a fetch failure.
- The Share Presence switch is **disabled** for an attendee until a valid active session is
  selected — this is intentional, not a frozen UI.
- **Presenter**: session code and room code (Anchor Room ID) are both free text/picker as
  before — presenters are what create rooms, so there's nothing to select from yet.

## Presenter conflict (two devices claiming the same room)

- If a second device tries to start presenting into a room that already has a live
  presenter, it should be rejected with an alert: **"Room already has a presenter (Name)"**
  — and its Share Presence switch should snap back **off**. It should **not** continue
  advertising over BLE/ultrasonic, and should **not** show up as a second "Host" in anyone's
  in-room participant list. If a rejected device does keep broadcasting or shows as a second
  host, that's a bug.
- The admin's Live view should only ever show the one real presenter for that room — never
  the rejected one.

## Timing windows — the numbers that explain a lot of "weird" behavior

These are independent windows, not one shared timeout. Knowing which one applies avoids a
lot of false-alarm bug reports:

| Window | Length | What it governs |
|---|---|---|
| Rejoin prompt offer | 45s | After a presenter force-closes and reopens the app, "Resume presenting?" is only offered if reopened within 45s of the app closing. Past that, no prompt — just start sharing again normally. |
| Presenter "still live" / conflict check | 60s | How long a presenter is still considered active enough to (a) block a second presenter from claiming the room, and (b) count as their own room's member. A presenter idle 60s+ can be taken over by someone else. |
| Device record purge | 90s | A device with no activity for 90s is dropped from server memory entirely — distinct from the 60s conflict window above. |
| Room reuse window | 15 min | A room code reused within 15 minutes of its last activity resumes the *same* room occurrence (same history/duration). Reused after 15+ minutes of inactivity, it's treated as a brand-new, unrelated room occurrence — this is deliberate, so two unrelated presentations hours apart don't get merged into one record. |

**What this means in practice**: force-close and relaunch within ~45 seconds → you'll be
offered "Resume presenting?". Relaunch after 45 seconds but before someone else claims the
room → you can just start sharing again and it picks the same room back up seamlessly (no
prompt needed, but no conflict either). Relaunch after someone else has claimed the room in
the meantime → you'll get the "Room already has a presenter" rejection above, correctly.

## Admin — Live tab

- Rooms are grouped by session, each session group showing an **"End All"** button and each
  room showing its own **"End"** button — no separate popup/modal, these act directly on
  what's on screen.
- A room with **zero current members but a presenter who's gone stale** still shows up in
  this list (not hidden), tagged **"⚠️ Presenter offline"** — this is intentional so the
  admin always has a way to close a room even if its presenter never comes back. If a room
  ever seems to vanish from the admin's view entirely while still shown as "active" to
  someone else, that's a bug — it should always be visible here first.
- Ending a room or a whole session updates the Live view immediately (optimistic), then the
  next poll reconciles with the server.

## Attendee proximity detection

- Attendee-side "confirmed in-room" status depends on **BLE peer sightings only** for
  establishing which cluster/room a device belongs to — Wi-Fi fingerprint data only refines
  confidence *within* an already-BLE-established cluster, it never creates a room
  association by itself. **0 BLE Peers on both devices → attendee will never show as
  in-room, regardless of Wi-Fi AP count.** This is a hardware/environment condition (BLE not
  discovering peers), not necessarily an app bug — check BLE permissions and that both
  devices actually have Bluetooth on and are physically close enough first.
- An attendee stuck on "Searching…" after the presenter force-closes and rejoins should
  resolve on its own within a few seconds once BLE peers are actually detected. If it never
  resolves despite BLE Peers > 0 on both devices, that's worth reporting as a bug.

## Server-down / offline behavior

- If the API is unreachable, the app should keep running locally (BLE/scanning continues)
  and retry — it should not crash or hard-lock the UI.
- If the server restarts (e.g. a free-tier host waking from idle, or a real crash), any room
  that was live *before* the restart is marked ended on the server's next startup — clients
  self-heal by silently starting a fresh room occurrence on their next sync, rather than
  requiring a manual restart of the app.

## Known limitations (not bugs, don't file these)

- BLE-only clustering means a device with no nearby BLE peers can never be detected as
  "in-room," no matter how strong its Wi-Fi signal match is.
- A server crash loses any *currently open* (not-yet-closed) room membership record — there
  is no way to recover exactly how long someone was in a room across a crash. Only fully
  closed stays are ever persisted.
- The scheduler / push-notification feature described in
  [SCHEDULER_DESIGN.md](SCHEDULER_DESIGN.md) is not implemented yet — there is no
  "invite people to a future event" flow to test.
