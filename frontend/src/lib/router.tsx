// A small history router: one location store, a navigate() function and a <Link>.

import { useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from 'react';

type Listener = () => void;
const listeners = new Set<Listener>();
let snapshot = location.pathname + location.search;

function emit() {
  const next = location.pathname + location.search;
  if (next === snapshot) return;
  snapshot = next;
  listeners.forEach((l) => l());
}
addEventListener('popstate', emit);

export function navigate(to: string, opts: { replace?: boolean; keepScroll?: boolean } = {}) {
  const url = new URL(to, location.href);
  const target = url.pathname + url.search;
  if (target === location.pathname + location.search) return;
  const samePath = url.pathname === location.pathname;
  if (opts.replace) history.replaceState(null, '', target);
  else history.pushState(null, '', target);
  emit();
  if (!samePath && !opts.keepScroll) window.scrollTo(0, 0);
}

/** Update query parameters in place (replace, so every filter click is not a history entry). */
export function setQuery(params: Record<string, string | null | undefined>, push = false) {
  const url = new URL(location.href);
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === '') url.searchParams.delete(k);
    else url.searchParams.set(k, v);
  }
  navigate(url.pathname + url.search, { replace: !push, keepScroll: true });
}

const subscribe = (l: Listener) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useLocation() {
  const loc = useSyncExternalStore(subscribe, () => snapshot);
  const q = loc.indexOf('?');
  const path = q < 0 ? loc : loc.slice(0, q);
  const query = new URLSearchParams(q < 0 ? '' : loc.slice(q));
  return { path, query, href: loc };
}

/** Match "/w/:slug/setup/:step?" against a path; returns params or null. */
export function match(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split('/').filter(Boolean);
  const s = path.replace(/\/+$/, '').split('/').filter(Boolean);
  const params: Record<string, string> = {};
  let i = 0;
  for (; i < p.length; i++) {
    const part = p[i];
    const optional = part.endsWith('?');
    const name = part.replace(/^:|\?$/g, '');
    if (part.startsWith(':')) {
      if (s[i] === undefined) {
        if (optional) continue;
        return null;
      }
      try {
        params[name] = decodeURIComponent(s[i]);
      } catch {
        return null;
      }
    } else if (s[i] !== part) return null;
  }
  return s.length > p.length ? null : params;
}

export function Link({ href, onClick, replace, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; replace?: boolean }) {
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || rest.target === '_blank') return;
    const url = new URL(href, location.href);
    if (url.origin !== location.origin) return;
    e.preventDefault();
    navigate(url.pathname + url.search + url.hash, { replace });
  };
  return <a href={href} onClick={handle} {...rest} />;
}
