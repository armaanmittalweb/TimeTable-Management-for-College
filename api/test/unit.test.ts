// Pure helpers: CSV, ICS folding and time zones, dates, slots.

import ICAL from 'ical.js';
import { describe, expect, it } from 'vitest';
import { parseCsv } from '../src/csv';
import { isoWeekday, mondayOf, nowIn, offsetMinutes, parseDay } from '../src/dates';
import { buildCalendar, escapeText, foldLine, vtimezone } from '../src/ics';
import { slotAvailability } from '../src/slots';
import { batchCode, CODE_ALPHABET, randomCode } from '../src/tokens';

describe('csv', () => {
  it('parses quotes, escaped quotes, CRLF and multi-line values with record line numbers', () => {
    const rows = parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n\r\n"multi\nline",z\nlast,one');
    expect(rows).toEqual([
      { line: 1, fields: ['a', 'b'] },
      { line: 2, fields: ['x, y', 'say "hi"'] },
      { line: 4, fields: ['multi\nline', 'z'] },
      { line: 6, fields: ['last', 'one'] },
    ]);
  });
});

describe('dates', () => {
  it('parses days and finds Mondays', () => {
    expect(['Mon', 'monday', 'TUE', 'wed', 'Th', 'thurs', '7', '0', 'funday'].map(parseDay)).toEqual([1, 1, 2, 3, null, 4, 7, null, null]);
    expect(mondayOf('2026-10-04')).toBe('2026-09-28'); // a Sunday
    expect(mondayOf('2026-09-28')).toBe('2026-09-28');
    expect(isoWeekday('2026-09-29')).toBe(2);
  });

  it('reads wall-clock time and offsets in a zone', () => {
    const instant = new Date('2026-09-29T20:00:00Z');
    expect(nowIn('Asia/Kolkata', instant)).toMatchObject({ date: '2026-09-30', time: '01:30' });
    expect(offsetMinutes('Asia/Kolkata', instant)).toBe(330);
    expect(offsetMinutes('America/New_York', new Date('2026-01-15T12:00:00Z'))).toBe(-300);
    expect(offsetMinutes('America/New_York', new Date('2026-07-15T12:00:00Z'))).toBe(-240);
  });
});

describe('codes', () => {
  it('never uses 0, O, 1, I or L', () => {
    expect(CODE_ALPHABET).not.toMatch(/[0O1IL]/);
    expect(randomCode(400)).toMatch(/^[A-HJKMNP-Z2-9]+$/);
    expect(batchCode('CSE-2A')).toMatch(/^CSE2A-[A-HJKMNP-Z2-9]{4}$/);
    expect(batchCode('Ünïcode ☃')).toMatch(/^NCODE-/);
  });
});

describe('ics', () => {
  it('escapes text and folds at 75 octets without splitting characters', () => {
    expect(escapeText('a,b;c\\d\ne')).toBe('a\\,b\\;c\\\\d\\ne');
    const line = `DESCRIPTION:${'é'.repeat(100)}`;
    const folded = foldLine(line);
    const parts = folded.split('\r\n');
    expect(parts.length).toBeGreaterThan(2);
    for (const p of parts) expect(Buffer.byteLength(p, 'utf8')).toBeLessThanOrEqual(75);
    expect(parts.slice(1).every((p) => p.startsWith(' '))).toBe(true);
    expect(folded.replace(/\r\n /g, '')).toBe(line);
    expect(foldLine('SHORT:x')).toBe('SHORT:x');
  });

  it('describes a zone with daylight saving as its real transitions', () => {
    const lines = vtimezone('Europe/London', '2026-09-14', '2026-11-22');
    expect(lines[0]).toBe('BEGIN:VTIMEZONE');
    // BST (+0100) at the start, then the switch to GMT on 25 Oct 2026 at 02:00 local
    expect(lines).toEqual(
      expect.arrayContaining(['BEGIN:STANDARD', 'DTSTART:20261025T020000', 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0000']),
    );
    expect(lines).toContain('BEGIN:DAYLIGHT');
  });

  it('produces a calendar a parser reads, with times in the named zone', () => {
    const occ = {
      key: '7:2026-10-26',
      classId: 7,
      date: '2026-10-26',
      start: '09:00',
      end: '10:00',
      course: { id: 1, code: 'CS201', name: 'Data Structures', color: 1 },
      teacher: { id: 1, name: 'Nisha Rao', short: 'NR' },
      room: { id: 1, name: 'CR-201' },
      batch: { id: 1, name: 'CSE-2A' },
      status: 'scheduled' as const,
      change: null,
    };
    const text = buildCalendar({ name: 'CSE-2A', timezone: 'Europe/London', from: '2026-10-12', to: '2026-12-20', occurrences: [occ] });
    const cal = new ICAL.Component(ICAL.parse(text));
    const vtz = new ICAL.Timezone(cal.getFirstSubcomponent('vtimezone')!);
    const ev = cal.getFirstSubcomponent('vevent')!;
    const start = ev.getFirstPropertyValue('dtstart') as ICAL.Time;
    start.zone = vtz;
    // 09:00 in London on 26 Oct 2026 is after the clocks go back: 09:00 UTC
    expect(start.toJSDate().toISOString()).toBe('2026-10-26T09:00:00.000Z');
    expect(ev.getFirstPropertyValue('uid')).toBe('7-2026-10-26@edusched.amittal.dev');
  });
});

describe('slots', () => {
  const periods = [
    { idx: 1, start: '09:00', end: '10:00', label: null, isBreak: false },
    { idx: 2, start: '10:00', end: '11:00', label: null, isBreak: false },
    { idx: 3, start: '11:00', end: '12:00', label: 'Lunch', isBreak: true },
    { idx: 4, start: '12:00', end: '13:00', label: null, isBreak: false },
  ];
  const rooms = [
    { id: 1, name: 'Big', capacity: 100, building: null, kind: 'lecture' as const },
    { id: 2, name: 'Small', capacity: 20, building: null, kind: 'lecture' as const },
  ];

  it('skips the past, breaks and rooms that are too small', () => {
    const slots = slotAvailability({
      cls: { start: '09:00', end: '10:00', teacherId: 1, batchId: 1 },
      exclude: null,
      dates: ['2026-10-01', '2026-10-02'],
      periods,
      bookings: [{ date: '2026-10-02', occursOn: '2026-10-02', classId: 9, roomId: 1, teacherId: 1, batchId: 5, start: '12:00', end: '13:00' }],
      rooms,
      batchSize: 50,
      now: { date: '2026-10-01', time: '09:30' },
    });
    expect(slots.map((s) => `${s.date} ${s.start}`)).toEqual(['2026-10-01 10:00', '2026-10-01 12:00', '2026-10-02 09:00', '2026-10-02 10:00', '2026-10-02 12:00']);
    expect(slots.at(-1)).toEqual({ date: '2026-10-02', start: '12:00', end: '13:00', teacherBusy: true, batchBusy: false, freeRooms: [] });
    expect(slots[0].freeRooms).toEqual([{ id: 1, name: 'Big', capacity: 100 }]);
  });
});
