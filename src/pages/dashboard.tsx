import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Coins,
  CircleDollarSign,
  ShieldCheck,
  Inbox,
  ArrowUpRight,
  ArrowDownLeft,
  Flame,
  AlertTriangle,
  TrendingUp,
  Clock,
  Zap,
  Send,
  Download,
  Wifi,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useWallet, useRpc } from "@/hooks/use-wallet";
import { formatAmount, formatTimeSince, cn } from "@/lib/utils";
import type {
  TrstBalance,
  PendingBlocks,
  AccountHistory,
  AccountInfo,
} from "@/lib/types";

const BRN_RATE = 0.0001;

function TrstDonut({
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
      <div className="flex items-center justify-center">
        <div
          className="relative h-32 w-32 rounded-full"
          style={{
            background: "conic-gradient(oklch(0.3 0.01 285) 0deg, oklch(0.3 0.01 285) 360deg)",
          }}
        >
          <div className="absolute inset-3 rounded-full bg-card/90 backdrop-blur-sm flex items-center justify-center">
            <span className="text-xs text-muted-foreground">No TRST</span>
          </div>
        </div>
      </div>
    );
  }

  const activePct = (active / total) * 100;
  const expiredPct = (expired / total) * 100;
  const revokedPct = (revoked / total) * 100;

  const activeDeg = (activePct / 100) * 360;
  const expiredDeg = (expiredPct / 100) * 360;

  return (
    <div className="flex items-center gap-4">
      <div
        className="relative h-32 w-32 shrink-0 rounded-full"
        style={{
          background: `conic-gradient(
            oklch(0.68 0.19 145) 0deg,
            oklch(0.68 0.19 145) ${activeDeg}deg,
            oklch(0.78 0.16 65) ${activeDeg}deg,
            oklch(0.78 0.16 65) ${activeDeg + expiredDeg}deg,
            oklch(0.58 0.22 25) ${activeDeg + expiredDeg}deg,
            oklch(0.58 0.22 25) 360deg
          )`,
        }}
      >
        <div className="absolute inset-3 rounded-full bg-card/90 backdrop-blur-sm flex items-center justify-center flex-col">
          <span className="font-mono text-sm font-bold">{formatAmount(String(total))}</span>
          <span className="text-[10px] text-muted-foreground">Total</span>
        </div>
      </div>
      <div className="space-y-2 text-xs">
        <div className="flex items-center gap-2">
          <div className="h-2.5 w-2.5 rounded-full bg-success" />
          <span className="text-muted-foreground">Active</span>
          <span className="font-mono font-medium">{activePct.toFixed(1)}%</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-2.5 w-2.5 rounded-full bg-warning" />
          <span className="text-muted-foreground">Expired</span>
          <span className="font-mono font-medium">{expiredPct.toFixed(1)}%</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-2.5 w-2.5 rounded-full bg-destructive" />
          <span className="text-muted-foreground">Revoked</span>
          <span className="font-mono font-medium">{revokedPct.toFixed(1)}%</span>
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { rpcUrl, setVerificationState } = useWallet();
  const navigate = useNavigate();
  const [liveBrn, setLiveBrn] = useState<string | null>(null);

  const { data: accountInfo, loading: infoLoading } = useRpc<AccountInfo>(
    "get_account_info",
    { rpcUrl },
    10_000,
  );

  const { data: trstBalance, loading: trstLoading } = useRpc<TrstBalance>(
    "get_trst_balance",
    { rpcUrl },
    10_000,
  );

  const { data: pending, loading: pendingLoading } = useRpc<PendingBlocks>(
    "get_pending",
    { rpcUrl },
    10_000,
  );

  const { data: history, loading: historyLoading } = useRpc<AccountHistory>(
    "get_account_history",
    { rpcUrl, count: 5 },
    15_000,
  );

  useEffect(() => {
    if (accountInfo?.verification_state) {
      setVerificationState(accountInfo.verification_state);
    }
  }, [accountInfo?.verification_state, setVerificationState]);

  useEffect(() => {
    if (accountInfo?.verification_state !== "Verified" || !accountInfo.verified_at) {
      setLiveBrn(null);
      return;
    }

    const verifiedAt = accountInfo.verified_at;
    const totalBurned = parseFloat(formatAmount(accountInfo.total_brn_burned));

    function tick() {
      const elapsed = Math.max(0, Date.now() / 1000 - verifiedAt);
      const available = Math.max(0, BRN_RATE * elapsed - totalBurned);
      setLiveBrn(available.toFixed(6));
    }

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [accountInfo?.verified_at, accountInfo?.total_brn_burned, accountInfo?.verification_state]);

  const isVerified = accountInfo?.verification_state === "Verified";

  const typeIcon = (type: string) => {
    switch (type) {
      case "send": return <ArrowUpRight className="h-4 w-4" />;
      case "burn": return <Flame className="h-4 w-4" />;
      case "endorse": return <ShieldCheck className="h-4 w-4" />;
      default: return <ArrowDownLeft className="h-4 w-4" />;
    }
  };

  const typeColor = (type: string) => {
    switch (type) {
      case "send": return "text-destructive bg-destructive/10";
      case "burn": return "text-warning bg-warning/10";
      case "endorse": return "text-purple-400 bg-purple-400/10";
      default: return "text-success bg-success/10";
    }
  };

  return (
    <div className="space-y-6">
      {!infoLoading && !isVerified && (
        <Card className="border-warning/40 bg-warning/5 animate-fade-in-up">
          <CardContent className="flex items-start gap-4 p-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-warning/15">
              <AlertTriangle className="h-5 w-5 text-warning" />
            </div>
            <div className="flex-1">
              <p className="font-semibold text-warning">Wallet Not Verified</p>
              <p className="mt-1 text-sm text-muted-foreground">
                You earn <span className="font-bold text-warning">0 BRN</span> until your identity is verified.
                Get endorsements from verified wallets to begin the verification process.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3 border-warning/30 text-warning hover:bg-warning/10"
                onClick={() => navigate("/verification")}
              >
                <ShieldCheck className="h-3.5 w-3.5" />
                Start Verification
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {!infoLoading && isVerified && accountInfo?.verified_at && (
        <Card className="border-success/30 bg-success/5 animate-fade-in-up">
          <CardContent className="flex items-center gap-3 p-4">
            <ShieldCheck className="h-5 w-5 text-success" />
            <div>
              <p className="text-sm font-medium text-success">Verified Human</p>
              <p className="text-xs text-muted-foreground">
                BRN accruing since {new Date(accountInfo.verified_at * 1000).toLocaleDateString()} ({formatTimeSince(accountInfo.verified_at)})
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Hero BRN Counter */}
      <Card className="relative overflow-hidden border-primary/20 animate-fade-in-up">
        <div className="absolute -top-20 -right-20 h-60 w-60 rounded-full bg-primary/5 blur-3xl" />
        <div className="absolute -bottom-16 -left-16 h-48 w-48 rounded-full bg-primary/8 blur-3xl" />
        <CardContent className="relative p-6">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Coins className="h-4 w-4 text-primary" />
                <span>BRN Balance</span>
              </div>
              {infoLoading ? (
                <Skeleton className="mt-2 h-14 w-48" />
              ) : (
                <>
                  <p className="mt-2 font-mono text-5xl font-bold tracking-tight gradient-text">
                    {liveBrn ?? formatAmount(accountInfo?.brn_balance ?? "0")}
                  </p>
                  {isVerified && (
                    <div className="mt-3 flex items-center gap-1 text-xs text-muted-foreground">
                      <TrendingUp className="h-3 w-3 text-success" />
                      <span className="font-mono text-success">+{BRN_RATE}/s</span>
                      <span>accrual rate</span>
                    </div>
                  )}
                  <div className="mt-1 flex gap-4 text-xs text-muted-foreground">
                    <span>
                      Burned:{" "}
                      <span className="font-mono">
                        {formatAmount(accountInfo?.total_brn_burned ?? "0")}
                      </span>
                    </span>
                    <span>
                      Staked:{" "}
                      <span className="font-mono">
                        {formatAmount(accountInfo?.total_brn_staked ?? "0")}
                      </span>
                    </span>
                  </div>
                  {!isVerified && (
                    <p className="mt-2 text-xs text-warning">
                      rate x (now - verified_at) - total_burned = 0 (unverified)
                    </p>
                  )}
                </>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                className="gap-1.5"
                onClick={() => navigate("/pay")}
              >
                <Zap className="h-3.5 w-3.5" />
                Pay
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => navigate("/transfer")}
              >
                <Send className="h-3.5 w-3.5" />
                Transfer
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => navigate("/receive")}
              >
                <Download className="h-3.5 w-3.5" />
                Receive
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* TRST Donut Chart */}
        <Card className="animate-fade-in-up" style={{ animationDelay: "100ms" }}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              TRST Composition
            </CardTitle>
            <CircleDollarSign className="h-4 w-4 text-success" />
          </CardHeader>
          <CardContent>
            {trstLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : (
              <TrstDonut
                active={parseFloat(formatAmount(trstBalance?.active ?? "0"))}
                expired={parseFloat(formatAmount(trstBalance?.expired ?? "0"))}
                revoked={parseFloat(formatAmount(trstBalance?.revoked ?? "0"))}
              />
            )}
          </CardContent>
        </Card>

        {/* Network Status */}
        <Card className="animate-fade-in-up" style={{ animationDelay: "200ms" }}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Network Status
            </CardTitle>
            <Wifi className="h-4 w-4 text-success" />
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-success animate-pulse-glow" />
              <span className="text-sm text-muted-foreground">Connected to node</span>
            </div>
            <div className="space-y-2 text-xs text-muted-foreground">
              <div className="flex justify-between">
                <span>BRN Rate</span>
                <span className="font-mono font-medium text-primary">{BRN_RATE}/s</span>
              </div>
              <div className="flex justify-between">
                <span>Active TRST</span>
                <span className="font-mono font-medium text-success">{formatAmount(trstBalance?.active ?? "0")}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Pending */}
        <Card className="animate-fade-in-up" style={{ animationDelay: "300ms" }}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Pending
            </CardTitle>
            <Inbox className="h-4 w-4 text-warning" />
          </CardHeader>
          <CardContent>
            {pendingLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <>
                <p className="font-mono text-2xl font-bold text-warning">
                  {pending?.blocks.length ?? 0}
                </p>
                {(pending?.blocks.length ?? 0) > 0 && (
                  <Button
                    variant="link"
                    className="mt-1 h-auto p-0 text-xs"
                    onClick={() => navigate("/receive")}
                  >
                    Receive pending blocks
                  </Button>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="animate-fade-in-up" style={{ animationDelay: "400ms" }}>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Recent Transactions</CardTitle>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate("/history")}
            >
              View all
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {historyLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : !history?.history.length ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No transactions yet
            </p>
          ) : (
            <div className="space-y-2">
              {history.history.map((tx) => (
                <div
                  key={tx.hash}
                  className="flex items-center gap-3 rounded-md border p-3 transition-all duration-200 hover:bg-accent/30 hover:-translate-y-0.5 hover:shadow-md hover:shadow-primary/5"
                >
                  <div
                    className={cn(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
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
                    <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
                      {tx.account}
                    </p>
                  </div>
                  <p
                    className={cn(
                      "font-mono text-sm font-semibold",
                      tx.block_type === "send" || tx.block_type === "burn" || tx.block_type === "endorse"
                        ? "text-destructive"
                        : "text-success",
                    )}
                  >
                    {tx.block_type === "send" || tx.block_type === "burn" || tx.block_type === "endorse" ? "-" : "+"}
                    {formatAmount(tx.amount)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
