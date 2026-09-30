// A small RFC 4180 reader that remembers which line each record started on, so an
// import report can say "line 14" even when a quoted field spans several lines.

export interface CsvRecord {
  line: number;
  fields: string[];
}

export class CsvError extends Error {
  constructor(
    readonly line: number,
    message: string,
  ) {
    super(message);
  }
}

export function parseCsv(text: string): CsvRecord[] {
  const src = text.replace(/^﻿/, '');
  const records: CsvRecord[] = [];
  let fields: string[] = [];
  let field = '';
  let line = 1;
  let recordLine = 1;
  let quoted = false;
  let i = 0;

  const endRecord = () => {
    fields.push(field);
    // blank lines are skipped, not reported
    if (fields.length > 1 || fields[0].trim() !== '') records.push({ line: recordLine, fields: fields.map((f) => f.trim()) });
    fields = [];
    field = '';
  };

  while (i < src.length) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"';
        i += 2;
        continue;
      }
      if (ch === '"') {
        quoted = false;
        i++;
        continue;
      }
      if (ch === '\n') line++;
      field += ch;
      i++;
      continue;
    }
    if (ch === '"' && field.trim() === '') {
      quoted = true;
      field = '';
      i++;
    } else if (ch === ',') {
      fields.push(field);
      field = '';
      i++;
    } else if (ch === '\r' || ch === '\n') {
      endRecord();
      i += ch === '\r' && src[i + 1] === '\n' ? 2 : 1;
      line++;
      recordLine = line;
    } else {
      field += ch;
      i++;
    }
  }
  if (quoted) throw new CsvError(recordLine, 'A quoted value is never closed.');
  if (field !== '' || fields.length) endRecord();
  return records;
}

/** Quotes a value for CSV output when it needs it. */
export const csvCell = (v: string | number | null) => {
  const s = v === null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
