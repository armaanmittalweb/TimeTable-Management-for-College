// Rooms, teachers, batches, courses and the weekly classes: the setup tables.
// Every statement is scoped by workspace_id, so an id from another workspace
// simply matches nothing.

import type { Batch, ClassRow, Course, Room, Teacher } from '../contract';
import type { Db, Queryable } from '../db';
import { dayName } from '../dates';
import { findWeeklyClashes, type ClashRow } from './bookings';
import { HM, LOCK } from './sql';

export type Kind = 'rooms' | 'teachers' | 'batches' | 'courses' | 'classes';

const ROOM = `id, name, capacity, building, kind`;
const TEACHER = `t.id, t.name, t.short, t.email, EXISTS (SELECT 1 FROM members m WHERE m.teacher_id = t.id) AS "hasAccount"`;
const BATCH = `id, name, size, code`;
const COURSE = `id, code, name, color, teacher_id AS "teacherId"`;
const CLASS = `id, course_id AS "courseId", batch_id AS "batchId", teacher_id AS "teacherId", room_id AS "roomId",
  day_of_week AS day, ${HM('start_time')} AS start, ${HM('end_time')} AS "end"`;

export async function countOf(db: Queryable, kind: Kind, workspaceId: number): Promise<number> {
  const [{ n }] = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${kind} WHERE workspace_id = $1`, [
    workspaceId,
  ]);
  return n;
}

// ---------------------------------------------------------------- lists

export const listRooms = (db: Queryable, ws: number) =>
  db.query<Room>(`SELECT ${ROOM} FROM rooms WHERE workspace_id = $1 ORDER BY name`, [ws]);
export const listTeachers = (db: Queryable, ws: number) =>
  db.query<Teacher>(`SELECT ${TEACHER} FROM teachers t WHERE t.workspace_id = $1 ORDER BY t.name`, [ws]);
export const listBatches = (db: Queryable, ws: number) =>
  db.query<Batch>(`SELECT ${BATCH} FROM batches WHERE workspace_id = $1 ORDER BY name`, [ws]);
export const listCourses = (db: Queryable, ws: number) =>
  db.query<Course>(`SELECT ${COURSE} FROM courses WHERE workspace_id = $1 ORDER BY code`, [ws]);
export const listClasses = (db: Queryable, ws: number) =>
  db.query<ClassRow>(`SELECT ${CLASS} FROM classes WHERE workspace_id = $1 ORDER BY day_of_week, start_time, id`, [ws]);

async function one<T>(rows: Promise<T[]>): Promise<T | null> {
  return (await rows)[0] ?? null;
}

export const getRoom = (db: Queryable, ws: number, id: number) =>
  one(db.query<Room>(`SELECT ${ROOM} FROM rooms WHERE workspace_id = $1 AND id = $2`, [ws, id]));
export const getTeacher = (db: Queryable, ws: number, id: number) =>
  one(db.query<Teacher>(`SELECT ${TEACHER} FROM teachers t WHERE t.workspace_id = $1 AND t.id = $2`, [ws, id]));
export const getBatch = (db: Queryable, ws: number, id: number) =>
  one(db.query<Batch>(`SELECT ${BATCH} FROM batches WHERE workspace_id = $1 AND id = $2`, [ws, id]));
export const getCourse = (db: Queryable, ws: number, id: number) =>
  one(db.query<Course>(`SELECT ${COURSE} FROM courses WHERE workspace_id = $1 AND id = $2`, [ws, id]));
export const getClassRow = (db: Queryable, ws: number, id: number) =>
  one(db.query<ClassRow>(`SELECT ${CLASS} FROM classes WHERE workspace_id = $1 AND id = $2`, [ws, id]));

// ---------------------------------------------------------------- writes
// Each returns the updated row, or null when the id is not in this workspace.

export const insertRoom = (db: Queryable, ws: number, r: Omit<Room, 'id'>) =>
  one(
    db.query<Room>(
      `INSERT INTO rooms (workspace_id, name, capacity, building, kind) VALUES ($1, $2, $3, $4, $5) RETURNING ${ROOM}`,
      [ws, r.name, r.capacity, r.building, r.kind],
    ),
  ) as Promise<Room>;

export const updateRoom = (db: Queryable, ws: number, id: number, r: Omit<Room, 'id'>) =>
  one(
    db.query<Room>(
      `UPDATE rooms SET name = $3, capacity = $4, building = $5, kind = $6 WHERE workspace_id = $1 AND id = $2 RETURNING ${ROOM}`,
      [ws, id, r.name, r.capacity, r.building, r.kind],
    ),
  );

export async function insertTeacher(db: Queryable, ws: number, t: Omit<Teacher, 'id' | 'hasAccount'>): Promise<Teacher> {
  const [row] = await db.query<Teacher>(
    `INSERT INTO teachers (workspace_id, name, short, email) VALUES ($1, $2, $3, $4)
     RETURNING id, name, short, email, false AS "hasAccount"`,
    [ws, t.name, t.short, t.email],
  );
  return row;
}

export async function updateTeacher(db: Queryable, ws: number, id: number, t: Omit<Teacher, 'id' | 'hasAccount'>) {
  const rows = await db.query(`UPDATE teachers SET name = $3, short = $4, email = $5 WHERE workspace_id = $1 AND id = $2 RETURNING 1`, [
    ws,
    id,
    t.name,
    t.short,
    t.email,
  ]);
  return rows.length ? getTeacher(db, ws, id) : null;
}

export const insertBatch = (db: Queryable, ws: number, b: Omit<Batch, 'id'>) =>
  one(
    db.query<Batch>(`INSERT INTO batches (workspace_id, name, size, code) VALUES ($1, $2, $3, $4) RETURNING ${BATCH}`, [
      ws,
      b.name,
      b.size,
      b.code,
    ]),
  ) as Promise<Batch>;

export const updateBatch = (db: Queryable, ws: number, id: number, b: Pick<Batch, 'name' | 'size'>) =>
  one(
    db.query<Batch>(`UPDATE batches SET name = $3, size = $4 WHERE workspace_id = $1 AND id = $2 RETURNING ${BATCH}`, [
      ws,
      id,
      b.name,
      b.size,
    ]),
  );

export const setBatchCode = (db: Queryable, ws: number, id: number, code: string) =>
  one(db.query<Batch>(`UPDATE batches SET code = $3 WHERE workspace_id = $1 AND id = $2 RETURNING ${BATCH}`, [ws, id, code]));

export const insertCourse = (db: Queryable, ws: number, c: Omit<Course, 'id'>) =>
  one(
    db.query<Course>(
      `INSERT INTO courses (workspace_id, code, name, color, teacher_id) VALUES ($1, $2, $3, $4, $5) RETURNING ${COURSE}`,
      [ws, c.code, c.name, c.color, c.teacherId],
    ),
  ) as Promise<Course>;

export const updateCourse = (db: Queryable, ws: number, id: number, c: Omit<Course, 'id'>) =>
  one(
    db.query<Course>(
      `UPDATE courses SET code = $3, name = $4, color = $5, teacher_id = $6 WHERE workspace_id = $1 AND id = $2 RETURNING ${COURSE}`,
      [ws, id, c.code, c.name, c.color, c.teacherId],
    ),
  );

/** True when every id exists in this workspace (a class must not borrow another tenant's room). */
export async function refsExist(
  db: Queryable,
  ws: number,
  r: { courseId: number; batchId: number; teacherId: number; roomId: number },
): Promise<string | null> {
  const [row] = await db.query<Record<string, boolean>>(
    `SELECT EXISTS (SELECT 1 FROM courses WHERE workspace_id = $1 AND id = $2) AS course,
            EXISTS (SELECT 1 FROM batches WHERE workspace_id = $1 AND id = $3) AS batch,
            EXISTS (SELECT 1 FROM teachers WHERE workspace_id = $1 AND id = $4) AS teacher,
            EXISTS (SELECT 1 FROM rooms WHERE workspace_id = $1 AND id = $5) AS room`,
    [ws, r.courseId, r.batchId, r.teacherId, r.roomId],
  );
  return ['course', 'batch', 'teacher', 'room'].find((k) => !row[k]) ?? null;
}

export type ClassWrite = { status: 'ok'; row: ClassRow } | { status: 'not_found' } | { status: 'clash'; clashes: ClashRow[] };

/**
 * Creates (id null) or replaces a weekly class after a clash check. Class writes in
 * one workspace are serialised by an advisory lock, so two coordinators cannot add
 * clashing classes at the same moment. When an edit moves the class to another day
 * or time, its upcoming per-date changes no longer name real occurrences and are dropped.
 */
export function writeClass(
  db: Db,
  ws: number,
  id: number | null,
  c: Omit<ClassRow, 'id'>,
  today: string,
): Promise<ClassWrite> {
  return db.transaction(async (tx) => {
    await tx.query(LOCK, [`timetable:${ws}`]);
    const before = id === null ? null : await getClassRow(tx, ws, id);
    if (id !== null && !before) return { status: 'not_found' };
    const clashes = await findWeeklyClashes(tx, { workspaceId: ws, ...c, excludeClassId: id });
    if (clashes.length) return { status: 'clash', clashes };
    const params = [ws, c.courseId, c.batchId, c.teacherId, c.roomId, c.day, c.start, c.end];
    if (id === null) {
      const [row] = await tx.query<ClassRow>(
        `INSERT INTO classes (workspace_id, course_id, batch_id, teacher_id, room_id, day_of_week, start_time, end_time)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING ${CLASS}`,
        params,
      );
      return { status: 'ok', row };
    }
    if (before && (before.day !== c.day || before.start !== c.start || before.end !== c.end)) {
      await tx.query(`DELETE FROM changes WHERE class_id = $1 AND occurs_on >= $2::date`, [id, today]);
    }
    const [row] = await tx.query<ClassRow>(
      `UPDATE classes SET course_id = $2, batch_id = $3, teacher_id = $4, room_id = $5, day_of_week = $6,
              start_time = $7, end_time = $8
        WHERE workspace_id = $1 AND id = $9 RETURNING ${CLASS}`,
      [...params, id],
    );
    return { status: 'ok', row };
  });
}

// ---------------------------------------------------------------- deletes

const USERS: Record<Exclude<Kind, 'classes'>, string> = {
  rooms: 'cl.room_id = $2 OR EXISTS (SELECT 1 FROM changes ch WHERE ch.class_id = cl.id AND ch.to_room_id = $2)',
  teachers: 'cl.teacher_id = $2',
  batches: 'cl.batch_id = $2',
  courses: 'cl.course_id = $2',
};

/** Up to three classes that use the thing, and how many there are in all. */
export async function usage(db: Queryable, kind: Exclude<Kind, 'classes'>, ws: number, id: number) {
  const rows = await db.query<{ course: string; batch: string; day: number; start: string; total: number }>(
    `SELECT co.code AS course, b.name AS batch, cl.day_of_week AS day, ${HM('cl.start_time')} AS start,
            count(*) OVER ()::int AS total
       FROM classes cl JOIN courses co ON co.id = cl.course_id JOIN batches b ON b.id = cl.batch_id
      WHERE cl.workspace_id = $1 AND (${USERS[kind]})
      ORDER BY cl.day_of_week, cl.start_time LIMIT 3`,
    [ws, id],
  );
  return {
    total: rows[0]?.total ?? 0,
    examples: rows.map((r) => `${r.course} for ${r.batch} on ${dayName(r.day)} ${r.start}`),
  };
}

/** Deletes a row of `kind` in this workspace; false when there was none. */
export async function deleteRow(db: Queryable, kind: Kind, ws: number, id: number) {
  const rows = await db.query(`DELETE FROM ${kind} WHERE workspace_id = $1 AND id = $2 RETURNING 1`, [ws, id]);
  return rows.length > 0;
}
