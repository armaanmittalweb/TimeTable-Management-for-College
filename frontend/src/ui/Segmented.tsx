// A segmented control as a radio group: one tab stop, arrows move and select.

import { useId, type KeyboardEvent, type ReactNode } from 'react';

export function Segmented<T extends string>({ value, options, onChange, label, size = 'md' }: {
  value: T; options: { value: T; label: ReactNode; count?: number }[]; onChange: (v: T) => void; label: string; size?: 'sm' | 'md';
}) {
  const name = useId();
  const onKey = (e: KeyboardEvent) => {
    const i = options.findIndex((o) => o.value === value);
    let n = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') n = (i + 1) % options.length;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') n = (i - 1 + options.length) % options.length;
    if (n < 0) return;
    e.preventDefault();
    e.stopPropagation();
    onChange(options[n].value);
    requestAnimationFrame(() => (e.currentTarget as HTMLElement).querySelector<HTMLElement>('[aria-checked="true"]')?.focus());
  };
  return (
    <div className={`seg seg-${size}`} role="radiogroup" aria-label={label} onKeyDown={onKey} data-keys-local>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          name={name}
          aria-checked={o.value === value}
          tabIndex={o.value === value ? 0 : -1}
          className="seg-btn"
          onClick={() => onChange(o.value)}
        >
          {o.label}
          {o.count !== undefined && <span className="seg-count mono">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}
