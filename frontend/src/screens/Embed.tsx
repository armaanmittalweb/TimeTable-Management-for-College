// /embed: a compact, read-only week of the demo college for the portfolio to iframe (noindex).
//
// Parent -> embed:  {type:'theme', tokens:{bg}}   picks light or dark from the parent's background
// Embed -> parent:  {type:'ready'}, {type:'height', px}
// Only origins in VITE_EMBED_PARENT_ORIGINS are talked to.

import { useEffect, useMemo, useRef } from 'react';
import { Mark } from '../ui/Icon';
import { useTick } from '../lib/hooks';
import { nowIn, rangeLabel } from '../lib/time';
import { plural } from '../lib/format';
import { previewScope } from '../state/scope';
import { weekStartFor } from '../state/scope';
import { GridSkeleton, TimeGrid } from '../week/TimeGrid';
import { buildColumns, useWeekData } from './Week';

const PARENT_ORIGINS = (import.meta.env.VITE_EMBED_PARENT_ORIGINS || 'https://www.amittal.dev,http://localhost:5173')
  .split(',')
  .map((s: string) => s.trim())
  .filter(Boolean);

function initialParent(): string | null {
  if (window.parent === window) return null;
  const anc = (location as Location & { ancestorOrigins?: DOMStringList }).ancestorOrigins;
  if (anc?.length && PARENT_ORIGINS.includes(anc[0])) return anc[0];
  try {
    const ref = document.referrer ? new URL(document.referrer).origin : null;
    if (ref && PARENT_ORIGINS.includes(ref)) return ref;
  } catch {
    /* no usable referrer */
  }
  return null;
}

function isDark(color: unknown) {
  if (typeof color !== 'string') return null;
  const m = /^#([0-9a-f]{6})$/i.exec(color.trim()) ?? /^#([0-9a-f]{3})$/i.exec(color.trim());
  if (!m) return null;
  const hex = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 110;
}

export function Embed() {
  const parent = useRef<string | null>(initialParent());
  const tick = useTick(30_000);
  const now = nowIn(previewScope.timezone, tick);
  const start = weekStartFor(null, previewScope.timezone);
  const q = useWeekData(previewScope, start, {});
  const week = q.data;
  const columns = useMemo(() => (week ? buildColumns(week, week.today) : []), [week]);
  const changes = new Set(week?.occurrences.filter((o) => o.change).map((o) => o.change!.id)).size;

  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex';
    document.head.appendChild(meta);
    document.documentElement.classList.add('is-embed');
    return () => meta.remove();
  }, []);

  useEffect(() => {
    const post = (msg: object) => parent.current && window.parent.postMessage(msg, parent.current);
    const onMessage = (e: MessageEvent) => {
      if (!PARENT_ORIGINS.includes(e.origin) || e.source !== window.parent) return;
      parent.current = e.origin;
      const d = e.data as { type?: unknown; tokens?: { bg?: unknown } } | null;
      if (d?.type === 'theme') {
        const dark = isDark(d.tokens?.bg);
        if (dark !== null) document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      }
    };
    addEventListener('message', onMessage);
    post({ type: 'ready' });
    let last = 0;
    const ro = new ResizeObserver(() => {
      const px = Math.ceil(document.documentElement.getBoundingClientRect().height);
      if (px !== last) post({ type: 'height', px: (last = px) });
    });
    ro.observe(document.body);
    return () => {
      removeEventListener('message', onMessage);
      ro.disconnect();
    };
  }, []);

  return (
    <div className="embed">
      <header className="embed-bar">
        <a className="top-brand" href="/" target="_blank" rel="noopener">
          <Mark />
          <span className="top-word">EduSched</span>
        </a>
        <span className="embed-what"><b>CSE-2A</b> · demo college · {rangeLabel(start, week?.end ?? start)}</span>
        {changes > 0 && <span className="embed-changes"><span className="dot" aria-hidden="true" /> {plural(changes, 'change')} this week</span>}
        <a className="btn btn-sm btn-primary embed-open" href="/demo" target="_blank" rel="noopener">Open the demo</a>
      </header>
      <main>
        {week ? (
          <TimeGrid periods={week.periods} columns={columns} nowMin={now.minutes} meta="teacher" label={`CSE-2A, week of ${rangeLabel(week.start, week.end)}`} compact colMin={104} />
        ) : (
          <GridSkeleton />
        )}
      </main>
    </div>
  );
}
