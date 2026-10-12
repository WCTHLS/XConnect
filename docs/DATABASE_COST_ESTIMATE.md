# Database cost and storage estimate

Compares PostgreSQL Flexible Server, MySQL Flexible Server and Azure SQL Database for XConnect,
using storage and load figures measured on the test environment. Written 2026-10-10.

For the load tests behind the CPU figures, see [LOAD_TEST_RESULTS.md](LOAD_TEST_RESULTS.md). For how
to run them, see [LOAD_TESTING.md](LOAD_TESTING.md).

## Summary

- **Storage is not a cost driver.** One year of data is about 15 MB to 560 MB depending on event
  volume, against a 32 GiB minimum disk. We pay for the minimum disk, not for the data.
- **The database is lightly loaded.** During 700-device load tests, Postgres CPU sat around 10%
  (peak 44% on a brief spike) and CPU credits consumed were effectively zero.
- **The three engines cost about the same**: roughly $60 to $190 per year. Switching engines saves
  at most about $130 a year.
- **Recommendation: stay on PostgreSQL Flexible Server, Burstable B1ms, 32 GiB** (about $16 a
  month). Moving to Azure SQL or MySQL needs a database-layer rewrite for almost no saving.
- **B1ms has now been measured** (October 11, 2026): 700 devices for 5 minutes across 5 rooms, and
  for a full hour in one room. Latency matched the B2s, and CPU credits were never spent (they
  rose from 30 to about 39). See [B1ms load test results](#b1ms-load-test-results).

## What was measured

Source: the personal-trial Postgres server `xconnect-test-postgres-kk` (B2s, Canada Central, 32 GiB
disk, PG 18), which holds only load-test data, and the local Docker database (`confpresence-pg`,
Postgres 16) for comparison. The B1ms server that replaced it for testing is covered separately
under [B1ms load test results](#b1ms-load-test-results).

| Measure | Azure test server | Local Docker database |
|---|---|---|
| Database size (`pg_database_size`) | 28 MB | 19 MB |
| `state_change_events` | 92,713 rows, 13 MB | 48,008 rows, 7.1 MB |
| `room_membership` (one row per stay) | 15,913 rows, 3.3 MB | 11,688 rows, 2.3 MB |
| `devices` | 14,792 rows, 2.9 MB | 11,783 rows, 1.9 MB |
| Server disk in use | about 2.9 GiB (peak 4.4 GiB) | 75.8 MB (data folder) |
| Postgres CPU during load tests | about 5% average, about 10% typical peak, 44% brief spike | n/a |
| CPU credits consumed (Burstable) | about 0 | n/a |

The 2.9 to 4.4 GiB of server disk use is almost all server overhead (write-ahead log from heavy
write bursts, logs, system databases), not application data. The two Azure storage charts differ
because they are different aggregations of one metric: "Free (Max)" is the lowest usage in the
window and "Used (Max)" is the peak.

To re-measure:

```sql
select pg_size_pretty(pg_database_size(current_database()));

select relname, n_live_tup as rows, pg_size_pretty(pg_total_relation_size(relid)) as total
from pg_stat_user_tables order by pg_total_relation_size(relid) desc;
```

Locally: `docker exec confpresence-pg psql -U postgres -d confpresence -c "<query>"`.

## Storage for one year

Measured row sizes, indexes included: about 214 bytes per stay and about 147 bytes per state-change
row. The realistic load test produces about 5.8 state changes per stay (the baseline test produced
about 4.1), so one stay costs about 1.1 KB from the row sizes. A later direct measurement on the
B1ms server, which includes device rows and everything else the runs wrote, came to about **1.3 KB
per stay** (the `xconnect` database grew by 7.4 MB for about 5,500 stays), and the table below uses
that. The 1.3 stays per attendee allows for people leaving and returning.

| Scenario (1 year) | Events | Attendees per event | Stays | Data size |
|---|---|---|---|---|
| Small | 50 | 200 | about 13,000 | about 17 MB |
| Medium | 200 | 500 | about 130,000 | about 170 MB |
| Heavy | 500 | 800 | about 520,000 | about 680 MB |

Add about 8 MB per database for the empty schema and catalogs (the freshly migrated `xconnect`
database was 8.33 MB). The event counts and attendees per event are assumptions. Replace them with
real expectations. The heavy case is about 2% of a 32 GiB disk, and real use should have fewer
state flips than the synthetic test, so treat it as an upper bound.

- Postgres disks can be grown later but never shrunk, so 32 GiB is the right starting size.
- Backup storage is free up to the provisioned disk size, so it is $0 at this data size (LRS or GRS).
  LRS keeps copies in one datacenter. GRS also copies to a paired region and cannot generally be
  switched afterwards without restoring into a new server.

## Cost comparison (database only)

Approximate East US pay-as-you-go prices from memory and the Azure calculator. Verify them in the
region you deploy to before committing.

| Option | Tier | Included disk | Per month | Per year |
|---|---|---|---|---|
| PostgreSQL Flexible Server | Burstable B1ms (1 vCore, 2 GiB) | 32 GiB (min) | about $16 | about $190 |
| MySQL Flexible Server | Burstable B1ms | 20 GiB (min) | about $15 | about $175 |
| Azure SQL Database | Basic (5 DTU, 2 GB cap) | 2 GB | about $5 | about $59 |
| Azure SQL Database | Standard S0 (10 DTU) | 250 GB | about $15 | about $180 |
| Azure SQL Database | Standard S1 (20 DTU), as used by the existing claimsguru app | 250 GB | about $30 | about $360 |

Postgres B1ms is about $12 to $13 compute plus about $3.70 for 32 GiB of storage ($0.115 per GiB).

- A 1-year reservation on Postgres or MySQL compute usually reduces it by roughly a third.
- The Azure free account includes 750 hours of B1ms plus 32 GB of storage for 12 months on new
  accounts. The calculator's totals do not include it. Whether the company subscription still
  qualifies needs checking.
- Stopping the server when idle removes the compute charge. Azure restarts a stopped server
  automatically after 7 days.
- Leave Extended Support off for a current Postgres version.

### Burstable, General Purpose and DTUs

- **Burstable (B-series):** a real vCore with a low baseline (about 20% on B1ms, 40% per core on
  B2s). It earns credits while below the baseline and spends them on spikes. If credits run out it
  is throttled to the baseline. It is always running, so there is no cold start. Stopped servers do
  take a minute or more to start.
- **General Purpose (D-series):** full CPU all the time, more memory per core, zone-redundant high
  availability. The D2s v3 shown by default in the calculator is about $176 a month, far more than
  this app needs.
- **DTU (Azure SQL):** a fixed blended unit of CPU, memory and I/O with no burst credits. DTUs and
  vCores are not directly comparable, so low Postgres CPU does not prove a 10 DTU tier would be
  enough.
- **IOPS** comes from the disk size on Flexible Server. Nothing suggests disk is a bottleneck at
  this load (Postgres CPU stayed low through the one-hour B1ms test), but the IOPS metric itself
  was not checked.

## What switching engines would involve

- **Schema and queries:** the backend uses Drizzle's Postgres layer (`drizzle-orm/pg-core`) and the
  `postgres` driver. About 8 query sites use Postgres-style upserts or `RETURNING`
  (`persistence.ts`, `auth.ts`, `notifications.ts`, `index.ts`).
- **Azure SQL support in Drizzle:** only in its release-candidate line (`drizzle-orm@rc`, `mssql`
  driver). The backend is on stable `0.45`, so the port also means adopting a pre-release ORM in the
  data layer.
- **Effort:** roughly one to two days to port and test, more if the release candidate has gaps.
  Migrations are regenerated per dialect.
- **Performance risk:** a 10 to 20 DTU tier has not been tested against the write pattern.
- **A reason to switch anyway:** consolidating onto the engine the company already runs (tooling,
  backups, one skill set).

If a test is wanted, do it on a throwaway branch: an S0 database, the same 700-device run, then
compare p99 and CPU against the Postgres numbers.

## B1ms load test results

The earlier 700-device runs used a B2s, so B1ms (half the vCores, half the baseline) was measured
before being recommended. Full numbers are in `docs/LOAD_TEST_RESULTS.md` sections 11 and 12.

**Setup.** A new server `xconnect-test-pg-b1ms-kk` (Burstable B1ms, 32 GiB, PostgreSQL 16, Canada
Central) created from `infra/main.bicep` with `createPostgres = true`. The load test ran from a VM
in the same region as the container app (East US), not from a laptop. Metrics watched: **CPU
percent (Max)**, **CPU credits remaining (Min)** and **CPU credits consumed (Sum)** at 1-minute
granularity.

| Measure | B2s (earlier) | B1ms |
|---|---|---|
| 300 s, 700 devices, 5 rooms: `poll_device` p50 / p90 / p99 / max | 5 / 54 / 444 / 665 ms (with a restart) | 7 / 53 / 420 / 699 ms |
| Errors in that run | 0 | 0 |
| Postgres CPU during load | about 10% typical on 2 vCores | 6 to 14% typical on 1 vCore, 20% and 34% bumps |
| CPU credits | about 0 consumed | 0 consumed, balance rose from 30 to about 39 over an hour |

The one-hour run (700 devices, 1 room) is the harder database case, and B1ms did not spend any
credits even from a 30-credit start. A new B1ms starts with a small balance, so this is stricter
than a long-running server with a full one.

**Result.** B1ms is enough for the database at 700 devices, including a full hour.

**Not a database finding.** The same one-hour run showed latency collapsing (p99 3.2 s, max 145 s,
no errors) because the API container reached its 1 vCPU limit. That is a container and code
question, tracked in `docs/LOAD_TEST_RESULTS.md` section 12, and does not change the database
choice or cost. It does mean the container may need attention before long single-room events.

If credits ever trend toward zero in production, move up to B2s before considering General Purpose.

## Recommendation

- Use **PostgreSQL Flexible Server, Burstable B1ms, 32 GiB** (about $16 a month). Measured, not
  just estimated: see [B1ms load test results](#b1ms-load-test-results).
- The database is not the limit for long single-room events. The API container's 1 vCPU is
  (`docs/LOAD_TEST_RESULTS.md` section 12), so that is where any capacity work should go.
- Add alerts on **CPU credits remaining** (for example below 30% of maximum) and **storage
  percent** (for example 70%).
- Stop the server between events if cost matters, and start it a few minutes before a session. Test
  once how the backend's connection pool behaves when the database restarts before relying on that.
