// Turns clash rows into the 409 a person can read: "CR-201 is booked at 10:00 by CS203."

import type { Clash, SlotAvailability } from './contract';
import type { ClashRow } from './data/bookings';
import { HttpError } from './http';

export function describeClash(c: ClashRow): string {
  switch (c.type) {
    case 'room':
      return `${c.room} is booked at ${c.start} by ${c.course}.`;
    case 'teacher':
      return `${c.teacher} teaches ${c.course} at ${c.start}.`;
    case 'batch':
      return `${c.batch} has ${c.course} at ${c.start}.`;
  }
}

const toClash = ({ type, classId, course, start, end, room }: ClashRow): Clash => ({ type, classId, course, start, end, room });

export function clashError(clashes: ClashRow[], suggestion?: SlotAvailability | null): HttpError {
  const extra: Record<string, unknown> = { clashes: clashes.map(toClash) };
  if (suggestion !== undefined) extra.suggestion = suggestion;
  return new HttpError(409, 'clash', clashes.map(describeClash).join(' '), extra);
}
