// Creating a workspace, its settings, publishing, periods, members and invites.
// Mounted at /api; /w/:slug/* has already been resolved by workspaceMiddleware.

import { Hono } from 'hono';
import { requireCoordinator } from '../access';
import type { Period } from '../contract';
import { createResetCode } from '../data/accounts';
import { getPeriods } from '../data/week';
import {
  changeMember,
  createInvite,
  createWorkspace,
  getSummary,
  getWorkspaceFull,
  isMember,
  listMembers,
  replacePeriods,
  setPublished,
  slugTaken,
  updateWorkspace,
} from '../data/workspaces';
import { isTimeZone } from '../dates';
import type { AppEnv } from '../env';
import { badRequest, conflict, notFound } from '../http';
import { requireUser } from '../session';
import { inviteCode, randomCode, resetCode, sha256Hex } from '../tokens';
import { id, oneOf, optId, optText, pathId, readArray, readBody, text, time } from '../validate';

const workspaces = new Hono<AppEnv>();

function slugify(name: string) {
  const s = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  return s || 'workspace';
}

function timezone(v: unknown): string {
  if (!isTimeZone(v)) throw badRequest('timezone must be an IANA zone like Asia/Kolkata.');
  return v;
}

function days(v: unknown): number[] {
  if (!Array.isArray(v) || !v.length || !v.every((d) => Number.isInteger(d) && d >= 1 && d <= 7)) {
    throw badRequest('days must be a list of weekdays from 1 (Monday) to 7 (Sunday).');
  }
  return [...new Set(v as number[])].sort();
}

function periods(list: unknown[]): Period[] {
  if (!list.length || list.length > 24) throw badRequest('Give between 1 and 24 periods.');
  const parsed = list.map((p, i) => {
    if (!p || typeof p !== 'object') throw badRequest(`Period ${i + 1} must be an object.`);
    const o = p as Record<string, unknown>;
    const start = time(o.start, `Period ${i + 1} start`);
    const end = time(o.end, `Period ${i + 1} end`);
    if (end <= start) throw badRequest(`Period ${i + 1} must end after it starts.`);
    return { start, end, label: optText(o.label, 'label', 40), isBreak: o.isBreak === true };
  });
  parsed.sort((a, b) => a.start.localeCompare(b.start));
  for (let i = 1; i < parsed.length; i++) {
    if (parsed[i].start < parsed[i - 1].end) {
      throw badRequest(`Periods ${parsed[i - 1].start}-${parsed[i - 1].end} and ${parsed[i].start}-${parsed[i].end} overlap.`);
    }
  }
  return parsed.map((p, i) => ({ idx: i + 1, ...p }));
}

workspaces.post('/workspaces', async (c) => {
  const s = requireUser(c);
  const body = await readBody(c);
  const name = text(body.name, 'name', 80);
  const institution = text(body.institution, 'institution', 120);
  const tz = body.timezone === undefined ? 'Asia/Kolkata' : timezone(body.timezone);
  let slug = slugify(name);
  if (await slugTaken(c.var.db, slug)) slug = `${slug}-${randomCode(4).toLowerCase()}`;
  const summary = await createWorkspace(c.var.db, { slug, name, institution, timezone: tz, userId: s.userId });
  if (!summary) throw conflict('You can create up to 5 workspaces. Delete one you no longer use first.');
  return c.json(summary, 201);
});

workspaces.get('/w/:slug', async (c) => c.json(await getWorkspaceFull(c.var.db, c.var.ws)));

workspaces.patch('/w/:slug', async (c) => {
  const ws = requireCoordinator(c);
  const body = await readBody(c);
  await updateWorkspace(c.var.db, ws.id, {
    name: body.name === undefined ? undefined : text(body.name, 'name', 80),
    institution: body.institution === undefined ? undefined : text(body.institution, 'institution', 120),
    timezone: body.timezone === undefined ? undefined : timezone(body.timezone),
    days: body.days === undefined ? undefined : days(body.days),
  });
  return c.json(await getSummary(c.var.db, ws.id));
});

workspaces.post('/w/:slug/publish', async (c) => {
  const ws = requireCoordinator(c);
  await setPublished(c.var.db, ws.id, true);
  return c.json(await getSummary(c.var.db, ws.id));
});

workspaces.post('/w/:slug/unpublish', async (c) => {
  const ws = requireCoordinator(c);
  await setPublished(c.var.db, ws.id, false);
  return c.json(await getSummary(c.var.db, ws.id));
});

workspaces.get('/w/:slug/periods', async (c) => c.json(await getPeriods(c.var.db, c.var.ws.id)));

workspaces.put('/w/:slug/periods', async (c) => {
  const ws = requireCoordinator(c);
  const list = periods(await readArray(c));
  await c.var.db.transaction((tx) => replacePeriods(tx, ws.id, list));
  return c.json(list);
});

// ---------------------------------------------------------------- members

workspaces.get('/w/:slug/members', async (c) => {
  const ws = requireCoordinator(c);
  return c.json(await listMembers(c.var.db, ws.id));
});

const memberRefusal = (r: string) => {
  if (r === 'not_found') throw notFound('That person is not a member of this workspace.');
  if (r === 'last_coordinator') throw conflict('A workspace needs at least one coordinator. Make someone else a coordinator first.');
};

workspaces.delete('/w/:slug/members/:userId', async (c) => {
  const ws = requireCoordinator(c);
  memberRefusal(await changeMember(c.var.db, ws.id, pathId(c, 'userId'), null));
  return c.body(null, 204);
});

workspaces.patch('/w/:slug/members/:userId', async (c) => {
  const ws = requireCoordinator(c);
  const role = oneOf((await readBody(c)).role, 'role', ['coordinator', 'teacher'] as const);
  memberRefusal(await changeMember(c.var.db, ws.id, pathId(c, 'userId'), role));
  const member = (await listMembers(c.var.db, ws.id)).find((m) => m.userId === Number(c.req.param('userId')));
  return c.json(member);
});

workspaces.post('/w/:slug/invites', async (c) => {
  const ws = requireCoordinator(c);
  if (ws.isDemo) throw badRequest('Invites do not work in the demo college. Create your own workspace to invite people.');
  const body = await readBody(c);
  const role = oneOf(body.role, 'role', ['coordinator', 'teacher'] as const);
  const teacherId = role === 'teacher' ? id(body.teacherId, 'teacherId') : optId(body.teacherId, 'teacherId');
  if (teacherId !== null) {
    const [t] = await c.var.db.query<{ taken: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM members m WHERE m.teacher_id = t.id) AS taken
         FROM teachers t WHERE t.workspace_id = $1 AND t.id = $2`,
      [ws.id, teacherId],
    );
    if (!t) throw badRequest('That teacher is not in this workspace.');
    if (t.taken) throw conflict('That teacher already has an account here.');
  }
  const code = inviteCode();
  const expiresAt = await createInvite(c.var.db, { code, workspaceId: ws.id, role, teacherId, userId: c.var.session!.userId });
  return c.json({ code, expiresAt }, 201);
});

workspaces.post('/w/:slug/members/:userId/reset-code', async (c) => {
  const ws = requireCoordinator(c);
  const userId = pathId(c, 'userId');
  if (!(await isMember(c.var.db, ws.id, userId))) throw notFound('That person is not a member of this workspace.');
  const code = resetCode();
  const expiresAt = await createResetCode(c.var.db, { codeHash: await sha256Hex(code), userId, workspaceId: ws.id });
  return c.json({ code, expiresAt }, 201);
});

export default workspaces;
