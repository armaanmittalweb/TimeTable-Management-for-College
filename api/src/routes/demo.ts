// The demo college: a private copy per visitor, and a role switcher inside it.
// Mounted at /api.

import { Hono } from 'hono';
import { getMe, setActing } from '../data/accounts';
import { cloneDemo, deleteDemoWorkspace, DEMO, DEMO_PER_IP, recentDemoCopies } from '../data/demo';
import { getBatch, getTeacher } from '../data/setup';
import { demoWeek } from '../demo-preview';
import { mondayOf, nowIn } from '../dates';
import type { AppEnv } from '../env';
import { forbidden, HttpError, notFound } from '../http';
import { clientIp } from '../limits';
import { requireSession, startSession } from '../session';
import { sha256Hex } from '../tokens';
import { date, id, oneOf, readBody } from '../validate';

const demo = new Hono<AppEnv>();

demo.post('/demo', async (c) => {
  const ipHash = await sha256Hex(`demo:${clientIp(c)}`);
  if ((await recentDemoCopies(c.var.db, ipHash)) >= DEMO_PER_IP) {
    throw new HttpError(429, 'rate_limited', 'You have opened the demo several times in the last few minutes. Try again in ten minutes.');
  }
  // a fresh copy replaces the visitor's previous one rather than leaving it to expire
  const old = c.var.session?.demoWorkspaceId;
  if (old) await deleteDemoWorkspace(c.var.db, old);
  const monday = mondayOf(nowIn(DEMO.workspace.timezone).date);
  const copy = await cloneDemo(c.var.db, { monday, ipHash });
  await startSession(c, { demoWorkspaceId: copy.id, expiresAt: copy.expiresAt });
  return c.json(await getMe(c.var.db, { userId: null, demoWorkspaceId: copy.id, actingRole: 'coordinator', actingId: null }), 201);
});

/** The read-only demo week for the signed-out front page (no session, no database). */
demo.get('/demo/week', (c) => {
  const today = nowIn(DEMO.workspace.timezone).date;
  const start = c.req.query('start');
  const week = demoWeek(start ? date(start, 'start') : today, today, c.req.query('batch'));
  if (!week) throw notFound('The demo college has no batch by that name.');
  c.header('Cache-Control', 'public, max-age=300');
  return c.json(week);
});

demo.post('/w/:slug/demo/act-as', async (c) => {
  const session = requireSession(c);
  const ws = c.var.ws;
  if (session.demoWorkspaceId !== ws.id) throw forbidden('You can only switch roles in your own demo college.');
  const body = await readBody(c);
  const role = oneOf(body.role, 'role', ['coordinator', 'teacher', 'student'] as const);
  let actingId: number | null = null;
  if (role === 'teacher') {
    actingId = id(body.teacherId, 'teacherId');
    if (!(await getTeacher(c.var.db, ws.id, actingId))) throw notFound('No such teacher in the demo college.');
  } else if (role === 'student') {
    actingId = id(body.batchId, 'batchId');
    if (!(await getBatch(c.var.db, ws.id, actingId))) throw notFound('No such batch in the demo college.');
  }
  await setActing(c.var.db, session.id, role, actingId);
  return c.json(await getMe(c.var.db, { ...session, actingRole: role, actingId }));
});

export default demo;
