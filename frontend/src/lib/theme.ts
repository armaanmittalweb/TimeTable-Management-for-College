import { useSyncExternalStore } from 'react';
import { load, save } from './store';

export type ThemeChoice = 'system' | 'light' | 'dark';
const KEY = 'edusched.theme';
const media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
const listeners = new Set<() => void>();

export const themeChoice = (): ThemeChoice => {
  const v = load<string>(KEY, 'system');
  return v === 'light' || v === 'dark' ? v : 'system';
};

export function applyTheme() {
  const choice = themeChoice();
  const dark = choice === 'dark' || (choice === 'system' && !!media?.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#12161f' : '#ffffff');
  listeners.forEach((l) => l());
}

export function setTheme(choice: ThemeChoice) {
  save(KEY, choice === 'system' ? null : choice);
  applyTheme();
}

media?.addEventListener('change', applyTheme);

export function useTheme() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    themeChoice,
  );
}
