import { useState, useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { activityPresentation } from "@/lib/activity";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useWallet } from "@/hooks/use-wallet";
import { formatAmount, formatTimeSince } from "@/lib/utils";
import type { AccountHistory, HistoryEntry } from "@/lib/types";

export default function HistoryPage() {
  const { rpcUrl } = useWallet();
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [cursor, setCursor] = useState<string>();
  const [offset, setOffset] = useState("0");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const paginationPending = useRef(false);
  const requestedOffset = useRef("0");

  const loadPage = useCallback(async (target: string) => {
    if (paginationPending.current) return;
    paginationPending.current = true;
    requestedOffset.current = target;
    const request = ++generation.current;
    setLoading(true);
    setError("");
    try {
      const result = await invoke<AccountHistory>("get_account_history", { rpcUrl, cursor: btoa(target), count: 25 });
      if (request !== generation.current) return;
      const nextOffset = result.cursor ? atob(result.cursor) : undefined;
      if (result.history.length > 25 || (nextOffset !== undefined && (!/^\d+$/.test(nextOffset) || BigInt(nextOffset) <= BigInt(target)))) {
        throw new Error("The node returned an invalid history page. Try again or choose another node.");
      }
      setEntries(result.history);
      setCursor(nextOffset);
      setOffset(target);
    } catch (cause) {
      if (request === generation.current) setError(String(cause));
    } finally {
      if (request === generation.current) {
        paginationPending.current = false;
        setLoading(false);
      }
    }
  }, [rpcUrl]);

  useEffect(() => {
    generation.current++;
    paginationPending.current = false;
    setEntries([]);
    setCursor(undefined);
    setOffset("0");
    void loadPage("0");
    return () => { generation.current++; };
  }, [loadPage]);

  return <div className="space-y-6">
    <div><h1 className="text-title tracking-tight">Activity</h1><p className="mt-2 text-caption text-muted-foreground">Your account history. Balances show TRST after each block, not payment amounts.</p></div>
    {error && <section role="alert" className="rounded-lg bg-muted p-4">
      <p>Activity unavailable</p><p className="mt-2 break-words text-caption text-muted-foreground">{error}</p>
      <Button variant="outline" className="mt-3" onClick={() => loadPage(requestedOffset.current)} disabled={loading}>Try again</Button>
    </section>}
    {!!entries.length && <nav aria-label="Activity pages" className="flex flex-wrap items-center justify-between gap-3">
      <p role="status" className="text-caption tabular-nums text-muted-foreground">{loading ? "Loading activity…" : `Entries ${BigInt(offset) + 1n}–${BigInt(offset) + BigInt(entries.length)}`}</p>
      <div className="flex gap-2">
        <Button variant="outline" className="min-h-11" disabled={loading || offset === "0"} onClick={() => loadPage((BigInt(offset) > 25n ? BigInt(offset) - 25n : 0n).toString())}>Previous</Button>
        <Button variant="outline" className="min-h-11" disabled={loading || !cursor} onClick={() => cursor && loadPage(cursor)}>Next</Button>
      </div>
    </nav>}
    {loading && !entries.length ? <div className="space-y-3">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-20 w-full" />)}</div>
      : !entries.length && !error ? <p className="py-12 text-center text-muted-foreground">No activity yet</p>
      : <div aria-busy={loading}>{entries.map((entry, index) => {
        const { Icon, label } = activityPresentation(entry.block_type);
        return <details key={entry.hash + index} className="border-b border-border py-2">
          <summary className="flex min-h-16 cursor-pointer list-none items-center gap-3 rounded-md py-2">
            <span className="activity-symbol"><Icon aria-hidden="true" className="size-[18px]" /></span>
            <span className="min-w-0 flex-1"><span className="block">{label}</span><span className="mt-1 block text-caption text-muted-foreground">{entry.timestamp ? formatTimeSince(Number(entry.timestamp)) : "Time unavailable"}</span></span>
            <span className="min-w-0 text-end"><span className="block break-all tabular-nums">{formatAmount(entry.amount)}</span><span className="mt-1 block text-caption text-muted-foreground">TRST balance</span></span>
          </summary>
          <dl className="space-y-3 pb-4 pt-2 text-caption">
            {[["Operation", entry.block_type], ["Block", entry.hash], ["Account", entry.account], ["Origin", entry.origin], ["Link", entry.link], ["TRST balance (raw units)", entry.amount]].filter(([, value]) => value).map(([label, value]) =>
              <div key={label}><dt className="text-muted-foreground">{label}</dt><dd className="mt-1 break-all font-mono select-text">{value}</dd></div>
            )}
          </dl>
        </details>;
      })}</div>}
  </div>;
}
