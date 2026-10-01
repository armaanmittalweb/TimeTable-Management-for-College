import type { Change } from '../contract';
import { DAY_SHORT, dow } from './time';

const d = (date: string) => DAY_SHORT[dow(date)];

/** "moved Tue 09:00 → Thu 12:00, LT-101" / "cancelled on Tue 10:00" (course code rendered separately). */
export function changeWhat(c: Change) {
  if (c.kind === 'cancelled') return `cancelled on ${d(c.from.date)} ${c.from.start}`;
  const to = c.to!;
  return `moved ${d(c.from.date)} ${c.from.start} → ${d(to.date)} ${to.start}${to.room !== c.from.room ? `, ${to.room}` : ''}`;
}

/** Sentence for a toast after a move. */
export const movedToast = (code: string, date: string, start: string, room: string) => `${code} moved to ${d(date)} ${start}, ${room}.`;

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A short name for the time a copy was saved: "10:42" today, "Tue 10:42" otherwise. */
export function savedAt(ms: number) {
  const t = new Date(ms);
  const hm = t.toTimeString().slice(0, 5);
  return new Date().toDateString() === t.toDateString() ? hm : `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][t.getDay()]} ${hm}`;
}
