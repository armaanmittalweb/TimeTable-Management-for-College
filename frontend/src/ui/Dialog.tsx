// Modal dialogs and bottom sheets on the native <dialog>: the browser traps focus, makes the page inert,
// closes on Esc and puts focus back where it was.

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Icon } from './Icon';

export function Dialog({
  open, onClose, title, description, children, footer, size = 'md', variant = 'dialog', className = '', initialFocus,
}: {
  open: boolean; onClose: () => void; title: ReactNode; description?: ReactNode; children?: ReactNode; footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg'; variant?: 'dialog' | 'sheet' | 'palette'; className?: string; initialFocus?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      opener.current = document.activeElement as HTMLElement | null;
      d.showModal();
      const target = (initialFocus && d.querySelector<HTMLElement>(initialFocus)) || d.querySelector<HTMLElement>('[data-autofocus]');
      target?.focus();
    } else if (!open && d.open) {
      d.close();
      opener.current?.focus?.();
    }
  }, [open, initialFocus]);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const onCancel = (e: Event) => {
      e.preventDefault();
      onClose();
    };
    d.addEventListener('cancel', onCancel);
    return () => d.removeEventListener('cancel', onCancel);
  }, [onClose]);

  return (
    <dialog
      ref={ref}
      className={`dlg dlg-${variant} dlg-${size} ${className}`}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      {open && (
        <div className="dlg-body">
          <header className="dlg-head">
            <h2 id={titleId} className="dlg-title">{title}</h2>
            <button type="button" className="btn btn-ghost btn-icon btn-sm dlg-x" onClick={onClose} aria-label="Close">
              <Icon name="x" />
            </button>
          </header>
          {description && <p id={descId} className="dlg-desc">{description}</p>}
          {children}
          {footer && <footer className="dlg-foot">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}
