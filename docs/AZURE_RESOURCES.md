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

A full Azure migration replaces the first two outright and keeps the third as it is: the app is
public, and the ordinary multi-tenant Entra ID registration (any organization plus personal
Microsoft accounts) is what XConnect uses. Entra External ID, which an earlier version of this plan
proposed, is not planned: it would exclude personal and other-company Microsoft accounts, and
email/password and Google sign-up already go through Firebase.

## Resources needed

| Resource | Purpose | Azure service |
|---|---|---|
| Resource group | Container for everything below | — |
| Database | Replaces Render Postgres | Azure Database for PostgreSQL — Flexible Server |
| Container registry | Holds the API's Docker image (same `Dockerfile` already in the repo) | Azure Container Registry |
| Compute | Runs the API container | **Two options — see below** |
| Identity | The same multi-tenant Entra ID app registration, created in the company tenant | Entra ID app registration (see [ENTRA_MICROSOFT_SIGN_IN_SETUP.md](ENTRA_MICROSOFT_SIGN_IN_SETUP.md)) |

### Database — Azure Database for PostgreSQL (Flexible Server)

- **Burstable tier** (`B1ms` or similar) is the right starting point — this app's load
  profile (one admin, a handful of rooms, periodic writes on room close) doesn't need
  general-purpose compute.
- Same schema, same migration flow as today — `apps/api/src/db/schema.ts` and
  `apps/api/drizzle/*.sql` don't change; only `DATABASE_URL` points at the new instance.
  Follow [DATABASE_MIGRATION.md](DATABASE_MIGRATION.md) verbatim once the instance exists —
  that doc is already provider-agnostic (it just needs a `postgres://` URL).
- Enable "Allow public access from Azure services" or, better, put the API's compute
  resource and the database in the same virtual network so the connection never leaves
  Azure's internal network.

### Identity: Entra ID app registration

- One app registration in the company tenant, accounts type "Any Entra ID Tenant + Personal
  Microsoft accounts", authority `https://login.microsoftonline.com/common/v2.0` (unchanged).
  Follow [ENTRA_MICROSOFT_SIGN_IN_SETUP.md](ENTRA_MICROSOFT_SIGN_IN_SETUP.md).
- Set `adminTenantId` to that tenant's id so company staff can be admins through Microsoft;
  anyone else who needs admin (outside the company, or a personal Microsoft account) signs in with
  Google and is listed on `adminEmails`. A Microsoft token's email is not trusted on its own
  because any tenant can sign in.
- Firebase (email/password, Google) stays alongside it. `apps/api/src/auth.ts` supports more than
  one verifier side by side, and a company-owned Firebase project is set up in
  [FIREBASE_GOOGLE_SIGN_IN_SETUP.md](FIREBASE_GOOGLE_SIGN_IN_SETUP.md).

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
- Costs money continuously regardless of traffic (roughly $13–15/month for the smallest
  App Service Basic tier, or a comparable always-on Container Apps configuration).
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
