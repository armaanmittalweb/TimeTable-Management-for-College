// Setup CRUD: rooms, teachers, batches, courses, classes; CSV import. Mounted at /api.
// Reads are open to any member; writes are coordinator-only.

import { Hono, type Context } from 'hono';
import { requireCoordinator } from '../access';
import { clashError } from '../clash';
import type { ClassRow } from '../contract';
import {
  countOf,
  deleteRow,
  getBatch,
  getClassRow,
  getCourse,
  getRoom,
  getTeacher,
  insertBatch,
  insertCourse,
  insertRoom,
  insertTeacher,
  listBatches,
  listClasses,
  listCourses,
  listRooms,
  listTeachers,
  refsExist,
  setBatchCode,
  updateBatch,
  updateCourse,
  updateRoom,
  updateTeacher,
  usage,
  writeClass,
  type Kind,
} from '../data/setup';
import { todayIn } from '../dates';
import type { AppEnv } from '../env';
import { badRequest, conflict, isUniqueViolation, notFound } from '../http';
import { runImport, template } from '../importer';
import { LIMITS } from '../limits';
import { parseBatch, parseClassTimes, parseCourse, parseRoom, parseTeacher } from '../parse';
import { batchCode } from '../tokens';
import { bool, id, oneOf, optId, pathId, readBody, text } from '../validate';

const setup = new Hono<AppEnv>();

const NOUN: Record<Kind, [string, string]> = {
  rooms: ['room', 'rooms'],
  teachers: ['teacher', 'teachers'],
  batches: ['batch', 'batches'],
  courses: ['course', 'courses'],
  classes: ['class', 'classes'],
};

async function underLimit(c: Context<AppEnv>, kind: Kind) {
  if ((await countOf(c.var.db, kind, c.var.ws.id)) >= LIMITS[kind]) {
    throw conflict(`A workspace can have at most ${LIMITS[kind]} ${NOUN[kind][1]}.`);
  }
}

/** Runs a write; a duplicate name becomes a 409 that says which. */
async function unique<T>(what: string, write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict(`There is already ${what}.`);
    throw err;
  }
}

const found = <T>(row: T | null, kind: Kind): T => {
  if (!row) throw notFound(`No such ${NOUN[kind][0]} in this workspace.`);
  return row;
};

async function deleteChecked(c: Context<AppEnv>, kind: Exclude<Kind, 'classes'>, label: (id: number) => Promise<string | null>) {
  const ws = requireCoordinator(c);
  const rowId = pathId(c);
  const name = found(await label(rowId), kind);
  const used = await usage(c.var.db, kind, ws.id, rowId);
  if (used.total) {
    const more = used.total > used.examples.length ? `, and ${used.total - used.examples.length} more` : '';
    throw conflict(
      `${name} is used by ${used.total} ${used.total === 1 ? 'class' : 'classes'} (${used.examples.join('; ')}${more}). Move or delete those first.`,
    );
  }
  if (!(await deleteRow(c.var.db, kind, ws.id, rowId))) throw notFound();
  return c.body(null, 204);
}

// ---------------------------------------------------------------- rooms

setup.get('/w/:slug/rooms', async (c) => c.json(await listRooms(c.var.db, c.var.ws.id)));

setup.post('/w/:slug/rooms', async (c) => {
  const ws = requireCoordinator(c);
  const room = parseRoom(await readBody(c));
  await underLimit(c, 'rooms');
  return c.json(await unique(`a room called ${room.name}`, () => insertRoom(c.var.db, ws.id, room)), 201);
});

setup.patch('/w/:slug/rooms/:id', async (c) => {
  const ws = requireCoordinator(c);
  const before = found(await getRoom(c.var.db, ws.id, pathId(c)), 'rooms');
  const room = parseRoom({ ...before, ...(await readBody(c)) });
  return c.json(await unique(`a room called ${room.name}`, () => updateRoom(c.var.db, ws.id, before.id, room)));
});

setup.delete('/w/:slug/rooms/:id', (c) =>
  deleteChecked(c, 'rooms', async (rowId) => (await getRoom(c.var.db, c.var.ws.id, rowId))?.name ?? null),
);

// ---------------------------------------------------------------- teachers

setup.get('/w/:slug/teachers', async (c) => c.json(await listTeachers(c.var.db, c.var.ws.id)));

setup.post('/w/:slug/teachers', async (c) => {
  const ws = requireCoordinator(c);
  const teacher = parseTeacher(await readBody(c));
  await underLimit(c, 'teachers');
  return c.json(await unique(`a teacher with initials ${teacher.short}`, () => insertTeacher(c.var.db, ws.id, teacher)), 201);
});

setup.patch('/w/:slug/teachers/:id', async (c) => {
  const ws = requireCoordinator(c);
  const before = found(await getTeacher(c.var.db, ws.id, pathId(c)), 'teachers');
  const teacher = parseTeacher({ ...before, ...(await readBody(c)) });
  return c.json(await unique(`a teacher with initials ${teacher.short}`, () => updateTeacher(c.var.db, ws.id, before.id, teacher)));
});

setup.delete('/w/:slug/teachers/:id', (c) =>
  deleteChecked(c, 'teachers', async (rowId) => (await getTeacher(c.var.db, c.var.ws.id, rowId))?.name ?? null),
);

// ---------------------------------------------------------------- batches

setup.get('/w/:slug/batches', async (c) => c.json(await listBatches(c.var.db, c.var.ws.id)));

/** Retries the rare collision between two random class codes. */
async function withFreshCode<T>(write: (code: string) => Promise<T>, name: string): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await write(batchCode(name));
    } catch (err) {
      if (!isUniqueViolation(err, 'batches_code_key') || attempt >= 3) throw err;
    }
  }
}

setup.post('/w/:slug/batches', async (c) => {
  const ws = requireCoordinator(c);
  const batch = parseBatch(await readBody(c));
  await underLimit(c, 'batches');
  const exists = await c.var.db.query(`SELECT 1 FROM batches WHERE workspace_id = $1 AND name = $2`, [ws.id, batch.name]);
  if (exists.length) throw conflict(`There is already a batch called ${batch.name}.`);
  return c.json(await withFreshCode((code) => insertBatch(c.var.db, ws.id, { ...batch, code }), batch.name), 201);
});

setup.patch('/w/:slug/batches/:id', async (c) => {
  const ws = requireCoordinator(c);
  const before = found(await getBatch(c.var.db, ws.id, pathId(c)), 'batches');
  const batch = parseBatch({ ...before, ...(await readBody(c)) });
  return c.json(await unique(`a batch called ${batch.name}`, () => updateBatch(c.var.db, ws.id, before.id, batch)));
});

setup.post('/w/:slug/batches/:id/code', async (c) => {
  const ws = requireCoordinator(c);
  const before = found(await getBatch(c.var.db, ws.id, pathId(c)), 'batches');
  return c.json(await withFreshCode((code) => setBatchCode(c.var.db, ws.id, before.id, code), before.name));
});

setup.delete('/w/:slug/batches/:id', (c) =>
  deleteChecked(c, 'batches', async (rowId) => (await getBatch(c.var.db, c.var.ws.id, rowId))?.name ?? null),
);

// ---------------------------------------------------------------- courses

setup.get('/w/:slug/courses', async (c) => c.json(await listCourses(c.var.db, c.var.ws.id)));

async function courseTeacher(c: Context<AppEnv>, v: unknown): Promise<number | null> {
  const teacherId = optId(v, 'teacherId');
  if (teacherId !== null && !(await getTeacher(c.var.db, c.var.ws.id, teacherId))) {
    throw badRequest('That teacher is not in this workspace.');
  }
  return teacherId;
}

setup.post('/w/:slug/courses', async (c) => {
  const ws = requireCoordinator(c);
  const body = await readBody(c);
  const count = await countOf(c.var.db, 'courses', ws.id);
  const course = { ...parseCourse(body, (count % 8) + 1), teacherId: await courseTeacher(c, body.teacherId) };
  await underLimit(c, 'courses');
  return c.json(await unique(`a course with code ${course.code}`, () => insertCourse(c.var.db, ws.id, course)), 201);
});

setup.patch('/w/:slug/courses/:id', async (c) => {
  const ws = requireCoordinator(c);
  const before = found(await getCourse(c.var.db, ws.id, pathId(c)), 'courses');
  const body = { ...before, ...(await readBody(c)) };
  const course = { ...parseCourse(body, before.color), teacherId: await courseTeacher(c, body.teacherId) };
  return c.json(await unique(`a course with code ${course.code}`, () => updateCourse(c.var.db, ws.id, before.id, course)));
});

setup.delete('/w/:slug/courses/:id', (c) =>
  deleteChecked(c, 'courses', async (rowId) => (await getCourse(c.var.db, c.var.ws.id, rowId))?.code ?? null),
);

// ---------------------------------------------------------------- classes

setup.get('/w/:slug/classes', async (c) => c.json(await listClasses(c.var.db, c.var.ws.id)));

/** A full class from a body (merged over the current row for PATCH); the teacher defaults to the course's. */
async function parseClass(c: Context<AppEnv>, o: Record<string, unknown>): Promise<Omit<ClassRow, 'id'>> {
  const ws = c.var.ws;
  const courseId = id(o.courseId, 'courseId');
  let teacherId = optId(o.teacherId, 'teacherId');
  if (teacherId === null) {
    teacherId = (await getCourse(c.var.db, ws.id, courseId))?.teacherId ?? null;
    if (teacherId === null) throw badRequest('Pick a teacher: this course has no usual teacher.');
  }
  const row = { courseId, batchId: id(o.batchId, 'batchId'), teacherId, roomId: id(o.roomId, 'roomId'), ...parseClassTimes(o) };
  const missing = await refsExist(c.var.db, ws.id, row);
  if (missing) throw badRequest(`That ${missing} is not in this workspace.`);
  return row;
}

async function saveClass(c: Context<AppEnv>, classId: number | null, row: Omit<ClassRow, 'id'>) {
  const ws = c.var.ws;
  const result = await writeClass(c.var.db, ws.id, classId, row, todayIn(ws.timezone));
  if (result.status === 'not_found') throw notFound('No such class in this workspace.');
  if (result.status === 'clash') throw clashError(result.clashes);
  return result.row;
}

setup.post('/w/:slug/classes', async (c) => {
  requireCoordinator(c);
  const row = await parseClass(c, await readBody(c));
  await underLimit(c, 'classes');
  return c.json(await saveClass(c, null, row), 201);
});

setup.patch('/w/:slug/classes/:id', async (c) => {
  const ws = requireCoordinator(c);
  const before = found(await getClassRow(c.var.db, ws.id, pathId(c)), 'classes');
  const row = await parseClass(c, { ...before, ...(await readBody(c)) });
  return c.json(await saveClass(c, before.id, row));
});

setup.delete('/w/:slug/classes/:id', async (c) => {
  const ws = requireCoordinator(c);
  if (!(await deleteRow(c.var.db, 'classes', ws.id, pathId(c)))) throw notFound('No such class in this workspace.');
  return c.body(null, 204);
});

// ---------------------------------------------------------------- CSV import

const KINDS = ['rooms', 'teachers', 'batches', 'courses', 'classes'] as const;

setup.post('/w/:slug/import', async (c) => {
  const ws = requireCoordinator(c);
  const body = await readBody(c);
  const kind = oneOf(body.kind, 'kind', KINDS);
  const csv = text(body.csv, 'csv', 512 * 1024);
  const dryRun = bool(body.dryRun, 'dryRun');
  return c.json(await runImport(c.var.db, ws, kind, csv, dryRun));
});

setup.get('/w/:slug/import/template/:kind', (c) => {
  const kind = c.req.param('kind').replace(/\.csv$/, '');
  if (!(KINDS as readonly string[]).includes(kind)) throw notFound('There is no template of that kind.');
  return c.body(template(kind as Kind), 200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${kind}.csv"`,
  });
});

export default setup;
