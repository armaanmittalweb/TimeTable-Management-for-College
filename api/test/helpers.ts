import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { createApp } from '../src/app';
import { addDays, isoWeekday, todayIn } from '../src/dates';
import type { Db, Queryable } from '../src/db';
import type { Bindings } from '../src/env';

const sqlFile = (name: string) => readFileSync(new URL(`../db/${name}`, import.meta.url), 'utf8');
export const schemaSql = sqlFile('schema.sql');
export const seedSql = sqlFile('seed.sql');

/** Adapts PGlite (single connection, in-process) to the data layer's Db interface. */
export function pgliteDb(pg: PGlite): Db {
  const wrap = (q: Pick<PGlite, 'query'>): Queryable => ({
    query: async (text, params) => (await q.query(text, params)).rows as any[],
  });
  return { ...wrap(pg), transaction: (fn) => pg.transaction((tx) => fn(wrap(tx))) };
}

export async function seededPglite(): Promise<PGlite> {
  const pg = new PGlite();
  await pg.exec(schemaSql);
  await pg.exec(seedSql);
  return pg;
}

export const DEMO_PASSWORD = 'edusched-demo';
export const PROFESSOR = 'prof.meera'; // users.id 1
export const STUDENT = 'student.aarav'; // CSE-2A
export const TZ = 'Asia/Kolkata';
export const ENV: Bindings = { DATABASE_URL: 'unused', JWT_SECRET: 'test-secret', DEMO_MODE: 'true', TIMEZONE: TZ };

export const SANDBOX_A = 'sandbox-A-0123456789';
export const SANDBOX_B = 'sandbox-B-0123456789';

export const today = () => todayIn(TZ);

/** The next date (1..7 days after today) falling on ISO weekday `dow` (1 = Monday). */
export function nextWeekday(dow: number): string {
  const t = today();
  const ahead = (dow - isoWeekday(t) + 7) % 7 || 7;
  return addDays(t, ahead);
}

interface CallOptions {
  token?: string;
  sandbox?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

export function apiClient(db: Db, env: Bindings = ENV) {
  const app = createApp(() => db);

  async function call(method: string, path: string, opts: CallOptions = {}) {
    const headers: Record<string, string> = { ...opts.headers };
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
    if (opts.sandbox) headers['X-Sandbox-Id'] = opts.sandbox;
    const res = await app.request(
      path,
      { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) },
      env,
    );
    const text = await res.text();
    return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
  }

  async function login(username: string, password = DEMO_PASSWORD): Promise<string> {
    const res = await call('POST', '/api/auth/login', { body: { username, password } });
    if (res.status !== 200) throw new Error(`login failed for ${username}: ${res.status}`);
    return res.body.token;
  }

  return { app, call, login };
}

export const decodeJwt = (token: string) =>
  JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
