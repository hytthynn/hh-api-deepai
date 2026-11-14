'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiGet, errorText } from './api';

export type ApiState<T> = {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
  setData: (next: T) => void;
};

export function useApi<T>(path: string | null, options: { intervalMs?: number } = {}): ApiState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(path !== null);
  const [nonce, setNonce] = useState(0);
  const mounted = useRef(true);
  const intervalMs = options.intervalMs ?? 0;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (path === null) return;
    const controller = new AbortController();
    let cancelled = false;
    const run = async (silent: boolean): Promise<void> => {
      if (!silent) setLoading(true);
      try {
        const payload = await apiGet<T>(path, controller.signal);
        if (cancelled || !mounted.current) return;
        setData(payload);
        setError(null);
      } catch (err) {
        if (cancelled || !mounted.current) return;
        if (err instanceof Error && err.name === 'AbortError') return;
        setError(errorText(err));
      } finally {
        if (!cancelled && mounted.current) setLoading(false);
      }
    };
    void run(false);
    let timer: ReturnType<typeof setInterval> | null = null;
    if (intervalMs > 0) {
      timer = setInterval(() => {
        void run(true);
      }, intervalMs);
    }
    return () => {
      cancelled = true;
      controller.abort();
      if (timer) clearInterval(timer);
    };
  }, [path, nonce, intervalMs]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  return { data, error, loading: path === null ? false : loading, reload, setData };
}

export function useNow(intervalMs = 1_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}