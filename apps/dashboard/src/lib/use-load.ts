"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "./api";
import { useLiveMarker, type LiveKey } from "./live-context";

export interface LoadState<T> {
  data: T | null;
  error: Error | null;
  /** true only for the first load of a given dependency set */
  loading: boolean;
  reload: () => Promise<void>;
  setData: (v: T | null | ((prev: T | null) => T | null)) => void;
  forbidden: boolean;
}

/** Fetch-on-mount/deps with stale-response protection. `forbidden` is true for a 403 (render "Sem acesso"). */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[], opts?: { live?: LiveKey | LiveKey[] }): LoadState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const run = useCallback(async (showLoading: boolean) => {
    const id = ++seq.current;
    if (showLoading) setLoading(true);
    try {
      const result = await fnRef.current();
      if (id !== seq.current) return;
      setData(result);
      setError(null);
    } catch (e) {
      if (id !== seq.current) return;
      setError(e instanceof Error ? e : new Error(String(e)));
      // A failed load for NEW dependencies (another tab/filter) must not keep showing the previous set's rows.
      if (showLoading) setData(null);
    } finally {
      if (id === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void run(true);
    return () => {
      seq.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const reload = useCallback(() => run(false), [run]);

  // Live refresh: when the change marker of the watched lists moves, refetch in the background (no skeleton, state kept).
  const marker = useLiveMarker(opts?.live);
  const lastMarker = useRef<string | null>(marker);
  useEffect(() => {
    if (marker === null) return;
    if (lastMarker.current !== null && lastMarker.current !== marker) void run(false);
    lastMarker.current = marker;
  }, [marker, run]);
  const forbidden = error instanceof ApiError && error.status === 403;
  return { data, error, loading, reload, setData, forbidden };
}

export function errorMessage(e: unknown, fallback = "Algo deu errado. Tente de novo."): string {
  if (e instanceof Error && e.message) return e.message;
  return fallback;
}

/** true when the route simply is not deployed yet (404 from a missing endpoint) */
export function isMissingRoute(e: unknown): boolean {
  return e instanceof ApiError && e.status === 404 && (e.body?.message ?? "").toString().startsWith("Cannot ");
}
