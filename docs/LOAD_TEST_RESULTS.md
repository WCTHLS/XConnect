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
