import { Fragment, useEffect, useRef, useState } from 'react';
import { useReducedMotion } from '../motion';
import { flap } from '../sound';

// A run of split-flap tiles. When `text` changes, each differing character
// flips through a few random characters before landing, left to right.
// `memo` names the cell: the last text shown under that name is remembered
// across unmounts, so a cell that reappears (tab switch, phone view switch)
// flips from what it showed before, and a brand-new cell flips in from blank.

const shownBefore = new Map<string, string>();
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const STAGGER_MS = 34; // between neighbouring characters starting
const STEP_MS = 48; // one flap
let serial = 0;

interface Cell {
  ch: string;
  /** Bumped on every flap; part of the React key, so the CSS flip animation replays. */
  gen: number;
}

const toCells = (s: string): Cell[] => Array.from(s, (ch) => ({ ch, gen: 0 }));
const randomChar = () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)];

interface Props {
  text: string;
  memo: string;
  /** What a screen reader hears instead of the raw board text. */
  label?: string;
  /** Extra delay before the first flap (e.g. per row), ms. */
  delay?: number;
  className?: string;
}

export function FlapText({ text, memo, label, delay = 0, className }: Props) {
  const reduced = useReducedMotion();
  const initial = shownBefore.get(memo) ?? (reduced ? text : '');
  const [cells, setCells] = useState<Cell[]>(() => toCells(initial));
  const shown = useRef(initial);

  useEffect(() => {
    const from = shown.current;
    if (from === text) {
      shownBefore.set(memo, text);
      return;
    }
    if (reduced) {
      shown.current = text;
      shownBefore.set(memo, text);
      setCells(toCells(text));
      return;
    }

    const len = Math.max(from.length, text.length);
    const src = from.padEnd(len);
    const dst = text.padEnd(len);
    const plan: { at: number; ch: string }[][] = [];
    let order = 0;
    let endAt = 0;
    for (let i = 0; i < len; i++) {
      if (src[i] === dst[i]) {
        plan.push([]);
        continue;
      }
      const begin = delay + order++ * STAGGER_MS;
      const extra = dst[i] === ' ' ? 0 : 1 + ((i * 7 + len) % 3);
      const seq = [];
      for (let s = 0; s < extra; s++) seq.push({ at: begin + s * STEP_MS, ch: randomChar() });
      seq.push({ at: begin + extra * STEP_MS, ch: dst[i] });
      for (const step of seq) flap(step.at);
      endAt = Math.max(endAt, begin + extra * STEP_MS);
      plan.push(seq);
    }

    const current: Cell[] = Array.from(src, (ch) => ({ ch, gen: 0 }));
    const done = new Array<number>(len).fill(-1);
    setCells(current.slice());
    const t0 = performance.now();
    let raf = 0;
    const tick = () => {
      const elapsed = performance.now() - t0;
      let changed = false;
      plan.forEach((seq, i) => {
        let j = done[i];
        while (j + 1 < seq.length && seq[j + 1].at <= elapsed) j++;
        if (j !== done[i]) {
          done[i] = j;
          current[i] = { ch: seq[j].ch, gen: ++serial };
          changed = true;
        }
      });
      if (elapsed >= endAt) {
        shown.current = text;
        shownBefore.set(memo, text);
        setCells(current.slice(0, text.length));
        return;
      }
      if (changed) setCells(current.slice());
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      // Interrupted: the next run flips from whatever is on the tiles now.
      shown.current = current.map((c) => c.ch).join('').trimEnd();
    };
  }, [text, memo, reduced, delay]);

  return (
    <span className={className ? `flap ${className}` : 'flap'}>
      <span className="flap-tiles" aria-hidden="true">
        {cells.map((c, i) =>
          c.ch === ' ' ? (
            <Fragment key={`${i}:${c.gen}`}>
              <span className={c.gen ? 't sp f' : 't sp'}> </span>
              <wbr />
            </Fragment>
          ) : (
            <span key={`${i}:${c.gen}`} className={c.gen ? 't f' : 't'}>
              {c.ch}
            </span>
          ),
        )}
      </span>
      <span className="sr-only">{label ?? text}</span>
    </span>
  );
}
