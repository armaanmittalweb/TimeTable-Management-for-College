import { beforeAll, describe, expect, it } from 'vitest';
import { addDays } from '../src/dates';
import type { Db } from '../src/db';
import {
  buildCollege,
  expectStatus,
  freshPglite,
  harness,
  joinAsTeacher,
  nextWeekday,
  pgliteDb,
  today,
  type Browser,
  type College,
  type Harness,
} from './helpers';

let db: Db;
let h: Harness;

beforeAll(async () => {
  db = pgliteDb(await freshPglite());
  h = harness(db);
});

// Next week's Monday and the days after it: always in the future.
const MON = () => nextWeekday(1);
const day = (n: number) => addDays(MON(), n - 1);

async function fresh(): Promise<{ coord: Browser; college: College }> {
  const coord = await h.signup('Chief Coordinator');
  return { coord, college: await buildCollege(coord) };
}

describe('week and today', () => {
  it('returns the week normalised to Monday with every occurrence', async () => {
    const { coord, college } = await fresh();
    const week = expectStatus(await coord.get(`${college.w}/week?start=${day(4)}`), 200);
    expect(week.start).toBe(MON());
    expect(week.end).toBe(day(7));
    expect(week.days).toEqual([1, 2, 3, 4, 5].map(day));
    expect(week.timezone).toBe('Asia/Kolkata');
    expect(week.today).toBe(today());
    expect(week.periods).toHaveLength(8);
    expect(week.occurrences).toHaveLength(4);
    expect(week.occurrences[0]).toEqual({
      key: `${college.classes.k1}:${MON()}`,
      classId: college.classes.k1,
      date: MON(),
      start: '09:00',
      end: '10:00',
      course: { id: college.courses.c1, code: 'C1', name: 'Course C1', color: expect.any(Number) },
      teacher: { id: college.teachers.t1, name: 'Tara One', short: 'T1' },
      room: { id: college.rooms.r1, name: 'R1' },
      batch: { id: college.batches.b1, name: 'B1' },
      status: 'scheduled',
      change: null,
    });
  });

  it('filters by batch, teacher or room, and refuses two filters', async () => {
    const { coord, college } = await fresh();
    const keys = async (q: string) =>
      expectStatus(await coord.get(`${college.w}/week?start=${MON()}&${q}`), 200).occurrences.map((o: any) => o.classId);
    const { k1, k2, k3, k4 } = college.classes;
    expect(await keys(`batch=${college.batches.b1}`)).toEqual([k1, k3]);
    expect(await keys(`teacher=${college.teachers.t1}`)).toEqual([k1, k4]);
    expect(await keys(`room=${college.rooms.r2}`)).toEqual([k2, k3]);
    expect((await coord.get(`${college.w}/week?batch=1&teacher=1`)).status).toBe(400);
    expect((await coord.get(`${college.w}/week?start=not-a-date`)).status).toBe(400);
  });

  it('returns only today for /today', async () => {
    const { coord, college } = await fresh();
    const occ = expectStatus(await coord.get(`${college.w}/today`), 200);
    expect(Array.isArray(occ)).toBe(true);
    expect(occ.every((o: any) => o.date === today())).toBe(true);
  });
});

describe('cancel', () => {
  it('cancels one occurrence only', async () => {
    const { coord, college } = await fresh();
    const res = await coord.post(`${college.w}/classes/${college.classes.k1}/cancel`, { date: MON(), reason: 'Unwell' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: expect.any(Number),
      classId: college.classes.k1,
      kind: 'cancelled',
      course: { code: 'C1', name: 'Course C1', color: expect.any(Number) },
      batch: { id: college.batches.b1, name: 'B1' },
      from: { date: MON(), start: '09:00', end: '10:00', room: 'R1' },
      to: null,
      reason: 'Unwell',
      by: 'Chief Coordinator',
      at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/),
    });
    const thisWeek = expectStatus(await coord.get(`${college.w}/week?start=${MON()}`), 200).occurrences;
    const k1 = thisWeek.find((o: any) => o.classId === college.classes.k1);
    expect(k1.status).toBe('cancelled');
    expect(k1.change.id).toBe(res.body.id);
    const nextWeek = expectStatus(await coord.get(`${college.w}/week?start=${addDays(MON(), 7)}`), 200).occurrences;
    expect(nextWeek.find((o: any) => o.classId === college.classes.k1).status).toBe('scheduled');
  });

  it('refuses a second change, a day the class does not meet, a past date and unknown classes', async () => {
    const { coord, college } = await fresh();
    const cancel = (date: string, id = college.classes.k1) => coord.post(`${college.w}/classes/${id}/cancel`, { date });
    expect((await cancel(MON())).status).toBe(201);
    const again = await cancel(MON());
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('conflict');
    expect((await cancel(day(2))).status).toBe(400);
    expect((await cancel(addDays(MON(), -7))).status).toBe(400);
    expect((await cancel(MON(), 999999)).status).toBe(404);
    expect((await coord.post(`${college.w}/classes/abc/cancel`, { date: MON() })).status).toBe(404);
  });
});

describe('move', () => {
  it('moves an occurrence and shows it in both places', async () => {
    const { coord, college } = await fresh();
    const res = await coord.post(`${college.w}/classes/${college.classes.k1}/move`, {
      date: MON(),
      toDate: day(4),
      toStart: '09:00',
      toEnd: '10:00',
      roomId: college.rooms.r2,
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      kind: 'moved',
      from: { date: MON(), start: '09:00', end: '10:00', room: 'R1' },
      to: { date: day(4), start: '09:00', end: '10:00', room: 'R2' },
      reason: null,
    });
    const occ = expectStatus(await coord.get(`${college.w}/week?start=${MON()}`), 200).occurrences;
    const k1 = occ.filter((o: any) => o.classId === college.classes.k1);
    expect(k1.map((o: any) => [o.key, o.date, o.status, o.room.name])).toEqual([
      [`${college.classes.k1}:${MON()}`, MON(), 'moved-away', 'R1'],
      [`${college.classes.k1}:${MON()}:to`, day(4), 'moved-here', 'R2'],
    ]);
    // room views: the old room shows it leaving, the new room shows it arriving
    const inRoom = async (roomId: number) =>
      expectStatus(await coord.get(`${college.w}/week?start=${MON()}&room=${roomId}`), 200)
        .occurrences.filter((o: any) => o.classId === college.classes.k1)
        .map((o: any) => o.status);
    expect(await inRoom(college.rooms.r1)).toEqual(['moved-away']);
    expect(await inRoom(college.rooms.r2)).toEqual(['moved-here']);
  });

  it('refuses room, teacher and batch clashes with a suggestion', async () => {
    const { coord, college } = await fresh();
    const move = (to: object) =>
      coord.post(`${college.w}/classes/${college.classes.k1}/move`, { date: MON(), toStart: '10:00', toEnd: '11:00', ...to });

    // Tue 10:00 in R2: k3 is there (room) and k3 is also B1 (batch)
    const both = await move({ toDate: day(2), roomId: college.rooms.r2 });
    expect(both.status).toBe(409);
    expect(both.body.code).toBe('clash');
    expect(both.body.clashes).toEqual([
      { type: 'room', classId: college.classes.k3, course: 'C3', start: '10:00', end: '11:00', room: 'R2' },
      { type: 'batch', classId: college.classes.k3, course: 'C3', start: '10:00', end: '11:00', room: 'R2' },
    ]);
    expect(both.body.error).toBe('R2 is booked at 10:00 by C3. B1 has C3 at 10:00.');

    // Wed 11:00 in LAB: T1 teaches k4 then
    const teacher = await move({ toDate: day(3), toStart: '11:00', toEnd: '12:00', roomId: college.rooms.lab });
    expect(teacher.status).toBe(409);
    expect(teacher.body.clashes.map((c: any) => c.type)).toEqual(['teacher']);
    expect(teacher.body.error).toBe('Tara One teaches C1 at 11:00.');
    // the next free slot that day: 12:00, in the rooms big enough for B1 (50)
    expect(teacher.body.suggestion).toEqual({
      date: day(3),
      start: '12:00',
      end: '13:00',
      teacherBusy: false,
      batchBusy: false,
      freeRooms: [
        { id: college.rooms.r1, name: 'R1', capacity: 60 },
        { id: college.rooms.r2, name: 'R2', capacity: 60 },
      ],
    });

    // nothing was written
    expect(await db.query(`SELECT 1 FROM changes c JOIN classes k ON k.id = c.class_id WHERE k.id = $1`, [college.classes.k1])).toEqual([]);
  });

  it('sees earlier moves when checking (a moved class blocks its new slot and frees its old one)', async () => {
    const { coord, college } = await fresh();
    const { w, classes, rooms } = college;
    // k2 (R2, Mon 09:00) moves to Thu 09:00 in R1
    expectStatus(await coord.post(`${w}/classes/${classes.k2}/move`, { date: MON(), toDate: day(4), toStart: '09:00', toEnd: '10:00', roomId: rooms.r1 }), 201);
    // R1 is now taken Thu 09:00
    const taken = await coord.post(`${w}/classes/${classes.k1}/move`, { date: MON(), toDate: day(4), toStart: '09:30', toEnd: '10:30', roomId: rooms.r1 });
    expect(taken.status).toBe(409);
    expect(taken.body.clashes).toEqual([{ type: 'room', classId: classes.k2, course: 'C2', start: '09:00', end: '10:00', room: 'R1' }]);
    // R2 on Monday 09:00 is free now that k2 left it
    const free = expectStatus(await coord.get(`${w}/free-rooms?date=${MON()}&start=09:00&end=10:00`), 200);
    expect(free.map((r: any) => r.name)).toEqual(['LAB', 'R2']);
    expect((await coord.post(`${w}/classes/${classes.k1}/move`, { date: MON(), toDate: MON(), toStart: '09:00', toEnd: '10:00', roomId: rooms.r2 })).status).toBe(201);
  });

  it('validates the target', async () => {
    const { coord, college } = await fresh();
    const move = (body: object) =>
      coord.post(`${college.w}/classes/${college.classes.k1}/move`, { date: MON(), toDate: day(4), toStart: '09:00', toEnd: '10:00', roomId: college.rooms.r2, ...body });
    expect((await move({ toDate: addDays(today(), -1) })).status).toBe(400); // the past
    expect((await move({ toDate: day(6) })).status).toBe(400); // Saturday is not a teaching day
    expect((await move({ toEnd: '08:00' })).status).toBe(400);
    expect((await move({ roomId: 999999 })).status).toBe(400);
    expect((await move({ toStart: '9am' })).status).toBe(400);
  });
});

describe('undo', () => {
  it('undoes a change and puts the class back', async () => {
    const { coord, college } = await fresh();
    const change = expectStatus(await coord.post(`${college.w}/classes/${college.classes.k1}/move`, { date: MON(), toDate: day(4), toStart: '09:00', toEnd: '10:00', roomId: college.rooms.r2 }), 201);
    expect((await coord.del(`${college.w}/changes/${change.id}`)).status).toBe(204);
    const occ = expectStatus(await coord.get(`${college.w}/week?start=${MON()}`), 200).occurrences;
    expect(occ.filter((o: any) => o.classId === college.classes.k1).map((o: any) => o.status)).toEqual(['scheduled']);
    expect((await coord.del(`${college.w}/changes/${change.id}`)).status).toBe(404);
  });

  it('refuses to undo when the original slot has been taken since', async () => {
    const { coord, college } = await fresh();
    const { w, classes, rooms } = college;
    const cancel = expectStatus(await coord.post(`${w}/classes/${classes.k1}/cancel`, { date: MON() }), 201);
    // k2 moves into the freed R1 at the same time
    expectStatus(await coord.post(`${w}/classes/${classes.k2}/move`, { date: MON(), toDate: MON(), toStart: '09:00', toEnd: '10:00', roomId: rooms.r1 }), 201);
    const res = await coord.del(`${w}/changes/${cancel.id}`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('clash');
    expect(res.body.clashes).toEqual([{ type: 'room', classId: classes.k2, course: 'C2', start: '09:00', end: '10:00', room: 'R1' }]);
  });

  it('lists changes newest first, within a range', async () => {
    const { coord, college } = await fresh();
    const a = expectStatus(await coord.post(`${college.w}/classes/${college.classes.k1}/cancel`, { date: MON() }), 201);
    const b = expectStatus(await coord.post(`${college.w}/classes/${college.classes.k3}/cancel`, { date: day(2) }), 201);
    await db.query(`UPDATE changes SET created_at = created_at - interval '1 hour' WHERE id = $1`, [a.id]);
    expect(expectStatus(await coord.get(`${college.w}/changes`), 200).map((c: any) => c.id)).toEqual([b.id, a.id]);
    expect(expectStatus(await coord.get(`${college.w}/changes?start=${day(2)}&end=${day(2)}`), 200).map((c: any) => c.id)).toEqual([b.id]);
    expect((await coord.get(`${college.w}/changes?start=${day(3)}&end=${day(2)}`)).status).toBe(400);
  });
});

describe('teachers change only their own classes', () => {
  it('lets a teacher cancel, move and undo their own class and nothing else', async () => {
    const { coord, college } = await fresh();
    const t1 = await joinAsTeacher(h, coord, college, college.teachers.t1);
    const { w, classes } = college;

    const own = await t1.post(`${w}/classes/${classes.k1}/cancel`, { date: MON() });
    expect(own.status).toBe(201);
    expect(own.body.by).toBe('A Teacher');
    expect((await t1.del(`${w}/changes/${own.body.id}`)).status).toBe(204);

    const notMine = await t1.post(`${w}/classes/${classes.k2}/cancel`, { date: MON() });
    expect(notMine.status).toBe(403);
    expect(notMine.body.code).toBe('forbidden');
    expect((await t1.post(`${w}/classes/${classes.k2}/move`, { date: MON(), toDate: day(4), toStart: '09:00', toEnd: '10:00', roomId: college.rooms.r1 })).status).toBe(403);

    const coordChange = expectStatus(await coord.post(`${w}/classes/${classes.k2}/cancel`, { date: MON() }), 201);
    expect((await t1.del(`${w}/changes/${coordChange.id}`)).status).toBe(403);
    // but they may read everything
    expect(expectStatus(await t1.get(`${w}/week?start=${MON()}`), 200).occurrences).toHaveLength(4);
    expect((await t1.get(`${w}/classes/${classes.k2}/slots?week=${MON()}`)).status).toBe(200);
  });

  it('a teacher account not linked to a teacher row changes nothing', async () => {
    const { coord, college } = await fresh();
    const t = await joinAsTeacher(h, coord, college, college.teachers.t1);
    const me = expectStatus(await t.get('/api/auth/me'), 200);
    await db.query(`UPDATE members SET teacher_id = NULL WHERE user_id = $1`, [me.user.id]);
    expect((await t.post(`${college.w}/classes/${college.classes.k1}/cancel`, { date: MON() })).status).toBe(403);
  });
});

describe('free rooms and slots', () => {
  it('lists free rooms, optionally ignoring one class', async () => {
    const { coord, college } = await fresh();
    const q = `date=${MON()}&start=09:00&end=10:00`;
    expect(expectStatus(await coord.get(`${college.w}/free-rooms?${q}`), 200)).toEqual([
      { id: college.rooms.lab, name: 'LAB', capacity: 30, building: null, kind: 'lab' },
    ]);
    expect(expectStatus(await coord.get(`${college.w}/free-rooms?${q}&exclude=${college.classes.k1}`), 200).map((r: any) => r.name)).toEqual(['LAB', 'R1']);
    // half-open: 10:00-11:00 does not touch 09:00-10:00
    expect(expectStatus(await coord.get(`${college.w}/free-rooms?date=${MON()}&start=10:00&end=11:00`), 200)).toHaveLength(3);
    expect((await coord.get(`${college.w}/free-rooms?date=${MON()}&start=10:00&end=09:00`)).status).toBe(400);
  });

  it('gives slot availability for every shown day and non-break period', async () => {
    const { coord, college } = await fresh();
    const slots = expectStatus(await coord.get(`${college.w}/classes/${college.classes.k1}/slots?week=${day(3)}&from=${MON()}`), 200);
    expect(slots).toHaveLength(5 * 7);
    expect(slots.some((s: any) => s.start === '13:00')).toBe(false); // lunch
    const at = (date: string, start: string) => slots.find((s: any) => s.date === date && s.start === start);
    // its own Monday slot counts as free when moving that occurrence
    expect(at(MON(), '09:00')).toEqual({
      date: MON(),
      start: '09:00',
      end: '10:00',
      teacherBusy: false,
      batchBusy: false,
      freeRooms: [{ id: college.rooms.r1, name: 'R1', capacity: 60 }],
    });
    expect(at(day(2), '10:00')).toMatchObject({ batchBusy: true, teacherBusy: false });
    expect(at(day(3), '11:00')).toMatchObject({ teacherBusy: true, batchBusy: false });
    // the lab is too small for B1 (50), so it never appears
    expect(slots.every((s: any) => s.freeRooms.every((r: any) => r.name !== 'LAB'))).toBe(true);

    const noFrom = expectStatus(await coord.get(`${college.w}/classes/${college.classes.k1}/slots?week=${MON()}`), 200);
    expect(noFrom.find((s: any) => s.date === MON() && s.start === '09:00')).toMatchObject({ teacherBusy: true, batchBusy: true });
  });

  it('makes two-hour slots for a two-hour class, never across lunch', async () => {
    const { coord, college } = await fresh();
    const lab = expectStatus(await coord.post(`${college.w}/classes`, { courseId: college.courses.c3, batchId: college.batches.b2, roomId: college.rooms.lab, day: 5, start: '14:00', end: '16:00' }), 201);
    const slots = expectStatus(await coord.get(`${college.w}/classes/${lab.id}/slots?week=${MON()}`), 200);
    const starts = [...new Set(slots.map((s: any) => s.start))];
    expect(starts).toEqual(['09:00', '10:00', '11:00', '14:00', '15:00']);
    expect(slots.every((s: any) => Number(s.end.slice(0, 2)) - Number(s.start.slice(0, 2)) === 2)).toBe(true);
  });
});

describe('feeds', () => {
  it('creates one feed URL per member and target', async () => {
    const { coord, college } = await fresh();
    const a = expectStatus(await coord.post(`${college.w}/feeds`, { kind: 'teacher', targetId: college.teachers.t1 }), 200);
    expect(a.url).toMatch(/^http:\/\/localhost\/ics\/f\/[A-Za-z0-9_-]{32}\.ics$/);
    expect(expectStatus(await coord.post(`${college.w}/feeds`, { kind: 'teacher', targetId: college.teachers.t1 }), 200).url).toBe(a.url);
    expect((await coord.post(`${college.w}/feeds`, { kind: 'teacher', targetId: 999999 })).status).toBe(400);
    expect((await coord.post(`${college.w}/feeds`, { kind: 'planet', targetId: 1 })).status).toBe(400);
  });
});
