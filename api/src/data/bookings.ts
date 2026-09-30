// What occupies rooms, teachers and batches on real dates: the clash logic.

import type { Room } from '../contract';
import type { Queryable } from '../db';
import { HM } from './sql';

// Every booking in workspace $1 on the dates $2..$3: regular classes on each date's
// weekday that no change has cancelled or moved away, plus occurrences moved onto
// one of those dates. occurs_on names the occurrence a booking belongs to, so a
// move can ignore its own occurrence without ignoring the class's other meetings.
// Intervals are half-open, so 09:00-10:00 and 10:00-11:00 do not clash.
const BOOKINGS = `
  days AS (
    SELECT d::date AS date FROM generate_series($2::date, $3::date, interval '1 day') d
  ),
  bookings AS (
    SELECT d.date, d.date AS occurs_on, cl.id AS class_id, cl.room_id, cl.teacher_id, cl.batch_id,
           cl.start_time, cl.end_time
      FROM days d
      JOIN classes cl ON cl.workspace_id = $1 AND cl.day_of_week = EXTRACT(ISODOW FROM d.date)
     WHERE NOT EXISTS (SELECT 1 FROM changes ch WHERE ch.class_id = cl.id AND ch.occurs_on = d.date)
    UNION ALL
    SELECT ch.to_date, ch.occurs_on, cl.id, ch.to_room_id, cl.teacher_id, cl.batch_id, ch.to_start, ch.to_end
      FROM changes ch
      JOIN classes cl ON cl.id = ch.class_id
     WHERE ch.workspace_id = $1 AND ch.kind = 'moved' AND ch.to_date BETWEEN $2::date AND $3::date
  )`;

export interface Booking {
  date: string;
  occursOn: string;
  classId: number;
  roomId: number;
  teacherId: number;
  batchId: number;
  start: string;
  end: string;
}

export function bookingsBetween(db: Queryable, workspaceId: number, from: string, to: string): Promise<Booking[]> {
  return db.query<Booking>(
    `WITH ${BOOKINGS}
     SELECT date::text AS date, occurs_on::text AS "occursOn", class_id AS "classId", room_id AS "roomId",
            teacher_id AS "teacherId", batch_id AS "batchId", ${HM('start_time')} AS start, ${HM('end_time')} AS "end"
       FROM bookings ORDER BY date, start_time`,
    [workspaceId, from, to],
  );
}

/** A clash plus the names needed to explain it in a sentence. */
export interface ClashRow {
  type: 'room' | 'teacher' | 'batch';
  classId: number;
  course: string;
  start: string;
  end: string;
  room: string | null;
  teacher: string;
  batch: string;
}

export interface Slot {
  workspaceId: number;
  date: string;
  start: string;
  end: string;
  roomId: number;
  teacherId: number;
  batchId: number;
  /** The occurrence being placed: its own booking never clashes with itself. */
  exclude: { classId: number; occursOn: string } | null;
}

const toClashes = (
  rows: (Omit<ClashRow, 'type'> & { room_clash: boolean; teacher_clash: boolean; batch_clash: boolean })[],
): ClashRow[] =>
  rows.flatMap(({ room_clash, teacher_clash, batch_clash, ...b }) => [
    ...(room_clash ? [{ type: 'room' as const, ...b }] : []),
    ...(teacher_clash ? [{ type: 'teacher' as const, ...b }] : []),
    ...(batch_clash ? [{ type: 'batch' as const, ...b }] : []),
  ]);

/** Room, teacher and batch clashes for one dated slot. */
export async function findClashes(tx: Queryable, s: Slot): Promise<ClashRow[]> {
  const rows = await tx.query<any>(
    `WITH ${BOOKINGS}
     SELECT b.class_id AS "classId", co.code AS course, ${HM('b.start_time')} AS start, ${HM('b.end_time')} AS "end",
            r.name AS room, t.name AS teacher, bt.name AS batch,
            b.room_id = $6 AS room_clash, b.teacher_id = $7 AS teacher_clash, b.batch_id = $8 AS batch_clash
       FROM bookings b
       JOIN classes cl ON cl.id = b.class_id
       JOIN courses co ON co.id = cl.course_id
       JOIN teachers t ON t.id = b.teacher_id
       JOIN batches bt ON bt.id = b.batch_id
       LEFT JOIN rooms r ON r.id = b.room_id
      WHERE b.start_time < $5::time AND b.end_time > $4::time
        AND NOT (b.class_id IS NOT DISTINCT FROM $9::int AND b.occurs_on IS NOT DISTINCT FROM $10::date)
        AND (b.room_id = $6 OR b.teacher_id = $7 OR b.batch_id = $8)
      ORDER BY b.start_time, b.class_id`,
    [
      s.workspaceId,
      s.date,
      s.date,
      s.start,
      s.end,
      s.roomId,
      s.teacherId,
      s.batchId,
      s.exclude?.classId ?? null,
      s.exclude?.occursOn ?? null,
    ],
  );
  return toClashes(rows);
}

/**
 * Clashes for a weekly class (setup): other classes on the same weekday at an
 * overlapping time. Per-date changes do not count; they are exceptions to the week.
 */
export async function findWeeklyClashes(
  tx: Queryable,
  c: { workspaceId: number; day: number; start: string; end: string; roomId: number; teacherId: number; batchId: number; excludeClassId: number | null },
): Promise<ClashRow[]> {
  const rows = await tx.query<any>(
    `SELECT cl.id AS "classId", co.code AS course, ${HM('cl.start_time')} AS start, ${HM('cl.end_time')} AS "end",
            r.name AS room, t.name AS teacher, bt.name AS batch,
            cl.room_id = $5 AS room_clash, cl.teacher_id = $6 AS teacher_clash, cl.batch_id = $7 AS batch_clash
       FROM classes cl
       JOIN courses co ON co.id = cl.course_id
       JOIN teachers t ON t.id = cl.teacher_id
       JOIN batches bt ON bt.id = cl.batch_id
       JOIN rooms r ON r.id = cl.room_id
      WHERE cl.workspace_id = $1 AND cl.day_of_week = $2
        AND cl.start_time < $4::time AND cl.end_time > $3::time
        AND cl.id IS DISTINCT FROM $8::int
        AND (cl.room_id = $5 OR cl.teacher_id = $6 OR cl.batch_id = $7)
      ORDER BY cl.start_time, cl.id`,
    [c.workspaceId, c.day, c.start, c.end, c.roomId, c.teacherId, c.batchId, c.excludeClassId],
  );
  return toClashes(rows);
}

/** Rooms with nothing booked in the slot. `excludeClassId` ignores that class's own bookings. */
export function freeRooms(
  db: Queryable,
  workspaceId: number,
  slot: { date: string; start: string; end: string },
  excludeClassId: number | null,
): Promise<Room[]> {
  return db.query<Room>(
    `WITH ${BOOKINGS}
     SELECT r.id, r.name, r.capacity, r.building, r.kind
       FROM rooms r
      WHERE r.workspace_id = $1
        AND NOT EXISTS (
          SELECT 1 FROM bookings b
           WHERE b.room_id = r.id AND b.start_time < $5::time AND b.end_time > $4::time
             AND b.class_id IS DISTINCT FROM $6::int)
      ORDER BY r.name`,
    [workspaceId, slot.date, slot.date, slot.start, slot.end, excludeClassId],
  );
}
