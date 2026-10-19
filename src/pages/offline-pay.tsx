import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { useWallet } from "@/hooks/use-wallet";
import { useWalletStore } from "@/stores/wallet-store";
import { parseAmount } from "@/lib/brn";
import { formatAmount } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ActionDetails, type ActionReview } from "@/components/offline-action-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Pending = { hash: string; can_discard: boolean; kind: string; can_review_payment: boolean };
const actionNames: Record<string, string> = {
  GovernanceProposal: "Proposal", GovernanceVote: "Governance vote", GovernanceEndorse: "Proposal endorsement",
  GovernanceWithdraw: "Proposal withdrawal", VerificationVote: "Verification vote", Endorse: "Endorsement",
  Challenge: "Challenge or appeal", Delegate: "Delegation", RevokeDelegation: "Delegation revocation",
  VerifierOptIn: "Verifier participation", VerifierOptOut: "Verifier participation",
  ChangeRepresentative: "Account update", Send: "TRST transfer", Merge: "TRST merge", RejectReceive: "Payment return",
};
type PaymentReview = { kind: "burn" | "receive"; provider: string; amount: string; hash: string; payment: string | null };
type Review = { kind: "sign" | "send"; operation: "burn" | "receive"; provider: string; amount: string; payment?: string | null; hash?: string; context?: string } | { kind: "discard"; hash: string } | {kind:"action"; hash:string; details:ActionReview};

export default function OfflinePayPage() {
  const { address, rpcUrl } = useWallet();
  const [search] = useSearchParams();
  const incoming = search.get("receive");
  const recoverReceive = search.get("recover") === "receive";
  return address ? <OfflinePaymentFlow key={JSON.stringify([address, rpcUrl, incoming, recoverReceive])} address={address} rpcUrl={rpcUrl} incoming={incoming} recoverReceive={recoverReceive} /> : null;
}

function OfflinePaymentFlow({ address, rpcUrl, incoming, recoverReceive }: { address: string; rpcUrl: string; incoming: string | null; recoverReceive:boolean }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [canSign, setCanSign] = useState(false);
  const [context, setContext] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<PaymentReview | null>(null);
  const [provider, setProvider] = useState("");
  const [amount, setAmount] = useState("");
  const [review, setReview] = useState<Review | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [resolvedAction, setResolvedAction] = useState(false);
  const active = useRef(false);
  const inFlight = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const current = () => {
    const wallet = useWalletStore.getState();
    return active.current && !wallet.isLocked && wallet.address === address && wallet.rpcUrl === rpcUrl;
  };
  async function refresh() {
    const [draft, available] = await Promise.all([
      invoke<Pending | null>("get_offline_payment", { expectedAccount: address }),
      invoke<boolean>("offline_signing_available"),
    ]);
    if (current()) { setPending(draft); setCanSign(available); setLoaded(true); }
  }
  useEffect(() => {
    active.current = true;
    refresh().catch(reason => { if (current()) setError(String(reason)); });
    return () => { active.current = false; };
  }, []);
  async function run(label: string, action: () => Promise<void>) {
    if (inFlight.current || !current()) return;
    inFlight.current = true;
    setBusy(label); setError(""); setMessage("");
    try { await action(); }
    catch (reason) {
      if (current()) {
        setError(String(reason));
        try { await refresh(); } catch { if (current()) setLoaded(false); }
      }
    } finally { inFlight.current = false; if (current()) setBusy(""); }
  }
  const disabled = !!busy || !loaded || !canSign;
  const actionRecovery = recoverReceive || resolvedAction || (pending !== null && pending.can_review_payment !== true);
  function reviewSignature(event: React.FormEvent) {
    event.preventDefault();
    if (disabled || !context || pending) return;
    try {
      if (receipt) {
        setReview({ ...receipt, kind: "sign", operation: "receive", context });
        setError("");
        return;
      }
      if (!provider.trim().startsWith("brst_")) throw new Error("Enter a BURST provider address");
      setReview({ kind: "sign", operation: "burn", provider: provider.trim(), amount: parseAmount(amount), context });
      setError("");
    } catch (reason) { setError(String(reason)); }
  }
  async function confirm() {
    const selected = review;
    if (!selected || disabled) return;
    await run(selected.kind === "sign" ? "Saving…" : selected.kind === "discard" ? "Discarding…" : "Submitting…", async () => {
      if (selected.kind === "sign") {
        if (selected.operation === "receive") {
          await invoke<string>("sign_offline_receive", { expectedAccount: address, context: selected.context });
        } else {
          await invoke<string>("sign_offline_payment", { expectedAccount: address, context: selected.context, provider: selected.provider, amount: selected.amount });
        }
        if (current()) { setContext(null); setReceipt(null); setMessage("Signed and saved on this device. Nothing has been submitted."); }
      } else if (selected.kind === "action") {
        await invoke("submit_offline_action", {rpcUrl,expectedAccount:address,expectedHash:selected.hash});
        if (current()) { setMessage("Transaction confirmed."); setResolvedAction(true); }
      } else if (selected.kind === "send") {
        await invoke("submit_offline_payment", { rpcUrl, expectedAccount: address, expectedHash: selected.hash });
        if (current()) setMessage("Payment confirmed.");
      } else {
        await invoke("discard_offline_payment", { expectedAccount: address, expectedHash: selected.hash });
        if (current()) {
          setMessage(actionRecovery ? "Unsent transaction discarded. Its record is retained locally." : "Unsent payment discarded. Its record is retained locally.");
          if (actionRecovery) setResolvedAction(true);
        }
      }
      if (current()) setReview(null);
      await refresh();
    });
  }
  return <div className="mx-auto max-w-xl space-y-4">
    <Button asChild variant="link"><Link to={recoverReceive || incoming ? "/receive" : actionRecovery ? "/" : "/pay"}>{recoverReceive || incoming ? "Back to receiving" : actionRecovery ? "Back to wallet" : "Back to payments"}</Link></Button>
    <Card>
      <CardHeader><CardTitle><h1 ref={heading} tabIndex={-1} className="text-heading">{actionRecovery ? "Recover transaction" : incoming ? "Receive offline" : "Pay offline"}</h1></CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {loaded && !canSign && <p className="text-ui text-muted-foreground">This profile is read-only in this window. Close the other wallet process and reopen this window to sign.</p>}
        {!loaded ? <Button variant="outline" disabled={!!busy} onClick={() => run("Checking…", refresh)}>{busy || "Check saved payments"}</Button>
          : pending ? <>
            <p className="text-ui">{actionRecovery ? `${actionNames[pending.kind] ?? "Transaction"} ${pending.can_discard ? "saved, not submitted" : "awaiting confirmation"}` : pending.can_discard ? "Signed payment, not submitted" : "Payment awaiting reconciliation"}</p>
            <p className="break-all font-mono text-caption text-muted-foreground">{pending.hash}</p>
            <p className="text-caption text-muted-foreground">Other transactions are paused until this is resolved. Checking confirmation does not submit or sign anything.</p>
            <div className="flex flex-wrap gap-2">
              {pending.can_review_payment === true && !recoverReceive && <Button disabled={disabled} onClick={() => run("Loading review…", async () => {
                const { kind: operation, ...result } = await invoke<PaymentReview>("review_offline_payment", { rpcUrl, expectedAccount: address, expectedHash: pending.hash });
                if (current()) setReview({ kind: "send", operation, ...result });
              })}>Review and submit</Button>}
              {!pending.can_review_payment && <Button disabled={disabled} onClick={() => run("Loading review…", async () => {
                const details = await invoke<ActionReview>("review_saved_offline_action", {rpcUrl,expectedAccount:address,expectedHash:pending.hash});
                if (current()) setReview({kind:"action",hash:pending.hash,details});
              })}>Review saved action</Button>}
              <Button variant={actionRecovery ? "default" : "outline"} disabled={disabled} onClick={() => run("Checking confirmation…", async () => {
                const result = await invoke<{ status: string }>("resolve_offline_payment", { rpcUrl, expectedAccount: address, expectedHash: pending.hash });
                if (current()) setMessage(actionRecovery
                  ? result.status === "confirmed" ? "Transaction confirmed." : result.status === "excluded" ? "This transaction was not applied. Return to its original screen to review a new action." : "A different transaction was confirmed in its place. Review your current state before starting again."
                  : result.status === "confirmed" ? "Payment confirmed." : result.status === "excluded" ? "The network advanced before this payment was applied. You can prepare a new payment." : "A different transaction was confirmed. This saved payment was not applied.");
                if (current() && actionRecovery) setResolvedAction(true);
                await refresh();
              })}>Check confirmation</Button>
              {pending.can_discard && <Button variant="ghost" disabled={disabled} onClick={() => setReview({ kind: "discard", hash: pending.hash })}>{actionRecovery ? "Discard unsent transaction" : "Discard unsent payment"}</Button>}
            </div>
          </> : recoverReceive ? <Button asChild variant="outline"><Link to="/receive">Return to receiving</Link></Button> : resolvedAction ? <Button asChild variant="outline"><Link to="/">Return to wallet</Link></Button> : !context ? <>
            <p className="text-ui text-muted-foreground">{incoming ? "Prepare this receipt while connected. Sign it offline, then submit after reconnecting." : "Prepare while connected. Then choose and sign a payment offline, and submit it after reconnecting."}</p>
            <Button disabled={disabled} onClick={() => run("Preparing…", async () => {
              if (incoming) {
                const result = await invoke<{context: string; review: PaymentReview}>("prepare_offline_receive", { rpcUrl, expectedAccount: address, payment: incoming });
                if (current()) { setContext(result.context); setReceipt(result.review); }
              } else {
                const result = await invoke<string>("prepare_offline_payment", { rpcUrl, expectedAccount: address });
                if (current()) setContext(result);
              }
            })}>{incoming ? "Prepare offline receipt" : "Prepare offline payment"}</Button>
          </> : <form className="space-y-4" onSubmit={reviewSignature}>
            <p className="text-caption text-muted-foreground">Ready to sign without a connection. Balance and network rules are checked again when you submit.</p>
            {receipt ? <dl className="space-y-3 text-ui"><div><dt className="text-muted-foreground">Amount</dt><dd className="break-all tabular-nums">{formatAmount(receipt.amount, 18).replace(/\.?0+$/, "")} TRST</dd></div><div><dt className="text-muted-foreground">From</dt><dd className="break-all font-mono text-caption">{receipt.provider}</dd></div></dl> : <>
            <div className="space-y-2"><label htmlFor="offline-provider" className="text-ui">Provider address</label><Input id="offline-provider" autoComplete="off" spellCheck={false} value={provider} disabled={disabled || !!review} onChange={event => setProvider(event.target.value)} /></div>
            <div className="space-y-2"><label htmlFor="offline-amount" className="text-ui">Amount (BRN)</label><Input id="offline-amount" inputMode="decimal" autoComplete="off" value={amount} disabled={disabled || !!review} onChange={event => setAmount(event.target.value)} /></div>
            </>}
            <div className="flex gap-2"><Button type="submit" disabled={disabled}>{receipt ? "Review offline receipt" : "Review offline payment"}</Button><Button type="button" variant="ghost" disabled={disabled} onClick={() => { setContext(null); setReceipt(null); }}>Cancel preparation</Button></div>
          </form>}
        <div className="min-h-6" aria-live="polite">{busy ? <p className="text-caption text-muted-foreground">{busy}</p> : message ? <p role="status" className="text-ui">{message}</p> : null}</div>
        {error && !review && <p role="alert" className="break-words text-ui text-destructive">{error}</p>}
      </CardContent>
    </Card>
    <Dialog open={!!review} onOpenChange={open => { if (!busy && !open) setReview(null); }}>
      <DialogContent onCloseAutoFocus={event => { event.preventDefault(); heading.current?.focus(); }}>
        <DialogHeader><DialogTitle>{review?.kind === "action" ? review.details.title : review?.kind === "discard" ? actionRecovery ? "Discard unsent transaction?" : "Discard unsent payment?" : review?.kind === "sign" ? "Sign and save payment?" : "Submit saved payment?"}</DialogTitle>
          <DialogDescription>{review?.kind === "action" ? "Submit this exact saved action. No new signature is created. Previously accepted actions are checked for confirmation." : review?.kind === "discard" ? "This wallet has not submitted it. The signed record will be retained locally." : review?.kind === "sign" ? "This saves a signed payment on your device. It does not submit it to the network." : review?.operation === "receive" ? "Accept this incoming TRST. Its origin and age stay unchanged." : "Confirmation permanently burns your BRN and creates TRST for the provider."}</DialogDescription></DialogHeader>
        {review?.kind === "action" && <ActionDetails review={review.details} />}
        {review && (review.kind === "sign" || review.kind === "send") && <dl className="space-y-3 text-ui"><div><dt className="text-muted-foreground">Amount</dt><dd className="break-all tabular-nums">{formatAmount(review.amount, 18).replace(/\.?0+$/, "")} {review.operation === "receive" ? "TRST" : "BRN"}</dd></div><div><dt className="text-muted-foreground">{review.operation === "receive" ? "From" : "Provider"}</dt><dd className="break-all font-mono text-caption">{review.provider}</dd></div>{review.payment && <div><dt className="text-muted-foreground">Payment ID</dt><dd className="break-all font-mono text-caption">{review.payment}</dd></div>}</dl>}
        {error && <p role="alert" className="break-words text-ui text-destructive">{error}</p>}
        <DialogFooter><Button variant="outline" disabled={!!busy} onClick={() => setReview(null)}>Cancel</Button><Button disabled={disabled} onClick={confirm}>{busy || (review?.kind === "action" ? "Submit saved action" : review?.kind === "sign" ? "Sign and save" : review?.kind === "discard" ? actionRecovery ? "Discard transaction" : "Discard payment" : "Submit payment")}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}
