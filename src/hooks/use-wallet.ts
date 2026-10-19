import { useState, useEffect, useCallback, useRef } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { useWalletStore } from "@/stores/wallet-store";
import { computeBrn, type BrnComponents } from "@/lib/brn";

export function useWallet() {
  return useWalletStore();
}

export function useBrn(rpcUrl: string) {
  const result = useRpc<BrnComponents>("get_brn_components", { rpcUrl }, 10_000);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const timer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);
  try {
    return { ...result, balance: result.data && !result.error ? computeBrn(result.data, now) : null };
  } catch (error) {
    return { ...result, balance: null, error: String(error) };
  }
}

export function useRpc<T>(
  command: string,
  params?: Record<string, unknown> | null,
  interval?: number,
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

  const fetch = useCallback(async () => {
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
    else fetch();
    const timer = paramsRef.current !== null && interval && interval > 0 ? setInterval(fetch, interval) : undefined;
    return () => {
      mounted.current = false;
      ++requestId.current;
      inFlight.current = null;
      clearInterval(timer);
    };
  }, [fetch, interval]);

  return { data, loading, error, refetch: fetch };
}
