// Students (class codes, no account) and calendar feeds.

import ICAL from 'ical.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { addDays } from '../src/dates';
import type { Db } from '../src/db';
import { buildCollege, expectStatus, freshPglite, harness, nextWeekday, pgliteDb, today, type Browser, type College, type Harness } from './helpers';

let db: Db;
let h: Harness;
let coord: Browser;
let college: College;
let code: string;
let moved: any;
let cancelled: any;

const MON = () => nextWeekday(1);

beforeAll(async () => {
  db = pgliteDb(await freshPglite());
  h = harness(db);
  coord = await h.signup('Chief');
  college = await buildCollege(coord);
  code = college.batches.codes[0]; // B1: k1 (Mon 09:00 R1) and k3 (Tue 10:00 R2)
  moved = expectStatus(
    await coord.post(`${college.w}/classes/${college.classes.k1}/move`, {
      date: MON(),
      toDate: addDays(MON(), 3),
      toStart: '14:00',
      toEnd: '15:00',
      roomId: college.rooms.r2,
      reason: 'Seminar, then lab; see notes',
    }),
    201,
  );
  cancelled = expectStatus(await coord.post(`${college.w}/classes/${college.classes.k3}/cancel`, { date: addDays(MON(), 1) }), 201);
});

describe('class codes', () => {
  it('opens a batch by code, case-insensitively', async () => {
    const anon = h.browser();
    const res = await anon.get(`/api/public/${code.toLowerCase()}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ code, batch: { id: college.batches.b1, name: 'B1' }, workspace: { name: 'Computer Science', days: [1, 2, 3, 4, 5] } });
    expect(res.body.periods).toHaveLength(8);
    expect((await anon.get('/api/public/NOPE-2345')).status).toBe(404);
  });

  it("shows the batch's week with changes applied", async () => {
    const week = expectStatus(await h.browser().get(`/api/public/${code}/week?start=${addDays(MON(), 2)}`), 200);
    expect(week.start).toBe(MON());
    expect(week.occurrences.map((o: any) => [o.classId, o.status])).toEqual([
      [college.classes.k1, 'moved-away'],
      [college.classes.k3, 'cancelled'],
      [college.classes.k1, 'moved-here'],
    ]);
  });

  it('lists the batch changes and today', async () => {
    const changes = expectStatus(await h.browser().get(`/api/public/${code}/changes`), 200);
    expect(changes.map((c: any) => c.id).sort()).toEqual([moved.id, cancelled.id].sort());
    const other = expectStatus(await h.browser().get(`/api/public/${college.batches.codes[1]}/changes`), 200);
    expect(other).toEqual([]);
    const todays = expectStatus(await h.browser().get(`/api/public/${code}/today`), 200);
    expect(todays.every((o: any) => o.date === today() && o.batch.id === college.batches.b1)).toBe(true);
  });

  it('works only while the workspace is published', async () => {
    const c2 = await h.signup();
    const other = await buildCollege(c2, 'Draft');
    const c = other.batches.codes[0];
    expect((await h.browser().get(`/api/public/${c}`)).status).toBe(200);
    await c2.post(`${other.w}/unpublish`);
    for (const path of [`/api/public/${c}`, `/api/public/${c}/week`, `/api/public/${c}/today`, `/api/public/${c}/changes`, `/ics/b/${c}.ics`]) {
      expect((await h.browser().get(path)).status).toBe(404);
    }
    expect((await h.browser().post('/api/join', { code: c })).status).toBe(404);
  });

  it('joins by class code without an account', async () => {
    const res = await h.browser().post('/api/join', { code: ` ${code.toLowerCase()} ` });
    expect(res.status).toBe(200);
    expect(res.body.batch).toEqual({ id: college.batches.b1, name: 'B1' });
  });
});

/** Unfolds content lines and returns the property lines of each VEVENT. */
function events(text: string) {
  const lines = text.replace(/\r\n /g, '').split('\r\n');
  const out: string[][] = [];
  let cur: string[] | null = null;
  for (const l of lines) {
    if (l === 'BEGIN:VEVENT') cur = [];
    else if (l === 'END:VEVENT') {
      out.push(cur!);
      cur = null;
    } else if (cur) cur.push(l);
  }
  return out;
}

describe('calendar feeds', () => {
  it('serves a valid RFC 5545 calendar for a class code', async () => {
    const res = await h.browser().get(`/ics/b/${code}.ics`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/calendar; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('max-age=900');
    const text = res.text;

    // CRLF only, every line at most 75 octets, folded lines start with a space
    expect(text.endsWith('\r\n')).toBe(true);
    expect(text.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    for (const line of text.split('\r\n')) expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(75);
    expect(text).toMatch(/\r\n BEGIN|\r\n [^\r]/); // at least one folded line (the long DESCRIPTION)

    // a real parser accepts it, with the timezone attached
    const cal = new ICAL.Component(ICAL.parse(text));
    const vtz = cal.getFirstSubcomponent('vtimezone')!;
    expect(vtz.getFirstPropertyValue('tzid')).toBe('Asia/Kolkata');
    expect(vtz.getFirstSubcomponent('standard')!.getFirstPropertyValue('tzoffsetto')!.toString()).toBe('+05:30');
    const vevents = cal.getAllSubcomponents('vevent');
    // two weeks back and eight ahead: 10 weeks x 2 classes for B1
    expect(vevents).toHaveLength(20);

    const byUid = new Map(vevents.map((e) => [e.getFirstPropertyValue('uid') as string, e]));
    const movedEvent = byUid.get(`${college.classes.k1}-${MON()}@edusched.amittal.dev`)!;
    const start = movedEvent.getFirstPropertyValue('dtstart') as ICAL.Time;
    expect(start.toString()).toBe(`${addDays(MON(), 3)}T14:00:00`);
    expect(start.zone?.tzid ?? movedEvent.getFirstProperty('dtstart')!.getParameter('tzid')).toBe('Asia/Kolkata');
    expect(movedEvent.getFirstPropertyValue('location')).toBe('R2');
    expect(movedEvent.getFirstPropertyValue('description')).toContain('Moved from');
    expect(movedEvent.getFirstPropertyValue('description')).toContain('Seminar, then lab; see notes');
    expect(movedEvent.getFirstPropertyValue('status')).toBe('CONFIRMED');

    const cancelledEvent = byUid.get(`${college.classes.k3}-${addDays(MON(), 1)}@edusched.amittal.dev`)!;
    expect(cancelledEvent.getFirstPropertyValue('status')).toBe('CANCELLED');
    expect((cancelledEvent.getFirstPropertyValue('dtstart') as ICAL.Time).toString()).toBe(`${addDays(MON(), 1)}T10:00:00`);

    // escaped text survives: comma and semicolon in the reason
    const raw = events(text).find((e) => e.includes(`UID:${college.classes.k1}-${MON()}@edusched.amittal.dev`))!;
    expect(raw.find((l) => l.startsWith('DESCRIPTION:'))).toContain('Seminar\\, then lab\\; see notes');
  });

  it('serves private teacher and room feeds by token', async () => {
    const { url } = expectStatus(await coord.post(`${college.w}/feeds`, { kind: 'room', targetId: college.rooms.r1 }), 200);
    const path = new URL(url).pathname;
    const res = await h.browser().get(path);
    expect(res.status).toBe(200);
    const cal = new ICAL.Component(ICAL.parse(res.text));
    const vevents = cal.getAllSubcomponents('vevent');
    // R1: k1 (Mon) and k4 (Wed) every week; the moved k1 appears as cancelled here, since it left R1
    const k1 = vevents.find((e) => e.getFirstPropertyValue('uid') === `${college.classes.k1}-${MON()}@edusched.amittal.dev`)!;
    expect(k1.getFirstPropertyValue('status')).toBe('CANCELLED');
    expect(k1.getFirstPropertyValue('description')).toContain('Moved to');
    expect(cal.getFirstPropertyValue('x-wr-calname')).toBe('R1 · Computer Science');

    const teacherFeed = expectStatus(await coord.post(`${college.w}/feeds`, { kind: 'teacher', targetId: college.teachers.t3 }), 200);
    const t = await h.browser().get(new URL(teacherFeed.url).pathname);
    expect(t.status).toBe(200);
    expect(events(t.text).every((e) => e.some((l) => l.startsWith('SUMMARY:') && l.includes('C3')))).toBe(true);

    expect((await h.browser().get('/ics/f/not-a-token.ics')).status).toBe(404);
    expect((await h.browser().get(`/ics/b/${code}`)).status).toBe(404); // needs the .ics
  });
});
