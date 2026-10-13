# Load test results: backend scaling work (October 2026)

Full numbers behind the `backend/scaling` branch's work, for reference. See `docs/LOAD_TESTING.md`
for how to run the harness that produced these. All runs use the harness's defaults (3s live poll,
10s batch upload, 10s ramp-up) unless noted.

## Summary

Five real changes, each proven with before/after numbers:

1. **Moved graph and room-state computation from per-request to a 2-second tick.** The single
   biggest fix — turned a ~60% failure rate at 500 devices into zero errors.
2. **Fixed a mass-leave scaling bug** (batch cleanup scanned the entire shared list per leave;
   now grouped by device, O(1) per leave).
3. **Added four database indexes** on previously-unindexed, unbounded-growth tables.
4. **Raised the Postgres connection pool 5 → 20**, configurable via `DB_POOL_MAX`.
5. **Added Redis-backed durability**: the engine checkpoints which rooms are active and who's in
   them every tick, so a server restart resumes a live session instead of silently losing it.
   Verified against both a real device session and an automated 500-device restart mid-test —
   see section 6 below.

All five are proven clean on local hardware at the realistic target scale (500 devices across 5
rooms). The same code was also proven clean on Render's actual free-tier infrastructure at 50
devices — the first confirmation outside a laptop. Pushing further on Render surfaced a separate
finding that is **not a code problem**: a platform-level request-rate limit, covered in its own
section below.

**Update (October 7-8, 2026): first tests on dedicated cloud hardware, with the load generator
and server on separate machines.** On a 2 vCPU Azure VM with Azure Postgres and Redis, one room
holds up to 700 devices for a sustained 6 minutes and falls over somewhere between 700 and 800
(section 7). Redis restart survival is confirmed against a real managed Postgres. A new
`loadtest-realistic.ts` harness (section 8) adds churn, returning attendees, presenter step-outs
and varied sensor data. At 700 devices with heavy churn it ran with zero errors and correct
attendance records, and it surfaced one product behavior worth knowing about: a presenter silent
for over a minute splits everyone's stay in that room.

**Update (October 9, 2026): the backend now also runs on Azure Container Apps** (section 9). With the
load generator in the same Azure region, 1 vCPU / 2 GiB handles 700 devices with heavy churn and
800 devices across 5 rooms with zero errors outside a deliberate outage. A restart with Redis keeps
every room as one occurrence. Measurements taken from a laptop over HTTPS were wrong by about 100x
and should not be used (section 9). The admin screens on the phone were also the slow part at
800+ devices, not the server (section 10).

**Update (October 12, 2026): the payload fix is verified.** After slimming the attendee poll, limiting
the full roster to hosts and admins and gzipping responses, the same one-hour, 700-device, single-room
test ran with p99 288 ms (was 3,188 ms), a flat 0.41 to 0.47 core of CPU (was climbing to the 1.0 limit)
and about 1.6 GB sent out (was 288.5 GB). Details at the end of section 12.

**Update (October 11, 2026): Postgres on a Burstable B1ms server, and the first hour-long test.**
A new B1ms server (1 vCore, 32 GiB, created from the Bicep file) matches the B2s on latency and
never spent any CPU credits, even through an hour at 700 devices (section 11). The hour-long test
also showed that the container's 1 vCPU is not enough for 700 devices in a single room over time:
CPU climbed from about 0.8 core to its 1.0 limit and latency collapsed (p99 3.2s, max 145s) with
no errors. The 5-minute runs in section 9 did not show this, so "1 vCPU is fine" there only holds
for short runs (section 12). The same hour sent 288.5 GB of data out of the API, because each
attendee poll returns the whole room including a growing list of people who left, which is the
leading explanation for the slowdown and a large hidden cost (section 12).

---

## 1. Per-request to per-tick (local)

**500 devices, 5 rooms, local machine, in-memory (no DB), auth off:**

| | Before | After |
|---|---|---|
| Errors | ~5,600 / ~9,000 requests (~60%) | **0** |
| `poll_device` p99 | 15,000-30,000ms | **156ms** |
| `batch` p99 | similar range | **314ms** |
| Tick duration | n/a (recomputed per request) | ~130-170ms, against a 2000ms budget |

Root cause: `buildBleGraph()` and every room's membership were recomputed from scratch on every
single poll — cost scaled with total device count, not per-request. Fix moved that computation
onto a periodic tick; polls now read a cached snapshot. Full detail in `inference.ts`'s own
comments on `tick()`.

A secondary fix landed in the same pass: the per-member room-affinity check was running a fresh
breadth-first search per member per presenter (thousands of full graph traversals per tick at
real room sizes). Replaced with one shared hop-distance map per presenter, computed once per
tick and read by every member in O(1). Also swapped `Array.shift()` for a read-index in both BFS
implementations (`engine/graph.ts`), since `shift()` re-indexes the whole remaining queue on
every call.

## 2. Mass-leave scaling bug (local)

Found pushing the above scenario to 1000 devices: ending a session means every device calling
`leave()` within a few seconds, and the per-device batch cleanup scanned the *entire* shared
batch list (thousands of entries) for every single leave.

**1000 devices, mass leave at test end:**

| | Before | After |
|---|---|---|
| `leave` errors | 986 / 1000 (99%) | ~522 / 1000 (roughly halved) |

Fix: grouped `batches` by device (`Map<deviceId, PresenceBatch[]>` instead of one flat array), so
a leave is one `Map.delete()` instead of a full scan. Also made the existing 30-second time-based
pruning cheaper as a side effect, since it now prunes each device's own small array instead of
shifting one shared array with everyone's entries in it.

Side benefit at the already-healthy 500-device scale:

| | Before | After |
|---|---|---|
| `leave` p50 | 697ms | **139ms** |
| `leave` p99 | 732ms | **424ms** |

**1000 devices is still not fully clean** — a different, separate, already-scoped cost
(`buildBleGraph` itself taking up to ~1 second during brief spikes at that device count) remains.
Not something this round of fixes targeted.

## 3. Database indexes (local)

The schema had zero indexes across twelve prior migrations. Added four, based on the actual query
patterns in `backend/src/index.ts`, not guesswork:

| Table | Column | Why |
|---|---|---|
| `room_membership` | `room_id` | Admin room-detail view filters on this constantly; grows forever |
| `room_membership` | `user_id` | `/api/me/stats` and `/api/me/room-history` |
| `state_change_events` | `room_id` | Admin room-detail timeline; grows forever |
| `session_invites` | `email` | `/api/me/invites` — not covered by the existing `(session_code, email)` unique constraint's index, since that only helps queries with `session_code` as a leading predicate |

Verified by generating the migration (`backend/drizzle/0012_tough_thunderball.sql`), reviewing
the SQL, applying it against local Postgres, and confirming via `\di` that all four landed.

## 4. Connection pool 5 → 20 (local)

**500 devices, 5 rooms, local machine, Postgres persistence on:**

| | pool=5 | pool=20 |
|---|---|---|
| `batch` p99 | 921ms | **493ms** |
| `poll_device` p99 | 936ms | **510ms** |
| `leave` p50 | 415ms | **206ms** |
| Errors | 0 | 0 |

Clean win at the realistic target scale, no downside. Confirmed 20 stays well within Render's
free-tier Postgres connection limit (100 total on an under-8GB instance, ~90 usable after
Postgres's own reserved slots).

**An unresolved, narrower finding surfaced while testing this:** 500 devices concentrated into a
*single* room (vs. spread across 5), with persistence on, shows a real regression that device
count alone doesn't explain:

| | 5 rooms, DB on | 1 room, DB on (pool=5) | 1 room, DB on (pool=20) |
|---|---|---|---|
| Total errors | 8 | 628 | 689 (different shape — latencies much better, but new `leave` errors appeared) |

Working theory was connection-pool contention scaling with concentration, but that doesn't fully
hold up (raising the pool helped latency a lot but didn't fix the error count, and introduced a
new failure mode in `leave` that wasn't there before). At 1000 devices in one room, the picture
got noisier still — a DB-off run showed *more* errors than a DB-on run, which is backwards from
what "the database adds overhead" would predict, pointing to this scale being generally
overloaded enough that run-to-run noise (OS scheduling, GC pauses, three processes — generator,
server, Postgres — competing for one laptop's CPU) swamps any clean per-factor signal.

**Status: parked, not root-caused.** The realistic scenario (multiple rooms, matching how an
actual event is structured) is clean regardless, so this was deliberately deprioritized rather
than chased further locally. It resurfaced in a related but distinct form during Render testing —
see below.

---

## 5. Render free-tier testing (new — first non-local validation)

All of the above was measured on a laptop. This is the first time any of it was tested against
real, separate infrastructure. Two different things came out of it and they should **not** be
conflated: the server code itself checks out; Render's free tier has its own, unrelated ceiling.

Auth-on, against `https://xconnect-ytoj.onrender.com` (the `backend/scaling` branch deployed
there for this test), using a real Firebase ID token via `--token`.

| Devices | Rooms | Result |
|---|---|---|
| 50 | 5 | **Clean.** Zero errors. Most endpoints p50 ~100ms, p99 under 400ms. (`join` p99 2740ms and `admin_overview`'s one slow sample are explained below, not errors.) |
| 200 | 1 | Zero errors, but badly degraded: p99 latencies 7-9 seconds across `batch`/`poll_device`/`leave`/`poll_room`. |
| 500 | 1 | **399/500 `leave` failures** — 390 are HTTP `429`, 9 are `503`. `batch`/`poll_device` p99 ~27-29s, max up to 28,772ms. |
| 500 | 2 | 404/500 `leave` failures (401 `429`, 3 `503`) — essentially the same as 1 room. Max latency hit 53,453ms. |
| 500 | 5 | **Worse**, not better: 500/500 `leave` failures (100%, all `429`), plus new errors appeared in `batch` (146) and `poll_device` (219) that weren't present in the 1-room or 2-room runs at the same device count. |

**The 50-device run is a real milestone**: first proof that today's fixes hold up outside a
laptop, not just locally.

**The 200+ device runs reveal something different from the local "room concentration" finding
above, and the two should be kept separate:**

- Locally, room concentration mattered — 500-in-5-rooms was clean, 500-in-1-room wasn't.
- On Render, room concentration **does not matter** — 1, 2, and 5 rooms all failed at 500
  devices in essentially the same way (same ballpark of `leave` failures, all `429`s). If
  anything, more rooms made it slightly worse.
- The error codes themselves point at the real cause: `429 Too Many Requests` is not something
  any code in this repo returns — there is no rate-limiting middleware in `index.ts`. This is
  Render's own platform-level throttling on the free tier, triggered by total request volume,
  independent of how that volume is organized into rooms.

**Practical implication:** this is a wall the application code cannot optimize past. Everything
in sections 1-4 improved how efficiently the server itself processes load, and that's proven —
locally up to 500+ devices, and on Render at 50. But Render's free tier imposes an external cap
somewhere between 50 and 200 devices that has nothing to do with server efficiency. No amount of
further code-level work changes a platform-enforced `429`.

**Where Render's actual ceiling sits is not yet narrowed down** — only that it's clean at 50 and
broken at 200. Pinning it down further (and validating the full 500-1000 device target at all)
needs either continued local testing (already done, see above) or a Render tier without this
rate limit — further free-tier runs at 200+ devices would just keep re-confirming the same
external limit rather than reveal anything new.

---

## 6. Redis durability (Phase 3, local)

Until this point, every fix was about throughput — keeping the server responsive under load.
This one is about a different failure mode entirely: a crash or restart losing track of who was
actually in a room, since that state lived only in process memory. The engine now checkpoints
which room occurrence is current (`activeRoomsByKey`) and who's actively in it, including the
running confidence mean (`roomMembership`), to Redis every tick — and restores both at boot,
before the orphaned-room Postgres sweep runs, so that sweep only closes rooms Redis doesn't know
about rather than everything indiscriminately.

**Two real performance bugs surfaced by load testing this, both fixed before calling it done:**

- `clearRoomEndedNotice` fired a Redis `DEL` unconditionally on every single `join()` and
  `leave()` call, even though the overwhelming majority have no notice to clear. Fixed by gating
  it on actually having one. This alone is the kind of per-request cost (rather than per-tick)
  the rest of this project has been eliminating elsewhere.
- Ending a room (`endRoomOccurrence`) fired one individual Redis `SET` per device in it — up to
  a full room's worth, synchronously inside one request handler. At 500 devices across 5 rooms,
  this measurably inflated `leave` latency (p50 848ms vs. 579ms once fixed). Fixed by batching
  every device's notice into one Redis pipeline call instead of N round trips.

After both fixes, 500 devices across 5 rooms with Redis enabled is statistically indistinguishable
from Redis disabled — same machine, same moment, back-to-back runs:

| | Redis off | Redis on (after both fixes) |
|---|---|---|
| `leave` p50 | 726ms | 579ms |
| `batch` p99 | 318ms | 217ms |
| `poll_device` p99 | 296ms | 293ms |

(Redis came out slightly ahead in these particular runs — the point isn't that Redis is faster,
it's that it adds no measurable cost once the two bugs above are fixed. Run-to-run variance on a
single laptop easily covers differences this size.)

**A third bug, found testing restart-survival against a real device session, not synthetic
load**: two leftover local test server processes from earlier testing were still running in the
background, both checkpointing to the *same* Redis keys as the real session (the checkpoint used
fixed, un-namespaced key names). Whichever process's tick fired last won, silently overwriting
the other's state — so a restart's restore could read stale/empty data and wrongly treat a live
room as an orphan, closing it. This is almost certainly what caused the real session's room to
cycle through five separate occurrences (16–104 second lifespans each) during manual testing.
**Not a flaw in the restore logic** — confirmed by watching the real checkpoint data correctly
reflect a live two-device session right up until the collision. Fixed by namespacing every
checkpoint key by the server's own port, so two backend processes can never share keys even by
accident.

**Verified clean after the fix, two ways:**

1. **Real device session.** A tablet presenting and a phone attending in the same room, server
   restarted mid-session: same room occurrence (`ended_at` stayed `NULL`), same membership,
   devices kept streaming sensor data with no visible interruption.
2. **Automated load test**, 500 devices in 1 room, server restarted ~30 seconds into the run:

   | | |
   |---|---|
   | Total errors | 686 (532 `poll_device`, 153 `batch`, 1 `poll_room`) |
   | When they happened | All in the single window the server was actually down restarting — zero accumulated afterward |
   | Room continuity | One unbroken Postgres row for the full 70-second test (confirmed via `started_at`/`ended_at`), not split into two occurrences |

   The errors are the honest cost of a restart — the server really was briefly unreachable — not
   evidence of lost state. Every other endpoint's latency stayed clean (p99 under 300–600ms).

**A separate, smaller fix landed alongside this**: Node's default `keepAliveTimeout` (5s) was
shorter than the client's 10s batch-upload cadence, forcing a fresh TCP handshake on every batch
call. Raised to 65s. Real and worth keeping, but testing showed it wasn't the dominant cause of
1000-device errors (see Open items below) — TIME_WAIT counts went up, not down, after the fix,
and the error shape didn't meaningfully change.

**1000 devices with the full stack (Redis + Postgres) still shows real errors** — but the
mechanism has changed since the original finding. Zero `[tick] slow:` warnings appeared during
these runs, meaning the engine's own per-tick computation is not the bottleneck here, unlike the
original diagnosis. Instrumented with live sampling of Postgres connections (flat at the pool's
max of 21 — not exhausted), established TCP connections on the server's port (wildly oscillating,
0 to 4,600+, within 2-second windows), and process CPU (climbing smoothly, no spikes). That
combination — smooth CPU, erratic connection counts — points at the single Node process's request
handling falling behind the real request rate (~450-500 req/s at 1000 devices) and connections
piling up in the OS accept queue, not a specific remaining code defect. See Open items.

---

## 7. Azure VM testing: generator and server on separate machines (October 7-8, 2026)

Every earlier local number had the load generator, server, Postgres and Redis competing for one
laptop's CPU. This round put the server on its own cloud machine, which removes that
self-competition for the first time.

**Setup:**

| Piece | Where |
|---|---|
| Backend | Azure VM, East US, 2 vCPU / 4 GiB general-purpose D-series (sized to match the company staging VM's `D2alds_v6`), Ubuntu 24.04, Node 20, run with `pnpm dev`, auth off |
| Redis | Docker on the same VM (`redis:7-alpine`, bound to loopback) |
| Postgres | Azure Database for PostgreSQL Flexible Server, Burstable B2s, Postgres 18, Canada Central. A different region from the VM (East US wasn't available on the trial subscription), so every DB call crosses regions |
| Load generator | The laptop, in the US, hitting the VM's public IP over the internet |

The roughly 57ms floor on every endpoint at low load is network round-trip time from the laptop
to East US, not server work. Absolute latencies here are therefore not comparable to the local
numbers above, only to each other.

**Results with `loadtest.ts` (everyone joins once and stays to the end):**

| Devices | Rooms | Duration | Errors | Notes |
|---|---|---|---|---|
| 100 | 5 | 30s | 0 | p50 ~57ms everywhere (pure network floor), p99 under 190ms |
| 500 | 1 | 30s | 0 | p50 57-221ms, p99 156-413ms, max 735ms |
| 600 | 1 | 150s | 0 | p50 120-307ms (`leave` highest), p99 197-573ms, max 2,292ms |
| 700 | 1 | 350s | 5 (all `batch`) | Held for nearly 6 minutes. p50 ~205-215ms (`leave` 304ms), p99 1.1-1.4s, max 5,143ms. Errors were isolated blips, never climbing |
| 800 | 1 | 150s | 1,315 | Clean for ~70-80s, then errors jumped 24 to 1,158 in one 10s interval, then plateaued. p50 ~304-344ms, one `poll_device` took 54,514ms |
| 1000 | 1 | 150s | 497 (302 `batch`, 195 `poll_device`) | Errors climbing from ~30s in, a sharper jump around 100-110s. p50 632-837ms, p99 1.6-3.9s, one `poll_device` took 44,994ms |
| 1000 | 5 | 150s | 30,718 | Clean for ~70s (23,413 ok, 0 failed), then collapsed within 10-20s (failed rose by ~4,000 every 10s while ok barely moved), then partially recovered. All network errors |

**What this shows:**

- **The single-room limit on this VM is between 700 and 800 devices.** 700 held for 350 seconds;
  800 collapsed partway through a 150-second run.
- **It looks like a load threshold, not something accumulating over time.** If memory, sockets or
  connections were slowly building up, a 6-minute run at 700 should have shown errors creeping
  upward. They stayed flat at a handful. Past the threshold the server suddenly can't keep up and
  the backlog snowballs, which matches the clean-then-collapse shape at 800 and 1000.
- **1000 devices across 5 rooms was far worse than 1000 in one room** (about 30,700 errors vs.
  about 500). That is the opposite of what room-size-driven inference cost would predict, and is
  not explained yet. The collapse shape (clean, sudden mass failure, partial recovery) fits a
  finite resource running out rather than computation gradually falling behind.
- **No `[tick] slow:` warnings were found in the server log** around the collapses, so the
  engine's per-tick computation is again ruled out, consistent with section 6.
- **Postgres active connections peaked at 28** during the 1000-device, 5-room collapse (Azure
  portal metric), against a per-process pool of 20. Not a runaway connection storm. Postgres's
  own `max_connections` on this tier and the VM's CPU/memory during the collapse were not checked.
- **Headroom shrinks well before the limit.** Median latency went ~57ms (100 devices) to ~120ms
  (600) to ~210ms (700), with p99 over a second at 700.

**Restart survival, verified against Azure Postgres.** 600 devices in 1 room, server killed and
restarted with `pnpm dev` partway through the run. The client saw a burst of roughly 1,300
errors around the restart (the server really was down). In Postgres, the room
(`loadtest-room-1__muz17pll`) is one row from 04:23:55 to 04:26:33 UTC covering the whole test,
and each device's `room_membership` row is one continuous span through the restart. The Redis
restore picked the room back up instead of the boot sweep closing it, the same result as the
local test in section 6, now on real managed infrastructure.

Note: the server prints no dedicated "restored from Redis" line. `🧷 Redis checkpointing enabled`
prints on every boot, and the only restart-related line (`🧹 Closed N room(s) left open from before
this restart`) is for rooms Redis did *not* know about. Silence is the success case. The
database rows are the real evidence.

## 8. Realistic-behavior harness: `loadtest-realistic.ts`

`loadtest.ts` stays as the fixed baseline so its numbers remain comparable. The new
`backend/src/loadtest-realistic.ts` models how a real room behaves (usage in `docs/LOAD_TESTING.md`):

- BLE peer counts (30-100% of the room) and Wi-Fi AP visibility vary per batch, with occasional
  Wi-Fi dropout.
- Each device has a motion profile (sedentary / active / mixed) driving `motionState` and
  `motionVariance`.
- Every batch emits the room's ultrasonic token; it is only *heard* about 75% of the time.
- Attendee churn (`--churn`, departures per room per minute). 40% of departures (`--return-rate`)
  come back on the same device after 5-75s, half going quiet with no leave call and half leaving
  explicitly first. The rest are replaced by a new attendee.
- Each room's presenter steps out once (goes quiet for 5-75s, no leave call) and rejoins the same
  room on the same device.
- End-of-test leaves are spread over up to 8s instead of all at once.

**Two things learned while building it:**

1. **A presenter's explicit `leave` ends the room** (`inference.ts`, `leave()`): every attendee's
   stay closes and the next join starts a new room occurrence. An early version of the harness
   modeled a step-out as leave-then-rejoin and split every room in two. A real step-out (phone
   locked, app backgrounded, signal lost) sends nothing, so the harness now goes quiet instead.
2. **The first churn implementation applied the rate per attendee rather than per room**, giving
   625 replacements in a 60-second, 300-device run instead of about 12. Fixed before any of the
   numbers below.

**Results:**

| Where | Devices / rooms / duration | Churn | Errors | Notes |
|---|---|---|---|---|
| Local | 300 / 5 / 150s | 6 | 0 | 45 replaced, 11 returned after going quiet, 7 after leaving, 5 presenter rejoins |
| Azure VM | 600 / 1 / 150s | 6 | 4 (3 `poll_device`, 1 `batch`) | p50 ~100ms, p99 under 500ms; two ~19s outliers near the end |
| Azure VM | 700 / 1 / 350s | 50 | **0** of ~102,000 | 161 replaced, 47 returned after going quiet, 51 after leaving, 1 presenter rejoin. 960 joins, 912 leaves |

Compared with the baseline 700-device run in section 7 (no churn):

| | Baseline, 700 / 1 room | Realistic, 700 / 1 room, churn 50 |
|---|---|---|
| Errors | 5 | 0 |
| p50, most endpoints | ~205-215ms | ~136-164ms |
| p99, most endpoints | 1.1-1.4s | 2.1-3.2s |
| `leave` p50 | 304ms | 61ms |

The median improves because at any moment some attendees are away or between replacements, and
because departures are spread out. The tail roughly doubles because of the constant
join/leave/stay-closing work. **The baseline's slow `leave` was mostly an artifact of every device
leaving in the same instant**; with realistic staggered departures it is about 60ms.

**Attendance correctness, checked directly in Postgres after each run:**

| Run | Room occurrences | Presenter | Attendees | Open stays |
|---|---|---|---|---|
| Local 300 / 5 rooms | 1 per room | 1 stay each | 273 with 1 stay, 51 with 2, 1 with 3 | 0 |
| VM 600 / 1 room | 1 | 1 stay | 597 with 1 stay, 5 with 2 | 0 |
| VM 700 / 1 room, churn 50 | 1 | 1 stay | 791 with 1 stay, 54 with 2 | 0 |

- Replacements are new devices with their own single stay. A replacement that joins too late to
  send a sensor batch gets no stay at all, which is correct: stays only open from sensor data.
- An attendee who leaves explicitly and returns gets a second stay in the same occurrence.
- An attendee who goes quiet keeps one stay for somewhat longer than the 45s membership grace,
  because their last batches keep placing them in the room for a while, so only long silences
  split.

**Finding: a presenter silent for more than about a minute splits every attendee's stay.** In the
local run, room 4's presenter sent nothing for over a minute. 46 of its 67 attendees had their
stays closed at the same moment and reopened together 50 seconds later when the presenter came
back. The room itself survived as one occurrence. Mechanism:

1. A presenter only counts as active if heard from in the last 60s (`WINDOW_MS * 2`,
   `inference.ts` `tick()`).
2. Attendees are only placed into a room through an active presenter (`resolveDeviceRooms`), even
   though their own BLE and Wi-Fi data still place them together.
3. After the 45s grace, every unplaced attendee's stay closes (`trim()`).

Impact: the attendee is not double-counted. Admin history groups the two stays under one person,
and `/api/me/stats` counts one session. The gap itself is lost from their attendance time, and
they briefly appear in the room's "Left" list. **Decision: accepted as-is for now**, not changed.

**Finding: an abandoned room is never marked as ended.** A room with no activity for 15 minutes
(`ROOM_AUTO_EXPIRY_MS`) is skipped in memory, but nothing writes its `ended_at`, and the Redis
checkpoint carries it across restarts, so the boot sweep doesn't close it either. It stays "open"
in the database and in admin history indefinitely. Surfaced when a test run was stopped partway
(the simulated devices never sent leave). Workaround for load testing: after an aborted run, call
`POST /api/admin/session/end` with `{"sessionId":"loadtest-session"}` against the running server.
Production equivalent: a presenter's phone dying with nobody ending the room.

---

## 9. Azure Container Apps (October 9, 2026)

The backend was deployed to Azure Container Apps on the personal trial, built from the repo's
existing `Dockerfile`, to compare against the VM in section 7 and to test restart behavior with Redis.

**Setup** (all in `infra/main.bicep`, deployed in two passes because the app can't start before its
image is in the registry; secrets live in a gitignored `infra/main.local.bicepparam`):

| Piece | Detail |
|---|---|
| Container registry | Basic tier, name generated per resource group (a clean name would claim a global Azure name the company deployment may want) |
| Environment + log workspace | 30-day log retention |
| API app | Exactly 1 replica (min = max = 1), external HTTPS ingress to port 3000, `DATABASE_URL` as a secret |
| Redis | A second, separate container app (`redis:7-alpine`, 0.5 vCPU, 1 GiB, 1 replica) with internal-only TCP ingress. Separate on purpose: a Redis inside the API app would be replaced by every deploy or restart, at the moment the API needs it |
| Postgres | The existing Canada Central server, opened to Azure services with a firewall rule (a Consumption-plan app has no fixed outbound IP) |

CPU and memory must follow Azure's fixed pairs, memory = 2 GiB per vCPU (1 / 2, 2 / 4, 4 / 8).
Rooms and the 2s tick live in one process's memory, so the app must stay at exactly one copy.

**Measuring from the laptop gave wrong answers.** The same container, same flags (700 devices, 1
room), measured from two places:

| `poll_device` | From the laptop (HTTPS) | From the VM, same Azure region |
|---|---|---|
| Typical | 2,100 ms | **16 ms** |
| p90 | 8,400 ms | 123 ms |
| Requests completed in 300s | about 55,000 | about 90,000 (full demand) |

The container's CPU never passed about 0.5 core in either configuration, while the laptop's
`node.exe` sat at 50-60% of the whole machine doing HTTPS for 700 simulated devices. The server
was fine and the generator was the limit. **Run load tests from a machine in the same region as
the server.** Numbers in this section other than that comparison were measured from the VM.

**Results from the VM** (`loadtest-realistic.ts`, zero errors in all of these):

| Size | Devices / rooms / duration | Churn per room per min | `poll_device` typical / p90 / p99 / max |
|---|---|---|---|
| 2 vCPU / 4 GiB | 700 / 1 / 300s | 20 | 16 / 123 / 3,592 / 5,166 ms |
| **1 vCPU / 2 GiB** | 700 / 1 / 300s | 50 | 22 / 205 / 393 / 884 ms |
| **1 vCPU / 2 GiB, Redis on, one rolling restart mid-run** | 700 / 5 / 300s | 50 | 5 / 54 / 444 / 665 ms |
| 1 vCPU / 2 GiB, Redis on, one hard stop (~40s) mid-run | 800 / 5 / 300s | 50 | 8 / 100 / 844 / 24,055 ms (the max is a request caught in the outage) |

The extra core did not help (one Node process), and the 3-5 second tail seen once at 2 vCPU did
not repeat at 1 vCPU. That tail may have been a one-off. Estimated CPU at 700 devices is roughly
0.8 core at full demand, so 1 vCPU is workable but not roomy.

**Restart survival with Redis, two cases, both checked in Postgres:**

| | Rolling restart (`revision restart`) | Hard stop then start (`revision deactivate` / `activate`) |
|---|---|---|
| What Azure did | Started the new replica at 04:15:47 and stopped the old one at 04:15:52, so the two ran side by side for about 5s | Nothing served for about 40s |
| Failed requests | **0** | 4,310 (4,270 `404`, 40 `503`), all inside the outage, none after |
| Room occurrences | 1 per room (5 rooms) | 1 per room (5 rooms) |
| Stays left open | 0 | 0 |
| Stays closed together | 299 | 257 |
| Where | Rooms 4 and 5 (about 125 each), rooms 1-3 (11-22 each) | Room 5 (144), rooms 1-4 (23-34 each) |
| Reopened later | 216 of 299, median gap 1m20s, max 2m36s | 160 of 257, median gap 1m46s, min 50s, max 3m06s |

**What the restart actually costs:**

- **Rooms always survive.** The Redis restore did its job in every case.
- **Most attendees are unaffected.** Roughly 540 of the 800 kept one unbroken stay through a 40s
  outage, because it is shorter than the 45s membership grace.
- **A subset get a split stay.** A closed stay's `ended_at` is saved as its *last-seen* time, not
  the moment it was swept (`persistence.ts`, `persistClosedMembership`), so the many stays that
  share one closing second all share the last checkpoint time before the restart. Only the
  roomMembership and activeRooms maps are checkpointed, not the device records. After a restart a
  stay is only refreshed once its attendee is placed in a presenter's cluster again, which needs
  the presenter's next upload and fresh Bluetooth data from the attendees. If that takes longer
  than 45s the stay is swept, and the attendee gets a second stay when they are placed.
- **One or two rooms are hit much harder than the rest, both times.** Not explained. One candidate
  is a presenter's random step-out (75-180s into the run) landing near the restart, which would
  delay that room's placement. This has not been tested.
- **A rolling restart briefly runs two copies,** so the single-replica rule is not strict during a
  restart, and both copies write the same Redis keys for those seconds. No room split in this
  test, but it is the first thing to look at if one ever does.

Two deploy notes: the startup restore runs at boot, so if Redis is unreachable then, the process
exits and Container Apps restarts it until Redis is up. The startup probe shows one failed check
on every start (the server takes a few seconds to boot) and that is harmless.

## 10. Admin screens on the phone at 800+ devices

The admin Session History screen took about **21 seconds** to show attendees for an 846-attendee
room. Measured with timing logs on the device:

| Step | Time |
|---|---|
| Download (`/api/admin/history`, 296 KB) | 529 ms |
| JSON parse | 9 ms |
| Grouping attendees | about 18 ms |
| **Tap "Show attendees" until rows are drawn** | **21,098 ms** |

The server returns that endpoint in about 0.75s, and the history list endpoint in 0.43s, so the
slowness was drawing about 846 cards (about 25 views each) at once in a plain `ScrollView`. The
screen also re-rendered about 15 times after the tap, each time regrouping the data.

Fixes: history attendees are shown 50 at a time with a "Show more" button and grouped once per
opened room (`AdminHistoryScreen.tsx`), and the live admin room roster is a virtualized
`FlatList` (`AdminRoomDetailScreen.tsx`), which showed no visible lag at 700+ devices. The
presenter roster screen still uses a plain `ScrollView` and has the same problem. PDF export is
unchanged and still includes everyone.

(Update: the presenter roster was later moved to a virtualized `FlatList` as well, in
`PresenterRosterScreen.tsx`, and checked on a device.)

## 11. Postgres on a Burstable B1ms server (October 11, 2026)

Context: the earlier tests ran against a B2s server. The cost estimate
(`docs/DATABASE_COST_ESTIMATE.md`) recommends B1ms, so it was measured before relying on it.

**Setup.** `infra/main.bicep` now has `createPostgres`. With it on, the template creates the
server and a database named `xconnect`, builds the `DATABASE_URL` secret for the container app,
and opens the "allow Azure services" firewall rule.

| Setting | Value |
|---|---|
| Server | `xconnect-test-pg-b1ms-kk`, Burstable B1ms (1 vCore, 2 GiB), PostgreSQL 16 |
| Disk | 32 GiB, auto-grow off, 7-day backups (LRS) |
| Region | Canada Central (the trial subscription cannot create Postgres in East US) |
| Container app | East US, 1 vCPU / 2 GiB, one replica, Redis as a separate container app |

Things that went wrong or were not obvious while doing it:

- Creating the server in East US failed with `ParameterOutOfRange: The value of the 'Version'
  should be in: []`. An empty allowed list means the subscription cannot create Postgres in that
  region. Fixed with a separate `postgresLocation` parameter.
- Changing a Container Apps secret does not restart the running container. After the deploy the
  revision had to be restarted for the new `DATABASE_URL` to take effect.
- The migrations were applied from inside the container (`az containerapp exec`, then
  `cd /app/backend && pnpm exec drizzle-kit migrate`). Passing the command as one quoted string
  through PowerShell fails with an unterminated-quote error, so use an interactive shell. The
  app's startup tolerates an empty database: the orphaned-rooms sweep logs an error and the
  process keeps running.

**300-second run from the VM**, 700 devices, 5 rooms, churn 50 per room per minute (the same shape
as the B2s run in section 9, but without a restart):

| Endpoint | Count | Errors | p50 | p90 | p99 | max |
|---|---|---|---|---|---|---|
| `poll_device` | 61,961 | 0 | 7 | 53 | 420 | 699 |
| `batch` | 18,295 | 0 | 7 | 53 | 412 | 660 |
| `join` | 1,811 | 0 | 3 | 17 | 317 | 572 |
| `leave` | 1,589 | 0 | 4 | 20 | 232 | 638 |
| `poll_room` | 413 | 0 | 7 | 50 | 219 | 486 |
| `admin_overview` | 62 | 0 | 5 | 87 | 137 | 137 |

674 attendees were replaced, 432 returned and 5 presenters rejoined. Against the B2s 5-room run
(`poll_device` typical 5 / p90 54 / p99 444 / max 665 ms), B1ms is the same within noise. The
database being half the size made no visible difference.

**CPU and credits** (Azure metrics on the B1ms server). A Burstable server earns credits while
below its baseline (about 20% of one vCore on B1ms, 0.2 credits a minute) and spends them only
above it.

| Measure | Reading |
|---|---|
| Credits remaining at the start | 30 (a new server) |
| Credits remaining after the 1-hour test (section 12) | about 39 |
| Credits consumed | 0 throughout (the single reading of 1 was the create-and-migrate burst) |
| CPU percent, max | mostly 6 to 14%, one bump to about 20%, and about 34% at the end of the hour-long test (all devices leaving) |

Postgres CPU stayed flat while the API's latency got worse in section 12, which fits the problem
being in the API process and not the database. Per-database size from the Azure dashboard: the
empty migrated `xconnect` database was 8.33 MB (the other databases are about 8 MB each as well),
and 15.7 MB after both runs, so the two runs added about 7.4 MB for about 5,500 stays, or about
1.3 KB per stay including device rows and state-change events.

**Result.** B1ms is enough for the database at 700 devices, including a full hour. No credit
pressure appeared even from a 30-credit start.

## 12. One hour at 700 devices in a single room (October 11, 2026)

Run from the VM against the Container Apps API, `loadtest-realistic.ts --devices=700 --rooms=1
--duration=3600 --churn=50`, with 1 vCPU / 2 GiB and Redis on, started detached with `nohup`.

| Endpoint | Count | Errors | p50 | p90 | p99 | max |
|---|---|---|---|---|---|---|
| `poll_device` | 750,936 | 0 | 184 | 1,102 | 3,188 | 144,863 |
| `batch` | 229,469 | 0 | 182 | 1,087 | 2,904 | 144,141 |
| `join` | 3,668 | 0 | 114 | 1,043 | 2,891 | 74,205 |
| `leave` | 3,077 | 0 | 102 | 940 | 2,525 | 125,695 |
| `poll_room` | 1,113 | 0 | 196 | 1,093 | 3,020 | 54,238 |
| `admin_overview` | 650 | 0 | 183 | 1,064 | 3,157 | 94,936 |

1,765 attendees were replaced (about 3,000 expected at 50 a minute), 590 + 612 returned, and 1
presenter rejoin. About 989,000 requests completed, roughly 91% of the demand the generator
generates, so the generator slowed down as well.

Against the 5-minute run of the same shape (1 vCPU, 700 devices, 1 room, section 9: typical 22 / p90
205 / p99 393 / max 884 ms) every figure is much worse, with **zero errors**: nothing crashed or
restarted, requests just waited.

**Container metrics for the hour** (Azure Monitor, container app `xconnect-test`):

- **CPU usage** started at about 0.8 core and climbed steadily to **1.0 core (the limit) by about
  half an hour in**, where it stayed until the test ended. The earlier 5-room run of the same size
  used only about 0.4 core, so one 700-device room costs roughly twice as much CPU as the same
  devices spread over 5 rooms.
- **Memory working set** stayed flat at about 220 MB for the first half hour, then rose steadily to
  about 970 MB (of 2 GiB) before dropping to about 120 MB once the test stopped.

**Reading.**

- The slowdown is not the database. `poll_device`, `poll_room` and `admin_overview` are served
  from the in-memory snapshot (the live routes do no Postgres work), yet they are as slow as the
  endpoints that write. Equal slowdown on every endpoint means the Node process was behind, with
  its main thread at the CPU limit. B1ms's credits and CPU (section 11) were untouched.
- The generator waits for each reply before a device sends its next request, so a growing backlog
  of requests cannot account for the memory growth. It is in the server.
- **Correction to section 9:** "1 vCPU / 2 GiB is enough for 700 devices" held for runs of a few
  minutes. For an hour in one room it is not. Going to 2 vCPU would not help either: the 2 vCPU
  runs in section 9 gave no benefit because the busy part is one thread.

**Not yet explained.** Why the CPU cost per request rises over time at a constant load, and why
memory starts to grow after about 30 minutes. Candidates, none confirmed: state that grows as
attendees come and go (closed stays, replaced devices) and is re-scanned every tick, the Redis
checkpoint writing all of the engine's maps on every tick, or garbage collection falling behind
once the CPU is full.

**Outbound data, measured afterwards** (Azure Monitor, container app, metric Network Out Bytes,
Sum). The API sent **288.5 GB in the one-hour run**. The per-interval total (intervals look to be 5
minutes) rose from about 14 GB in the first full interval to about 31 GB at the end, with
demand roughly constant or falling:

- About 14 GB per 5 minutes at roughly 230 attendee polls a second is about **200 KB per poll**
  at the start, in line with a room of 700 members.
- By the end the same polls were more than twice as large, so **the response grows during the
  run**.
- The attendee poll (`GET /api/devices/:deviceId/live`, `deviceRoomState` in `inference.ts`) returns
  the entire room snapshot: every member, plus `leftMembers`. `leftMembers` is built from
  `recentlyLeftByRoom`, which only gains entries while a room is open (no cap, cleared only when the
  room ends), and it is re-sorted and re-serialized into every snapshot. With about 1,765
  replacements in the hour it kept growing.
- That fits the three symptoms above: CPU per request rising until the 1 vCPU limit, memory growth
  from larger responses, and every endpoint slowing together. It is the leading explanation, from
  reading the code and these numbers, and **not yet proven**: the fix below is also the test.
- Cost: the first 100 GB of outbound data a month is free, then roughly $0.09 per GB (check current
  pricing). Phones count as internet egress. Whether traffic from the VM generator in the same
  region was billed is not known, so this run is not a bill. At 16 event-hours a month with 500
  attendees the same design would be on the order of $150 to $200 a month, more than everything else
  in `docs/DATABASE_COST_ESTIMATE.md` combined.

**Redis during the same hour** (Azure Monitor, `xconnect-test-redis`, 0.5 vCPU / 1 GiB): CPU about
4 to 5.6 millicores (0.005 core) throughout, and a memory working set of about 3.4 MB at rest and a
peak of 4.3 MB. Redis was not a factor in the slowdown and is far larger than it needs to be. The
smallest Consumption size (0.25 vCPU / 0.5 GiB) would be enough. Not changed yet.

**Next steps.**

1. **Cut the payload** (agreed, not yet implemented): compress responses with the `compression`
   middleware, slim the attendee response to the device's own entry, the presenter's entry and a
   headcount (the attendee app reads `members` only for the in-room check, its own confidence, Wi-Fi
   and dwell time, and the host name), and return `leftMembers` only to presenters and admins (only
   the admin room screen reads it). Presenter and admin responses stay as they are. Then rerun this
   exact one-hour single-room test and compare CPU, p99 and Network Out against the numbers above.
2. Run the same hour at 700 devices across 5 rooms (about 0.4 core in the short run) to see whether
   the realistic shape stays stable.
3. If CPU still drifts after the payload is cut, add periodic server logging (event-loop delay, heap
   size, sizes of the engine's maps, time spent per checkpoint) and rerun the single-room test for
   about 40 minutes to see what grows.

### Result after the payload fix (October 12, 2026)

The fix from step 1 above was built (image `v2`, revision `0000005`) and the same one-hour test was
rerun: `loadtest-realistic.ts --devices=700 --rooms=1 --duration=3600 --churn=50` from the VM, 1 vCPU /
2 GiB, Redis on, sign-in off. What changed in the code:

- The attendee poll (`GET /api/devices/:deviceId/live`) is answered from a small per-room view built
  once per tick: the host, the attendee's own entry, and a new `memberCount`. No roster, no
  `leftMembers`, and no other person's email or UWB token. A local measurement with 287 members gave
  665 bytes, against about 80 KB for the full roster.
- `GET /api/rooms/:roomId/live` returns the full roster only to the room's host (the presenter device,
  and with sign-in on, the same account) or to an admin. Anyone else gets the host and a headcount.
- Responses over 1 KB are gzipped (`compression`, level 1). The host and admin responses shrink about
  9 times (82 KB to 9 KB for 287 members).

| `poll_device` | Before (October 11) | After (October 12) |
|---|---|---|
| Requests completed | 750,936 | 806,729 |
| Errors | 0 | 0 |
| p50 / p90 / p95 | 184 / 1,102 / 1,518 ms | **2 / 196 / 245 ms** |
| p99 | 3,188 ms | **288 ms** |
| max | 144,863 ms | **2,184 ms** |

The other endpoints improved the same way (p99 in ms, before to after): `batch` 2,904 to 294, `join`
2,891 to 284, `leave` 2,525 to 283, `poll_room` 3,020 to 459, `admin_overview` 3,157 to 444. 1,697
attendees were replaced, 593 + 594 returned and 1 presenter rejoined.

| Container metric for the hour | Before | After |
|---|---|---|
| CPU usage | climbed from 0.8 to 1.0 core (the limit) by about 30 minutes | **0.41 to 0.47 core, flat** |
| Memory working set | 220 MB rising to 970 MB | **about 215 to 221 MB, flat** |
| Network Out | **288.5 GB** for the hour, growing every interval | **about 1.6 GB** (about 27 MB per 5-minute interval, flat) |

- **The slowdown is gone and does not return over the hour.** p99 at the end of an hour (288 ms) is
  now lower than the 5-minute figure on the same setup (393 ms, section 9). That confirms the growing
  payload was the cause of the CPU climb, the memory growth and the latency collapse.
- **Outbound data fell about 180 times.** The first 100 GB a month is free, so at roughly 1.6 GB per
  event-hour an estimated 16 event-hours a month would send about 26 GB. The $150 to $200 a month
  estimated for the old payload does not apply.
- **About 96% of the polls the schedule asks for completed** (806,729 against about 839,000), up from
  about 89%.
- **A latency floor of about 200 ms that is not the network.** p50 is 2 ms while p90 to p99 sit at
  about 200 to 290 ms. That fits the 2-second tick blocking the process for about 200 ms each time, so
  requests arriving during it wait. This is a reading of the numbers, not measured (the tick's own
  duration was not logged), and it is not a problem at these values. It is where the next improvement
  would be.
- **Not covered:** the 5-room version of the hour, the host-or-admin rule for the room poll with sign-in
  on (the load test ran with sign-in off), and a restart during the hour.

---

## 13. A freshly built stack, and a restart on it (October 12-13, 2026)

The whole template was deployed into an empty resource group (`xconnect-scratch`) to prove it from
scratch, then load tested from the VM. Setup: Postgres B1ms (created by the template, Canada Central),
Redis as a separate container app, the API at 1 vCPU / 2 GiB in the existing Container Apps
environment (the free trial allows only one, so `existingEnvironmentId` was used), the image with the
payload fix, sign-in off. The Redis app was then resized to **0.25 vCPU / 0.5 GiB** (the smallest size)
while idle. Pass 1 (no environment, `deployApp=false`) and the app deploy, the migrations in the
container and the health checks all worked. The notification hub was created and its key reached the
app; a test send returned the hub's 400 "no target applications ... review the credentials", because
the Firebase credentials are not set by the template, which is expected.

**5 rooms, 700 devices, 300 s, churn 50, no restart.** Zero errors in about 105,000 requests.

| Endpoint | Count | p50 | p90 | p95 | p99 | max |
|---|---|---|---|---|---|---|
| `poll_device` | 62,365 | 2 | 7 | 75 | 143 | 282 |
| `batch` | 18,459 | 3 | 10 | 77 | 154 | 270 |
| `join` | 1,773 | 2 | 4 | 13 | 120 | 209 |
| `leave` | 1,576 | 2 | 5 | 31 | 124 | 236 |
| `poll_room` | 406 | 4 | 10 | 82 | 194 | 309 |
| `admin_overview` | 62 | 7 | 11 | 101 | 207 | 207 |

Against the same shape before the payload fix (section 11: `poll_device` 7 / 53 / 119 / 420 / 699 ms),
the tail is about three times lower.

**1 room, 700 devices, 300 s, churn 50, with a rolling restart about 165 s in**
(`az containerapp revision restart` on the API). Zero errors in about 90,000 requests.

| Endpoint | Count | p50 | p90 | p95 | p99 | max |
|---|---|---|---|---|---|---|
| `poll_device` | 68,031 | 2 | 158 | 209 | 270 | 356 |
| `batch` | 20,354 | 3 | 157 | 212 | 273 | 352 |
| `join` | 944 | 3 | 4 | 36 | 224 | 256 |
| `leave` | 910 | 3 | 7 | 79 | 212 | 277 |
| `poll_room` | 96 | 8 | 274 | 389 | 469 | 469 |
| `admin_overview` | 63 | 6 | 111 | 204 | 444 | 444 |

The platform log shows the new replica scheduled at 02:34:12 UTC, the image pulled in 5 s, the
container started at 02:34:37, and one startup-probe failure right after (the harmless one per start,
as in section 9). The restart left no visible mark on latency (max 356 ms).

**What the database shows afterwards** (queried from inside the container):

- **One occurrence of the room across the restart.** `loadtest-room-1` has two occurrences, but they
  are the two separate runs: one created 02:15:30 and ended 02:20:42 (the 5-room run), and one created
  02:31:27 and ended 02:36:35 (this run, with the restart at about 02:34:12 in the middle of it). The
  second has 900 stays that start from 02:31:27 to 02:36:31 with no break. The other four rooms have one
  occurrence each.
- **No stays left open** (`open_stays` 0 across all 2,566 stays and 2,112 devices).
- **19 stays closed together at 02:34:37**, the second the new container started, out of about 700
  attendees. Section 9 recorded 299 (rolling restart, 5 rooms, 800 devices) and 257 (hard stop). The
  room had about 850 distinct devices and 900 stays, so almost no stay was split.

Why the split is so much smaller is not established. Differences from section 9: one room instead of
five, 700 instead of 800 devices, this run's churn state at the moment of the restart, the payload fix,
and a different (0.25 vCPU) Redis. It is one run, so treat it as encouraging, not as a change in the
guarantee. The behavior documented in section 9 still stands: a restart can split some stays, and the
gap in a stay's record is the time before the attendee is placed again.

**Not yet tested on this stack:** a restart of the Redis app under load (it was only resized while
idle), a hard stop, and the one-hour 5-room run. (The Redis restart under load was run afterwards, see
below.)

### Redis restarted under load, then the API restarted (October 12-13, 2026)

Same stack, 5 rooms, 700 devices, 300 s, churn 50, from the VM. Two restarts were issued from a script
that waited for the rooms to fill: the **Redis app** about 85 s into the run (02:46:56 UTC, 613 members
in the rooms), then the **API** about 185 s in (02:48:37, 500 members). Redis has no persistence, so it
came back empty and the API refilled it on its next ticks.

| Endpoint | Count | Errors | p50 | p90 | p95 | p99 | max |
|---|---|---|---|---|---|---|---|
| `poll_device` | 62,200 | 0 | 2 | 15 | 91 | 174 | 342 |
| `batch` | 18,395 | 0 | 3 | 19 | 95 | 176 | 314 |
| `join` | 1,794 | 0 | 3 | 5 | 56 | 161 | 288 |
| `leave` | 1,578 | 0 | 2 | 8 | 79 | 172 | 272 |
| `poll_room` | 413 | 0 | 5 | 11 | 92 | 199 | 407 |
| `admin_overview` | 63 | 0 | 7 | 25 | 66 | 236 | 236 |

665 attendees were replaced, 424 returned and 5 presenters rejoined. **Zero failed requests through
both restarts**, and latencies as in the run without a restart (`poll_device` p99 143 ms there).

What the platform and API logs show (UTC, from the log workspace and system events):

- **Redis outage.** The new Redis replica was scheduled at 02:46:59, the image pulled at 02:47:28 and
  the container started at 02:47:36, so Redis was unreachable for about **40 seconds**. The running
  API logged no `[redis]` errors in that window, and the load test saw no failures: the request path
  does not wait on Redis.
- **API restart.** The new API replica was scheduled at 02:48:40 and its container started at 02:49:08.
  It then logged `[redis] connection error: ECONNREFUSED 100.100.240.116:6379` four times, hit
  `MaxRetriesPerRequestError`, and **exited with code 1** at 02:49:10. The platform restarted it at
  02:49:21 and the second start connected to Redis with no errors. Redis had been running for 90
  seconds at that point and nothing restarted it again, so why the new replica could not reach it is
  **not established** (a network path or address that had not settled after the Redis restart is a guess).
- **No effect on requests**, because in a rolling restart the old replica keeps serving until the new one
  is ready. The failed first start delayed readiness by roughly 15 to 40 seconds.

**Finding: the API cannot boot while Redis is unreachable.** `restoreFromRedis()` runs at startup and an
unreachable Redis ends the process, so the platform restarts it in a loop until Redis answers. This is
harmless in a rolling restart, but if the API restarts with no old replica serving (a crash, a hard stop,
or a platform event) while Redis is down or unreachable, the API stays down until Redis returns. Planned
change, not made: retry Redis at boot for about a minute, then start with empty state instead of exiting.

**Database view afterwards** (queried from inside the container, rooms created after 02:44 UTC):

- **One occurrence per room** for all five rooms: neither restart split a room.
- **0 open stays** out of 1,671 stays across 1,270 devices.
- **No burst of closed stays at either restart command.** Around the Redis restart (02:46:56) and the API
  restart (02:48:37) stays closed at the background churn rate, 5 to 11 per two seconds.
- **Three bursts well above that rate, broken down by room:**
  - **02:47:23, 128 stays: 126 in room 5.** One room, so a presenter step-out (a presenter silent for more
    than about a minute makes every attendee in that room unplaceable, section 8; this run had 5 presenter
    rejoins). It falls inside the Redis outage window, but one room is not what a Redis problem would do.
  - **02:47:51, 117 stays: 116 in room 3.** Same, one room.
  - **02:49:19, 58 stays across all five rooms** (20, 11, 10, 9 and 8). This is the **API restart**: it came
    about 40 s after the restart command and just before the second API start, and the stays share one
    closing time, the last checkpoint written before the old replica went (the mechanism in section 9). About
    12% of the roughly 500 members present were split, against 19 of 700 in the previous restart on this stack
    and 299 of about 800 in section 9. The size varies a lot between runs, so no trend is claimed.
  - The run's end (02:50:19 to 02:50:26, about 610 stays) is everyone leaving.
- **The Redis restart closed no stays.** The load test's quiet presenters, not the Redis outage, explain the two
  single-room bursts.

### One hour, 5 rooms, with a hard stop at 45 minutes (October 13, 2026)

Same stack and settings: `loadtest-realistic.ts --devices=700 --rooms=5 --duration=3600 --churn=50` from the
VM, API 1 vCPU / 2 GiB, Redis 0.25 vCPU / 0.5 GiB, Postgres B1ms, sign-in off. At T0 + 2700 s (03:47:19 UTC,
598 members in the rooms) the API revision was **deactivated**, left down for 30 s, and **activated**
(03:47:57). `/health` answered again at 03:48:31: **71 s after the deactivate, 28 s after the activate**.

| Endpoint | Count | Errors | p50 | p90 | p95 | p99 | max |
|---|---|---|---|---|---|---|---|
| `poll_device` | 730,873 | 7,005 | 2 | 22 | 86 | 156 | 30,450 |
| `batch` | 218,846 | 2,085 | 3 | 26 | 88 | 158 | 30,269 |
| `join` | 14,137 | 165 | 2 | 22 | 89 | 166 | 30,262 |
| `leave` | 11,491 | 137 | 2 | 20 | 85 | 156 | 30,283 |
| `poll_room` | 5,823 | 57 | 6 | 46 | 116 | 243 | 29,788 |
| `admin_overview` | 713 | 7 | 16 | 62 | 155 | 250 | 25,552 |

8,120 attendees were replaced, 2,641 + 2,671 returned and 5 presenters rejoined.

- **9,456 failed requests out of about 982,000 (about 1%)**, all HTTP 404 except one 503 on `join`. A 404 is
  what the ingress answers while no revision is active, so these are the outage, not the app. Section 9
  recorded 4,270 404 and 40 503 for a hard stop at 800 devices lasting about 40 s; here about 130 failures a
  second for about 70 s, the same rate scaled to the longer outage (which includes the deliberate 30 s wait).
- **The latency over the whole hour, outage and recovery included, stayed low** (`poll_device` p99 156 ms,
  against 143 to 174 ms in the 5-minute 5-room runs), so there was no drift and nothing lingering after the
  hard stop. The 30 s maxima are requests held at the ingress while no revision was active, until the
  client's 30 s limit.
- **Admin overview size.** At about 42 minutes the overview response was 1,565,232 bytes raw and 225,681
  bytes gzipped, mostly the Left lists (about 1,050 to 1,120 entries per room, across 5 rooms). One admin
  screen refreshing every 5 s is affordable (about 45 KB/s compressed) but the size grows with every
  attendee who leaves while a room is open, and the server rebuilds and serializes the lists each time.
  A cap or on-demand load for the Left list is the next candidate; not changed.

**The API's metrics for the hour** (Azure Monitor chart read by eye, so approximate):

| Measure | One room, one hour, after the payload fix (section 12) | 5 rooms, one hour, with the hard stop |
|---|---|---|
| CPU usage | 0.41 to 0.47 core, flat | **about 0.33 to 0.39 core, flat** |
| Memory working set | about 215 to 221 MB, flat | **about 195 to 200 MB, flat** |
| Network Out | about 1.6 GB | **about 28 to 35 MB per interval, about 1.7 GB for the hour** |

- At the hard stop (about 8:47 PM local) CPU, memory and traffic fall to zero for about a minute. CPU then
  returns to the **same plateau** (about 0.33 to 0.35 core) and memory to the same level, and both stay there
  until the test ends: the outage left no lasting effect and there was no drift in the last 14 minutes.
- Peaks of 0.49 core and 219 MB in the same chart belong to the earlier 1-room restart run, not to this hour.

**Database view afterwards** (queried from inside the container, rooms created after 03:00 UTC):

- **One occurrence per room** for all five rooms: the hard stop did not split any room, because the rooms
  came back from Redis.
- **0 open stays** out of 11,687 stays across 8,430 devices (2,300 to 2,440 stays and 1,640 to 1,760
  devices in each room).
- **613 stays closed together at 03:47:25**, the moment the revision was deactivated, against 598 members
  in the rooms when it was. That is essentially **every attendee**. The other seconds around it (03:47:00
  to 03:49:30) show 9 to 14, the background churn.
- The only other large bursts in the whole hour are the run's end (03:02 plus 3,600 s, 04:02:11 to :17, about
  590 stays, everyone leaving). **No presenter step-out bursts** this hour.
- **Why everyone, when earlier restarts split 3% to 37%:** a server keeps a stay open for 45 s of silence
  (`ROOM_MEMBERSHIP_GRACE_MS`). This outage lasted about 71 s, longer than that, so every stay was past its
  grace when the new replica started; all closed with the same last-seen time (the last checkpoint) and
  reopened as the devices reported again. The section 9 hard stop lasted about 40 s, shorter than the
  grace, and split about a third. So the share of split stays follows the outage length against the 45 s
  grace: shorter splits some, longer splits everyone. This is the documented behavior, not a new fault.

**Postgres B1ms and Redis during the hour** (Azure Monitor charts read by eye, so approximate):

- **Postgres (Burstable B1ms, started with the 30 starting credits).** CPU credits remaining rose from 30 to
  40 across the evening, through the hour and through the hard stop, and never fell. CPU credits consumed was
  about 0 (one reading of 1 from the create-and-migrate burst). CPU percent (Max) was about 7 to 26% during
  the hour (about 7 to 15% outside it), around B1ms's 20% baseline. The 54.8% in the legend is the one-off spike
  when the server was created and migrated, not the test. CPU was higher than in the one-room hour (6 to 14%
  on another B1ms) because this run wrote about 11,700 stays and replaced 8,120 attendees, about twice as
  many. No throttling.
- **Redis (0.25 vCPU / 0.5 GiB).** CPU about 4.3 to 5 millicores with a peak of 5.98 (about 2.4% of the
  0.25 core); memory about 3.3 to 4.3 MB (under 1% of 0.5 GiB). Flat through the hour and unaffected by the
  API's hard stop.

**Not yet tested on this stack:** a hard stop at one-room scale.

---

## Open items

- **The local single-room-concentration anomaly** (section 4) remains genuinely unexplained as a
  *mechanism*, but hasn't reproduced since — the section 6 restart test ran 500 devices in a
  single room with Redis + Postgres both on and saw zero errors outside the restart window
  itself. Deprioritized since the realistic multi-room scenario is clean either way, but noted
  again here since Render testing surfaced a superficially similar but mechanistically different
  problem (platform rate-limiting) at the same "concentrate load" angle — these are two separate
  issues if either gets picked back up.
- **1000 devices is still not fully clean locally, but the root cause has changed.** The original
  finding (section 1) traced it to `buildBleGraph` itself spiking past its tick budget — that
  specific mechanism no longer appears (zero `[tick] slow:` warnings in the section 6 runs, even
  at 1000 devices). What's left looks like single-process request-handling capacity: Postgres
  connections stayed flat at the pool max (not exhausted), CPU climbed smoothly, but established
  TCP connections oscillated wildly (0 to 4,600+) — consistent with the one Node process falling
  behind real request volume while competing with the load generator, Postgres, and Redis for the
  same cores, not a specific remaining code defect. Pinning this down further needs the generator
  and server split across separate machines, removing the self-competition — not something this
  laptop can rule in or out further. The already-scoped Phase 2 payload/algorithmic items (attendee
  payload slimming, ETags, batched device-upserts) may still help at the margin regardless.
- **Render's real ceiling, and whether it changes on a paid tier**, is unmeasured. The free tier's
  rate limit makes it unsuitable for validating the full 500-1000 device target as-is.
- **Update to the 1000-device item above (section 7):** splitting the generator and server onto
  separate machines did not make 1000 devices clean. On a 2 vCPU Azure VM the single-room limit is
  700-800, and the failure is a sudden collapse rather than gradual degradation. Still to check:
  the VM's CPU and memory during a collapse (Azure portal metrics), and Postgres's
  `max_connections` on the Burstable tier. A larger VM size is the quickest way to tell whether
  this is plain CPU capacity.
- **Why 1000 devices across 5 rooms collapsed far worse than 1000 in one room** (section 7) is
  unexplained.
- **Abandoned rooms are never marked as ended** (section 8). Small, real production bug; not fixed.
- **CPU and memory drift over an hour at 700 devices in one room** (section 12). The container
  reaches its 1 vCPU limit after about 30 minutes and latency collapses, with no errors. Leading
  explanation: the attendee poll returns the whole room snapshot including an ever-growing
  `leftMembers` list (288.5 GB sent in the hour, with the response more than doubling in size).
  Planned fix: compress responses, slim the attendee response, and send `leftMembers` only to
  presenters and admins. Not yet implemented or re-tested. The 5-room version of the hour-long test
  has not been run.
- **Outbound data cost** (section 12). At the current payload size egress would exceed the rest of
  the monthly bill. Re-measure Network Out after the payload fix before relying on any cost figure
  in `docs/DATABASE_COST_ESTIMATE.md`.
- **Update (October 12): the drift and outbound-data items above are resolved.** The payload fix was
  deployed and the same hour rerun (end of section 12): CPU and memory stayed flat and Network Out was
  about 1.6 GB instead of 288.5 GB. Still open from that work: the 5-room hour, checking the host-or-admin
  rule for the room poll with sign-in on, and the roughly 200 ms latency floor that looks like the tick
  blocking the process (not measured).
- **Redis app is oversized** (0.5 vCPU / 1 GiB against a 4.3 MB peak). Planned change to 0.25 vCPU /
  0.5 GiB, not made yet.
- **Redis container restart** has not been tested (only the API restart, section 9). The Redis app
  has no volume, so its contents are lost if it is restarted or replaced.
- **Presenter silence over ~60s splits attendee stays** (section 8). Accepted as current behavior;
  revisit if attendance time accuracy during presenter outages matters.
- **After a restart, some rooms re-place their attendees slowly** (section 9): roughly a third of
  stays close and reopen about a minute later, concentrated in one or two rooms. Untested ideas:
  rerun an outage with `--presenter-rejoin=false` to rule out presenter step-outs; and refresh
  restored stays' last-seen time at boot to give a fresh 45s grace (would help only the attendees
  re-placed within that window, since the median re-placement was about 60s after boot).
- **The single-room limit on Container Apps at 1 vCPU** is not measured: 700 devices in one room
  is clean, 800 and 1000 were only tested across 5 rooms (800) or on the VM.
- **The presenter roster screen** still draws every member at once (section 10).
- **The Container Apps deployment is on a personal trial account** with sign-in off and a public
  address. It needs recreating from `infra/main.bicep` in the company resource group, with a
  Key Vault or other secret store for `databaseUrl` instead of a local parameters file.
