// Concurrency test: needs a real, multi-connection Postgres (PGlite has one
// connection, so it cannot race). Skipped unless TEST_DATABASE_URL is set, e.g.
//   TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/postgres npm test
// It works in a throwaway schema and drops it afterwards.

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../src/password';
import { poolDb, type PoolLike } from '../src/db';
import { apiClient, nextWeekday, schemaSql, seedSql, SANDBOX_A } from './helpers';

const url = process.env.TEST_DATABASE_URL;
const schema = `edusched_race_${Date.now()}`;

describe.skipIf(!url)('concurrent postpones (needs real Postgres: set TEST_DATABASE_URL)', () => {
  let admin: pg.Client;
  let pool: pg.Pool;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: url });
    await admin.connect();
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.query(`SET search_path TO ${schema}`);
    await admin.query(schemaSql);
    await admin.query(seedSql);
    // give a second professor (kabir.sethi, id 2) a password so two different
    // professors can race for the same room
    await admin.query(`UPDATE users SET password = $1 WHERE id = 2`, [await hashPassword('race-pw')]);
    pool = new pg.Pool({ connectionString: url, max: 4, options: `-c search_path=${schema}` });
  });

  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin?.end();
  });

  it('lets exactly one of two simultaneous postpones into the same room/slot win', async () => {
    const api = apiClient(poolDb(pool as unknown as PoolLike));
    const [meera, kabir] = await Promise.all([api.login('prof.meera'), api.login('kabir.sethi', 'race-pw')]);
    const slot = { newDate: nextWeekday(6), newStartTime: '10:00', newEndTime: '11:00', newClassroomId: 4 };
    const request = (token: string, classId: number) =>
      api.call('POST', '/api/timetable/postpone-class', {
        token,
        sandbox: SANDBOX_A,
        body: { ...slot, classId },
      });

    // class 1 is prof.meera's, class 5 is kabir.sethi's: only the room can clash
    const results = await Promise.all([request(meera, 1), request(kabir, 5)]);

    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const loser = results.find((r) => r.status === 409)!;
    expect(loser.body.clashes).toEqual([expect.objectContaining({ type: 'room' })]);
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM modified_classes`);
    expect(rows[0].n).toBe(1);
  });
});
