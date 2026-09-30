// Turns weekly classes plus per-occurrence changes into dated occurrences. Pure, so
// the same code serves the API, calendar feeds and the in-memory demo preview.

import type { Change, Occurrence, Period, Week } from './contract';
import { addDays, datesBetween, isoWeekday, mondayOf } from './dates';

export interface ClassInfo {
  id: number;
  day: number;
  start: string;
  end: string;
  course: Occurrence['course'];
  teacher: Occurrence['teacher'];
  room: Occurrence['room'];
  batch: Occurrence['batch'];
}

export interface ChangeInfo {
  change: Change;
  occursOn: string;
  toRoomId: number | null;
}

/**
 * Occurrences on `dates`. A cancelled occurrence stays in place with its change; a
 * moved one shows twice: moved-away in its regular slot and moved-here at the new
 * time (key `${classId}:${occursOn}:to`). `roomId` limits regular occurrences to
 * that room and moved-here copies to those moved into it.
 */
export function buildOccurrences(
  classes: ClassInfo[],
  changes: ChangeInfo[],
  dates: string[],
  roomId: number | null = null,
): Occurrence[] {
  const byOccurrence = new Map(changes.map((c) => [`${c.change.classId}:${c.occursOn}`, c]));
  const byId = new Map(classes.map((c) => [c.id, c]));
  const shown = new Set(dates);
  const out: Occurrence[] = [];

  const base = (cls: ClassInfo) => ({
    classId: cls.id,
    course: cls.course,
    teacher: cls.teacher,
    batch: cls.batch,
  });

  for (const date of dates) {
    const day = isoWeekday(date);
    for (const cls of classes) {
      if (cls.day !== day || (roomId !== null && cls.room.id !== roomId)) continue;
      const ch = byOccurrence.get(`${cls.id}:${date}`);
      out.push({
        key: `${cls.id}:${date}`,
        ...base(cls),
        date,
        start: cls.start,
        end: cls.end,
        room: cls.room,
        status: !ch ? 'scheduled' : ch.change.kind === 'cancelled' ? 'cancelled' : 'moved-away',
        change: ch?.change ?? null,
      });
    }
  }

  for (const ch of changes) {
    const to = ch.change.to;
    if (ch.change.kind !== 'moved' || !to || !shown.has(to.date) || ch.toRoomId === null) continue;
    if (roomId !== null && ch.toRoomId !== roomId) continue;
    const cls = byId.get(ch.change.classId);
    if (!cls) continue;
    out.push({
      key: `${cls.id}:${ch.occursOn}:to`,
      ...base(cls),
      date: to.date,
      start: to.start,
      end: to.end,
      room: { id: ch.toRoomId, name: to.room },
      status: 'moved-here',
      change: ch.change,
    });
  }

  return out.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.start.localeCompare(b.start) ||
      a.course.code.localeCompare(b.course.code) ||
      a.key.localeCompare(b.key),
  );
}

/** The Monday-to-Sunday week containing `anyDate`, with only the workspace's shown days. */
export function weekFrame(anyDate: string, days: number[]) {
  const start = mondayOf(anyDate);
  const end = addDays(start, 6);
  return { start, end, days: datesBetween(start, end).filter((d) => days.includes(isoWeekday(d))) };
}

export function assembleWeek(
  frame: { start: string; end: string; days: string[] },
  rows: { classes: ClassInfo[]; changes: ChangeInfo[] },
  meta: { timezone: string; periods: Period[]; today: string; roomId?: number | null },
): Week {
  return {
    start: frame.start,
    end: frame.end,
    days: frame.days,
    timezone: meta.timezone,
    periods: meta.periods,
    occurrences: buildOccurrences(rows.classes, rows.changes, frame.days, meta.roomId ?? null),
    today: meta.today,
  };
}
