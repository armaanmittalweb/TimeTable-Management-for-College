import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { cleanupOverlays } from '../src/data';
import { addDays, isoWeekday } from '../src/dates';
import type { Db } from '../src/db';
import {
  apiClient,
  decodeJwt,
  ENV,
  nextWeekday,
  pgliteDb,
  PROFESSOR,
  SANDBOX_A,
  SANDBOX_B,
  seededPglite,
  STUDENT,
  today,
} from './helpers';

let pg: PGlite;
let db: Db;
let api: ReturnType<typeof apiClient>;
let profToken: string;
let studentToken: string;

beforeAll(async () => {
  pg = await seededPglite();
  db = pgliteDb(pg);
  api = apiClient(db);
  profToken = await api.login(PROFESSOR);
  studentToken = await api.login(STUDENT);
});

// Base tables are never written by the API; only overlays need resetting.
beforeEach(async () => {
  await pg.exec('DELETE FROM modified_classes');
});

const one = async <T = any>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params))[0];

const timetable = (sandbox?: string, token = studentToken) =>
  api.call('GET', '/api/timetable/timetable', { token, sandbox });

const freeRooms = (body: object, sandbox?: string) =>
  api.call('POST', '/api/timetable/available-rooms', { token: profToken, sandbox, body });

const postpone = (body: object, sandbox = SANDBOX_A, token = profToken) =>
  api.call('POST', '/api/timetable/postpone-class', { token, sandbox, body });

/** prof.meera's first class (CS201, CSE-2A). */
const MEERA_CLASS = 1;
const LT101 = 4;

describe('health and auth', () => {
  it('reports health', async () => {
    const res = await api.call('GET', '/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', db: 'ok' });
  });

  it('logs in and issues the same JWT payload as the Express server', async () => {
    expect(decodeJwt(profToken)).toMatchObject({ id: 1, role: 'professor', batch: null });
    const student = decodeJwt(studentToken);
    expect(student).toMatchObject({ role: 'student', batch: 'CSE-2A' });
    expect(student.exp - student.iat).toBe(24 * 60 * 60);
  });

  it('rejects bad credentials and locked seed accounts', async () => {
    for (const body of [
      { username: PROFESSOR, password: 'wrong' },
      { username: 'kabir.sethi', password: '!locked' },
      { username: 'nobody', password: 'x' },
      {},
    ]) {
      const res = await api.call('POST', '/api/auth/login', { body });
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'Invalid credentials' });
    }
  });

  it('keeps registration closed in the public demo', async () => {
    const res = await api.call('POST', '/api/auth/register', {
      body: { username: 'x', password: 'secret1', email: 'x@edusched.test', role: 'student', batch: 'CSE-2A' },
    });
    expect(res.status).toBe(403);
  });

  it('registers (outside demo mode) with a hash the login accepts', async () => {
    const open = apiClient(db, { ...ENV, DEMO_MODE: 'false' });
    const body = { username: 'new.student', password: 'secret1', email: 'new@edusched.test', role: 'student', batch: 'ECE-2A' };
    expect((await open.call('POST', '/api/auth/register', { body })).status).toBe(201);
    expect((await open.call('POST', '/api/auth/register', { body })).status).toBe(409);
    expect(decodeJwt(await open.login('new.student', 'secret1'))).toMatchObject({ role: 'student', batch: 'ECE-2A' });
  });

  it('guards timetable routes like the Express middleware', async () => {
    expect((await api.call('GET', '/api/timetable/timetable')).body).toEqual({ error: 'Access token required' });
    const bad = await api.call('GET', '/api/timetable/timetable', { token: 'not.a.jwt' });
    expect(bad.status).toBe(403);
    const student = await api.call('POST', '/api/timetable/cancel-class', { token: studentToken, body: { classId: 1 } });
    expect(student.status).toBe(403);
    expect(student.body).toEqual({ error: 'Professor access required' });
  });
});

describe('timetable reads', () => {
  it("returns the student's batch, one row per class, in weekday order", async () => {
    const res = await timetable();
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(14);
    expect(res.body.every((r: any) => r.batch === 'CSE-2A')).toBe(true);
    expect(res.body[0]).toMatchObject({
      id: 1,
      course_code: 'CS201',
      course_name: 'Data Structures',
      day_of_week: 1,
      start_time: '09:00:00',
      end_time: '10:00:00',
      room_number: 'CR-201',
      building: 'Main Block',
      faculty_name: 'prof.meera',
      modification_type: null,
      new_date: null,
    });
    const days = res.body.map((r: any) => r.day_of_week);
    expect(days).toEqual([...days].sort());
  });

  it("returns only the professor's own courses", async () => {
    const res = await timetable(undefined, profToken);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(12);
    expect(new Set(res.body.map((r: any) => r.course_code))).toEqual(new Set(['CS201', 'CS207']));
    expect(new Set(res.body.map((r: any) => r.batch))).toEqual(new Set(['CSE-2A', 'CSE-2B']));
  });

  it('does not hide a class whose only overlay has expired (bug in the Express query)', async () => {
    await db.query(
      `INSERT INTO modified_classes (regular_class_id, modification_type, valid_until) VALUES (1, 'cancelled', $1)`,
      [addDays(today(), -1)],
    );
    const res = await timetable();
    expect(res.body).toHaveLength(14);
    expect(res.body.find((r: any) => r.id === 1).modification_type).toBeNull();
  });

  it('returns class details as an array, 404 when missing', async () => {
    const res = await api.call('GET', '/api/timetable/class/1', { token: profToken });
    expect(res.body).toEqual([expect.objectContaining({ id: 1, course_name: 'Data Structures', start_time: '09:00:00' })]);
    expect((await api.call('GET', '/api/timetable/class/9999', { token: profToken })).status).toBe(404);
  });
});

describe('cancel', () => {
  it('cancels an own class as an overlay, leaving the base row untouched', async () => {
    const res = await api.call('POST', '/api/timetable/cancel-class', {
      token: profToken,
      sandbox: SANDBOX_A,
      body: { classId: MEERA_CLASS },
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: 'Class cancelled successfully' });

    const row = (await timetable(SANDBOX_A)).body.find((r: any) => r.id === MEERA_CLASS);
    expect(row.modification_type).toBe('cancelled');
    expect(await one('SELECT count(*)::int AS n FROM regular_timetable')).toEqual({ n: 42 });
    const overlay = await one('SELECT sandbox_id, valid_until::text AS valid_until FROM modified_classes');
    expect(overlay.sandbox_id).toBe(SANDBOX_A);
    expect(isoWeekday(overlay.valid_until)).toBe(7); // ends on a Sunday
  });

  it("refuses another professor's class and a second change to the same class", async () => {
    const other = await one<{ id: number }>(
      `SELECT rt.id FROM regular_timetable rt JOIN courses c ON c.id = rt.course_id WHERE c.professor_id <> 1 LIMIT 1`,
    );
    const cancel = (classId: number) =>
      api.call('POST', '/api/timetable/cancel-class', { token: profToken, sandbox: SANDBOX_A, body: { classId } });
    expect((await cancel(other.id)).status).toBe(403);
    expect((await cancel(MEERA_CLASS)).status).toBe(200);
    expect((await cancel(MEERA_CLASS)).status).toBe(409);
    expect((await cancel(99999)).status).toBe(400);
  });

  it('frees the room of a cancelled class, only while the cancellation is valid', async () => {
    // Inserted directly so the test does not depend on today's weekday
    // (the endpoint's cancellations end on Sunday).
    const monday = nextWeekday(1);
    const slot = { date: monday, startTime: '09:00', endTime: '10:00' }; // class 1: Mon 09:00 CR-201
    const free = async (sandbox: string) => (await freeRooms(slot, sandbox)).body.map((r: any) => r.room_number);
    const cancelUntil = (validUntil: string) =>
      db.query(
        `INSERT INTO modified_classes (regular_class_id, modification_type, valid_until, sandbox_id)
         VALUES (1, 'cancelled', $1, $2)`,
        [validUntil, SANDBOX_A],
      );

    await cancelUntil(addDays(monday, -1)); // expires the day before
    expect(await free(SANDBOX_A)).not.toContain('CR-201');
    await cancelUntil(monday);
    expect(await free(SANDBOX_A)).toContain('CR-201');
    expect(await free(SANDBOX_B)).not.toContain('CR-201');
  });
});

describe('available rooms', () => {
  it('lists rooms not booked by the base timetable in that slot', async () => {
    const date = nextWeekday(1);
    const booked = await db.query<{ room_number: string }>(
      `SELECT cl.room_number FROM regular_timetable rt JOIN classrooms cl ON cl.id = rt.classroom_id
        WHERE rt.day_of_week = 1 AND rt.start_time < '10:00' AND rt.end_time > '09:00'`,
    );
    expect(booked.length).toBeGreaterThan(0);
    const res = await freeRooms({ date, startTime: '09:00', endTime: '10:00' });
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(6 - booked.length);
    expect(res.body[0]).toEqual({ id: expect.any(Number), room_number: expect.any(String), capacity: expect.any(Number), building: expect.any(String) });
    for (const { room_number } of booked) {
      expect(res.body.map((r: any) => r.room_number)).not.toContain(room_number);
    }
  });

  it('treats back-to-back classes as free (half-open intervals)', async () => {
    // a room with a Monday class ending at 10:00 and nothing from 10:00 to 11:00
    const room = await one<{ room_number: string }>(
      `SELECT cl.room_number FROM classrooms cl
        WHERE EXISTS (SELECT 1 FROM regular_timetable rt
                       WHERE rt.classroom_id = cl.id AND rt.day_of_week = 1 AND rt.end_time = '10:00')
          AND NOT EXISTS (SELECT 1 FROM regular_timetable rt
                           WHERE rt.classroom_id = cl.id AND rt.day_of_week = 1
                             AND rt.start_time < '11:00' AND rt.end_time > '10:00')
        LIMIT 1`,
    );
    expect(room).toBeDefined();
    const res = await freeRooms({ date: nextWeekday(1), startTime: '10:00', endTime: '11:00' });
    expect(res.body.map((r: any) => r.room_number)).toContain(room.room_number);
  });

  it('lists every room on a Saturday and validates input', async () => {
    expect((await freeRooms({ date: nextWeekday(6), startTime: '10:00', endTime: '11:00' })).body).toHaveLength(6);
    expect((await freeRooms({ date: 'tomorrow', startTime: '10:00', endTime: '11:00' })).status).toBe(400);
    expect((await freeRooms({ date: nextWeekday(6), startTime: '11:00', endTime: '10:00' })).status).toBe(400);
  });
});

describe('postpone', () => {
  const saturday = () => ({
    classId: MEERA_CLASS,
    newDate: nextWeekday(6),
    newStartTime: '10:00',
    newEndTime: '11:00',
    newClassroomId: String(LT101), // the frontend sends the <select> value as a string
    validUntil: addDays(today(), 7),
  });

  it('postpones into a free room and shows the change to the batch', async () => {
    const res = await postpone(saturday());
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ message: 'Class successfully postponed' });

    const row = (await timetable(SANDBOX_A)).body.find((r: any) => r.id === MEERA_CLASS);
    expect(row).toMatchObject({
      modification_type: 'postponed',
      new_date: nextWeekday(6),
      new_start_time: '10:00:00',
      new_end_time: '11:00:00',
      new_classroom_id: LT101,
      new_room_number: 'LT-101',
    });
    const rooms = await freeRooms({ date: nextWeekday(6), startTime: '10:30', endTime: '11:30' }, SANDBOX_A);
    expect(rooms.body.map((r: any) => r.room_number)).not.toContain('LT-101');
  });

  it('keeps the overlay alive at least until the new date', async () => {
    const newDate = addDays(nextWeekday(6), 14);
    await postpone({ ...saturday(), newDate, validUntil: addDays(today(), 1) });
    expect(await one('SELECT valid_until::text AS v FROM modified_classes')).toEqual({ v: newDate });
  });

  it('returns 409 naming the room when the room is taken', async () => {
    // a base class of another professor, at a time prof.meera is free
    const taken = await one<{ id: number; day_of_week: number; start_time: string; end_time: string; classroom_id: number }>(
      `SELECT rt.id, rt.day_of_week, rt.start_time::text AS start_time, rt.end_time::text AS end_time, rt.classroom_id
         FROM regular_timetable rt JOIN courses c ON c.id = rt.course_id
        WHERE c.professor_id <> 1
          AND NOT EXISTS (
            SELECT 1 FROM regular_timetable r2 JOIN courses c2 ON c2.id = r2.course_id
             WHERE c2.professor_id = 1 AND r2.day_of_week = rt.day_of_week
               AND r2.start_time < rt.end_time AND r2.end_time > rt.start_time)
        ORDER BY rt.id LIMIT 1`,
    );
    const res = await postpone({
      classId: MEERA_CLASS,
      newDate: nextWeekday(taken.day_of_week),
      newStartTime: taken.start_time.slice(0, 5),
      newEndTime: taken.end_time.slice(0, 5),
      newClassroomId: taken.classroom_id,
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Selected room is not available for the chosen time slot');
    expect(res.body.clashes).toEqual([expect.objectContaining({ type: 'room', class_id: taken.id })]);
    expect(await one('SELECT count(*)::int AS n FROM modified_classes')).toEqual({ n: 0 });
  });

  it('returns 409 naming the professor when they are already teaching', async () => {
    // prof.meera's own class on another day, and a room that is free at that time
    const busy = await one<{ id: number; day_of_week: number; start_time: string; end_time: string }>(
      `SELECT rt.id, rt.day_of_week, rt.start_time::text AS start_time, rt.end_time::text AS end_time
         FROM regular_timetable rt JOIN courses c ON c.id = rt.course_id
        WHERE c.professor_id = 1 AND rt.id <> $1 AND rt.day_of_week <> 1
        ORDER BY rt.id LIMIT 1`,
      [MEERA_CLASS],
    );
    const date = nextWeekday(busy.day_of_week);
    const [freeRoom] = (
      await freeRooms({ date, startTime: busy.start_time.slice(0, 5), endTime: busy.end_time.slice(0, 5) }, SANDBOX_A)
    ).body;
    const res = await postpone({
      classId: MEERA_CLASS,
      newDate: date,
      newStartTime: busy.start_time.slice(0, 5),
      newEndTime: busy.end_time.slice(0, 5),
      newClassroomId: freeRoom.id,
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Professor has a scheduling conflict during this time');
    expect(res.body.clashes).toEqual([expect.objectContaining({ type: 'professor', class_id: busy.id })]);
  });

  it('checks against earlier postponements too (room and professor)', async () => {
    expect((await postpone(saturday())).status).toBe(201);
    const second = await postpone({ ...saturday(), classId: 2, newStartTime: '10:30', newEndTime: '11:30' });
    expect(second.status).toBe(409);
    expect(second.body.clashes.map((c: any) => c.type).sort()).toEqual(['professor', 'room']);
  });

  it('confirm-postpone goes through the same clash check', async () => {
    const call = (classId: number) =>
      api.call('POST', '/api/timetable/confirm-postpone', {
        token: profToken,
        sandbox: SANDBOX_A,
        body: { ...saturday(), classId },
      });
    expect((await call(MEERA_CLASS)).status).toBe(201);
    expect((await call(2)).status).toBe(409);
  });

  it('validates input and permissions', async () => {
    expect((await postpone({ ...saturday(), newDate: addDays(today(), -1) })).status).toBe(400);
    expect((await postpone({ ...saturday(), newEndTime: '09:00' })).status).toBe(400);
    expect((await postpone({ classId: MEERA_CLASS })).status).toBe(400);
    expect((await postpone({ ...saturday(), newClassroomId: 999 })).status).toBe(400);
    expect((await postpone(saturday(), SANDBOX_A, studentToken)).status).toBe(403);
  });
});

describe('sandboxes', () => {
  it("keeps one visitor's changes out of everyone else's view", async () => {
    expect((await postpone(saturday())).status).toBe(201);
    const find = (res: any) => res.body.find((r: any) => r.id === MEERA_CLASS).modification_type;
    expect(find(await timetable(SANDBOX_A))).toBe('postponed');
    expect(find(await timetable(SANDBOX_B))).toBeNull();
    expect(find(await timetable())).toBeNull();
  });

  it("does not let another sandbox's booking block a room", async () => {
    expect((await postpone(saturday(), SANDBOX_A)).status).toBe(201);
    expect((await postpone({ ...saturday(), classId: 2 }, SANDBOX_B)).status).toBe(201);
    expect((await postpone({ ...saturday(), classId: 2 }, SANDBOX_A)).status).toBe(409);
  });

  it('shows shared (sandbox_id NULL) overlays to everyone and counts them in clash checks', async () => {
    const date = nextWeekday(6);
    await db.query(
      `INSERT INTO modified_classes (regular_class_id, modification_type, new_date, new_start_time, new_end_time, new_classroom_id, valid_until)
       VALUES (2, 'postponed', $1, '10:00', '11:00', $2, $1)`,
      [date, LT101],
    );
    expect((await timetable(SANDBOX_B)).body.find((r: any) => r.id === 2).modification_type).toBe('postponed');
    expect((await postpone(saturday(), SANDBOX_B)).status).toBe(409);
  });

  it('issues a sandbox id when none is sent, and rejects malformed ones', async () => {
    const res = await timetable();
    expect(res.headers.get('X-Sandbox-Id')).toMatch(/^[A-Za-z0-9_-]{22}$/);
    const echoed = await timetable(SANDBOX_A);
    expect(echoed.headers.get('X-Sandbox-Id')).toBe(SANDBOX_A);
    expect((await timetable('bad id!')).status).toBe(400);
    expect((await timetable('short')).status).toBe(400);
  });

  it('writes with no header land in a fresh private sandbox, never the shared layer', async () => {
    const res = await api.call('POST', '/api/timetable/cancel-class', { token: profToken, body: { classId: 1 } });
    expect(res.status).toBe(200);
    const { sandbox_id } = await one('SELECT sandbox_id FROM modified_classes');
    expect(sandbox_id).toBe(res.headers.get('X-Sandbox-Id'));
  });

  function saturday() {
    return { classId: MEERA_CLASS, newDate: nextWeekday(6), newStartTime: '10:00', newEndTime: '11:00', newClassroomId: LT101 };
  }
});

describe('expiry cleanup', () => {
  it('deletes expired overlays and sandbox overlays older than 24 h', async () => {
    const t = today();
    await db.query(
      `INSERT INTO modified_classes (regular_class_id, modification_type, valid_until, sandbox_id, created_at) VALUES
         (1, 'cancelled', $1, NULL,      now()),                       -- expired, shared
         (3, 'cancelled', $2, $3,        now() - interval '25 hours'), -- stale sandbox
         (4, 'cancelled', $2, $3,        now() - interval '1 hour'),   -- fresh sandbox
         (5, 'cancelled', $2, NULL,      now() - interval '3 days')`, // shared, still valid
      [addDays(t, -1), addDays(t, 3), SANDBOX_A],
    );
    expect(await cleanupOverlays(db, t)).toBe(2);
    const left = await db.query<{ regular_class_id: number }>(
      'SELECT regular_class_id FROM modified_classes ORDER BY regular_class_id',
    );
    expect(left.map((r) => r.regular_class_id)).toEqual([4, 5]);
    expect(await cleanupOverlays(db, t)).toBe(0);
  });
});

describe('CORS', () => {
  it('allows the portfolio and local dev origins, and exposes the sandbox header', async () => {
    const preflight = (origin: string) =>
      api.app.request(
        '/api/timetable/timetable',
        {
          method: 'OPTIONS',
          headers: { Origin: origin, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'x-sandbox-id' },
        },
        ENV,
      );
    for (const origin of ['https://edusched.amittal.dev', 'https://www.amittal.dev', 'http://localhost:5173']) {
      const res = await preflight(origin);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe(origin);
      expect(res.headers.get('Access-Control-Allow-Headers')).toMatch(/X-Sandbox-Id/i);
    }
    expect((await preflight('https://evil.example')).headers.get('Access-Control-Allow-Origin')).toBeNull();

    const res = await api.app.request('/api/test', { headers: { Origin: 'http://localhost:5173' } }, ENV);
    expect(res.headers.get('Access-Control-Expose-Headers')).toMatch(/X-Sandbox-Id/i);
  });
});

describe('internal routes', () => {
  const KEY = 'internal-test-key';
  const withKey = { ...ENV, INTERNAL_KEY: KEY };

  it('404s without the key, or when no key is configured', async () => {
    const app = createApp(() => db);
    expect((await app.request('/internal/stats', {}, withKey)).status).toBe(404);
    expect((await app.request('/internal/stats', { headers: { 'x-internal-key': 'wrong' } }, withKey)).status).toBe(404);
    expect((await app.request('/internal/stats', { headers: { 'x-internal-key': KEY } }, ENV)).status).toBe(404);
  });

  it('reports database size and overlay counts, and runs the cleanup', async () => {
    const app = createApp(() => db);
    const stats = (await (await app.request('/internal/stats', { headers: { 'x-internal-key': KEY } }, withKey)).json()) as Record<string, number>;
    expect(stats.dbBytes).toBeGreaterThan(0);
    expect(stats.users).toBeGreaterThan(0);
    expect(typeof stats.overlays).toBe('number');
    const res = await app.request('/internal/cleanup', { method: 'POST', headers: { 'x-internal-key': KEY } }, withKey);
    expect(await res.json()).toMatchObject({ deleted: expect.any(Number) });
  });
});
