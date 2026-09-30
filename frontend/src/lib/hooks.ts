import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

export function useMedia(query: string) {
  return useSyncExternalStore(
    (l) => {
      const m = matchMedia(query);
      m.addEventListener('change', l);
      return () => m.removeEventListener('change', l);
    },
    () => matchMedia(query).matches,
  );
}

export const usePhone = () => useMedia('(max-width: 720px)');

/** Re-renders every `ms` (the now-line, "resets in 23 h", "2 min ago"). */
export function useTick(ms = 30_000) {
  const [t, setT] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setT(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return t;
}

export function useOnline() {
  return useSyncExternalStore(
    (l) => {
      addEventListener('online', l);
      addEventListener('offline', l);
      return () => {
        removeEventListener('online', l);
        removeEventListener('offline', l);
      };
    },
    () => navigator.onLine,
  );
}

const typing = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
};

/**
 * A global single-key shortcut. Ignored while typing, while a modal is open (except Escape), and — for arrow
 * keys — when focus is inside something that uses arrows itself (the grid, segmented controls).
 */
export function useHotkey(key: string, handler: (e: KeyboardEvent) => void, enabled = true) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      if (e.key !== key && !(key.length === 1 && e.key.toLowerCase() === key && key !== '?')) return;
      if (typing(e.target)) return;
      if (key !== 'Escape' && document.querySelector('dialog[open], .pop')) return;
      if (key.startsWith('Arrow') && (e.target as HTMLElement | null)?.closest?.('[data-keys-local]')) return;
      ref.current(e);
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [key, enabled]);
}

export function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = title ? `${title} · EduSched` : 'EduSched: the timetable your department runs on';
  }, [title]);
}
