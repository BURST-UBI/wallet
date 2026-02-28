import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useWalletStore } from "@/stores/wallet-store";

export function useWallet() {
  return useWalletStore();
}

export function useRpc<T>(
  command: string,
  params?: Record<string, unknown>,
  interval?: number,
) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const paramsRef = useRef(params);
  paramsRef.current = params;

  const fetch = useCallback(async () => {
    try {
      const result = await invoke<T>(command, paramsRef.current);
      setData(result);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [command]);

  useEffect(() => {
    fetch();
    if (interval && interval > 0) {
      const id = setInterval(fetch, interval);
      return () => clearInterval(id);
    }
  }, [fetch, interval]);

  return { data, loading, error, refetch: fetch };
}
