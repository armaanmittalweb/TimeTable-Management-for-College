# EduSched API (Cloudflare Workers + Neon Postgres)

A TypeScript port of `server/` (Express + MySQL) to a [Hono](https://hono.dev) Worker. It uses the
same paths and response bodies, so the existing React frontend can talk to it. Postgres is reached
through `@neondatabase/serverless`: plain queries go over HTTP, and transactions go over a
WebSocket `Pool` that is opened and closed inside each request.

```
src/
  index.ts           Worker entry: fetch + scheduled (cleanup cron)
  app.ts             Hono app factory: CORS, per-request db/today, /api/health, routes
  routes/            auth.ts, timetable.ts: same paths as server/routes/*
  middleware/        auth.ts (JWT, isProfessor), sandbox.ts (X-Sandbox-Id)
  data.ts            all SQL; takes a Db, so it runs on Neon, node-postgres or PGlite
  db.ts              Db interface + Neon and pg-Pool adapters
  password.ts        PBKDF2-SHA256 via WebCrypto
db/schema.sql        Postgres schema (ported from ../database.sql)
db/seed.sql          demo college (generated clash-free)
test/                vitest + PGlite (Postgres compiled to WASM, in-process)
```

## Demo accounts (from `db/seed.sql`)

| role      | username        | password        | notes                                         |
|-----------|-----------------|-----------------|-----------------------------------------------|
| professor | `prof.meera`    | `edusched-demo` | teaches CS201 and CS207 to CSE-2A and CSE-2B  |
| student   | `student.aarav` | `edusched-demo` | batch CSE-2A                                  |

All other seeded users have the unusable password `!locked`. To set one, run
`npm run hash-password -- '<password>'` and `UPDATE users SET password = '<output>' WHERE username = ...`.

## Environment

| name           | kind   | value                                                                     |
|----------------|--------|---------------------------------------------------------------------------|
| `DATABASE_URL` | secret | Neon **pooled** connection string (`...-pooler...neon.tech/...?sslmode=require`) |
| `JWT_SECRET`   | secret | long random string, e.g. `openssl rand -base64 48`                        |
| `DEMO_MODE`    | var    | `"true"` (default): per-visitor sandboxes, registration closed. `"false"`: writes go to the shared layer and `/register` is open |
| `TIMEZONE`     | var    | IANA zone for "today" (expiry, earliest allowed postpone date). Default `Asia/Kolkata` |

Locally, secrets go in `api/.dev.vars` (gitignored; see `.dev.vars.example`). `vars` live in `wrangler.jsonc`.

## Set up the database on Neon

1. Create a Neon project (free tier) and a database, e.g. `edusched`.
2. Copy two connection strings from the dashboard: the **direct** one (for DDL) and the **pooled** one (for the Worker).
3. Load the schema and seed data (no `psql` needed):
   ```sh
   cd api
   npm install
   DATABASE_URL='<direct connection string>' npm run db:setup
   ```
   It runs both files in one transaction and stops if the tables already exist. To start over, run
   `DROP SCHEMA public CASCADE; CREATE SCHEMA public;` in the Neon SQL editor. You can also paste
   `db/schema.sql` and then `db/seed.sql` into the SQL editor instead.

## Run locally

```sh
cd api
cp .dev.vars.example .dev.vars    # fill in DATABASE_URL (pooled) and JWT_SECRET
npm run dev                       # http://localhost:8787, e.g. /api/health
```

### Without Neon (dev only)

```sh
npm run dev:local                 # http://localhost:8787, PGlite in memory, seeded on every start
```

`scripts/dev-local.ts` serves the same Hono app on Node (`@hono/node-server`) against an in-process
PGlite loaded with `db/schema.sql` + `db/seed.sql`, with `DEMO_MODE=true` and a hard-coded dev JWT
secret. It is for frontend work only: never deploy it. PGlite is one connection, so the frontend's
RACE demo is serialized rather than truly concurrent (still one 201 and one 409).

Frontend: set `VITE_API_URL=http://localhost:8787` in `frontend/.env` (see `frontend/.env.example`).
Cron handlers don't fire during `wrangler dev`. To run the cleanup by hand, request
`http://localhost:8787/cdn-cgi/local/scheduled`.

## Tests

```sh
npm test          # vitest; loads schema + seed into PGlite, no server needed
npm run typecheck # worker sources (workers types) + tests (node types)
```

The data layer is tested directly, and the Hono app through `app.request()`. The tests cover login,
student and professor reads, cancel, free rooms, postponing (success, room clash 409, professor clash
409, clashes with earlier postponements), sandbox isolation, and expiry cleanup.

PGlite is a single connection, so it can't show a real race. `test/race.test.ts` fires two
simultaneous postpones for the same room and slot and expects exactly one `201` and one `409`. It is
skipped unless `TEST_DATABASE_URL` points at a real Postgres. It creates and drops its own schema, so
a Neon branch or a local server works:

```sh
TEST_DATABASE_URL='postgresql://user:pass@host/db' npm test
```

## Deploy (needs your Cloudflare account)

```sh
npx wrangler login
npx wrangler secret put DATABASE_URL   # pooled Neon string
npx wrangler secret put JWT_SECRET
npx wrangler deploy
```

Then add a route or custom domain (e.g. `api.edusched.amittal.dev`) in `wrangler.jsonc` or the dashboard.
CORS allows `https://edusched.amittal.dev`, `https://www.amittal.dev` and `http://localhost:5173` (`src/app.ts`).

## API

All timetable routes need `Authorization: Bearer <token>`. In demo mode they also read an
`X-Sandbox-Id` header and echo it back. If the header is missing, the API creates an id and returns it.

| method | path                               | who       | notes |
|--------|------------------------------------|-----------|-------|
| GET    | `/api/health`                      | anyone    | `{status, db}`; 503 if the DB is unreachable |
| GET    | `/api/test`                        | anyone    | `{message: 'API is working'}` (kept from Express) |
| POST   | `/api/auth/register`               | anyone    | 201; 403 in demo mode; 409 on a duplicate |
| POST   | `/api/auth/login`                  | anyone    | `{token}`: HS256 JWT `{id, role, batch}`, 24 h |
| GET    | `/api/timetable/timetable`         | any user  | student: their batch; professor: their courses; each row carries its active overlay |
| GET    | `/api/timetable/class/:id`         | any user  | `[classRow]`, 404 if missing |
| POST   | `/api/timetable/available-rooms`   | any user  | `{date, startTime, endTime, classId?}` → rooms free in that slot |
| POST   | `/api/timetable/cancel-class`      | professor | `{classId}`: own classes only; valid until Sunday |
| POST   | `/api/timetable/postpone-class`    | professor | `{classId, newDate, newStartTime, newEndTime, newClassroomId, validUntil?}` → 201, or 409 `{error, clashes:[{type:'room'|'professor', class_id, course_code, ...}]}` |
| POST   | `/api/timetable/confirm-postpone`  | professor | same as postpone-class (in Express it skipped all checks) |

## Design notes

**Overlays.** The API never writes to `regular_timetable`. A cancel or postpone inserts a
`modified_classes` row, and that row replaces the regular class for every occurrence up to
`valid_until`. A read joins at most one overlay per class: the newest unexpired visible one, with the
caller's sandbox winning over shared rows. Weekdays are ISO (1 = Monday), which is what the
frontend assumes. Time ranges are half-open, so back-to-back classes don't clash.

**Sandboxes.** `modified_classes.sandbox_id` is `NULL` for shared changes, or the visitor's token.
Reads see `sandbox_id IS NULL OR sandbox_id = <caller>`, and in demo mode every write carries the
caller's token. Visitors can only add overlays, so the base timetable and the shared layer stay the
same for everyone. The hourly cron (`scheduled` export) deletes overlays past `valid_until` and
sandbox overlays older than 24 hours.

**Clash check in a real transaction.** Postponing runs in one transaction:
`BEGIN` → lock the class → lock *room + date* → lock *professor + date* → re-check room and
professor clashes against the base timetable plus visible overlays → `INSERT` → `COMMIT`. A clash
returns 409 and lists every clash.

The locks are transaction-scoped advisory locks (`pg_advisory_xact_lock(hashtextextended(key, 0))`),
not `SELECT ... FOR UPDATE`. A clash means a conflicting row *exists*, and the row that would
conflict is exactly the one a concurrent transaction hasn't inserted yet. `FOR UPDATE` can't lock a
row that doesn't exist, so two transactions would both see "no conflict" and both insert. Locking
the parent `classrooms`/`users` rows would also work, but it would block unrelated work on those rows.
The advisory key uses room+date and not the exact slot, because overlapping slots with different
start times must also wait for each other. Transaction-scoped locks release at COMMIT or ROLLBACK,
so they are safe behind Neon's transaction-mode pooler. The locks are always taken in the same order
(class, room, professor), so two postpones can't deadlock. The keys don't include the sandbox, which
keeps the check correct even if shared and sandboxed writes mix. The cost is a few milliseconds of
waiting between visitors who pick the same room or professor on the same day. The checks run under
READ COMMITTED after the locks are held, so they see whatever the previous lock holder committed.

**Passwords.** The Express app used bcrypt (cost 10), which is about 100 ms of CPU in JS, far over
the Workers free plan's ~10 ms. `password.ts` uses PBKDF2-SHA256 from WebCrypto (native): 20,000
iterations take about 4 ms. That count is well below OWASP's 600,000 for PBKDF2-SHA256, a deliberate
tradeoff for a free-tier demo. Each hash stores its own iteration count, so it can be raised later
(Workers allows up to 100,000). Existing bcrypt hashes are not accepted, so users from the old MySQL
database would have to reset their passwords.

**Frontend.** For demo changes to persist between requests, the frontend has to keep the
`X-Sandbox-Id` from the first response (e.g. in `localStorage`) and send it on every timetable call.
The current frontend doesn't do this yet. Without it, every request gets a fresh sandbox, so a
visitor's changes never show up.
