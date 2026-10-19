import { X } from 'lucide-react';
import { type ReactNode, useEffect, useRef } from 'react';

interface DialogProps {
  open: boolean;
  onClose(): void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  className?: string;
}

/** A modal built on the native <dialog>: focus trapping and Escape come for free. */
export function Dialog({ open, onClose, title, description, children, footer, wide, className }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={`dialog ${wide ? 'dialog-wide' : ''} ${className ?? ''}`}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      aria-labelledby="dialog-title"
    >
      {open && (
        <>
          <div className="dialog-head">
            <div>
              <h2 id="dialog-title">{title}</h2>
              {description && <p className="muted" style={{ marginTop: 4 }}>{description}</p>}
            </div>
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
              <X size={18} />
            </button>
          </div>
          <div className="dialog-body">{children}</div>
          {footer && <div className="dialog-foot">{footer}</div>}
        </>
      )}
    </dialog>
  );
}
