import { type ReactNode, createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

interface ToastItem {
  id: number;
  message: string;
  tone: 'info' | 'error';
  action?: { label: string; run(): void };
}

interface ToastApi {
  show(message: string, options?: { tone?: 'info' | 'error'; action?: { label: string; run(): void }; duration?: number }): void;
}

const ToastContext = createContext<ToastApi>({ show: () => {} });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const next = useRef(1);
  const dismiss = useCallback((id: number) => setItems((all) => all.filter((t) => t.id !== id)), []);
  const show = useCallback<ToastApi['show']>((message, options = {}) => {
    const id = next.current++;
    setItems((all) => [...all.slice(-2), { id, message, tone: options.tone ?? 'info', action: options.action }]);
    window.setTimeout(() => dismiss(id), options.duration ?? (options.action ? 7000 : 3200));
  }, [dismiss]);
  const api = useMemo(() => ({ show }), [show]);
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
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
