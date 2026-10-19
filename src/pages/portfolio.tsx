import { TrstIcon } from "@/components/burst-icons";
import { OriginInspector } from "@/components/origin-inspector";
import { MergeBatches } from "@/components/merge-batches";
import { useEffect, useMemo, useState } from "react";
import { Award, AlertTriangle, ChevronDown } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { HelpLabel } from "@/components/help-label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useWallet, useRpc } from "@/hooks/use-wallet";
import { formatAmount, formatTimeRemaining, truncateAddress, cn } from "@/lib/utils";
import type { TrstPortfolio, TrstBatch } from "@/lib/types";

function batchStatus(batch: TrstBatch) {
  if (batch.status === "revoked") return { label: "Revoked", color: "bg-destructive/15 text-destructive border-destructive/30" };
  if (batch.status === "expired") return { label: "Virtue Points", color: "bg-muted text-muted-foreground border-border" };

  const now = Date.now() / 1000;
  const remaining = batch.expiry_at === null ? Infinity : batch.expiry_at - now;
  const thirtyDays = 30 * 86400;

  if (remaining <= 0) return { label: "Expired", color: "bg-muted text-muted-foreground border-border" };
  if (remaining < thirtyDays) return { label: "Expiring Soon", color: "bg-warning/15 text-warning border-warning/30" };
  return { label: "Active", color: "bg-success/15 text-success border-success/30" };
}

function BatchCard({ batch, rpcUrl }: { batch: TrstBatch; rpcUrl: string }) {
  const [expanded, setExpanded] = useState(false);
  const [inspectOrigins, setInspectOrigins] = useState(false);
  const status = batchStatus(batch);
  const reference = batch.reference_value_bps;
  const validReference = typeof reference === "number" && Number.isInteger(reference) && reference >= 0 && reference <= 10_000;

  return (
    <div
      className="py-4 first:pt-0 last:pb-0"
    >
      <button type="button" aria-expanded={expanded} className="flex min-h-11 w-full flex-wrap items-start justify-between gap-3 text-start" onClick={() => setExpanded(!expanded)}>
        <div className="min-w-0 flex-1 space-y-1">
          <p className="break-all text-ui tabular-nums">{formatAmount(batch.amount)}</p>
          <div className="space-y-0.5">
            <p className="text-caption text-muted-foreground">
              {batch.origin_kind === "merge" ? "Combined by" : batch.origin_kind === "burn" ? "Created from BRN by" : "Origin account"}{" "}
              <span className="break-all font-mono">{truncateAddress(batch.originator)}</span>
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="space-y-1 text-end">
            <Badge variant="outline" className={cn("text-caption", status.color)}>{status.label}</Badge>
            <div className="text-caption text-muted-foreground">
              {batch.expiry_at === null ? "No expiry" : formatTimeRemaining(batch.expiry_at)}
            </div>
          </div>
          <ChevronDown aria-hidden="true" className={cn("size-4 shrink-0 text-muted-foreground transition-transform duration-200", expanded && "rotate-180")} />
        </div>
      </button>

      {expanded && (
        <div className="mt-3 space-y-1.5 border-t border-border/50 pt-3 animate-fade-in text-caption text-muted-foreground">
          <div className="flex flex-wrap justify-between gap-2">
            <span>{batch.origin_kind === "merge" ? "Merge ID" : "Origin ID"}</span>
            <span className="font-mono text-caption w-full break-all">{batch.origin}</span>
          </div>
          <div className="flex flex-wrap justify-between gap-2">
            <span>{batch.origin_kind === "merge" ? "Merged by" : batch.origin_kind === "burn" ? "Created by" : "Origin account"}</span>
            <span className="font-mono text-caption w-full break-all">{batch.originator}</span>
          </div>
          {batch.origin_kind === "merge" && <div>
            <Button variant="ghost" size="sm" aria-expanded={inspectOrigins} onClick={() => setInspectOrigins(!inspectOrigins)}>
              {inspectOrigins ? "Hide original creators" : "View original creators"}
            </Button>
            {inspectOrigins && <OriginInspector key={`${rpcUrl}:${batch.origin}`} rpcUrl={rpcUrl} origin={batch.origin} />}
          </div>}
          <div className="flex flex-wrap justify-between gap-2">
            <span>Exact amount (TRST)</span>
            <span className="break-all tabular-nums">{formatAmount(batch.amount, 18)}</span>
          </div>
          <div className="flex flex-wrap justify-between gap-2">
            <span>Raw units</span>
            <span className="break-all font-mono">{batch.amount}</span>
          </div>
          <div className="flex flex-wrap justify-between gap-2">
            <span>Age starts</span>
            <span>{new Date(batch.timestamp * 1000).toLocaleString()}</span>
          </div>
          <div className="flex flex-wrap justify-between gap-2">
            <span>Expires</span>
            <span>{batch.expiry_at === null ? "No expiry" : new Date(batch.expiry_at * 1000).toLocaleString()}</span>
          </div>
          <div className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 [&>.help-label]:my-0">
            <HelpLabel label="Linear reference" explanation="A pricing guide based on remaining lifetime: 100% when new or without expiry, falling linearly to 0% at expiry. Governance can change the expiry period. It does not reduce your TRST amount or set a market price." />
            <span className="tabular-nums">{validReference ? `${(reference / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}%` : "Unavailable"}</span>
          </div>
          <p>Pricing guide only. Balance unchanged.</p>
          {batch.chain_length != null && <div className="flex flex-wrap justify-between gap-2">
            <span>Chain length</span>
            <span className="font-mono">{batch.chain_length}</span>
          </div>}
        </div>
      )}
    </div>
  );
}

export default function PortfolioPage() {
  const { rpcUrl, address } = useWallet();
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [rpcUrl, address]);

  const { data: portfolio, loading: refreshing, error, refetch } = useRpc<TrstPortfolio>(
    "get_trst_portfolio",
    { rpcUrl },
    15_000,
  );

  const sortedBatches = useMemo(() => portfolio?.batches
    ? [...portfolio.batches].sort((a, b) => (a.expiry_at ?? Infinity) - (b.expiry_at ?? Infinity))
    : [], [portfolio]);
  const pageSize = 25;
  const pageCount = Math.max(1, Math.ceil(sortedBatches.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const visibleBatches = sortedBatches.slice(currentPage * pageSize, (currentPage + 1) * pageSize);

  const loading = refreshing && !portfolio;
  if (error) return <section role="alert" className="balance-panel"><h1 className="text-title">TRST unavailable</h1><p>Balances and origins cannot be confirmed right now.</p><p className="break-words text-caption text-muted-foreground">{error}</p><Button onClick={refetch} disabled={refreshing}>Try again</Button></section>;

  return (
    <div className="space-y-6">
      <div className="animate-fade-in">
        <h1 className="text-title font-normal tracking-tight">Your TRST</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          What you can spend, and what stays as reputation.
        </p>
      </div>

      <HelpLabel label="About expiry" explanation="TRST age starts at its original BRN payment, not its latest transfer. Expired TRST stays visible as reputation. The community can change the expiry period, which can make expired TRST spendable again. Revocation for fraud is separate." />

      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="animate-fade-in">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-normal text-muted-foreground">Active</CardTitle>
            <TrstIcon className="h-4 w-4 text-success" />
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <p className="break-all tabular-nums text-title font-normal text-success">
                {formatAmount(portfolio?.total_active ?? "0")}
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="animate-fade-in">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-normal text-muted-foreground">
              Reputation
            </CardTitle>
            <Award className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <p className="break-all tabular-nums text-title font-normal text-muted-foreground">
                {formatAmount(portfolio?.total_expired ?? "0")}
              </p>
            )}
            <p className="mt-2 text-caption text-muted-foreground">Expired TRST kept as virtue points. Not spendable.</p>
          </CardContent>
        </Card>

        <Card className="animate-fade-in">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-normal text-muted-foreground">Revoked</CardTitle>
            <AlertTriangle className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <p className="break-all tabular-nums text-title font-normal text-destructive">
                {formatAmount(portfolio?.total_revoked ?? "0")}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="space-y-2 text-caption">
        <dl><div className="flex flex-wrap items-baseline gap-x-3 gap-y-1"><dt className="text-muted-foreground">Sent, awaiting receipt</dt><dd className="break-all tabular-nums">{loading ? "Loading…" : portfolio?.total_pending == null ? "Unavailable" : `${formatAmount(portfolio.total_pending)} TRST`}</dd></div></dl>
        {!loading && (portfolio?.total_pending == null
          ? <p className="text-muted-foreground">Your node doesn’t report outgoing pending TRST.</p>
          : BigInt(portfolio.total_pending) > 0n && <p className="max-w-prose text-muted-foreground">Sent TRST stays attributed to you until accepted. It can’t be spent again, and its expiry date stays the same.</p>)}
      </div>

      <Card className="animate-fade-in">
        <CardHeader>
          <CardTitle className="text-heading">Origins and expiry</CardTitle>
          <CardDescription>
            Soonest expiry first. Select an entry for its origin and exact amount.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {portfolio && <div className="mb-4"><MergeBatches key={`${rpcUrl}:${address}`} batches={sortedBatches} onChanged={refetch} /></div>}
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
            </div>
          ) : !sortedBatches.length ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No TRST yet. Payments and transfers you receive will appear here.
            </p>
          ) : (
            <div className="divide-y">
              {visibleBatches.map((batch, index) => (
                <BatchCard key={`${rpcUrl}:${batch.id ?? `${batch.origin}:${currentPage * pageSize + index}`}`} batch={batch} rpcUrl={rpcUrl} />
              ))}
            </div>
          )}
          {pageCount > 1 && <nav aria-label="TRST batch pages" className="mt-4 flex items-center justify-end gap-2">
            <Button variant="outline" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</Button>
            <span className="text-caption tabular-nums">Page {currentPage + 1} of {pageCount}</span>
            <Button variant="outline" disabled={currentPage + 1 === pageCount} onClick={() => setPage(currentPage + 1)}>Next</Button>
          </nav>}
        </CardContent>
      </Card>
    </div>
  );
}
