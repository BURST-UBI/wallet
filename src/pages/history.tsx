import { useState, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ArrowUpRight,
  ArrowDownLeft,
  Flame,
  ShieldCheck,
  Vote,
  Loader2,
  Clock,
  Link2,
  Hash,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useWallet } from "@/hooks/use-wallet";
import { formatAmount, truncateAddress, formatTimeSince, cn } from "@/lib/utils";
import type { AccountHistory, HistoryEntry } from "@/lib/types";

function typeIcon(type: string) {
  switch (type) {
    case "send": return <ArrowUpRight className="h-4 w-4" />;
    case "burn": return <Flame className="h-4 w-4" />;
    case "endorse": return <ShieldCheck className="h-4 w-4" />;
    case "governance": return <Vote className="h-4 w-4" />;
    default: return <ArrowDownLeft className="h-4 w-4" />;
  }
}

function typeColor(type: string) {
  switch (type) {
    case "send": return "text-destructive bg-destructive/10";
    case "burn": return "text-warning bg-warning/10";
    case "endorse": return "text-purple-400 bg-purple-400/10";
    case "governance": return "text-blue-400 bg-blue-400/10";
    default: return "text-success bg-success/10";
  }
}

function amountPrefix(type: string) {
  switch (type) {
    case "send":
    case "burn":
    case "endorse":
      return "−";
    default:
      return "+";
  }
}

function amountColor(type: string) {
  switch (type) {
    case "send":
    case "burn":
    case "endorse":
      return "text-destructive";
    default:
      return "text-success";
  }
}

export default function HistoryPage() {
  const { rpcUrl } = useWallet();
  const [allEntries, setAllEntries] = useState<HistoryEntry[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [loadingMore, setLoadingMore] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);

  const loadInitial = useCallback(async () => {
    try {
      const result = await invoke<AccountHistory>("get_account_history", {
        rpcUrl,
        count: 25,
      });
      setAllEntries(result.history);
      setCursor(result.cursor);
    } catch {
      // handled silently
    } finally {
      setInitialLoading(false);
    }
  }, [rpcUrl]);

  useEffect(() => {
    loadInitial();
  }, [loadInitial]);

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const result = await invoke<AccountHistory>("get_account_history", {
        rpcUrl,
        cursor,
        count: 25,
      });
      setAllEntries((prev) => [...prev, ...result.history]);
      setCursor(result.cursor);
    } catch {
      // handled silently
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Transaction History</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Full history of all burns, transfers, endorsements, and governance actions.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">All Transactions</CardTitle>
        </CardHeader>
        <CardContent>
          {initialLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
            </div>
          ) : !allEntries.length ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No transactions found
            </p>
          ) : (
            <div className="space-y-2">
              {allEntries.map((tx, i) => (
                <div
                  key={`${tx.hash}-${i}`}
                  className="rounded-lg border p-3 transition-colors hover:bg-accent/20"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={cn(
                        "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                        typeColor(tx.block_type),
                      )}
                    >
                      {typeIcon(tx.block_type)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-[10px] capitalize">
                          {tx.block_type}
                        </Badge>
                        {tx.timestamp && (
                          <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                            <Clock className="h-2.5 w-2.5" />
                            {formatTimeSince(parseInt(tx.timestamp, 10))}
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                        {tx.block_type === "send" || tx.block_type === "burn" || tx.block_type === "endorse"
                          ? "To: "
                          : "From: "}
                        {truncateAddress(tx.account)}
                      </p>
                    </div>
                    <p className={cn("font-mono text-sm font-semibold", amountColor(tx.block_type))}>
                      {amountPrefix(tx.block_type)}
                      {formatAmount(tx.amount)}
                    </p>
                  </div>

                  {(tx.origin || tx.link) && (
                    <div className="mt-2 flex flex-wrap gap-3 pl-12 text-[10px] text-muted-foreground">
                      {tx.origin && (
                        <span className="flex items-center gap-1">
                          <Hash className="h-2.5 w-2.5" />
                          Origin: <span className="font-mono">{truncateAddress(tx.origin)}</span>
                        </span>
                      )}
                      {tx.link && (
                        <span className="flex items-center gap-1">
                          <Link2 className="h-2.5 w-2.5" />
                          Link: <span className="font-mono">{truncateAddress(tx.link)}</span>
                        </span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {cursor && (
            <div className="mt-4 flex justify-center">
              <Button
                variant="outline"
                onClick={loadMore}
                disabled={loadingMore}
              >
                {loadingMore && <Loader2 className="animate-spin" />}
                Load More
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
