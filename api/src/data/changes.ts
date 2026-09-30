// Per-occurrence changes: cancel, move, undo, and reading them back.
//
// Every write runs in one transaction that takes advisory locks in a fixed order:
//   class -> room+date -> teacher+date -> batch+date
// then re-checks clashes against the timetable plus committed changes, then writes.
// The fixed order means two writers can never deadlock. The checks run under READ
// COMMITTED after the locks are held, so they see whatever the previous holder
// committed. Row locks (FOR UPDATE) would not do: the row that would conflict is
// the one a concurrent transaction has not inserted yet. The keys use room+date,
// not the exact slot, because overlapping slots with different start times must
// also wait for each other.

import type { Change } from '../contract';
import type { Db, Queryable } from '../db';
import { findClashes, type ClashRow } from './bookings';
import { HM, ISO, LOCK } from './sql';

export interface ClassRef {
  id: number;
  day: number;
  start: string;
  end: string;
  teacherId: number;
  batchId: number;
  roomId: number;
  courseId: number;
}

export async function getClassRef(db: Queryable, workspaceId: number, classId: number): Promise<ClassRef | null> {
  const [row] = await db.query<ClassRef>(
    `SELECT id, day_of_week AS day, ${HM('start_time')} AS start, ${HM('end_time')} AS "end",
            teacher_id AS "teacherId", batch_id AS "batchId", room_id AS "roomId", course_id AS "courseId"
       FROM classes WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, classId],
  );
  return row ?? null;
}

const lock = (tx: Queryable, key: string) => tx.query(LOCK, [key]);

// Change rows as the contract's Change, from alias ch.
export const CHANGE = `json_build_object(
  'id', ch.id, 'classId', ch.class_id, 'kind', ch.kind,
  'course', json_build_object('code', co.code, 'name', co.name, 'color', co.color),
  'batch', json_build_object('id', b.id, 'name', b.name),
  'from', json_build_object('date', ch.occurs_on::text, 'start', ${HM('cl.start_time')}, 'end', ${HM('cl.end_time')}, 'room', r.name),
  'to', CASE WHEN ch.kind = 'moved' THEN json_build_object(
          'date', ch.to_date::text, 'start', ${HM('ch.to_start')}, 'end', ${HM('ch.to_end')}, 'room', tr.name) END,
  'reason', ch.reason, 'by', ch.created_by, 'at', ${ISO('ch.created_at')})`;

export const CHANGE_JOINS = `
  JOIN classes cl ON cl.id = ch.class_id
  JOIN courses co ON co.id = cl.course_id
  JOIN batches b ON b.id = cl.batch_id
  JOIN rooms r ON r.id = cl.room_id
  LEFT JOIN rooms tr ON tr.id = ch.to_room_id`;

async function getChange(db: Queryable, id: number): Promise<Change> {
  const [row] = await db.query<{ c: Change }>(`SELECT ${CHANGE} AS c FROM changes ch ${CHANGE_JOINS} WHERE ch.id = $1`, [id]);
  return row.c;
}

export interface ChangeFilter {
  from: string;
  to: string | null;
  batchId?: number | null;
  teacherId?: number | null;
  roomId?: number | null;
}

/** Changes whose original or new date falls in [from, to], newest first. */
export async function listChanges(db: Queryable, workspaceId: number, f: ChangeFilter, limit = 500): Promise<Change[]> {
  const rows = await db.query<{ c: Change }>(
    `SELECT ${CHANGE} AS c FROM changes ch ${CHANGE_JOINS}
      WHERE ch.workspace_id = $1
        AND ((ch.occurs_on >= $2::date AND ($3::date IS NULL OR ch.occurs_on <= $3::date))
          OR (ch.to_date >= $2::date AND ($3::date IS NULL OR ch.to_date <= $3::date)))
        AND ($4::int IS NULL OR cl.batch_id = $4)
        AND ($5::int IS NULL OR cl.teacher_id = $5)
        AND ($6::int IS NULL OR cl.room_id = $6 OR ch.to_room_id = $6)
      ORDER BY ch.created_at DESC, ch.id DESC
      LIMIT ${limit}`,
    [workspaceId, f.from, f.to, f.batchId ?? null, f.teacherId ?? null, f.roomId ?? null],
  );
  return rows.map((r) => r.c);
}

export type ChangeResult =
  | { status: 'ok'; change: Change }
  | { status: 'not_found' }
  | { status: 'room_not_found' }
  | { status: 'already_changed' }
  | { status: 'clash'; clashes: ClashRow[] };

/** Locks the class and reports whether this occurrence already has a change. */
async function lockOccurrence(tx: Queryable, workspaceId: number, classId: number, occursOn: string) {
  await lock(tx, `class:${classId}`);
  const cls = await getClassRef(tx, workspaceId, classId);
  if (!cls) return { cls: null, changed: false };
  const existing = await tx.query(`SELECT 1 FROM changes WHERE class_id = $1 AND occurs_on = $2`, [classId, occursOn]);
  return { cls, changed: existing.length > 0 };
}

export function cancelOccurrence(
  db: Db,
  c: { workspaceId: number; classId: number; occursOn: string; reason: string | null; by: string },
): Promise<ChangeResult> {
  return db.transaction(async (tx) => {
    const { cls, changed } = await lockOccurrence(tx, c.workspaceId, c.classId, c.occursOn);
    if (!cls) return { status: 'not_found' };
    if (changed) return { status: 'already_changed' };
    const [{ id }] = await tx.query<{ id: number }>(
      `INSERT INTO changes (workspace_id, class_id, occurs_on, kind, reason, created_by)
       VALUES ($1, $2, $3, 'cancelled', $4, $5) RETURNING id`,
      [c.workspaceId, c.classId, c.occursOn, c.reason, c.by],
    );
    return { status: 'ok', change: await getChange(tx, id) };
  });
}

export interface MoveInput {
  workspaceId: number;
  classId: number;
  occursOn: string;
  toDate: string;
  toStart: string;
  toEnd: string;
  roomId: number;
  reason: string | null;
  by: string;
}

export function moveOccurrence(db: Db, m: MoveInput): Promise<ChangeResult> {
  return db.transaction(async (tx) => {
    const { cls, changed } = await lockOccurrence(tx, m.workspaceId, m.classId, m.occursOn);
    if (!cls) return { status: 'not_found' };
    if (changed) return { status: 'already_changed' };
    const room = await tx.query(`SELECT 1 FROM rooms WHERE workspace_id = $1 AND id = $2`, [m.workspaceId, m.roomId]);
    if (!room.length) return { status: 'room_not_found' };

    await lock(tx, `room:${m.roomId}:${m.toDate}`);
    await lock(tx, `teacher:${cls.teacherId}:${m.toDate}`);
    await lock(tx, `batch:${cls.batchId}:${m.toDate}`);

    const clashes = await findClashes(tx, {
      workspaceId: m.workspaceId,
      date: m.toDate,
      start: m.toStart,
      end: m.toEnd,
      roomId: m.roomId,
      teacherId: cls.teacherId,
      batchId: cls.batchId,
      exclude: { classId: m.classId, occursOn: m.occursOn },
    });
    if (clashes.length) return { status: 'clash', clashes };

    const [{ id }] = await tx.query<{ id: number }>(
      `INSERT INTO changes (workspace_id, class_id, occurs_on, kind, to_date, to_start, to_end, to_room_id, reason, created_by)
       VALUES ($1, $2, $3, 'moved', $4, $5, $6, $7, $8, $9) RETURNING id`,
      [m.workspaceId, m.classId, m.occursOn, m.toDate, m.toStart, m.toEnd, m.roomId, m.reason, m.by],
    );
    return { status: 'ok', change: await getChange(tx, id) };
  });
}

export interface ChangeRef {
  id: number;
  classId: number;
  occursOn: string;
  teacherId: number;
}

export async function getChangeRef(db: Queryable, workspaceId: number, id: number): Promise<ChangeRef | null> {
  const [row] = await db.query<ChangeRef>(
    `SELECT ch.id, ch.class_id AS "classId", ch.occurs_on::text AS "occursOn", cl.teacher_id AS "teacherId"
       FROM changes ch JOIN classes cl ON cl.id = ch.class_id
      WHERE ch.workspace_id = $1 AND ch.id = $2`,
    [workspaceId, id],
  );
  return row ?? null;
}

export type UndoResult = { status: 'ok' } | { status: 'not_found' } | { status: 'clash'; clashes: ClashRow[] };

/**
 * Deletes a change, putting the occurrence back in its regular slot. That slot may
 * have been taken since (someone moved a class into the freed room), so it is
 * checked under the same locks as a move into it.
 */
export function undoChange(db: Db, workspaceId: number, changeId: number): Promise<UndoResult> {
  return db.transaction(async (tx) => {
    const ref = await getChangeRef(tx, workspaceId, changeId);
    if (!ref) return { status: 'not_found' };
    await lock(tx, `class:${ref.classId}`);
    const cls = await getClassRef(tx, workspaceId, ref.classId);
    if (!cls) return { status: 'not_found' };
    await lock(tx, `room:${cls.roomId}:${ref.occursOn}`);
    await lock(tx, `teacher:${cls.teacherId}:${ref.occursOn}`);
    await lock(tx, `batch:${cls.batchId}:${ref.occursOn}`);

    const clashes = await findClashes(tx, {
      workspaceId,
      date: ref.occursOn,
      start: cls.start,
      end: cls.end,
      roomId: cls.roomId,
      teacherId: cls.teacherId,
      batchId: cls.batchId,
      exclude: { classId: ref.classId, occursOn: ref.occursOn },
    });
    if (clashes.length) return { status: 'clash', clashes };
    const deleted = await tx.query(`DELETE FROM changes WHERE id = $1 RETURNING 1`, [changeId]);
    return deleted.length ? { status: 'ok' } : { status: 'not_found' };
  });
}
