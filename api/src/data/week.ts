// The rows a week (or any date range) is assembled from; see src/week.ts.

import type { Period } from '../contract';
import type { Queryable } from '../db';
import type { ChangeInfo, ClassInfo } from '../week';
import { CHANGE, CHANGE_JOINS } from './changes';
import { HM } from './sql';

export interface Scope {
  batchId?: number | null;
  teacherId?: number | null;
  roomId?: number | null;
}

export async function getPeriods(db: Queryable, workspaceId: number): Promise<Period[]> {
  return db.query<Period>(
    `SELECT idx, ${HM('start_time')} AS start, ${HM('end_time')} AS "end", label, is_break AS "isBreak"
       FROM periods WHERE workspace_id = $1 ORDER BY idx`,
    [workspaceId],
  );
}

/**
 * Classes in scope for [from, to], and the changes touching that range. With a room
 * filter, classes moved into the room from elsewhere are included too, so their
 * moved-here copies can be shown.
 */
export async function weekRows(
  db: Queryable,
  workspaceId: number,
  from: string,
  to: string,
  scope: Scope,
): Promise<{ classes: ClassInfo[]; changes: ChangeInfo[] }> {
  const params = [workspaceId, scope.batchId ?? null, scope.teacherId ?? null, scope.roomId ?? null, from, to];
  const [classes, changes] = await Promise.all([
    db.query<ClassInfo>(
      `SELECT cl.id, cl.day_of_week AS day, ${HM('cl.start_time')} AS start, ${HM('cl.end_time')} AS "end",
              json_build_object('id', co.id, 'code', co.code, 'name', co.name, 'color', co.color) AS course,
              json_build_object('id', t.id, 'name', t.name, 'short', t.short) AS teacher,
              json_build_object('id', r.id, 'name', r.name) AS room,
              json_build_object('id', b.id, 'name', b.name) AS batch
         FROM classes cl
         JOIN courses co ON co.id = cl.course_id
         JOIN teachers t ON t.id = cl.teacher_id
         JOIN rooms r ON r.id = cl.room_id
         JOIN batches b ON b.id = cl.batch_id
        WHERE cl.workspace_id = $1
          AND ($2::int IS NULL OR cl.batch_id = $2)
          AND ($3::int IS NULL OR cl.teacher_id = $3)
          AND ($4::int IS NULL OR cl.room_id = $4 OR EXISTS (
                SELECT 1 FROM changes ch
                 WHERE ch.class_id = cl.id AND ch.kind = 'moved' AND ch.to_room_id = $4
                   AND ch.to_date BETWEEN $5::date AND $6::date))
        ORDER BY cl.day_of_week, cl.start_time, cl.id`,
      params,
    ),
    db.query<ChangeInfo>(
      `SELECT ${CHANGE} AS change, ch.occurs_on::text AS "occursOn", ch.to_room_id AS "toRoomId"
         FROM changes ch ${CHANGE_JOINS}
        WHERE ch.workspace_id = $1
          AND ($2::int IS NULL OR cl.batch_id = $2)
          AND ($3::int IS NULL OR cl.teacher_id = $3)
          AND ($4::int IS NULL OR cl.room_id = $4 OR ch.to_room_id = $4)
          AND (ch.occurs_on BETWEEN $5::date AND $6::date OR ch.to_date BETWEEN $5::date AND $6::date)`,
      params,
    ),
  ]);
  return { classes, changes };
}
