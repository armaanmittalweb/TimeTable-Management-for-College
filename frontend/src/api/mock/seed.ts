// The demo college the mock serves: a CS/ECE department with three batches, five teachers and six rooms, a full
// Monday–Friday week with lunch and a two-hour lab per batch, and three changes placed in the current week.
// Mirrors the API's demo data in spirit (same people, rooms and courses as the old seed).

import type { Batch, ClassRow, Course, Period, Room } from '../../contract';
import { addDays, fromMin, mondayOf, nowIn } from '../../lib/time';

export interface TeacherRow { id: number; name: string; short: string; email: string | null }
export interface ChangeRow {
  id: number; classId: number; occursOn: string; kind: 'cancelled' | 'moved';
  toDate: string | null; toStart: string | null; toEnd: string | null; toRoomId: number | null;
  reason: string | null; createdBy: string; createdAt: string;
}
export interface MemberRow { userId: number; role: 'coordinator' | 'teacher'; teacherId: number | null; joinedAt: string }
export interface WsRow {
  id: number; slug: string; name: string; institution: string; timezone: string; days: number[];
  publishedAt: string | null; isDemo: boolean; expiresAt: string | null; createdBy: number | null; createdAt: string;
  members: MemberRow[];
  periods: Period[]; rooms: Room[]; teachers: TeacherRow[]; batches: Batch[]; courses: Course[]; classes: ClassRow[]; changes: ChangeRow[];
}

export const DEFAULT_PERIODS: Period[] = [
  { idx: 1, start: '09:00', end: '10:00', label: null, isBreak: false },
  { idx: 2, start: '10:00', end: '11:00', label: null, isBreak: false },
  { idx: 3, start: '11:00', end: '12:00', label: null, isBreak: false },
  { idx: 4, start: '12:00', end: '13:00', label: null, isBreak: false },
  { idx: 5, start: '13:00', end: '14:00', label: 'Lunch', isBreak: true },
  { idx: 6, start: '14:00', end: '15:00', label: null, isBreak: false },
  { idx: 7, start: '15:00', end: '16:00', label: null, isBreak: false },
  { idx: 8, start: '16:00', end: '17:00', label: null, isBreak: false },
];

const ROOMS: Omit<Room, 'id'>[] = [
  { name: 'CR-201', capacity: 60, building: 'Main Block', kind: 'lecture' },
  { name: 'CR-202', capacity: 60, building: 'Main Block', kind: 'lecture' },
  { name: 'CR-203', capacity: 60, building: 'Main Block', kind: 'lecture' },
  { name: 'LT-101', capacity: 120, building: 'Main Block', kind: 'lecture' },
  { name: 'LAB-301', capacity: 60, building: 'Tech Block', kind: 'lab' },
  { name: 'LAB-302', capacity: 60, building: 'Tech Block', kind: 'lab' },
];

const TEACHERS: Omit<TeacherRow, 'id'>[] = [
  { name: 'Meera Iyer', short: 'MI', email: 'meera.iyer@riverside.edu' },
  { name: 'Kabir Sethi', short: 'KS', email: 'kabir.sethi@riverside.edu' },
  { name: 'Nisha Rao', short: 'NR', email: 'nisha.rao@riverside.edu' },
  { name: 'Arjun Khanna', short: 'AK', email: 'arjun.khanna@riverside.edu' },
  { name: 'Farah Qureshi', short: 'FQ', email: 'farah.qureshi@riverside.edu' },
];

const BATCHES: Omit<Batch, 'id'>[] = [
  { name: 'CSE-2A', size: 58, code: 'CSE2A-K7QD' },
  { name: 'CSE-2B', size: 56, code: 'CSE2B-M4TX' },
  { name: 'ECE-2A', size: 48, code: 'ECE2A-R9HW' },
];

// [code, name, colour, teacher initials]
const COURSES: [string, string, number, string][] = [
  ['CS201', 'Data Structures', 1, 'MI'],
  ['CS203', 'Discrete Mathematics', 2, 'KS'],
  ['CS205', 'Computer Organization', 3, 'NR'],
  ['CS291', 'Data Structures Lab', 4, 'MI'],
  ['CS207', 'Database Systems', 6, 'MI'],
  ['MA201', 'Probability and Statistics', 7, 'KS'],
  ['HS201', 'Professional Communication', 8, 'FQ'],
  ['EC201', 'Signals and Systems', 5, 'AK'],
  ['EC203', 'Analog Circuits', 6, 'FQ'],
  ['EC205', 'Digital Electronics', 3, 'NR'],
  ['EC291', 'Digital Electronics Lab', 4, 'NR'],
];

// Per batch: [day, start hour, course, room, hours]. The home room is used when room is omitted.
type Slot = [number, number, string, string?, number?];
const WEEK: Record<string, { home: string; slots: Slot[] }> = {
  'CSE-2A': {
    home: 'CR-201',
    slots: [
      [1, 9, 'CS201'], [1, 10, 'CS207'], [1, 12, 'CS205'], [1, 14, 'CS291', 'LAB-301', 2],
      [2, 9, 'CS205'], [2, 10, 'CS203'], [2, 11, 'MA201'], [2, 14, 'HS201'],
      [3, 9, 'CS201'], [3, 11, 'CS203'], [3, 14, 'CS205'], [3, 15, 'CS207'],
      [4, 10, 'CS207'], [4, 11, 'CS201'], [4, 14, 'MA201'], [4, 15, 'HS201'],
      [5, 9, 'CS203'], [5, 10, 'CS201'], [5, 12, 'CS205'],
    ],
  },
  'CSE-2B': {
    home: 'CR-202',
    slots: [
      [1, 9, 'CS205'], [1, 11, 'CS201'], [1, 12, 'CS203'], [1, 14, 'HS201'],
      [2, 9, 'CS207'], [2, 12, 'MA201'], [2, 15, 'CS291', 'LAB-301', 2],
      [3, 10, 'CS201'], [3, 11, 'CS205'], [3, 12, 'CS203'], [3, 14, 'CS207'],
      [4, 9, 'CS203'], [4, 11, 'CS205'], [4, 12, 'CS201'], [4, 14, 'HS201'],
      [5, 9, 'CS207'], [5, 10, 'CS205'], [5, 11, 'MA201'],
    ],
  },
  'ECE-2A': {
    home: 'CR-203',
    slots: [
      [1, 9, 'EC201'], [1, 10, 'EC205'], [1, 11, 'EC203'], [1, 15, 'MA201'],
      [2, 9, 'EC203'], [2, 10, 'EC201'], [2, 11, 'EC205'], [2, 15, 'HS201'],
      [3, 9, 'EC205'], [3, 10, 'EC201'], [3, 11, 'EC203'], [3, 14, 'MA201'],
      [4, 9, 'EC201'], [4, 10, 'EC203'], [4, 14, 'EC291', 'LAB-302', 2],
      [5, 9, 'EC205'], [5, 10, 'HS201'],
    ],
  },
};

export interface SeedOpts { id: number; slug: string; name?: string; institution?: string; isDemo: boolean; nextId: () => number; now: number; createdBy: number | null }

/** A fresh copy of the demo college with new ids and this week's three changes. */
export function buildCollege(o: SeedOpts): WsRow {
  const id = o.nextId;
  const rooms = ROOMS.map((r) => ({ id: id(), ...r }));
  const teachers = TEACHERS.map((t) => ({ id: id(), ...t }));
  const batches = BATCHES.map((b) => ({ id: id(), ...b }));
  const tBy = (short: string) => teachers.find((t) => t.short === short)!;
  const courses: Course[] = COURSES.map(([code, name, color, t]) => ({ id: id(), code, name, color, teacherId: tBy(t).id }));
  const classes: ClassRow[] = [];
  for (const b of batches) {
    const plan = WEEK[b.name];
    for (const [day, hour, code, room, hours = 1] of plan.slots) {
      const course = courses.find((c) => c.code === code)!;
      classes.push({
        id: id(), courseId: course.id, batchId: b.id, teacherId: course.teacherId!,
        roomId: rooms.find((r) => r.name === (room ?? plan.home))!.id,
        day, start: fromMin(hour * 60), end: fromMin((hour + hours) * 60),
      });
    }
  }

  const tz = 'Asia/Kolkata';
  const now = nowIn(tz, o.now);
  const monday = mondayOf(now.date);
  const find = (batch: string, day: number, start: string) =>
    classes.find((c) => c.batchId === batches.find((b) => b.name === batch)!.id && c.day === day && c.start === start)!;
  // An instant in the workspace's timezone (IST has no DST), never later than a few minutes ago.
  const at = (date: string, time: string) => Math.min(new Date(`${date}T${time}:00+05:30`).getTime(), o.now - 7 * 60_000);
  const iso = (ms: number) => new Date(ms).toISOString();
  const changes: ChangeRow[] = [
    {
      id: id(), classId: find('CSE-2A', 2, '10:00').id, occursOn: addDays(monday, 1), kind: 'cancelled',
      toDate: null, toStart: null, toEnd: null, toRoomId: null, reason: 'At the ACM workshop in Pune', createdBy: 'Kabir Sethi',
      createdAt: iso(at(addDays(monday, 0), '17:40')),
    },
    {
      id: id(), classId: find('CSE-2A', 2, '09:00').id, occursOn: addDays(monday, 1), kind: 'moved',
      toDate: addDays(monday, 3), toStart: '12:00', toEnd: '13:00', toRoomId: rooms.find((r) => r.name === 'LT-101')!.id,
      reason: null, createdBy: 'Nisha Rao', createdAt: iso(at(addDays(monday, 0), '19:05')),
    },
    {
      id: id(), classId: find('CSE-2B', 3, '14:00').id, occursOn: addDays(monday, 2), kind: 'moved',
      toDate: addDays(monday, 4), toStart: '12:00', toEnd: '13:00', toRoomId: rooms.find((r) => r.name === 'CR-202')!.id,
      reason: 'Department meeting', createdBy: 'Meera Iyer', createdAt: iso(Math.max(at(addDays(monday, 2), '08:50'), o.now - 3 * 3600_000)),
    },
  ];

  const created = iso(o.now - 40 * 86_400_000);
  return {
    id: o.id, slug: o.slug, name: o.name ?? 'Computer Science', institution: o.institution ?? 'Riverside Institute of Technology',
    timezone: tz, days: [1, 2, 3, 4, 5], publishedAt: created, isDemo: o.isDemo,
    expiresAt: o.isDemo ? iso(o.now + 24 * 3600_000) : null, createdBy: o.createdBy, createdAt: created,
    members: [], periods: DEFAULT_PERIODS.map((p) => ({ ...p })), rooms, teachers, batches, courses, classes, changes,
  };
}

/** A workspace as POST /api/workspaces makes it: default periods, nothing else. */
export function emptyWorkspace(o: { id: number; slug: string; name: string; institution: string; timezone: string; createdBy: number; now: number }): WsRow {
  return {
    id: o.id, slug: o.slug, name: o.name, institution: o.institution, timezone: o.timezone, days: [1, 2, 3, 4, 5],
    publishedAt: null, isDemo: false, expiresAt: null, createdBy: o.createdBy, createdAt: new Date(o.now).toISOString(),
    members: [{ userId: o.createdBy, role: 'coordinator', teacherId: null, joinedAt: new Date(o.now).toISOString() }],
    periods: DEFAULT_PERIODS.map((p) => ({ ...p })), rooms: [], teachers: [], batches: [], courses: [], classes: [], changes: [],
  };
}

