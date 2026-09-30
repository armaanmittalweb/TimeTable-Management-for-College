// A small query cache: results by key in memory (instant back/forward between weeks), optionally mirrored to
// localStorage so the last-seen copy can be shown offline with the time it was saved. Mutations call
// invalidate() and every mounted query refetches.

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ApiFailure } from '../api';
import { load, save } from '../lib/store';

type Entry = { data: unknown; at: number };
const memory = new Map<string, Entry>();
let version = 0;
const listeners = new Set<() => void>();

/** Every mounted query refetches (they all revalidate on mount anyway, so cached ones never go stale for long). */
export function invalidate() {
  version++;
  listeners.forEach((l) => l());
}
const useVersion = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version,
  );

export interface QueryState<T> {
  data: T | undefined;
  error: ApiFailure | null;
  loading: boolean;
  /** Set when showing a saved copy because the network failed: when that copy was saved. */
  offlineSince: number | null;
  reload: () => void;
}

export function useQuery<T>(key: string | null, fetcher: () => Promise<T>, opts: { persist?: string } = {}): QueryState<T> {
  const v = useVersion();
  const cached = key ? (memory.get(key) as Entry | undefined) : undefined;
  const [state, setState] = useState<{ key: string | null; data: T | undefined; error: ApiFailure | null; loading: boolean; offlineSince: number | null }>(() => ({
    key, data: cached?.data as T | undefined, error: null, loading: !!key, offlineSince: null,
  }));
  const [tick, setTick] = useState(0);
  const fetchRef = useRef(fetcher);
  fetchRef.current = fetcher;

  // Show whatever we already have for a new key straight away.
  if (state.key !== key) {
    const c = key ? memory.get(key) : undefined;
    setState({ key, data: c?.data as T | undefined, error: null, loading: !!key, offlineSince: null });
  }

  useEffect(() => {
    if (!key) return;
    let live = true;
    setState((s) => (s.key === key ? { ...s, loading: true } : s));
    fetchRef.current().then(
      (data) => {
        if (!live) return;
        memory.set(key, { data, at: Date.now() });
        if (opts.persist) save(opts.persist, { data, at: Date.now() });
        setState({ key, data, error: null, loading: false, offlineSince: null });
      },
      (err: unknown) => {
        if (!live) return;
        const e = err instanceof ApiFailure ? err : new ApiFailure(0, null, true);
        const saved = e.offline && opts.persist ? load<Entry | null>(opts.persist, null) : null;
        setState((s) => ({
          key,
          data: saved ? (saved.data as T) : e.offline ? s.data : undefined,
          error: e,
          loading: false,
          offlineSince: saved ? saved.at : e.offline && s.data !== undefined ? memory.get(key)?.at ?? Date.now() : null,
        }));
      },
    );
    return () => {
      live = false;
    };
    // v: refetch after invalidate(); tick: manual reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, v, tick, opts.persist]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data: state.data, error: state.error, loading: state.loading, offlineSince: state.offlineSince, reload };
}

/** Put a known result in the cache (e.g. after a mutation returns the new object). */
export const prime = (key: string, data: unknown) => memory.set(key, { data, at: Date.now() });
export const clearQueries = () => memory.clear();
