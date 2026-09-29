import { describe, expect, it } from 'vitest';
import { pgliteDb, seededPglite } from './helpers';

describe('seed data', () => {
  it('loads, and the base timetable has no room, professor or batch clashes', async () => {
    const db = pgliteDb(await seededPglite());
    const clashes = await db.query(
      `SELECT a.id AS a, b.id AS b
         FROM regular_timetable a
         JOIN courses ca ON ca.id = a.course_id
         JOIN regular_timetable b ON b.id > a.id AND b.day_of_week = a.day_of_week
                                 AND b.start_time < a.end_time AND b.end_time > a.start_time
         JOIN courses cb ON cb.id = b.course_id
        WHERE a.classroom_id = b.classroom_id OR ca.professor_id = cb.professor_id OR a.batch = b.batch`,
    );
    expect(clashes).toEqual([]);
    const [counts] = await db.query(
      `SELECT (SELECT count(DISTINCT batch)::int FROM regular_timetable) AS batches,
              (SELECT count(DISTINCT day_of_week)::int FROM regular_timetable) AS days,
              (SELECT count(*)::int FROM users WHERE password LIKE 'pbkdf2_sha256$%') AS demo_logins`,
    );
    expect(counts).toEqual({ batches: 3, days: 5, demo_logins: 2 });
  });
});
