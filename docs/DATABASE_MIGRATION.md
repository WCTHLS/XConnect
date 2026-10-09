# Migrating the database to a new Postgres instance

How to point XConnect's API at a brand-new Postgres instance (a different Render database,
another provider, a fresh local Docker container) and get the schema onto it. Covers
`apps/api/drizzle.config.ts`, `apps/api/drizzle/*.sql`, and the `db:generate` / `db:migrate`
scripts in `apps/api/package.json`.

## How the pieces fit together

- `apps/api/src/db/schema.ts` — the schema, as plain Drizzle TypeScript (`pgTable(...)`
  definitions for `sessions`, `rooms`, `devices`, `room_membership`, `state_change_events`).
- `apps/api/drizzle/*.sql` — generated migration files, one per schema change, checked into
  the repo. These are the actual `CREATE TABLE` / `ALTER TABLE` statements that get replayed
  against a database.
- `apps/api/drizzle.config.ts` — tells `drizzle-kit` where the schema and migrations live,
  and reads the target database from `DATABASE_URL`:
  ```ts
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://postgres:dev@localhost:5432/confpresence"
  }
  ```
- `pnpm --filter @confpresence/api db:migrate` — runs `drizzle-kit migrate`, which connects
  to whatever `DATABASE_URL` points at, checks its own bookkeeping table for which migration
  files have already been applied *to that specific database*, and runs whatever's missing,
  in order.

A brand-new database has none of this — `drizzle-kit migrate` is what actually creates every
table. Nothing else does; a fresh Postgres instance from any provider starts completely empty.

## First time pulling this branch

The database packages (`drizzle-orm`, `postgres`, and `drizzle-kit`) are already declared in
`apps/api/package.json` and locked in `pnpm-lock.yaml` — they're committed dependencies, not
something you add yourself. A normal, repo-root install pulls them in along with everything
else in the monorepo:

```bash
pnpm install
```

Nothing extra is needed for the `db:generate` / `db:migrate` scripts to work after that — no
global CLI install, no separate `pnpm add`. The only thing you provide yourself is
`DATABASE_URL` (steps below), since that's environment-specific and never committed.

## Steps

1. **Get the new instance's connection string.** Any Postgres provider works the same way
   here — you need one URL in the form `postgres://user:password@host:port/dbname`. If the
   provider distinguishes an "internal" URL (for services running on the provider's own
   network) from an "external" one (for connecting from your laptop), use the **external**
   one for this — you're running the migration from your own machine, not from inside the
   provider's network.

2. **Set `DATABASE_URL` for one command, don't write it into `.env`.** Writing it into your
   local `.env` would make your local dev server start talking to the new remote database
   instead of your local one. Set it only for the migration command's own process:

   **PowerShell:**
   ```powershell
   $env:DATABASE_URL = "postgres://user:password@host:5432/dbname"
   pnpm --filter @confpresence/api db:migrate
   ```

   **bash:**
   ```bash
   DATABASE_URL="postgres://user:password@host:5432/dbname" pnpm --filter @confpresence/api db:migrate
   ```

3. **If it fails immediately after "applying migrations..." with no real error message**,
   the most common cause is SSL. Most managed Postgres providers (Render included) require
   SSL on external connections, and `drizzle-kit`'s error output for a rejected connection
   can be unhelpfully silent. Append `?sslmode=require` to the connection string and retry:
   ```
   postgres://user:password@host:5432/dbname?sslmode=require
   ```

4. **Confirm it worked** — the command should print each migration file as it's applied
   (currently seven: `0000_*.sql` through `0006_preferred_name.sql`) and exit with
   `migrations applied successfully!` and no errors.

5. **Point the actual running server at it.** Wherever the API process runs (a Render Web
   Service, another host, your own machine), set its `DATABASE_URL` environment variable to
   the same connection string — for a service-to-database connection on the same provider,
   use the **internal** URL there instead of the external one, since it's faster and doesn't
   count against egress. Restart/redeploy the service. On boot it logs either:
   ```
   🗄️  Postgres persistence enabled
   ```
   or, if something's still wrong with the connection, errors on its first query (commonly
   `42P01: relation "sessions" does not exist` if migrations haven't actually been applied
   to that database yet — re-check step 2–4 against the exact `DATABASE_URL` the running
   service is using).

6. **Sanity check end-to-end**: hit the running service's `/api/admin/overview` endpoint —
   a clean `{"rooms":[]}` (or real data, if devices have already connected) means the schema
   and connection are both good.

## When the schema changes later

If you add or change a table in `apps/api/src/db/schema.ts`, generate a new migration file
before repeating the steps above against any database:

```bash
pnpm --filter @confpresence/api db:generate
```

This writes a new `NNNN_*.sql` file into `apps/api/drizzle/` reflecting the diff. Commit it,
then run `db:migrate` (steps 2–4 above) against each database that needs to catch up —
`drizzle-kit` only applies what a given database hasn't seen yet, so re-running it against
an already-migrated database is always safe (it's a no-op).
