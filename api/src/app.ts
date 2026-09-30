import { Hono, type MiddlewareHandler } from 'hono';
import { cors } from 'hono/cors';
import { workspaceMiddleware } from './access';
import type { Db } from './db';
import type { AppEnv, Bindings } from './env';
import { errorBody, forbidden, HttpError, isUniqueViolation } from './http';
import { internalRoutes } from './internal';
import { bodyLimits } from './limits';
import auth from './routes/auth';
import demo from './routes/demo';
import ics from './routes/ics';
import pub from './routes/public';
import setup from './routes/setup';
import timetable from './routes/timetable';
import workspaces from './routes/workspaces';
import { sessionMiddleware } from './session';

export const ALLOWED_ORIGINS = ['https://edusched.amittal.dev', 'https://www.amittal.dev', 'http://localhost:5173'];

export type DbFactory = (env: Bindings) => Db;

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Routes that never need the session: health checks (which must not touch Neon),
// class-code reads and the static demo week.
const NO_SESSION = /^\/api\/(test|health|public\/.*|demo\/week)$/;

export function createApp(getDb: DbFactory) {
  const app = new Hono<AppEnv>();

  app.use(
    '*',
    cors({
      origin: ALLOWED_ORIGINS,
      credentials: true,
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type'],
      maxAge: 86400,
    }),
  );

  // CSRF: the session cookie is SameSite=Lax and the app is same-site, so a state
  // change must also prove it came from our origin. Requiring application/json
  // forces a CORS preflight, which a cross-origin form or fetch cannot pass.
  app.use('/api/*', async (c, next) => {
    if (SAFE_METHODS.has(c.req.method)) return next();
    const origin = c.req.header('origin');
    const type = c.req.header('content-type') ?? '';
    if (!origin || !ALLOWED_ORIGINS.includes(origin)) throw forbidden('This request did not come from EduSched.');
    if (!/^application\/json\b/i.test(type)) throw forbidden('Send state changes as application/json.');
    await next();
  });

  app.use('/api/*', bodyLimits);

  const withDb: MiddlewareHandler<AppEnv> = async (c, next) => {
    c.set('db', getDb(c.env));
    c.set('session', null);
    await next();
  };
  app.use('/api/*', withDb);
  app.use('/ics/*', withDb);
  app.use('/api/*', (c, next) => (NO_SESSION.test(c.req.path) ? next() : sessionMiddleware(c, next)));

  app.get('/api/health', async (c) => {
    try {
      await c.var.db.query('SELECT 1');
      return c.json({ status: 'ok', db: 'ok' });
    } catch {
      return c.json({ status: 'degraded', db: 'unreachable' }, 503);
    }
  });
  app.get('/api/test', (c) => c.json({ message: 'API is working' }));

  // matches /api/w/:slug itself too
  app.use('/api/w/:slug/*', workspaceMiddleware);

  for (const routes of [auth, workspaces, setup, timetable, pub, demo]) app.route('/api', routes);
  app.route('/ics', ics);
  app.route('/internal', internalRoutes(getDb));

  app.notFound((c) => c.json({ error: 'Not found.', code: 'not_found' }, 404));
  app.onError((err, c) => {
    if (err instanceof HttpError) return errorBody(c, err);
    if (isUniqueViolation(err)) return c.json({ error: 'That already exists.', code: 'conflict' }, 409);
    if ((err as { code?: string }).code === '23503') {
      return c.json({ error: 'Something else still uses that. Remove it first.', code: 'conflict' }, 409);
    }
    console.error(err);
    return c.json({ error: 'Something went wrong on our side. Try again.', code: 'server' }, 500);
  });

  return app;
}
