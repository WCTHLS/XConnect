# Scheduler design (proposed, not yet implemented)

How an admin schedules a future event, invites specific people to it, and how those
people get notified and join. This is a design document, not a description of shipped
code — nothing in this file exists in `apps/api` or `apps/mobile` yet. It exists to record
the decisions made before implementation starts.

## Why

Today, joining a room requires already knowing its session code (and, for presenters, its
room code) at the moment you want to join — there's no way to announce a future event or
notify people it's starting. The scheduler adds that: an admin picks a date/time and a list
of people, the invited people get a real push notification when it's time, and tapping it
takes them straight into joining.

## Model

Two roles need different things to join, because of how room identity already works
(see [ADMIN_ARCHITECTURE.md](ADMIN_ARCHITECTURE.md)):

- **Presenters** anchor a room — they need both a **room code** and a **session code**,
  since joining as a presenter is what mints or resumes a room occurrence
  (`apps/api/src/inference.ts`'s `resolveRoom()`).
- **Attendees** never pick a room. Their room is inferred entirely from proximity signals
  (BLE/Wi-Fi/ultrasonic) matched against whichever room a presenter in that session is
  broadcasting from (`detectedRoom` in `apps/mobile/App.tsx`). They only need the
  **session code** — a room code on an attendee invite is meaningless and can be ignored.

This means a presenter invite and an attendee invite carry slightly different data, even
though they're both invitations to the same event.

### New tables

- **`scheduled_events`** — id, room code (used for presenter invites), session label,
  scheduled start time, created-by admin, created-at.
- **`event_invitees`** — event id, email, role (`presenter` | `attendee`), resolved
  `userId` once that email has an account, notified-at timestamp.
- **`push_tokens`** — userId, token, platform, updated-at. A person can have more than one
  device registered.

Invitees are keyed by **email**, not by account id. This is deliberate: it means an invite
is valid before the person has ever signed in, it survives an eventual identity-provider
migration (see "Azure migration" below) without any data migration, and it's consistent
with how the rest of the account system already treats email as the durable identifier for
a person (`apps/api/src/auth.ts`'s `resolveUser`, `preferredName`).

## Notification delivery

Real push notifications, not just an in-app list. Delivery goes through **Expo's push
service** (`expo-notifications`) rather than integrating Firebase Cloud Messaging and
Apple Push Notification service directly — Expo issues one push token per device and
relays it through FCM/APNs on the app's behalf, which avoids a lot of native plumbing
(service account keys, APNs certificates, a separate iOS push capability) that direct
integration would need. This also matters practically: iOS has no native project generated
yet in this repo at all, so a path that doesn't require hand-configuring APNs directly is
the only realistic option right now.

Adding `expo-notifications` means a **native rebuild**, not a JS-only bundle push — the
module has native code, so it needs a real prebuild/gradle sync.

### A known reliability gap

Render's free web service spins down after roughly 15 minutes of inactivity. Sending a
notification "at the scheduled time" requires something checking the database for due
events on a timer, and if nothing is otherwise hitting the server, that timer stops right
along with everything else — a notification could arrive late (whenever the next request
happens to wake the service) or be missed if the gap is large enough. Options, in
increasing order of reliability and cost:

1. Accept it for the POC — notifications may be delayed, not exact.
2. Add a free external uptime ping (e.g. UptimeRobot hitting `/health` every 10 minutes)
   to keep the service warm. Cheap, not bulletproof.
3. Move to a paid always-on Render plan.

This has not been decided yet and should be before the scheduler is relied on for
anything time-sensitive.

## Flow

1. Admin opens a "Schedule event" screen: room code, session label, date/time, and a list
   of invitee emails with a role (presenter/attendee) assigned to each.
2. `POST /api/admin/events` creates the `scheduled_events` row and its `event_invitees`
   rows.
3. A server-side timer checks for events crossing their scheduled start time, looks up each
   invitee's registered `push_tokens`, and sends a push via Expo's API. Each invitee is
   marked notified once sent.
4. Tapping the notification deep-links into the app. What it pre-fills now differs by role,
   because attendees lost the ability to type a session code manually (`apps/mobile/App.tsx`
   — the Session Code field is now a picker built from `GET /api/sessions/active`, gated so
   a code can only be selected once it's actually live):
   - **Presenter**: still pre-fills the room code and session code directly — the presenter
     field stays free-text, so this part of the original design is unchanged.
   - **Attendee**: does *not* pre-fill or auto-select a session code. Given the deployment
     model has one admin/session active at a time, the notification instead just opens the
     attendee screen and lets the existing chip picker take over — with realistically at
     most one chip to tap, this is effectively as fast as a pre-fill would have been, without
     the risk of pointing at a code that isn't selectable yet.
5. This shifts a timing requirement onto step 3: if the push still fires at the *scheduled*
   time rather than when the presenter's room actually goes live, an attendee tapping it
   early can land on "No active sessions right now" and have to wait for the existing 5s
   poll to populate the chip. Firing the attendee push only once the room is confirmed live
   (rather than at the scheduled clock time) avoids that gap; this needs to be decided
   before implementation (see "Not yet decided" below).
6. A device registers its push token once, right after sign-in
   (`POST /api/push/register`), since invites are matched by account/email.

## Azure migration compatibility

This design does not need special handling for the eventual move to Entra External ID
(see the auth discussion in earlier design notes), because of two choices already made
above:

- **Invitees are keyed by email, not by provider id.** A provider swap changes what id a
  person has, not their email, so invites keep resolving correctly across a migration with
  no data migration needed.
- **Push tokens re-register on every sign-in**, tied to whatever `userId` is current at
  that moment. After a migration, a person's old id goes stale, but their very next sign-in
  under the new provider re-registers their push token automatically — no orphaned-token
  cleanup required.

The server's auth layer already supports more than one verifier side by side (the current
Firebase + Microsoft dual setup in `apps/api/src/auth.ts` is exactly this pattern), so
adding or retiring a verifier for Entra External ID follows the same shape already built.
The scheduler/push code only ever reads `request.user.id` / `request.user.email` — it does
not need to change when the verifier list changes.

The one real gap: an invitee who has never created an account under the current provider
has no `userId` to resolve to, so they can't receive a push until they sign up. This isn't
something to fix — it's the natural consequence of inviting someone who doesn't have an
account yet, and it resolves itself the moment they first sign in.

## Not yet decided

- Exact UI for the admin's "Schedule event" screen.
- Whether an invitee who hasn't signed in gets any fallback (e.g. an email) beyond a push
  notification they can't yet receive.
- Which of the three Render reliability options above to take.
- Whether scheduled events that pass without anyone starting the room need any cleanup or
  admin-facing "missed" indicator.
- Whether the attendee push fires at the scheduled clock time or waits for the presenter's
  room to actually go live (see step 5 above) — affects whether "notified" in
  `event_invitees` means "sent" or "sent and joinable."
