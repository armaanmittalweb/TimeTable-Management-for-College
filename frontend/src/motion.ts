import { useSyncExternalStore } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';
const mql = typeof matchMedia === 'function' ? matchMedia(QUERY) : null;

function subscribe(cb: () => void) {
  mql?.addEventListener('change', cb);
  return () => mql?.removeEventListener('change', cb);
}

export const prefersReducedMotion = () => mql?.matches ?? false;

export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, prefersReducedMotion, () => false);
}

export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = matchMedia(query);
      m.addEventListener('change', cb);
      return () => m.removeEventListener('change', cb);
    },
    () => matchMedia(query).matches,
    () => false,
  );
}
