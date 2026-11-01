import { useState, useEffect } from "react";
import { computeBrn, type BrnComponents } from "@/lib/brn";
import { useRpc } from "@/hooks/use-rpc";

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

