import type { Occurrence, Period } from '../contract';
import { toMin } from '../lib/time';

/** The grid's time range: whole hours around the periods (and anything scheduled outside them). */
export function timeRange(periods: Period[], occ: { start: string; end: string }[] = []) {
  const starts = [...periods.map((p) => toMin(p.start)), ...occ.map((o) => toMin(o.start))];
  const ends = [...periods.map((p) => toMin(p.end)), ...occ.map((o) => toMin(o.end))];
  if (!starts.length) return { from: 9 * 60, to: 17 * 60 };
  return { from: Math.floor(Math.min(...starts) / 60) * 60, to: Math.ceil(Math.max(...ends) / 60) * 60 };
}

export interface Placed { o: Occurrence; lane: number; lanes: number }

/** Side-by-side lanes for overlapping blocks in one column (moved-away ghosts next to what took their slot). */
export function lanes(items: Occurrence[]): Placed[] {
  const sorted = items.slice().sort((a, b) => toMin(a.start) - toMin(b.start) || toMin(b.end) - toMin(a.end));
  const out: Placed[] = [];
  let cluster: Placed[] = [];
  let clusterEnd = -1;
  const flush = () => {
    const n = Math.max(0, ...cluster.map((p) => p.lane + 1));
    cluster.forEach((p) => (p.lanes = n));
    out.push(...cluster);
    cluster = [];
  };
  for (const o of sorted) {
    const s = toMin(o.start);
    if (s >= clusterEnd && cluster.length) flush();
    const used = new Set(cluster.filter((p) => toMin(p.o.end) > s).map((p) => p.lane));
    let lane = 0;
    while (used.has(lane)) lane++;
    cluster.push({ o, lane, lanes: 1 });
    clusterEnd = Math.max(clusterEnd, toMin(o.end));
  }
  flush();
  return out;
}
