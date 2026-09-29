import { Hono } from 'hono';
import { sign } from 'hono/jwt';
import { createUser, findUserByUsername } from '../data';
import { isDemo, jsonBody, type AppEnv } from '../env';
import { hashPassword, verifyPassword } from '../password';

const auth = new Hono<AppEnv>();
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

auth.post('/register', async (c) => {
  if (isDemo(c.env)) {
    return c.json({ error: 'Registration is disabled in the public demo' }, 403);
  }
  const body = await jsonBody(c);
  const username = str(body.username);
  const email = str(body.email);
  const password = typeof body.password === 'string' ? body.password : '';
  const role = body.role;
  const batch = str(body.batch) || null;
  if (!username || !email || password.length < 6 || (role !== 'student' && role !== 'professor')) {
    return c.json(
      { error: 'username, email, a password of 6+ characters and role (student|professor) are required' },
      400,
    );
  }
  if (role === 'student' && !batch) {
    return c.json({ error: 'Students need a batch' }, 400);
  }
  try {
    await createUser(c.var.db, { username, email, role, batch, passwordHash: await hashPassword(password) });
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      return c.json({ error: 'Username or email already exists' }, 409);
    }
    throw err;
  }
  return c.json({ message: 'User registered successfully' }, 201);
});

auth.post('/login', async (c) => {
  const body = await jsonBody(c);
  const username = str(body.username);
  const password = typeof body.password === 'string' ? body.password : '';
  if (!username || !password) return c.json({ error: 'Invalid credentials' }, 401);

  const user = await findUserByUsername(c.var.db, username);
  if (!user || !(await verifyPassword(password, user.password))) {
    return c.json({ error: 'Invalid credentials' }, 401);
  }
  const now = Math.floor(Date.now() / 1000);
  const token = await sign(
    { id: user.id, role: user.role, batch: user.batch, iat: now, exp: now + 24 * 60 * 60 },
    c.env.JWT_SECRET,
    'HS256',
  );
  return c.json({ token });
});

export default auth;
