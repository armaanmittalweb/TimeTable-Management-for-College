import { Hono } from 'hono';
import { cleanup, stats } from './data/maintenance';
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
export function internalRoutes(getDb: (env: Bindings) => Db) {
  const app = new Hono<{ Bindings: Bindings }>();

  app.use('*', async (c, next) => {
    const key = c.env.INTERNAL_KEY;
    if (!key || !sameKey(c.req.header('x-internal-key') ?? '', key)) {
      return c.json({ error: 'Not found.', code: 'not_found' }, 404);
    }
    await next();
  });

  app.get('/stats', async (c) => c.json(await stats(getDb(c.env))));
  app.post('/cleanup', async (c) => c.json(await cleanup(getDb(c.env))));

  return app;
}
