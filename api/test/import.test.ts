import { beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../src/db';
import { expectStatus, freshPglite, harness, pgliteDb, type Browser, type Harness } from './helpers';

let db: Db;
let h: Harness;

beforeAll(async () => {
  db = pgliteDb(await freshPglite());
  h = harness(db);
});

async function workspace(): Promise<{ coord: Browser; w: string; id: number }> {
  const coord = await h.signup();
  const ws = expectStatus(await coord.post('/api/workspaces', { name: 'Import Test', institution: 'X' }), 201);
  return { coord, w: `/api/w/${ws.slug}`, id: ws.id };
}

const count = async (table: string, ws: number) =>
  (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table} WHERE workspace_id = $1`, [ws]))[0].n;

const imp = (coord: Browser, w: string, kind: string, csv: string, dryRun = false) => coord.post(`${w}/import`, { kind, csv, dryRun });

describe('CSV import', () => {
  it('dry-runs, then imports, a full college', async () => {
    const { coord, w, id } = await workspace();
    const rooms = 'name,capacity,building,kind\r\nCR-201,60,Main Block,lecture\r\nLAB-301,40,"Tech Block, 3rd floor",lab\r\n';
    const dry = expectStatus(await imp(coord, w, 'rooms', rooms, true), 200);
    expect(dry).toEqual({ ok: true, created: 2, updated: 0, errors: [] });
    expect(await count('rooms', id)).toBe(0); // a dry run writes nothing
    expect(expectStatus(await imp(coord, w, 'rooms', rooms), 200)).toEqual({ ok: true, created: 2, updated: 0, errors: [] });
    expect(expectStatus(await coord.get(`${w}/rooms`), 200).find((r: any) => r.name === 'LAB-301')).toMatchObject({ building: 'Tech Block, 3rd floor', kind: 'lab' });

    expect(expectStatus(await imp(coord, w, 'teachers', 'name,short,email\nNisha Rao,NR,nr@example.edu\nKabir Sethi,,\n'), 200)).toMatchObject({ ok: true, created: 2 });
    expect(expectStatus(await imp(coord, w, 'batches', 'name,size\nCSE-2A,58\nCSE-2B,\n'), 200)).toMatchObject({ ok: true, created: 2 });
    const batches = expectStatus(await coord.get(`${w}/batches`), 200);
    expect(batches.every((b: any) => /^CSE2[AB]-[A-HJKMNP-Z2-9]{4}$/.test(b.code))).toBe(true);
    expect(expectStatus(await imp(coord, w, 'courses', 'code,name,teacher,color\nCS201,Data Structures,NR,1\nCS203,Discrete Mathematics,Kabir Sethi,\n'), 200)).toMatchObject({ ok: true, created: 2 });

    const classes = [
      'day,start,end,course,batch,room,teacher',
      'Mon,09:00,10:00,CS201,CSE-2A,CR-201,NR',
      'tuesday,14:00,16:00,cs201,cse-2a,lab-301,',
      '3,10:00,11:00,CS203,CSE-2B,CR-201,KS',
    ].join('\n');
    expect(expectStatus(await imp(coord, w, 'classes', classes), 200)).toEqual({ ok: true, created: 3, updated: 0, errors: [] });
    const rows = expectStatus(await coord.get(`${w}/classes`), 200);
    expect(rows.map((r: any) => [r.day, r.start, r.end])).toEqual([[1, '09:00', '10:00'], [2, '14:00', '16:00'], [3, '10:00', '11:00']]);
    // re-importing the same file is harmless
    expect(expectStatus(await imp(coord, w, 'classes', classes), 200)).toEqual({ ok: true, created: 0, updated: 0, errors: [] });
  });

  it('updates existing rows by their natural key', async () => {
    const { coord, w, id } = await workspace();
    await imp(coord, w, 'rooms', 'name,capacity\nCR-201,60\n');
    expect(expectStatus(await imp(coord, w, 'rooms', 'name,capacity\ncr-201,75\nCR-202,30\n'), 200)).toEqual({ ok: true, created: 1, updated: 1, errors: [] });
    expect(await count('rooms', id)).toBe(2);
    expect(expectStatus(await coord.get(`${w}/rooms`), 200).find((r: any) => r.name === 'cr-201').capacity).toBe(75); // the file's spelling wins
  });

  it('reports every bad row by line and column, and writes nothing', async () => {
    const { coord, w, id } = await workspace();
    await imp(coord, w, 'rooms', 'name,capacity\nCR-201,60\n');
    const csv = [
      'name,capacity,kind', // line 1
      'CR-202,40,lecture', // 2: fine
      'CR-203,lots,lecture', // 3: bad capacity
      '', // 4: blank, skipped
      '"CR-204',
      'annex",0,lab', // 5-6: quoted multi-line name, bad capacity: reported on line 5
      'CR-202,10,lecture', // 7: repeats line 2
      'CR-205,10,garage', // 8: bad kind
    ].join('\n');
    const report = expectStatus(await imp(coord, w, 'rooms', csv), 200);
    expect(report.ok).toBe(false);
    expect(report.created).toBe(0);
    expect(report.errors).toEqual([
      { line: 3, column: 'capacity', message: 'capacity must be a whole number from 1 to 5000.' },
      { line: 5, column: 'capacity', message: 'capacity must be a whole number from 1 to 5000.' },
      { line: 7, column: 'name', message: '"CR-202" is already on line 2.' },
      { line: 8, column: 'kind', message: 'kind must be one of: lecture, lab.' },
    ]);
    expect(await count('rooms', id)).toBe(1);
  });

  it('checks the header', async () => {
    const { coord, w } = await workspace();
    const report = expectStatus(await imp(coord, w, 'rooms', 'name,seats,colour\nCR-1,10,red\n'), 200);
    expect(report.ok).toBe(false);
    expect(report.errors).toEqual([
      { line: 1, column: 'seats', message: expect.stringContaining('Unknown column "seats"') },
      { line: 1, column: 'colour', message: expect.stringContaining('Unknown column "colour"') },
      { line: 1, column: 'capacity', message: 'The "capacity" column is missing.' },
    ]);
    expect(expectStatus(await imp(coord, w, 'rooms', 'name,capacity\n'), 200).errors).toEqual([{ line: 1, message: 'The file has a header but no rows.' }]);
    expect(expectStatus(await imp(coord, w, 'rooms', 'name,capacity\n"CR-1,10\n'), 200).errors).toEqual([{ line: 2, message: 'A quoted value is never closed.' }]);
  });

  it('finds unknown references and clashes in a classes file, against the timetable and itself', async () => {
    const { coord, w, id } = await workspace();
    await imp(coord, w, 'rooms', 'name,capacity\nR1,60\nR2,60\n');
    await imp(coord, w, 'teachers', 'name,short\nTara One,T1\nTom Two,T2\n');
    await imp(coord, w, 'batches', 'name\nB1\nB2\n');
    await imp(coord, w, 'courses', 'code,name,teacher\nC1,One,T1\nC2,Two,T2\nC3,Three,\n');
    expectStatus(await imp(coord, w, 'classes', 'day,start,end,course,batch,room\nMon,09:00,10:00,C1,B1,R1\n'), 200);

    const csv = [
      'day,start,end,course,batch,room,teacher',
      'Mon,09:30,10:30,C2,B2,R1,', // 2: room clash with the existing class
      'Tue,09:00,10:00,C2,B2,R2,', // 3: fine
      'Tue,09:30,10:30,C2,B1,R1,', // 4: T2 clashes with line 3
      'Wed,09:00,10:00,C9,B1,R1,', // 5: unknown course
      'Someday,09:00,10:00,C1,B1,R1,', // 6: bad day
      'Thu,11:00,10:00,C1,B1,R1,', // 7: ends before it starts
      'Fri,09:00,10:00,C3,B1,R1,', // 8: C3 has no usual teacher
      'Fri,10:00,11:00,C1,B1,R1,XX', // 9: unknown teacher
    ].join('\n');
    const report = expectStatus(await imp(coord, w, 'classes', csv, true), 200);
    expect(report.ok).toBe(false);
    expect(report.errors).toEqual([
      { line: 2, column: 'room', message: 'R1 is booked at Mon 09:00 by C1.' },
      { line: 4, column: 'teacher', message: 'Tom Two teaches C2 at Tue 09:00 (line 3).' },
      { line: 5, column: 'course', message: 'There is no course "C9". Import courses first.' },
      { line: 6, column: 'day', message: '"Someday" is not a day. Use Mon to Sun or 1 to 7.' },
      { line: 7, column: 'end', message: 'A class must end after it starts.' },
      { line: 8, column: 'teacher', message: 'C3 has no usual teacher, so this row needs one.' },
      { line: 9, column: 'teacher', message: 'There is no teacher "XX". Import teachers first.' },
    ]);
    expect(await count('classes', id)).toBe(1);
  });

  it('respects limits and the 512 KB size cap, and is coordinator-only', async () => {
    const { coord, w } = await workspace();
    const many = ['name,capacity', ...Array.from({ length: 201 }, (_, i) => `Room ${i},10`)].join('\n');
    const report = expectStatus(await imp(coord, w, 'rooms', many), 200);
    expect(report.ok).toBe(false);
    expect(report.errors[0].message).toContain('at most 200 rooms');

    const big = 'name,capacity\n' + 'x'.repeat(600 * 1024);
    const tooBig = await imp(coord, w, 'rooms', big);
    expect(tooBig.status).toBe(413);
    expect(tooBig.body.code).toBe('too_large');
    // between 64 KB and 512 KB is fine for an import
    const medium = ['name,capacity', ...Array.from({ length: 150 }, (_, i) => `Room ${i} ${'y'.repeat(30)},10`)].join('\n') + '\n'.repeat(70 * 1024);
    expect(expectStatus(await imp(coord, w, 'rooms', medium, true), 200)).toMatchObject({ ok: true, created: 150 });

    expect((await imp(coord, w, 'planets', 'a\n1\n')).status).toBe(400);
    expect((await coord.post(`${w}/import`, { kind: 'rooms', csv: 'name,capacity\nA,1\n' })).status).toBe(400); // dryRun missing
  });
});
