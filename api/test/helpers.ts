import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { createApp } from '../src/app';
import { addDays, isoWeekday, todayIn } from '../src/dates';
import type { Db, Queryable } from '../src/db';
import type { Bindings } from '../src/env';

export const schemaSql = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8');

/** Adapts PGlite (single connection, in-process) to the data layer's Db interface. */
export function pgliteDb(pg: PGlite): Db {
  const wrap = (q: Pick<PGlite, 'query'>): Queryable => ({
    query: async (text, params) => (await q.query(text, params)).rows as any[],
  });
  return { ...wrap(pg), transaction: (fn) => pg.transaction((tx) => fn(wrap(tx))) };
}

export async function freshPglite(): Promise<PGlite> {
  const pg = new PGlite();
  await pg.exec(schemaSql);
  return pg;
}

export const TZ = 'Asia/Kolkata';
export const ORIGIN = 'http://localhost:5173';
export const ENV: Bindings = { DATABASE_URL: 'unused' };
export const PASSWORD = 'correct horse battery';

export const today = () => todayIn(TZ);

/** The next date (1..7 days after today) falling on ISO weekday `dow` (1 = Monday). */
export function nextWeekday(dow: number): string {
  const t = today();
  const ahead = (dow - isoWeekday(t) + 7) % 7 || 7;
  return addDays(t, ahead);
}

export interface Res {
  status: number;
  headers: Headers;
  body: any;
  text: string;
}

interface Options {
  body?: unknown;
  headers?: Record<string, string>;
  /** Send exactly `headers`: no Origin or Content-Type added (for CSRF tests). */
  raw?: boolean;
}

/**
 * A browser against the app: keeps the es_session cookie like a real one would,
 * and sends Origin + application/json on state changes, as the frontend does.
 */
export class Browser {
  cookie: string | null = null;
  email = '';

  constructor(
    readonly app: ReturnType<typeof createApp>,
    readonly env: Bindings = ENV,
    readonly ip = '203.0.113.1',
    readonly base = 'http://localhost',
  ) {}

  async req(method: string, path: string, opts: Options = {}): Promise<Res> {
    const headers: Record<string, string> = { 'cf-connecting-ip': this.ip };
    if (!opts.raw && method !== 'GET') {
      headers.Origin = ORIGIN;
      headers['Content-Type'] = 'application/json';
    }
    if (this.cookie) headers.Cookie = `es_session=${this.cookie}`;
    Object.assign(headers, opts.headers);
    let body: string | undefined;
    if (opts.body !== undefined) body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
    else if (method !== 'GET') body = '{}';
    const res = await this.app.request(`${this.base}${path}`, { method, headers, body }, this.env);
    const set = res.headers.get('set-cookie');
    const m = set?.match(/es_session=([^;]*)/);
    if (m) this.cookie = /Max-Age=0/i.test(set!) || !m[1] ? null : m[1];
    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    return { status: res.status, headers: res.headers, body: parsed, text };
  }

  get = (path: string, opts?: Options) => this.req('GET', path, opts);
  post = (path: string, body?: unknown, opts?: Options) => this.req('POST', path, { ...opts, body });
  put = (path: string, body?: unknown) => this.req('PUT', path, { body });
  patch = (path: string, body?: unknown) => this.req('PATCH', path, { body });
  del = (path: string, body?: unknown) => this.req('DELETE', path, { body });
}

let counter = 0;

export function harness(db: Db, env: Bindings = ENV) {
  const app = createApp(() => db);
  const browser = (ip?: string) => new Browser(app, env, ip ?? `203.0.113.${(++counter % 250) + 1}`);

  async function signup(name = 'Coordinator'): Promise<Browser> {
    const b = browser();
    b.email = `user${++counter}.${Date.now()}@example.edu`;
    const res = await b.post('/api/auth/signup', { name, email: b.email, password: PASSWORD });
    if (res.status !== 201) throw new Error(`signup failed: ${res.status} ${res.text}`);
    return b;
  }

  return { app, browser, signup };
}

export type Harness = ReturnType<typeof harness>;

export interface College {
  slug: string;
  w: string;
  rooms: { r1: number; r2: number; lab: number };
  teachers: { t1: number; t2: number; t3: number };
  batches: { b1: number; b2: number; codes: string[] };
  courses: { c1: number; c2: number; c3: number };
  classes: { k1: number; k2: number; k3: number; k4: number };
}

export function expectStatus(res: Res, status: number) {
  if (res.status !== status) throw new Error(`expected ${status}, got ${res.status}: ${res.text}`);
  return res.body;
}

/**
 * A small published college, built through the API:
 *   k1  C1 (T1) for B1 in R1, Mon 09:00-10:00
 *   k2  C2 (T2) for B2 in R2, Mon 09:00-10:00
 *   k3  C3 (T3) for B1 in R2, Tue 10:00-11:00
 *   k4  C1 (T1) for B2 in R1, Wed 11:00-12:00
 */
export async function buildCollege(coord: Browser, name = 'Computer Science'): Promise<College> {
  const ok = (res: Res) => expectStatus(res, 201);
  const ws = ok(await coord.post('/api/workspaces', { name, institution: 'Test Institute' }));
  const w = `/api/w/${ws.slug}`;
  const room = async (body: object) => ok(await coord.post(`${w}/rooms`, body)).id as number;
  const teacher = async (body: object) => ok(await coord.post(`${w}/teachers`, body)).id as number;
  const rooms = {
    r1: await room({ name: 'R1', capacity: 60 }),
    r2: await room({ name: 'R2', capacity: 60 }),
    lab: await room({ name: 'LAB', capacity: 30, kind: 'lab' }),
  };
  const teachers = {
    t1: await teacher({ name: 'Tara One', short: 'T1' }),
    t2: await teacher({ name: 'Tom Two', short: 'T2' }),
    t3: await teacher({ name: 'Tia Three', short: 'T3' }),
  };
  const b1 = ok(await coord.post(`${w}/batches`, { name: 'B1', size: 50 }));
  const b2 = ok(await coord.post(`${w}/batches`, { name: 'B2', size: 40 }));
  const course = async (code: string, teacherId: number) =>
    ok(await coord.post(`${w}/courses`, { code, name: `Course ${code}`, teacherId })).id as number;
  const courses = { c1: await course('C1', teachers.t1), c2: await course('C2', teachers.t2), c3: await course('C3', teachers.t3) };
  const cls = async (courseId: number, batchId: number, roomId: number, day: number, start: string, end: string) =>
    ok(await coord.post(`${w}/classes`, { courseId, batchId, roomId, day, start, end })).id as number;
  const classes = {
    k1: await cls(courses.c1, b1.id, rooms.r1, 1, '09:00', '10:00'),
    k2: await cls(courses.c2, b2.id, rooms.r2, 1, '09:00', '10:00'),
    k3: await cls(courses.c3, b1.id, rooms.r2, 2, '10:00', '11:00'),
    k4: await cls(courses.c1, b2.id, rooms.r1, 3, '11:00', '12:00'),
  };
  expectStatus(await coord.post(`${w}/publish`), 200);
  return { slug: ws.slug, w, rooms, teachers, batches: { b1: b1.id, b2: b2.id, codes: [b1.code, b2.code] }, courses, classes };
}

/** Invites a new account as the given teacher and returns its browser. */
export async function joinAsTeacher(h: Harness, coord: Browser, college: College, teacherId: number) {
  const invite = expectStatus(await coord.post(`${college.w}/invites`, { role: 'teacher', teacherId }), 201);
  const t = await h.signup('A Teacher');
  expectStatus(await t.post('/api/join', { code: invite.code }), 200);
  return t;
}
