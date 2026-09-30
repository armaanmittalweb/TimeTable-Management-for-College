import { Hono } from 'hono';
import { cleanupOverlays } from './data';
import { todayIn } from './dates';
import type { Bindings } from './env';
import type { Db } from './db';

/** Compares without an early exit, so response time says nothing about how much of the key matched. */
export function sameKey(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/**
 * Private routes for the Switchboard's admin dashboard. They are reached through a service
 * binding and need the shared INTERNAL_KEY; without it they answer 404 like any unknown path.
 */
export function internalRoutes(getDb: (env: Bindings) => Db, defaultTimezone: string) {
  const app = new Hono<{ Bindings: Bindings }>();

  app.use('*', async (c, next) => {
    const key = c.env.INTERNAL_KEY;
    if (!key || !sameKey(c.req.header('x-internal-key') ?? '', key)) return c.json({ error: 'Not found' }, 404);
    await next();
  });

  app.get('/stats', async (c) => {
    const [row] = await getDb(c.env).query<{ db_bytes: string; overlays: number; sandboxes_24h: number; users: number }>(
      `SELECT pg_database_size(current_database())::bigint AS db_bytes,
              (SELECT count(*)::int FROM modified_classes) AS overlays,
              (SELECT count(DISTINCT sandbox_id)::int FROM modified_classes
                WHERE sandbox_id IS NOT NULL AND created_at > now() - interval '24 hours') AS sandboxes_24h,
              (SELECT count(*)::int FROM users) AS users`,
    );
    return c.json({
      dbBytes: Number(row?.db_bytes ?? 0),
      overlays: row?.overlays ?? 0,
      sandboxes24h: row?.sandboxes_24h ?? 0,
      users: row?.users ?? 0,
    });
  });

  app.post('/cleanup', async (c) => {
    const deleted = await cleanupOverlays(getDb(c.env), todayIn(c.env.TIMEZONE || defaultTimezone));
    return c.json({ deleted });
  });

  return app;
}
