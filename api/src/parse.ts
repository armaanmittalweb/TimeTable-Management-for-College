// Parsers for setup rows, shared by the JSON routes and the CSV import so both
// accept exactly the same values. Field names match the CSV column names.

import type { Batch, ClassRow, Course, Room, Teacher } from './contract';
import { fieldError } from './http';
import { email as parseEmail, int, oneOf, optInt, optText, text, time } from './validate';

type Raw = Record<string, unknown>;

export function parseRoom(o: Raw): Omit<Room, 'id'> {
  return {
    name: text(o.name, 'name', 40),
    capacity: int(o.capacity, 'capacity', 1, 5000),
    building: optText(o.building, 'building', 60),
    kind: o.kind === undefined || o.kind === null || o.kind === '' ? 'lecture' : oneOf(o.kind, 'kind', ['lecture', 'lab'] as const),
  };
}

/** "Nisha Rao" → "NR"; "Dr. A. K. Singh" → "AKS". */
export function initials(name: string) {
  return (
    name
      .replace(/\b(dr|prof|mr|mrs|ms)\.?\s+/gi, '')
      .split(/[\s.]+/)
      .filter(Boolean)
      .map((w) => w[0].toUpperCase())
      .join('')
      .slice(0, 4) || 'T'
  );
}

export function parseTeacher(o: Raw): Omit<Teacher, 'id' | 'hasAccount'> {
  const name = text(o.name, 'name', 80);
  const email = o.email === undefined || o.email === null || o.email === '' ? null : parseEmail(o.email);
  const short = optText(o.short, 'short', 8)?.toUpperCase() ?? initials(name);
  return { name, short, email };
}

export function parseBatch(o: Raw): Pick<Batch, 'name' | 'size'> {
  return { name: text(o.name, 'name', 40), size: optInt(o.size, 'size', 1, 5000) };
}

export function parseCourse(o: Raw, defaultColor: number): Omit<Course, 'id' | 'teacherId'> {
  return {
    code: text(o.code, 'code', 20),
    name: text(o.name, 'name', 120),
    color: optInt(o.color, 'color', 1, 8) ?? defaultColor,
  };
}

export function parseClassTimes(o: Raw): Pick<ClassRow, 'day' | 'start' | 'end'> {
  const start = time(o.start, 'start');
  const end = time(o.end, 'end');
  if (end <= start) throw fieldError('end', 'A class must end after it starts.');
  return { day: int(o.day, 'day', 1, 7), start, end };
}
