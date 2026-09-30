// Timetable rules the mock shares between routes: occurrences with changes applied, clash checks and free slots.
// These follow the contract: changes are per occurrence, times are half-open, a batch cannot be in two places.

import type { Change, ClassRow, Clash, Occurrence, SlotAvailability, Week } from '../../contract';
import { addDays, dow, fromMin, mondayOf, nowIn, overlaps, toMin } from '../../lib/time';
import type { ChangeRow, WsRow } from './seed';

export type Filter = { batch?: number; teacher?: number; room?: number };

export function toChange(ws: WsRow, c: ChangeRow): Change {
  const cls = ws.classes.find((x) => x.id === c.classId)!;
  const course = ws.courses.find((x) => x.id === cls.courseId)!;
  const batch = ws.batches.find((x) => x.id === cls.batchId)!;
  const roomName = (id: number | null) => ws.rooms.find((r) => r.id === id)?.name ?? '';
  return {
    id: c.id, classId: c.classId, kind: c.kind,
    course: { code: course.code, name: course.name, color: course.color },
    batch: { id: batch.id, name: batch.name },
    from: { date: c.occursOn, start: cls.start, end: cls.end, room: roomName(cls.roomId) },
    to: c.kind === 'moved' ? { date: c.toDate!, start: c.toStart!, end: c.toEnd!, room: roomName(c.toRoomId) } : null,
    reason: c.reason, by: c.createdBy, at: c.createdAt,
  };
}

function occ(ws: WsRow, cls: ClassRow, date: string, status: Occurrence['status'], change: ChangeRow | null): Occurrence {
  const course = ws.courses.find((x) => x.id === cls.courseId)!;
  const teacher = ws.teachers.find((x) => x.id === cls.teacherId)!;
  const batch = ws.batches.find((x) => x.id === cls.batchId)!;
  const here = status === 'moved-here' && change;
  const room = ws.rooms.find((x) => x.id === (here ? change.toRoomId : cls.roomId))!;
  return {
    key: here ? `${cls.id}:${change.occursOn}:to` : `${cls.id}:${date}`,
    classId: cls.id,
    date: here ? change.toDate! : date,
    start: here ? change.toStart! : cls.start,
    end: here ? change.toEnd! : cls.end,
    course: { id: course.id, code: course.code, name: course.name, color: course.color },
    teacher: { id: teacher.id, name: teacher.name, short: teacher.short },
    room: { id: room.id, name: room.name },
    batch: { id: batch.id, name: batch.name },
    status,
    change: change ? toChange(ws, change) : null,
  };
}

/** Every occurrence between two dates (inclusive) with changes applied. */
export function occurrences(ws: WsRow, from: string, to: string, f: Filter = {}): Occurrence[] {
  const out: Occurrence[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (!ws.days.includes(dow(d))) continue;
    for (const cls of ws.classes) {
      if (cls.day !== dow(d)) continue;
      const ch = ws.changes.find((c) => c.classId === cls.id && c.occursOn === d) ?? null;
      out.push(occ(ws, cls, d, !ch ? 'scheduled' : ch.kind === 'cancelled' ? 'cancelled' : 'moved-away', ch));
    }
  }
  for (const ch of ws.changes) {
    if (ch.kind !== 'moved' || !ch.toDate || ch.toDate < from || ch.toDate > to) continue;
    const cls = ws.classes.find((c) => c.id === ch.classId);
    if (cls) out.push(occ(ws, cls, ch.toDate, 'moved-here', ch));
  }
  return out
    .filter((o) => (f.batch ? o.batch.id === f.batch : true) && (f.teacher ? o.teacher.id === f.teacher : true) && (f.room ? o.room.id === f.room : true))
    .sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start) || a.course.code.localeCompare(b.course.code));
}

export function week(ws: WsRow, start: string | undefined, f: Filter, now = Date.now()): Week {
  const today = nowIn(ws.timezone, now).date;
  const monday = mondayOf(start || today);
  const days = ws.days.slice().sort().map((d) => addDays(monday, d - 1));
  const end = addDays(monday, 6);
  return { start: monday, end: days[days.length - 1] ?? end, days, timezone: ws.timezone, periods: ws.periods, occurrences: occurrences(ws, monday, end, f), today };
}

/** Occurrences that take up a room, a teacher and a batch on a date (cancelled and moved-away ones don't). */
const occupying = (ws: WsRow, date: string) => occurrences(ws, date, date).filter((o) => o.status === 'scheduled' || o.status === 'moved-here');

export function clashes(
  ws: WsRow,
  t: { date: string; start: string; end: string; roomId: number | null; teacherId: number; batchId: number },
  excludeClass: number | null,
): Clash[] {
  const out: Clash[] = [];
  for (const o of occupying(ws, t.date)) {
    if (o.classId === excludeClass || !overlaps(o.start, o.end, t.start, t.end)) continue;
    const base = { classId: o.classId, course: `${o.course.code} (${o.batch.name})`, start: o.start, end: o.end, room: o.room.name };
    if (t.roomId && o.room.id === t.roomId) out.push({ type: 'room', ...base });
    if (o.teacher.id === t.teacherId) out.push({ type: 'teacher', ...base });
    if (o.batch.id === t.batchId) out.push({ type: 'batch', ...base });
  }
  return out;
}

export function slots(ws: WsRow, cls: ClassRow, weekOf: string, now = Date.now()): SlotAvailability[] {
  const { date: today, minutes } = nowIn(ws.timezone, now);
  const monday = mondayOf(weekOf);
  const len = toMin(cls.end) - toMin(cls.start);
  const lastEnd = Math.max(...ws.periods.map((p) => toMin(p.end)));
  const breaks = ws.periods.filter((p) => p.isBreak);
  const batch = ws.batches.find((b) => b.id === cls.batchId)!;
  const out: SlotAvailability[] = [];
  for (const day of ws.days.slice().sort()) {
    const date = addDays(monday, day - 1);
    if (date < today) continue;
    const busy = occupying(ws, date).filter((o) => o.classId !== cls.id);
    for (const p of ws.periods) {
      if (p.isBreak) continue;
      const s = toMin(p.start);
      const e = s + len;
      if (e > lastEnd || breaks.some((b) => s < toMin(b.end) && toMin(b.start) < e)) continue;
      if (date === today && s <= minutes) continue;
      const start = fromMin(s);
      const end = fromMin(e);
      const here = busy.filter((o) => overlaps(o.start, o.end, start, end));
      const taken = new Set(here.map((o) => o.room.id));
      out.push({
        date, start, end,
        teacherBusy: here.some((o) => o.teacher.id === cls.teacherId),
        batchBusy: here.some((o) => o.batch.id === cls.batchId),
        freeRooms: ws.rooms
          .filter((r) => !taken.has(r.id) && r.capacity >= (batch.size ?? 0))
          .sort((a, b) => a.capacity - b.capacity || a.name.localeCompare(b.name))
          .map((r) => ({ id: r.id, name: r.name, capacity: r.capacity })),
      });
    }
  }
  return out;
}
