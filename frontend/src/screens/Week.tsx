// The home screen: one week of the timetable for a batch, a teacher or a room.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Occurrence, Week, WorkspaceFull } from '../contract';
import { api, ApiFailure, batchFeedUrl, type WeekFilter } from '../api';
import { Icon } from '../ui/Icon';
import { Dialog } from '../ui/Dialog';
import { MenuItem, Popover, usePopover } from '../ui/Menu';
import { Segmented } from '../ui/Segmented';
import { toast } from '../ui/Toast';
import { Link, setQuery, useLocation } from '../lib/router';
import { useDocumentTitle, useHotkey, useMedia, useTick } from '../lib/hooks';
import { addDays, ago, DAY_LONG, DAY_SHORT, dayLabel, dow, longDay, nowIn, rangeLabel, toMin } from '../lib/time';
import { movedToast, plural, savedAt } from '../lib/format';
import { ChangeText } from '../ui/ChangeText';
import { invalidate, useQuery } from '../state/query';
import { canChange } from '../state/workspace';
import { weekStartFor, type Scope } from '../state/scope';
import { GridSkeleton, TimeGrid, type Column, type Meta } from '../week/TimeGrid';
import { ClassPanel } from '../week/ClassPanel';
import { ConfirmBar, FreeSlotList, SlotOverlay, slotId, useDrag, useReschedule } from '../week/Reschedule';

type FilterKind = 'batch' | 'teacher' | 'room';

/** The filter in the URL, or the natural one for this person. */
export function resolveFilter(query: URLSearchParams, full?: WorkspaceFull): { kind: FilterKind; id: number } | null {
  if (!full) return null;
  if (full.role === 'student' && full.batchId) return { kind: 'batch', id: full.batchId };
  for (const k of ['batch', 'teacher', 'room'] as const) {
    const v = Number(query.get(k));
    const list = k === 'batch' ? full.batches : k === 'teacher' ? full.teachers : full.rooms;
    if (v && list.some((x) => x.id === v)) return { kind: k, id: v };
  }
  if (full.role === 'teacher' && full.teacherId) return { kind: 'teacher', id: full.teacherId };
  if (full.batches[0]) return { kind: 'batch', id: full.batches[0].id };
  return null;
}
const asFilter = (f: { kind: FilterKind; id: number } | null): WeekFilter => (f ? { [f.kind]: f.id } : {});

export function useWeekData(scope: Scope, start: string, filter: WeekFilter) {
  const fk = JSON.stringify(filter);
  return useQuery<Week>(`${scope.id}:week:${start}:${fk}`, () => scope.week(start, filter), { persist: scope.cacheKey(start, filter) });
}

export function buildColumns(week: Week, today: string, filterItems?: (o: Occurrence) => boolean): Column[] {
  return week.days.map((d) => {
    const items = week.occurrences.filter((o) => o.date === d && (!filterItems || filterItems(o)));
    const live = items.filter((o) => o.status === 'scheduled' || o.status === 'moved-here').length;
    const changed = items.some((o) => o.status !== 'scheduled');
    const isToday = d === today;
    return {
      key: d,
      isToday,
      isPast: d < today,
      label: `${longDay(d)}${isToday ? ', today' : ''}, ${plural(live, 'class', 'classes')}`,
      head: (
        <>
          <span className="tg-dow">{DAY_SHORT[dow(d)]}</span>
          <span className="tg-date">{+d.slice(8)}</span>
          {isToday && <span className="tg-today-tag">Today</span>}
          {changed && <span className="dot" title="Changed this week" />}
        </>
      ),
      items,
    };
  });
}

export function WeekScreen({ scope, full, title }: { scope: Scope; full?: WorkspaceFull; title: string }) {
  const { query } = useLocation();
  const wide = useMedia('(min-width: 1180px)');
  const phone = useMedia('(max-width: 720px)');
  const tick = useTick(30_000);
  const now = nowIn(scope.timezone, tick);
  const start = weekStartFor(query.get('week'), scope.timezone);
  const filter = resolveFilter(query, full);
  const f = asFilter(filter);
  const q = useWeekData(scope, start, f);
  const week = q.data;
  const [selected, setSelected] = useState<string | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [cancelOcc, setCancelOcc] = useState<Occurrence | null>(null);
  const [feedOpen, setFeedOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const flip = useRef<{ key: string; rect: DOMRect } | null>(null);
  const r = useReschedule(full);

  const filterName = filter
    ? filter.kind === 'batch' ? full!.batches.find((b) => b.id === filter.id)?.name
    : filter.kind === 'teacher' ? full!.teachers.find((t) => t.id === filter.id)?.name
    : full!.rooms.find((x) => x.id === filter.id)?.name
    : title;
  useDocumentTitle(`${filterName ?? title} · ${rangeLabel(start, addDays(start, 4))}`);

  const occ = week?.occurrences.find((o) => o.key === selected) ?? null;
  const today = week?.today ?? now.date;

  // ?open=KEY (from Rooms, Changes) opens that class.
  const openParam = query.get('open');
  useEffect(() => {
    if (!openParam || !week) return;
    if (week.occurrences.some((o) => o.key === openParam)) {
      setSelected(openParam);
      setFocusKey(openParam);
    }
    setQuery({ open: null });
  }, [openParam, week]);

  // ?course=ID (from search) opens that course's next class this week.
  const courseParam = query.get('course');
  useEffect(() => {
    if (!courseParam || !week) return;
    const list = week.occurrences.filter((o) => String(o.course.id) === courseParam && o.status !== 'moved-away');
    const next = list.find((o) => o.date > today || (o.date === today && toMin(o.end) > now.minutes)) ?? list[0];
    if (next) setSelected(next.key);
    setQuery({ course: null });
  }, [courseParam, week, today, now.minutes]);

  // Keep reschedule slots in step with the shown week.
  const setReschedWeek = r.setWeek;
  useEffect(() => setReschedWeek(start), [start, setReschedWeek]);

  const goWeek = useCallback((delta: number) => setQuery({ week: addDays(start, delta * 7) === weekStartFor(null, scope.timezone) ? null : addDays(start, delta * 7) }), [start, scope.timezone]);
  useHotkey('ArrowLeft', () => goWeek(-1));
  useHotkey('ArrowRight', () => goWeek(1));
  useHotkey('t', () => setQuery({ week: null }));
  useHotkey('Escape', () => {
    if (r.st) r.stop();
    else if (selected) close();
  });

  const open = (o: Occurrence, el: HTMLElement) => {
    if (r.st) return;
    opener.current = el;
    setSelected(o.key);
    setFocusKey(o.key);
  };
  const close = () => {
    setSelected(null);
    const el = opener.current;
    requestAnimationFrame(() => el?.isConnected && el.focus());
  };
  // Move focus into the panel when it opens beside the grid.
  useEffect(() => {
    if (selected && wide) heading.current?.focus();
  }, [selected, wide]);

  // After a move lands, slide the class from where it was to its new slot (≤200 ms, none if reduced motion).
  useLayoutEffect(() => {
    const f0 = flip.current;
    if (!f0 || !week || !gridRef.current) return;
    const el = gridRef.current.querySelector<HTMLElement>(`[data-key="${f0.key}"]`);
    if (!el) return;
    flip.current = null;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const to = el.getBoundingClientRect();
    el.animate([{ transform: `translate(${f0.rect.left - to.left}px, ${f0.rect.top - to.top}px)` }, { transform: 'none' }], { duration: 200, easing: 'cubic-bezier(.2,.7,.3,1)' });
  }, [week]);

  const may = occ ? canChange(full, occ) : false;
  const past = occ ? occ.date < today || (occ.date === today && toMin(occ.end) <= now.minutes) : false;

  const undo = async (o: Occurrence) => {
    if (!full || !o.change) return;
    setBusy(true);
    try {
      await api.w(full.workspace.slug).undo(o.change.id);
      const c = o.change;
      toast(c.kind === 'cancelled' ? `${c.course.code} is back on for ${DAY_SHORT[dow(c.from.date)]} ${c.from.start}.` : `${c.course.code} is back on ${DAY_SHORT[dow(c.from.date)]} ${c.from.start}, ${c.from.room}.`);
      setSelected(`${o.classId}:${c.from.date}`);
      invalidate();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not undo that.', { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const confirmMove = async (slot = r.st?.pick, roomId = r.st?.roomId) => {
    if (!full || !r.st || !slot || !roomId) return;
    const o = r.st.occ;
    r.setSt((s) => (s ? { ...s, saving: true, error: null } : s));
    const el = gridRef.current?.querySelector<HTMLElement>(`[data-key="${o.key}"]`);
    try {
      const ch = await api.w(full.workspace.slug).move(o.classId, { date: o.date, toDate: slot.date, toStart: slot.start, toEnd: slot.end, roomId, reason: r.st.reason.trim() || undefined });
      if (el) flip.current = { key: `${o.classId}:${o.date}:to`, rect: el.getBoundingClientRect() };
      r.stop();
      setSelected(slot.date >= start && slot.date <= addDays(start, 6) ? `${o.classId}:${o.date}:to` : null);
      invalidate();
      toast(movedToast(o.course.code, slot.date, slot.start, ch.to?.room ?? ''), {
        action: {
          label: 'Undo',
          run: () =>
            void api.w(full.workspace.slug).undo(ch.id).then(
              () => (invalidate(), toast(`${o.course.code} is back on ${DAY_SHORT[dow(o.date)]} ${o.start}.`)),
              (e: Error) => toast(e.message, { tone: 'error' }),
            ),
        },
      });
    } catch (e) {
      const err = e instanceof ApiFailure ? e : new ApiFailure(0, null, true);
      r.setSt((s) => (s ? { ...s, saving: false, error: err } : s));
      if (err.code === 'clash') {
        r.refreshSlots();
        invalidate();
      }
    }
  };

  const drag = useDrag((key) => {
    const s = r.st?.slots?.find((x) => slotId(x) === key);
    if (s) r.pick(s);
  });

  // Focus the confirm button once a slot is picked, so Enter confirms.
  const pickKey = r.st?.pick ? slotId(r.st.pick) : null;
  useEffect(() => {
    if (pickKey) requestAnimationFrame(() => document.querySelector<HTMLElement>('.confirm .btn-primary')?.focus());
  }, [pickKey]);

  const columns = useMemo(() => (week ? buildColumns(week, today) : []), [week, today]);
  const periodLen = useCallback((s: string) => {
    const p = week?.periods.find((x) => x.start === s);
    return p ? toMin(p.end) - toMin(p.start) : 60;
  }, [week]);
  const changesThisWeek = useMemo(() => {
    const ids = new Map<number, Occurrence>();
    week?.occurrences.forEach((o) => o.change && !ids.has(o.change.id) && ids.set(o.change.id, o));
    return [...ids.values()].map((o) => o.change!);
  }, [week]);
  const meta: Meta = filter?.kind === 'teacher' ? 'batch' : filter?.kind === 'room' ? 'room-batch' : 'teacher';

  // Phones: start the horizontal scroll at today.
  useEffect(() => {
    if (!phone || !week || !gridRef.current) return;
    const i = week.days.indexOf(today);
    if (i > 0) gridRef.current.scrollLeft = gridRef.current.querySelectorAll<HTMLElement>('.tg-col')[i]?.offsetLeft - 50;
  }, [phone, week, today]);

  const emptySetup = full && !full.classes.length;
  const panel = r.st ? (
    <FreeSlotList r={r.st} onPick={r.pick} onCancel={r.stop} />
  ) : occ && week ? (
    <ClassPanel
      ref={heading}
      o={occ}
      week={week}
      full={full}
      may={may}
      past={past}
      busy={busy}
      actions={{
        onClose: close,
        onReschedule: () => {
          r.start(occ, start);
          if (!wide) setSelected(null);
        },
        onCancel: () => setCancelOcc(occ),
        onUndo: () => void undo(occ),
      }}
    />
  ) : null;

  return (
    <div className={`week${r.st ? ' is-rescheduling' : ''}`}>
      <SubBar
        start={start}
        full={full}
        filter={filter}
        changes={changesThisWeek.length}
        scope={scope}
        onWeek={goWeek}
        onFeed={() => setFeedOpen(true)}
        offlineSince={q.offlineSince}
        loading={q.loading && !!week}
      />
      <div className={`week-body${wide ? ' has-rail' : ''}`}>
        <div className="week-grid">
          {q.error && !week && !q.offlineSince ? (
            <ErrorState error={q.error} onRetry={q.reload} />
          ) : !week ? (
            <GridSkeleton />
          ) : emptySetup ? (
            <FirstRun full={full!} />
          ) : (
            <>
              <TimeGrid
                ref={gridRef}
                periods={week.periods}
                columns={columns}
                nowMin={now.minutes}
                selectedKey={selected}
                focusKey={focusKey}
                movingKey={r.st?.occ.key ?? null}
                meta={meta}
                label={`${filterName ?? title}, week of ${rangeLabel(week.start, week.end)}`}
                fill
                onOpen={open}
                overlay={
                  r.st && full
                    ? (col, pos) => <SlotOverlay col={col} r={r.st!} pos={pos} full={full} over={drag.drag?.over ?? null} onPick={r.pick} periodLen={periodLen} />
                    : undefined
                }
                blockProps={(o) => (r.st && o.key === r.st.occ.key ? { onPointerDown: drag.onPointerDown, onClickCapture: drag.onClickCapture, 'aria-describedby': 'drag-help' } : {})}
              />
              {!week.occurrences.length && (
                <div className="week-empty" role="status">
                  <b>No classes {filterName ? `for ${filterName} ` : ''}this week.</b>
                  <span>{start > today ? 'Nothing has been scheduled yet.' : 'Try another week, or another batch, teacher or room.'}</span>
                </div>
              )}
            </>
          )}
        </div>
        {wide && (
          <aside className="rail" aria-label={occ || r.st ? 'Class details' : 'This week'}>
            {panel ?? (week ? <WeekSummary week={week} changes={changesThisWeek} today={today} nowMin={now.minutes} scope={scope} onOpen={(k) => setSelected(k)} /> : null)}
          </aside>
        )}
      </div>

      {!wide && (
        <Dialog open={!!occ && !r.st} onClose={close} title={occ ? `${occ.course.code} ${occ.course.name}` : ''} variant="sheet" className="sheet-panel">
          {panel}
        </Dialog>
      )}
      <span id="drag-help" className="sr-only">Drag onto a highlighted slot, or pick a slot from the list.</span>
      {r.st && (
        <ConfirmBar
          r={r.st}
          onRoom={(id) => r.setSt((s) => (s ? { ...s, roomId: id } : s))}
          onReason={(v) => r.setSt((s) => (s ? { ...s, reason: v } : s))}
          onConfirm={() => void confirmMove()}
          onCancel={r.stop}
          onSuggestion={() => {
            const sug = r.st?.error?.suggestion;
            if (!sug) return;
            r.pick(sug);
            void confirmMove(sug, sug.freeRooms[0]?.id);
          }}
        />
      )}
      {drag.drag && r.st && (
        <div className={`drag-ghost c${r.st.occ.course.color}`} style={{ left: drag.drag.x - drag.drag.dx, top: drag.drag.y - drag.drag.dy, width: drag.drag.w }} aria-hidden="true">
          <b>{r.st.occ.course.code}</b>
          {r.st.occ.course.name}
        </div>
      )}
      {full && <CancelDialog occ={cancelOcc} full={full} onClose={() => setCancelOcc(null)} />}
      {full && <FeedDialog open={feedOpen} onClose={() => setFeedOpen(false)} full={full} filter={filter} />}
    </div>
  );
}

function SubBar({ start, full, filter, changes, scope, onWeek, onFeed, offlineSince, loading }: {
  start: string; full?: WorkspaceFull; filter: { kind: FilterKind; id: number } | null; changes: number; scope: Scope;
  onWeek: (d: number) => void; onFeed: () => void; offlineSince: number | null; loading: boolean;
}) {
  const more = usePopover();
  const thisWeek = weekStartFor(null, scope.timezone);
  const canFilter = full && full.role !== 'student';
  const kind = filter?.kind ?? 'batch';
  const list = !full ? [] : kind === 'batch' ? full.batches.map((b) => ({ id: b.id, name: b.name })) : kind === 'teacher' ? full.teachers.map((t) => ({ id: t.id, name: t.name })) : full.rooms.map((x) => ({ id: x.id, name: x.name }));
  const setKind = (k: FilterKind) => {
    if (!full) return;
    const first = k === 'batch' ? full.batches[0]?.id : k === 'teacher' ? (full.teacherId ?? full.teachers[0]?.id) : full.rooms[0]?.id;
    setQuery({ batch: null, teacher: null, room: null, [k]: first ? String(first) : null });
  };
  return (
    <div className="sub" role="toolbar" aria-label="Week and filter">
      <div className="sub-week">
        <button type="button" className="btn btn-ghost btn-icon" onClick={() => onWeek(-1)} aria-label="Previous week (←)">
          <Icon name="chevron-left" />
        </button>
        <h1 className="sub-range" aria-live="polite">{rangeLabel(start, addDays(start, 4))}</h1>
        <button type="button" className="btn btn-ghost btn-icon" onClick={() => onWeek(1)} aria-label="Next week (→)">
          <Icon name="chevron-right" />
        </button>
        <button type="button" className="btn btn-sm sub-today" onClick={() => setQuery({ week: null })} disabled={start === thisWeek} aria-label="This week (T)">
          Today
        </button>
        {loading && <span className="sub-loading" aria-hidden="true" />}
      </div>
      {canFilter && (
        <div className="sub-filter">
          <Segmented<FilterKind>
            label="Show the week of a"
            value={kind}
            onChange={setKind}
            size="sm"
            options={[{ value: 'batch', label: 'Batch' }, { value: 'teacher', label: 'Teacher' }, { value: 'room', label: 'Room' }]}
          />
          <label className="sr-only" htmlFor="filter-pick">{kind === 'batch' ? 'Batch' : kind === 'teacher' ? 'Teacher' : 'Room'}</label>
          <select id="filter-pick" className="select select-sm sub-pick" value={filter?.id ?? ''} onChange={(e) => setQuery({ batch: null, teacher: null, room: null, [kind]: e.target.value })}>
            {list.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
                {kind === 'teacher' && x.id === full?.teacherId ? ' (you)' : ''}
              </option>
            ))}
          </select>
        </div>
      )}
      {full?.role === 'student' && <span className="sub-fixed">{full.batches.find((b) => b.id === full.batchId)?.name}</span>}
      <div className="sub-right">
        {offlineSince && (
          <span className="chip sub-offline" role="status">
            <Icon name="offline" size={13} /> Offline · showing the copy from {savedAt(offlineSince)}
          </span>
        )}
        {changes > 0 && (
          <Link className="sub-changes" href={`${scope.base === '/' ? '' : scope.base}/changes`}>
            <span className="dot" aria-hidden="true" />
            {plural(changes, 'change')}<span className="sub-long"> this week</span>
          </Link>
        )}
        {changes === 0 && !offlineSince && <span className="sub-nochange">No changes this week</span>}
        <button ref={more.anchor} type="button" className="btn btn-ghost btn-icon" aria-label="More" aria-haspopup="menu" aria-expanded={more.open} onClick={more.toggle}>
          <Icon name="more" />
        </button>
        <Popover open={more.open} anchor={more.anchor} onClose={more.close} align="end" width={230} label="More" role="menu">
          <MenuItem icon={<Icon name="printer" />} onSelect={() => (more.close(false), setTimeout(() => print(), 50))}>Print this week</MenuItem>
          {full && <MenuItem icon={<Icon name="calendar" />} onSelect={() => (more.close(false), onFeed())}>Add to your calendar…</MenuItem>}
          <MenuItem
            icon={<Icon name="link" />}
            onSelect={() => {
              more.close(false);
              void navigator.clipboard?.writeText(location.href).then(() => toast('Link to this week copied.'), () => toast('Could not copy the link.', { tone: 'error' }));
            }}
          >
            Copy link to this week
          </MenuItem>
        </Popover>
      </div>
    </div>
  );
}

function WeekSummary({ week, changes, today, nowMin, scope, onOpen }: {
  week: Week; changes: Week['occurrences'][number]['change'][]; today: string; nowMin: number; scope: Scope; onOpen: (key: string) => void;
}) {
  const live = week.occurrences.filter((o) => o.status === 'scheduled' || o.status === 'moved-here');
  const hours = live.reduce((h, o) => h + toMin(o.end) - toMin(o.start), 0) / 60;
  const next = live.find((o) => o.date > today || (o.date === today && toMin(o.end) > nowMin));
  const inProgress = next && next.date === today && toMin(next.start) <= nowMin;
  return (
    <div className="summary">
      <h2 className="rail-h">This week</h2>
      <div className="stats">
        <div><b className="mono">{live.length}</b><span>classes</span></div>
        <div><b className="mono">{Number.isInteger(hours) ? hours : hours.toFixed(1)}</b><span>hours</span></div>
        <div><b className={`mono${changes.length ? ' is-changed' : ''}`}>{changes.length}</b><span>changes</span></div>
      </div>
      {next && (
        <section className="rail-sec">
          <h3 className="cp-h3">{inProgress ? 'Happening now' : next.date === today ? 'Next today' : 'Next class'}</h3>
          <button type="button" className={`nextcard c${next.course.color}`} onClick={() => onOpen(next.key)}>
            <span className="nextcard-top">
              <b>{next.course.code}</b>
              <span className="mono">{next.date === today ? '' : `${DAY_SHORT[dow(next.date)]} `}{next.start}–{next.end}</span>
            </span>
            <span className="nextcard-name">{next.course.name}</span>
            <span className="nextcard-meta mono">{next.room.name} · {next.teacher.name}</span>
          </button>
        </section>
      )}
      <section className="rail-sec">
        <h3 className="cp-h3">Changes this week</h3>
        {changes.length ? (
          <ul className="minifeed">
            {changes.map((c) => (
              <li key={c!.id}>
                <button type="button" onClick={() => onOpen(c!.kind === 'moved' ? `${c!.classId}:${c!.from.date}:to` : `${c!.classId}:${c!.from.date}`)}>
                  <span className={`swatch c${c!.course.color}`} aria-hidden="true" />
                  <span className="minifeed-text">
                    <b>{c!.course.code}</b> <ChangeText c={c!} />
                    <span className="minifeed-meta">{c!.by} · {ago(c!.at)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rail-empty">Everything runs as usual this week.</p>
        )}
        {scope.kind !== 'preview' && (
          <Link className="rail-more" href={`${scope.base}/changes`}>All changes <Icon name="arrow-right" size={14} /></Link>
        )}
      </section>
      <section className="rail-sec">
        <h3 className="cp-h3">Key</h3>
        <dl className="legend">
          <div><dt><span className="lg lg-cancel" /></dt><dd>Cancelled for that day</dd></div>
          <div><dt><span className="lg lg-away" /></dt><dd>Moved away; shows where to</dd></div>
          <div><dt><span className="lg lg-here" /></dt><dd>Moved here this week</dd></div>
          <div><dt><span className="lg lg-now" /></dt><dd>Now, {longDay(today).split(' ')[0]}</dd></div>
        </dl>
      </section>
    </div>
  );
}

function FirstRun({ full }: { full: WorkspaceFull }) {
  const base = `/w/${full.workspace.slug}`;
  return (
    <div className="firstrun">
      <h2>Nothing on the timetable yet</h2>
      {full.role === 'coordinator' ? (
        <>
          <p>Add your rooms, teachers, batches and courses, then place classes on the week. It takes about ten minutes with a spreadsheet to import from.</p>
          <Link className="btn btn-primary" href={`${base}/setup`}>Continue setup</Link>
        </>
      ) : (
        <p>Your coordinator hasn’t added any classes yet. This page fills in as soon as they do.</p>
      )}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: ApiFailure; onRetry: () => void }) {
  return (
    <div className="errstate" role="alert">
      <Icon name={error.offline ? 'offline' : 'alert'} size={20} />
      <h2>{error.offline ? 'You’re offline' : 'Couldn’t load this week'}</h2>
      <p>{error.offline ? 'There’s no saved copy of this week on this device yet. Connect and try again.' : error.message}</p>
      <button type="button" className="btn" onClick={onRetry}><Icon name="refresh" /> Try again</button>
    </div>
  );
}

function CancelDialog({ occ, full, onClose }: { occ: Occurrence | null; full: WorkspaceFull; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setReason('');
    setErr(null);
  }, [occ]);
  if (!occ) return <Dialog open={false} onClose={onClose} title="" />;
  const day = DAY_LONG[dow(occ.date)];
  const submit = async () => {
    setSaving(true);
    setErr(null);
    try {
      const ch = await api.w(full.workspace.slug).cancel(occ.classId, { date: occ.date, reason: reason.trim() || undefined });
      onClose();
      invalidate();
      toast(`${day}’s ${occ.course.code} is cancelled.`, {
        action: { label: 'Undo', run: () => void api.w(full.workspace.slug).undo(ch.id).then(() => (invalidate(), toast(`${occ.course.code} is back on for ${day}.`))) },
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not cancel the class.');
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Cancel ${day}’s class?`}
      size="sm"
      description={
        <>
          {occ.course.code} {occ.course.name} for {occ.batch.name} on {dayLabel(occ.date)}, <span className="mono">{occ.start}–{occ.end}</span> in {occ.room.name}. Only this
          day is cancelled; the class stays on the timetable for other weeks.
        </>
      }
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Keep the class</button>
          <button type="button" className="btn btn-danger" onClick={() => void submit()} disabled={saving}>{saving ? 'Cancelling…' : 'Cancel the class'}</button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="cancel-reason">Reason students will see <span className="muted">(optional)</span></label>
        <input id="cancel-reason" className="input" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Unwell today" data-autofocus />
      </div>
      {err && <p className="field-error" role="alert">{err}</p>}
    </Dialog>
  );
}

export function FeedDialog({ open, onClose, full, filter, code, label }: { open: boolean; onClose: () => void; full?: WorkspaceFull; filter?: { kind: FilterKind; id: number } | null; code?: string; label?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const batch = filter?.kind === 'batch' ? full?.batches.find((b) => b.id === filter.id) : null;
  const name = label ?? (filter ? (filter.kind === 'batch' ? batch?.name : filter.kind === 'teacher' ? full?.teachers.find((t) => t.id === filter.id)?.name : full?.rooms.find((x) => x.id === filter.id)?.name) : '');
  useEffect(() => {
    if (!open) return;
    setUrl(null);
    setErr(null);
    if (code) return setUrl(batchFeedUrl(code));
    if (batch) return setUrl(batchFeedUrl(batch.code));
    if (full && filter) api.w(full.workspace.slug).feed({ kind: filter.kind, targetId: filter.id }).then((r) => setUrl(r.url), (e: Error) => setErr(e.message));
  }, [open, code, batch, full, filter]);
  return (
    <Dialog open={open} onClose={onClose} title={`Add ${name ?? 'this timetable'} to your calendar`} size="md" description="Your calendar app checks this address every few hours, so cancelled and moved classes update on their own.">
      <div className="feed">
        <label className="field-label" htmlFor="feed-url">Calendar address</label>
        <div className="copyfield">
          <input id="feed-url" className="input mono" readOnly value={url ?? (err ? '' : 'Making a private address…')} onFocus={(e) => e.currentTarget.select()} />
          <button type="button" className="btn" disabled={!url} onClick={() => url && navigator.clipboard?.writeText(url).then(() => toast('Calendar address copied.'))}>
            <Icon name="copy" /> Copy
          </button>
        </div>
        {err && <p className="field-error">{err}</p>}
        <div className="feed-how">
          <div>
            <h3>Google Calendar</h3>
            <p>On a computer, open Google Calendar, click <b>+</b> next to “Other calendars”, choose <b>From URL</b> and paste the address.</p>
          </div>
          <div>
            <h3>Apple Calendar</h3>
            <p>On iPhone: Settings → Calendar → Accounts → Add Account → Other → <b>Add Subscribed Calendar</b>, then paste. On a Mac: File → New Calendar Subscription.</p>
          </div>
        </div>
      </div>
    </Dialog>
  );
}

