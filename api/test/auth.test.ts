import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import type { Db } from '../src/db';
import { Browser, buildCollege, ENV, expectStatus, freshPglite, harness, PASSWORD, pgliteDb, type Harness } from './helpers';

let db: Db;
let h: Harness;

beforeAll(async () => {
  db = pgliteDb(await freshPglite());
  h = harness(db);
});

describe('health', () => {
  it('answers /api/test without touching the database', async () => {
    const unreachable = async () => {
      throw new Error('no database here');
    };
    const app = createApp(() => ({ query: unreachable, transaction: unreachable }));
    const b = new Browser(app);
    b.cookie = 'a-stale-cookie-must-not-trigger-a-session-lookup';
    const res = await b.get('/api/test');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: 'API is working' });
  });

  it('reports database health', async () => {
    expect((await h.browser().get('/api/health')).body).toEqual({ status: 'ok', db: 'ok' });
  });

  it('answers unknown paths with the error shape', async () => {
    const res = await h.browser().get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: expect.any(String), code: 'not_found' });
  });
});

describe('signup, login, logout', () => {
  it('signs up, sets the session cookie and returns Me', async () => {
    const b = h.browser();
    const res = await b.post('/api/auth/signup', { name: 'Asha Verma', email: 'Asha@Example.edu', password: PASSWORD });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ user: { id: expect.any(Number), name: 'Asha Verma', email: 'asha@example.edu' }, demo: null, memberships: [] });
    expect(b.cookie).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect((await b.get('/api/auth/me')).body.user.email).toBe('asha@example.edu');
  });

  it('stores only the SHA-256 of the session token', async () => {
    const b = await h.signup();
    const rows = await db.query<{ id: string }>(`SELECT id FROM sessions`);
    expect(rows.some((r) => r.id === b.cookie)).toBe(false);
    expect(rows.every((r) => /^[0-9a-f]{64}$/.test(r.id))).toBe(true);
  });

  it('sets HttpOnly, SameSite=Lax, Path=/, 30 days, and Secure on https', async () => {
    const secure = new Browser(h.app, ENV, '198.51.100.9', 'https://edusched-api.amittal.dev');
    const res = await secure.post('/api/auth/signup', { name: 'S', email: 'secure@example.edu', password: PASSWORD });
    const cookie = res.headers.get('set-cookie')!;
    expect(cookie).toMatch(/^es_session=[A-Za-z0-9_-]{43};/);
    for (const part of ['Max-Age=2592000', 'Path=/', 'HttpOnly', 'Secure', 'SameSite=Lax']) expect(cookie).toContain(part);

    const local = h.browser();
    const localCookie = (await local.post('/api/auth/signup', { name: 'L', email: 'local@example.edu', password: PASSWORD })).headers.get('set-cookie')!;
    expect(localCookie).not.toContain('Secure');
  });

  it('refuses a duplicate email, a short password and a bad email', async () => {
    const b = await h.signup();
    const again = await h.browser().post('/api/auth/signup', { name: 'X', email: b.email.toUpperCase(), password: PASSWORD });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('conflict');
    expect((await h.browser().post('/api/auth/signup', { name: 'X', email: 'short@example.edu', password: 'short' })).status).toBe(400);
    expect((await h.browser().post('/api/auth/signup', { name: 'X', email: 'nope', password: PASSWORD })).status).toBe(400);
  });

  it('logs in with one generic message for any failure', async () => {
    const b = await h.signup();
    const fresh = h.browser();
    expect((await fresh.post('/api/auth/login', { email: b.email, password: PASSWORD })).status).toBe(200);
    expect(fresh.cookie).toBeTruthy();
    const wrong = await h.browser().post('/api/auth/login', { email: b.email, password: 'wrong password' });
    const unknown = await h.browser().post('/api/auth/login', { email: 'nobody@example.edu', password: PASSWORD });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
    expect(wrong.body.code).toBe('unauthenticated');
  });

  it('logout clears the cookie and revokes the session server-side', async () => {
    const b = await h.signup();
    const token = b.cookie;
    const res = await b.post('/api/auth/logout');
    expect(res.status).toBe(204);
    expect(res.headers.get('set-cookie')).toMatch(/es_session=;.*Max-Age=0/);
    // replaying the old cookie does not work: the row is gone
    b.cookie = token;
    expect((await b.get('/api/auth/me')).status).toBe(401);
  });

  it('401s /me without a session', async () => {
    const res = await h.browser().get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('unauthenticated');
  });
});

describe('CSRF', () => {
  it('refuses a state change without an allowed Origin', async () => {
    const b = await h.signup();
    const noOrigin = await b.req('POST', '/api/workspaces', {
      raw: true,
      headers: { 'Content-Type': 'application/json' },
      body: { name: 'X', institution: 'Y' },
    });
    expect(noOrigin.status).toBe(403);
    expect(noOrigin.body.code).toBe('forbidden');
    const evil = await b.req('POST', '/api/workspaces', {
      raw: true,
      headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
      body: { name: 'X', institution: 'Y' },
    });
    expect(evil.status).toBe(403);
  });

  it('refuses a form-encoded or text body even from our origin', async () => {
    const b = await h.signup();
    for (const type of ['application/x-www-form-urlencoded', 'text/plain', 'multipart/form-data; boundary=x']) {
      const res = await b.req('POST', '/api/auth/logout', { raw: true, headers: { 'Content-Type': type, Origin: 'http://localhost:5173' }, body: 'a=b' });
      expect(res.status).toBe(403);
    }
    expect((await b.get('/api/auth/me')).status).toBe(200); // still signed in
  });

  it('answers the CORS preflight with credentials for allowed origins only', async () => {
    const pre = (origin: string) =>
      h.app.request('/api/workspaces', {
        method: 'OPTIONS',
        headers: { Origin: origin, 'Access-Control-Request-Method': 'PATCH', 'Access-Control-Request-Headers': 'content-type' },
      });
    const good = await pre('https://edusched.amittal.dev');
    expect(good.headers.get('access-control-allow-origin')).toBe('https://edusched.amittal.dev');
    expect(good.headers.get('access-control-allow-credentials')).toBe('true');
    expect(good.headers.get('access-control-allow-methods')).toContain('PATCH');
    expect((await pre('https://evil.example')).headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('sessions and passwords', () => {
  it('lists sessions, flags the current one, and signs out another device', async () => {
    const a = await h.signup();
    const other = h.browser();
    await other.post('/api/auth/login', { email: a.email, password: PASSWORD });
    const list = expectStatus(await a.get('/api/auth/sessions'), 200);
    expect(list).toHaveLength(2);
    expect(list.filter((s: any) => s.current)).toHaveLength(1);
    const theirs = list.find((s: any) => !s.current);
    expect(theirs).toEqual({ id: expect.stringMatching(/^[0-9a-f]{64}$/), current: false, userAgent: null, createdAt: expect.any(String), lastSeenAt: expect.any(String) });
    expect((await a.del(`/api/auth/sessions/${theirs.id}`)).status).toBe(204);
    expect((await other.get('/api/auth/me')).status).toBe(401);
    expect((await a.del(`/api/auth/sessions/${theirs.id}`)).status).toBe(404);
  });

  it("cannot sign out someone else's session", async () => {
    const a = await h.signup();
    const b = await h.signup();
    const bs = expectStatus(await b.get('/api/auth/sessions'), 200)[0];
    expect((await a.del(`/api/auth/sessions/${bs.id}`)).status).toBe(404);
    expect((await b.get('/api/auth/me')).status).toBe(200);
  });

  it('changes the password and revokes the other sessions', async () => {
    const a = await h.signup();
    const other = h.browser();
    await other.post('/api/auth/login', { email: a.email, password: PASSWORD });
    expect((await a.post('/api/auth/password', { current: 'not it at all', next: 'a brand new password' })).status).toBe(400);
    expect((await a.post('/api/auth/password', { current: PASSWORD, next: 'a brand new password' })).status).toBe(204);
    expect((await a.get('/api/auth/me')).status).toBe(200);
    expect((await other.get('/api/auth/me')).status).toBe(401);
    expect((await h.browser().post('/api/auth/login', { email: a.email, password: 'a brand new password' })).status).toBe(200);
  });

  it('resets a password with a single-use code from a coordinator', async () => {
    const coord = await h.signup();
    const college = await buildCollege(coord);
    const invite = expectStatus(await coord.post(`${college.w}/invites`, { role: 'teacher', teacherId: college.teachers.t2 }), 201);
    const teacher = await h.signup('Tom Two');
    await teacher.post('/api/join', { code: invite.code });
    const me = expectStatus(await teacher.get('/api/auth/me'), 200);

    const { code, expiresAt } = expectStatus(await coord.post(`${college.w}/members/${me.user.id}/reset-code`), 201);
    expect(code).toMatch(/^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
    expect(new Date(expiresAt).getTime() - Date.now()).toBeGreaterThan(50 * 60_000);

    const reset = (c: string, email = teacher.email) => h.browser().post('/api/auth/reset', { email, code: c, password: 'reset password 123' });
    expect((await reset(code, 'someone.else@example.edu')).status).toBe(400);
    expect((await reset(code.toLowerCase())).status).toBe(204);
    expect((await teacher.get('/api/auth/me')).status).toBe(401); // every device signed out
    expect((await reset(code)).status).toBe(400); // single use
    expect((await h.browser().post('/api/auth/login', { email: teacher.email, password: 'reset password 123' })).status).toBe(200);
  });

  it('only issues reset codes for members of the workspace, and only as coordinator', async () => {
    const coord = await h.signup();
    const college = await buildCollege(coord);
    const stranger = await h.signup();
    const sid = expectStatus(await stranger.get('/api/auth/me'), 200).user.id;
    expect((await coord.post(`${college.w}/members/${sid}/reset-code`)).status).toBe(404);
  });
});

describe('account deletion', () => {
  it('deletes the account and the workspaces only they belong to', async () => {
    const a = await h.signup();
    const college = await buildCollege(a);
    expect((await a.del('/api/auth/account', { password: 'wrong password!' })).status).toBe(400);
    expect((await a.del('/api/auth/account', { password: PASSWORD })).status).toBe(204);
    expect(await db.query(`SELECT 1 FROM workspaces WHERE slug = $1`, [college.slug])).toEqual([]);
    expect((await h.browser().post('/api/auth/login', { email: a.email, password: PASSWORD })).status).toBe(401);
  });

  it('refuses while they are the only coordinator of a workspace with other members', async () => {
    const coord = await h.signup();
    const college = await buildCollege(coord);
    const invite = expectStatus(await coord.post(`${college.w}/invites`, { role: 'teacher', teacherId: college.teachers.t1 }), 201);
    const t = await h.signup();
    await t.post('/api/join', { code: invite.code });
    const res = await coord.del('/api/auth/account', { password: PASSWORD });
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('Computer Science');
  });
});

describe('follows', () => {
  it('syncs followed batches by code, dropping unknown ones', async () => {
    const coord = await h.signup();
    const college = await buildCollege(coord);
    const student = await h.signup('Student');
    const res = await student.put('/api/me/follows', { codes: [college.batches.codes[0].toLowerCase(), 'NOPE-AAAA'] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      {
        code: college.batches.codes[0],
        workspace: { name: 'Computer Science', institution: 'Test Institute', timezone: 'Asia/Kolkata', days: [1, 2, 3, 4, 5] },
        batch: { id: college.batches.b1, name: 'B1' },
        periods: expect.arrayContaining([{ idx: 5, start: '13:00', end: '14:00', label: 'Lunch', isBreak: true }]),
      },
    ]);
    expect((await student.get('/api/me/follows')).body).toHaveLength(1);
    expect((await h.browser().get('/api/me/follows')).status).toBe(401);
  });
});

describe('rate limits', () => {
  it('returns 429 when the binding says no, and works without a binding', async () => {
    const denied = { limit: async () => ({ success: false }) } as unknown as RateLimit;
    const limited = harness(db, { ...ENV, AUTH_LIMITER: denied, PUBLIC_LIMITER: denied });
    const b = limited.browser();
    const res = await b.post('/api/auth/login', { email: 'a@example.edu', password: PASSWORD });
    expect(res.status).toBe(429);
    expect(res.body.code).toBe('rate_limited');
    expect((await b.post('/api/auth/signup', { name: 'x', email: 'rl@example.edu', password: PASSWORD })).status).toBe(429);
    expect((await b.get('/api/public/ANY-CODE')).status).toBe(429);
    expect((await b.post('/api/join', { code: 'ANY-CODE' })).status).toBe(429);
  });

  it('keys the limit by client IP', async () => {
    const keys: string[] = [];
    const spy = { limit: async ({ key }: { key: string }) => (keys.push(key), { success: true }) } as unknown as RateLimit;
    const b = harness(db, { ...ENV, AUTH_LIMITER: spy }).browser('192.0.2.77');
    await b.post('/api/auth/login', { email: 'a@example.edu', password: PASSWORD });
    expect(keys).toEqual(['AUTH_LIMITER:192.0.2.77']);
  });
});

describe('body limits', () => {
  it('refuses JSON bodies over 64 KB with too_large', async () => {
    const b = await h.signup();
    const res = await b.post('/api/workspaces', { name: 'x'.repeat(70 * 1024), institution: 'y' });
    expect(res.status).toBe(413);
    expect(res.body.code).toBe('too_large');
  });
});
