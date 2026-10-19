import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowUpRight, ArrowDownLeft, ShieldCheck, AlertTriangle, ChevronDown } from "lucide-react";
import { BrnIcon, TrstIcon } from "@/components/burst-icons";
import { HelpLabel } from "@/components/help-label";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useWallet, useRpc, useBrn } from "@/hooks/use-wallet";
import { formatAmount, formatTimeSince } from "@/lib/utils";
import { incomeStatus } from "@/lib/brn";
import { activityPresentation } from "@/lib/activity";
import type { TrstBalance, PendingBlocks, AccountHistory, AccountInfo } from "@/lib/types";

function TrstBreakdown({ balance }: { balance: TrstBalance }) {
  return <><dl className="trst-breakdown text-ui">
    {[["Active", balance.active], ["Expired", balance.expired], ["Revoked", balance.revoked], ["Awaiting receipt", balance.pending]].map(([label, amount]) =>
      <div key={label} className="min-w-0 space-y-1"><dt className="text-muted-foreground">{label}</dt><dd className="break-all tabular-nums" title={amount == null ? undefined : formatAmount(amount, 18) + " TRST"}>{amount == null ? "Unavailable" : formatAmount(amount)}</dd></div>
    )}
  </dl>
    {balance.pending == null ? <p className="text-caption text-muted-foreground">Your node doesn’t report outgoing pending TRST.</p>
      : BigInt(balance.pending) > 0n && <p className="text-caption text-muted-foreground">Sent TRST stays attributed to you until accepted. It can’t be spent again, and its expiry date stays the same.</p>}
  </>;
}

export default function Dashboard() {
  const { address, rpcUrl, setVerificationState, watchOnly } = useWallet();
  const navigate = useNavigate();
  const brn = useBrn(rpcUrl);
  const { data: accountInfo, loading: infoLoading, error: infoError, refetch } = useRpc<AccountInfo>("get_account_info", { rpcUrl }, 10_000);
  const { data: trstBalance, loading: trstLoading, error: trstError } = useRpc<TrstBalance>("get_trst_balance", { rpcUrl }, 10_000);
  const { data: pending, loading: pendingLoading, error: pendingError } = useRpc<PendingBlocks>("get_pending", { rpcUrl, expectedAccount: address }, 10_000);
  const { data: history, loading: historyLoading, error: historyError } = useRpc<AccountHistory>("get_account_history", { rpcUrl, count: 5 }, 15_000);
  const { data: signingDevice } = useRpc<{ active_here: boolean; enrolled: boolean }>(
    "signing_device_status", watchOnly ? null : { rpcUrl, expectedAccount: address }, 15_000,
  );
  useEffect(() => {
    if (accountInfo?.verification_state) setVerificationState(accountInfo.verification_state);
  }, [accountInfo?.verification_state, setVerificationState]);
  const isChallenged = accountInfo?.verification_state.toLowerCase() === "challenged";
  const isVerified = accountInfo?.verification_state.toLowerCase() === "verified" || isChallenged;
  const income = incomeStatus(brn.error ? null : brn.data, Math.floor(Date.now() / 1000));
  const incomeMessage = !accountInfo ? "Checking income…" : !isVerified ? "Verification required" : income.state === "off" ? "Income is off on this network" : income.state === "paused" ? "Income is paused for this wallet" : income.state === "active" ? `${formatAmount(income.daily)} BRN per day at the current rate` : "Income rate unavailable";

  if (infoError) return <section role="alert" className="balance-panel max-w-xl">
    <AlertTriangle className="size-6 text-warning" />
    <div><h1 className="text-title">Wallet data unavailable</h1><p className="mt-3 text-muted-foreground">Check your node connection. Balances and verification status cannot be confirmed right now.</p></div>
    <p className="break-all font-mono text-caption text-muted-foreground">{rpcUrl}</p>
    <p className="break-words text-caption text-muted-foreground">{infoError}</p>
    <div className="flex flex-wrap gap-2"><Button onClick={() => { refetch(); brn.refetch(); }} disabled={infoLoading}>Try again</Button><Button variant="outline" onClick={() => navigate("/settings")}>Node settings</Button></div>
    {!watchOnly && <Button variant="link" className="justify-start px-0" onClick={() => navigate("/pay/offline")}>Review saved transaction</Button>}
  </section>;

  return <div className="wallet-home">
    <div className="page-heading mb-0">
      <div><h1>Your wallet</h1><p className="flex items-center gap-1.5 text-caption">
        {infoLoading && !accountInfo ? "Loading your wallet…" : isVerified ? <><ShieldCheck aria-hidden="true" className="size-4" />{isChallenged ? "Verification under review" : "Verified human"}</> : "Verify that you’re one unique person."}
      </p></div>
      {!watchOnly && <Button variant="outline" onClick={() => navigate("/receive")}><ArrowDownLeft />Receive</Button>}
    </div>

    {!watchOnly && signingDevice && !signingDevice.active_here && <section aria-label="Signing device" className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
      <div className="min-w-0 flex-1 basis-64 space-y-1"><p>{signingDevice.enrolled ? "Another device signs for this wallet" : "Set up signing on this device"}</p><p className="text-caption text-muted-foreground">You can view your wallet now. Review device setup before making transactions.</p></div>
      <Button variant="outline" onClick={() => navigate("/settings#security")}>Review device setup</Button>
    </section>}

    {accountInfo && !isVerified && <section className="flex flex-wrap items-center justify-between gap-4 rounded-lg bg-warning/10 p-4">
      <div className="min-w-0"><p className="flex items-center gap-2"><AlertTriangle className="size-4 text-warning" />Wallet not verified</p><p className="mt-1 text-caption text-muted-foreground">Verification is needed to pay, receive income, and vote.</p></div>
      {!watchOnly && <Button variant="outline" onClick={() => navigate("/verification")}>Start verification</Button>}
    </section>}

    <section aria-label="Wallet balances" className="wallet-balances">
      <div className="balance-panel">
        <div className="balance-label"><BrnIcon className="size-5" /><HelpLabel label="BRN" explanation="Your birthright income, given equally to verified people at the community’s chosen rate. It never expires. Spend BRN to pay someone the same amount in newly created TRST." /><span className="text-caption text-muted-foreground">Birthright</span></div>
        <div>
          {infoLoading && !accountInfo ? <Skeleton className="h-10 w-48" /> : <p className="balance-value break-all text-balance">{brn.balance !== null ? formatAmount(brn.balance) : "—"}</p>}
          <p className="balance-metadata mt-2">Available to pay</p>
          <p className="mt-2 text-caption text-muted-foreground">{incomeMessage}</p>
          {brn.error && <p role="status" className="mt-2 text-caption text-warning">Accrual data unavailable. Retrying…</p>}
        </div>
        {!watchOnly && <div className="balance-actions"><Button onClick={() => navigate("/pay")}>Pay <ArrowUpRight /></Button></div>}
        <details className="balance-details">
          <summary className="text-caption text-muted-foreground">Income details<ChevronDown aria-hidden="true" className="size-4" /></summary>
          <dl className="space-y-3 pb-2 text-caption">
            <div className="space-y-1"><dt className="text-muted-foreground">Exact available BRN</dt><dd className="break-all tabular-nums">{brn.balance !== null ? formatAmount(brn.balance, 18) : "—"}</dd></div>
            <div className="flex flex-wrap justify-between gap-2"><dt className="text-muted-foreground">Spent permanently</dt><dd className="break-all tabular-nums">{accountInfo ? formatAmount(accountInfo.total_brn_burned) : "—"}</dd></div>
            <div className="flex flex-wrap justify-between gap-2"><dt className="text-muted-foreground">Locked in stakes</dt><dd className="break-all tabular-nums">{accountInfo ? formatAmount(accountInfo.total_brn_staked) : "—"}</dd></div>
          </dl>
          <p className="text-caption text-muted-foreground">BRN never expires. Changes to the income rate affect future income, not what you already have.</p>
        </details>
      </div>
      <div className="balance-panel">
        <div className="balance-label"><TrstIcon className="size-5" /><HelpLabel label="Active TRST" explanation="Money you receive from payments and transfers. You can spend it or pass it on until it expires. TRST from a fraudulent origin can be revoked, even after changing hands." /></div>
        <div>
          {trstLoading && !trstBalance ? <Skeleton className="h-10 w-40" /> : <p className="balance-value break-all text-balance">{trstError || !trstBalance ? "—" : formatAmount(trstBalance.active)}</p>}
          <p className="balance-metadata mt-2">Available to transfer</p>
          <p className="mt-2 text-caption text-muted-foreground">Received from payments and transfers</p>
          {!isVerified && <p className="mt-2 text-caption text-warning">Verification required to send.</p>}
        </div>
        {!watchOnly && <div className="balance-actions"><Button variant="outline" onClick={() => navigate("/transfer")}>Transfer <ArrowUpRight /></Button></div>}
        <details className="balance-details">
          <summary className="text-caption text-muted-foreground">TRST breakdown<ChevronDown aria-hidden="true" className="size-4" /></summary>
          {trstLoading && !trstBalance ? <Skeleton className="h-20 w-full" /> : trstError ? <p role="status" className="text-caption">TRST breakdown unavailable. Retrying…</p> : trstBalance ? <TrstBreakdown balance={trstBalance} /> : <p className="text-caption">Waiting for your node…</p>}
          <Button variant="link" className="px-0" onClick={() => navigate("/portfolio")}>View origins and expiry <ArrowUpRight /></Button>
        </details>
      </div>
    </section>

    {trstBalance && !trstError && (BigInt(trstBalance.expired) > 0n || BigInt(trstBalance.revoked) > 0n) && <section aria-label="Non-transferable TRST" className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
      <div className="space-y-1 text-caption">
        {BigInt(trstBalance.expired) > 0n && <p><span className="tabular-nums">{formatAmount(trstBalance.expired)} TRST</span> kept as reputation <span className="text-muted-foreground">· Expired, not spendable</span></p>}
        {BigInt(trstBalance.revoked) > 0n && <p className="text-destructive"><span className="tabular-nums">{formatAmount(trstBalance.revoked)} TRST</span> revoked · Not spendable</p>}
      </div>
      <Button variant="ghost" onClick={() => navigate("/portfolio")}>View details <ArrowUpRight /></Button>
    </section>}

    <section className="activity-section">
      <div className="section-heading"><h2>Account activity</h2><Button variant="ghost" onClick={() => navigate("/history")}>View all <ArrowUpRight /></Button></div>
      <div className="text-caption text-muted-foreground">
        {pendingLoading && !pending ? <Skeleton className="h-5 w-40" /> : pendingError ? <p role="status">Pending payments unavailable. Retrying…</p> : (pending?.blocks.length ?? 0) > 0 ?
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-secondary px-4 py-2"><span>{pending!.blocks.length}{pending!.cursor ? "+" : ""} {pending!.blocks.length === 1 && !pending!.cursor ? "payment" : "payments"} to accept</span>{!watchOnly && <Button variant="outline" onClick={() => navigate("/receive")}>Review payments</Button>}</div> : null}
      </div>
      {historyLoading && !history ? <div className="space-y-3 pt-4">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
        : historyError ? <p role="status" className="py-8 text-muted-foreground">Transaction history unavailable. Retrying…</p>
        : !history?.history.length ? <div className="empty-state"><div><p>No transactions yet</p><p>Your payments and transfers will appear here.</p></div>{!watchOnly && <Button variant="ghost" onClick={() => navigate("/receive")}>Share your address <ArrowUpRight /></Button>}</div>
        : <div>{history.history.map(tx => {
          const { Icon, label } = activityPresentation(tx.block_type);
          return <div key={tx.hash} className="activity-row">
            <div className="activity-symbol"><Icon aria-hidden="true" className="size-[18px]" /></div>
            <div className="min-w-0 flex-1"><p>{label}</p><p className="mt-1 text-caption text-muted-foreground">{tx.timestamp ? formatTimeSince(Number(tx.timestamp)) : "Date unavailable"}</p></div>
          </div>;
        })}</div>}
    </section>
  </div>;
}
