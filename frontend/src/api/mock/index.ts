// An in-memory EduSched API (VITE_API=mock). It answers the contract's paths with the contract's shapes, status
// codes and error bodies, keeps its state in localStorage so a reload keeps your changes, and treats a token in
// localStorage as the session cookie. Seeded accounts (password "timetable-demo"):
//   priya.menon@riverside.edu  coordinator of "riverside-cs"
//   meera.iyer@riverside.edu   teacher (Meera Iyer) in "riverside-cs"
// window.__esMock exposes reset(), raw() and latency for the screenshot script.

import type { ApiError, Batch, ClassRow, Course, ErrorCode, FollowedBatch, ImportReport, Invite, Me, Member, Period, Role, Room, SessionInfo, Teacher, WorkspaceFull, WorkspaceSummary } from '../../contract';
import type { Method, RawResponse, Transport } from '../index';
import { addDays, dow, isDate, mondayOf, nowIn, toMin, DAY_SHORT } from '../../lib/time';
import { parseCsv } from './csv';
import { clashes, occurrences, slots, toChange, week, type Filter } from './logic';
import { buildCollege, emptyWorkspace, type ChangeRow, type WsRow } from './seed';

interface UserRow { id: number; email: string; name: string; password: string; createdAt: string }
interface SessionRow {
  id: string; userId: number | null; demoWs: number | null; acting: { role: Role; teacherId?: number; batchId?: number };
  createdAt: string; lastSeenAt: string; expiresAt: string; userAgent: string | null;
}
interface InviteRow { code: string; wsId: number; role: 'teacher' | 'coordinator'; teacherId: number | null; createdBy: number; createdAt: string; expiresAt: string; usedBy: number | null }
interface DB {
  v: 1; seq: number; users: UserRow[]; sessions: SessionRow[]; workspaces: WsRow[]; invites: InviteRow[];
  resetCodes: { code: string; userId: number; wsId: number; expiresAt: string; usedAt: string | null }[];
  feeds: { token: string; wsId: number; kind: string; targetId: number }[]; follows: { userId: number; code: string }[];
}

const DB_KEY = 'edusched.mock.db';
const COOKIE_KEY = 'edusched.mock.cookie';
const PASSWORD = 'timetable-demo';
const now = () => Date.now();
const iso = (ms = now()) => new Date(ms).toISOString();

class Fail extends Error {
  constructor(public status: number, public code: ErrorCode, message: string, public extra: Partial<ApiError> = {}) {
    super(message);
  }
}
const bad = (m: string) => new Fail(400, 'bad_request', m);
const notFound = (m = 'Not found.') => new Fail(404, 'not_found', m);
const forbidden = (m = 'You can’t do that in this workspace.') => new Fail(403, 'forbidden', m);

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const rand = (n: number) => Array.from({ length: n }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');
const token = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');

function seed(): DB {
  const db: DB = { v: 1, seq: 1, users: [], sessions: [], workspaces: [], invites: [], resetCodes: [], feeds: [], follows: [] };
  const id = () => db.seq++;
  const created = iso(now() - 60 * 86_400_000);
  const priya: UserRow = { id: id(), email: 'priya.menon@riverside.edu', name: 'Priya Menon', password: PASSWORD, createdAt: created };
  const meera: UserRow = { id: id(), email: 'meera.iyer@riverside.edu', name: 'Meera Iyer', password: PASSWORD, createdAt: created };
  const kabir: UserRow = { id: id(), email: 'kabir.sethi@riverside.edu', name: 'Kabir Sethi', password: PASSWORD, createdAt: created };
  db.users.push(priya, meera, kabir);
  const ws = buildCollege({ id: id(), slug: 'riverside-cs', isDemo: false, nextId: id, now: now(), createdBy: priya.id });
  ws.members = [
    { userId: priya.id, role: 'coordinator', teacherId: null, joinedAt: created },
    { userId: meera.id, role: 'teacher', teacherId: ws.teachers.find((t) => t.short === 'MI')!.id, joinedAt: iso(now() - 38 * 86_400_000) },
    { userId: kabir.id, role: 'teacher', teacherId: ws.teachers.find((t) => t.short === 'KS')!.id, joinedAt: iso(now() - 35 * 86_400_000) },
  ];
  db.workspaces.push(ws);
  db.invites.push({ code: 'NR-' + rand(6), wsId: ws.id, role: 'teacher', teacherId: ws.teachers.find((t) => t.short === 'NR')!.id, createdBy: priya.id, createdAt: iso(now() - 2 * 86_400_000), expiresAt: iso(now() + 5 * 86_400_000), usedBy: null });
  // Two other devices, so the sessions list has something to sign out.
  for (const [ua, age] of [['Safari on iPhone', 3], ['Firefox on Ubuntu', 12]] as const) {
    db.sessions.push({ id: token(), userId: priya.id, demoWs: null, acting: { role: 'coordinator' }, createdAt: iso(now() - age * 86_400_000), lastSeenAt: iso(now() - age * 3_600_000), expiresAt: iso(now() + 20 * 86_400_000), userAgent: ua });
  }
  return db;
}

let db: DB = (() => {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as DB;
      if (parsed.v === 1) return parsed;
    }
  } catch {
    /* fall through to a fresh seed */
  }
  return seed();
})();
const persist = () => {
  try {
    localStorage.setItem(DB_KEY, JSON.stringify(db));
  } catch {
    /* in-memory only */
  }
};
const cookie = {
  get: () => {
    try {
      return localStorage.getItem(COOKIE_KEY);
    } catch {
      return null;
    }
  },
  set: (v: string | null) => {
    try {
      if (v) localStorage.setItem(COOKIE_KEY, v);
      else localStorage.removeItem(COOKIE_KEY);
    } catch {
      /* ignore */
    }
  },
};
const nextId = () => db.seq++;

// ---------- sessions and access ----------

function currentSession(): SessionRow | null {
  const t = cookie.get();
  const s = t ? db.sessions.find((x) => x.id === t) : null;
  if (!s || s.expiresAt < iso()) return null;
  if (s.demoWs && !db.workspaces.some((w) => w.id === s.demoWs)) return null;
  s.lastSeenAt = iso();
  return s;
}
function requireSession() {
  const s = currentSession();
  if (!s) throw new Fail(401, 'unauthenticated', 'Sign in to continue.');
  return s;
}
function requireUser() {
  const s = requireSession();
  const u = s.userId ? db.users.find((x) => x.id === s.userId) : null;
  if (!u) throw new Fail(401, 'unauthenticated', 'Sign in with an account to do that.');
  return { s, u };
}
function newSession(userId: number | null, demoWs: number | null): SessionRow {
  const s: SessionRow = {
    id: token(), userId, demoWs, acting: { role: 'coordinator' }, createdAt: iso(), lastSeenAt: iso(),
    expiresAt: iso(now() + (demoWs ? 24 : 720) * 3_600_000), userAgent: uaLabel(),
  };
  db.sessions.push(s);
  cookie.set(s.id);
  return s;
}
function uaLabel() {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /iPhone|iPad/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'this device';
  return `${browser} on ${os}`;
}

const summary = (w: WsRow): WorkspaceSummary => ({ id: w.id, slug: w.slug, name: w.name, institution: w.institution, timezone: w.timezone, published: !!w.publishedAt, isDemo: w.isDemo });

function me(s: SessionRow): Me {
  const u = s.userId ? db.users.find((x) => x.id === s.userId) ?? null : null;
  const demo = s.demoWs ? db.workspaces.find((w) => w.id === s.demoWs) : null;
  return {
    user: u ? { id: u.id, name: u.name, email: u.email } : null,
    demo: demo ? { workspace: demo.slug, actingAs: s.acting, expiresAt: demo.expiresAt! } : null,
    memberships: u
      ? db.workspaces.flatMap((w) => w.members.filter((m) => m.userId === u.id).map((m) => ({ workspace: summary(w), role: m.role, teacherId: m.teacherId })))
      : [],
  };
}

interface Access { ws: WsRow; role: Role; teacherId: number | null; batchId: number | null; s: SessionRow; name: string }
function access(slug: string): Access {
  const s = requireSession();
  const ws = db.workspaces.find((w) => w.slug === slug);
  if (!ws) throw notFound('There is no workspace at this address.');
  if (s.demoWs === ws.id) {
    const a = s.acting;
    const name = a.role === 'teacher' ? ws.teachers.find((t) => t.id === a.teacherId)?.name ?? 'Teacher' : a.role === 'student' ? 'Student' : 'Demo coordinator';
    return { ws, role: a.role, teacherId: a.teacherId ?? null, batchId: a.batchId ?? null, s, name };
  }
  const m = s.userId ? ws.members.find((x) => x.userId === s.userId) : null;
  if (!m) throw notFound('There is no workspace at this address, or you are not a member of it.');
  return { ws, role: m.role, teacherId: m.teacherId, batchId: null, s, name: db.users.find((u) => u.id === s.userId)!.name };
}
const coord = (a: Access) => {
  if (a.role !== 'coordinator') throw forbidden('Only a coordinator can change the setup.');
  return a;
};
function mayChange(a: Access, cls: ClassRow) {
  if (a.role === 'coordinator') return;
  if (a.role === 'teacher' && a.teacherId === cls.teacherId) return;
  throw forbidden(a.role === 'teacher' ? 'You can only change your own classes.' : 'Only teachers and coordinators can change classes.');
}

function publicBatch(code: string): { ws: WsRow; batch: Batch } {
  const c = code.trim().toUpperCase();
  for (const ws of db.workspaces) {
    if (!ws.publishedAt) continue;
    const batch = ws.batches.find((b) => b.code === c);
    if (batch) return { ws, batch };
  }
  throw notFound('No class uses that code. Check it with your coordinator.');
}
const followed = (ws: WsRow, batch: Batch): FollowedBatch => ({
  code: batch.code, workspace: { name: ws.name, institution: ws.institution, timezone: ws.timezone, days: ws.days }, batch: { id: batch.id, name: batch.name }, periods: ws.periods,
});
const full = (a: Access): WorkspaceFull => {
  const accounts = new Set(a.ws.members.map((m) => m.teacherId).filter(Boolean));
  return {
    workspace: { ...summary(a.ws), days: a.ws.days }, role: a.role, teacherId: a.teacherId, batchId: a.batchId,
    periods: a.ws.periods, rooms: a.ws.rooms, teachers: a.ws.teachers.map((t) => ({ ...t, hasAccount: accounts.has(t.id) })),
    batches: a.ws.batches, courses: a.ws.courses, classes: a.ws.classes,
  };
};

// ---------- validation helpers ----------

const str = (v: unknown, name: string, max = 120) => {
  if (typeof v !== 'string' || !v.trim()) throw bad(`${name} is required.`);
  if (v.length > max) throw bad(`${name} is too long.`);
  return v.trim();
};
const time = (v: unknown, name: string) => {
  if (typeof v !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) throw bad(`${name} must be a time like 09:00.`);
  return v;
};
const date = (v: unknown, name: string) => {
  if (typeof v !== 'string' || !isDate(v)) throw bad(`${name} must be a date like 2026-09-28.`);
  return v;
};
const int = (v: unknown, name: string) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw bad(`${name} must be a whole number.`);
  return n;
};

function checkClass(ws: WsRow, b: Partial<ClassRow>, id: number | null) {
  const cls = {
    courseId: int(b.courseId, 'Course'), batchId: int(b.batchId, 'Batch'), teacherId: int(b.teacherId, 'Teacher'), roomId: int(b.roomId, 'Room'),
    day: int(b.day, 'Day'), start: time(b.start, 'Start'), end: time(b.end, 'End'),
  };
  if (!ws.courses.some((c) => c.id === cls.courseId)) throw bad('That course is not in this workspace.');
  if (!ws.batches.some((c) => c.id === cls.batchId)) throw bad('That batch is not in this workspace.');
  if (!ws.teachers.some((c) => c.id === cls.teacherId)) throw bad('That teacher is not in this workspace.');
  if (!ws.rooms.some((c) => c.id === cls.roomId)) throw bad('That room is not in this workspace.');
  if (cls.day < 1 || cls.day > 7) throw bad('Day must be 1 (Monday) to 7 (Sunday).');
  if (toMin(cls.end) <= toMin(cls.start)) throw bad('A class has to end after it starts.');
  const found: { type: 'room' | 'teacher' | 'batch'; classId: number; course: string; start: string; end: string; room: string | null }[] = [];
  for (const o of ws.classes) {
    if (o.id === id || o.day !== cls.day || !(toMin(o.start) < toMin(cls.end) && toMin(cls.start) < toMin(o.end))) continue;
    const course = ws.courses.find((c) => c.id === o.courseId)!;
    const batch = ws.batches.find((x) => x.id === o.batchId)!;
    const room = ws.rooms.find((r) => r.id === o.roomId)!;
    const base = { classId: o.id, course: `${course.code} (${batch.name})`, start: o.start, end: o.end, room: room.name };
    if (o.roomId === cls.roomId) found.push({ type: 'room', ...base });
    if (o.teacherId === cls.teacherId) found.push({ type: 'teacher', ...base });
    if (o.batchId === cls.batchId) found.push({ type: 'batch', ...base });
  }
  if (found.length) throw new Fail(409, 'clash', clashSentence(found[0], DAY_SHORT[cls.day]), { clashes: found });
  return cls;
}
function clashSentence(c: { type: string; course: string; start: string; room: string | null }, day: string) {
  if (c.type === 'room') return `${c.room} is booked at ${day} ${c.start} by ${c.course}.`;
  if (c.type === 'teacher') return `The teacher is already teaching ${c.course} at ${day} ${c.start}.`;
  return `The batch already has ${c.course} at ${day} ${c.start}.`;
}

// ---------- CSV import ----------

const DAY_NAMES: Record<string, number> = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 7, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sunday: 7 };
const HEADERS: Record<string, string[]> = {
  rooms: ['name', 'capacity', 'building', 'kind'],
  teachers: ['name', 'short', 'email'],
  batches: ['name', 'size'],
  courses: ['code', 'name', 'teacher', 'color'],
  classes: ['day', 'start', 'end', 'course', 'batch', 'room', 'teacher'],
};
const TEMPLATES: Record<string, string> = {
  rooms: 'name,capacity,building,kind\nCR-201,60,Main Block,lecture\nLAB-301,40,Tech Block,lab\n',
  teachers: 'name,short,email\nMeera Iyer,MI,meera.iyer@college.edu\nKabir Sethi,KS,\n',
  batches: 'name,size\nCSE-2A,58\nCSE-2B,56\n',
  courses: 'code,name,teacher,color\nCS201,Data Structures,MI,1\nCS203,Discrete Mathematics,KS,\n',
  classes: 'day,start,end,course,batch,room,teacher\nMon,09:00,10:00,CS201,CSE-2A,CR-201,\nTue,14:00,16:00,CS291,CSE-2A,LAB-301,MI\n',
};

function runImport(ws: WsRow, kind: string, csv: string, dryRun: boolean): ImportReport {
  if (!HEADERS[kind]) throw bad('Unknown import kind.');
  if (csv.length > 512 * 1024) throw new Fail(413, 'too_large', 'That file is over 512 KB. Split it into smaller files.');
  const rows = parseCsv(csv);
  const errors: ImportReport['errors'] = [];
  if (!rows.length) return { ok: false, created: 0, updated: 0, errors: [{ line: 1, message: 'The file is empty.' }] };
  const header = rows[0].cells.map((h) => h.toLowerCase());
  const want = HEADERS[kind];
  const required = kind === 'classes' ? want.slice(0, 6) : kind === 'courses' ? want.slice(0, 3) : want.slice(0, kind === 'teachers' ? 2 : 1);
  for (const h of required) if (!header.includes(h)) errors.push({ line: rows[0].line, column: h, message: `The header row has no “${h}” column.` });
  if (errors.length) return { ok: false, created: 0, updated: 0, errors };
  const col = (cells: string[], name: string) => cells[header.indexOf(name)] ?? '';
  const draft: WsRow = JSON.parse(JSON.stringify(ws));
  let created = 0;
  let updated = 0;
  for (const { line, cells } of rows.slice(1)) {
    const err = (column: string, message: string) => errors.push({ line, column, message });
    const before = errors.length;
    if (kind === 'rooms') {
      const name = col(cells, 'name');
      const capacity = Number(col(cells, 'capacity'));
      const k = (col(cells, 'kind') || 'lecture').toLowerCase();
      if (!name) err('name', 'Room name is empty.');
      if (!Number.isInteger(capacity) || capacity <= 0) err('capacity', `“${col(cells, 'capacity')}” is not a number of seats.`);
      if (k !== 'lecture' && k !== 'lab') err('kind', 'Kind must be “lecture” or “lab”.');
      if (errors.length > before) continue;
      const row = { name, capacity, building: col(cells, 'building') || null, kind: k as Room['kind'] };
      const found = draft.rooms.find((r) => r.name.toLowerCase() === name.toLowerCase());
      if (found) (Object.assign(found, row), updated++);
      else (draft.rooms.push({ id: nextId(), ...row }), created++);
    } else if (kind === 'teachers') {
      const name = col(cells, 'name');
      const short = col(cells, 'short').toUpperCase();
      const email = col(cells, 'email');
      if (!name) err('name', 'Teacher name is empty.');
      if (!/^[A-Z]{1,4}$/.test(short)) err('short', 'Initials must be 1 to 4 letters.');
      if (email && !/^\S+@\S+\.\S+$/.test(email)) err('email', `“${email}” is not an email address.`);
      if (errors.length > before) continue;
      const found = draft.teachers.find((t) => t.short === short);
      if (found) (Object.assign(found, { name, email: email || null }), updated++);
      else (draft.teachers.push({ id: nextId(), name, short, email: email || null }), created++);
    } else if (kind === 'batches') {
      const name = col(cells, 'name');
      const sizeRaw = col(cells, 'size');
      const size = sizeRaw ? Number(sizeRaw) : null;
      if (!name) err('name', 'Batch name is empty.');
      if (size !== null && (!Number.isInteger(size) || size <= 0)) err('size', `“${sizeRaw}” is not a number of students.`);
      if (errors.length > before) continue;
      const found = draft.batches.find((b) => b.name.toLowerCase() === name.toLowerCase());
      if (found) (Object.assign(found, { size }), updated++);
      else (draft.batches.push({ id: nextId(), name, size, code: batchCode(name) }), created++);
    } else if (kind === 'courses') {
      const code = col(cells, 'code').toUpperCase();
      const name = col(cells, 'name');
      const t = col(cells, 'teacher');
      const teacher = t ? draft.teachers.find((x) => x.short === t.toUpperCase() || x.name.toLowerCase() === t.toLowerCase()) : null;
      const colorRaw = col(cells, 'color');
      const color = colorRaw ? Number(colorRaw) : (draft.courses.length % 8) + 1;
      if (!code) err('code', 'Course code is empty.');
      if (!name) err('name', 'Course name is empty.');
      if (t && !teacher) err('teacher', `No teacher called “${t}”. Add them in Teachers first.`);
      if (!Number.isInteger(color) || color < 1 || color > 8) err('color', 'Colour must be 1 to 8.');
      if (errors.length > before) continue;
      const found = draft.courses.find((c) => c.code === code);
      const row = { code, name, color, teacherId: teacher?.id ?? null };
      if (found) (Object.assign(found, row), updated++);
      else (draft.courses.push({ id: nextId(), ...row }), created++);
    } else {
      const dayRaw = col(cells, 'day').toLowerCase();
      const day = DAY_NAMES[dayRaw] ?? Number(dayRaw);
      const course = draft.courses.find((c) => c.code === col(cells, 'course').toUpperCase());
      const batch = draft.batches.find((b) => b.name.toLowerCase() === col(cells, 'batch').toLowerCase());
      const room = draft.rooms.find((r) => r.name.toLowerCase() === col(cells, 'room').toLowerCase());
      const tRaw = col(cells, 'teacher');
      const teacher = tRaw ? draft.teachers.find((x) => x.short === tRaw.toUpperCase() || x.name.toLowerCase() === tRaw.toLowerCase()) : draft.teachers.find((x) => x.id === course?.teacherId);
      if (!(day >= 1 && day <= 7)) err('day', `“${col(cells, 'day')}” is not a day. Use Mon to Sun.`);
      const start = col(cells, 'start');
      const end = col(cells, 'end');
      if (!/^\d{2}:\d{2}$/.test(start)) err('start', `“${start}” is not a time like 09:00.`);
      if (!/^\d{2}:\d{2}$/.test(end)) err('end', `“${end}” is not a time like 10:00.`);
      if (!course) err('course', `No course “${col(cells, 'course')}”.`);
      if (!batch) err('batch', `No batch “${col(cells, 'batch')}”.`);
      if (!room) err('room', `No room “${col(cells, 'room')}”.`);
      if (course && !teacher) err('teacher', `${course.code} has no teacher. Add a teacher column.`);
      if (errors.length > before) continue;
      try {
        const cls = checkClass(draft, { courseId: course!.id, batchId: batch!.id, teacherId: teacher!.id, roomId: room!.id, day, start, end }, null);
        draft.classes.push({ id: nextId(), ...cls });
        created++;
      } catch (e) {
        err('start', e instanceof Error ? e.message : 'Clash.');
      }
    }
  }
  const ok = errors.length === 0;
  if (ok && !dryRun) {
    Object.assign(ws, { rooms: draft.rooms, teachers: draft.teachers, batches: draft.batches, courses: draft.courses, classes: draft.classes });
  }
  return { ok, created: ok ? created : 0, updated: ok ? updated : 0, errors };
}

function batchCode(name: string) {
  const base = name.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/[0OIL1]/g, (c) => ({ '0': '', O: '', I: '', L: '', '1': '' })[c] ?? '').slice(0, 6) || 'BATCH';
  let code: string;
  do code = `${base}-${rand(4)}`;
  while (db.workspaces.some((w) => w.batches.some((b) => b.code === code)));
  return code;
}

// ---------- routes ----------

type Ctx = { params: Record<string, string>; query: URLSearchParams; body: Record<string, unknown> };
type Handler = (c: Ctx) => unknown;
const routes: { method: Method; parts: string[]; handler: Handler }[] = [];
const on = (method: Method, path: string, handler: Handler) => routes.push({ method, parts: path.split('/').filter(Boolean), handler });
const ok201 = (body: unknown) => ({ __status: 201, body });
const none = () => ({ __status: 204, body: null });
const text = (t: string) => ({ __status: 200, text: t });

// Account
on('POST', '/api/auth/signup', ({ body }) => {
  const name = str(body.name, 'Name', 80);
  const email = str(body.email, 'Email', 200).toLowerCase();
  const password = String(body.password ?? '');
  if (!/^\S+@\S+\.\S+$/.test(email)) throw bad('That doesn’t look like an email address.');
  if (password.length < 10) throw bad('Use at least 10 characters for the password.');
  if (db.users.some((u) => u.email === email)) throw new Fail(409, 'conflict', 'There is already an account with that email. Sign in instead.');
  const u: UserRow = { id: nextId(), email, name, password, createdAt: iso() };
  db.users.push(u);
  return ok201(me(newSession(u.id, null)));
});
on('POST', '/api/auth/login', ({ body }) => {
  const email = String(body.email ?? '').trim().toLowerCase();
  const u = db.users.find((x) => x.email === email);
  if (!u || u.password !== body.password) throw new Fail(401, 'unauthenticated', 'That email and password don’t match an account.');
  return me(newSession(u.id, null));
});
on('POST', '/api/auth/logout', () => {
  const t = cookie.get();
  db.sessions = db.sessions.filter((s) => s.id !== t);
  cookie.set(null);
  return none();
});
on('GET', '/api/auth/me', () => me(requireSession()));
on('PATCH', '/api/auth/me', ({ body }) => {
  const { s, u } = requireUser();
  if (body.name !== undefined) u.name = str(body.name, 'Name', 80);
  if (body.email !== undefined) {
    const email = str(body.email, 'Email', 200).toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) throw bad('That doesn’t look like an email address.');
    if (db.users.some((x) => x !== u && x.email === email)) throw new Fail(409, 'conflict', 'Another account already uses that email.');
    u.email = email;
  }
  return me(s);
});
on('GET', '/api/auth/sessions', () => {
  const { s, u } = requireUser();
  return db.sessions
    .filter((x) => x.userId === u.id)
    .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))
    .map((x): SessionInfo => ({ id: x.id.slice(0, 12), current: x.id === s.id, userAgent: x.userAgent, createdAt: x.createdAt, lastSeenAt: x.lastSeenAt }));
});
on('DELETE', '/api/auth/sessions/:id', ({ params }) => {
  const { u } = requireUser();
  const before = db.sessions.length;
  db.sessions = db.sessions.filter((x) => !(x.userId === u.id && x.id.startsWith(params.id)));
  if (db.sessions.length === before) throw notFound('That session has already ended.');
  return none();
});
on('POST', '/api/auth/password', ({ body }) => {
  const { s, u } = requireUser();
  if (body.current !== u.password) throw new Fail(403, 'forbidden', 'Your current password is not right.');
  if (String(body.next ?? '').length < 10) throw bad('Use at least 10 characters for the new password.');
  u.password = String(body.next);
  db.sessions = db.sessions.filter((x) => x.userId !== u.id || x.id === s.id);
  return none();
});
on('POST', '/api/auth/reset', ({ body }) => {
  const email = String(body.email ?? '').trim().toLowerCase();
  const u = db.users.find((x) => x.email === email);
  const code = String(body.code ?? '').trim().toUpperCase();
  const rc = u && db.resetCodes.find((r) => r.userId === u.id && r.code === code && !r.usedAt && r.expiresAt > iso());
  if (!u || !rc) throw bad('That code doesn’t match this email, or it has expired. Ask your coordinator for a new one.');
  if (String(body.password ?? '').length < 10) throw bad('Use at least 10 characters for the password.');
  u.password = String(body.password);
  rc.usedAt = iso();
  db.sessions = db.sessions.filter((x) => x.userId !== u.id);
  return none();
});
on('DELETE', '/api/auth/account', ({ body }) => {
  const { u } = requireUser();
  if (body.password !== u.password) throw new Fail(403, 'forbidden', 'That password is not right.');
  const sole = db.workspaces.find((w) => w.members.length > 1 && w.members.filter((m) => m.role === 'coordinator').every((m) => m.userId === u.id) && w.members.some((m) => m.userId === u.id && m.role === 'coordinator'));
  if (sole) throw new Fail(409, 'conflict', `You are the only coordinator of ${sole.name}. Make someone else a coordinator first.`);
  db.workspaces = db.workspaces.filter((w) => !(w.members.length === 1 && w.members[0].userId === u.id));
  for (const w of db.workspaces) w.members = w.members.filter((m) => m.userId !== u.id);
  db.sessions = db.sessions.filter((x) => x.userId !== u.id);
  db.users = db.users.filter((x) => x.id !== u.id);
  db.follows = db.follows.filter((f) => f.userId !== u.id);
  cookie.set(null);
  return none();
});
on('GET', '/api/me/follows', () => {
  const { u } = requireUser();
  return db.follows.filter((f) => f.userId === u.id).flatMap((f) => {
    try {
      const { ws, batch } = publicBatch(f.code);
      return [followed(ws, batch)];
    } catch {
      return [];
    }
  });
});
on('PUT', '/api/me/follows', ({ body }) => {
  const { u } = requireUser();
  const codes = Array.isArray(body.codes) ? body.codes.map((c) => String(c).toUpperCase()) : [];
  const valid = codes.flatMap((c) => {
    try {
      const { ws, batch } = publicBatch(c);
      return [followed(ws, batch)];
    } catch {
      return [];
    }
  });
  db.follows = db.follows.filter((f) => f.userId !== u.id).concat(valid.map((v) => ({ userId: u.id, code: v.code })));
  return valid;
});

// Workspaces
on('POST', '/api/workspaces', ({ body }) => {
  const { u } = requireUser();
  const name = str(body.name, 'Name', 80);
  const institution = str(body.institution, 'Institution', 120);
  if (db.workspaces.filter((w) => w.createdBy === u.id).length >= 5) throw new Fail(409, 'conflict', 'You can create up to 5 workspaces.');
  let slug = `${institution.split(/\s+/)[0]}-${name}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'workspace';
  if (db.workspaces.some((w) => w.slug === slug)) slug = `${slug}-${rand(3).toLowerCase()}`;
  const ws = emptyWorkspace({ id: nextId(), slug, name, institution, timezone: typeof body.timezone === 'string' ? body.timezone : 'Asia/Kolkata', createdBy: u.id, now: now() });
  db.workspaces.push(ws);
  return ok201(summary(ws));
});
on('POST', '/api/join', ({ body }) => {
  const code = str(body.code, 'Code', 40).toUpperCase();
  const inv = db.invites.find((i) => i.code === code && !i.usedBy && i.expiresAt > iso());
  if (inv) {
    const s = currentSession();
    const u = s?.userId ? db.users.find((x) => x.id === s.userId) : null;
    if (!u) throw new Fail(401, 'unauthenticated', 'This is a teacher invite. Sign in or create an account to use it.');
    const ws = db.workspaces.find((w) => w.id === inv.wsId)!;
    if (!ws.members.some((m) => m.userId === u.id)) ws.members.push({ userId: u.id, role: inv.role, teacherId: inv.teacherId, joinedAt: iso() });
    inv.usedBy = u.id;
    return { workspace: summary(ws) };
  }
  const { ws, batch } = publicBatch(code);
  return followed(ws, batch);
});

// Demo
on('POST', '/api/demo', () => {
  const wsId = nextId();
  const ws = buildCollege({ id: wsId, slug: `demo-${rand(5).toLowerCase()}`, isDemo: true, nextId, now: now(), createdBy: null });
  db.workspaces.push(ws);
  return ok201(me(newSession(null, ws.id)));
});
on('GET', '/api/demo/week', ({ query }) => {
  const tmp = buildCollege({ id: 0, slug: 'demo', isDemo: true, nextId: (() => { let n = 1; return () => n++; })(), now: now(), createdBy: null });
  const start = query.get('start');
  return week(tmp, start && isDate(start) ? start : undefined, { batch: tmp.batches[0].id });
});
on('POST', '/api/w/:slug/demo/act-as', ({ params, body }) => {
  const a = access(params.slug);
  if (a.s.demoWs !== a.ws.id) throw forbidden('Only a demo copy can switch roles.');
  if (body.role === 'coordinator') a.s.acting = { role: 'coordinator' };
  else if (body.role === 'teacher' && a.ws.teachers.some((t) => t.id === body.teacherId)) a.s.acting = { role: 'teacher', teacherId: Number(body.teacherId) };
  else if (body.role === 'student' && a.ws.batches.some((b) => b.id === body.batchId)) a.s.acting = { role: 'student', batchId: Number(body.batchId) };
  else throw bad('Pick a coordinator, a teacher or a batch.');
  return me(a.s);
});

// Students
on('GET', '/api/public/:code', ({ params }) => {
  const { ws, batch } = publicBatch(params.code);
  return followed(ws, batch);
});
on('GET', '/api/public/:code/week', ({ params, query }) => {
  const { ws, batch } = publicBatch(params.code);
  const start = query.get('start');
  return week(ws, start && isDate(start) ? start : undefined, { batch: batch.id });
});
on('GET', '/api/public/:code/today', ({ params }) => {
  const { ws, batch } = publicBatch(params.code);
  const today = nowIn(ws.timezone).date;
  return occurrences(ws, today, today, { batch: batch.id });
});
on('GET', '/api/public/:code/changes', ({ params }) => {
  const { ws, batch } = publicBatch(params.code);
  const from = addDays(nowIn(ws.timezone).date, -14);
  return ws.changes
    .filter((c) => ws.classes.find((x) => x.id === c.classId)?.batchId === batch.id && (c.occursOn >= from || (c.toDate ?? '') >= from))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((c) => toChange(ws, c));
});

// Workspace
on('GET', '/api/w/:slug', ({ params }) => full(access(params.slug)));
on('PATCH', '/api/w/:slug', ({ params, body }) => {
  const { ws } = coord(access(params.slug));
  if (body.name !== undefined) ws.name = str(body.name, 'Name', 80);
  if (body.institution !== undefined) ws.institution = str(body.institution, 'Institution', 120);
  if (body.timezone !== undefined) ws.timezone = str(body.timezone, 'Timezone', 60);
  if (body.days !== undefined) {
    if (!Array.isArray(body.days) || !body.days.length || body.days.some((d) => !(Number(d) >= 1 && Number(d) <= 7))) throw bad('Pick at least one day.');
    ws.days = [...new Set(body.days.map(Number))].sort();
  }
  return summary(ws);
});
on('POST', '/api/w/:slug/publish', ({ params }) => {
  const { ws } = coord(access(params.slug));
  if (!ws.classes.length) throw new Fail(409, 'conflict', 'Add at least one class to the timetable before publishing.');
  ws.publishedAt = ws.publishedAt ?? iso();
  return summary(ws);
});
on('POST', '/api/w/:slug/unpublish', ({ params }) => {
  const { ws } = coord(access(params.slug));
  ws.publishedAt = null;
  return summary(ws);
});
on('PUT', '/api/w/:slug/periods', ({ params, body }) => {
  const { ws } = coord(access(params.slug));
  const list = (Array.isArray(body) ? body : []) as Period[];
  if (!list.length) throw bad('Add at least one period.');
  const periods = list
    .map((p) => ({ idx: 0, start: time(p.start, 'Start'), end: time(p.end, 'End'), label: p.label ? String(p.label).slice(0, 30) : null, isBreak: !!p.isBreak }))
    .sort((a, b) => a.start.localeCompare(b.start))
    .map((p, i) => ({ ...p, idx: i + 1 }));
  for (let i = 0; i < periods.length; i++) {
    if (toMin(periods[i].end) <= toMin(periods[i].start)) throw bad(`Period ${i + 1} ends before it starts.`);
    if (i && toMin(periods[i].start) < toMin(periods[i - 1].end)) throw bad(`Period ${i + 1} starts before period ${i} ends.`);
  }
  ws.periods = periods;
  return periods;
});

// Body arrives as JSON: PUT periods sends an array, so the router passes it through untouched.
function inUse(ws: WsRow, kind: string, id: number): string | null {
  const n = (f: (c: ClassRow) => boolean) => ws.classes.filter(f).length;
  if (kind === 'rooms' && n((c) => c.roomId === id)) return `${n((c) => c.roomId === id)} classes use this room. Move them first.`;
  if (kind === 'teachers') {
    const courses = ws.courses.filter((c) => c.teacherId === id).map((c) => c.code);
    if (courses.length) return `${ws.teachers.find((t) => t.id === id)?.name} teaches ${courses.join(', ')}. Give those courses another teacher first.`;
    if (n((c) => c.teacherId === id)) return 'This teacher has classes in the timetable.';
  }
  if (kind === 'batches' && n((c) => c.batchId === id)) return `${ws.batches.find((b) => b.id === id)?.name} has ${n((c) => c.batchId === id)} classes. Remove them first.`;
  if (kind === 'courses' && n((c) => c.courseId === id)) return `${ws.courses.find((c) => c.id === id)?.code} is in the timetable ${n((c) => c.courseId === id)} times. Remove those classes first.`;
  return null;
}

function resource<T extends { id: number }>(kind: 'rooms' | 'teachers' | 'batches' | 'courses' | 'classes', clean: (ws: WsRow, b: Record<string, unknown>, existing: T | null) => Omit<T, 'id'>, out: (ws: WsRow, row: T) => unknown = (_w, r) => r) {
  const list = (ws: WsRow) => ws[kind] as unknown as T[];
  on('GET', `/api/w/:slug/${kind}`, ({ params }) => {
    const { ws } = access(params.slug);
    return list(ws).map((r) => out(ws, r));
  });
  on('POST', `/api/w/:slug/${kind}`, ({ params, body }) => {
    const { ws } = coord(access(params.slug));
    const row = { id: nextId(), ...clean(ws, body, null) } as T;
    list(ws).push(row);
    return ok201(out(ws, row));
  });
  on('PATCH', `/api/w/:slug/${kind}/:id`, ({ params, body }) => {
    const { ws } = coord(access(params.slug));
    const row = list(ws).find((r) => r.id === Number(params.id));
    if (!row) throw notFound();
    Object.assign(row, clean(ws, { ...row, ...body }, row));
    return out(ws, row);
  });
  on('DELETE', `/api/w/:slug/${kind}/:id`, ({ params }) => {
    const { ws } = coord(access(params.slug));
    const id = Number(params.id);
    if (!list(ws).some((r) => r.id === id)) throw notFound();
    const why = inUse(ws, kind, id);
    if (why) throw new Fail(409, 'conflict', why);
    (ws[kind] as unknown as T[]) = list(ws).filter((r) => r.id !== id);
    if (kind === 'classes') ws.changes = ws.changes.filter((c) => c.classId !== id);
    return none();
  });
}
const unique = (taken: boolean, what: string) => {
  if (taken) throw new Fail(409, 'conflict', `${what} already exists.`);
};
resource<Room>('rooms', (ws, b, ex) => {
  const name = str(b.name, 'Room name', 40);
  unique(ws.rooms.some((r) => r !== ex && r.name.toLowerCase() === name.toLowerCase()), `A room called ${name}`);
  const capacity = int(b.capacity, 'Capacity');
  if (!capacity) throw bad('Capacity must be at least 1.');
  return { name, capacity, building: b.building ? String(b.building).trim() || null : null, kind: b.kind === 'lab' ? 'lab' : 'lecture' };
});
resource<Teacher & { hasAccount?: boolean }>('teachers', (ws, b, ex) => {
  const name = str(b.name, 'Name', 80);
  const short = str(b.short, 'Initials', 4).toUpperCase();
  unique(ws.teachers.some((t) => t !== (ex as unknown) && t.short === short), `A teacher with the initials ${short}`);
  const email = b.email ? String(b.email).trim() : '';
  if (email && !/^\S+@\S+\.\S+$/.test(email)) throw bad('That doesn’t look like an email address.');
  return { name, short, email: email || null } as Omit<Teacher, 'id'>;
}, (ws, t) => ({ ...t, hasAccount: ws.members.some((m) => m.teacherId === t.id) }));
resource<Batch>('batches', (ws, b, ex) => {
  const name = str(b.name, 'Batch name', 40);
  unique(ws.batches.some((x) => x !== ex && x.name.toLowerCase() === name.toLowerCase()), `A batch called ${name}`);
  const size = b.size === null || b.size === '' || b.size === undefined ? null : int(b.size, 'Size');
  return { name, size, code: ex?.code ?? batchCode(name) };
});
resource<Course>('courses', (ws, b, ex) => {
  const code = str(b.code, 'Course code', 16).toUpperCase();
  unique(ws.courses.some((c) => c !== ex && c.code === code), `A course ${code}`);
  const color = b.color ? int(b.color, 'Colour') : (ws.courses.length % 8) + 1;
  const teacherId = b.teacherId === null || b.teacherId === undefined || b.teacherId === '' ? null : int(b.teacherId, 'Teacher');
  if (teacherId && !ws.teachers.some((t) => t.id === teacherId)) throw bad('That teacher is not in this workspace.');
  return { code, name: str(b.name, 'Course name', 80), color: Math.min(8, Math.max(1, color)), teacherId };
});
resource<ClassRow>('classes', (ws, b, ex) => checkClass(ws, b as Partial<ClassRow>, ex?.id ?? null));

on('POST', '/api/w/:slug/batches/:id/code', ({ params }) => {
  const { ws } = coord(access(params.slug));
  const b = ws.batches.find((x) => x.id === Number(params.id));
  if (!b) throw notFound();
  b.code = batchCode(b.name);
  return b;
});
on('POST', '/api/w/:slug/import', ({ params, body }) => {
  const { ws } = coord(access(params.slug));
  return runImport(ws, String(body.kind), String(body.csv ?? ''), body.dryRun !== false);
});
on('GET', '/api/w/:slug/import/template/:kind', ({ params }) => {
  coord(access(params.slug));
  const t = TEMPLATES[params.kind];
  if (!t) throw notFound();
  return text(t);
});
on('GET', '/api/w/:slug/members', ({ params }) => {
  const { ws } = coord(access(params.slug));
  return ws.members.map((m): Member => {
    const u = db.users.find((x) => x.id === m.userId)!;
    return { userId: m.userId, name: u.name, email: u.email, role: m.role, teacherId: m.teacherId, joinedAt: m.joinedAt };
  });
});
on('DELETE', '/api/w/:slug/members/:userId', ({ params }) => {
  const a = coord(access(params.slug));
  const id = Number(params.userId);
  if (a.s.userId === id && a.ws.members.filter((m) => m.role === 'coordinator').length === 1) throw new Fail(409, 'conflict', 'You are the only coordinator. Make someone else a coordinator first.');
  a.ws.members = a.ws.members.filter((m) => m.userId !== id);
  return none();
});
on('PATCH', '/api/w/:slug/members/:userId', ({ params, body }) => {
  const { ws } = coord(access(params.slug));
  const m = ws.members.find((x) => x.userId === Number(params.userId));
  if (!m) throw notFound();
  if (body.role !== 'coordinator' && body.role !== 'teacher') throw bad('Role must be coordinator or teacher.');
  if (m.role === 'coordinator' && body.role === 'teacher' && ws.members.filter((x) => x.role === 'coordinator').length === 1) throw new Fail(409, 'conflict', 'A workspace needs at least one coordinator.');
  m.role = body.role;
  const u = db.users.find((x) => x.id === m.userId)!;
  return { userId: m.userId, name: u.name, email: u.email, role: m.role, teacherId: m.teacherId, joinedAt: m.joinedAt } satisfies Member;
});
on('GET', '/api/w/:slug/invites', ({ params }) => {
  const { ws } = coord(access(params.slug));
  return db.invites
    .filter((i) => i.wsId === ws.id && !i.usedBy && i.expiresAt > iso())
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((i): Invite => ({ code: i.code, role: i.role, teacherId: i.teacherId, expiresAt: i.expiresAt, createdAt: i.createdAt }));
});
on('POST', '/api/w/:slug/invites', ({ params, body }) => {
  const a = coord(access(params.slug));
  const role = body.role === 'coordinator' ? 'coordinator' : 'teacher';
  const teacherId = body.teacherId ? Number(body.teacherId) : null;
  const teacher = teacherId ? a.ws.teachers.find((t) => t.id === teacherId) : null;
  if (teacherId && !teacher) throw bad('That teacher is not in this workspace.');
  const code = `${teacher?.short ?? (role === 'coordinator' ? 'CO' : 'T')}-${rand(6)}`;
  const inv: InviteRow = { code, wsId: a.ws.id, role, teacherId, createdBy: a.s.userId ?? 0, createdAt: iso(), expiresAt: iso(now() + 7 * 86_400_000), usedBy: null };
  db.invites.push(inv);
  return ok201({ code, expiresAt: inv.expiresAt });
});
on('DELETE', '/api/w/:slug/invites/:code', ({ params }) => {
  const { ws } = coord(access(params.slug));
  db.invites = db.invites.filter((i) => !(i.wsId === ws.id && i.code === params.code));
  return none();
});
on('POST', '/api/w/:slug/members/:userId/reset-code', ({ params }) => {
  const { ws } = coord(access(params.slug));
  const m = ws.members.find((x) => x.userId === Number(params.userId));
  if (!m) throw notFound();
  const code = rand(8);
  const expiresAt = iso(now() + 3_600_000);
  db.resetCodes.push({ code, userId: m.userId, wsId: ws.id, expiresAt, usedAt: null });
  return ok201({ code, expiresAt });
});

// Timetable
const filterOf = (q: URLSearchParams): Filter => ({
  batch: q.get('batch') ? Number(q.get('batch')) : undefined,
  teacher: q.get('teacher') ? Number(q.get('teacher')) : undefined,
  room: q.get('room') ? Number(q.get('room')) : undefined,
});
on('GET', '/api/w/:slug/week', ({ params, query }) => {
  const { ws } = access(params.slug);
  const start = query.get('start');
  if (start && !isDate(start)) throw bad('start must be a date like 2026-09-28.');
  return week(ws, start ?? undefined, filterOf(query));
});
on('GET', '/api/w/:slug/today', ({ params, query }) => {
  const { ws } = access(params.slug);
  const today = nowIn(ws.timezone).date;
  return occurrences(ws, today, today, filterOf(query));
});
on('GET', '/api/w/:slug/changes', ({ params, query }) => {
  const { ws } = access(params.slug);
  const s = query.get('start') ?? '0000-00-00';
  const e = query.get('end') ?? '9999-99-99';
  return ws.changes
    .filter((c) => (c.occursOn >= s && c.occursOn <= e) || (c.toDate && c.toDate >= s && c.toDate <= e))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((c) => toChange(ws, c));
});
on('GET', '/api/w/:slug/free-rooms', ({ params, query }) => {
  const { ws } = access(params.slug);
  const d = date(query.get('date'), 'date');
  const s = time(query.get('start'), 'start');
  const e = time(query.get('end'), 'end');
  const exclude = query.get('exclude') ? Number(query.get('exclude')) : null;
  const busy = new Set(occurrences(ws, d, d).filter((o) => (o.status === 'scheduled' || o.status === 'moved-here') && o.classId !== exclude && toMin(o.start) < toMin(e) && toMin(s) < toMin(o.end)).map((o) => o.room.id));
  return ws.rooms.filter((r) => !busy.has(r.id));
});
function classFor(a: Access, id: string) {
  const cls = a.ws.classes.find((c) => c.id === Number(id));
  if (!cls) throw notFound('That class is no longer in the timetable.');
  return cls;
}
on('GET', '/api/w/:slug/classes/:id/slots', ({ params, query }) => {
  const a = access(params.slug);
  if (a.role === 'student') throw forbidden();
  const cls = classFor(a, params.id);
  const w = query.get('week');
  return slots(a.ws, cls, w && isDate(w) ? w : nowIn(a.ws.timezone).date);
});
function occurrenceCheck(a: Access, cls: ClassRow, d: string) {
  if (!a.ws.days.includes(dow(d)) || dow(d) !== cls.day) throw bad(`This class doesn’t meet on ${DAY_SHORT[dow(d)]} ${d}.`);
  const existing = a.ws.changes.find((c) => c.classId === cls.id && c.occursOn === d);
  if (existing) throw new Fail(409, 'conflict', `That class was already ${existing.kind === 'cancelled' ? 'cancelled' : 'moved'} by ${existing.createdBy}. Undo that change first.`);
}
on('POST', '/api/w/:slug/classes/:id/cancel', ({ params, body }) => {
  const a = access(params.slug);
  const cls = classFor(a, params.id);
  mayChange(a, cls);
  const d = date(body.date, 'date');
  occurrenceCheck(a, cls, d);
  const row: ChangeRow = { id: nextId(), classId: cls.id, occursOn: d, kind: 'cancelled', toDate: null, toStart: null, toEnd: null, toRoomId: null, reason: body.reason ? String(body.reason).slice(0, 200) : null, createdBy: a.name, createdAt: iso() };
  a.ws.changes.push(row);
  return ok201(toChange(a.ws, row));
});
on('POST', '/api/w/:slug/classes/:id/move', ({ params, body }) => {
  const a = access(params.slug);
  const cls = classFor(a, params.id);
  mayChange(a, cls);
  const d = date(body.date, 'date');
  const toDate = date(body.toDate, 'toDate');
  const toStart = time(body.toStart, 'toStart');
  const toEnd = time(body.toEnd, 'toEnd');
  const roomId = int(body.roomId, 'Room');
  const room = a.ws.rooms.find((r) => r.id === roomId);
  if (!room) throw bad('That room is not in this workspace.');
  if (toMin(toEnd) <= toMin(toStart)) throw bad('The class has to end after it starts.');
  if (!a.ws.days.includes(dow(toDate))) throw bad('The college is closed that day.');
  occurrenceCheck(a, cls, d);
  const found = clashes(a.ws, { date: toDate, start: toStart, end: toEnd, roomId, teacherId: cls.teacherId, batchId: cls.batchId }, cls.id);
  if (found.length) {
    const rest = slots(a.ws, cls, toDate).filter((s) => (s.date > toDate || (s.date === toDate && s.start > toStart)) && !s.teacherBusy && !s.batchBusy && s.freeRooms.length);
    throw new Fail(409, 'clash', clashSentence(found[0], DAY_SHORT[dow(toDate)]), { clashes: found, suggestion: rest[0] ?? null });
  }
  const row: ChangeRow = { id: nextId(), classId: cls.id, occursOn: d, kind: 'moved', toDate, toStart, toEnd, toRoomId: roomId, reason: body.reason ? String(body.reason).slice(0, 200) : null, createdBy: a.name, createdAt: iso() };
  a.ws.changes.push(row);
  return ok201(toChange(a.ws, row));
});
on('DELETE', '/api/w/:slug/changes/:id', ({ params }) => {
  const a = access(params.slug);
  const ch = a.ws.changes.find((c) => c.id === Number(params.id));
  if (!ch) throw notFound('That change has already been undone.');
  mayChange(a, a.ws.classes.find((c) => c.id === ch.classId)!);
  a.ws.changes = a.ws.changes.filter((c) => c !== ch);
  return none();
});
on('POST', '/api/w/:slug/feeds', ({ params, body }) => {
  const { ws } = access(params.slug);
  const kind = String(body.kind);
  if (!['batch', 'teacher', 'room'].includes(kind)) throw bad('kind must be batch, teacher or room.');
  const t = token().slice(0, 24);
  db.feeds.push({ token: t, wsId: ws.id, kind, targetId: Number(body.targetId) });
  if (kind === 'batch') {
    const b = ws.batches.find((x) => x.id === Number(body.targetId));
    if (b) return { url: `https://edusched-api.amittal.dev/ics/b/${b.code}.ics` };
  }
  return { url: `https://edusched-api.amittal.dev/ics/f/${t}.ics` };
});

// ---------- transport ----------

let latency = (() => {
  try {
    return Number(localStorage.getItem('edusched.mock.latency') ?? '160');
  } catch {
    return 160;
  }
})();

function dispatch(method: Method, path: string, body: unknown): RawResponse {
  const url = new URL(path, 'http://mock');
  const parts = url.pathname.split('/').filter(Boolean);
  let pathMatched = false;
  for (const r of routes) {
    if (r.parts.length !== parts.length) continue;
    const params: Record<string, string> = {};
    if (!r.parts.every((p, i) => (p.startsWith(':') ? ((params[p.slice(1)] = decodeURIComponent(parts[i])), true) : p === parts[i]))) continue;
    pathMatched = true;
    if (r.method !== method) continue;
    try {
      const res = r.handler({ params, query: url.searchParams, body: (body ?? {}) as Record<string, unknown> }) as { __status?: number; body?: unknown; text?: string } | unknown;
      persist();
      if (res && typeof res === 'object' && '__status' in (res as object)) {
        const x = res as { __status: number; body?: unknown; text?: string };
        return { status: x.__status, body: x.body ?? null, text: x.text };
      }
      return { status: 200, body: res };
    } catch (e) {
      persist();
      if (e instanceof Fail) return { status: e.status, body: { error: e.message, code: e.code, ...e.extra } };
      console.error(e);
      return { status: 500, body: { error: 'Something went wrong on our side.', code: 'server' } };
    }
  }
  return { status: pathMatched ? 405 : 404, body: { error: 'Not found.', code: 'not_found' } };
}

export const mockTransport: Transport = async (method, path, body) => {
  await new Promise((r) => setTimeout(r, latency * (0.7 + Math.random() * 0.6)));
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    const { ApiFailure } = await import('../index');
    throw new ApiFailure(0, null, true);
  }
  // Round-trip through JSON so the app never holds references into the mock's state.
  const res = dispatch(method, path, body === undefined ? undefined : JSON.parse(JSON.stringify(body)));
  return { ...res, body: res.body === null || res.body === undefined ? null : JSON.parse(JSON.stringify(res.body)) };
};

declare global {
  interface Window { __esMock?: { reset: () => void; raw: (m: Method, p: string, b?: unknown) => RawResponse; setLatency: (ms: number) => void; db: () => DB } }
}
window.__esMock = {
  reset: () => {
    db = seed();
    cookie.set(null);
    persist();
  },
  raw: (m, p, b) => dispatch(m, p, b),
  setLatency: (ms) => {
    latency = ms;
  },
  db: () => db,
};

// Keep week() importable for the dev check below without an unused-import error.
export const mockWeekOf = (slug: string) => {
  const ws = db.workspaces.find((w) => w.slug === slug);
  return ws ? mondayOf(nowIn(ws.timezone).date) : null;
};
