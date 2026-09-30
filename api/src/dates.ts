// Calendar helpers on 'YYYY-MM-DD' dates and 'HH:MM' times. Workers run in UTC, so
// "today" and "now" are always taken in a workspace's timezone.

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string) {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** Wall-clock date and time in `timeZone` at instant `now`. */
export function nowIn(timeZone: string, now = new Date()) {
  const parts = formatter(timeZone).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return {
    date: `${part('year')}-${part('month')}-${part('day')}`,
    time: `${part('hour')}:${part('minute')}`,
    seconds: Number(part('second')),
  };
}

export const todayIn = (timeZone: string, now = new Date()) => nowIn(timeZone, now).date;

/** UTC offset of `timeZone` at `instant`, in minutes (e.g. +330 for Asia/Kolkata). */
export function offsetMinutes(timeZone: string, instant: Date): number {
  const { date, time, seconds } = nowIn(timeZone, instant);
  const wall = Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10), +time.slice(0, 2), +time.slice(3, 5), seconds);
  return Math.round((wall - Math.floor(instant.getTime() / 1000) * 1000) / 60_000);
}

export function isTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const utc = (date: string) => new Date(`${date}T00:00:00Z`);

export const isDate = (v: unknown): v is string =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(utc(v).getTime()) && utc(v).toISOString().startsWith(v);

/** HH:MM (or HH:MM:SS), 24 h. */
export const isTime = (v: unknown): v is string => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d(:00)?$/.test(v);

export const hhmm = (t: string) => t.slice(0, 5);

export const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
export const fromMinutes = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export function addDays(date: string, days: number): string {
  const d = utc(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** ISO weekday, 1 = Monday ... 7 = Sunday. */
export const isoWeekday = (date: string) => utc(date).getUTCDay() || 7;

/** The Monday of the week containing `date`. */
export const mondayOf = (date: string) => addDays(date, 1 - isoWeekday(date));

/** Every date from `from` to `to`, inclusive. */
export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const FULL_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const dayName = (isoDay: number) => DAY_NAMES[isoDay - 1];

/** "Tue 29 Sep", for sentences a person reads. */
export const shortDate = (date: string) =>
  `${dayName(isoWeekday(date))} ${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1]}`;

/** Mon..Sun (any case, or full names) or 1..7 → ISO weekday; null if neither. */
export function parseDay(v: string): number | null {
  const s = v.trim().toLowerCase();
  if (/^[1-7]$/.test(s)) return Number(s);
  const i = s.length >= 3 ? FULL_DAYS.findIndex((d) => d.startsWith(s)) : -1;
  return i >= 0 ? i + 1 : null;
}
