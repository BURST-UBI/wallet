import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useWalletStore } from "@/stores/wallet-store";
import type { BlockResult } from "@/lib/types";

type Outcome = { status: "idle" | "sending" | "confirmed" | "uncertain" | "error"; hash?: string; message?: string };
const idle: Outcome = { status: "idle" };
// Memory-only receipts survive route changes, without persisting wallet activity.
const receipts = new Map<string, Outcome>();
const listeners = new Set<() => void>();
function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
function publish(key: string, outcome: Outcome) { receipts.set(key, outcome); listeners.forEach(listener => listener()); }

export function useTransaction(rpcUrl: string, address: string | null, command: string) {
  const key = JSON.stringify([rpcUrl, address, command]);
  const outcome = useSyncExternalStore(subscribe, () => receipts.get(key) ?? idle);
  async function submit(args: Record<string, unknown>, reviewed: { rpcUrl: string; address: string | null }) {
    const previous = receipts.get(key);
    if (previous && ["sending", "confirmed", "uncertain"].includes(previous.status)) return false;
    const current = useWalletStore.getState();
    if (current.watchOnly) {
      publish(key, { status: "error", message: "This wallet is view only. Use your signing device to make changes." });
      return false;
    }
    if (!reviewed.address || current.isLocked || current.rpcUrl !== reviewed.rpcUrl || current.address !== reviewed.address || reviewed.rpcUrl !== rpcUrl || reviewed.address !== address) {
      publish(key, { status: "error", message: "Your wallet or connection changed. Close this review and start again." });
      return false;
    }
    publish(key, { status: "sending" });
    try {
      const result = await invoke<BlockResult>(command, { ...args, rpcUrl, expectedAccount: reviewed.address });
      if (!result.accepted) throw new Error(result.detail ?? "The network did not accept this transaction.");
      publish(key, { status: "confirmed", hash: result.hash });
      return true;
    } catch (error) {
      const message = String(error);
      if (/^(?:Error: )?(?:appeal|verification vote) not submitted:/i.test(message)) {
        publish(key, { status: "error", message });
        return false;
      }
      if (/^(?:Error: )?account preparation incomplete; requested action was not submitted:/i.test(message)) {
        publish(key, { status: "error", message: "Your action was not submitted. Account preparation couldn’t finish. Try again." });
        return false;
      }
      const hash = /confirmation pending for ([a-fA-F0-9]{64})/i.exec(message)?.[1];
      const uncertain = !!hash || /request failed|connection|network error|failed to fetch|timed? ?out|invalid (?:JSON|process) response|HTTP 5\d\d/i.test(message);
      publish(key, uncertain ? { status: "uncertain", hash } : { status: "error", message });
      return uncertain;
    }
  }
  return { outcome, submit, clear: () => { if (receipts.get(key)?.status !== "sending") publish(key, idle); } };
}
