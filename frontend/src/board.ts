// Turns API rows into what a board shows: one line per departure, with its state.

import type { ClassRow } from './api';
import { DAY_LONG, DAY_SHORT, dayMonth, hhmm, isoWeekday, longDate } from './time';

export type RowState = 'on' | 'cancelled' | 'moved' | 'arrival';

export interface BoardRow {
  /** Stable per class and role on the board (a moved class can appear twice: where it was, where it went). */
  key: string;
  classId: number;
  state: RowState;
  time: string;
  end: string;
  code: string;
  name: string;
  room: string;
  /** The room shown is not the class's usual room. */
  roomChanged: boolean;
  professor: string;
  batch: string;
  status: string;
  /** Plain-language status for screen readers. */
  spoken: string;
  source: ClassRow;
}

/** 'prof.meera' -> 'PROF. MEERA', 'kabir.sethi' -> 'K. SETHI' */
export function professorName(username: string | null): string {
  if (!username) return 'TBA';
  const [first, ...rest] = username.split('.');
  if (!rest.length) return username.toUpperCase();
  if (first === 'prof') return `PROF. ${rest.join(' ').toUpperCase()}`;
  return `${first[0].toUpperCase()}. ${rest.join(' ').toUpperCase()}`;
}

/** Where a moved class went, in board text: 'WED 10:00' inside the shown week, '06 OCT 10:00' outside it. */
function movedTo(r: ClassRow, week: string[]) {
  const date = r.new_date!;
  const when = week.includes(date) ? DAY_SHORT[isoWeekday(date)] : dayMonth(date);
  return `${when} ${hhmm(r.new_start_time)}`;
}

export function stateOf(r: ClassRow): Exclude<RowState, 'arrival'> {
  if (r.modification_type === 'cancelled') return 'cancelled';
  if (r.modification_type === 'postponed') return 'moved';
  return 'on';
}

function departure(r: ClassRow, week: string[]): BoardRow {
  const state = stateOf(r);
  const base = {
    key: `c${r.id}`,
    classId: r.id,
    state,
    time: hhmm(r.start_time),
    end: hhmm(r.end_time),
    code: r.course_code,
    name: r.course_name,
    professor: professorName(r.faculty_name),
    batch: r.batch,
    source: r,
  };
  if (state === 'cancelled') {
    return { ...base, room: r.room_number ?? '', roomChanged: false, status: 'CANCELLED', spoken: 'Cancelled this week' };
  }
  if (state === 'moved') {
    const room = r.new_room_number ?? r.room_number ?? '';
    return {
      ...base,
      room,
      roomChanged: room !== r.room_number,
      status: `MOVED → ${movedTo(r, week)}`,
      spoken: `Moved to ${longDate(r.new_date!)} at ${hhmm(r.new_start_time)}, room ${room}`,
    };
  }
  return { ...base, room: r.room_number ?? '', roomChanged: false, status: 'ON TIME', spoken: 'On time' };
}

/** The moved class, shown again on the day it now runs. */
function arrival(r: ClassRow): BoardRow {
  const room = r.new_room_number ?? '';
  return {
    key: `a${r.id}`,
    classId: r.id,
    state: 'arrival',
    time: hhmm(r.new_start_time),
    end: hhmm(r.new_end_time),
    code: r.course_code,
    name: r.course_name,
    room,
    roomChanged: room !== r.room_number,
    professor: professorName(r.faculty_name),
    batch: r.batch,
    status: `FROM ${DAY_SHORT[r.day_of_week]} ${hhmm(r.start_time)}`,
    spoken: `Moved here from ${DAY_LONG[r.day_of_week]} ${hhmm(r.start_time)}`,
    source: r,
  };
}

/** Rows for one day tab (ISO weekday), in departure order. `week` holds the Mon..Fri dates on show. */
export function rowsForDay(rows: ClassRow[], day: number, week: string[]): BoardRow[] {
  const date = week[day - 1];
  const out: BoardRow[] = [];
  for (const r of rows) {
    if (r.day_of_week === day) out.push(departure(r, week));
    if (r.modification_type === 'postponed' && r.new_date === date) out.push(arrival(r));
  }
  return out.sort((a, b) => a.time.localeCompare(b.time) || a.classId - b.classId);
}

/** One sentence for the live region when a class's state changed between two reads. */
export function describeChange(before: ClassRow | undefined, after: ClassRow): string | null {
  const was = before ? `${before.modification_type}|${before.new_date}|${before.new_start_time}|${before.new_classroom_id}` : null;
  const now = `${after.modification_type}|${after.new_date}|${after.new_start_time}|${after.new_classroom_id}`;
  if (was === null || was === now) return null;
  const which = `${after.course_code} on ${DAY_LONG[after.day_of_week]} ${hhmm(after.start_time)}`;
  switch (stateOf(after)) {
    case 'cancelled':
      return `${which} cancelled this week.`;
    case 'moved':
      return `${which} moved to ${longDate(after.new_date!)} ${hhmm(after.new_start_time)}, room ${after.new_room_number}.`;
    default:
      return `${which} back on time.`;
  }
}
