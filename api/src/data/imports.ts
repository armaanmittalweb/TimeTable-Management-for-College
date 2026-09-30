// Bulk writes for CSV import: one statement per table via unnest(), so a 3,000-row
// timetable is a handful of round trips, not thousands.

import type { Queryable } from '../db';
import { HM } from './sql';

export interface Column {
  name: string;
  type: 'text' | 'int' | 'smallint' | 'time';
}

/** Table and column names are constants from the importer, never user input. */
export async function bulkInsert(tx: Queryable, table: string, workspaceId: number, cols: Column[], rows: unknown[][]) {
  if (!rows.length) return;
  await tx.query(
    `INSERT INTO ${table} (workspace_id, ${cols.map((c) => c.name).join(', ')})
     SELECT $1, * FROM unnest(${cols.map((c, i) => `$${i + 2}::${c.type}[]`).join(', ')})`,
    [workspaceId, ...cols.map((_, i) => rows.map((r) => r[i]))],
  );
}

/** Updates rows by id (first value of each row); workspace-scoped like everything else. */
export async function bulkUpdate(tx: Queryable, table: string, workspaceId: number, cols: Column[], rows: unknown[][]) {
  if (!rows.length) return;
  const all: Column[] = [{ name: 'id', type: 'int' }, ...cols];
  await tx.query(
    `UPDATE ${table} t SET ${cols.map((c) => `${c.name} = u.${c.name}`).join(', ')}
       FROM unnest(${all.map((c, i) => `$${i + 2}::${c.type}[]`).join(', ')}) AS u(${all.map((c) => c.name).join(', ')})
      WHERE t.id = u.id AND t.workspace_id = $1`,
    [workspaceId, ...all.map((_, i) => rows.map((r) => r[i]))],
  );
}

export interface Named {
  id: number;
  name: string;
  short?: string;
  code?: string;
  capacity?: number;
  building?: string | null;
  kind?: string;
  size?: number | null;
  email?: string | null;
  color?: number;
  teacherId?: number | null;
}

export const existingRows = {
  rooms: (db: Queryable, ws: number) =>
    db.query<Named>(`SELECT id, name, capacity, building, kind FROM rooms WHERE workspace_id = $1`, [ws]),
  teachers: (db: Queryable, ws: number) =>
    db.query<Named>(`SELECT id, name, short, email FROM teachers WHERE workspace_id = $1`, [ws]),
  batches: (db: Queryable, ws: number) =>
    db.query<Named>(`SELECT id, name, size, code FROM batches WHERE workspace_id = $1`, [ws]),
  courses: (db: Queryable, ws: number) =>
    db.query<Named>(`SELECT id, code, name, color, teacher_id AS "teacherId" FROM courses WHERE workspace_id = $1`, [ws]),
};

export interface WeeklyClass {
  id: number;
  courseId: number;
  batchId: number;
  teacherId: number;
  roomId: number;
  day: number;
  start: string;
  end: string;
  course: string;
}

export const existingClasses = (db: Queryable, ws: number) =>
  db.query<WeeklyClass>(
    `SELECT cl.id, cl.course_id AS "courseId", cl.batch_id AS "batchId", cl.teacher_id AS "teacherId",
            cl.room_id AS "roomId", cl.day_of_week AS day, ${HM('cl.start_time')} AS start, ${HM('cl.end_time')} AS "end",
            co.code AS course
       FROM classes cl JOIN courses co ON co.id = cl.course_id WHERE cl.workspace_id = $1`,
    [ws],
  );
