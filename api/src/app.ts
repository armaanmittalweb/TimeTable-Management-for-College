import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Db } from './db';
import { todayIn } from './dates';
import type { AppEnv, Bindings } from './env';
import { internalRoutes } from './internal';
import { SANDBOX_HEADER } from './middleware/sandbox';
import auth from './routes/auth';
import timetable from './routes/timetable';

export const ALLOWED_ORIGINS = ['https://edusched.amittal.dev', 'https://www.amittal.dev', 'http://localhost:5173'];
export const DEFAULT_TIMEZONE = 'Asia/Kolkata';

export type DbFactory = (env: Bindings) => Db;

export function createApp(getDb: DbFactory) {
  const app = new Hono<AppEnv>();

  app.use(
    '*',
    cors({
      origin: ALLOWED_ORIGINS,
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization', SANDBOX_HEADER],
      exposeHeaders: [SANDBOX_HEADER],
      maxAge: 86400,
    }),
  );

  app.use('/api/*', async (c, next) => {
    c.set('db', getDb(c.env));
    c.set('today', todayIn(c.env.TIMEZONE || DEFAULT_TIMEZONE));
    await next();
  });

  app.get('/api/health', async (c) => {
    try {
      await c.var.db.query('SELECT 1');
      return c.json({ status: 'ok', db: 'ok' });
    } catch {
      return c.json({ status: 'degraded', db: 'unreachable' }, 503);
    }
  });
  app.get('/api/test', (c) => c.json({ message: 'API is working' }));

  app.route('/api/auth', auth);
  app.route('/api/timetable', timetable);
  app.route('/internal', internalRoutes(getDb, DEFAULT_TIMEZONE));

  app.notFound((c) => c.json({ error: 'Not found' }, 404));
  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: 'Internal server error' }, 500);
  });

  return app;
}
