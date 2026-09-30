// CSV import. Every row is checked first; if any row fails nothing is written and the
// report lists each problem by line. Existing rows are matched by their natural key
// (room name, teacher initials, batch name, course code; case-insensitive) and
// updated; a class identical to an existing one is left alone, so re-importing the
// same file is harmless.

import type { ImportReport } from './contract';
import { csvCell, CsvError, parseCsv, type CsvRecord } from './csv';
import type { Db, Queryable } from './db';
import { bulkInsert, bulkUpdate, existingClasses, existingRows, type Column, type Named, type WeeklyClass } from './data/imports';
import { countOf, type Kind } from './data/setup';
import { LOCK } from './data/sql';
import { dayName, parseDay } from './dates';
import type { WorkspaceCtx } from './env';
import { HttpError } from './http';
import { LIMITS } from './limits';
import { parseBatch, parseClassTimes, parseCourse, parseRoom, parseTeacher } from './parse';
import { batchCode } from './tokens';

type Errors = ImportReport['errors'];

const COLUMNS: Record<Kind, { required: string[]; optional: string[] }> = {
  rooms: { required: ['name', 'capacity'], optional: ['building', 'kind'] },
  teachers: { required: ['name'], optional: ['short', 'email'] },
  batches: { required: ['name'], optional: ['size'] },
  courses: { required: ['code', 'name'], optional: ['teacher', 'color'] },
  classes: { required: ['day', 'start', 'end', 'course', 'batch', 'room'], optional: ['teacher'] },
};

const TEMPLATES: Record<Kind, string[][]> = {
  rooms: [
    ['name', 'capacity', 'building', 'kind'],
    ['CR-201', '60', 'Main Block', 'lecture'],
    ['LAB-301', '40', 'Tech Block', 'lab'],
  ],
  teachers: [
    ['name', 'short', 'email'],
    ['Nisha Rao', 'NR', 'nisha.rao@example.edu'],
    ['Kabir Sethi', 'KS', ''],
  ],
  batches: [
    ['name', 'size'],
    ['CSE-2A', '58'],
    ['CSE-2B', '56'],
  ],
  courses: [
    ['code', 'name', 'teacher', 'color'],
    ['CS201', 'Data Structures', 'NR', '1'],
    ['CS203', 'Discrete Mathematics', 'KS', '3'],
  ],
  classes: [
    ['day', 'start', 'end', 'course', 'batch', 'room', 'teacher'],
    ['Mon', '09:00', '10:00', 'CS201', 'CSE-2A', 'CR-201', 'NR'],
    ['Tue', '14:00', '16:00', 'CS201', 'CSE-2A', 'LAB-301', ''],
  ],
};

export const template = (kind: Kind) => TEMPLATES[kind].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

const key = (s: string | undefined | null) => (s ?? '').trim().toLowerCase();

/** A header plus data rows as objects keyed by column, or the header's problems. */
function readTable(kind: Kind, csv: string): { rows: { line: number; values: Record<string, string> }[]; errors: Errors } {
  let records: CsvRecord[];
  try {
    records = parseCsv(csv);
  } catch (err) {
    if (err instanceof CsvError) return { rows: [], errors: [{ line: err.line, message: err.message }] };
    throw err;
  }
  if (!records.length) return { rows: [], errors: [{ line: 1, message: 'The file is empty.' }] };
  const [header, ...data] = records;
  const cols = header.fields.map(key);
  const { required, optional } = COLUMNS[kind];
  const errors: Errors = [];
  for (const col of cols) {
    if (col && !required.includes(col) && !optional.includes(col)) {
      errors.push({ line: header.line, column: col, message: `Unknown column "${col}". Expected: ${[...required, ...optional].join(', ')}.` });
    }
  }
  for (const col of required) {
    if (!cols.includes(col)) errors.push({ line: header.line, column: col, message: `The "${col}" column is missing.` });
  }
  if (!data.length) errors.push({ line: header.line, message: 'The file has a header but no rows.' });
  if (errors.length) return { rows: [], errors };
  const rows = data.map((r) => {
    if (r.fields.length > cols.length) {
      errors.push({ line: r.line, message: `This row has ${r.fields.length} values but the header has ${cols.length}.` });
    }
    return { line: r.line, values: Object.fromEntries(cols.map((c, i) => [c, r.fields[i] ?? ''])) };
  });
  return { rows, errors };
}

/** Runs `parse`, turning a validation error into a report line. */
function attempt<T>(errors: Errors, line: number, parse: () => T): T | null {
  try {
    return parse();
  } catch (err) {
    if (err instanceof HttpError) {
      errors.push({ line, ...(err.field ? { column: err.field } : {}), message: err.message });
      return null;
    }
    throw err;
  }
}

interface Plan {
  created: number;
  updated: number;
  write: (tx: Queryable) => Promise<void>;
}

export async function runImport(db: Db, ws: WorkspaceCtx, kind: Kind, csv: string, dryRun: boolean): Promise<ImportReport> {
  const table = readTable(kind, csv);
  if (table.errors.length) return { ok: false, created: 0, updated: 0, errors: table.errors };
  return db.transaction(async (tx) => {
    // imports and class writes in one workspace take turns, so checks and writes agree
    await tx.query(LOCK, [`timetable:${ws.id}`]);
    const errors: Errors = [];
    const plan = await PLANNERS[kind](tx, ws.id, table.rows, errors);
    if (!errors.length) {
      const total = (await countOf(tx, kind, ws.id)) + plan.created;
      if (total > LIMITS[kind]) {
        errors.push({ line: 1, message: `A workspace can have at most ${LIMITS[kind]} ${kind}; this would make ${total}.` });
      }
    }
    if (errors.length) return { ok: false, created: 0, updated: 0, errors: errors.sort((a, b) => a.line - b.line) };
    if (!dryRun) await plan.write(tx);
    return { ok: true, created: plan.created, updated: plan.updated, errors: [] };
  });
}

type Rows = { line: number; values: Record<string, string> }[];
type Planner = (tx: Queryable, ws: number, rows: Rows, errors: Errors) => Promise<Plan>;

/** Splits parsed rows into inserts and updates by natural key, flagging repeats within the file. */
function upsertPlan<T>(
  rows: Rows,
  errors: Errors,
  existing: Named[],
  existingKey: (n: Named) => string,
  parse: (values: Record<string, string>, match: Named | undefined) => T,
  rowKey: (parsed: T) => string,
  column: string,
) {
  const byKey = new Map(existing.map((n) => [existingKey(n), n]));
  const seen = new Map<string, number>();
  const inserts: T[] = [];
  const updates: { id: number; row: T }[] = [];
  for (const { line, values } of rows) {
    const parsed = attempt(errors, line, () => parse(values, byKey.get(key(values[column]))));
    if (!parsed) continue;
    const k = key(rowKey(parsed));
    if (seen.has(k)) {
      errors.push({ line, column, message: `"${rowKey(parsed)}" is already on line ${seen.get(k)}.` });
      continue;
    }
    seen.set(k, line);
    const match = byKey.get(k);
    if (match) updates.push({ id: match.id, row: parsed });
    else inserts.push(parsed);
  }
  return { inserts, updates };
}

const T = (name: string, type: Column['type'] = 'text'): Column => ({ name, type });

const PLANNERS: Record<Kind, Planner> = {
  async rooms(tx, ws, rows, errors) {
    const { inserts, updates } = upsertPlan(rows, errors, await existingRows.rooms(tx, ws), (n) => key(n.name), (v) => parseRoom(v), (r) => r.name, 'name');
    const cols = [T('name'), T('capacity', 'int'), T('building'), T('kind')];
    const vals = (r: ReturnType<typeof parseRoom>) => [r.name, r.capacity, r.building, r.kind];
    return {
      created: inserts.length,
      updated: updates.length,
      write: async (w) => {
        await bulkUpdate(w, 'rooms', ws, cols, updates.map((u) => [u.id, ...vals(u.row)]));
        await bulkInsert(w, 'rooms', ws, cols, inserts.map(vals));
      },
    };
  },

  async teachers(tx, ws, rows, errors) {
    const existing = await existingRows.teachers(tx, ws);
    const byName = new Map(existing.map((t) => [key(t.name), t]));
    // match by initials when given, else by name
    const keyed = rows.map((r) => ({
      ...r,
      values: { ...r.values, short: r.values.short || byName.get(key(r.values.name))?.short || '' },
    }));
    const { inserts, updates } = upsertPlan(keyed, errors, existing, (n) => key(n.short), (v) => parseTeacher(v), (t) => t.short, 'short');
    const cols = [T('name'), T('short'), T('email')];
    const vals = (t: ReturnType<typeof parseTeacher>) => [t.name, t.short, t.email];
    return {
      created: inserts.length,
      updated: updates.length,
      write: async (w) => {
        await bulkUpdate(w, 'teachers', ws, cols, updates.map((u) => [u.id, ...vals(u.row)]));
        await bulkInsert(w, 'teachers', ws, cols, inserts.map(vals));
      },
    };
  },

  async batches(tx, ws, rows, errors) {
    const { inserts, updates } = upsertPlan(rows, errors, await existingRows.batches(tx, ws), (n) => key(n.name), (v) => parseBatch(v), (b) => b.name, 'name');
    return {
      created: inserts.length,
      updated: updates.length,
      write: async (w) => {
        await bulkUpdate(w, 'batches', ws, [T('name'), T('size', 'int')], updates.map((u) => [u.id, u.row.name, u.row.size]));
        await bulkInsert(w, 'batches', ws, [T('name'), T('size', 'int'), T('code')], inserts.map((b) => [b.name, b.size, batchCode(b.name)]));
      },
    };
  },

  async courses(tx, ws, rows, errors) {
    const teachers = await existingRows.teachers(tx, ws);
    const existing = await existingRows.courses(tx, ws);
    const findTeacher = teacherFinder(teachers);
    let nextColor = existing.length;
    const { inserts, updates } = upsertPlan(
      rows,
      errors,
      existing,
      (n) => key(n.code),
      (v, match) => {
        const course = parseCourse(v, match?.color ?? (nextColor % 8) + 1);
        const teacherId = v.teacher ? findTeacher(v.teacher) : (match?.teacherId ?? null);
        if (!match) nextColor++;
        return { ...course, teacherId };
      },
      (c) => c.code,
      'code',
    );
    const cols = [T('code'), T('name'), T('color', 'smallint'), T('teacher_id', 'int')];
    const vals = (c: (typeof inserts)[number]) => [c.code, c.name, c.color, c.teacherId];
    return {
      created: inserts.length,
      updated: updates.length,
      write: async (w) => {
        await bulkUpdate(w, 'courses', ws, cols, updates.map((u) => [u.id, ...vals(u.row)]));
        await bulkInsert(w, 'courses', ws, cols, inserts.map(vals));
      },
    };
  },

  async classes(tx, ws, rows, errors) {
    const [rooms, teachers, batches, courses, classes] = await Promise.all([
      existingRows.rooms(tx, ws),
      existingRows.teachers(tx, ws),
      existingRows.batches(tx, ws),
      existingRows.courses(tx, ws),
      existingClasses(tx, ws),
    ]);
    const lookup = (list: Named[], field: 'name' | 'code', column: string, plural: string) => {
      const m = new Map(list.map((n) => [key(n[field]), n]));
      return (v: string) => {
        const found = m.get(key(v));
        if (!found) throw new HttpError(400, 'bad_request', `There is no ${column} "${v}". Import ${plural} first.`, {}, column);
        return found;
      };
    };
    const room = lookup(rooms, 'name', 'room', 'rooms');
    const batch = lookup(batches, 'name', 'batch', 'batches');
    const course = lookup(courses, 'code', 'course', 'courses');
    const teacher = teacherFinder(teachers);
    const names = {
      room: new Map(rooms.map((r) => [r.id, r.name])),
      teacher: new Map(teachers.map((t) => [t.id, t.name])),
      batch: new Map(batches.map((b) => [b.id, b.name])),
    };

    const placed: (WeeklyClass & { line?: number })[] = [...classes];
    const inserts: WeeklyClass[] = [];
    for (const { line, values } of rows) {
      const row = attempt(errors, line, () => {
        const day = parseDay(values.day);
        if (!day) throw new HttpError(400, 'bad_request', `"${values.day}" is not a day. Use Mon to Sun or 1 to 7.`, {}, 'day');
        const times = parseClassTimes({ ...values, day });
        const co = course(values.course);
        const teacherId = values.teacher ? teacher(values.teacher) : co.teacherId;
        if (!teacherId) throw new HttpError(400, 'bad_request', `${co.code} has no usual teacher, so this row needs one.`, {}, 'teacher');
        return { id: 0, ...times, courseId: co.id, course: co.code!, batchId: batch(values.batch).id, roomId: room(values.room).id, teacherId };
      });
      if (!row) continue;
      const same = placed.find(
        (p) => p.day === row.day && p.start === row.start && p.end === row.end && p.courseId === row.courseId &&
          p.batchId === row.batchId && p.roomId === row.roomId && p.teacherId === row.teacherId,
      );
      if (same) {
        if (same.line) errors.push({ line, message: `This class is already on line ${same.line}.` });
        continue; // identical to an existing class: nothing to do
      }
      const clash = placed.find((p) => p.day === row.day && p.start < row.end && row.start < p.end &&
        (p.roomId === row.roomId || p.teacherId === row.teacherId || p.batchId === row.batchId));
      if (clash) {
        const at = `${dayName(clash.day)} ${clash.start}${clash.line ? ` (line ${clash.line})` : ''}`;
        const message =
          clash.roomId === row.roomId ? `${names.room.get(row.roomId)} is booked at ${at} by ${clash.course}.`
          : clash.teacherId === row.teacherId ? `${names.teacher.get(row.teacherId)} teaches ${clash.course} at ${at}.`
          : `${names.batch.get(row.batchId)} has ${clash.course} at ${at}.`;
        errors.push({ line, column: clash.roomId === row.roomId ? 'room' : clash.teacherId === row.teacherId ? 'teacher' : 'batch', message });
        continue;
      }
      placed.push({ ...row, line });
      inserts.push(row);
    }
    const cols = [T('course_id', 'int'), T('batch_id', 'int'), T('teacher_id', 'int'), T('room_id', 'int'), T('day_of_week', 'smallint'), T('start_time', 'time'), T('end_time', 'time')];
    return {
      created: inserts.length,
      updated: 0,
      write: (w) =>
        bulkInsert(w, 'classes', ws, cols, inserts.map((r) => [r.courseId, r.batchId, r.teacherId, r.roomId, r.day, r.start, r.end])),
    };
  },
};

/** A teacher by initials or full name, as a coordinator would type either. */
function teacherFinder(teachers: Named[]) {
  const byShort = new Map(teachers.map((t) => [key(t.short), t.id]));
  const byName = new Map(teachers.map((t) => [key(t.name), t.id]));
  return (v: string) => {
    const found = byShort.get(key(v)) ?? byName.get(key(v));
    if (!found) throw new HttpError(400, 'bad_request', `There is no teacher "${v}". Import teachers first.`, {}, 'teacher');
    return found;
  };
}
