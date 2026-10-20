import { X } from 'lucide-react';
import { type ReactNode, createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

interface ToastItem {
  id: number;
  message: string;
  tone: 'info' | 'error';
  action?: { label: string; run(): void };
  /** Stays until the person acts on it or closes it. */
  sticky: boolean;
}

interface ToastApi {
  /** Shows a message and returns its id. `duration: Infinity` keeps it until it's closed. */
  show(message: string, options?: { tone?: 'info' | 'error'; action?: { label: string; run(): void }; duration?: number }): number;
  dismiss(id: number): void;
}

const ToastContext = createContext<ToastApi>({ show: () => 0, dismiss: () => {} });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const next = useRef(1);
  const dismiss = useCallback((id: number) => setItems((all) => all.filter((t) => t.id !== id)), []);
  const show = useCallback<ToastApi['show']>((message, options = {}) => {
    const id = next.current++;
    const duration = options.duration ?? (options.action ? 7000 : 3200);
    const sticky = !Number.isFinite(duration);
    setItems((all) => [...all.slice(-2), { id, message, tone: options.tone ?? 'info', action: options.action, sticky }]);
    if (!sticky) window.setTimeout(() => dismiss(id), duration);
    return id;
  }, [dismiss]);
  const api = useMemo(() => ({ show, dismiss }), [show, dismiss]);
  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.tone === 'error' ? 'error' : ''}`}>
            <span>{t.message}</span>
            {t.action && (
              <button type="button" onClick={() => { t.action!.run(); dismiss(t.id); }}>{t.action.label}</button>
            )}
            {t.sticky && (
              <button type="button" className="toast-close" onClick={() => dismiss(t.id)} aria-label="Dismiss"><X size={15} aria-hidden /></button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
