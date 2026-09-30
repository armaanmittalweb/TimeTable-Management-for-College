// The demo college as a read-only Week built in memory from db/demo.json, for the
// signed-out front page. No database, no session: it cannot be changed, and every
// visitor sees the same timetable with the sample changes in the current week.

import type { Change, Week } from './contract';
import { addDays, mondayOf } from './dates';
import { DEMO, demoClasses } from './data/demo';
import { DEFAULT_PERIODS } from './data/workspaces';
import { assembleWeek, weekFrame, type ChangeInfo, type ClassInfo } from './week';

const idOf = <T>(list: T[], match: (x: T) => boolean) => list.findIndex(match) + 1;

function demoClassInfo(): ClassInfo[] {
  return demoClasses().map(([day, start, end, code, batchName, roomName], i): ClassInfo => {
    const course = DEMO.courses.find((c) => c.code === code)!;
    const teacher = DEMO.teachers.find((t) => t.short === course.teacher)!;
    return {
      id: i + 1,
      day,
      start,
      end,
      course: { id: idOf(DEMO.courses, (c) => c.code === code), code, name: course.name, color: course.color },
      teacher: { id: idOf(DEMO.teachers, (t) => t === teacher), name: teacher.name, short: teacher.short },
      room: { id: idOf(DEMO.rooms, (r) => r.name === roomName), name: roomName },
      batch: { id: idOf(DEMO.batches, (b) => b.name === batchName), name: batchName },
    };
  });
}

function demoChanges(classes: ClassInfo[], monday: string, now: Date): ChangeInfo[] {
  return DEMO.changes.flatMap((x, i): ChangeInfo[] => {
    const cls = classes.find((c) => c.batch.name === x.batch && c.day === x.day && c.start === x.start);
    if (!cls) return [];
    const occursOn = addDays(monday, x.day - 1);
    const change: Change = {
      id: i + 1,
      classId: cls.id,
      kind: x.kind as Change['kind'],
      course: { code: cls.course.code, name: cls.course.name, color: cls.course.color },
      batch: cls.batch,
      from: { date: occursOn, start: cls.start, end: cls.end, room: cls.room.name },
      to:
        x.kind === 'moved' && x.toDay && x.toStart && x.toEnd && x.toRoom
          ? { date: addDays(monday, x.toDay - 1), start: x.toStart, end: x.toEnd, room: x.toRoom }
          : null,
      reason: x.reason,
      by: x.by,
      at: new Date(now.getTime() - (i + 1) * 5 * 3_600_000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    };
    const toRoomId = change.to ? idOf(DEMO.rooms, (r) => r.name === change.to!.room) : null;
    return [{ change, occursOn, toRoomId }];
  });
}

/** The demo week containing `anyDate` for one batch (by name; default the first). */
export function demoWeek(anyDate: string, today: string, batchName?: string, now = new Date()): Week | null {
  const batch = batchName ? DEMO.batches.find((b) => b.name.toLowerCase() === batchName.toLowerCase()) : DEMO.batches[0];
  if (!batch) return null;
  const classes = demoClassInfo();
  const mine = classes.filter((c) => c.batch.name === batch.name);
  const changes = demoChanges(classes, mondayOf(today), now).filter((c) => c.change.batch.name === batch.name);
  return assembleWeek(weekFrame(anyDate, DEMO.workspace.days), { classes: mine, changes }, {
    timezone: DEMO.workspace.timezone,
    periods: DEFAULT_PERIODS,
    today,
  });
}
