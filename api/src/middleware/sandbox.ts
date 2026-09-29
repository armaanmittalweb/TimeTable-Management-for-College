import { createMiddleware } from 'hono/factory';
import { isDemo, type AppEnv } from '../env';

// A sandbox id is a short random token chosen by the visitor's browser (or by
// us on first contact). Every overlay the public demo writes carries it, and
// reads only see shared overlays plus the caller's own.
export const SANDBOX_HEADER = 'X-Sandbox-Id';
const SANDBOX_ID = /^[A-Za-z0-9_-]{16,64}$/;

export function newSandboxId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export const sandbox = createMiddleware<AppEnv>(async (c, next) => {
  if (!isDemo(c.env)) {
    c.set('sandboxId', null);
    return next();
  }
  const given = c.req.header(SANDBOX_HEADER);
  if (given !== undefined && !SANDBOX_ID.test(given)) {
    return c.json({ error: `Invalid ${SANDBOX_HEADER}: expected 16-64 characters of [A-Za-z0-9_-]` }, 400);
  }
  const id = given ?? newSandboxId();
  c.set('sandboxId', id);
  c.header(SANDBOX_HEADER, id);
  await next();
});
