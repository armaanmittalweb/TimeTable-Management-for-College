// RFC 5545 calendars. Pure: occurrences in, text out.
//
// Events carry local wall times with TZID, plus a VTIMEZONE built from the runtime's
// own tz database (Intl): offsets are sampled over the calendar's span and each
// transition becomes its own STANDARD/DAYLIGHT block. That needs no bundled zone
// data and is exact for the dates the feed covers.

import type { Occurrence } from './contract';
import { offsetMinutes, shortDate } from './dates';

const UID_HOST = 'edusched.amittal.dev';
const encoder = new TextEncoder();

/** TEXT value escaping (RFC 5545 3.3.11). */
export const escapeText = (s: string) =>
  s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Folds a content line at 75 octets without splitting a UTF-8 character (RFC 5545 3.1). */
export function foldLine(line: string): string {
  if (encoder.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = '';
  let bytes = 0;
  for (const ch of line) {
    const size = encoder.encode(ch).length;
    const limit = parts.length ? 74 : 75; // continuation lines start with a space
    if (bytes + size > limit) {
      parts.push(current);
      current = '';
      bytes = 0;
    }
    current += ch;
    bytes += size;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

const pad = (n: number, w = 2) => String(Math.abs(n)).padStart(w, '0');
const local = (date: string, time: string) => `${date.replace(/-/g, '')}T${time.replace(':', '')}00`;
const utcStamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const offset = (min: number) => `${min < 0 ? '-' : '+'}${pad(Math.floor(Math.abs(min) / 60))}${pad(Math.abs(min) % 60)}`;

/** Wall-clock timestamp (YYYYMMDDTHHMMSS) of a UTC instant seen at a fixed offset. */
function wallAt(instantMs: number, offsetMin: number) {
  return utcStamp(new Date(instantMs + offsetMin * 60_000)).slice(0, 15);
}

/** VTIMEZONE lines for `tz`, covering `fromDate`..`toDate` (padded a month each side). */
export function vtimezone(tz: string, fromDate: string, toDate: string): string[] {
  const DAY = 86_400_000;
  const start = Date.parse(`${fromDate}T00:00:00Z`) - 31 * DAY;
  const end = Date.parse(`${toDate}T00:00:00Z`) + 31 * DAY;
  const at = (ms: number) => offsetMinutes(tz, new Date(ms));

  const transitions: { ms: number; from: number; to: number }[] = [];
  let prev = at(start);
  for (let t = start + DAY; t <= end; t += DAY) {
    const cur = at(t);
    if (cur === prev) continue;
    let lo = t - DAY;
    let hi = t;
    while (hi - lo > 60_000) {
      const mid = lo + Math.floor((hi - lo) / 120_000) * 60_000;
      if (at(mid) === prev) lo = mid;
      else hi = mid;
    }
    transitions.push({ ms: hi, from: prev, to: cur });
    prev = cur;
  }

  const initial = at(start);
  const all = [initial, ...transitions.map((t) => t.to)];
  const standard = Math.min(...all);
  const block = (kind: 'STANDARD' | 'DAYLIGHT', dtstart: string, from: number, to: number) => [
    `BEGIN:${kind}`,
    `DTSTART:${dtstart}`,
    `TZOFFSETFROM:${offset(from)}`,
    `TZOFFSETTO:${offset(to)}`,
    `END:${kind}`,
  ];
  return [
    'BEGIN:VTIMEZONE',
    `TZID:${tz}`,
    ...block(initial === standard ? 'STANDARD' : 'DAYLIGHT', wallAt(start, initial), initial, initial),
    ...transitions.flatMap((t) => block(t.to === standard ? 'STANDARD' : 'DAYLIGHT', wallAt(t.ms, t.from), t.from, t.to)),
    'END:VTIMEZONE',
  ];
}

function describe(o: Occurrence): string {
  const lines = [`Teacher: ${o.teacher.name}`, `Batch: ${o.batch.name}`];
  const ch = o.change;
  if (ch?.kind === 'cancelled') lines.unshift('Cancelled.');
  if (ch && o.status === 'moved-here') lines.unshift(`Moved from ${shortDate(ch.from.date)} ${ch.from.start}, ${ch.from.room}.`);
  if (ch?.to && o.status === 'moved-away') lines.unshift(`Moved to ${shortDate(ch.to.date)} ${ch.to.start}, ${ch.to.room}.`);
  if (ch?.reason) lines.push(`Reason: ${ch.reason}`);
  return lines.join('\n');
}

/**
 * One VEVENT per occurrence, UID `<classId>-<original date>@edusched.amittal.dev`, so a
 * calendar updates the same event when a class is moved or cancelled. A moved class
 * appears once, at its new time. A moved-away occurrence is kept (as cancelled) only
 * when the feed does not show where it went, e.g. a room feed for the old room.
 */
export function buildCalendar(c: {
  name: string;
  timezone: string;
  from: string;
  to: string;
  occurrences: Occurrence[];
  now?: Date;
}): string {
  const stamp = utcStamp(c.now ?? new Date());
  const movedHere = new Set(c.occurrences.filter((o) => o.status === 'moved-here').map((o) => o.change!.id));
  const events = c.occurrences
    .filter((o) => !(o.status === 'moved-away' && movedHere.has(o.change!.id)))
    .flatMap((o) => {
      const original = o.change?.from.date ?? o.date;
      const off = o.status === 'cancelled' || o.status === 'moved-away';
      return [
        'BEGIN:VEVENT',
        `UID:${o.classId}-${original}@${UID_HOST}`,
        `DTSTAMP:${stamp}`,
        `DTSTART;TZID=${c.timezone}:${local(o.date, o.start)}`,
        `DTEND;TZID=${c.timezone}:${local(o.date, o.end)}`,
        `SUMMARY:${escapeText(`${off ? 'Cancelled: ' : ''}${o.course.code} ${o.course.name}`)}`,
        `LOCATION:${escapeText(o.room.name)}`,
        `DESCRIPTION:${escapeText(describe(o))}`,
        `STATUS:${off ? 'CANCELLED' : 'CONFIRMED'}`,
        `SEQUENCE:${o.change ? 1 : 0}`,
        ...(o.change ? [`LAST-MODIFIED:${utcStamp(new Date(o.change.at))}`] : []),
        'END:VEVENT',
      ];
    });
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//EduSched//edusched.amittal.dev//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(c.name)}`,
    `X-WR-TIMEZONE:${c.timezone}`,
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    ...vtimezone(c.timezone, c.from, c.to),
    ...events,
    'END:VCALENDAR',
  ];
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
