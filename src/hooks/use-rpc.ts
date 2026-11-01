import { useState, useEffect, useCallback, useRef } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";

export function useRpc<T>(
  command: string,
  params?: Record<string, unknown> | null,
  pollIntervalMs?: number,
) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const paramsRef = useRef(params);
  paramsRef.current = params;
  const paramsKey = JSON.stringify(params);
  const requestId = useRef(0);
  const mounted = useRef(false);
  const inFlight = useRef<number | null>(null);

  const refetch = useCallback(async () => {
    if (!mounted.current || inFlight.current !== null || paramsRef.current === null) return;
    const id = ++requestId.current;
    inFlight.current = id;
    setLoading(true);
    try {
      if (!isTauri()) throw new Error("Open the desktop wallet with npm run tauri dev. Browser preview cannot access wallet keys.");
      const result = await invoke<T>(command, paramsRef.current ?? undefined);
      if (!mounted.current || id !== requestId.current) return;
      setData(result);
      setError(null);
    } catch (e) {
      if (mounted.current && id === requestId.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (inFlight.current === id) inFlight.current = null;
      if (mounted.current && id === requestId.current) setLoading(false);
    }
  }, [command, paramsKey]);

  useEffect(() => {
    mounted.current = true;
    setData(null);
    setError(null);
    if (paramsRef.current === null) setLoading(false);
    else refetch();
    const timer = paramsRef.current !== null && pollIntervalMs && pollIntervalMs > 0 ? setInterval(refetch, pollIntervalMs) : undefined;
    return () => {
      mounted.current = false;
      ++requestId.current;
      inFlight.current = null;
      clearInterval(timer);
    };
  }, [refetch, pollIntervalMs]);

  return { data, loading, error, refetch };
}
