// DEV ONLY. Serves the Worker's Hono app on Node, so the frontend can be developed
// without Neon or wrangler.
//
//   npm run dev:local                                  -> PGlite in memory
//   DATABASE_URL=postgresql://... npm run dev:local    -> a local Postgres (schema must be loaded)
//
// On PGlite every restart starts from db/schema.sql plus a ready-made account and
// workspace (a copy of the demo college), so there is something to sign in to:
//   dev@edusched.test / edusched-dev   ->  /api/w/dev-college
// PGlite is a single connection, so concurrent moves are serialised here rather
// than truly racing; the outcome is the same, the lock contention is not.

import { serve } from '@hono/node-server';
import pg from 'pg';
import { createApp } from '../src/app';
import { cloneDemo } from '../src/data/demo';
import { cleanup } from '../src/data/maintenance';
import { mondayOf, todayIn } from '../src/dates';
import { poolDb, type Db, type PoolLike } from '../src/db';
import type { Bindings } from '../src/env';
import { hashPassword } from '../src/password';
import { freshPglite, pgliteDb } from '../test/helpers';

const PORT = Number(process.env.PORT) || 8787;
const env: Bindings = { DATABASE_URL: process.env.DATABASE_URL || 'pglite://memory' };

async function devDatabase(): Promise<Db> {
  if (process.env.DATABASE_URL) {
    return poolDb(new pg.Pool({ connectionString: process.env.DATABASE_URL }) as unknown as PoolLike);
  }
  const db = pgliteDb(await freshPglite());
  const [{ id: userId }] = await db.query<{ id: number }>(
    `INSERT INTO users (email, name, password_hash) VALUES ('dev@edusched.test', 'Dev Coordinator', $1) RETURNING id`,
    [await hashPassword('edusched-dev')],
  );
  const copy = await cloneDemo(db, { monday: mondayOf(todayIn('Asia/Kolkata')), ipHash: 'dev' });
  await db.query(
    `UPDATE workspaces SET slug = 'dev-college', is_demo = false, expires_at = NULL, demo_ip_hash = NULL, created_by = $2
      WHERE id = $1`,
    [copy.id, userId],
  );
  await db.query(`INSERT INTO members (workspace_id, user_id, role) VALUES ($1, $2, 'coordinator')`, [copy.id, userId]);
  return db;
}

const db = await devDatabase();
const app = createApp(() => db);

// Stand-in for the hourly cron trigger.
setInterval(async () => {
  const r = await cleanup(db);
  if (r.deleted) console.log('cleanup', r);
}, 60 * 60 * 1000).unref();

serve({ fetch: (req) => app.fetch(req, env), port: PORT }, ({ port }) => {
  console.log(`EduSched API (dev-local) on http://localhost:${port}`);
  if (!process.env.DATABASE_URL) console.log('sign in as dev@edusched.test / edusched-dev (workspace dev-college)');
});
