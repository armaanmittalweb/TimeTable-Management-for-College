// Today (the phone's home): the next class as a large card, the rest of the day as a list, and changes that
// affect the day on top. A strip of the week's days picks another day.

import { useMemo } from 'react';
import type { Occurrence, WorkspaceFull } from '../contract';
import { Icon } from '../ui/Icon';
import { setQuery, useLocation } from '../lib/router';
import { useDocumentTitle, useTick } from '../lib/hooks';
import { addDays, DAY_SHORT, dayLabel, dow, duration, longDay, mondayOf, nowIn, toMin } from '../lib/time';
import { plural, savedAt } from '../lib/format';
import type { Scope } from '../state/scope';
import { ErrorState, resolveFilter, useWeekData } from './Week';

export function TodayScreen({ scope, full, title }: { scope: Scope; full?: WorkspaceFull; title: string }) {
  const { query } = useLocation();
  const tick = useTick(30_000);
  const now = nowIn(scope.timezone, tick);
  const dayParam = query.get('day');
  const day = dayParam && /^\d{4}-\d{2}-\d{2}$/.test(dayParam) ? dayParam : now.date;
  const filter = resolveFilter(query, full);
  const f = filter ? { [filter.kind]: filter.id } : {};
  const monday = mondayOf(day);
  const q = useWeekData(scope, monday, f);
  const week = q.data;
  const afterWeek = week && !week.occurrences.some((o) => live(o) && (o.date > now.date || (o.date === now.date && toMin(o.start) > now.minutes)));
  const nextQ = useWeekData(scope, afterWeek ? addDays(monday, 7) : monday, f);
  const isToday = day === now.date;
  const filterName = filter ? (filter.kind === 'batch' ? full?.batches.find((b) => b.id === filter.id)?.name : filter.kind === 'teacher' ? full?.teachers.find((t) => t.id === filter.id)?.name : full?.rooms.find((x) => x.id === filter.id)?.name) : title;
  useDocumentTitle(`${isToday ? 'Today' : longDay(day)} · ${filterName ?? title}`);

  const items = useMemo(() => (week ? week.occurrences.filter((o) => o.date === day) : []), [week, day]);
  const changes = items.filter((o) => o.status !== 'scheduled');
  const upcoming = items.filter((o) => live(o) && toMin(o.end) > now.minutes);
  const current = isToday ? upcoming[0] : undefined;
  const nextAny = useMemo(() => {
    const pool = [...(week?.occurrences ?? []), ...(afterWeek ? nextQ.data?.occurrences ?? [] : [])];
    return pool.find((o) => live(o) && (o.date > day || (o.date === day && isToday && toMin(o.start) > now.minutes)));
  }, [week, nextQ.data, afterWeek, day, isToday, now.minutes]);

  const strip = week?.days ?? Array.from({ length: 5 }, (_, i) => addDays(monday, i));

  return (
    <div className="today">
      <header className="today-head">
        <div>
          <h1 className="today-title">{isToday ? 'Today' : longDay(day)}</h1>
          <p className="today-sub">
            {isToday ? longDay(day) : ''}
            {isToday && filterName ? ' · ' : ''}
            {filterName}
          </p>
        </div>
        {full && full.role !== 'student' && filter && (
          <div className="today-filter">
            <label className="sr-only" htmlFor="today-pick">Whose day</label>
            <select
              id="today-pick"
              className="select select-sm"
              value={`${filter.kind}:${filter.id}`}
              onChange={(e) => {
                const [k, id] = e.target.value.split(':');
                setQuery({ batch: null, teacher: null, room: null, [k]: id });
              }}
            >
              <optgroup label="Batches">{full.batches.map((b) => <option key={b.id} value={`batch:${b.id}`}>{b.name}</option>)}</optgroup>
              <optgroup label="Teachers">{full.teachers.map((t) => <option key={t.id} value={`teacher:${t.id}`}>{t.name}{t.id === full.teacherId ? ' (you)' : ''}</option>)}</optgroup>
              <optgroup label="Rooms">{full.rooms.map((r) => <option key={r.id} value={`room:${r.id}`}>{r.name}</option>)}</optgroup>
            </select>
          </div>
        )}
      </header>

      <nav className="strip" aria-label="Days this week">
        <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Previous week" onClick={() => setQuery({ day: addDays(monday, -7) })}>
          <Icon name="chevron-left" />
        </button>
        {strip.map((d) => {
          const n = week?.occurrences.filter((o) => o.date === d && live(o)).length;
          const changed = week?.occurrences.some((o) => o.date === d && o.status !== 'scheduled');
          return (
            <button key={d} type="button" className={`strip-day${d === day ? ' is-on' : ''}${d === now.date ? ' is-today' : ''}`} aria-current={d === day ? 'date' : undefined} onClick={() => setQuery({ day: d === now.date ? null : d })}>
              <span className="strip-dow">{DAY_SHORT[dow(d)]}</span>
              <span className="strip-date">{+d.slice(8)}</span>
              <span className="strip-n mono">{n === undefined ? ' ' : n ? n : '–'}{changed && <span className="dot" aria-label=", changed" />}</span>
            </button>
          );
        })}
        <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Next week" onClick={() => setQuery({ day: addDays(monday, 7) })}>
          <Icon name="chevron-right" />
        </button>
      </nav>

      {q.offlineSince && (
        <p className="banner" role="status"><Icon name="offline" /> Offline · showing the copy from {savedAt(q.offlineSince)}</p>
      )}

      {q.error && !week && !q.offlineSince ? (
        <ErrorState error={q.error} onRetry={q.reload} />
      ) : !week ? (
        <div className="today-body" aria-busy="true">
          <div className="skel" style={{ height: 148, borderRadius: 8 }} />
          {[0, 1, 2].map((i) => <div key={i} className="skel" style={{ height: 52, marginTop: 10 }} />)}
        </div>
      ) : (
        <div className="today-body">
          {changes.length > 0 && (
            <ul className="today-changes" aria-label="Changes today">
              {changes.map((o) => (
                <li key={o.key}>
                  <Icon name={o.status === 'cancelled' ? 'ban' : 'changes'} />
                  <span>
                    <b>{o.course.code}</b>{' '}
                    {o.status === 'cancelled' && `at ${o.start} is cancelled`}
                    {o.status === 'moved-away' && o.change?.to && `at ${o.start} moved to ${dayLabel(o.change.to.date)}, ${o.change.to.start} in ${o.change.to.room}`}
                    {o.status === 'moved-here' && o.change && `moved here from ${dayLabel(o.change.from.date)}: ${o.start} in ${o.room.name}`}
                    {o.change?.reason && <span className="today-reason"> “{o.change.reason}”</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {current && <NextCard o={current} nowMin={now.minutes} />}

          {items.length > 0 ? (
            <ol className="dayl" aria-label={`Classes on ${longDay(day)}`}>
              {items.map((o) => {
                const done = isToday ? toMin(o.end) <= now.minutes : day < now.date;
                const isNow = isToday && live(o) && toMin(o.start) <= now.minutes && toMin(o.end) > now.minutes;
                return (
                  <li key={o.key} className={`dayl-row c${o.course.color} is-${o.status}${done ? ' is-done' : ''}${isNow ? ' is-now' : ''}`}>
                    <span className="dayl-time mono">
                      {o.start}
                      <span>{o.end}</span>
                    </span>
                    <span className="dayl-bar" aria-hidden="true" />
                    <span className="dayl-main">
                      <span className="dayl-code">{o.course.code}</span>
                      <span className="dayl-name">{o.course.name}</span>
                    </span>
                    <span className="dayl-room mono">{o.status === 'moved-away' && o.change?.to ? `→ ${DAY_SHORT[dow(o.change.to.date)]} ${o.change.to.start}` : o.room.name}</span>
                    <span className="dayl-who">{filter?.kind === 'teacher' ? o.batch.name : o.teacher.name}</span>
                    <span className="dayl-state">
                      {isNow && <span className="chip chip-now">Now</span>}
                      {o.status === 'cancelled' && <span className="chip">Cancelled</span>}
                      {o.status === 'moved-here' && <span className="chip chip-changed">Moved here</span>}
                      {o.status === 'moved-away' && <span className="chip chip-changed">Moved</span>}
                      {done && live(o) && !isNow && <span className="dayl-done">Done</span>}
                    </span>
                  </li>
                );
              })}
            </ol>
          ) : (
            <div className="today-empty">
              <p className="today-empty-h">No classes {isToday ? 'today' : `on ${longDay(day).split(' ')[0]}`}.</p>
              {nextAny ? (
                <p>
                  Next: <b>{DAY_SHORT[dow(nextAny.date)]} <span className="mono">{nextAny.start}</span> {nextAny.course.code}</b> in {nextAny.room.name}
                </p>
              ) : (
                <p>Nothing else is scheduled this week.</p>
              )}
            </div>
          )}
          {isToday && items.length > 0 && !upcoming.length && (
            <p className="today-after">
              That’s it for today.
              {nextAny && <> Next: <b>{dayLabel(nextAny.date)} <span className="mono">{nextAny.start}</span> {nextAny.course.code}</b>, {nextAny.room.name}.</>}
            </p>
          )}
          {items.length > 0 && (
            <p className="today-foot mono">{plural(items.filter(live).length, 'class', 'classes')} · {duration(items.filter(live).reduce((m, o) => m + toMin(o.end) - toMin(o.start), 0))}</p>
          )}
        </div>
      )}
    </div>
  );
}

const live = (o: Occurrence) => o.status === 'scheduled' || o.status === 'moved-here';

function NextCard({ o, nowMin }: { o: Occurrence; nowMin: number }) {
  const s = toMin(o.start);
  const e = toMin(o.end);
  const running = s <= nowMin;
  const pct = running ? Math.round(((nowMin - s) / (e - s)) * 100) : 0;
  return (
    <section className={`next c${o.course.color}${running ? ' is-running' : ''}`} aria-label={running ? 'Happening now' : 'Next class'}>
      <p className="next-when">
        {running ? <><span className="chip chip-now">Now</span> {duration(e - nowMin)} left</> : <>Next · starts in {duration(s - nowMin)}</>}
      </p>
      <h2 className="next-title">
        <span className="next-code">{o.course.code}</span> {o.course.name}
      </h2>
      <div className="next-facts">
        <div><span>Room</span><b className="mono">{o.room.name}</b></div>
        <div><span>Time</span><b className="mono">{o.start}–{o.end}</b></div>
        <div><span>Teacher</span><b>{o.teacher.name}</b></div>
      </div>
      {running && (
        <div className="next-progress" role="progressbar" aria-label="Class progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
          <span style={{ width: `${pct}%` }} />
        </div>
      )}
      {o.status === 'moved-here' && o.change && <p className="next-moved">Moved here from {dayLabel(o.change.from.date)}, {o.change.from.start}.</p>}
    </section>
  );
}
