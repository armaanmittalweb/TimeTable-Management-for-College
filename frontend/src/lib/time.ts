// Dates are 'YYYY-MM-DD' strings in the workspace's timezone; times are 'HH:MM'. All arithmetic is done on
// UTC midnights so a date never drifts across a daylight-saving change.

const MS_DAY = 86_400_000;
export const DAY_SHORT = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const DAY_LONG = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const parse = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export const isDate = (s: string | null | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(parse(s));
export const addDays = (d: string, n: number) => iso(parse(d) + n * MS_DAY);
/** ISO weekday, 1 = Monday … 7 = Sunday. */
export const dow = (d: string) => new Date(parse(d)).getUTCDay() || 7;
export const mondayOf = (d: string) => addDays(d, 1 - dow(d));
export const daysBetween = (a: string, b: string) => Math.round((parse(b) - parse(a)) / MS_DAY);

export const toMin = (t: string) => +t.slice(0, 2) * 60 + +t.slice(3, 5);
export const fromMin = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
export const overlaps = (aStart: string, aEnd: string, bStart: string, bEnd: string) => toMin(aStart) < toMin(bEnd) && toMin(bStart) < toMin(aEnd);

/** "28 Sep" */
export const dayMonth = (d: string) => `${+d.slice(8, 10)} ${MONTH[+d.slice(5, 7) - 1]}`;
/** "Tue 29 Sep" */
export const dayLabel = (d: string) => `${DAY_SHORT[dow(d)]} ${dayMonth(d)}`;
/** "Wednesday 30 September" */
export const longDay = (d: string) => `${DAY_LONG[dow(d)]} ${+d.slice(8, 10)} ${MONTH_LONG[+d.slice(5, 7) - 1]}`;
/** "28 Sep – 2 Oct 2026" */
export function rangeLabel(start: string, end: string) {
  const sameMonth = start.slice(0, 7) === end.slice(0, 7);
  const sameYear = start.slice(0, 4) === end.slice(0, 4);
  const a = sameMonth ? `${+start.slice(8, 10)}` : sameYear ? dayMonth(start) : `${dayMonth(start)} ${start.slice(0, 4)}`;
  return `${a} – ${dayMonth(end)} ${end.slice(0, 4)}`;
}

/** Today's date and the minutes since midnight in a timezone. */
export function nowIn(timezone: string, at = Date.now()) {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(at));
  } catch {
    parts = new Intl.DateTimeFormat('en-GB', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(at));
  }
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, minutes: +get('hour') * 60 + +get('minute') };
}

/** "2 h ago", "just now", "yesterday", "3 days ago", "12 Sep". */
export function ago(isoTime: string, at = Date.now()) {
  const s = Math.max(0, (at - new Date(isoTime).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 2 * 86_400) return 'yesterday';
  if (s < 7 * 86_400) return `${Math.floor(s / 86_400)} days ago`;
  return dayMonth(new Date(isoTime).toISOString().slice(0, 10));
}

/** "40 min", "1 h 20 min" */
export function duration(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** Local wall-clock "10:42" of an ISO instant, in a timezone. */
export function clockIn(isoTime: string | number, timezone?: string) {
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(isoTime));
  } catch {
    return new Date(isoTime).toTimeString().slice(0, 5);
  }
}

/** The date an ISO instant falls on in a timezone. */
export const dateIn = (isoTime: string, timezone: string) => nowIn(timezone, new Date(isoTime).getTime()).date;
