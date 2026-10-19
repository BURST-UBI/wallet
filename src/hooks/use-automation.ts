import { useEffect, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { useWallet } from "./use-wallet";
import { toast } from "sonner";

// Survives component remounts: never queue overlapping automatic signers.
let running = false;
export function useAutomation() {
  const { address, isLocked, watchOnly, rpcUrl, autoAccept, trustedSenders, mergeLevel, groupPolicy, setGroupHolds } = useWallet();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setError(null);
    setGroupHolds({});
    const recentHolds = new Map<string,string>();
    let cancelled = false;
    let activeSession: string | null = null;
    async function cancel(session: string) {
      try { await invoke("cancel_automation", {session}); }
      catch (error) {
        toast.error("An earlier automation pass may still be running", {description:String(error)});
      }
    }
    async function poll() {
      if (cancelled || running || !isTauri() || isLocked || watchOnly || !address || (!autoAccept && !mergeLevel)) return;
      if (!groupPolicy) {setError("Saved group rules could not be read. Review and save them in Settings before automation can run.");return;}
      running = true;
      let session: string | null = null;
      try {
        session = await invoke<string>("begin_automation");
        activeSession = session;
        if (cancelled) return;
        const result = await invoke<{received:number;merged:number;held:number;held_reasons?:{hash:string;reason:string}[];checked_hashes?:string[];protocol_fallbacks?:number}>("maintain_wallet", {
          rpcUrl, expectedAccount:address, autoAccept, trustedSenders, mergeLevel, automationSession:session, groupPolicy,
        });
        if (!cancelled) {
          setError(null);
          for (const hash of result.checked_hashes ?? []) recentHolds.delete(hash);
          for (const item of result.held_reasons ?? []) recentHolds.set(item.hash,item.reason);
          // Retain recent explanations across scan pages, never membership decisions.
          while (recentHolds.size > 512) recentHolds.delete(recentHolds.keys().next().value!);
          setGroupHolds(Object.fromEntries(recentHolds));
          if (result.received) toast.success(`Automatically received ${result.received} payment${result.received === 1 ? "" : "s"}`,{
            description:result.protocol_fallbacks ? `${result.protocol_fallbacks} accepted using protocol checks while groups were unavailable.` : undefined,
          });
          if (result.merged) toast.success(`Merged ${result.merged} compatible TRST batches`);
        }
      } catch (e) {
        if (!cancelled) setError(String(e) === "Automation settings changed; remaining payments were not submitted" ? null : String(e));
      } finally {
        if (session !== null) await cancel(session);
        activeSession = null;
        running = false;
      }
    }
    // Give the UI a moment to settle, then poll only while this wallet is open.
    const first = setTimeout(poll, 1500);
    const timer = setInterval(poll, 15_000);
    return () => {
      cancelled = true;
      clearTimeout(first); clearInterval(timer);
      if (activeSession !== null) void cancel(activeSession);
    };
  }, [address, isLocked, watchOnly, rpcUrl, autoAccept, JSON.stringify(trustedSenders), mergeLevel, JSON.stringify(groupPolicy), setGroupHolds]);
  return error;
}
