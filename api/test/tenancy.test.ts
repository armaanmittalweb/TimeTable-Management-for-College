// Tenant isolation: nothing in workspace B is visible or changeable from workspace A.

import { beforeAll, describe, expect, it } from 'vitest';
import { addDays } from '../src/dates';
import type { Db } from '../src/db';
import { buildCollege, expectStatus, freshPglite, harness, joinAsTeacher, nextWeekday, pgliteDb, type Browser, type College, type Harness } from './helpers';

let db: Db;
let h: Harness;
let coordA: Browser;
let coordB: Browser;
let teacherA: Browser;
let A: College;
let B: College;
let bChange: number;

const MON = () => nextWeekday(1);

beforeAll(async () => {
  db = pgliteDb(await freshPglite());
  h = harness(db);
  coordA = await h.signup('Coordinator A');
  coordB = await h.signup('Coordinator B');
  A = await buildCollege(coordA, 'Alpha');
  B = await buildCollege(coordB, 'Beta');
  teacherA = await joinAsTeacher(h, coordA, A, A.teachers.t1);
  bChange = expectStatus(await coordB.post(`${B.w}/classes/${B.classes.k2}/cancel`, { date: MON() }), 201).id;
});

/** Every workspace route, with a plausible body. */
function routes(c: College): [string, string, unknown?][] {
  const w = c.w;
  const k = c.classes.k1;
  return [
    ['GET', w],
    ['PATCH', w, { name: 'Taken over' }],
    ['POST', `${w}/publish`],
    ['POST', `${w}/unpublish`],
    ['GET', `${w}/periods`],
    ['PUT', `${w}/periods`, [{ start: '09:00', end: '10:00' }]],
    ['GET', `${w}/rooms`],
    ['POST', `${w}/rooms`, { name: 'X', capacity: 5 }],
    ['PATCH', `${w}/rooms/${c.rooms.r1}`, { capacity: 5 }],
    ['DELETE', `${w}/rooms/${c.rooms.lab}`],
    ['GET', `${w}/teachers`],
    ['POST', `${w}/teachers`, { name: 'X' }],
    ['PATCH', `${w}/teachers/${c.teachers.t1}`, { name: 'X' }],
    ['DELETE', `${w}/teachers/${c.teachers.t3}`],
    ['GET', `${w}/batches`],
    ['POST', `${w}/batches`, { name: 'X' }],
    ['PATCH', `${w}/batches/${c.batches.b1}`, { name: 'X' }],
    ['POST', `${w}/batches/${c.batches.b1}/code`],
    ['DELETE', `${w}/batches/${c.batches.b2}`],
    ['GET', `${w}/courses`],
    ['POST', `${w}/courses`, { code: 'X', name: 'X' }],
    ['PATCH', `${w}/courses/${c.courses.c1}`, { name: 'X' }],
    ['DELETE', `${w}/courses/${c.courses.c3}`],
    ['GET', `${w}/classes`],
    ['POST', `${w}/classes`, { courseId: c.courses.c1, batchId: c.batches.b1, roomId: c.rooms.lab, day: 5, start: '09:00', end: '10:00' }],
    ['PATCH', `${w}/classes/${k}`, { start: '08:00' }],
    ['DELETE', `${w}/classes/${c.classes.k4}`],
    ['POST', `${w}/import`, { kind: 'rooms', csv: 'name,capacity\nX,5\n', dryRun: false }],
    ['GET', `${w}/import/template/rooms`],
    ['GET', `${w}/members`],
    ['PATCH', `${w}/members/1`, { role: 'teacher' }],
    ['DELETE', `${w}/members/1`],
    ['POST', `${w}/invites`, { role: 'coordinator' }],
    ['POST', `${w}/members/1/reset-code`],
    ['GET', `${w}/week`],
    ['GET', `${w}/today`],
    ['GET', `${w}/changes`],
    ['GET', `${w}/free-rooms?date=${MON()}&start=09:00&end=10:00`],
    ['GET', `${w}/classes/${k}/slots`],
    ['POST', `${w}/classes/${k}/cancel`, { date: MON() }],
    ['POST', `${w}/classes/${k}/move`, { date: MON(), toDate: addDays(MON(), 3), toStart: '09:00', toEnd: '10:00', roomId: c.rooms.r2 }],
    ['DELETE', `${w}/changes/${bChange}`],
    ['POST', `${w}/feeds`, { kind: 'batch', targetId: c.batches.b1 }],
    ['POST', `${w}/demo/act-as`, { role: 'coordinator' }],
  ];
}

describe('tenant isolation', () => {
  it("answers 404 on every one of B's routes to A's coordinator and teacher", async () => {
    const before = await db.query(`SELECT count(*)::int AS n FROM changes`);
    for (const who of [coordA, teacherA]) {
      for (const [method, path, body] of routes(B)) {
        const res = await who.req(method, path, { body });
        expect({ method, path, status: res.status, code: res.body?.code }).toEqual({ method, path, status: 404, code: 'not_found' });
      }
    }
    expect(await db.query(`SELECT count(*)::int AS n FROM changes`)).toEqual(before);
    expect(expectStatus(await coordB.get(B.w), 200).workspace.name).toBe('Beta');
  });

  it('answers 401 to a signed-out visitor, the same for existing and made-up slugs', async () => {
    const anon = h.browser();
    expect((await anon.get(B.w)).status).toBe(401);
    expect((await anon.get('/api/w/no-such-workspace')).status).toBe(401);
    expect((await coordA.get('/api/w/no-such-workspace')).body).toEqual((await coordA.get(B.w)).body);
  });

  it("cannot reach B's rows through A's workspace", async () => {
    const w = A.w;
    // B's class, change, room, teacher and batch ids under A's slug
    expect((await coordA.post(`${w}/classes/${B.classes.k1}/cancel`, { date: MON() })).status).toBe(404);
    expect((await coordA.post(`${w}/classes/${B.classes.k1}/move`, { date: MON(), toDate: addDays(MON(), 3), toStart: '09:00', toEnd: '10:00', roomId: A.rooms.r2 })).status).toBe(404);
    expect((await coordA.del(`${w}/changes/${bChange}`)).status).toBe(404);
    expect((await coordA.patch(`${w}/rooms/${B.rooms.r1}`, { capacity: 1 })).status).toBe(404);
    expect((await coordA.del(`${w}/rooms/${B.rooms.lab}`)).status).toBe(404);
    expect((await coordA.patch(`${w}/classes/${B.classes.k1}`, { start: '08:00' })).status).toBe(404);
    expect((await coordA.get(`${w}/classes/${B.classes.k1}/slots`)).status).toBe(404);
    // A's class cannot be moved into B's room, or built from B's parts
    expect((await coordA.post(`${w}/classes/${A.classes.k1}/move`, { date: MON(), toDate: addDays(MON(), 3), toStart: '09:00', toEnd: '10:00', roomId: B.rooms.r2 })).status).toBe(400);
    expect((await coordA.post(`${w}/classes`, { courseId: A.courses.c1, batchId: B.batches.b1, roomId: A.rooms.lab, day: 5, start: '09:00', end: '10:00' })).status).toBe(400);
    expect((await coordA.post(`${w}/courses`, { code: 'X9', name: 'X', teacherId: B.teachers.t1 })).status).toBe(400);
    expect((await coordA.post(`${w}/feeds`, { kind: 'room', targetId: B.rooms.r1 })).status).toBe(400);
    expect((await coordA.post(`${w}/invites`, { role: 'teacher', teacherId: B.teachers.t2 })).status).toBe(400);
    // filters with B's ids match nothing
    expect(expectStatus(await coordA.get(`${w}/week?start=${MON()}&room=${B.rooms.r1}`), 200).occurrences).toEqual([]);
    // B's change does not show in A's feed of changes
    expect(expectStatus(await coordA.get(`${w}/changes`), 200)).toEqual([]);
    // and B is untouched
    const b = expectStatus(await coordB.get(B.w), 200);
    expect(b.rooms.find((r: any) => r.id === B.rooms.r1).capacity).toBe(60);
  });

  it('keeps clash checks inside one workspace', async () => {
    // B's R1 is busy Monday 09:00 with B's k1; A's own rooms are what count for A
    const free = expectStatus(await coordA.get(`${A.w}/free-rooms?date=${MON()}&start=09:00&end=10:00`), 200);
    expect(free.map((r: any) => r.id)).toEqual([A.rooms.lab]);
  });

  it("never shows B's classes through A's class code", async () => {
    const code = A.batches.codes[0];
    const week = expectStatus(await h.browser().get(`/api/public/${code}/week?start=${MON()}`), 200);
    const ids = week.occurrences.map((o: any) => o.classId);
    expect(ids).toEqual([A.classes.k1, A.classes.k3]);
    const changes = expectStatus(await h.browser().get(`/api/public/${code}/changes`), 200);
    expect(changes.every((c: any) => c.batch.id === A.batches.b1)).toBe(true);
    const ics = await h.browser().get(`/ics/b/${code}.ics`);
    expect(ics.text).not.toContain('Beta');
    for (const id of Object.values(B.classes)) expect(ics.text).not.toContain(`UID:${id}-`);
  });

  it('keeps the composite foreign keys as a backstop', async () => {
    const [{ id: wsA }] = await db.query<{ id: number }>(`SELECT id FROM workspaces WHERE slug = $1`, [A.slug]);
    await expect(
      db.query(
        `INSERT INTO classes (workspace_id, course_id, batch_id, teacher_id, room_id, day_of_week, start_time, end_time)
         VALUES ($1, $2, $3, $4, $5, 5, '09:00', '10:00')`,
        [wsA, A.courses.c1, A.batches.b1, A.teachers.t1, B.rooms.r1],
      ),
    ).rejects.toThrow(/foreign key/);
  });
});
