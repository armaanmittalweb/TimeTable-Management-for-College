import { beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../src/db';
import { buildCollege, expectStatus, freshPglite, harness, joinAsTeacher, pgliteDb, type Harness } from './helpers';

let db: Db;
let h: Harness;

beforeAll(async () => {
  db = pgliteDb(await freshPglite());
  h = harness(db);
});

describe('workspaces', () => {
  it('creates a workspace with the caller as coordinator and default periods', async () => {
    const coord = await h.signup();
    const res = await coord.post('/api/workspaces', { name: 'Computer Science', institution: 'Thapar Institute' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: expect.any(Number),
      slug: expect.stringMatching(/^computer-science/),
      name: 'Computer Science',
      institution: 'Thapar Institute',
      timezone: 'Asia/Kolkata',
      published: false,
      isDemo: false,
    });
    const full = expectStatus(await coord.get(`/api/w/${res.body.slug}`), 200);
    expect(full.role).toBe('coordinator');
    expect(full.teacherId).toBeNull();
    expect(full.batchId).toBeNull();
    expect(full.workspace.days).toEqual([1, 2, 3, 4, 5]);
    expect(full.periods).toHaveLength(8);
    expect(full.periods[0]).toEqual({ idx: 1, start: '09:00', end: '10:00', label: null, isBreak: false });
    expect(full.periods.find((p: any) => p.isBreak)).toEqual({ idx: 5, start: '13:00', end: '14:00', label: 'Lunch', isBreak: true });
    expect(full.periods.at(-1).end).toBe('17:00');
    const me = expectStatus(await coord.get('/api/auth/me'), 200);
    expect(me.memberships).toEqual([{ workspace: res.body, role: 'coordinator', teacherId: null }]);
  });

  it('gives a second workspace with the same name its own slug', async () => {
    const a = await h.signup();
    const one = expectStatus(await a.post('/api/workspaces', { name: 'Physics', institution: 'X' }), 201);
    const two = expectStatus(await a.post('/api/workspaces', { name: 'Physics', institution: 'X' }), 201);
    expect(two.slug).not.toBe(one.slug);
    expect(two.slug).toMatch(/^physics-[a-z0-9]{4}$/);
  });

  it('validates the timezone and allows at most five workspaces per user', async () => {
    const a = await h.signup();
    expect((await a.post('/api/workspaces', { name: 'X', institution: 'Y', timezone: 'Mars/Olympus' })).status).toBe(400);
    for (let i = 0; i < 5; i++) expectStatus(await a.post('/api/workspaces', { name: `W${i}`, institution: 'Y', timezone: 'Europe/London' }), 201);
    const sixth = await a.post('/api/workspaces', { name: 'W6', institution: 'Y' });
    expect(sixth.status).toBe(409);
    expect(sixth.body.code).toBe('conflict');
  });

  it('needs a signed-in account to create a workspace', async () => {
    expect((await h.browser().post('/api/workspaces', { name: 'X', institution: 'Y' })).status).toBe(401);
  });

  it('lets the coordinator edit settings, publish and unpublish', async () => {
    const coord = await h.signup();
    const college = await buildCollege(coord);
    const patched = expectStatus(await coord.patch(college.w, { name: 'CSE', days: [6, 1, 2, 3, 4, 5, 5], timezone: 'Europe/London' }), 200);
    expect(patched).toMatchObject({ name: 'CSE', timezone: 'Europe/London', published: true });
    expect(expectStatus(await coord.get(college.w), 200).workspace.days).toEqual([1, 2, 3, 4, 5, 6]);
    expect((await coord.patch(college.w, { days: [] })).status).toBe(400);
    expect((await coord.patch(college.w, { days: [8] })).status).toBe(400);
    expect(expectStatus(await coord.post(`${college.w}/unpublish`), 200).published).toBe(false);
    expect(expectStatus(await coord.post(`${college.w}/publish`), 200).published).toBe(true);
  });

  it('replaces periods, ordered by start, refusing overlaps', async () => {
    const coord = await h.signup();
    const college = await buildCollege(coord);
    const periods = [
      { start: '10:00', end: '11:00' },
      { start: '08:30', end: '09:30', label: 'Zero hour' },
      { start: '12:00', end: '12:45', label: 'Lunch', isBreak: true },
    ];
    const res = expectStatus(await coord.put(`${college.w}/periods`, periods), 200);
    expect(res).toEqual([
      { idx: 1, start: '08:30', end: '09:30', label: 'Zero hour', isBreak: false },
      { idx: 2, start: '10:00', end: '11:00', label: null, isBreak: false },
      { idx: 3, start: '12:00', end: '12:45', label: 'Lunch', isBreak: true },
    ]);
    expect(expectStatus(await coord.get(college.w), 200).periods).toEqual(res);
    expect((await coord.put(`${college.w}/periods`, [{ start: '09:00', end: '10:00' }, { start: '09:30', end: '10:30' }])).status).toBe(400);
    expect((await coord.put(`${college.w}/periods`, [{ start: '10:00', end: '09:00' }])).status).toBe(400);
    expect((await coord.put(`${college.w}/periods`, [])).status).toBe(400);
  });
});

describe('members and invites', () => {
  it('joins a teacher by invite, linked to their teacher row', async () => {
    const coord = await h.signup();
    const college = await buildCollege(coord);
    const invite = expectStatus(await coord.post(`${college.w}/invites`, { role: 'teacher', teacherId: college.teachers.t1 }), 201);
    expect(invite.code).toMatch(/^INV-[A-HJKMNP-Z2-9]{10}$/);
    expect(new Date(invite.expiresAt).getTime() - Date.now()).toBeGreaterThan(6.9 * 86_400_000);

    // an invite needs an account
    expect((await h.browser().post('/api/join', { code: invite.code })).status).toBe(401);

    const teacher = await h.signup('Tara One');
    const joined = expectStatus(await teacher.post('/api/join', { code: invite.code.toLowerCase() }), 200);
    expect(joined.workspace.slug).toBe(college.slug);
    const full = expectStatus(await teacher.get(college.w), 200);
    expect(full).toMatchObject({ role: 'teacher', teacherId: college.teachers.t1 });
    expect(full.teachers.find((t: any) => t.id === college.teachers.t1).hasAccount).toBe(true);

    // single use
    const other = await h.signup();
    expect((await other.post('/api/join', { code: invite.code })).status).toBe(404);
    // a second invite for the same teacher is refused
    expect((await coord.post(`${college.w}/invites`, { role: 'teacher', teacherId: college.teachers.t1 })).status).toBe(409);
  });

  it('requires a teacher for a teacher invite and refuses an expired one', async () => {
    const coord = await h.signup();
    const college = await buildCollege(coord);
    expect((await coord.post(`${college.w}/invites`, { role: 'teacher' })).status).toBe(400);
    expect((await coord.post(`${college.w}/invites`, { role: 'teacher', teacherId: 999999 })).status).toBe(400);
    const inv = expectStatus(await coord.post(`${college.w}/invites`, { role: 'coordinator' }), 201);
    await db.query(`UPDATE invites SET expires_at = now() - interval '1 minute' WHERE code = $1`, [inv.code]);
    expect((await (await h.signup()).post('/api/join', { code: inv.code })).status).toBe(404);
  });

  it('refuses to join a workspace twice', async () => {
    const coord = await h.signup();
    const college = await buildCollege(coord);
    const inv = expectStatus(await coord.post(`${college.w}/invites`, { role: 'coordinator' }), 201);
    expect((await coord.post('/api/join', { code: inv.code })).status).toBe(409);
  });

  it('lists members, changes roles, removes members, and keeps one coordinator', async () => {
    const coord = await h.signup('Chief');
    const college = await buildCollege(coord);
    const teacher = await joinAsTeacher(h, coord, college, college.teachers.t2);
    const members = expectStatus(await coord.get(`${college.w}/members`), 200);
    expect(members).toHaveLength(2);
    const me = members.find((m: any) => m.role === 'coordinator');
    const them = members.find((m: any) => m.role === 'teacher');
    expect(them).toEqual({ userId: expect.any(Number), name: 'A Teacher', email: teacher.email, role: 'teacher', teacherId: college.teachers.t2 });

    // teachers cannot manage members
    expect((await teacher.get(`${college.w}/members`)).status).toBe(403);
    expect((await teacher.patch(`${college.w}/members/${me.userId}`, { role: 'teacher' })).status).toBe(403);

    // the last coordinator cannot demote or remove themselves
    expect((await coord.patch(`${college.w}/members/${me.userId}`, { role: 'teacher' })).status).toBe(409);
    expect((await coord.del(`${college.w}/members/${me.userId}`)).status).toBe(409);

    expect(expectStatus(await coord.patch(`${college.w}/members/${them.userId}`, { role: 'coordinator' }), 200).role).toBe('coordinator');
    expect((await coord.patch(`${college.w}/members/${me.userId}`, { role: 'teacher' })).status).toBe(200);
    expect((await teacher.del(`${college.w}/members/${me.userId}`)).status).toBe(204);
    // removed: the workspace is gone for them
    expect((await coord.get(college.w)).status).toBe(404);
    expect((await teacher.del(`${college.w}/members/99999`)).status).toBe(404);
  });

  it('lets teachers read but not write setup', async () => {
    const coord = await h.signup();
    const college = await buildCollege(coord);
    const teacher = await joinAsTeacher(h, coord, college, college.teachers.t1);
    expect((await teacher.get(`${college.w}/rooms`)).status).toBe(200);
    expect((await teacher.post(`${college.w}/rooms`, { name: 'X', capacity: 10 })).status).toBe(403);
    expect((await teacher.patch(college.w, { name: 'Mine now' })).status).toBe(403);
    expect((await teacher.post(`${college.w}/publish`)).status).toBe(403);
    expect((await teacher.put(`${college.w}/periods`, [{ start: '09:00', end: '10:00' }])).status).toBe(403);
    expect((await teacher.post(`${college.w}/invites`, { role: 'coordinator' })).status).toBe(403);
  });
});

describe('setup', () => {
  it('creates, edits and lists rooms, teachers, batches and courses', async () => {
    const coord = await h.signup();
    const college = await buildCollege(coord);
    const w = college.w;
    const room = expectStatus(await coord.post(`${w}/rooms`, { name: 'CR-201', capacity: 60, building: 'Main' }), 201);
    expect(room).toEqual({ id: expect.any(Number), name: 'CR-201', capacity: 60, building: 'Main', kind: 'lecture' });
    expect(expectStatus(await coord.patch(`${w}/rooms/${room.id}`, { capacity: 72, kind: 'lab' }), 200)).toEqual({ ...room, capacity: 72, kind: 'lab' });
    expect((await coord.post(`${w}/rooms`, { name: 'CR-201', capacity: 10 })).status).toBe(409);
    expect((await coord.post(`${w}/rooms`, { name: 'CR-299', capacity: 0 })).status).toBe(400);
    expect((await coord.post(`${w}/rooms`, { name: 'CR-299', capacity: 10, kind: 'garage' })).status).toBe(400);

    const teacher = expectStatus(await coord.post(`${w}/teachers`, { name: 'Dr. Nisha Rao', email: 'NR@Example.edu' }), 201);
    expect(teacher).toEqual({ id: expect.any(Number), name: 'Dr. Nisha Rao', short: 'NR', email: 'nr@example.edu', hasAccount: false });

    const batch = expectStatus(await coord.post(`${w}/batches`, { name: 'CSE-2A', size: 58 }), 201);
    expect(batch.code).toMatch(/^CSE2A-[A-HJKMNP-Z2-9]{4}$/);
    expect((await coord.post(`${w}/batches`, { name: 'CSE-2A' })).status).toBe(409);
    const rotated = expectStatus(await coord.post(`${w}/batches/${batch.id}/code`), 200);
    expect(rotated.code).not.toBe(batch.code);
    expect(rotated.code).toMatch(/^CSE2A-/);
    expect((await h.browser().get(`/api/public/${batch.code}`)).status).toBe(404); // old code is dead

    const course = expectStatus(await coord.post(`${w}/courses`, { code: 'CS201', name: 'Data Structures', teacherId: teacher.id }), 201);
    expect(course).toEqual({ id: expect.any(Number), code: 'CS201', name: 'Data Structures', color: expect.any(Number), teacherId: teacher.id });
    expect((await coord.post(`${w}/courses`, { code: 'CS202', name: 'X', color: 9 })).status).toBe(400);
    expect((await coord.post(`${w}/courses`, { code: 'CS202', name: 'X', teacherId: 999999 })).status).toBe(400);
    expect(expectStatus(await coord.patch(`${w}/courses/${course.id}`, { teacherId: null }), 200).teacherId).toBeNull();

    const full = expectStatus(await coord.get(w), 200);
    expect(full.rooms.map((r: any) => r.name)).toContain('CR-201');
    expect(full.batches.map((b: any) => b.code)).toContain(rotated.code);
    expect(full.classes).toHaveLength(4);
    expect(full.classes[0]).toEqual({
      id: college.classes.k1,
      courseId: college.courses.c1,
      batchId: college.batches.b1,
      teacherId: college.teachers.t1,
      roomId: college.rooms.r1,
      day: 1,
      start: '09:00',
      end: '10:00',
    });
  });

  it('refuses to delete what classes use, naming the classes', async () => {
    const coord = await h.signup();
    const college = await buildCollege(coord);
    const res = await coord.del(`${college.w}/rooms/${college.rooms.r1}`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('conflict');
    expect(res.body.error).toBe('R1 is used by 2 classes (C1 for B1 on Mon 09:00; C1 for B2 on Wed 11:00). Move or delete those first.');
    expect((await coord.del(`${college.w}/teachers/${college.teachers.t1}`)).status).toBe(409);
    expect((await coord.del(`${college.w}/batches/${college.batches.b1}`)).status).toBe(409);
    expect((await coord.del(`${college.w}/courses/${college.courses.c1}`)).status).toBe(409);
    expect((await coord.del(`${college.w}/rooms/${college.rooms.lab}`)).status).toBe(204);
    expect((await coord.del(`${college.w}/rooms/${college.rooms.lab}`)).status).toBe(404);
    expect((await coord.del(`${college.w}/classes/${college.classes.k1}`)).status).toBe(204);
    expect((await coord.del(`${college.w}/classes/${college.classes.k4}`)).status).toBe(204);
    expect((await coord.del(`${college.w}/rooms/${college.rooms.r1}`)).status).toBe(204);
  });

  it('checks a new or edited class for room, teacher and batch clashes', async () => {
    const coord = await h.signup();
    const college = await buildCollege(coord);
    const { w, courses, batches, rooms } = college;
    // same room as k1 (R1, Mon 09:00), different teacher and batch
    const room = await coord.post(`${w}/classes`, { courseId: courses.c3, batchId: batches.b2, roomId: rooms.r1, day: 1, start: '09:30', end: '10:30' });
    expect(room.status).toBe(409);
    expect(room.body.code).toBe('clash');
    expect(room.body.clashes).toEqual(
      expect.arrayContaining([
        { type: 'room', classId: college.classes.k1, course: 'C1', start: '09:00', end: '10:00', room: 'R1' },
        { type: 'batch', classId: college.classes.k2, course: 'C2', start: '09:00', end: '10:00', room: 'R2' },
      ]),
    );
    expect(room.body.error).toContain('R1 is booked at 09:00 by C1.');
    // same teacher as k1 (T1 teaches C1) in a free room
    const teacher = await coord.post(`${w}/classes`, { courseId: courses.c1, batchId: batches.b2, roomId: rooms.lab, day: 1, start: '09:00', end: '10:00' });
    expect(teacher.body.clashes.map((c: any) => c.type)).toEqual(['teacher', 'batch']);
    // back to back is fine (half-open)
    expect((await coord.post(`${w}/classes`, { courseId: courses.c1, batchId: batches.b1, roomId: rooms.r1, day: 1, start: '10:00', end: '11:00' })).status).toBe(201);
    // editing k1 into itself is not a clash with itself
    expect((await coord.patch(`${w}/classes/${college.classes.k1}`, { start: '08:30', end: '09:30' })).status).toBe(200);
    // invalid times and foreign ids
    expect((await coord.post(`${w}/classes`, { courseId: courses.c1, batchId: batches.b1, roomId: rooms.r1, day: 4, start: '11:00', end: '10:00' })).status).toBe(400);
    expect((await coord.post(`${w}/classes`, { courseId: courses.c1, batchId: batches.b1, roomId: 999999, day: 4, start: '11:00', end: '12:00' })).status).toBe(400);
  });

  it("uses the course's usual teacher when a class does not name one", async () => {
    const coord = await h.signup();
    const college = await buildCollege(coord);
    const row = expectStatus(await coord.post(`${college.w}/classes`, { courseId: college.courses.c2, batchId: college.batches.b1, roomId: college.rooms.lab, day: 5, start: '09:00', end: '11:00' }), 201);
    expect(row.teacherId).toBe(college.teachers.t2);
  });

  it('enforces per-workspace limits', async () => {
    const coord = await h.signup();
    const college = await buildCollege(coord);
    const ws = (await db.query<{ id: number }>(`SELECT id FROM workspaces WHERE slug = $1`, [college.slug]))[0].id;
    await db.query(
      `INSERT INTO rooms (workspace_id, name, capacity) SELECT $1, 'bulk-' || g, 10 FROM generate_series(1, 197) g`,
      [ws],
    );
    const res = await coord.post(`${college.w}/rooms`, { name: 'one too many', capacity: 10 });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('A workspace can have at most 200 rooms.');
  });

  it('serves CSV templates', async () => {
    const coord = await h.signup();
    const college = await buildCollege(coord);
    const res = await coord.get(`${college.w}/import/template/classes`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    const lines = res.text.trim().split('\r\n');
    expect(lines[0]).toBe('day,start,end,course,batch,room,teacher');
    expect(lines).toHaveLength(3);
    expect((await coord.get(`${college.w}/import/template/nonsense`)).status).toBe(404);
  });
});
