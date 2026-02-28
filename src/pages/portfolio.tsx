import { useState } from "react";
import { CircleDollarSign, Award, AlertTriangle, Info, Clock, ChevronDown } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useWallet, useRpc } from "@/hooks/use-wallet";
import { formatAmount, formatTimeRemaining, truncateAddress, cn } from "@/lib/utils";
import type { TrstPortfolio, TrstBatch } from "@/lib/types";

function batchStatus(batch: TrstBatch) {
  if (batch.status === "revoked") return { label: "Revoked", color: "bg-destructive/15 text-destructive border-destructive/30" };
  if (batch.status === "expired") return { label: "Virtue Points", color: "bg-muted text-muted-foreground border-border" };

  const now = Date.now() / 1000;
  const remaining = batch.expiry_at - now;
  const thirtyDays = 30 * 86400;

  if (remaining <= 0) return { label: "Expired", color: "bg-muted text-muted-foreground border-border" };
  if (remaining < thirtyDays) return { label: "Expiring Soon", color: "bg-warning/15 text-warning border-warning/30" };
  return { label: "Active", color: "bg-success/15 text-success border-success/30" };
}

function expiryProgress(batch: TrstBatch) {
  const now = Date.now() / 1000;
  const total = batch.expiry_at - batch.timestamp;
  if (total <= 0) return 100;
  const elapsed = now - batch.timestamp;
  return Math.min(100, Math.max(0, (elapsed / total) * 100));
}

function CompositionBar({
  active,
  expired,
  revoked,
}: {
  active: number;
  expired: number;
  revoked: number;
}) {
  const total = active + expired + revoked;
  if (total === 0) {
    return (
      <div className="h-3 w-full rounded-full bg-muted" />
    );
  }
  const activePct = (active / total) * 100;
  const expiredPct = (expired / total) * 100;
  const revokedPct = (revoked / total) * 100;

  return (
    <div className="space-y-2">
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
        {activePct > 0 && (
          <div
            className="h-full bg-gradient-to-r from-success to-success/80 transition-all duration-500"
            style={{ width: `${activePct}%` }}
          />
        )}
        {expiredPct > 0 && (
          <div
            className="h-full bg-gradient-to-r from-warning to-warning/80 transition-all duration-500"
            style={{ width: `${expiredPct}%` }}
          />
        )}
        {revokedPct > 0 && (
          <div
            className="h-full bg-gradient-to-r from-destructive to-destructive/80 transition-all duration-500"
            style={{ width: `${revokedPct}%` }}
          />
        )}
      </div>
      <div className="flex justify-between text-[11px] text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <div className="h-2 w-2 rounded-full bg-success" />
          Active {activePct.toFixed(1)}%
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-2 w-2 rounded-full bg-warning" />
          Expired {expiredPct.toFixed(1)}%
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-2 w-2 rounded-full bg-destructive" />
          Revoked {revokedPct.toFixed(1)}%
        </div>
      </div>
    </div>
  );
}

function BatchCard({ batch }: { batch: TrstBatch }) {
  const [expanded, setExpanded] = useState(false);
  const status = batchStatus(batch);
  const progress = expiryProgress(batch);

  return (
    <div
      className="rounded-lg border p-4 transition-all duration-200 hover:bg-accent/20 hover:-translate-y-0.5 hover:shadow-md hover:shadow-primary/5 cursor-pointer"
      onClick={() => setExpanded(!expanded)}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={cn("text-[10px]", status.color)}>
              {status.label}
            </Badge>
            <span className="font-mono text-sm font-bold">
              {formatAmount(batch.amount)}
            </span>
          </div>
          <div className="space-y-0.5">
            <p className="text-xs text-muted-foreground">
              Origin:{" "}
              <span className="font-mono">{truncateAddress(batch.origin)}</span>
            </p>
            <p className="text-xs text-muted-foreground">
              From:{" "}
              <span className="font-mono">{truncateAddress(batch.originator)}</span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-right">
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              {formatTimeRemaining(batch.expiry_at)}
            </div>
          </div>
          <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform duration-200", expanded && "rotate-180")} />
        </div>
      </div>

      <div className="mt-3">
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              "h-full rounded-full transition-all duration-500",
              progress > 90
                ? "bg-gradient-to-r from-destructive to-destructive/70"
                : progress > 70
                  ? "bg-gradient-to-r from-warning to-warning/70"
                  : "bg-gradient-to-r from-success to-success/70",
            )}
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {expanded && (
        <div className="mt-3 space-y-1.5 border-t border-border/50 pt-3 animate-fade-in-up text-xs text-muted-foreground">
          <div className="flex justify-between">
            <span>Full Origin Hash</span>
            <span className="font-mono text-[10px] max-w-[280px] truncate">{batch.origin}</span>
          </div>
          <div className="flex justify-between">
            <span>Full Originator</span>
            <span className="font-mono text-[10px] max-w-[280px] truncate">{batch.originator}</span>
          </div>
          <div className="flex justify-between">
            <span>Exact Amount</span>
            <span className="font-mono">{batch.amount}</span>
          </div>
          <div className="flex justify-between">
            <span>Created</span>
            <span>{new Date(batch.timestamp * 1000).toLocaleString()}</span>
          </div>
          <div className="flex justify-between">
            <span>Expires</span>
            <span>{new Date(batch.expiry_at * 1000).toLocaleString()}</span>
          </div>
          <div className="flex justify-between">
            <span>Chain Length</span>
            <span className="font-mono">{batch.chain_length}</span>
          </div>
          <div className="flex justify-between">
            <span>Status</span>
            <span className="capitalize">{batch.status}</span>
          </div>
          <div className="flex justify-between">
            <span>Lifecycle Progress</span>
            <span className="font-mono">{progress.toFixed(1)}%</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default function PortfolioPage() {
  const { rpcUrl } = useWallet();

  const { data: portfolio, loading } = useRpc<TrstPortfolio>(
    "get_trst_portfolio",
    { rpcUrl },
    15_000,
  );

  const sortedBatches = portfolio?.batches
    ? [...portfolio.batches].sort((a, b) => a.expiry_at - b.expiry_at)
    : [];

  const activeVal = parseFloat(formatAmount(portfolio?.total_active ?? "0"));
  const expiredVal = parseFloat(formatAmount(portfolio?.total_expired ?? "0"));
  const revokedVal = parseFloat(formatAmount(portfolio?.total_revoked ?? "0"));

  return (
    <div className="space-y-6">
      <div className="animate-fade-in-up">
        <h1 className="text-2xl font-bold tracking-tight">TRST Portfolio</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Detailed view of all your TRST batches and their lifecycle.
        </p>
      </div>

      <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/50 p-4 animate-fade-in-up" style={{ animationDelay: "50ms" }}>
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <p className="text-sm text-muted-foreground">
          Each TRST batch has a unique origin — the burn transaction that created it.
          TRST expires based on the origin's timestamp. Expired TRST becomes permanent
          virtue points — non-transferable proof of your economic contribution.
        </p>
      </div>

      {/* Composition Bar */}
      {!loading && (
        <Card className="animate-fade-in-up" style={{ animationDelay: "100ms" }}>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Portfolio Composition</CardTitle>
          </CardHeader>
          <CardContent>
            <CompositionBar active={activeVal} expired={expiredVal} revoked={revokedVal} />
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="animate-fade-in-up" style={{ animationDelay: "150ms" }}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Active</CardTitle>
            <CircleDollarSign className="h-4 w-4 text-success" />
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <p className="font-mono text-2xl font-bold text-success">
                {formatAmount(portfolio?.total_active ?? "0")}
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="animate-fade-in-up" style={{ animationDelay: "200ms" }}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Virtue Points
            </CardTitle>
            <Award className="h-4 w-4 text-amber-400" />
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <p className="font-mono text-2xl font-bold text-amber-400">
                {formatAmount(portfolio?.total_expired ?? "0")}
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="animate-fade-in-up" style={{ animationDelay: "250ms" }}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Revoked</CardTitle>
            <AlertTriangle className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <p className="font-mono text-2xl font-bold text-destructive">
                {formatAmount(portfolio?.total_revoked ?? "0")}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="animate-fade-in-up" style={{ animationDelay: "300ms" }}>
        <CardHeader>
          <CardTitle className="text-base">Batches</CardTitle>
          <CardDescription>
            {sortedBatches.length} batch{sortedBatches.length !== 1 && "es"} — sorted by expiry (soonest first)
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
            </div>
          ) : !sortedBatches.length ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No TRST batches yet. Receive payments or transfers to see them here.
            </p>
          ) : (
            <div className="space-y-3">
              {sortedBatches.map((batch) => (
                <BatchCard key={batch.origin} batch={batch} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
