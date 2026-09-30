// /embed: the two boards without the station chrome, for the portfolio's Lab.
//
// Parent -> embed:  {type:'theme', tokens:{bg, ink, accent, muted, line}}
//                   {type:'command', name:'race'|'reset'}
// Embed -> parent:  {type:'ready'}, {type:'height', px},
//                   {type:'stage', i, name, ms, ok, lane?}   (i: 0 JWT login ... 5 Commit change)
// Both directions only talk to the origins in PARENT_ORIGINS.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ResetButton, SandboxTag, SoundToggle } from './components/Chrome';
import type { RaceHandle } from './components/RacePanel';
import { ControlRoom, Platform } from './components/Views';
import { boardWeek, defaultDay } from './time';
import { useDemo, type StageListener } from './useDemo';

const PARENT_ORIGINS = (import.meta.env.VITE_EMBED_PARENT_ORIGINS || 'https://www.amittal.dev,http://localhost:5173')
  .split(',')
  .map((s: string) => s.trim())
  .filter(Boolean);

/** The embedding page's origin, if it is one we trust. */
function initialParent(): string | null {
  if (window.parent === window) return null;
  const ancestors = (location as Location & { ancestorOrigins?: DOMStringList }).ancestorOrigins;
  const first = ancestors?.length ? ancestors[0] : null;
  if (first && PARENT_ORIGINS.includes(first)) return first;
  try {
    const ref = document.referrer ? new URL(document.referrer).origin : null;
    if (ref && PARENT_ORIGINS.includes(ref)) return ref;
  } catch {
    /* no usable referrer */
  }
  return null;
}

// --- theme tokens: accepted only when the board stays readable

function parseColor(v: unknown): [number, number, number] | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  let m = /^#([0-9a-f]{3})$/i.exec(s);
  if (m) return [...m[1]].map((c) => parseInt(c + c, 16)) as [number, number, number];
  m = /^#([0-9a-f]{6})$/i.exec(s);
  if (m) return [0, 2, 4].map((i) => parseInt(m![1].slice(i, i + 2), 16)) as [number, number, number];
  m = /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/i.exec(s);
  if (m) return [m[1], m[2], m[3]].map(Number).map((n) => Math.min(255, n)) as [number, number, number];
  return null;
}

function luminance([r, g, b]: [number, number, number]) {
  const lin = (c: number) => {
    const x = c / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

const contrast = (a: [number, number, number], b: [number, number, number]) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const hex = (c: [number, number, number]) => `#${c.map((n) => n.toString(16).padStart(2, '0')).join('')}`;

/**
 * Maps the parent's tokens onto the board. The board is a lit display, so a
 * light background is ignored (the board keeps its own dark face); ink and
 * accent are used only when they keep AA contrast on the board and its tiles.
 */
function applyTheme(tokens: Record<string, unknown>) {
  const root = document.documentElement.style;
  const bg = parseColor(tokens.bg);
  const board = bg && luminance(bg) < 0.03 ? bg : parseColor(getComputedStyle(document.documentElement).getPropertyValue('--board'));
  if (!board) return;
  if (bg && board === bg) {
    root.setProperty('--board', hex(bg));
    root.setProperty('--tile', `color-mix(in srgb, ${hex(bg)} 88%, #ffffff)`);
    root.setProperty('--panel', `color-mix(in srgb, ${hex(bg)} 95%, #ffffff)`);
  }
  const tile = board.map((c) => Math.round(c * 0.88 + 255 * 0.12)) as [number, number, number];
  const ok = (c: [number, number, number] | null, min: number) => c && contrast(c, board) >= min && contrast(c, tile) >= min;
  const ink = parseColor(tokens.ink);
  if (ok(ink, 7)) root.setProperty('--text', hex(ink!));
  const accent = parseColor(tokens.accent);
  if (ok(accent, 4.5)) root.setProperty('--signal', hex(accent!));
  const muted = parseColor(tokens.muted);
  if (muted && contrast(muted, board) >= 4.5) root.setProperty('--muted', hex(muted));
  const line = parseColor(tokens.line);
  if (line) root.setProperty('--hair', hex(line));
}

export default function Embed() {
  const parent = useRef<string | null>(initialParent());
  const post = useCallback((msg: object) => {
    if (parent.current) window.parent.postMessage(msg, parent.current);
  }, []);
  const onStage = useCallback<StageListener>((s) => post({ type: 'stage', ...s }), [post]);

  const demo = useDemo(onStage);
  const week = useMemo(() => boardWeek(demo.today), [demo.today]);
  const [controlDay, setControlDay] = useState(() => defaultDay(demo.today));
  const [platformDay, setPlatformDay] = useState(() => defaultDay(demo.today));
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const raceRef = useRef<RaceHandle>(null);
  const lastFollow = useRef(0);
  const demoRef = useRef(demo);
  demoRef.current = demo;

  useEffect(() => {
    document.documentElement.classList.add('is-embed');
    return () => document.documentElement.classList.remove('is-embed');
  }, []);

  useEffect(() => {
    const f = demo.platformFollow;
    if (!f || f.n === lastFollow.current) return;
    lastFollow.current = f.n;
    setPlatformDay(f.day);
  }, [demo.platformFollow]);

  useEffect(() => {
    if (selectedId !== null || !demo.profRows?.length) return;
    const first = demo.profRows.find((r) => r.day_of_week === controlDay && !r.modification_type) ?? demo.profRows[0];
    setSelectedId(first.id);
  }, [demo.profRows, controlDay, selectedId]);

  // Messages from the parent: trusted origins only, and only from our actual parent window.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (!PARENT_ORIGINS.includes(e.origin) || e.source !== window.parent) return;
      parent.current = e.origin;
      const data = e.data as { type?: unknown; tokens?: unknown; name?: unknown } | null;
      if (!data || typeof data !== 'object') return;
      if (data.type === 'theme' && data.tokens && typeof data.tokens === 'object') {
        applyTheme(data.tokens as Record<string, unknown>);
      } else if (data.type === 'command' && data.name === 'race') {
        void raceRef.current?.run();
      } else if (data.type === 'command' && data.name === 'reset') {
        void demoRef.current.reset();
      }
    };
    window.addEventListener('message', onMessage);
    post({ type: 'ready' });
    return () => window.removeEventListener('message', onMessage);
  }, [post]);

  // Report our height whenever the content changes size.
  useEffect(() => {
    let raf = 0;
    let last = 0;
    const measure = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const px = Math.ceil(document.documentElement.getBoundingClientRect().height);
        if (px !== last) {
          last = px;
          post({ type: 'height', px });
        }
      });
    };
    const ro = new ResizeObserver(measure);
    ro.observe(document.body);
    measure();
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [post]);

  return (
    <div className="embed">
      <div className="embed-bar">
        <span className="embed-name">
          EDUSCHED <span aria-hidden="true">·</span> LIVE DEMO
        </span>
        <div className="station-tools">
          <SoundToggle />
          <ResetButton demo={demo} label="RESET" />
          <SandboxTag id={demo.sandbox} />
        </div>
      </div>
      <main className="split">
        <ControlRoom
          demo={demo}
          week={week}
          day={controlDay}
          onDay={setControlDay}
          selectedId={selectedId}
          onSelect={setSelectedId}
          raceRef={raceRef}
          compact
        />
        <Platform demo={demo} week={week} day={platformDay} onDay={setPlatformDay} compact />
      </main>
      <p className="demo-note">
        Public demo. Your changes are private to this browser and cleared after 24 hours.
      </p>
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {demo.announcement}
      </div>
    </div>
  );
}
