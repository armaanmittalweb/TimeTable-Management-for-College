// DEV ONLY. Serves the Worker's Hono app on Node against an in-process PGlite
// database, so the frontend can be developed without Neon, Postgres or wrangler.
//
//   npm run dev:local        -> http://localhost:8787
//
// The database lives in memory: every restart starts from db/schema.sql + db/seed.sql.
// PGlite is a single connection, so concurrent postpones (the RACE demo) are
// serialized here rather than truly racing. The outcome is the same (one 201,
// one 409) but the lock contention itself only happens on a real Postgres.
// Never deploy this: it uses a hard-coded JWT secret.

import { serve } from '@hono/node-server';
import { createApp, DEFAULT_TIMEZONE } from '../src/app';
import { cleanupOverlays } from '../src/data';
import { todayIn } from '../src/dates';
import type { Bindings } from '../src/env';
import { pgliteDb, seededPglite } from '../test/helpers';

const PORT = Number(process.env.PORT) || 8787;

const env: Bindings = {
  DATABASE_URL: 'pglite://memory',
  JWT_SECRET: 'dev-local-only-not-a-secret',
  DEMO_MODE: 'true',
  TIMEZONE: process.env.TIMEZONE || DEFAULT_TIMEZONE,
};

const pg = await seededPglite();
const db = pgliteDb(pg);
const app = createApp(() => db);

// Stand-in for the hourly cron trigger.
setInterval(async () => {
  const n = await cleanupOverlays(db, todayIn(env.TIMEZONE!));
  if (n) console.log(`cleanup: deleted ${n} overlays`);
}, 60 * 60 * 1000).unref();

serve({ fetch: (req) => app.fetch(req, env), port: PORT }, ({ port }) => {
  console.log(`EduSched API (dev-local, PGlite in memory) on http://localhost:${port}`);
  console.log('demo logins: prof.meera / student.aarav, password edusched-demo');
});
