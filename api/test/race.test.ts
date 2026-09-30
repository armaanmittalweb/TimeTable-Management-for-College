// Concurrency test: needs a real, multi-connection Postgres (PGlite has one
// connection, so it cannot race). Skipped unless TEST_DATABASE_URL is set, e.g.
//   TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/postgres npm test
// It works in a throwaway schema and drops it afterwards.

import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { addDays } from '../src/dates';
import { poolDb, type PoolLike } from '../src/db';
import { buildCollege, harness, nextWeekday, schemaSql, type Browser, type College } from './helpers';

const url = process.env.TEST_DATABASE_URL;
const schema = `edusched_race_${Date.now()}`;

describe.skipIf(!url)('concurrent moves (needs real Postgres: set TEST_DATABASE_URL)', () => {
  let admin: pg.Client;
  let pool: pg.Pool;
  let coord: Browser;
  let college: College;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: url });
    await admin.connect();
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.query(`SET search_path TO ${schema}`);
    await admin.query(schemaSql);
    pool = new pg.Pool({ connectionString: url, max: 8, options: `-c search_path=${schema}` });
    const h = harness(poolDb(pool as unknown as PoolLike));
    coord = await h.signup();
    college = await buildCollege(coord);
  });

  beforeEach(async () => {
    await pool.query(`DELETE FROM changes`);
  });

  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin?.end();
  });

  /**
   * Moves two occurrences to overlapping slots on the same Thursday at the same
   * moment, over several weeks, and checks that every round has exactly one winner.
   */
  async function race(a: { id: number; day: number; roomId: number }, b: { id: number; day: number; roomId: number }, type: string) {
    for (let week = 1; week <= 5; week++) {
      const monday = addDays(nextWeekday(1), 7 * week);
      const thursday = addDays(monday, 3);
      const move = (c: typeof a, toStart: string, toEnd: string) =>
        coord.post(`${college.w}/classes/${c.id}/move`, { date: addDays(monday, c.day - 1), toDate: thursday, toStart, toEnd, roomId: c.roomId });
      const results = await Promise.all([move(a, '14:00', '15:00'), move(b, '14:30', '15:30')]);

      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      const loser = results.find((r) => r.status === 409)!;
      expect(loser.body.code).toBe('clash');
      expect(loser.body.clashes.map((c: any) => c.type)).toEqual([type]);
      const { rows } = await pool.query(`SELECT count(*)::int AS n FROM changes WHERE to_date = $1`, [thursday]);
      expect(rows[0].n).toBe(1);
    }
  }

  it('lets exactly one of two simultaneous moves into the same room win', async () => {
    // k1 (T1, B1) and k2 (T2, B2): only the room can clash
    const { k1, k2 } = college.classes;
    await race({ id: k1, day: 1, roomId: college.rooms.r1 }, { id: k2, day: 1, roomId: college.rooms.r1 }, 'room');
  });

  it('lets exactly one of two simultaneous moves by the same teacher win', async () => {
    // k1 (T1, B1) and k4 (T1, B2), into different rooms: only the teacher can clash
    const { k1, k4 } = college.classes;
    await race({ id: k1, day: 1, roomId: college.rooms.r1 }, { id: k4, day: 3, roomId: college.rooms.r2 }, 'teacher');
  });

  it('lets exactly one of two simultaneous moves for the same batch win', async () => {
    // k1 (T1, B1) and k3 (T3, B1), into different rooms: only the batch can clash
    const { k1, k3 } = college.classes;
    await race({ id: k1, day: 1, roomId: college.rooms.r1 }, { id: k3, day: 2, roomId: college.rooms.r2 }, 'batch');
  });
});
