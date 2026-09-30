// Students without an account: a class code opens that batch's week, today and
// changes once the workspace is published. Also /api/join, which takes either a
// class code or a teacher/coordinator invite. Mounted at /api.

import { Hono, type Context } from 'hono';
import { findBatchByCode, type PublicBatch } from '../data/accounts';
import { listChanges } from '../data/changes';
import { weekRows } from '../data/week';
import { redeemInvite } from '../data/workspaces';
import { addDays, nowIn } from '../dates';
import type { AppEnv } from '../env';
import { conflict, notFound } from '../http';
import { rateLimit } from '../limits';
import { requireUser } from '../session';
import { normalizeCode } from '../tokens';
import { date, readBody, text } from '../validate';
import { assembleWeek, buildOccurrences, weekFrame } from '../week';

const pub = new Hono<AppEnv>();

pub.use('/public/*', rateLimit('PUBLIC_LIMITER'));
pub.use('/join', rateLimit('PUBLIC_LIMITER'));

async function batchFromCode(c: Context<AppEnv>, raw: string): Promise<PublicBatch> {
  const code = normalizeCode(raw);
  const found = code.length <= 40 ? await findBatchByCode(c.var.db, code) : null;
  if (!found) throw notFound('No class uses that code. Check it with your coordinator.');
  return found;
}

pub.get('/public/:code', async (c) => c.json((await batchFromCode(c, c.req.param('code'))).followed));

pub.get('/public/:code/week', async (c) => {
  const b = await batchFromCode(c, c.req.param('code'));
  const { timezone, days } = b.followed.workspace;
  const now = nowIn(timezone);
  const start = c.req.query('start');
  const frame = weekFrame(start ? date(start, 'start') : now.date, days);
  const rows = await weekRows(c.var.db, b.workspaceId, frame.start, frame.end, { batchId: b.batchId });
  return c.json(assembleWeek(frame, rows, { timezone, periods: b.followed.periods, today: now.date }));
});

pub.get('/public/:code/today', async (c) => {
  const b = await batchFromCode(c, c.req.param('code'));
  const today = nowIn(b.followed.workspace.timezone).date;
  const rows = await weekRows(c.var.db, b.workspaceId, today, today, { batchId: b.batchId });
  return c.json(buildOccurrences(rows.classes, rows.changes, [today]));
});

pub.get('/public/:code/changes', async (c) => {
  const b = await batchFromCode(c, c.req.param('code'));
  const from = addDays(nowIn(b.followed.workspace.timezone).date, -14);
  return c.json(await listChanges(c.var.db, b.workspaceId, { from, to: null, batchId: b.batchId }));
});

pub.post('/join', async (c) => {
  const code = normalizeCode(text((await readBody(c)).code, 'code', 40));
  if (!code.startsWith('INV-')) return c.json((await batchFromCode(c, code)).followed);

  const s = requireUser(c);
  const result = await redeemInvite(c.var.db, code, s.userId);
  switch (result.status) {
    case 'ok':
      return c.json({ workspace: result.workspace });
    case 'not_found':
      throw notFound('That invite is not valid any more. Ask your coordinator for a new one.');
    case 'member':
      throw conflict(`You are already a member of ${result.name}.`);
    case 'teacher_taken':
      throw conflict('Someone has already joined as that teacher. Ask your coordinator.');
  }
});

export default pub;
