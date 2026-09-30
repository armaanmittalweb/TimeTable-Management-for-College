// Rooms: one day with rooms as columns, or the rooms free right now.

import { useMemo } from 'react';
import type { Occurrence, WorkspaceFull } from '../contract';
import { Icon } from '../ui/Icon';
import { Segmented } from '../ui/Segmented';
import { Link, setQuery, useLocation } from '../lib/router';
import { useDocumentTitle, useTick } from '../lib/hooks';
import { addDays, DAY_SHORT, dow, fromMin, longDay, mondayOf, nowIn, toMin } from '../lib/time';
import { duration } from '../lib/time';
import type { Scope } from '../state/scope';
import { GridSkeleton, TimeGrid, type Column } from '../week/TimeGrid';
import { ErrorState, useWeekData } from './Week';

export function RoomsScreen({ scope, full }: { scope: Scope; full: WorkspaceFull }) {
  const { query } = useLocation();
  const tick = useTick(30_000);
  const now = nowIn(scope.timezone, tick);
  const view = query.get('view') === 'free' ? 'free' : 'grid';
  const days = full.workspace.days.slice().sort();
  const thisMonday = mondayOf(now.date);
  const defaultDay = days.includes(dow(now.date)) ? now.date : addDays(thisMonday, days.find((d) => d > dow(now.date)) ? days.find((d) => d > dow(now.date))! - 1 : 7 + days[0] - 1);
  const dayParam = query.get('day');
  const day = dayParam && /^\d{4}-\d{2}-\d{2}$/.test(dayParam) ? dayParam : defaultDay;
  const monday = mondayOf(day);
  const q = useWeekData(scope, monday, {});
  useDocumentTitle(`Rooms · ${longDay(day)}`);

  const items = useMemo(() => (q.data?.occurrences ?? []).filter((o) => o.date === day), [q.data, day]);
  const rooms = full.rooms;
  const columns: Column[] = rooms.map((r) => {
    const mine = items.filter((o) => o.room.id === r.id);
    return {
      key: String(r.id),
      label: `${r.name}, ${r.capacity} seats`,
      head: (
        <>
          <span className="tg-date tg-room">{r.name}</span>
          <span className="tg-count">{r.capacity}{r.kind === 'lab' ? ' · lab' : ''}</span>
        </>
      ),
      isToday: false,
      items: mine,
    };
  });

  const weekDays = days.map((d) => addDays(monday, d - 1));

  return (
    <div className="page rooms">
      <header className="page-head">
        <div>
          <h1>Rooms</h1>
          <p className="page-sub">{view === 'free' ? `Free and busy at ${fromMin(now.minutes)}, ${longDay(now.date)}` : longDay(day)}</p>
        </div>
        <div className="page-tools">
          <Segmented<'grid' | 'free'> label="View" value={view} size="sm" onChange={(v) => setQuery({ view: v === 'free' ? 'free' : null })} options={[{ value: 'grid', label: 'Day grid' }, { value: 'free', label: 'Free now' }]} />
        </div>
      </header>
      {view === 'grid' && (
        <div className="rooms-days">
          <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Previous week" onClick={() => setQuery({ day: addDays(day, -7) })}>
            <Icon name="chevron-left" />
          </button>
          <Segmented<string>
            label="Day"
            value={day}
            size="sm"
            onChange={(d) => setQuery({ day: d === defaultDay ? null : d })}
            options={weekDays.map((d) => ({ value: d, label: <>{DAY_SHORT[dow(d)]} <span className="mono">{+d.slice(8)}</span>{d === now.date ? <span className="seg-today"> · today</span> : null}</> }))}
          />
          <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Next week" onClick={() => setQuery({ day: addDays(day, 7) })}>
            <Icon name="chevron-right" />
          </button>
        </div>
      )}
      {q.error && !q.data && !q.offlineSince ? (
        <ErrorState error={q.error} onRetry={q.reload} />
      ) : !q.data ? (
        <GridSkeleton days={Math.min(6, rooms.length || 6)} />
      ) : !rooms.length ? (
        <div className="empty">
          <h2>No rooms yet</h2>
          <p>{full.role === 'coordinator' ? <>Add rooms in <Link href={`${scope.base}/setup/rooms`}>Setup</Link> and they appear here.</> : 'Your coordinator hasn’t added any rooms.'}</p>
        </div>
      ) : view === 'grid' ? (
        <div className="rooms-grid">
          <TimeGrid
            periods={q.data.periods}
            columns={columns.map((c) => ({ ...c, isToday: false }))}
            nowMin={day === now.date ? now.minutes : null}
            meta="room-batch"
            label={`Rooms on ${longDay(day)}`}
            colMin={120}
            onOpen={(o) => setQuery({ day: null, view: null }) as unknown as void}
            className="is-rooms"
          />
        </div>
      ) : (
        <FreeNow items={(q.data.occurrences ?? []).filter((o) => o.date === now.date)} full={full} nowMin={now.minutes} isSchoolDay={days.includes(dow(now.date))} lastEnd={Math.max(...q.data.periods.map((p) => toMin(p.end)))} />
      )}
    </div>
  );
}

function FreeNow({ items, full, nowMin, isSchoolDay, lastEnd }: { items: Occurrence[]; full: WorkspaceFull; nowMin: number; isSchoolDay: boolean; lastEnd: number }) {
  const occupying = items.filter((o) => o.status === 'scheduled' || o.status === 'moved-here');
  const rows = full.rooms.map((r) => {
    const mine = occupying.filter((o) => o.room.id === r.id).sort((a, b) => a.start.localeCompare(b.start));
    const cur = mine.find((o) => toMin(o.start) <= nowMin && toMin(o.end) > nowMin);
    const next = mine.find((o) => toMin(o.start) > nowMin);
    return { r, cur, next };
  });
  const free = rows.filter((x) => !x.cur);
  const busy = rows.filter((x) => x.cur);
  if (!isSchoolDay || nowMin >= lastEnd) {
    return (
      <div className="empty">
        <h2>Every room is free</h2>
        <p>{isSchoolDay ? 'Classes are over for today.' : 'There are no classes today.'} Use the day grid to look at another day.</p>
      </div>
    );
  }
  return (
    <div className="freenow">
      <section>
        <h2 className="freenow-h">Free now <span className="mono">{free.length}</span></h2>
        <ul className="roomlist">
          {free.map(({ r, next }) => (
            <li key={r.id}>
              <span className="roomlist-name mono">{r.name}</span>
              <span className="roomlist-cap">{r.capacity} seats{r.kind === 'lab' ? ' · lab' : ''}{r.building ? ` · ${r.building}` : ''}</span>
              <span className="roomlist-until">{next ? <>free until <b className="mono">{next.start}</b> <span className="muted">({duration(toMin(next.start) - nowMin)})</span></> : 'free for the rest of the day'}</span>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h2 className="freenow-h">In use <span className="mono">{busy.length}</span></h2>
        <ul className="roomlist">
          {busy.map(({ r, cur }) => (
            <li key={r.id}>
              <span className="roomlist-name mono">{r.name}</span>
              <span className="roomlist-cap"><span className={`swatch c${cur!.course.color}`} aria-hidden="true" /> {cur!.course.code} · {cur!.batch.name} · {cur!.teacher.short}</span>
              <span className="roomlist-until">until <b className="mono">{cur!.end}</b></span>
            </li>
          ))}
          {!busy.length && <li className="roomlist-none">No room is in use right now.</li>}
        </ul>
      </section>
    </div>
  );
}
