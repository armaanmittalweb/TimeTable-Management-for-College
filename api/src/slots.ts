// Where could this class go this week? Pure: the route fetches bookings once for the
// whole week and every slot is answered from them, instead of one query per slot.

import type { Period, Room, SlotAvailability } from './contract';
import { fromMinutes, minutes } from './dates';
import type { Booking } from './data/bookings';

export interface SlotInput {
  cls: { start: string; end: string; teacherId: number; batchId: number };
  /** The occurrence being moved; its own booking does not make a slot busy. */
  exclude: { classId: number; occursOn: string } | null;
  dates: string[];
  periods: Period[];
  bookings: Booking[];
  rooms: Room[];
  batchSize: number | null;
  now: { date: string; time: string };
}

const overlaps = (aStart: string, aEnd: string, bStart: string, bEnd: string) => aStart < bEnd && bStart < aEnd;

/**
 * One slot per shown date x non-break period, from now on. A slot starts with its
 * period and lasts as long as the class, so a two-hour lab gets two-hour slots;
 * slots that would run into a break or past the last period are left out.
 */
export function slotAvailability(s: SlotInput): SlotAvailability[] {
  const duration = minutes(s.cls.end) - minutes(s.cls.start);
  const breaks = s.periods.filter((p) => p.isBreak);
  const dayEnd = s.periods.reduce((max, p) => (p.end > max ? p.end : max), '00:00');
  const counts = (b: Booking) => !(s.exclude && b.classId === s.exclude.classId && b.occursOn === s.exclude.occursOn);
  const fits = s.rooms
    .filter((r) => s.batchSize === null || r.capacity >= s.batchSize)
    .sort((a, b) => a.capacity - b.capacity || a.name.localeCompare(b.name));
  const out: SlotAvailability[] = [];

  for (const date of s.dates) {
    if (date < s.now.date) continue;
    const busy = s.bookings.filter((b) => b.date === date && counts(b));
    for (const p of s.periods) {
      if (p.isBreak) continue;
      const start = p.start;
      const endMin = minutes(start) + duration;
      if (endMin > 24 * 60) continue;
      const end = fromMinutes(endMin);
      if (end > dayEnd || breaks.some((b) => overlaps(start, end, b.start, b.end))) continue;
      if (date === s.now.date && start < s.now.time) continue;
      const here = busy.filter((b) => overlaps(start, end, b.start, b.end));
      out.push({
        date,
        start,
        end,
        teacherBusy: here.some((b) => b.teacherId === s.cls.teacherId),
        batchBusy: here.some((b) => b.batchId === s.cls.batchId),
        freeRooms: fits
          .filter((r) => !here.some((b) => b.roomId === r.id))
          .map((r) => ({ id: r.id, name: r.name, capacity: r.capacity })),
      });
    }
  }
  return out;
}

export const isFree = (slot: SlotAvailability) => !slot.teacherBusy && !slot.batchBusy && slot.freeRooms.length > 0;
