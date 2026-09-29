// All SQL lives here. Every function takes a Db/Queryable, so the same code runs
// against Neon (Workers), node-postgres, or PGlite (tests).
//
// Overlay model: regular_timetable is the fixed weekly timetable and is never
// written by the API. A cancel/postpone is a row in modified_classes that
// replaces the regular class for every occurrence up to valid_until. A row is
// visible to a caller when sandbox_id IS NULL (shared) or equals the caller's
// sandbox. Weekdays are ISO: 1 = Monday ... 7 = Sunday.

import type { Db, Queryable } from './db';

export type Role = 'student' | 'professor';

export interface User {
  id: number;
  username: string;
  password: string;
  email: string;
  role: Role;
  batch: string | null;
}

export interface Clash {
  type: 'room' | 'professor';
  class_id: number;
  course_code: string;
  course_name: string;
  room_number: string | null;
  start_time: string;
  end_time: string;
}

// ---------------------------------------------------------------- users

export async function findUserByUsername(db: Queryable, username: string): Promise<User | undefined> {
  const [user] = await db.query<User>(
    `SELECT id, username, password, email, role::text AS role, batch FROM users WHERE username = $1`,
    [username],
  );
  return user;
}

export async function createUser(
  db: Queryable,
  u: { username: string; passwordHash: string; email: string; role: Role; batch: string | null },
): Promise<void> {
  await db.query(
    `INSERT INTO users (username, password, email, role, batch) VALUES ($1, $2, $3, $4, $5)`,
    [u.username, u.passwordHash, u.email, u.role, u.batch],
  );
}

// ---------------------------------------------------------------- reads

/**
 * The caller's timetable: a student's batch, or a professor's courses. Each
 * regular class appears once, with the newest visible, unexpired overlay (a
 * sandbox overlay wins over a shared one).
 */
export function getTimetable(
  db: Queryable,
  who: { role: Role; id: number; batch: string | null },
  today: string,
  sandboxId: string | null,
) {
  const filter = who.role === 'student' ? 'rt.batch = $1' : 'c.professor_id = $1';
  return db.query(
    `SELECT rt.id, rt.course_id, rt.batch, rt.day_of_week,
            rt.start_time::text AS start_time, rt.end_time::text AS end_time, rt.classroom_id,
            c.course_name, c.course_code, cl.room_number, cl.building,
            u.username AS faculty_name,
            mc.modification_type::text AS modification_type,
            mc.new_date::text AS new_date,
            mc.new_start_time::text AS new_start_time,
            mc.new_end_time::text AS new_end_time,
            mc.new_classroom_id, ncl.room_number AS new_room_number, ncl.building AS new_building
       FROM regular_timetable rt
       JOIN courses c ON c.id = rt.course_id
       LEFT JOIN users u ON u.id = c.professor_id
       LEFT JOIN classrooms cl ON cl.id = rt.classroom_id
       LEFT JOIN LATERAL (
         SELECT m.* FROM modified_classes m
          WHERE m.regular_class_id = rt.id
            AND m.valid_until >= $2::date
            AND (m.sandbox_id IS NULL OR m.sandbox_id = $3::text)
          ORDER BY m.sandbox_id IS NULL, m.created_at DESC, m.id DESC
          LIMIT 1
       ) mc ON true
       LEFT JOIN classrooms ncl ON ncl.id = mc.new_classroom_id
      WHERE ${filter}
      ORDER BY rt.day_of_week, rt.start_time, rt.id`,
    [who.role === 'student' ? who.batch : who.id, today, sandboxId],
  );
}

export function getClass(db: Queryable, classId: number) {
  return db.query(
    `SELECT rt.id, rt.course_id, rt.batch, rt.day_of_week,
            rt.start_time::text AS start_time, rt.end_time::text AS end_time, rt.classroom_id,
            c.course_name, cl.room_number
       FROM regular_timetable rt
       JOIN courses c ON c.id = rt.course_id
       JOIN classrooms cl ON cl.id = rt.classroom_id
      WHERE rt.id = $1`,
    [classId],
  );
}

// ---------------------------------------------------------------- bookings

// Everything occupying a room/professor on date $1 between $2 and $3, as seen
// from sandbox $4: regular classes on that weekday that no visible overlay has
// cancelled or moved away, plus visible postponements moved onto that date.
// Intervals are half-open, so 09:00-10:00 and 10:00-11:00 do not clash.
const BUSY = `
  visible AS (
    SELECT * FROM modified_classes m
     WHERE m.valid_until >= $1::date
       AND (m.sandbox_id IS NULL OR m.sandbox_id = $4::text)
  ),
  bookings AS (
    SELECT rt.id AS class_id, rt.classroom_id AS room_id, c.professor_id,
           rt.start_time, rt.end_time
      FROM regular_timetable rt
      JOIN courses c ON c.id = rt.course_id
     WHERE rt.day_of_week = EXTRACT(ISODOW FROM $1::date)
       AND NOT EXISTS (SELECT 1 FROM visible v WHERE v.regular_class_id = rt.id)
    UNION ALL
    SELECT rt.id, v.new_classroom_id, c.professor_id, v.new_start_time, v.new_end_time
      FROM visible v
      JOIN regular_timetable rt ON rt.id = v.regular_class_id
      JOIN courses c ON c.id = rt.course_id
     WHERE v.modification_type = 'postponed' AND v.new_date = $1::date
  ),
  busy AS (
    SELECT * FROM bookings b WHERE b.start_time < $3::time AND b.end_time > $2::time
  )`;

/** Rooms with nothing booked in the slot. `excludeClassId` ignores that class's own booking. */
export function availableRooms(
  db: Queryable,
  slot: { date: string; startTime: string; endTime: string },
  sandboxId: string | null,
  excludeClassId: number | null = null,
) {
  return db.query(
    `WITH ${BUSY}
     SELECT cl.id, cl.room_number, cl.capacity, cl.building
       FROM classrooms cl
      WHERE NOT EXISTS (
        SELECT 1 FROM busy b WHERE b.room_id = cl.id AND b.class_id IS DISTINCT FROM $5::int
      )
      ORDER BY cl.room_number`,
    [slot.date, slot.startTime, slot.endTime, sandboxId, excludeClassId],
  );
}

async function findClashes(
  tx: Queryable,
  p: { classId: number; professorId: number; roomId: number; date: string; startTime: string; endTime: string },
  sandboxId: string | null,
): Promise<Clash[]> {
  const rows = await tx.query<Omit<Clash, 'type'> & { room_clash: boolean; professor_clash: boolean }>(
    `WITH ${BUSY}
     SELECT b.class_id, c.course_code, c.course_name, cl.room_number,
            b.start_time::text AS start_time, b.end_time::text AS end_time,
            COALESCE(b.room_id = $6, false) AS room_clash,
            COALESCE(b.professor_id = $7, false) AS professor_clash
       FROM busy b
       JOIN regular_timetable rt ON rt.id = b.class_id
       JOIN courses c ON c.id = rt.course_id
       LEFT JOIN classrooms cl ON cl.id = b.room_id
      WHERE b.class_id <> $5 AND (b.room_id = $6 OR b.professor_id = $7)
      ORDER BY b.start_time, b.class_id`,
    [p.date, p.startTime, p.endTime, sandboxId, p.classId, p.roomId, p.professorId],
  );
  return rows.flatMap(({ room_clash, professor_clash, ...booking }) => [
    ...(room_clash ? [{ type: 'room' as const, ...booking }] : []),
    ...(professor_clash ? [{ type: 'professor' as const, ...booking }] : []),
  ]);
}

// ---------------------------------------------------------------- writes

export type ChangeResult =
  | { status: 'ok'; id: number }
  | { status: 'class_not_found' }
  | { status: 'room_not_found' }
  | { status: 'forbidden' }
  | { status: 'already_modified' }
  | { status: 'clash'; clashes: Clash[] };

/**
 * Transaction-scoped advisory lock. Released automatically at COMMIT/ROLLBACK,
 * which also makes it safe behind Neon's transaction-mode pooler.
 */
const lock = (tx: Queryable, key: string) =>
  tx.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [key]);

/** Loads the class, checks ownership, and locks it against concurrent changes. */
async function lockOwnedClass(
  tx: Queryable,
  classId: number,
  professorId: number,
  today: string,
  sandboxId: string | null,
): Promise<ChangeResult | null> {
  const [cls] = await tx.query<{ professor_id: number | null }>(
    `SELECT c.professor_id FROM regular_timetable rt JOIN courses c ON c.id = rt.course_id WHERE rt.id = $1`,
    [classId],
  );
  if (!cls) return { status: 'class_not_found' };
  if (cls.professor_id !== professorId) return { status: 'forbidden' };
  await lock(tx, `class:${classId}`);
  const [active] = await tx.query(
    `SELECT 1 FROM modified_classes m
      WHERE m.regular_class_id = $1 AND m.valid_until >= $2::date
        AND (m.sandbox_id IS NULL OR m.sandbox_id = $3::text)
      LIMIT 1`,
    [classId, today, sandboxId],
  );
  return active ? { status: 'already_modified' } : null;
}

export function cancelClass(
  db: Db,
  c: { classId: number; professorId: number; validUntil: string; today: string; sandboxId: string | null },
): Promise<ChangeResult> {
  return db.transaction(async (tx) => {
    const refused = await lockOwnedClass(tx, c.classId, c.professorId, c.today, c.sandboxId);
    if (refused) return refused;
    const [row] = await tx.query<{ id: number }>(
      `INSERT INTO modified_classes (regular_class_id, modification_type, valid_until, sandbox_id)
       VALUES ($1, 'cancelled', $2, $3) RETURNING id`,
      [c.classId, c.validUntil, c.sandboxId],
    );
    return { status: 'ok', id: row.id };
  });
}

export interface PostponeInput {
  classId: number;
  professorId: number;
  newDate: string;
  newStartTime: string;
  newEndTime: string;
  newClassroomId: number;
  validUntil: string;
  today: string;
  sandboxId: string | null;
}

/**
 * Postpone inside one transaction:
 *   lock class -> lock room+date -> lock professor+date (always in this order,
 *   so two postpones can never deadlock), then re-check room and professor
 *   clashes against the base timetable + visible overlays, then insert.
 * Checks run under READ COMMITTED after the locks are held, so they see
 * anything a previous lock holder committed.
 */
export function postponeClass(db: Db, p: PostponeInput): Promise<ChangeResult> {
  return db.transaction(async (tx) => {
    const refused = await lockOwnedClass(tx, p.classId, p.professorId, p.today, p.sandboxId);
    if (refused) return refused;
    const [room] = await tx.query(`SELECT id FROM classrooms WHERE id = $1`, [p.newClassroomId]);
    if (!room) return { status: 'room_not_found' };

    await lock(tx, `room:${p.newClassroomId}:${p.newDate}`);
    await lock(tx, `professor:${p.professorId}:${p.newDate}`);

    const clashes = await findClashes(
      tx,
      {
        classId: p.classId,
        professorId: p.professorId,
        roomId: p.newClassroomId,
        date: p.newDate,
        startTime: p.newStartTime,
        endTime: p.newEndTime,
      },
      p.sandboxId,
    );
    if (clashes.length) return { status: 'clash', clashes };

    const [row] = await tx.query<{ id: number }>(
      `INSERT INTO modified_classes
         (regular_class_id, modification_type, new_date, new_start_time, new_end_time,
          new_classroom_id, valid_until, sandbox_id)
       VALUES ($1, 'postponed', $2, $3, $4, $5, $6, $7) RETURNING id`,
      [p.classId, p.newDate, p.newStartTime, p.newEndTime, p.newClassroomId, p.validUntil, p.sandboxId],
    );
    return { status: 'ok', id: row.id };
  });
}

/** Deletes expired overlays and sandbox overlays older than 24 h. Returns the number deleted. */
export async function cleanupOverlays(db: Queryable, today: string): Promise<number> {
  const [{ deleted }] = await db.query<{ deleted: number }>(
    `WITH gone AS (
       DELETE FROM modified_classes
        WHERE valid_until < $1::date
           OR (sandbox_id IS NOT NULL AND created_at < now() - interval '24 hours')
       RETURNING 1
     )
     SELECT count(*)::int AS deleted FROM gone`,
    [today],
  );
  return deleted;
}
