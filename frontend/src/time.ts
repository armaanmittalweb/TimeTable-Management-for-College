// Dates are 'YYYY-MM-DD' strings in the college's timezone, the same "today"
// the API uses for expiry and the earliest allowed postpone date.

export const COLLEGE_TZ = 'Asia/Kolkata';
export const COLLEGE_TZ_LABEL = 'IST';

const fmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: COLLEGE_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

export function collegeNow(now = new Date()): { date: string; time: string } {
  const p = Object.fromEntries(fmt.formatToParts(now).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}:${p.second}` };
}

export const collegeToday = () => collegeNow().date;

const utc = (date: string) => new Date(`${date}T00:00:00Z`);

export function addDays(date: string, days: number): string {
  const d = utc(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** ISO weekday: 1 = Monday ... 7 = Sunday. */
export const isoWeekday = (date: string) => utc(date).getUTCDay() || 7;

/** Monday..Friday dates of the week the board shows: this week, or next week on a weekend. */
export function boardWeek(today: string): string[] {
  const dow = isoWeekday(today);
  const monday = dow >= 6 ? addDays(today, 8 - dow) : addDays(today, 1 - dow);
  return [0, 1, 2, 3, 4].map((i) => addDays(monday, i));
}

/** Default day tab: today, or Monday on a weekend. */
export const defaultDay = (today: string) => {
  const dow = isoWeekday(today);
  return dow >= 6 ? 1 : dow;
};

export const DAY_SHORT = ['', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
export const DAY_LONG = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MONTH_SHORT = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** '09:00:00' -> '09:00' */
export const hhmm = (t: string | null | undefined) => (t ? t.slice(0, 5) : '');

/** '2026-09-30' -> '30 SEP' */
export const dayMonth = (date: string) => `${date.slice(8, 10)} ${MONTH_SHORT[Number(date.slice(5, 7)) - 1]}`;

/** '2026-09-30' -> 'WED 30 SEP' */
export const shortDate = (date: string) => `${DAY_SHORT[isoWeekday(date)]} ${dayMonth(date)}`;

/** '2026-09-30' -> 'Wednesday 30 September' (for screen readers) */
export const longDate = (date: string) =>
  `${DAY_LONG[isoWeekday(date)]} ${Number(date.slice(8, 10))} ${MONTH_LONG[Number(date.slice(5, 7)) - 1]}`;

/** '2026-09-29' -> 'TUE 29 SEP 2026' */
export const headerDate = (date: string) => `${shortDate(date)} ${date.slice(0, 4)}`;

/** Minutes since midnight for 'HH:MM[:SS]'. */
export const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
export const fromMinutes = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
