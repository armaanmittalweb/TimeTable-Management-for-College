// The demo college: db/demo.json, copied into a private, published workspace per
// visitor. The copy is one transaction; references in the JSON are by name, and the
// INSERT ... SELECT joins below turn names into this copy's ids.

import demo from '../../db/demo.json';
import type { Db, Queryable } from '../db';
import { addDays } from '../dates';
import { batchCode, randomCode } from '../tokens';
import { replacePeriods, DEFAULT_PERIODS } from './workspaces';

export type DemoCollege = typeof demo;
export const DEMO: DemoCollege = demo;

export const DEMO_HOURS = 24;
export const DEMO_PER_IP = 5; // per 10 minutes

/** Class rows as [day, start, end, course, batch, room]. */
type ClassTuple = [number, string, string, string, string, string];
export const demoClasses = () => DEMO.classes as ClassTuple[];

/** Demo copies this client made in the last ten minutes (the rate limit). */
export async function recentDemoCopies(db: Queryable, ipHash: string): Promise<number> {
  const [{ n }] = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM workspaces
      WHERE is_demo AND demo_ip_hash = $1 AND created_at > now() - interval '10 minutes'`,
    [ipHash],
  );
  return n;
}

export async function deleteDemoWorkspace(db: Queryable, workspaceId: number) {
  await db.query(`DELETE FROM workspaces WHERE id = $1 AND is_demo`, [workspaceId]);
}

/**
 * Copies the demo college and returns the new workspace. `monday` is this week's
 * Monday in the demo timezone: the three sample changes land in that week.
 */
export function cloneDemo(db: Db, c: { monday: string; ipHash: string }) {
  return db.transaction(async (tx) => {
    const w = DEMO.workspace;
    const [ws] = await tx.query<{ id: number; slug: string; expires_at: string }>(
      `INSERT INTO workspaces (slug, name, institution, timezone, days, published_at, is_demo, expires_at, demo_ip_hash)
       VALUES ($1, $2, $3, $4, $5, now(), true, now() + make_interval(hours => ${DEMO_HOURS}), $6)
       RETURNING id, slug, to_char(expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS expires_at`,
      [`demo-${randomCode(8).toLowerCase()}`, w.name, w.institution, w.timezone, w.days, c.ipHash],
    );
    const id = ws.id;
    await replacePeriods(tx, id, DEFAULT_PERIODS);

    const col = <T, K extends keyof T>(rows: T[], k: K) => rows.map((r) => r[k]);
    await tx.query(
      `INSERT INTO rooms (workspace_id, name, capacity, building, kind)
       SELECT $1, * FROM unnest($2::text[], $3::int[], $4::text[], $5::text[])`,
      [id, col(DEMO.rooms, 'name'), col(DEMO.rooms, 'capacity'), col(DEMO.rooms, 'building'), col(DEMO.rooms, 'kind')],
    );
    await tx.query(
      `INSERT INTO teachers (workspace_id, name, short, email) SELECT $1, * FROM unnest($2::text[], $3::text[], $4::text[])`,
      [id, col(DEMO.teachers, 'name'), col(DEMO.teachers, 'short'), col(DEMO.teachers, 'email')],
    );
    await tx.query(
      `INSERT INTO batches (workspace_id, name, size, code) SELECT $1, * FROM unnest($2::text[], $3::int[], $4::text[])`,
      [id, col(DEMO.batches, 'name'), col(DEMO.batches, 'size'), DEMO.batches.map((b) => batchCode(b.name))],
    );
    await tx.query(
      `INSERT INTO courses (workspace_id, code, name, color, teacher_id)
       SELECT $1, x.code, x.name, x.color, t.id
         FROM unnest($2::text[], $3::text[], $4::smallint[], $5::text[]) AS x(code, name, color, teacher)
         JOIN teachers t ON t.workspace_id = $1 AND t.short = x.teacher`,
      [id, col(DEMO.courses, 'code'), col(DEMO.courses, 'name'), col(DEMO.courses, 'color'), col(DEMO.courses, 'teacher')],
    );
    const cls = demoClasses();
    await tx.query(
      `INSERT INTO classes (workspace_id, course_id, batch_id, teacher_id, room_id, day_of_week, start_time, end_time)
       SELECT $1, co.id, b.id, co.teacher_id, r.id, x.day, x.start_time, x.end_time
         FROM unnest($2::smallint[], $3::time[], $4::time[], $5::text[], $6::text[], $7::text[])
              AS x(day, start_time, end_time, course, batch, room)
         JOIN courses co ON co.workspace_id = $1 AND co.code = x.course
         JOIN batches b ON b.workspace_id = $1 AND b.name = x.batch
         JOIN rooms r ON r.workspace_id = $1 AND r.name = x.room`,
      [id, ...[0, 1, 2, 3, 4, 5].map((i) => cls.map((row) => row[i]))],
    );
    const ch = DEMO.changes;
    const on = (day: number | undefined) => (day ? addDays(c.monday, day - 1) : null);
    await tx.query(
      `INSERT INTO changes (workspace_id, class_id, occurs_on, kind, to_date, to_start, to_end, to_room_id, reason, created_by, created_at)
       SELECT $1, cl.id, x.occurs_on, x.kind, x.to_date, x.to_start, x.to_end, r.id, x.reason, x.by,
              now() - make_interval(hours => x.ord::int * 5)
         FROM unnest($2::text[], $3::text[], $4::date[], $5::time[], $6::date[], $7::time[], $8::time[], $9::text[], $10::text[], $11::text[])
              WITH ORDINALITY AS x(kind, batch, occurs_on, start_time, to_date, to_start, to_end, to_room, reason, by, ord)
         JOIN batches b ON b.workspace_id = $1 AND b.name = x.batch
         JOIN classes cl ON cl.workspace_id = $1 AND cl.batch_id = b.id
                        AND cl.day_of_week = EXTRACT(ISODOW FROM x.occurs_on) AND cl.start_time = x.start_time
         LEFT JOIN rooms r ON r.workspace_id = $1 AND r.name = x.to_room`,
      [
        id,
        col(ch, 'kind'),
        col(ch, 'batch'),
        ch.map((x) => on(x.day)),
        col(ch, 'start'),
        ch.map((x) => on(x.toDay)),
        ch.map((x) => x.toStart ?? null),
        ch.map((x) => x.toEnd ?? null),
        ch.map((x) => x.toRoom ?? null),
        col(ch, 'reason'),
        col(ch, 'by'),
      ],
    );
    return { id, slug: ws.slug, expiresAt: ws.expires_at };
  });
}
