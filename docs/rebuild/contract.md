# EduSched rebuild: the contract

The API (agent 1, `api/`) and the app (agent 2, `frontend/`) both build against this file.
If something here is wrong or missing, change this file in the same commit as the code and say so in the commit message.
`api/src/contract.ts` holds these shapes as TypeScript; `frontend/src/contract.ts` is a byte-identical copy. Change both together.

Plan this implements: the "EduSched" section of the product plan (week grid, roles, codes, reschedule flow).
A visual reference for the week grid is the mockup in that plan; the tokens are in `docs/rebuild/tokens.css`.

## Hosts and sessions

- App: `https://edusched.amittal.dev` (Vercel, `frontend/`). API: `https://edusched-api.amittal.dev` (Worker, `api/`). Local: app on `http://localhost:5173`, API on `http://localhost:8787`.
- The two hosts are the same site, so the session is an **HttpOnly cookie on the API host**: `es_session`, `Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000` (30 days). Locally drop `Secure`.
- The app calls the API with `credentials: 'include'`. CORS: exact origins `https://edusched.amittal.dev`, `https://www.amittal.dev`, `http://localhost:5173`; `Access-Control-Allow-Credentials: true`; methods GET, POST, PUT, PATCH, DELETE.
- Every state-changing request must carry `Content-Type: application/json` (forces a preflight) and an allowed `Origin`; otherwise 403. This is the CSRF defence.
- The cookie value is a random 32-byte token (base64url). The `sessions` table stores SHA-256 of it, never the token.
- Passwords: the existing PBKDF2 helper in `api/src/password.ts`. Login and signup are rate-limited (Workers `ratelimits` binding, 5 per minute per IP → 429).
- The old JWT/localStorage token and `X-Sandbox-Id` go away.

## Errors

Every non-2xx JSON body is `{ "error": string, "code": ErrorCode, ...extra }`. `error` is a sentence a person can read ("CR-201 is booked at 10:00 by CS203."), `code` is for the app:
`bad_request | unauthenticated | forbidden | not_found | conflict | clash | rate_limited | too_large | server`.
401 means "sign in"; 403 means signed in but not allowed.

## Data model (Postgres on Neon)

A fresh schema `api/db/schema.sql` (replace the old one; the demo is re-seeded and there is no production data to migrate). Every row below except `users` and `sessions` has `workspace_id` with `ON DELETE CASCADE`.

| Table | Columns (types are indicative) |
|---|---|
| users | id, email (unique, lower-cased), name, password_hash, created_at |
| sessions | id (sha256 of token, text pk), user_id null, demo_workspace_id null, acting_role, acting_id, created_at, last_seen_at, expires_at, user_agent |
| workspaces | id, slug (unique, url-safe), name ("Computer Science"), institution ("Thapar Institute"), timezone (IANA, default Asia/Kolkata), days smallint[] (ISO weekdays shown, default {1,2,3,4,5}), published_at null, is_demo bool, expires_at null (demo copies), created_by, created_at |
| members | workspace_id, user_id, role `coordinator \| teacher`, teacher_id null (which teacher row this account is), pk(workspace_id,user_id) |
| teachers | id, workspace_id, name, short (initials, e.g. "NR"), email null |
| rooms | id, workspace_id, name ("CR-201"), capacity, building null, kind `lecture \| lab` |
| batches | id, workspace_id, name ("CSE-2A"), size null, code unique (the class code, e.g. `CSE2A-K7QD`) |
| courses | id, workspace_id, code ("CS201"), name, color smallint 1..8, teacher_id |
| periods | id, workspace_id, idx, start_time, end_time, label null ("Lunch"), is_break bool |
| classes | id, workspace_id, course_id, batch_id, teacher_id, room_id, day_of_week (ISO 1..7), start_time, end_time. The weekly timetable |
| changes | id, workspace_id, class_id, occurs_on date (the regular occurrence being changed), kind `cancelled \| moved`, to_date, to_start, to_end, to_room_id (moved only), reason null, created_by (name as text), created_at. Unique (class_id, occurs_on) |
| invites | code (pk), workspace_id, role `teacher \| coordinator`, teacher_id null, created_by, expires_at, used_by null, used_at null |
| reset_codes | code_hash pk, user_id, workspace_id, expires_at, used_at null. Issued by a coordinator for a member |
| feeds | token pk (random), workspace_id, kind `batch \| teacher \| room`, target_id, created_by |
| follows | user_id, batch_id, pk(both). Students who signed in to sync their followed batches |

Changes are **per occurrence**: "cancel Tuesday 29 Sep" affects only that date. This replaces `valid_until` overlays and the sandbox column. The clash logic in `api/src/data.ts` (the `BUSY` CTE, `findClashes`, the advisory locks taken in class → room+date → teacher+date order) is kept and adapted. A batch also cannot be in two classes at once, so clashes are `room | teacher | batch` (lock order class → room+date → teacher+date → batch+date). The race test (two moves into one slot → exactly one 201, one 409) must still pass.

Half-open times, `HH:MM` strings on the wire, dates `YYYY-MM-DD` in the workspace's timezone.

## Roles and access

| Who | How | Can |
|---|---|---|
| Coordinator | account + member role `coordinator` (whoever creates the workspace) | everything in the workspace |
| Teacher | account + member role `teacher` linked to a `teachers` row (joins with an invite code) | read the whole workspace; cancel/move/undo **their own** classes only |
| Student | class code, no account | read that batch's week, changes and calendar feed through `/api/public/:code/*` |
| Visitor | `POST /api/demo` | a private copy of the demo college for 24 h, acting as any role |

Anyone can create a workspace (free). A workspace is readable only by its members until published; codes and public routes work only after `published_at` is set (demo copies are published).

## Routes

All JSON, prefix `/api`. `W` = `/api/w/:slug`. `(C)` coordinator only, `(T)` teacher or coordinator, `(M)` any member (a demo guest counts as whatever role it is acting as).

### Account
| Method, path | Body → response |
|---|---|
| POST /api/auth/signup | `{name,email,password}` (password ≥ 10 chars) → 201 `Me`, sets cookie. 409 `conflict` if the email exists |
| POST /api/auth/login | `{email,password}` → `Me`, sets cookie. 401 with one generic message |
| POST /api/auth/logout | → 204, clears cookie, deletes the session |
| GET /api/auth/me | → `Me` or 401 |
| PATCH /api/auth/me | `{name?, email?}` → `Me` (settings → profile). 409 `conflict` if the email belongs to another account. **Requested by the app, not in `api/` yet** |
| GET /api/auth/sessions | → `SessionInfo[]` (current one flagged) |
| DELETE /api/auth/sessions/:id | → 204 (sign out another device) |
| POST /api/auth/password | `{current,next}` → 204, other sessions revoked |
| POST /api/auth/reset | `{email,code,password}` → 204 (code from a coordinator) |
| DELETE /api/auth/account | `{password}` → 204. Refused (409) while the user is the only coordinator of a workspace with other members |
| GET /api/me/follows, PUT /api/me/follows | `FollowedBatch[]` ↔ `{codes:string[]}`: sync a student's followed batches |

### Workspaces and setup
| Method, path | |
|---|---|
| POST /api/workspaces | `{name,institution,timezone?}` → 201 `WorkspaceSummary`; caller becomes coordinator; default periods 09:00–17:00 hourly with a 13:00 lunch break |
| GET W | → `WorkspaceFull` (M) |
| PATCH W | name, institution, timezone, days (C) |
| POST W/publish, POST W/unpublish | (C) |
| PUT W/periods | `Period[]` replace all (C) |
| GET/POST W/rooms, PATCH/DELETE W/rooms/:id | (C for writes) |
| same for W/teachers, W/batches, W/courses, W/classes | POST takes the shape without `id` (and without `hasAccount` / `code`, which the server sets) → 201 with the created object; PATCH takes any subset of those fields → the updated object; GET → the array. Deleting something in use → 409 `conflict` naming what uses it. POST W/batches generates the code; POST W/batches/:id/code rotates it. Creating or editing a class runs the same clash check and returns 409 `clash` |
| POST W/import | `{kind:'rooms'\|'teachers'\|'batches'\|'courses'\|'classes', csv:string, dryRun:boolean}` → `ImportReport`. Classes CSV columns: `day,start,end,course,batch,room,teacher?` (day as Mon..Sun or 1..7; course/batch/room/teacher by code/name). Nothing is written if any row fails (C) |
| GET W/import/template/:kind | → text/csv with the header and two example rows |
| GET W/members, DELETE W/members/:userId, PATCH W/members/:userId `{role}` | → `Member[]` / 204 / `Member` (C) |
| GET W/invites, DELETE W/invites/:code | → `Invite[]` (unused and unexpired, newest first) / 204 revoke (C). **Requested by the app, not in `api/` yet** |
| POST W/invites | `{role,teacherId?}` → `{code, expiresAt}` (7 days) (C) |
| POST W/members/:userId/reset-code | → `{code, expiresAt}` (1 hour, single use) (C) |
| POST /api/join | `{code}`: a teacher invite (requires a signed-in user; creates the membership) → `{workspace: WorkspaceSummary}`; or a batch code (no session needed) → `FollowedBatch` |

### Timetable
| Method, path | |
|---|---|
| GET W/week?start=YYYY-MM-DD&batch=ID\|teacher=ID\|room=ID | → `Week` (M). `start` is any date in the week; the response is normalised to Monday. No filter = everything (coordinator view) |
| GET W/today?batch=\|teacher= | → `Occurrence[]` for today in the workspace timezone |
| GET W/changes?start=&end= | → `Change[]` newest first (M) |
| GET W/free-rooms?date&start&end&exclude=classId | → `Room[]` (M) |
| GET W/classes/:id/slots?week=YYYY-MM-DD | → `SlotAvailability[]` for every shown day × non-break period of that week from today on: whether the teacher or the batch is busy, and the free rooms that fit the batch (T). Each slot starts at a period start and lasts as long as the class (a 2-hour lab spans two periods); slots that would run into a break or past the last period, or that have already started, are left out. The class's own occurrence that week does not make the teacher, batch or its room busy |
| POST W/classes/:id/cancel | `{date, reason?}` → 201 `Change` (T own). 409 `conflict` if that occurrence already changed |
| POST W/classes/:id/move | `{date, toDate, toStart, toEnd, roomId, reason?}` → 201 `Change`; 409 `clash` with `{clashes: Clash[], suggestion: SlotAvailability \| null}` (the next free slot the same day or later that week) (T own) |
| DELETE W/changes/:id | undo → 204 (T own, or C) |
| POST W/feeds | `{kind,targetId}` → `{url}` (M) |

### Students (no account)
| Method, path | |
|---|---|
| GET /api/public/:code | → `FollowedBatch` or 404 |
| GET /api/public/:code/week?start= | → `Week` |
| GET /api/public/:code/today | → `Occurrence[]` |
| GET /api/public/:code/changes | → `Change[]` for that batch, last 14 days and upcoming |

Codes are case-insensitive, formatted `<BATCH>-<4 chars>` from an alphabet without 0/O/1/I/L. Rate-limit `/api/public/*` and `/api/join` (60 per minute per IP) so codes cannot be guessed.

### Calendar feeds
- `GET /ics/b/:code.ics`: a batch's classes for the past 2 and next 8 weeks with changes applied (cancelled → `STATUS:CANCELLED`; moved → the new time, `DESCRIPTION` says from where). `GET /ics/f/:token.ics` for teacher and room feeds.
- Valid RFC 5545: CRLF lines, folding at 75 octets, `TZID` with a VTIMEZONE for the workspace timezone, stable `UID` = `<classId>-<date>@edusched.amittal.dev`. `Cache-Control: max-age=900`.

### Demo
| Method, path | |
|---|---|
| POST /api/demo | → 201 `Me` with a guest session (no user row: `sessions.demo_workspace_id` set) and a fresh copy of the demo college, `expires_at` now + 24 h, acting as coordinator. Rate limit 5 per 10 minutes per IP |
| GET /api/demo/week?start=&batch=<name> | → `Week` of the demo college, no session (front page and `/embed`); see “Decisions made while building the API” |
| POST W/demo/act-as | `{role:'coordinator'}` \| `{role:'teacher',teacherId}` \| `{role:'student',batchId}` → `Me`. Only on your own demo workspace |

The demo college extends the current seed (a CS/ECE department: CSE-2A, CSE-2B, ECE-2A, five teachers, six rooms) so each batch has a full Mon–Fri week with a lunch break and a lab block, plus 3 changes placed in the current week at copy time (one cancelled, two moved) so the Changes screen is never empty. Keep it as data (`api/db/demo.json` or SQL) and clone it in one transaction. The hourly cron deletes expired demo workspaces and expired sessions.

## Shapes

```ts
export type Role = 'coordinator' | 'teacher' | 'student'
export type ErrorCode = 'bad_request' | 'unauthenticated' | 'forbidden' | 'not_found' | 'conflict' | 'clash' | 'rate_limited' | 'too_large' | 'server'
export interface ApiError { error: string; code: ErrorCode; clashes?: Clash[]; suggestion?: SlotAvailability | null }
export interface Me {
  user: { id: number; name: string; email: string } | null        // null for a demo guest
  demo: { workspace: string; actingAs: { role: Role; teacherId?: number; batchId?: number }; expiresAt: string } | null
  memberships: { workspace: WorkspaceSummary; role: 'coordinator' | 'teacher'; teacherId: number | null }[]
}
export interface WorkspaceSummary { id: number; slug: string; name: string; institution: string; timezone: string; published: boolean; isDemo: boolean }
export interface Period { idx: number; start: string; end: string; label: string | null; isBreak: boolean }
export interface Room { id: number; name: string; capacity: number; building: string | null; kind: 'lecture' | 'lab' }
export interface Teacher { id: number; name: string; short: string; email: string | null; hasAccount: boolean }
export interface Batch { id: number; name: string; size: number | null; code: string }
export interface Course { id: number; code: string; name: string; color: number; teacherId: number | null }
export interface ClassRow { id: number; courseId: number; batchId: number; teacherId: number; roomId: number; day: number; start: string; end: string }
export interface WorkspaceFull {
  workspace: WorkspaceSummary & { days: number[] }
  role: Role; teacherId: number | null; batchId: number | null    // batchId only for a demo guest acting as a student
  periods: Period[]; rooms: Room[]; teachers: Teacher[]; batches: Batch[]; courses: Course[]; classes: ClassRow[]
}
export interface Occurrence {
  key: string                    // `${classId}:${date}`; a moved-in copy is `${classId}:${date}:to`
  classId: number
  date: string; start: string; end: string
  course: { id: number; code: string; name: string; color: number }
  teacher: { id: number; name: string; short: string }
  room: { id: number; name: string }
  batch: { id: number; name: string }
  status: 'scheduled' | 'cancelled' | 'moved-away' | 'moved-here'
  change: Change | null
}
export interface Week { start: string; end: string; days: string[]; timezone: string; periods: Period[]; occurrences: Occurrence[]; today: string }
export interface Change {
  id: number; classId: number; kind: 'cancelled' | 'moved'
  course: { code: string; name: string; color: number }; batch: { id: number; name: string }
  from: { date: string; start: string; end: string; room: string }
  to: { date: string; start: string; end: string; room: string } | null
  reason: string | null; by: string; at: string
}
export interface Clash { type: 'room' | 'teacher' | 'batch'; classId: number; course: string; start: string; end: string; room: string | null }
export interface SlotAvailability { date: string; start: string; end: string; teacherBusy: boolean; batchBusy: boolean; freeRooms: { id: number; name: string; capacity: number }[] }
export interface FollowedBatch { code: string; workspace: { name: string; institution: string; timezone: string; days: number[] }; batch: { id: number; name: string }; periods: Period[] }
export interface SessionInfo { id: string; current: boolean; userAgent: string | null; createdAt: string; lastSeenAt: string }
export interface ImportReport { ok: boolean; created: number; updated: number; errors: { line: number; column?: string; message: string }[] }
export interface Member { userId: number; name: string; email: string; role: 'coordinator' | 'teacher'; teacherId: number | null }
export interface Invite { code: string; role: 'teacher' | 'coordinator'; teacherId: number | null; expiresAt: string; createdAt: string }   // requested by the app, see the last section
```

## Limits (free tier)

Per workspace: 200 rooms, 300 teachers, 200 batches, 500 courses, 3,000 classes; changes older than 180 days are pruned by the cron. A user can create at most 5 workspaces. CSV import ≤ 512 KB; other JSON bodies ≤ 64 KB. Health checks stay on `/api/test` (never touches Neon). `/internal/stats` and `/internal/cleanup` keep working for the Switchboard: same keys where they still make sense (`dbBytes`, `users`), `overlays` becomes `changes`, `sandboxes24h` becomes `demoCopies`; add `workspaces`.

## The student device

The app keeps followed codes in `localStorage['edusched.follows']` as `FollowedBatch[]`, and caches the last `Week` per code and week under `edusched.cache.<code>.<weekStart>` for offline use. "Sign in to sync" pushes them to `/api/me/follows` and merges.

## Decisions made while building the API

Gaps the sections above left open, and how `api/` fills them. Where one of these changes a shape, `api/src/contract.ts` already has it and `frontend/src/contract.ts` must copy it.

**Shapes and responses**
- New shape `Member` (above) for `GET W/members`; `PATCH W/members/:userId` returns the updated `Member`.
- `PATCH W`, `POST W/publish`, `POST W/unpublish` → `WorkspaceSummary`. `PUT W/periods` → `Period[]`: the body's `idx` is ignored, periods are sorted by start and renumbered from 1; overlaps are a 400. `GET W/periods` also exists.
- Setup rows: `POST` → 201 with the row (`Room`, `Teacher`, `Batch`, `Course`, `ClassRow`), `PATCH` (partial) → 200 with the row, `DELETE` → 204. `POST W/batches/:id/code` → the `Batch` with its new code. A class without `teacherId` takes its course's teacher (400 if the course has none). Teacher `short` is unique per workspace and defaults to the name's initials.
- `POST W/invites` and `POST W/members/:userId/reset-code` → 201 `{code, expiresAt}`. `POST W/feeds` → 200 `{url}` on the API host (`/ics/f/<token>.ics`); the same member asking again for the same target gets the same URL.
- A demo guest's `Me.memberships` is `[]`. The copy's slug is `Me.demo.workspace`; `GET W` gives the acting role.
- A moved-in copy's key is `${classId}:${originalDate}:to`, where the date is the occurrence that moved (its `change.from.date`), not the new date. That keeps keys unique when two meetings move to the same day.

**Rules**
- Cancel and move refuse (400) a date the class does not meet on, or one before today; move refuses a target in the past or on a day the workspace does not show.
- Undo (`DELETE W/changes/:id`) re-checks the class's regular slot under the same locks and answers 409 `clash` if someone has taken it since.
- Editing a class's day or times deletes that class's changes from today on (they no longer name real meetings).
- `GET W/classes/:id/slots?week=&from=`: `from` (optional) is the date of the occurrence being moved, so its own booking does not make a slot busy. Each slot starts at a non-break period and lasts as long as the class (a two-hour lab gets two-hour slots); slots that would cross a break, run past the last period, or have already started are left out. `freeRooms` holds rooms with capacity ≥ the batch size (any room if the size is unset), smallest first.
- The move 409's `suggestion` is the first slot where the teacher and batch are free and a room fits, on `toDate` at or after `toStart`, else later that week; `null` if none.
- `GET W/changes` without `start` means the last 14 days and everything after. A change is in a range if its original or its new date is.
- A demo guest (a session with no account) gets 403 from account-only routes: `/api/auth/sessions`, `/password`, `/account`, `/api/me/follows`, `POST /api/workspaces`.
- CSRF rule in practice: a bodyless `POST`/`DELETE` (logout, publish, undo) still sends `Content-Type: application/json`, e.g. with body `{}`.

**Codes and accounts**
- Invite codes look like `INV-7KQ2MWX9PT`; `/api/join` treats a code starting with `INV-` as an invite and anything else as a class code. Teacher invites require `teacherId`; a teacher row can be linked to one account. Joining a workspace you are in, or a teacher already linked, is 409. Invites do not work in demo copies (400).
- Reset codes look like `K7QD-M2PX`; a wrong, used or expired code is 400. A reset signs out every session of that account.
- The auth rate limit (5/min/IP) covers signup, login, reset, password change and account deletion. The public limit (60/min/IP) covers `/api/public/*` and `/api/join`; `/ics/*` is not limited.

**Demo**
- Workers rate-limit bindings only count per 10 or 60 seconds, so the demo limit (5 copies per 10 minutes per IP) is counted in Postgres: `workspaces.demo_ip_hash` holds SHA-256 of the client IP for demo copies. A guest who opens the demo again gets a fresh copy and the old one is deleted.
- `GET /api/demo/week?start=YYYY-MM-DD&batch=<name>` → `Week`: the demo college built in memory from `api/db/demo.json` (no session, no database), for the signed-out front page. Default batch `CSE-2A`; 404 for an unknown batch. The three sample changes sit in the current week. `Cache-Control: public, max-age=300`.
- The demo college has seven rooms (the old six plus CR-204) and 11 courses, including two lab courses held in two-hour blocks.

**CSV import**
- A header row is required; columns are matched by name, case-insensitively, in any order. Rooms `name,capacity,building?,kind?`; teachers `name,short?,email?`; batches `name,size?`; courses `code,name,teacher?,color?` (teacher by initials or name).
- Existing rows are matched by room name, teacher initials (or name when no initials are given), batch name, course code, all case-insensitive, and updated with the file's values (including its spelling). New batches get fresh codes. A class identical to an existing one is skipped, so re-importing a timetable is harmless; `updated` is always 0 for classes.
- Errors are line numbers of the file (the header is line 1; a quoted value spanning lines counts from its first line), with `column` when one column is at fault. Class rows are clash-checked against the timetable and against earlier rows of the same file.

**Switchboard**
- `/internal/stats` → `{dbBytes, users, changes, demoCopies, workspaces}` (`demoCopies` = live demo copies, `workspaces` = real ones). `/internal/cleanup` → `{deleted, demoCopies, sessions, changes, codes}`, `deleted` being the total.

## Requested by the app (not in `api/` yet)

The app calls these and degrades without them (the pending-invites list stays hidden; saving the profile shows the API's error). `frontend/src/contract.ts` has `Invite`; add it to `api/src/contract.ts` with the routes.
- `GET W/invites` → `Invite[]` (unused, unexpired, newest first) and `DELETE W/invites/:code` → 204 (C): list and revoke outstanding teacher/coordinator invites in Setup → Codes and members.
- `PATCH /api/auth/me` `{name?, email?}` → `Me`; 409 `conflict` if the email belongs to another account (Settings → Profile).
