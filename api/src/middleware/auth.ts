import { createMiddleware } from 'hono/factory';
import { verify } from 'hono/jwt';
import type { AppEnv } from '../env';

export const authenticateToken = createMiddleware<AppEnv>(async (c, next) => {
  const token = c.req.header('Authorization')?.split(' ')[1];
  if (!token) return c.json({ error: 'Access token required' }, 401);

  let payload: Record<string, unknown>;
  try {
    payload = await verify(token, c.env.JWT_SECRET, 'HS256');
  } catch {
    return c.json({ error: 'Invalid token' }, 403);
  }
  const { id, role, batch } = payload;
  if (typeof id !== 'number' || (role !== 'student' && role !== 'professor')) {
    return c.json({ error: 'Invalid token' }, 403);
  }
  c.set('user', { id, role, batch: typeof batch === 'string' ? batch : null });
  await next();
});

export const isProfessor = createMiddleware<AppEnv>(async (c, next) => {
  if (c.get('user').role !== 'professor') {
    return c.json({ error: 'Professor access required' }, 403);
  }
  await next();
});
