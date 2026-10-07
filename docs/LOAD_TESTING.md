# Load testing the backend

`backend/src/loadtest.ts` is a standalone script that simulates many devices hitting the real
API at once, so you can answer "does the server keep up at N devices" with actual numbers
instead of guessing from reading the code. It's what found and confirmed the fixes for several
real scaling and durability bugs (below), and it's meant to be re-run after any change to the
inference engine or the live-poll/batch-upload routes, not just read once and forgotten.

It follows the repo's existing pattern of a standalone `tsx` script (`test_wifi_inference.ts`)
rather than introducing a test framework, and it is **not** part of `pnpm test` — it's slow,
load-bearing on the machine it runs on, and meant to be run deliberately.

## What it simulates

For a run of N devices across R rooms, it builds R rooms each with one presenter and the rest
attendees, and runs every device as an independent loop that:

- Joins once (`POST /api/session/join`).
- Polls its own live state every 3 seconds (`GET /api/devices/:deviceId/live` for attendees,
  `GET /api/rooms/:roomId/live` for presenters) — the same cadence the real mobile app uses.
- Uploads a sensor batch every 10 seconds (`POST /api/observations`), with up to 60 peers
  sampled from other devices in the same room and a small per-room Wi-Fi fingerprint (3 fake
  APs, consistent per room) so the engine's Wi-Fi similarity scoring has something real to do.
- Leaves cleanly at the end of the run (`POST /api/session/leave`).

One additional loop polls `GET /api/admin/overview` on its own cadence, simulating the admin
dashboard watching the whole event.

Joins are staggered over a ramp-up window rather than firing all at once, and every interval has
a small random jitter, so the harness itself doesn't manufacture an artificial thundering herd
that wouldn't happen in reality.

Multi-room is the default and deliberately so: an earlier, separate load test (documented in the
project's scaling investigation) found that a single-room scenario looks fine well past the point
where a multi-room one already struggles, since the inference engine's cost scales with total
system size, not per-room size. Don't trust a single-room-only run as representative.

## Prerequisites: a server with auth off

Every request the script sends is unsigned — there's no real sign-in token behind any of it.
That only works against a server running in the "POC mode" `backend/src/auth.ts` already
supports, which is what happens when `FIREBASE_PROJECT_ID` and `AUTH_AUTHORITY`/`AUTH_AUDIENCE`
are all unset. **Do not point it at your normal dev server** (the one started with `pnpm dev`,
which loads the real `.env` with real auth configured) — every request will just 401.

Instead, run a second, separate backend instance on a different port, started from a minimal
env file. At the repo root, create `.env.loadtest` (already gitignored, same as `.env`):

```
PORT=3001
```

Leaving `DATABASE_URL` out as well puts the engine in pure in-memory mode, which is the right
default for this: it isolates the inference engine's own cost from Postgres's, and the two are
worth measuring separately (see "What it doesn't cover" below). The same goes for `REDIS_URL` —
leave it unset for a pure in-memory run, add it to measure the Redis checkpoint path, but don't
mix all three layers into one run if you're trying to tell which one caused what.

## Running it

**Terminal 1** — start the auth-off server, from `backend/`:

```bash
pnpm exec tsx --env-file=../.env.loadtest src/index.ts
```

Confirm it's the right instance — it should log `No DATABASE_URL set` and
`No sign-in configured ... API is open (POC mode)`, not "Postgres persistence enabled" or
"Sign-in required". It listens on whatever `PORT` says (3001 above).

**Terminal 2** — run the load test, from `backend/`:

```bash
pnpm exec tsx src/loadtest.ts --url=http://localhost:3001
```

### Flags

| Flag | Default | Meaning |
|---|---|---|
| `--devices` | 500 | total devices, split across `--rooms` |
| `--rooms` | 5 | one presenter + the rest attendees per room |
| `--duration` | 60 | seconds the steady-state run lasts, after ramp-up |
| `--ramp` | 10 | seconds over which devices join, staggered |
| `--url` | `http://localhost:3000` | target server — almost always override this to your auth-off instance |
| `--session` | `loadtest-session` | the session label every simulated room is grouped under |
| `--poll-interval` | 3000 | ms between a device's own live polls |
| `--batch-interval` | 10000 | ms between a device's sensor batch uploads |
| `--admin-interval` | 5000 | ms between admin overview polls |
| `--token` | (none) | if the target *does* have auth on, a real bearer token to attach to every request — see the note at the top of `loadtest.ts` for why one shared token across all simulated devices is fine |

Examples:

```bash
# quick smoke test
pnpm exec tsx src/loadtest.ts --url=http://localhost:3001 --devices=100 --duration=30

# longer soak run, watching for drift or memory growth
pnpm exec tsx src/loadtest.ts --url=http://localhost:3001 --duration=900
```

## Reading the output

It prints a progress line every 10 seconds (`ok`/`failed` running totals), then a final table:

```
endpoint        count   errors  p50     p90     p95     p99     max
admin_overview  14      0       5       95      98      98      98
batch           2997    0       8       96      143     314     496
join            500     0       2       6       16      64      73
leave           500     0       139     395     413     424     426
poll_device     10358   0       6       83      119     288     497
poll_room       103     0       6       91      144     310     314
(all latencies in ms)
```

`count` and `errors` are self-explanatory (`errors` includes both HTTP error statuses and plain
network failures — a dropped connection counts as a status-0 error). The rest are latency
percentiles. A failing run looks like errors climbing steadily through the progress log and p99s
in the thousands-of-milliseconds range; a healthy one looks like the table above, zero errors,
every p99 comfortably under a second.

When the server itself is the bottleneck (not the network or the load-test client), the real
signal is usually inside the server's own logs, not the client-side table — see `[tick] slow:`
below.

## Testing restart survival (with `REDIS_URL` set)

A plain run only tests throughput. To test whether the engine actually survives a restart (the
point of the Redis checkpoint — see `docs/LOAD_TEST_RESULTS.md` section 6), run the harness
against a server you then kill and restart partway through:

1. Start the auth-off server with `REDIS_URL` (and ideally `DATABASE_URL`, to match a real
   deployment) set in `.env.loadtest`.
2. Launch `loadtest.ts` in the background.
3. ~20-30 seconds in (past ramp-up, into the steady state), kill the server and immediately
   restart it against the same `.env.loadtest`.
4. Let the run finish, then check two things: the client's error count should stop climbing once
   the new server is back up (errors cluster in the restart window, not scattered throughout),
   and the room's Postgres row should be a single unbroken `started_at`→`ended_at` span for the
   whole test, not split into two separate occurrences.

A second occurrence appearing, or errors continuing well past the restart, both mean the restore
didn't actually pick up where the old process left off — see `docs/LOAD_TEST_RESULTS.md` for what
that looked like the one time it happened (a Redis key collision with a leftover test process,
not a flaw in the restore logic itself).

## What it found (project history)

Full numbers, every scenario tested (local and on Render), and the several separate scaling
problems this harness has found so far live in **`docs/LOAD_TEST_RESULTS.md`** — that's the
detailed record, kept up to date as a reference. Short version: moving graph/room-state
computation onto a tick took 500 devices from ~60% request failures to zero errors; a mass-leave
bug (full-list scan per device leaving) is also fixed; Redis-backed durability now lets a restart
resume a live session instead of losing it, verified against both a real device session and an
automated restart mid-load-test. 1000 devices locally and 200+ devices on Render's free tier both
still show real, separate, unresolved limits — see the results doc for which is which, and note
that the 1000-device mechanism has changed since it was first found (no longer the engine's own
tick cost — see the results doc's Open items).

The engine logs a warning if any one tick takes more than half its 2-second budget
(`console.warn("[tick] slow: ...")`, in `inference.ts`), with a breakdown of where the time went
(graph build, hop-distance maps, room computation, device-room resolution). If a load test shows
errors climbing but the client-side table doesn't make it obvious why, check the server's own
log for this line first.

## What it doesn't cover

- **The Postgres write path, or the Redis checkpoint path.** Running with `DATABASE_URL` and
  `REDIS_URL` both unset (the documented default above) deliberately isolates the in-memory
  inference cost. Adding either to `.env.loadtest` measures that layer on top, but turning on
  both at once makes it hard to tell which one caused what if something looks off — do them as
  separate runs, and only combine them once each has already been measured alone.
- **Physical realism.** The Wi-Fi fingerprints and BLE peer lists are synthetic and favorable
  (clean per-room clusters, no real-world interference or hardware variance). This measures
  throughput and latency, not whether the sensor-fusion inference is *accurate* at scale — that
  needs a real multi-device field test.
- **Running generator and server on one machine.** Both the load-test script and the server
  under test are local Node processes competing for the same CPU. This is fine for finding
  server-side bottlenecks (which is what it's been used for so far), but absolute numbers from a
  laptop won't match production hardware — the scaling plan's own September test, for comparison,
  ran against Render's free tier (0.1 shared vCPU), which is a different, also-not-production
  baseline.

## Where this fits in the bigger picture

This harness is the "Phase 0: baseline harness" referred to in the project's backend scaling
plan — the standard way to answer "did that change actually help" before and after each phase of
work (per-tick computation, algorithmic fixes, Redis, etc.). Re-run it after any change that
touches `backend/src/inference.ts` or the live-poll/batch-upload routes in `backend/src/index.ts`,
at both 500 and 1000 devices, before considering that change done.
