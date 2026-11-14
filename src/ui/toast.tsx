'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

export type ToastKind = 'success' | 'error' | 'warn';

type Toast = { id: number; kind: ToastKind; text: string };

type ToastApi = {
  toast: (text: string, kind?: ToastKind) => void;
  success: (text: string) => void;
  error: (text: string) => void;
  warn: (text: string) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

const HIDE_AFTER_MS = 4_000;
const MAX_VISIBLE = 3;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const seq = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const remove = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const toast = useCallback(
    (text: string, kind: ToastKind = 'success') => {
      seq.current += 1;
      const id = seq.current;
      setItems((current) => [...current, { id, kind, text }].slice(-MAX_VISIBLE));
      timers.current.set(
        id,
        setTimeout(() => remove(id), HIDE_AFTER_MS),
      );
    },
    [remove],
  );

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      toast,
      success: (text: string) => toast(text, 'success'),
      error: (text: string) => toast(text, 'error'),
      warn: (text: string) => toast(text, 'warn'),
    }),
    [toast],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((item) => (
          <div key={item.id} className={`toast${item.kind === 'success' ? '' : ` toast-${item.kind}`}`}>
            <div className="row">
              <span className="log-msg">{item.text}</span>
              <span className="spacer" />
              <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={() => remove(item.id)} aria-label="Скрыть">
                ×
              </button>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error('useToast must be used inside <ToastProvider>');
  return api;
}