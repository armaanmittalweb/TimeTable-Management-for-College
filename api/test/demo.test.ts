import { beforeAll, describe, expect, it } from 'vitest';
import { cleanup } from '../src/data/maintenance';
import { addDays, mondayOf } from '../src/dates';
import type { Db } from '../src/db';
import { Browser, ENV, expectStatus, freshPglite, harness, pgliteDb, today, type Harness } from './helpers';

let db: Db;
let h: Harness;

beforeAll(async () => {
  db = pgliteDb(await freshPglite());
  h = harness(db);
});

async function visitor(ip?: string) {
  const b = h.browser(ip);
  const me = expectStatus(await b.post('/api/demo'), 201);
  return { b, me, w: `/api/w/${me.demo.workspace}` };
}

describe('demo college', () => {
  it('gives a visitor a private, published copy acting as coordinator', async () => {
    const { b, me, w } = await visitor();
    expect(me.user).toBeNull();
    expect(me.memberships).toEqual([]);
    expect(me.demo).toEqual({ workspace: expect.stringMatching(/^demo-[a-z0-9]{8}$/), actingAs: { role: 'coordinator' }, expiresAt: expect.any(String) });
    const hours = (new Date(me.demo.expiresAt).getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(23.9);
    expect(hours).toBeLessThanOrEqual(24);
    expect(b.cookie).toBeTruthy();
    expect(expectStatus(await b.get('/api/auth/me'), 200)).toEqual(me);

    const full = expectStatus(await b.get(w), 200);
    expect(full.workspace).toMatchObject({ published: true, isDemo: true });
    expect(full.role).toBe('coordinator');
    expect(full.batches.map((x: any) => x.name)).toEqual(['CSE-2A', 'CSE-2B', 'ECE-2A']);
    expect(full.teachers).toHaveLength(5);
    expect(full.rooms.length).toBeGreaterThanOrEqual(6);
    expect(full.periods.some((p: any) => p.isBreak && p.label === 'Lunch')).toBe(true);
    // every batch has a full Monday-Friday week and a two-hour lab block
    for (const batch of full.batches) {
      const mine = full.classes.filter((c: any) => c.batchId === batch.id);
      expect(new Set(mine.map((c: any) => c.day))).toEqual(new Set([1, 2, 3, 4, 5]));
      const labs = full.rooms.filter((r: any) => r.kind === 'lab').map((r: any) => r.id);
      expect(mine.some((c: any) => labs.includes(c.roomId) && c.end.slice(0, 2) - c.start.slice(0, 2) === 2)).toBe(true);
    }
  });

  it('is clash-free, including the three sample changes this week', async () => {
    const { b, me, w } = await visitor();
    const [{ id }] = await db.query<{ id: number }>(`SELECT id FROM workspaces WHERE slug = $1`, [me.demo.workspace]);
    const weekly = await db.query(
      `SELECT a.id, b.id FROM classes a JOIN classes b ON b.workspace_id = a.workspace_id AND b.id > a.id
          AND b.day_of_week = a.day_of_week AND b.start_time < a.end_time AND b.end_time > a.start_time
        WHERE a.workspace_id = $1 AND (a.room_id = b.room_id OR a.teacher_id = b.teacher_id OR a.batch_id = b.batch_id)`,
      [id],
    );
    expect(weekly).toEqual([]);

    const monday = mondayOf(today());
    const changes = expectStatus(await b.get(`${w}/changes?start=${monday}&end=${addDays(monday, 6)}`), 200);
    expect(changes.map((c: any) => c.kind).sort()).toEqual(['cancelled', 'moved', 'moved']);
    const week = expectStatus(await b.get(`${w}/week?start=${monday}`), 200);
    const live = week.occurrences.filter((o: any) => o.status === 'scheduled' || o.status === 'moved-here');
    for (const x of live) {
      for (const y of live) {
        if (x === y || x.date !== y.date || !(x.start < y.end && y.start < x.end)) continue;
        expect([x.room.id === y.room.id, x.teacher.id === y.teacher.id, x.batch.id === y.batch.id]).toEqual([false, false, false]);
      }
    }
    expect(week.occurrences.filter((o: any) => o.status === 'moved-here')).toHaveLength(2);
  });

  it('keeps each visitor copy independent and private', async () => {
    const one = await visitor();
    const two = await visitor();
    expect(one.w).not.toBe(two.w);
    const codes = async (v: typeof one) => expectStatus(await v.b.get(v.w), 200).batches.map((x: any) => x.code);
    const [oneCodes, twoCodes] = [await codes(one), await codes(two)];
    expect(oneCodes.some((c: string) => twoCodes.includes(c))).toBe(false);

    const full = expectStatus(await one.b.get(one.w), 200);
    const cls = full.classes[0];
    const next = addDays(mondayOf(today()), 7 + cls.day - 1);
    expectStatus(await one.b.post(`${one.w}/classes/${cls.id}/cancel`, { date: next }), 201);
    expectStatus(await one.b.patch(`${one.w}/rooms/${full.rooms[0].id}`, { name: 'Renamed' }), 200);

    const other = expectStatus(await two.b.get(two.w), 200);
    expect(other.rooms.map((r: any) => r.name)).not.toContain('Renamed');
    const otherChanges = expectStatus(await two.b.get(`${two.w}/changes?start=${next}&end=${next}`), 200);
    expect(otherChanges).toEqual([]);
    // and neither can open the other's copy
    expect((await one.b.get(two.w)).status).toBe(404);
    expect((await two.b.post(`${one.w}/demo/act-as`, { role: 'coordinator' })).status).toBe(404);
  });

  it('switches roles: a teacher changes only their classes, a student only reads', async () => {
    const { b, w } = await visitor();
    const full = expectStatus(await b.get(w), 200);
    const meera = full.teachers.find((t: any) => t.short === 'MI');
    const mine = full.classes.find((c: any) => c.teacherId === meera.id);
    const notMine = full.classes.find((c: any) => c.teacherId !== meera.id);
    const on = (c: any) => addDays(mondayOf(today()), 7 + c.day - 1);

    const asTeacher = expectStatus(await b.post(`${w}/demo/act-as`, { role: 'teacher', teacherId: meera.id }), 200);
    expect(asTeacher.demo.actingAs).toEqual({ role: 'teacher', teacherId: meera.id });
    expect(expectStatus(await b.get(w), 200)).toMatchObject({ role: 'teacher', teacherId: meera.id });
    const change = expectStatus(await b.post(`${w}/classes/${mine.id}/cancel`, { date: on(mine) }), 201);
    expect(change.by).toBe('Meera Iyer');
    expect((await b.post(`${w}/classes/${notMine.id}/cancel`, { date: on(notMine) })).status).toBe(403);
    expect((await b.post(`${w}/rooms`, { name: 'X', capacity: 5 })).status).toBe(403);

    const batch = full.batches[0];
    const asStudent = expectStatus(await b.post(`${w}/demo/act-as`, { role: 'student', batchId: batch.id }), 200);
    expect(asStudent.demo.actingAs).toEqual({ role: 'student', batchId: batch.id });
    expect(expectStatus(await b.get(w), 200)).toMatchObject({ role: 'student', teacherId: null, batchId: batch.id });
    expect((await b.get(`${w}/week?batch=${batch.id}`)).status).toBe(200);
    expect((await b.post(`${w}/classes/${mine.id}/cancel`, { date: on(mine) })).status).toBe(403);
    expect((await b.del(`${w}/changes/${change.id}`)).status).toBe(403);
    expect((await b.get(`${w}/classes/${mine.id}/slots`)).status).toBe(403);

    expect(expectStatus(await b.post(`${w}/demo/act-as`, { role: 'coordinator' }), 200).demo.actingAs).toEqual({ role: 'coordinator' });
    expect((await b.post(`${w}/demo/act-as`, { role: 'teacher', teacherId: 999999 })).status).toBe(404);
    expect((await b.post(`${w}/demo/act-as`, { role: 'teacher' })).status).toBe(400);
  });

  it('limits what a guest can do outside the copy', async () => {
    const { b, w } = await visitor();
    expect((await b.post('/api/workspaces', { name: 'X', institution: 'Y' })).status).toBe(403);
    expect((await b.get('/api/auth/sessions')).status).toBe(403);
    expect((await b.post(`${w}/invites`, { role: 'coordinator' })).status).toBe(400);
  });

  it('only allows act-as in a demo copy', async () => {
    const coord = await h.signup();
    const ws = expectStatus(await coord.post('/api/workspaces', { name: 'Real', institution: 'X' }), 201);
    expect((await coord.post(`/api/w/${ws.slug}/demo/act-as`, { role: 'student', batchId: 1 })).status).toBe(403);
  });

  it('replaces a visitor’s previous copy when they open a new one', async () => {
    const { b, me } = await visitor();
    const again = expectStatus(await b.post('/api/demo'), 201);
    expect(again.demo.workspace).not.toBe(me.demo.workspace);
    expect(await db.query(`SELECT 1 FROM workspaces WHERE slug = $1`, [me.demo.workspace])).toEqual([]);
  });

  it('rate-limits copies to five per ten minutes per client', async () => {
    const ip = '198.51.100.200';
    for (let i = 0; i < 5; i++) expectStatus(await new Browser(h.app, ENV, ip).post('/api/demo'), 201);
    const res = await new Browser(h.app, ENV, ip).post('/api/demo');
    expect(res.status).toBe(429);
    expect(res.body.code).toBe('rate_limited');
    expect((await new Browser(h.app, ENV, '198.51.100.201').post('/api/demo')).status).toBe(201);
  });

  it('expires after 24 hours and the cron deletes it with its sessions', async () => {
    const { b, me, w } = await visitor();
    await db.query(`UPDATE workspaces SET expires_at = now() - interval '1 minute' WHERE slug = $1`, [me.demo.workspace]);
    expect((await b.get(w)).status).toBe(404);
    const report = await cleanup(db);
    expect(report.demoCopies).toBeGreaterThanOrEqual(1);
    expect(await db.query(`SELECT 1 FROM workspaces WHERE slug = $1`, [me.demo.workspace])).toEqual([]);
    expect((await b.get('/api/auth/me')).status).toBe(401);
  });

  it('serves the read-only demo week without a session', async () => {
    const anon = h.browser();
    const week = expectStatus(await anon.get('/api/demo/week'), 200);
    expect(week.start).toBe(mondayOf(today()));
    expect(week.days).toHaveLength(5);
    expect(new Set(week.occurrences.map((o: any) => o.batch.name))).toEqual(new Set(['CSE-2A']));
    expect(week.occurrences.filter((o: any) => o.change).map((o: any) => o.status).sort()).toEqual(['cancelled', 'moved-away', 'moved-here']);
    const ece = expectStatus(await anon.get(`/api/demo/week?batch=ece-2a&start=${addDays(today(), 7)}`), 200);
    expect(ece.start).toBe(addDays(mondayOf(today()), 7));
    expect(ece.occurrences.every((o: any) => o.batch.name === 'ECE-2A' && o.status === 'scheduled')).toBe(true);
    expect((await anon.get('/api/demo/week?batch=nope')).status).toBe(404);
    expect(await db.query(`SELECT 1 FROM sessions WHERE false`)).toEqual([]);
  });
});

describe('maintenance', () => {
  it('prunes old changes, expired sessions and stale codes', async () => {
    const coord = await h.signup();
    const ws = expectStatus(await coord.post('/api/workspaces', { name: 'Old', institution: 'X' }), 201);
    const w = `/api/w/${ws.slug}`;
    const room = expectStatus(await coord.post(`${w}/rooms`, { name: 'R', capacity: 10 }), 201);
    const t = expectStatus(await coord.post(`${w}/teachers`, { name: 'T T' }), 201);
    const bt = expectStatus(await coord.post(`${w}/batches`, { name: 'B' }), 201);
    const co = expectStatus(await coord.post(`${w}/courses`, { code: 'C', name: 'C', teacherId: t.id }), 201);
    const cls = expectStatus(await coord.post(`${w}/classes`, { courseId: co.id, batchId: bt.id, roomId: room.id, day: 1, start: '09:00', end: '10:00' }), 201);
    const monday = mondayOf(today());
    await db.query(
      `INSERT INTO changes (workspace_id, class_id, occurs_on, kind, created_by) VALUES
         ($1, $2, $3::date - 182, 'cancelled', 'x'), ($1, $2, $3::date - 7, 'cancelled', 'x')`,
      [ws.id, cls.id, monday],
    );
    const other = h.browser();
    await other.post('/api/auth/login', { email: coord.email, password: 'correct horse battery' });
    await db.query(`UPDATE sessions SET expires_at = now() - interval '1 second' WHERE id = (SELECT id FROM sessions ORDER BY created_at DESC LIMIT 1)`);
    const report = await cleanup(db);
    expect(report.changes).toBe(1);
    expect(report.sessions).toBeGreaterThanOrEqual(1);
    expect(report.deleted).toBe(report.demoCopies + report.sessions + report.changes + report.codes);
    expect((await db.query(`SELECT 1 FROM changes WHERE class_id = $1`, [cls.id])).length).toBe(1);
  });

  it('serves /internal/stats and /internal/cleanup only with the key', async () => {
    const env = { ...ENV, INTERNAL_KEY: 'k'.repeat(32) };
    const app = harness(db, env).app;
    const call = (method: string, path: string, key?: string) =>
      app.request(path, { method, headers: key ? { 'x-internal-key': key } : {} }, env);
    expect((await call('GET', '/internal/stats')).status).toBe(404);
    expect((await call('GET', '/internal/stats', 'wrong')).status).toBe(404);
    const stats = await (await call('GET', '/internal/stats', 'k'.repeat(32))).json();
    expect(stats).toEqual({ dbBytes: expect.any(Number), users: expect.any(Number), changes: expect.any(Number), demoCopies: expect.any(Number), workspaces: expect.any(Number) });
    expect(stats.users).toBeGreaterThan(0);
    const cleaned = await (await call('POST', '/internal/cleanup', 'k'.repeat(32))).json();
    expect(cleaned).toEqual({ deleted: expect.any(Number), demoCopies: expect.any(Number), sessions: expect.any(Number), changes: expect.any(Number), codes: expect.any(Number) });
    // without INTERNAL_KEY configured the routes do not exist
    expect((await h.app.request('/internal/stats', { headers: { 'x-internal-key': '' } }, ENV)).status).toBe(404);
  });
});
