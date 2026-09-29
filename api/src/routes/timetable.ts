import { Hono, type Context } from 'hono';
import { availableRooms, cancelClass, getClass, getTimetable, postponeClass, type ChangeResult } from '../data';
import { endOfWeek, isDate, isTime, normalizeTime } from '../dates';
import { jsonBody, toId, type AppEnv } from '../env';
import { authenticateToken, isProfessor } from '../middleware/auth';
import { sandbox } from '../middleware/sandbox';

const timetable = new Hono<AppEnv>();
timetable.use('*', sandbox, authenticateToken);

const later = (a: string, b: string) => (a > b ? a : b);

/** Maps a data-layer refusal to its HTTP response. */
function refusal(c: Context<AppEnv>, r: Exclude<ChangeResult, { status: 'ok' }>) {
  switch (r.status) {
    case 'class_not_found':
      return c.json({ error: 'Invalid class' }, 400);
    case 'room_not_found':
      return c.json({ error: 'Invalid classroom' }, 400);
    case 'forbidden':
      return c.json({ error: 'You can only change your own classes' }, 403);
    case 'already_modified':
      return c.json({ error: 'This class already has an active cancellation or postponement' }, 409);
    case 'clash': {
      const messages: string[] = [];
      if (r.clashes.some((x) => x.type === 'room')) {
        messages.push('Selected room is not available for the chosen time slot');
      }
      if (r.clashes.some((x) => x.type === 'professor')) {
        messages.push('Professor has a scheduling conflict during this time');
      }
      return c.json({ error: messages.join('; '), clashes: r.clashes }, 409);
    }
  }
}

timetable.get('/timetable', async (c) => {
  return c.json(await getTimetable(c.var.db, c.var.user, c.var.today, c.var.sandboxId));
});

timetable.post('/cancel-class', isProfessor, async (c) => {
  const classId = toId((await jsonBody(c)).classId);
  if (!classId) return c.json({ error: 'Invalid class' }, 400);
  const result = await cancelClass(c.var.db, {
    classId,
    professorId: c.var.user.id,
    validUntil: endOfWeek(c.var.today),
    today: c.var.today,
    sandboxId: c.var.sandboxId,
  });
  if (result.status !== 'ok') return refusal(c, result);
  return c.json({ message: 'Class cancelled successfully' });
});

timetable.get('/class/:id', async (c) => {
  const classId = toId(c.req.param('id'));
  const rows = classId ? await getClass(c.var.db, classId) : [];
  if (rows.length === 0) return c.json({ error: 'Class not found' }, 404);
  return c.json(rows);
});

timetable.post('/available-rooms', async (c) => {
  const { date, startTime, endTime, classId } = await jsonBody(c);
  if (!isDate(date) || !isTime(startTime) || !isTime(endTime)) {
    return c.json({ error: 'date (YYYY-MM-DD), startTime and endTime (HH:MM) are required' }, 400);
  }
  if (normalizeTime(endTime) <= normalizeTime(startTime)) {
    return c.json({ error: 'endTime must be after startTime' }, 400);
  }
  return c.json(await availableRooms(c.var.db, { date, startTime, endTime }, c.var.sandboxId, toId(classId)));
});

/**
 * postpone-class and confirm-postpone (an unused duplicate in the Express app
 * that skipped every clash check) share one checked, transactional path.
 */
function postponeRoute(message: string, defaultValidUntil: (today: string) => string) {
  return async (c: Context<AppEnv>) => {
    const body = await jsonBody(c);
    const classId = toId(body.classId);
    const newClassroomId = toId(body.newClassroomId);
    const { newDate, newStartTime, newEndTime, validUntil } = body;
    const today = c.var.today;

    if (!classId || !newClassroomId || !isDate(newDate) || !isTime(newStartTime) || !isTime(newEndTime)) {
      return c.json({ error: 'Missing required fields' }, 400);
    }
    if (normalizeTime(newEndTime) <= normalizeTime(newStartTime)) {
      return c.json({ error: 'newEndTime must be after newStartTime' }, 400);
    }
    if (newDate < today) {
      return c.json({ error: 'newDate cannot be in the past' }, 400);
    }
    if (validUntil != null && !isDate(validUntil)) {
      return c.json({ error: 'validUntil must be YYYY-MM-DD' }, 400);
    }

    const result = await postponeClass(c.var.db, {
      classId,
      professorId: c.var.user.id,
      newDate,
      newStartTime,
      newEndTime,
      newClassroomId,
      // never let the overlay expire before the moved class has taken place
      validUntil: later(isDate(validUntil) ? validUntil : defaultValidUntil(today), newDate),
      today,
      sandboxId: c.var.sandboxId,
    });
    if (result.status !== 'ok') return refusal(c, result);
    return c.json({ message, id: result.id }, 201);
  };
}

timetable.post('/postpone-class', isProfessor, postponeRoute('Class successfully postponed', (today) => today));
timetable.post('/confirm-postpone', isProfessor, postponeRoute('Class postponed successfully', endOfWeek));

export default timetable;
