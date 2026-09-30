// The live timetable: weeks, today, changes, free rooms, reschedule slots, and
// per-occurrence cancel / move / undo. Mounted at /api.

import { Hono, type Context } from 'hono';
import { actorName, requireOwnClass, requireStaff } from '../access';
import { clashError } from '../clash';
import type { SlotAvailability } from '../contract';
import { bookingsBetween, freeRooms } from '../data/bookings';
import {
  cancelOccurrence,
  getChangeRef,
  getClassRef,
  listChanges,
  moveOccurrence,
  undoChange,
  type ChangeResult,
  type ClassRef,
} from '../data/changes';
import { findOrCreateFeed } from '../data/feeds';
import { getBatch, getRoom, getTeacher, listRooms } from '../data/setup';
import { getPeriods, weekRows, type Scope } from '../data/week';
import { addDays, isoWeekday, nowIn, shortDate } from '../dates';
import type { AppEnv, WorkspaceCtx } from '../env';
import { badRequest, conflict, notFound } from '../http';
import { isFree, slotAvailability } from '../slots';
import { randomToken } from '../tokens';
import { date, id, oneOf, optId, optText, pathId, readBody, time } from '../validate';
import { assembleWeek, buildOccurrences, weekFrame } from '../week';

const timetable = new Hono<AppEnv>();

const optDate = (v: string | undefined, field: string) => (v === undefined || v === '' ? null : date(v, field));

function scopeOf(c: Context<AppEnv>): Scope {
  const q = (k: string) => c.req.query(k);
  const scope = { batchId: optId(q('batch'), 'batch'), teacherId: optId(q('teacher'), 'teacher'), roomId: optId(q('room'), 'room') };
  if ([scope.batchId, scope.teacherId, scope.roomId].filter((x) => x !== null).length > 1) {
    throw badRequest('Filter by one of batch, teacher or room.');
  }
  return scope;
}

timetable.get('/w/:slug/week', async (c) => {
  const ws = c.var.ws;
  const scope = scopeOf(c);
  const now = nowIn(ws.timezone);
  const frame = weekFrame(optDate(c.req.query('start'), 'start') ?? now.date, ws.days);
  const [rows, periods] = await Promise.all([
    weekRows(c.var.db, ws.id, frame.start, frame.end, scope),
    getPeriods(c.var.db, ws.id),
  ]);
  return c.json(assembleWeek(frame, rows, { timezone: ws.timezone, periods, today: now.date, roomId: scope.roomId }));
});

timetable.get('/w/:slug/today', async (c) => {
  const ws = c.var.ws;
  const scope = scopeOf(c);
  const today = nowIn(ws.timezone).date;
  const rows = await weekRows(c.var.db, ws.id, today, today, scope);
  return c.json(buildOccurrences(rows.classes, rows.changes, [today], scope.roomId));
});

timetable.get('/w/:slug/changes', async (c) => {
  const ws = c.var.ws;
  const from = optDate(c.req.query('start'), 'start') ?? addDays(nowIn(ws.timezone).date, -14);
  const to = optDate(c.req.query('end'), 'end');
  if (to && to < from) throw badRequest('end must not be before start.');
  return c.json(await listChanges(c.var.db, ws.id, { from, to }));
});

timetable.get('/w/:slug/free-rooms', async (c) => {
  const q = (k: string) => c.req.query(k);
  const slot = { date: date(q('date'), 'date'), start: time(q('start'), 'start'), end: time(q('end'), 'end') };
  if (slot.end <= slot.start) throw badRequest('end must be after start.');
  return c.json(await freeRooms(c.var.db, c.var.ws.id, slot, optId(q('exclude'), 'exclude')));
});

// ---------------------------------------------------------------- reschedule

async function loadClass(c: Context<AppEnv>): Promise<ClassRef> {
  const cls = await getClassRef(c.var.db, c.var.ws.id, pathId(c));
  if (!cls) throw notFound('No such class in this workspace.');
  return cls;
}

/** Every slot of the week containing `weekDate` where this class could go, from now on. */
async function weekSlots(
  c: Context<AppEnv>,
  ws: WorkspaceCtx,
  cls: ClassRef,
  weekDate: string,
  exclude: { classId: number; occursOn: string } | null,
): Promise<SlotAvailability[]> {
  const frame = weekFrame(weekDate, ws.days);
  const db = c.var.db;
  const [bookings, rooms, periods, batch] = await Promise.all([
    bookingsBetween(db, ws.id, frame.start, frame.end),
    listRooms(db, ws.id),
    getPeriods(db, ws.id),
    getBatch(db, ws.id, cls.batchId),
  ]);
  return slotAvailability({
    cls,
    exclude,
    dates: frame.days,
    periods,
    bookings,
    rooms,
    batchSize: batch?.size ?? null,
    now: nowIn(ws.timezone),
  });
}

timetable.get('/w/:slug/classes/:id/slots', async (c) => {
  const ws = requireStaff(c);
  const cls = await loadClass(c);
  const weekDate = optDate(c.req.query('week'), 'week') ?? nowIn(ws.timezone).date;
  const from = optDate(c.req.query('from'), 'from');
  return c.json(await weekSlots(c, ws, cls, weekDate, from ? { classId: cls.id, occursOn: from } : null));
});

/** The occurrence must be one this class really has, today or later. */
function checkOccurrence(ws: WorkspaceCtx, cls: ClassRef, occursOn: string) {
  if (isoWeekday(occursOn) !== cls.day) throw badRequest(`This class does not meet on ${shortDate(occursOn)}.`);
  if (occursOn < nowIn(ws.timezone).date) throw badRequest('That class has already happened.');
}

function refusal(r: Exclude<ChangeResult, { status: 'ok' | 'clash' }>): never {
  switch (r.status) {
    case 'not_found':
      throw notFound('No such class in this workspace.');
    case 'room_not_found':
      throw badRequest('That room is not in this workspace.');
    case 'already_changed':
      throw conflict('This class has already been changed on that day. Undo that change first.');
  }
}

timetable.post('/w/:slug/classes/:id/cancel', async (c) => {
  const ws = requireStaff(c);
  const cls = await loadClass(c);
  requireOwnClass(ws, cls.teacherId);
  const body = await readBody(c);
  const occursOn = date(body.date, 'date');
  checkOccurrence(ws, cls, occursOn);
  const result = await cancelOccurrence(c.var.db, {
    workspaceId: ws.id,
    classId: cls.id,
    occursOn,
    reason: optText(body.reason, 'reason', 300),
    by: await actorName(c, c.var.db),
  });
  if (result.status === 'clash') throw clashError(result.clashes);
  if (result.status !== 'ok') refusal(result);
  return c.json(result.change, 201);
});

timetable.post('/w/:slug/classes/:id/move', async (c) => {
  const ws = requireStaff(c);
  const cls = await loadClass(c);
  requireOwnClass(ws, cls.teacherId);
  const body = await readBody(c);
  const occursOn = date(body.date, 'date');
  const toDate = date(body.toDate, 'toDate');
  const toStart = time(body.toStart, 'toStart');
  const toEnd = time(body.toEnd, 'toEnd');
  const roomId = id(body.roomId, 'roomId');
  checkOccurrence(ws, cls, occursOn);
  if (toEnd <= toStart) throw badRequest('toEnd must be after toStart.');
  const now = nowIn(ws.timezone);
  if (toDate < now.date || (toDate === now.date && toStart < now.time)) throw badRequest('You cannot move a class into the past.');
  if (!ws.days.includes(isoWeekday(toDate))) throw badRequest(`${shortDate(toDate)} is not a teaching day here.`);

  const result = await moveOccurrence(c.var.db, {
    workspaceId: ws.id,
    classId: cls.id,
    occursOn,
    toDate,
    toStart,
    toEnd,
    roomId,
    reason: optText(body.reason, 'reason', 300),
    by: await actorName(c, c.var.db),
  });
  if (result.status === 'clash') {
    const exclude = { classId: cls.id, occursOn };
    const slots = await weekSlots(c, ws, cls, toDate, exclude);
    const suggestion = slots.find((s) => isFree(s) && (s.date > toDate || (s.date === toDate && s.start >= toStart))) ?? null;
    throw clashError(result.clashes, suggestion);
  }
  if (result.status !== 'ok') refusal(result);
  return c.json(result.change, 201);
});

timetable.delete('/w/:slug/changes/:id', async (c) => {
  const ws = requireStaff(c);
  const ref = await getChangeRef(c.var.db, ws.id, pathId(c));
  if (!ref) throw notFound('No such change in this workspace.');
  requireOwnClass(ws, ref.teacherId);
  const result = await undoChange(c.var.db, ws.id, ref.id);
  if (result.status === 'not_found') throw notFound('No such change in this workspace.');
  if (result.status === 'clash') throw clashError(result.clashes);
  return c.body(null, 204);
});

// ---------------------------------------------------------------- calendar feeds

timetable.post('/w/:slug/feeds', async (c) => {
  const ws = c.var.ws;
  const body = await readBody(c);
  const kind = oneOf(body.kind, 'kind', ['batch', 'teacher', 'room'] as const);
  const targetId = id(body.targetId, 'targetId');
  const get = { batch: getBatch, teacher: getTeacher, room: getRoom }[kind];
  if (!(await get(c.var.db, ws.id, targetId))) throw badRequest(`That ${kind} is not in this workspace.`);
  const token = await findOrCreateFeed(c.var.db, {
    workspaceId: ws.id,
    kind,
    targetId,
    userId: c.var.session?.userId ?? null,
    token: randomToken(24),
  });
  return c.json({ url: `${new URL(c.req.url).origin}/ics/f/${token}.ics` });
});

export default timetable;
