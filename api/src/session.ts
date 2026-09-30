// Cookie sessions. The cookie holds a random 32-byte token; the sessions table holds
// its SHA-256, so a database leak does not hand out working sessions.

import type { Context, MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { createSession, loadSession, SESSION_DAYS } from './data/accounts';
import type { AppEnv, Session } from './env';
import { forbidden, unauthenticated } from './http';
import { randomToken, sha256Hex } from './tokens';

export const SESSION_COOKIE = 'es_session';

// Local dev runs on http://localhost, where a Secure cookie would never be sent back.
const secure = (c: Context) => new URL(c.req.url).protocol === 'https:';

function cookieOptions(c: Context) {
  return { httpOnly: true, secure: secure(c), sameSite: 'Lax' as const, path: '/' };
}

/** Starts a session for a user or a demo guest and sets the cookie. */
export async function startSession(
  c: Context<AppEnv>,
  who: { userId: number } | { demoWorkspaceId: number; expiresAt: string },
) {
  const token = randomToken();
  await createSession(c.var.db, { id: await sha256Hex(token), ...who, userAgent: c.req.header('user-agent') ?? null });
  setCookie(c, SESSION_COOKIE, token, { ...cookieOptions(c), maxAge: SESSION_DAYS * 24 * 60 * 60 });
}

export function clearSessionCookie(c: Context) {
  deleteCookie(c, SESSION_COOKIE, cookieOptions(c));
}

/** Loads the session when a cookie is present; requests without one never touch the database here. */
export const sessionMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE);
  c.set('session', token && token.length <= 128 ? await loadSession(c.var.db, await sha256Hex(token)) : null);
  await next();
};

export function requireSession(c: Context<AppEnv>): Session {
  const s = c.var.session;
  if (!s) throw unauthenticated();
  return s;
}

/** A signed-in account (not a demo guest). */
export function requireUser(c: Context<AppEnv>): Session & { userId: number } {
  const s = requireSession(c);
  if (!s.userId) throw forbidden('Create an account to do that; the demo college is read-and-play only.');
  return s as Session & { userId: number };
}
