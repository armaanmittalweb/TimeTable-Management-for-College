// Calendar feeds: /ics/b/<class code>.ics for a batch (public once published), and
// /ics/f/<token>.ics for the private teacher, room and batch feeds members create.

import { Hono, type Context } from 'hono';
import { findBatchByCode } from '../data/accounts';
import { getFeed } from '../data/feeds';
import { weekRows, type Scope } from '../data/week';
import { addDays, datesBetween, isoWeekday, mondayOf, todayIn } from '../dates';
import type { AppEnv } from '../env';
import { notFound } from '../http';
import { buildCalendar } from '../ics';
import { chargeMiss } from '../limits';
import { normalizeCode } from '../tokens';
import { buildOccurrences } from '../week';

const ics = new Hono<AppEnv>();

const stripExt = (file: string) => (file.endsWith('.ics') ? file.slice(0, -4) : null);

/** Two weeks back and eight ahead, from this week's Monday. */
async function calendar(
  c: Context<AppEnv>,
  f: { workspaceId: number; timezone: string; days: number[]; name: string; scope: Scope },
) {
  const monday = mondayOf(todayIn(f.timezone));
  const from = addDays(monday, -14);
  const to = addDays(monday, 8 * 7 - 1);
  const dates = datesBetween(from, to).filter((d) => f.days.includes(isoWeekday(d)));
  const rows = await weekRows(c.var.db, f.workspaceId, from, to, f.scope);
  const body = buildCalendar({
    name: f.name,
    timezone: f.timezone,
    from,
    to,
    occurrences: buildOccurrences(rows.classes, rows.changes, dates, f.scope.roomId ?? null),
  });
  return c.body(body, 200, {
    'Content-Type': 'text/calendar; charset=utf-8',
    'Cache-Control': 'max-age=900',
  });
}

ics.get('/b/:file', async (c) => {
  const code = stripExt(c.req.param('file'));
  const b = code && code.length <= 44 ? await findBatchByCode(c.var.db, normalizeCode(code)) : null;
  if (!b) {
    await chargeMiss(c);
    throw notFound('No class uses that code.');
  }
  const w = b.followed.workspace;
  return calendar(c, {
    workspaceId: b.workspaceId,
    timezone: w.timezone,
    days: w.days,
    name: `${b.followed.batch.name} · ${w.name}`,
    scope: { batchId: b.batchId },
  });
});

ics.get('/f/:file', async (c) => {
  const token = stripExt(c.req.param('file'));
  const feed = token && token.length <= 64 ? await getFeed(c.var.db, token) : null;
  if (!feed) {
    await chargeMiss(c);
    throw notFound('This calendar link is not valid any more.');
  }
  const scope: Scope = { [`${feed.kind}Id`]: feed.targetId };
  return calendar(c, {
    workspaceId: feed.workspaceId,
    timezone: feed.timezone,
    days: feed.days,
    name: `${feed.targetName} · ${feed.workspaceName}`,
    scope,
  });
});

export default ics;
