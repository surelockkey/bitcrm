"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface Loaded<T> {
  data: T | undefined;
  error: unknown;
  loading: boolean;
  reload: () => void;
}

/**
 * Runs `load` on mount and whenever `key` changes; a stale answer (the key
 * moved on, or the component unmounted) is dropped. Deliberately not
 * react-query: the public portal ships this to a client's phone and needs
 * nothing more than "fetch once, retry on demand".
 */
export function useLoad<T>(load: () => Promise<T>, key: string): Loaded<T> {
  const loadRef = useRef(load);
  loadRef.current = load;
  const [state, setState] = useState<{ key: string; data?: T; error?: unknown; loading: boolean }>({
    key,
    loading: true,
  });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState((s) => (s.key === key ? { ...s, loading: true, error: undefined } : { key, loading: true }));
    loadRef.current().then(
      (data) => !cancelled && setState({ key, data, loading: false }),
      (error: unknown) => !cancelled && setState({ key, error, loading: false }),
    );
    return () => {
      cancelled = true;
    };
  }, [key, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  // A render between a key change and its effect must not show the previous key's data.
  const current = state.key === key ? state : { key, loading: true, data: undefined, error: undefined };
  return { data: current.data, error: current.error, loading: current.loading, reload };
}
