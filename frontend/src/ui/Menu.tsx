// A popover anchored to a button: opens below it (or above when there is no room), closes on outside click
// or Esc and returns focus to the button. Menus get arrow-key movement between items.

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';

export function usePopover() {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const close = useCallback((refocus = true) => {
    setOpen(false);
    if (refocus) anchor.current?.focus();
  }, []);
  return { open, setOpen, anchor, close, toggle: () => setOpen((o) => !o) };
}

export function Popover({
  open, anchor, onClose, children, align = 'start', width, className = '', label, role = 'dialog',
}: {
  open: boolean; anchor: React.RefObject<HTMLElement | null>; onClose: (refocus?: boolean) => void; children: ReactNode;
  align?: 'start' | 'end'; width?: number; className?: string; label: string; role?: 'dialog' | 'menu' | 'listbox';
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; maxH: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !anchor.current) return;
    const place = () => {
      const a = anchor.current!.getBoundingClientRect();
      const w = width ?? ref.current?.offsetWidth ?? 240;
      const h = ref.current?.offsetHeight ?? 200;
      let left = align === 'end' ? a.right - w : a.left;
      left = Math.max(8, Math.min(left, innerWidth - w - 8));
      const below = innerHeight - a.bottom - 12;
      const top = below < Math.min(h, 260) && a.top > below ? Math.max(8, a.top - 6 - h) : a.bottom + 6;
      setPos({ top, left, maxH: Math.max(160, top > a.top ? innerHeight - top - 12 : a.top - 12) });
    };
    place();
    addEventListener('resize', place);
    addEventListener('scroll', place, true);
    return () => {
      removeEventListener('resize', place);
      removeEventListener('scroll', place, true);
    };
  }, [open, anchor, align, width]);

  useEffect(() => {
    if (!open) return;
    const first = ref.current?.querySelector<HTMLElement>('[data-autofocus], [role="menuitem"], [role="menuitemradio"], input, button:not([disabled]), select');
    first?.focus();
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor.current?.contains(t)) return;
      onClose(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose(true);
      }
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open, onClose, anchor]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (role !== 'menu') return;
    const items = [...(ref.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([aria-disabled="true"])') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    let next = -1;
    if (e.key === 'ArrowDown') next = (i + 1) % items.length;
    else if (e.key === 'ArrowUp') next = (i - 1 + items.length) % items.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    else if (e.key === 'Tab') onClose(false);
    if (next >= 0) {
      e.preventDefault();
      items[next]?.focus();
    }
  };

  if (!open) return null;
  return createPortal(
    <div
      ref={ref}
      className={`pop ${className}`}
      role={role}
      aria-label={label}
      onKeyDown={onKeyDown}
      data-placed={pos ? '' : undefined}
      style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width, maxHeight: pos?.maxH }}
    >
      {children}
    </div>,
    document.body,
  );
}

export function MenuItem({ children, onSelect, icon, danger, checked, href, kbd }: {
  children: ReactNode; onSelect?: () => void; icon?: ReactNode; danger?: boolean; checked?: boolean; href?: string; kbd?: string;
}) {
  const cls = `menu-item${danger ? ' is-danger' : ''}`;
  const inner = (
    <>
      <span className="menu-ico">{icon}</span>
      <span className="menu-label">{children}</span>
      {kbd && <kbd>{kbd}</kbd>}
      {checked !== undefined && <span className="menu-check" aria-hidden="true">{checked ? '✓' : ''}</span>}
    </>
  );
  if (href) {
    return (
      <a className={cls} role="menuitem" tabIndex={-1} href={href} onClick={onSelect}>
        {inner}
      </a>
    );
  }
  return (
    <button type="button" className={cls} role={checked === undefined ? 'menuitem' : 'menuitemradio'} aria-checked={checked} tabIndex={-1} onClick={onSelect}>
      {inner}
    </button>
  );
}
