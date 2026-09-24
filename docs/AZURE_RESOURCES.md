# Azure resources for a full backend migration (proposed, not yet implemented)

What would need to exist in Azure to move the backend off Render + Firebase and onto Azure
end-to-end: database, auth, and hosting. This is a planning document, not a description of
anything provisioned yet — nothing in this file has been created in an Azure subscription.
It exists to record the decision, in particular the **two hosting options**, before any of
this is acted on.

## Why

Today's stack (see [.env.example](../.env.example), [render.yaml](../render.yaml),
[DATABASE_MIGRATION.md](DATABASE_MIGRATION.md)) is:

- **Hosting**: Render, free web service plan, `runtime: docker` against the repo's own
  `Dockerfile`.
- **Database**: optional Postgres via `DATABASE_URL` (in-memory if unset) — currently a
  Render-hosted Postgres instance when enabled.
- **Auth**: Firebase (email/password + Google) and an ordinary Entra ID app registration
  side by side (`apps/mobile/src/config/authConfig.ts`), authority
  `https://login.microsoftonline.com/common/v2.0` — a plain multi-tenant + personal-account
  registration, not Entra External ID.

A full Azure migration replaces the first two outright and upgrades the third (plain Entra
ID → Entra External ID, needed once the app is public-facing rather than
company-internal — see the auth discussion referenced in [SCHEDULER_DESIGN.md](SCHEDULER_DESIGN.md)).

## Resources needed

| Resource | Purpose | Azure service |
|---|---|---|
| Resource group | Container for everything below | — |
| Database | Replaces Render Postgres | Azure Database for PostgreSQL — Flexible Server |
| Container registry | Holds the API's Docker image (same `Dockerfile` already in the repo) | Azure Container Registry |
| Compute | Runs the API container | **Two options — see below** |
| Identity | Replaces the plain Entra ID app registration | Entra External ID tenant + app registration |
| Push notifications | Already provisioned separately — see [NOTIFICATION_HUB_SETUP.md](NOTIFICATION_HUB_SETUP.md) | Azure Notification Hubs |
| Secrets | Replaces `.env`/Render's dashboard env vars for production | Azure Key Vault |

### Database — Azure Database for PostgreSQL (Flexible Server)

- **Burstable tier** (`B1ms`) is the right starting point — this app's load profile (one
  admin, a handful of rooms, periodic writes on room close) doesn't need general-purpose
  compute. Specs and cost below under [Limits, cost, and expected load](#limits-cost-and-expected-load).
- Same schema, same migration flow as today — `apps/api/src/db/schema.ts` and
  `apps/api/drizzle/*.sql` don't change; only `DATABASE_URL` points at the new instance.
  Follow [DATABASE_MIGRATION.md](DATABASE_MIGRATION.md) verbatim once the instance exists —
  that doc is already provider-agnostic (it just needs a `postgres://` URL).
- Enable "Allow public access from Azure services" or, better, put the API's compute
  resource and the database in the same virtual network so the connection never leaves
  Azure's internal network.
- **Burstable is explicitly not recommended for production** by Microsoft's own docs — it
  uses a CPU-credit model, and under sustained load (credits exhausted) the server is
  throttled to baseline CPU, causing connection timeouts and transient failures until
  credits rebuild. Fine for this app's actual load (see load section below), but worth
  moving to General Purpose if usage ever grows past "one admin, a handful of concurrent
  rooms." [[1]](https://learn.microsoft.com/en-us/azure/postgresql/compute-storage/concepts-compute)

### Identity — Entra External ID

- A separate tenant type from the current plain Entra ID registration — required once
  sign-in needs to work for the general public, not just people already in an
  organizational directory. Already stood up on a feature branch — see
  [ENTRA_EXTERNAL_ID_SETUP.md](ENTRA_EXTERNAL_ID_SETUP.md) for the full walkthrough,
  including the Google-federation attempt and why Google sign-in ended up staying on
  Firebase instead.
- `AUTH_AUTHORITY` in `apps/mobile/src/config/authConfig.ts` changes from
  `https://login.microsoftonline.com/common/v2.0` to
  `https://<subdomain>.ciamlogin.com/<tenant-id>/v2.0` — the config already has a comment
  anticipating exactly this swap.
- Whether Firebase (email/password, Google) stays alongside Entra External ID or gets
  folded into it as a federated identity provider is a separate decision, not required for
  this migration to work — `apps/api/src/auth.ts` already supports more than one verifier
  side by side, so nothing forces consolidating them.

### Push notifications — Azure Notification Hubs

Already provisioned and working (not a future step) — see
[NOTIFICATION_HUB_SETUP.md](NOTIFICATION_HUB_SETUP.md) for the full setup (namespace, hub,
FCM v1 credentials, connection string) and its iOS/APNs section for what's still needed
there. Listed here only so this doc's resource table is a complete picture of everything
a full production deployment needs — nothing about it changes for the Option A/B hosting
decision below; it's a subscription-scoped resource independent of both hosting options
and both identity tenants.

### Secrets and environment variables — Azure Key Vault

Today, every environment variable (`DATABASE_URL`, `AUTH_AUTHORITY`/`AUTH_AUDIENCE`,
`FIREBASE_PROJECT_ID`, `ADMIN_EMAILS`, `AZURE_NOTIFICATION_HUB_CONNECTION_STRING`, etc.)
lives in a local `.env` file or typed directly into Render's dashboard — fine for one
person operating one deployment, not a real secrets-management story (no audit log of who
read what, no rotation support, no access boundary if the hosting account itself is ever
shared or compromised).

**Azure Key Vault** replaces this for a production deployment:

- Secrets (the same list above) are created as Key Vault secrets instead of plaintext env
  vars.
- The compute resource (Container Apps or App Service, either hosting option below) is
  given a **managed identity** and a Key Vault access policy scoped to just "read
  secrets" — no credential is needed to authenticate to Key Vault itself, Azure handles
  that via the identity.
- Two ways to consume the secrets from the app, in order of preference:
  1. **Key Vault references in App Settings** — App Service and Container Apps both
     support `@Microsoft.KeyVault(SecretUri=...)` as an app setting value; the platform
     resolves it to the real secret at startup and the app still just reads
     `process.env.X` normally, no code changes needed.
     [[2]](https://learn.microsoft.com/en-us/azure/app-service/app-service-key-vault-references)
  2. **Read directly at startup** via `@azure/keyvault-secrets` + `@azure/identity`
     (`DefaultAzureCredential`, which picks up the managed identity automatically) — more
     control (e.g. central rotation without redeploying), more code.
- Every secret access is logged (who/what/when) if Key Vault's diagnostic logging is
  turned on and sent to a Log Analytics workspace — this is the actual audit trail that
  doesn't exist with plain env vars today.
- Rotation: updating a secret's value in Key Vault doesn't require touching the app's
  configuration at all when using Key Vault references (option 1) — the app picks up the
  new value on its next restart (App Service) or automatically within its refresh
  interval (Container Apps), no redeploy needed.

## Hosting — two options

Both run the same image, built from the repo's existing `Dockerfile` — the only difference
is the compute tier underneath it and what that trades off.

### Option A — scales to zero under no load

**Azure Container Apps**, Consumption plan, `minReplicas: 0`.

- Behaves like today's Render free tier: no traffic → no running instance → no cost beyond
  the database. The first request after idle pays a cold-start penalty (container image
  pull + app boot), same category of gap already documented in
  [SCHEDULER_DESIGN.md](SCHEDULER_DESIGN.md#a-known-reliability-gap) for Render's spin-down.
- Cheapest option; right choice for continued POC/low-traffic use where occasional latency
  on the first request is acceptable.
- **Does not fix** the scheduler's reliability gap — a server-side timer checking for due
  events still stops the moment the container scales to zero, exactly as it does on Render
  today. If the scheduler ships, this option keeps that caveat.

### Option B — always on

**Azure Container Apps**, `minReplicas: 1` (or higher for redundancy), **or** a plain Azure
App Service on a Basic (`B1`) or higher plan.

- At least one instance is always running — no cold starts, and a server-side timer (the
  scheduler's due-event check, or anything else time-sensitive) actually fires reliably
  instead of only running whenever a request happens to wake the service.
- Costs money continuously regardless of traffic — roughly **$13/month** for App Service
  Basic B1 (1 vCPU, 1.75 GB RAM, 10 GB storage)
  [[3]](https://azure.microsoft.com/en-us/pricing/details/app-service/linux/), or a
  comparable always-on Container Apps configuration priced per vCPU-second/GiB-second
  instead of a flat monthly rate (see cost table below).
- **Directly resolves** the scheduler's "known reliability gap" — this is the recommended
  option once the scheduler feature is actually built and relied on for real invites,
  matching option 3 already listed in that doc's own reliability discussion.

### Recommendation

Start with **Option A** for continued development and POC use — it matches the current
Render setup's cost profile and behavior, so nothing about day-to-day testing changes.
Move to **Option B** specifically when the scheduler feature ships and push notifications
need to fire on schedule rather than "whenever the server happens to be awake" — that's the
one feature this repo has that actually needs an always-on timer; everything else here is
request/response and tolerates cold starts fine.

## Limits, cost, and expected load

Figures below are current as of September 2026, US-region pay-as-you-go pricing (actual
billed amounts vary by region and change over time — treat these as planning-level, not a
quote). All sourced from Azure's own pricing/docs pages, listed under
[References](#references).

### Cost summary (Option A: scale-to-zero)

| Resource | Tier | Monthly cost | Notes |
|---|---|---|---|
| Compute (Container Apps, Consumption) | `minReplicas: 0` | **$0** at this app's traffic | First 180,000 vCPU-seconds, 360,000 GiB-seconds, and 2M requests/month are free per subscription; a single admin + a handful of rooms stays far under this [[4]](https://azure.microsoft.com/en-us/pricing/details/container-apps/) |
| Database (PostgreSQL Flexible Server) | Burstable B1ms | **~$12–13/month** compute + storage/backup billed separately | 1 vCore, 2 GiB RAM, 32 GiB–64 TiB storage range [[1]](https://learn.microsoft.com/en-us/azure/postgresql/compute-storage/concepts-compute) [[5]](https://www.bytebase.com/dbcost/azure-flexible/instance/B1ms/) |
| Container registry | Basic | **~$5/month** | 10 GiB storage included, 2 webhooks [[6]](https://azure.microsoft.com/en-us/pricing/details/container-registry/) |
| Notification Hub | Free | **$0** | 1M pushes/month, 500 active devices — see below [[7]](https://azure.microsoft.com/en-us/pricing/details/notification-hubs/) |
| Key Vault | Standard | **~$0.03 per 10,000 operations** | Effectively $0 at this app's secret-read volume (a handful of reads per cold start) [[8]](https://azure.microsoft.com/en-us/pricing/details/key-vault/) |
| **Total** | | **~$17–18/month** | Dominated by the database; compute is free at this traffic level |

### Cost summary (Option B: always-on)

Same as above, except compute becomes a flat **~$13/month** (App Service Basic B1) instead
of $0, or an always-on Container Apps replica billed continuously at roughly
**$0.000024/vCPU-second + $0.000003/GiB-second**
[[4]](https://azure.microsoft.com/en-us/pricing/details/container-apps/) — for 1
vCPU/2 GiB running 24/7, that works out to roughly **$70–75/month** for Container Apps
always-on, making **App Service Basic B1 the cheaper always-on choice** for this
workload. **Total: roughly $30/month** (App Service B1 + database + registry + Key Vault;
Notification Hub free tier still covers this app's volume).

### Per-resource limits

**Azure Database for PostgreSQL — Burstable B1ms**
[[1]](https://learn.microsoft.com/en-us/azure/postgresql/compute-storage/concepts-compute):
- 1 vCore, 2 GiB RAM, 640 max IOPS, 10 MiB/sec max I/O bandwidth.
- Storage: 32 GiB minimum, scalable up to 64 TiB without downtime (storage-only scale-up;
  compute tier change requires a brief restart).
- Backup retention: 7–35 days automated, up to 10 years with long-term retention configured.
- **Burstable uses a CPU-credit model** — credits accumulate below baseline usage and
  deplete above it; sustained above-baseline load causes throttling to baseline CPU,
  producing connection timeouts and transient failures until credits rebuild. Microsoft
  explicitly does not recommend Burstable for production and it doesn't qualify for 24/7
  support or root-cause analysis on outages — acceptable here only because of how light
  this app's actual write load is (periodic writes on room close, not continuous).

**Azure Notification Hubs**
[[7]](https://azure.microsoft.com/en-us/pricing/details/notification-hubs/):
- **Free tier**: 1 million pushes/month, 500 registered active devices.
- **Basic tier** ($10/month): 10 million pushes/month, up to 200,000 active devices.
- **Standard tier** ($25/month): 10 million pushes/month, unlimited active devices, plus
  scheduled pushes and telemetry.
- This app's realistic volume (one notification per scheduled event × invited attendees)
  stays in the free tier for a very long time — would need roughly 500 concurrent
  registered devices or >1M individual notification sends/month to need Basic.

**Azure Container Apps — Consumption plan**
[[4]](https://azure.microsoft.com/en-us/pricing/details/container-apps/):
- Free grant: 180,000 vCPU-seconds, 360,000 GiB-seconds, 2 million requests per
  subscription per month.
- Beyond the grant: ~$0.000024/vCPU-second, ~$0.000003/GiB-second, $0.40 per million
  requests.
- Idle replicas (at `minReplicas` floor, no active requests) bill at a reduced rate
  (roughly 30–40% of the active rate) rather than $0, unless scaled fully to zero.

**Azure Container Registry — Basic**
[[6]](https://azure.microsoft.com/en-us/pricing/details/container-registry/):
- 10 GiB storage included, overage billed per GiB/day beyond that.
- 2 webhooks included (fine for a single CI pipeline pushing on deploy; would need
  Standard/Premium for more).

**Azure Key Vault — Standard**
[[8]](https://azure.microsoft.com/en-us/pricing/details/key-vault/):
- $0.03 per 10,000 transactions (every secret read/write/list is one transaction).
- No meaningful capacity limit for this use case — a handful of secrets, read once per
  cold start/restart, is negligible volume.

### What load this comfortably handles — worked estimate, not a guess

The numbers below are derived from the app's actual polling intervals, not assumed —
`apps/mobile/src/services/presenceService.ts:17` flushes each attendee/presenter's
presence batch every **10 seconds** while active, and
`apps/mobile/src/screens/AdminScreen.tsx:21` polls the admin overview every **5 seconds**.

**Working scenario: 1,000 concurrent devices**, 8 active hours/day, 20 event-days/month, 1
admin device polling throughout (admin traffic is negligible next to 1,000 devices, so it's
dropped from the math below).

- Per device: 6 requests/min × 60 min × 8 hr = **2,880 requests/device/day**.
- 1,000 devices × 2,880 = **2.88M requests/day**.
- × 20 event-days/month ≈ **57.6M requests/month**.
- Steady-state during active hours: 1,000 devices / 10s ≈ **~100 requests/second
  sustained** — this is the number that actually matters for sizing compute, more than
  the monthly total.

#### Architecture constraint this surfaces — read before sizing compute

`apps/api/src/inference.ts` holds all room/presence/device state in **in-process
JavaScript `Map`s** (`activeRoomsByKey`, `roomMembership`, `devices`, etc.) — there is no
shared store (Redis or otherwise) behind it. At small scale this doesn't matter. At
1,000-device scale it does: **Container Apps' default autoscaling (multiple replicas under
load) would silently break correctness** — a device's requests could land on a different
replica than the one holding its room's state, causing missed presence updates and
phantom room states, with no error surfaced.

This means the ~100 req/s figure above **must be handled by a single instance**
(`maxReplicas: 1`, whichever hosting option), not solved by scaling out. The real
production fix — moving room/presence state into Redis or the database so multiple
replicas can share it — is not designed or built. Until it is, "handling 1,000 devices"
means "one instance strong enough to sustain ~100 req/s of this app's actual per-request
work," which has not been load-tested, so the CPU-seconds figures below are an estimate,
not a verified capacity number.

#### Cost at this scale

| Resource | Tier | Monthly cost | Why it changed from the small-scale table |
|---|---|---|---|
| Compute | Single always-on instance, sized up (e.g. Container Apps `maxReplicas: 1` with 2 vCPU/4 GiB, or App Service P1V3-class) | **~$100–150/month**, needs load testing to confirm the right size | 100 req/s sustained is past Consumption's free grant (2M requests/month blown through in ~1 event-day at this scale) and, per the constraint above, must stay on one instance rather than autoscale out |
| Database | General Purpose `D2ds_v5` (2 vCores, 8 GiB, ~3,750–4,000 IOPS) instead of Burstable B1ms | **~$130/month** [[5]](https://www.bytebase.com/dbcost/azure-flexible/instance/B1ms/) [[9]](https://www.bytebase.com/dbcost/azure-flexible-server-pricing/) | B1ms's 640 IOPS and credit-throttling model (already flagged as not production-recommended) would be a real bottleneck at 100 req/s of sustained load, not just a theoretical caveat |
| Notification Hub | **Basic**, not Free | **$10/month** | Free tier caps at 500 active devices; 1,000 registered devices exceeds it. Push volume itself (≈20,000 pushes/month for one notification × 1,000 invitees × 20 events) stays far under Basic's 10M/month cap |
| Container registry | Basic | ~$5/month | Unchanged |
| Key Vault | Standard | Still effectively $0 | Secret reads don't scale with device count |
| **Total** | | **~$250–300/month** | Roughly 10–15x the small-scale estimate — dominated by needing a real (non-Burstable) database tier and enough compute to sustain ~100 req/s on one instance |

#### Bottom line at 1,000-device scale

The jump from "single admin, a handful of rooms" to 1,000 concurrent devices is not a
config change — it's the point where Burstable Postgres and Consumption-tier serverless
compute (this doc's Option A) stop being defensible, **and** where the in-memory
single-instance engine becomes a hard ceiling rather than a minor caveat. Before committing
budget to the table above:

1. **Load-test** the actual per-request cost of `inference.ts`'s scoring/lookup work at a
   simulated ~100 req/s, to replace the "needs load testing" compute estimate with a real
   number.
2. **Decide whether 1,000 devices is meant to run through one room/session at a time or
   spread across many concurrent rooms** — the single-instance ceiling applies either way,
   but it changes what "sustained load" actually looks like server-side.
3. If this scale is a real target rather than a stress-test ceiling, moving room state out
   of process (Redis-backed) should be scoped as its own piece of work before relying on
   horizontal autoscaling — the alternative is staying vertically-scaled indefinitely,
   which has a ceiling of its own.

## Not yet decided

- Whether to consolidate Firebase auth into Entra External ID as a federated provider, or
  keep running both side by side indefinitely (current dual-verifier setup already supports
  either).
- Exact Container Apps vs. App Service choice for Option B — functionally equivalent for
  this workload; comes down to whichever is easier to operate once someone's actually
  running it day to day.
- Whether the existing Render deployment gets decommissioned immediately on cutover or kept
  briefly as a fallback.
- CI/CD path for pushing new images to Azure Container Registry and redeploying — not
  designed yet.
- Whether to move `inference.ts`'s in-memory room/presence state to a shared store
  (Redis) — not needed at small scale, but a real prerequisite for horizontal autoscaling
  once traffic approaches the 1,000-device scenario above. Two options, detailed below:
  the Redis migration itself, or sticky sessions as a cheaper interim fix. Neither is
  scoped as actual work yet.

### Option 1 — move room/presence state to Redis

This is a real refactor of `apps/api/src/inference.ts`'s storage layer, not a drop-in
swap. It currently holds five in-process `Map`s — `devices`, `roomMembership`,
`activeRoomsByKey`, `pendingRoomCreation`, `roomEndedNotices` — and a lot of its logic does
**synchronous multi-step operations across them** that are atomic today only because
JS is single-threaded (e.g. `endRoomOccurrence`, `inference.ts:226`, iterates all of
`roomMembership` and `devices` to find everything tied to one room). Once that state lives
in Redis, every one of those steps becomes an async round-trip, and any multi-step
sequence needs to become atomic another way — a Lua script or a Redis transaction — or
concurrent requests landing on different replicas can race.

Concrete steps:

1. Add a hosted Redis — **Azure Cache for Redis**, Basic tier (~$16/month for the
   smallest size) is enough to start — and a client (`ioredis`).
2. Redesign each Map's shape for Redis, not a 1:1 port:
   - `activeRoomsByKey` → a Redis hash per room key, with `EXPIRE` replacing the manual
     `ROOM_AUTO_EXPIRY_MS` check done in `resolveRoom`/`activeRoomId` today.
   - `roomMembership` → keep a Redis **Set of member device IDs per room** alongside
     per-membership hashes, so "find everything under this room" (what
     `endRoomOccurrence` does today via `for...of this.roomMembership.entries()`) doesn't
     become an unscalable `SCAN` over every membership in the system.
   - `roomEndedNotices` → a `SET key val PX <ttl>`, letting Redis's native TTL replace the
     manual `ROOM_ENDED_NOTICE_TTL_MS` expiry check.
   - `pendingRoomCreation` → doesn't have a clean Redis equivalent, since it deduplicates
     *in-flight writes on one process*. Across replicas this needs either a distributed
     lock (`SET key val NX PX 5000`) or leaning on a Postgres unique constraint with
     catch-and-retry instead of in-process deduplication.
3. Rewrite `endRoomOccurrence` and similarly multi-step methods as either a Lua script
   (atomic server-side) or explicitly reason through what breaks if two replicas run the
   same sequence concurrently.
4. Replace the `setInterval(() => this.trim(), 5_000)` sweep (`inference.ts:158`) with
   Redis TTLs doing most of that work natively; keep app-level cleanup only for what TTL
   alone can't express.
5. This touches correctness-sensitive logic, so it needs real integration tests under
   concurrent load before being trusted — not just a typecheck pass.

Realistically several focused days of work, not a quick swap — and it's the only path to
*true* elastic horizontal scaling (any replica can serve any device).

### Option 2 — sticky sessions (cheaper interim fix)

If the actual goal is just "support ~1,000 devices without breaking correctness," **session
affinity** (routing a device's requests to the same replica every time, keyed on device ID)
is much cheaper: both Azure Container Apps and App Service support this natively, and
nothing in `inference.ts` has to change at all — each replica keeps its own in-memory state
exactly as today, and devices simply always land on the instance that holds theirs.

Tradeoffs vs. the Redis path: it isn't true elastic load balancing (an overloaded replica
stays overloaded — it can't shed sticky clients to another instance), and a mid-event
replica restart loses that replica's in-memory state for every device pinned to it (same
failure mode as today's single instance, just now affecting only a fraction of devices
instead of all of them). For this app's actual usage pattern — bursty, event-scoped, not
sustained arbitrary growth — that tradeoff is likely acceptable and far less risky than
rewriting the engine's storage layer.

**Recommendation if 1,000-device scale becomes a real target**: start with sticky sessions
(low effort, no code changes) and only take on the Redis migration if session affinity's
failure modes (uneven load, restart-loses-state-for-pinned-devices) actually show up in
practice.

## References

1. [Compute Options - Azure Database for PostgreSQL (Microsoft Learn)](https://learn.microsoft.com/en-us/azure/postgresql/compute-storage/concepts-compute) — B1ms specs, IOPS/bandwidth table, Burstable-tier production caveat.
2. [Grant access to your app from Key Vault (Microsoft Learn)](https://learn.microsoft.com/en-us/azure/app-service/app-service-key-vault-references) — Key Vault references in App Settings.
3. [App Service pricing — Linux (Microsoft Azure)](https://azure.microsoft.com/en-us/pricing/details/app-service/linux/) — Basic B1 specs and pricing.
4. [Container Apps pricing (Microsoft Azure)](https://azure.microsoft.com/en-us/pricing/details/container-apps/) — Consumption plan free grant and per-second rates.
5. [Azure Database for PostgreSQL/MySQL B1ms pricing (Bytebase dbcost)](https://www.bytebase.com/dbcost/azure-flexible/instance/B1ms/) — on-demand monthly cost reference.
6. [Container Registry pricing (Microsoft Azure)](https://azure.microsoft.com/en-us/pricing/details/container-registry/) — Basic tier storage/webhook limits.
7. [Notification Hubs pricing (Microsoft Azure)](https://azure.microsoft.com/en-us/pricing/details/notification-hubs/) — Free/Basic/Standard tier push and device limits.
8. [Key Vault pricing (Microsoft Azure)](https://azure.microsoft.com/en-us/pricing/details/key-vault/) — per-transaction pricing.
9. [Azure Database for PostgreSQL/MySQL pricing — every machine type (Bytebase dbcost)](https://www.bytebase.com/dbcost/azure-flexible-server-pricing/) — General Purpose `D2ds_v5` (2 vCores, 8 GiB) on-demand price used as the 1,000-device scenario's database estimate.
10. [App Service pricing tiers — Standard S1 (multiple sources, see conversation)](https://azure.microsoft.com/en-us/pricing/details/app-service/linux/) — referenced for the "needs autoscale-capable tier" comparison point at 1,000-device scale (Basic doesn't support autoscale at all; used here only as a sizing signal, not the recommended tier — see the single-instance constraint above).
