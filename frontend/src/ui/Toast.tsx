// Short confirmations ("Class moved to Thu 10:00, CR-204") with an optional action, announced politely.

import { useSyncExternalStore } from 'react';

export interface ToastItem { id: number; text: string; action?: { label: string; run: () => void }; tone?: 'default' | 'error' }
let items: ToastItem[] = [];
let seq = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function toast(text: string, opts: { action?: ToastItem['action']; tone?: ToastItem['tone']; ms?: number } = {}) {
  const t: ToastItem = { id: seq++, text, action: opts.action, tone: opts.tone };
  items = [...items.slice(-2), t];
  emit();
  setTimeout(() => dismiss(t.id), opts.ms ?? (opts.action ? 8000 : 5000));
}
export function dismiss(id: number) {
  items = items.filter((t) => t.id !== id);
  emit();
}

export function Toaster() {
  const list = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => items,
  );
  return (
    <div className="toasts" role="status" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={`toast${t.tone === 'error' ? ' is-error' : ''}`}>
          <span>{t.text}</span>
          {t.action && (
            <button
              type="button"
              className="toast-action"
              onClick={() => {
                t.action!.run();
                dismiss(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
          <button type="button" className="toast-x" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
