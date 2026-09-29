// Calendar helpers on 'YYYY-MM-DD' strings. "Today" is taken in the college's
// timezone (env TIMEZONE), since Workers run in UTC.

const formatters = new Map<string, Intl.DateTimeFormat>();

export function todayIn(timeZone: string, now = new Date()): string {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
    formatters.set(timeZone, f);
  }
  const parts = f.formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

const utc = (date: string) => new Date(`${date}T00:00:00Z`);

export const isDate = (v: unknown): v is string =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && utc(v).toISOString().startsWith(v);

// HH:MM or HH:MM:SS, 24h
export const isTime = (v: unknown): v is string =>
  typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(v);

export const normalizeTime = (t: string) => (t.length === 5 ? `${t}:00` : t);

export function addDays(date: string, days: number): string {
  const d = utc(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The Sunday that ends this week; on a Sunday, next Sunday (same rule as the Express code). */
export const endOfWeek = (date: string) => addDays(date, 7 - utc(date).getUTCDay());

/** ISO weekday, 1 = Monday ... 7 = Sunday (the convention regular_timetable.day_of_week uses). */
export const isoWeekday = (date: string) => utc(date).getUTCDay() || 7;
