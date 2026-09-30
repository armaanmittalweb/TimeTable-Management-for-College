# EduSched API (Cloudflare Workers + Neon Postgres)

The multi-tenant timetable API behind `edusched.amittal.dev`. A [Hono](https://hono.dev) Worker on
`edusched-api.amittal.dev`, talking to Postgres through `@neondatabase/serverless`: single queries go
over HTTP, and each transaction opens a WebSocket `Pool` that lives only for that transaction.

The spec is [`docs/rebuild/contract.md`](../docs/rebuild/contract.md): every route, table, shape and
limit, plus a closing section of decisions made while building it. `src/contract.ts` holds the shapes
as TypeScript and must stay identical to `frontend/src/contract.ts`.

```
src/
  index.ts          Worker entry: fetch + scheduled (hourly cleanup)
  app.ts            CORS, CSRF rule, body limits, db + session per request, routes, error shape
  contract.ts       the shared TypeScript shapes
  routes/           auth (accounts, sessions, follows), workspaces (settings, periods, members,
                    invites), setup (rooms ... classes, CSV import), timetable (week, today,
                    changes, free rooms, slots, cancel/move/undo, feeds), public (class codes,
                    /api/join), ics (calendar feeds), demo (copies, act-as, the static demo week)
  data/             all SQL; each function takes a Db, so it runs on Neon, node-postgres or PGlite
  session.ts        cookie sessions (random token in the cookie, SHA-256 in the table)
  access.ts         workspace resolution (404 for non-members) and role checks
  week.ts slots.ts  pure: occurrences from classes + changes; reschedule slot availability
  ics.ts csv.ts     pure: RFC 5545 output with VTIMEZONE; RFC 4180 input with line numbers
  importer.ts       CSV import: validate every row, then write in bulk, or nothing
db/schema.sql       the schema (fresh; there is no migration from the old demo schema)
db/demo.json        the demo college, copied per visitor
test/               vitest + PGlite (Postgres in WASM, in-process); race.test.ts needs real Postgres
```

## How it works

**Tenancy.** Every table except `users` and `sessions` has `workspace_id`, and every query filters
on it. Classes and changes use composite foreign keys (`(workspace_id, room_id)` and so on), so a
class cannot point at another workspace's room even if application code slipped. A caller who is
not a member gets 404 for a workspace, never 403, so slugs do not leak.

**Sessions and CSRF.** `es_session` is an HttpOnly, SameSite=Lax cookie holding 32 random bytes;
the `sessions` table stores their SHA-256. Every state-changing `/api` request must come from an
allowed `Origin` with `Content-Type: application/json` (which forces a CORS preflight), or it gets 403.

**Changes are per occurrence.** "Cancel Tuesday 29 Sep" is a `changes` row for `(class, 2026-09-29)`.
A week is assembled from the weekly `classes` plus the changes touching those dates (`week.ts`).

**Clash checks under advisory locks.** A move runs in one transaction: lock the class, then
room+date, teacher+date and batch+date (always in that order, so two moves cannot deadlock), then
re-check clashes against the timetable plus committed changes, then insert. The locks are
transaction-scoped (`pg_advisory_xact_lock`), so they are released at COMMIT and are safe behind
Neon's transaction pooler. Row locks would not work: the row that would clash is the one another
transaction has not inserted yet. `test/race.test.ts` fires pairs of simultaneous moves for a room,
a teacher and a batch and expects exactly one winner each time (it fails if the room lock is removed).

**Demo.** `POST /api/demo` copies `db/demo.json` into a new published workspace in one transaction
and starts a guest session (no user row) acting as coordinator; `POST W/demo/act-as` switches to a
teacher or a batch. Copies expire after 24 hours and the hourly cron deletes them. The signed-out
front page reads `GET /api/demo/week`, built in memory from the same JSON.

**Passwords.** PBKDF2-SHA256 via WebCrypto, 20,000 iterations (about 4 ms, inside the free plan's CPU
budget; the count is stored per hash so it can be raised). Login compares against a decoy hash for
unknown emails so timing does not reveal which emails have accounts.

## Environment

| name             | kind      | value |
|------------------|-----------|-------|
| `DATABASE_URL`   | secret    | Neon **pooled** connection string |
| `INTERNAL_KEY`   | secret    | shared with the Switchboard; unlocks `/internal/stats` and `/internal/cleanup` (unset: they 404) |
| `AUTH_LIMITER`   | ratelimit | 5 per 60 s per IP: signup, login, reset, password change, account deletion |
| `PUBLIC_LIMITER` | ratelimit | 60 per 60 s per IP: `/api/public/*`, `/api/join` |

The rate-limit bindings are declared in `wrangler.jsonc`. When a binding is missing (tests,
`dev:local`) there is simply no limit. The demo limit (5 copies per 10 minutes per IP) is counted in
Postgres, because the bindings only support 10- and 60-second windows. `JWT_SECRET`, `DEMO_MODE`
and `TIMEZONE` are gone: sessions are cookies and each workspace has its own timezone.

## Set up the database

The schema replaces the old one; there is no data to migrate.

```sh
cd api
npm install
DATABASE_URL='<direct (non-pooled) connection string>' npm run db:setup
```

It runs `db/schema.sql` in one transaction and stops if the tables already exist. To start over, run
`DROP SCHEMA public CASCADE; CREATE SCHEMA public;` in the Neon SQL editor first.

## Run locally

```sh
npm run dev:local        # http://localhost:8787, PGlite in memory
```

`scripts/dev-local.ts` serves the same app on Node against in-process PGlite loaded with the schema,
plus an account and a workspace copied from the demo college:

- sign in as `dev@edusched.test` / `edusched-dev`, workspace slug `dev-college`
- or `POST /api/demo` for a guest copy, as the site does

Set `DATABASE_URL=postgresql://...` to use a local Postgres instead (load the schema with
`npm run db:setup` first). The frontend runs on `http://localhost:5173`, which CORS allows; the
cookie drops `Secure` on plain http. With wrangler and Neon instead: put `DATABASE_URL` in
`api/.dev.vars` and run `npm run dev`. Cron handlers do not fire under `wrangler dev`; request
`/cdn-cgi/local/scheduled` to run the cleanup by hand.

## Tests

```sh
npm test            # vitest on PGlite; no server or database needed
npm run typecheck   # worker sources (workers types), then tests and scripts (node types)
```

The app is exercised through `app.request()` with a small cookie-keeping browser (`test/helpers.ts`).
The suites cover accounts and sessions (cookie flags, CSRF, logout revocation, password change and
reset), workspaces and setup, per-occurrence changes and clash refusals, teacher ownership, tenant
isolation on every workspace route, class codes and calendar feeds (checked with `ical.js`), CSV
import, the demo copy, cleanup and the `/internal` routes.

PGlite is a single connection, so it cannot show a race. `test/race.test.ts` runs only when
`TEST_DATABASE_URL` points at a real Postgres; it creates and drops its own schema:

```sh
TEST_DATABASE_URL='postgresql://user:pass@localhost:5432/postgres' npm test
```

## Deploy (needs the Cloudflare account)

```sh
npx wrangler secret put DATABASE_URL   # pooled Neon string
npx wrangler secret put INTERNAL_KEY   # if not already set
npx wrangler deploy
```

`wrangler.jsonc` declares the custom domain, the two rate-limit bindings and the hourly cron.
The old `JWT_SECRET` secret is no longer read and can be deleted (`wrangler secret delete JWT_SECRET`).
