// Accounts: sign up, sign in and out, sessions, passwords, deletion, followed batches.
// Mounted at /api.

import { Hono } from 'hono';
import {
  blockingWorkspaces,
  createUser,
  deleteAccount,
  deleteOtherSessions,
  deleteSession,
  findUserByEmail,
  getMe,
  getUser,
  listFollows,
  listSessions,
  redeemResetCode,
  replaceFollows,
  setPassword,
} from '../data/accounts';
import type { AppEnv } from '../env';
import { badRequest, conflict, HttpError, notFound, unauthenticated } from '../http';
import { rateLimit } from '../limits';
import { hashPassword, verifyPassword } from '../password';
import { clearSessionCookie, requireSession, requireUser, startSession } from '../session';
import { normalizeCode, sha256Hex } from '../tokens';
import { email, password, readBody, text } from '../validate';

const auth = new Hono<AppEnv>();

const BAD_LOGIN = 'That email and password do not match an account.';

// A hash to verify against when the email is unknown, so a miss takes as long as a
// wrong password and response times do not reveal which emails have accounts.
let decoyHash: Promise<string> | null = null;
const decoy = () => (decoyHash ??= hashPassword('not-a-real-password'));

const accountOnly = (userId: number) => ({ userId, demoWorkspaceId: null, actingRole: null, actingId: null });

auth.post('/auth/signup', rateLimit('AUTH_LIMITER'), async (c) => {
  const body = await readBody(c);
  const name = text(body.name, 'name', 80);
  const mail = email(body.email);
  const pw = password(body.password);
  const userId = await createUser(c.var.db, { email: mail, name, passwordHash: await hashPassword(pw) });
  if (!userId) throw conflict('An account with that email already exists. Sign in instead.');
  await startSession(c, { userId });
  return c.json(await getMe(c.var.db, accountOnly(userId)), 201);
});

auth.post('/auth/login', rateLimit('AUTH_LIMITER'), async (c) => {
  const body = await readBody(c);
  const mail = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const pw = typeof body.password === 'string' ? body.password : '';
  const user = mail && pw ? await findUserByEmail(c.var.db, mail) : undefined;
  const ok = await verifyPassword(pw, user?.password_hash ?? (await decoy()));
  if (!user || !ok) throw unauthenticated(BAD_LOGIN);
  await startSession(c, { userId: user.id });
  return c.json(await getMe(c.var.db, accountOnly(user.id)));
});

auth.post('/auth/logout', async (c) => {
  const s = c.var.session;
  if (s) await deleteSession(c.var.db, s.id);
  clearSessionCookie(c);
  return c.body(null, 204);
});

auth.get('/auth/me', async (c) => c.json(await getMe(c.var.db, requireSession(c))));

auth.get('/auth/sessions', async (c) => {
  const s = requireUser(c);
  return c.json(await listSessions(c.var.db, s.userId, s.id));
});

auth.delete('/auth/sessions/:id', async (c) => {
  const s = requireUser(c);
  const id = c.req.param('id');
  if (!/^[0-9a-f]{64}$/.test(id) || !(await deleteSession(c.var.db, id, s.userId))) throw notFound('No such session.');
  if (id === s.id) clearSessionCookie(c);
  return c.body(null, 204);
});

auth.post('/auth/password', rateLimit('AUTH_LIMITER'), async (c) => {
  const s = requireUser(c);
  const body = await readBody(c);
  const next = password(body.next, 'next');
  const user = await getUser(c.var.db, s.userId);
  if (!user || !(await verifyPassword(typeof body.current === 'string' ? body.current : '', user.password_hash))) {
    throw badRequest('Your current password is not right.');
  }
  await setPassword(c.var.db, s.userId, await hashPassword(next));
  await deleteOtherSessions(c.var.db, s.userId, s.id);
  return c.body(null, 204);
});

auth.post('/auth/reset', rateLimit('AUTH_LIMITER'), async (c) => {
  const body = await readBody(c);
  const mail = email(body.email);
  const code = normalizeCode(text(body.code, 'code', 20));
  const pw = password(body.password);
  const ok = await redeemResetCode(c.var.db, {
    email: mail,
    codeHash: await sha256Hex(code),
    passwordHash: await hashPassword(pw),
  });
  if (!ok) throw badRequest('That reset code is not right, has been used, or has expired. Ask your coordinator for a new one.');
  return c.body(null, 204);
});

auth.delete('/auth/account', rateLimit('AUTH_LIMITER'), async (c) => {
  const s = requireUser(c);
  const body = await readBody(c);
  const user = await getUser(c.var.db, s.userId);
  if (!user || !(await verifyPassword(typeof body.password === 'string' ? body.password : '', user.password_hash))) {
    throw badRequest('That password is not right.');
  }
  const blocking = await blockingWorkspaces(c.var.db, s.userId);
  if (blocking.length) {
    const names = blocking.map((w) => w.name).join(', ');
    throw conflict(`You are the only coordinator of ${names}. Make someone else a coordinator first.`);
  }
  await deleteAccount(c.var.db, s.userId);
  clearSessionCookie(c);
  return c.body(null, 204);
});

auth.get('/me/follows', async (c) => c.json(await listFollows(c.var.db, requireUser(c).userId)));

auth.put('/me/follows', async (c) => {
  const s = requireUser(c);
  const { codes } = await readBody(c);
  if (!Array.isArray(codes) || codes.length > 50 || !codes.every((x) => typeof x === 'string' && x.length <= 40)) {
    throw new HttpError(400, 'bad_request', 'codes must be a list of up to 50 class codes.');
  }
  await replaceFollows(c.var.db, s.userId, [...new Set(codes.map(normalizeCode))]);
  return c.json(await listFollows(c.var.db, s.userId));
});

export default auth;
