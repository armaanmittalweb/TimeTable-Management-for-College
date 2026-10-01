// The timetable grid: a sticky time rail, one column per day (or per room), period lines, hatched breaks,
// the red now-line and class blocks. Blocks are one roving tab stop: arrows move between them, Enter opens.

import { forwardRef, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { Occurrence, Period } from '../contract';
import { DAY_LONG, dow, fromMin, toMin } from '../lib/time';
import { lanes, timeRange } from './layout';

export const ROW = 56; // px per hour at least (--row); the grid grows to fill a tall window, up to MAX_ROW
const MAX_ROW = 76;

export interface Column {
  key: string;
  label: string; // for screen readers: "Wednesday 30 September, today"
  head: ReactNode;
  isToday?: boolean;
  isPast?: boolean;
  items: Occurrence[];
}

export type Meta = 'teacher' | 'batch' | 'both' | 'room-batch';

export interface GridProps {
  periods: Period[];
  columns: Column[];
  nowMin?: number | null;
  selectedKey?: string | null;
  focusKey?: string | null;
  movingKey?: string | null;
  meta: Meta;
  label: string;
  onOpen?: (o: Occurrence, el: HTMLElement) => void;
  overlay?: (col: Column, pos: (start: string, end: string) => { top: number; height: number }) => ReactNode;
  blockProps?: (o: Occurrence) => Record<string, unknown>;
  colMin?: number;
  className?: string;
  compact?: boolean;
  /** Stretch hours so the day fills the window (the week screen). */
  fill?: boolean;
}

const statusWord: Record<Occurrence['status'], string> = { scheduled: '', cancelled: 'Cancelled.', 'moved-away': 'Moved away.', 'moved-here': 'Moved here.' };

export function blockLabel(o: Occurrence) {
  let s = `${o.course.code} ${o.course.name}, ${DAY_LONG[dow(o.date)]} ${o.start} to ${o.end}, ${o.room.name}, ${o.teacher.name}, ${o.batch.name}.`;
  if (o.status === 'moved-away' && o.change?.to) s += ` Moved to ${DAY_LONG[dow(o.change.to.date)]} ${o.change.to.start}, ${o.change.to.room}.`;
  else if (o.status === 'moved-here' && o.change) s += ` Moved from ${DAY_LONG[dow(o.change.from.date)]} ${o.change.from.start}.`;
  else s += ` ${statusWord[o.status]}`;
  return s.trim();
}

function Block({ o, lane, lanesN, from, px, meta, selected, tabbable, moving, dim, extra, compactGrid }: {
  o: Occurrence; lane: number; lanesN: number; from: number; px: number; meta: Meta; selected: boolean; tabbable: boolean; moving: boolean; dim: boolean;
  extra?: Record<string, unknown>; compactGrid?: boolean;
}) {
  const s = toMin(o.start);
  const e = toMin(o.end);
  const top = (s - from) * px + 1;
  const height = (e - s) * px - 2;
  const short = e - s < 45 || (compactGrid && e - s < 60);
  const metaText =
    meta === 'teacher' ? `${o.room.name} · ${o.teacher.short}` :
    meta === 'batch' ? `${o.room.name} · ${o.batch.name}` :
    meta === 'room-batch' ? `${o.batch.name} · ${o.teacher.short}` :
    `${o.room.name} · ${o.batch.name} · ${o.teacher.short}`;
  const to = o.change?.to;
  const tag =
    o.status === 'cancelled' ? <span className="blk-tag">Cancelled</span> :
    o.status === 'moved-here' && o.change ? <span className="blk-tag is-changed">Moved from {DAY_LONG[dow(o.change.from.date)].slice(0, 3)}</span> :
    null;
  const w = 100 / lanesN;
  return (
    <button
      type="button"
      className={`blk c${o.course.color} is-${o.status}${selected ? ' is-selected' : ''}${short ? ' is-short' : ''}${moving ? ' is-moving' : ''}${dim ? ' is-dim' : ''}${lanesN > 1 ? ' is-narrow' : ''}`}
      style={{ top, height, left: `calc(${lane * w}% + 3px)`, width: `calc(${w}% - ${lanesN > 1 ? 4 : 6}px)` }}
      data-key={o.key}
      data-start={s}
      tabIndex={tabbable ? 0 : -1}
      aria-label={blockLabel(o)}
      aria-pressed={selected}
      {...extra}
    >
      <span className="blk-top">
        <span className="blk-code">{o.course.code}</span>
        {short && <span className="blk-room mono">{o.status === 'moved-away' && to ? `→ ${DAY_LONG[dow(to.date)].slice(0, 3)} ${to.start}` : o.room.name}</span>}
        {!short && tag}
      </span>
      {!short && o.status === 'moved-away' && to && <span className="blk-moved mono">→ {DAY_LONG[dow(to.date)].slice(0, 3)} {to.start} · {to.room}</span>}
      {!short && o.status !== 'moved-away' && <span className="blk-name">{o.course.name}</span>}
      {!short && o.status !== 'moved-away' && <span className="blk-meta mono">{metaText}</span>}
    </button>
  );
}

export const TimeGrid = forwardRef<HTMLDivElement, GridProps>(function TimeGrid(
  { periods, columns, nowMin, selectedKey, focusKey, movingKey, meta, label, onOpen, overlay, blockProps, colMin = 132, className = '', compact, fill },
  ref,
) {
  const scroller = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => scroller.current!, []);
  const [row, setRow] = useState(compact ? 48 : ROW);
  const all = useMemo(() => columns.flatMap((c) => c.items), [columns]);
  const { from, to } = useMemo(() => timeRange(periods, all), [periods, all]);
  const px = row / 60;
  const height = (to - from) * px;
  const pos = (start: string, end: string) => ({ top: (toMin(start) - from) * px, height: (toMin(end) - toMin(start)) * px });
  useLayoutEffect(() => {
    if (!fill || !scroller.current) return;
    const measure = () => {
      const top = scroller.current!.getBoundingClientRect().top + scrollY;
      const reserve = innerWidth <= 720 ? 72 : 20;
      const avail = innerHeight - top - 48 - reserve;
      setRow(Math.max(ROW, Math.min(MAX_ROW, Math.floor((avail / (to - from)) * 60))));
    };
    measure();
    addEventListener('resize', measure);
    return () => removeEventListener('resize', measure);
  }, [fill, from, to]);
  const tabKey = (focusKey && all.some((o) => o.key === focusKey) && focusKey) || (selectedKey && all.some((o) => o.key === selectedKey) && selectedKey) || all[0]?.key;
  const boundaries = useMemo(() => [...new Set(periods.flatMap((p) => [toMin(p.start), toMin(p.end)]))].sort((a, b) => a - b), [periods]);
  const breaks = periods.filter((p) => p.isBreak);
  const teaching = periods.filter((p) => !p.isBreak);
  const showNow = nowMin != null && nowMin >= from && nowMin <= to && columns.some((c) => c.isToday);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    if (!t.classList.contains('blk') || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    const cols = [...e.currentTarget.querySelectorAll<HTMLElement>('.tg-col')];
    const colIdx = cols.findIndex((c) => c.contains(t));
    const blocksIn = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>('.blk')].sort((a, b) => +a.dataset.start! - +b.dataset.start!);
    const here = blocksIn(cols[colIdx]);
    const i = here.indexOf(t);
    let next: HTMLElement | undefined;
    if (e.key === 'ArrowDown') next = here[i + 1];
    else if (e.key === 'ArrowUp') next = here[i - 1];
    else if (e.key === 'Home') next = here[0];
    else if (e.key === 'End') next = here[here.length - 1];
    else {
      const step = e.key === 'ArrowRight' ? 1 : -1;
      for (let c = colIdx + step; c >= 0 && c < cols.length && !next; c += step) {
        const list = blocksIn(cols[c]);
        if (!list.length) continue;
        const at = +t.dataset.start!;
        next = list.reduce((best, b) => (Math.abs(+b.dataset.start! - at) < Math.abs(+best.dataset.start! - at) ? b : best));
      }
    }
    if (next) {
      e.currentTarget.querySelectorAll<HTMLElement>('.blk[tabindex="0"]').forEach((b) => (b.tabIndex = -1));
      next.tabIndex = 0;
      next.focus();
      next.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  };

  return (
    <div className={`tg-scroll ${className}`} ref={scroller} tabIndex={all.length ? undefined : 0} aria-label={all.length ? undefined : label}>
      <div
        className={`tg${compact ? ' is-compact' : ''}`}
        style={{ gridTemplateColumns: `var(--rail) repeat(${columns.length}, minmax(${colMin}px, 1fr))`, ['--cols' as string]: columns.length }}
        role="region"
        aria-label={label}
        data-keys-local
        onKeyDown={onKeyDown}
        onClick={(e) => {
          const b = (e.target as HTMLElement).closest<HTMLElement>('.blk');
          if (!b || !onOpen) return;
          const o = all.find((x) => x.key === b.dataset.key);
          if (o) onOpen(o, b);
        }}
      >
        <div className="tg-corner" aria-hidden="true" />
        {columns.map((c) => (
          <div key={c.key} className={`tg-head${c.isToday ? ' is-today' : ''}${c.isPast ? ' is-past' : ''}`} aria-hidden="true">
            {c.head}
          </div>
        ))}
        <div className="tg-rail" style={{ height }} aria-hidden="true">
          {teaching.map((p) => (
            <span key={p.idx} className={`tg-time${showNow && Math.abs(toMin(p.start) - nowMin!) < 16 ? ' is-hidden' : ''}`} style={{ top: (toMin(p.start) - from) * px }}>
              <span className="mono">{p.start}</span>
              <span className="tg-pidx">P{teaching.indexOf(p) + 1}</span>
            </span>
          ))}
          {breaks.map((p) => (
            <span key={p.idx} className={`tg-time is-break${showNow && Math.abs(toMin(p.start) - nowMin!) < 16 ? ' is-hidden' : ''}`} style={{ top: (toMin(p.start) - from) * px }}>
              <span className="mono">{p.start}</span>
            </span>
          ))}
          {showNow && (
            <span className="tg-now-label mono" style={{ top: (nowMin! - from) * px }}>
              {fromMin(nowMin!)}
            </span>
          )}
        </div>
        {columns.map((c) => (
          <div key={c.key} className={`tg-col${c.isToday ? ' is-today' : ''}`} style={{ height }} role="group" aria-label={c.label}>
            {boundaries.map((m) => (
              <span key={m} className="tg-line" style={{ top: (m - from) * px }} aria-hidden="true" />
            ))}
            {breaks.map((p) => (
              <span key={p.idx} className="tg-break" style={pos(p.start, p.end)} aria-hidden="true">
                <span>{p.label || 'Break'}</span>
              </span>
            ))}
            {overlay?.(c, pos)}
            {lanes(c.items).map(({ o, lane, lanes: n }) => (
              <Block
                key={o.key}
                o={o}
                lane={lane}
                lanesN={n}
                from={from}
                px={px}
                meta={meta}
                selected={o.key === selectedKey}
                tabbable={o.key === tabKey}
                moving={o.key === movingKey}
                dim={!!movingKey && o.key !== movingKey}
                extra={blockProps?.(o)}
                compactGrid={compact}
              />
            ))}
            {c.isToday && showNow && <span className="tg-now" style={{ top: (nowMin! - from) * px }} aria-hidden="true" />}
            {!c.items.length && !overlay && <span className="sr-only">No classes.</span>}
          </div>
        ))}
      </div>
    </div>
  );
});

/** A grid-shaped placeholder while a week loads. */
export function GridSkeleton({ days = 5, label = 'Loading the week' }: { days?: number; label?: string }) {
  const blocks = [
    [0, 0, 1], [0, 1, 1], [0, 3, 1], [0, 5, 2], [1, 0, 1], [1, 1, 1], [1, 2, 1], [1, 5, 1], [2, 0, 1], [2, 2, 1], [2, 5, 1], [2, 6, 1],
    [3, 1, 1], [3, 2, 1], [3, 5, 1], [3, 6, 1], [4, 0, 1], [4, 1, 1], [4, 3, 1],
  ].filter(([d]) => d < days);
  return (
    <div className="tg-scroll" aria-busy="true" aria-label={label} role="status">
      <div className="tg is-skeleton" style={{ gridTemplateColumns: `var(--rail) repeat(${days}, minmax(132px, 1fr))` }}>
        <div className="tg-corner" />
        {Array.from({ length: days }, (_, i) => (
          <div key={i} className="tg-head">
            <span className="skel" style={{ width: 28, height: 10 }} />
            <span className="skel" style={{ width: 22, height: 16, marginTop: 6 }} />
          </div>
        ))}
        <div className="tg-rail" style={{ height: 8 * ROW }}>
          {Array.from({ length: 8 }, (_, i) => (
            <span key={i} className="tg-time" style={{ top: i * ROW }}>
              <span className="skel" style={{ width: 30, height: 8, marginTop: 4 }} />
            </span>
          ))}
        </div>
        {Array.from({ length: days }, (_, d) => (
          <div key={d} className="tg-col" style={{ height: 8 * ROW }}>
            {Array.from({ length: 9 }, (_, i) => (
              <span key={i} className="tg-line" style={{ top: i * ROW }} />
            ))}
            {blocks
              .filter(([x]) => x === d)
              .map(([, h, len]) => (
                <span key={h} className="skel tg-skel" style={{ top: (h + (h >= 4 ? 1 : 0)) * ROW + 1, height: len * ROW - 2 }} />
              ))}
          </div>
        ))}
      </div>
      <span className="sr-only">{label}</span>
    </div>
  );
}
