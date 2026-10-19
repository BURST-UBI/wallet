import { useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { QRCodeSVG } from "qrcode.react";
import { Link } from "react-router-dom";
import { Copy, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useWallet, useRpc } from "@/hooks/use-wallet";
import { useWalletStore } from "@/stores/wallet-store";
import { useTransaction } from "@/hooks/use-transaction";
import { TransactionReceipt } from "@/components/transaction-receipt";
import { OfflineActionButton } from "@/components/offline-action-button";
import { PaymentOriginDisclosure } from "@/components/origin-inspector";
import { formatAmount, truncateAddress } from "@/lib/utils";
import type { PendingBlocks, PendingBlock, BlockResult } from "@/lib/types";

export default function ReceivePage() {
  const { address, rpcUrl, autoAccept, groupHolds, groupPolicy } = useWallet();
  const [copyError, setCopyError] = useState("");
  const [copied, setCopied] = useState(false);
  const [review, setReview] = useState<PendingBlock[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [progress, setProgress] = useState("");
  const [received, setReceived] = useState<string[]>([]);
  const [returnReview, setReturnReview] = useState(false);
  const returning = useTransaction(rpcUrl, address, "reject_pending");
  const returningBusy = returning.outcome.status === "sending";
  const returnBlocked = ["sending", "confirmed", "uncertain"].includes(returning.outcome.status);
  const pendingAction = useRef(false);
  const context = useRef({address, rpcUrl});
  const heading = useRef<HTMLHeadingElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const returnButton = useRef<HTMLButtonElement>(null);
  const backButton = useRef<HTMLButtonElement>(null);
  const pageContext = JSON.stringify([address, rpcUrl]);
  const [pagination, setPagination] = useState<{context:string;cursors:(string|null)[]}>({context:pageContext,cursors:[null]});
  const cursors = pagination.context === pageContext ? pagination.cursors : [null];
  const pageIndex = cursors.length - 1;
  const cursor = cursors[pageIndex];
  const pending = useRpc<PendingBlocks>("get_pending", { rpcUrl, cursor, expectedAccount:address }, 10_000);
  const saved = useRpc<{hash:string}>("get_offline_payment", address ? {expectedAccount:address} : null, 10_000);
  const reviewContextMatches = address === context.current.address && rpcUrl === context.current.rpcUrl;
  const onlyReturns = !!review?.length && review.every(block => block.return_credit);

  function refreshPending() {
    void saved.refetch();
    setPagination({context:pageContext,cursors:[null]});
    if (!pageIndex) void pending.refetch();
  }

  async function copyAddress() {
    if (!address) return;
    setCopyError("");
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { setCopyError("Couldn’t copy. Select and copy your address below."); }
  }

  function openReview(blocks: PendingBlock[]) {
    context.current = {address, rpcUrl};
    trigger.current = document.activeElement as HTMLElement;
    setActionError(""); setProgress(""); setReceived([]); setReturnReview(false); returning.clear(); setReview(blocks);
  }

  async function returnPayment() {
    if (!returnReview || review?.length !== 1 || review[0].return_credit || autoAccept) return;
    if (await returning.submit({hash: review[0].hash, expectedAccount: context.current.address}, context.current)) {
      setReview(null);
      refreshPending();
    }
  }

  async function receive() {
    if (!review || pendingAction.current) return;
    const current = useWalletStore.getState();
    if (current.isLocked || current.address !== context.current.address || current.rpcUrl !== context.current.rpcUrl) {
      setActionError("Your wallet or connection changed. Close this review and start again."); return;
    }
    pendingAction.current = true; setBusy(true);
    const confirmed: string[] = [];
    try {
      for (const [index, block] of review.entries()) {
        const wallet = useWalletStore.getState();
        if (wallet.isLocked || wallet.address !== context.current.address || wallet.rpcUrl !== context.current.rpcUrl) throw new Error("Wallet changed. Remaining payments were not submitted.");
        setProgress((block.return_credit ? "Claiming " : "Receiving ") + (index + 1) + " of " + review.length + "…");
        const result = await invoke<BlockResult>("receive_pending", { rpcUrl: context.current.rpcUrl, expectedAccount: context.current.address, hash: block.hash });
        if (!result.accepted) throw new Error(result.detail ?? "This payment could not be received.");
        confirmed.push(block.hash);
        setReceived([...confirmed]);
      }
      setProgress(onlyReturns ? "Returned funds claimed." : "Received " + confirmed.length + (confirmed.length === 1 ? " payment." : " payments."));
    } catch (error) {
      setProgress(confirmed.length ? "Received " + confirmed.length + " of " + review.length + "." : "");
      setActionError(String(error));
    } finally {
      pendingAction.current = false; setBusy(false); refreshPending();
    }
  }

  return <div className="mx-auto max-w-xl space-y-6">
    <TransactionReceipt status={returning.outcome.status} hash={returning.outcome.hash} onDone={() => {returning.clear(); refreshPending();}}
      description="The payment was returned. The sender can now receive the TRST."
      uncertainDescription="The payment may already have been returned. Check activity and refresh pending payments before trying again." />
    <section className="balance-panel">
      <div><h1 className="text-heading">Your address</h1><p className="mt-1 text-ui text-muted-foreground">Share it to receive TRST.</p></div>
      {address && <div className="mx-auto w-fit rounded-lg bg-white p-4"><QRCodeSVG value={address} size={180} title="Wallet address QR code" /></div>}
      <p className="break-all select-text font-mono text-caption">{address ?? "No address"}</p>
      <Button variant="outline" onClick={copyAddress} disabled={!address}>{copied ? <Check /> : <Copy />}{copied ? "Address copied" : "Copy address"}</Button>
      {copyError && <p role="alert" className="text-ui text-destructive">{copyError}</p>}
    </section>

    <section className="space-y-4">
      <div className="section-heading"><h2 ref={heading} tabIndex={-1}>Pending payments</h2><Button variant="ghost" onClick={refreshPending} disabled={busy || pending.loading}>Refresh</Button></div>
      <p className="text-caption text-muted-foreground">{autoAccept ? "Eligible payments are accepted automatically while unlocked." : "Automatic acceptance is off. Review payments before receiving them."}</p>
      {saved.data && !busy && <div className="space-y-2">
        <p role="status" className="text-ui">A saved transaction needs checking before you receive another payment.</p>
        <Button asChild variant="outline"><Link to="/pay/offline?recover=receive">Check saved transaction</Link></Button>
      </div>}
      {autoAccept && pending.data?.blocks.some(block => !block.return_credit) && <p className="text-caption text-muted-foreground">To return a payment, turn off automatic acceptance in <Link className="text-foreground underline underline-offset-4" to="/settings">Settings</Link>.</p>}
      {pending.error ? <p role="alert" className="rounded-lg border p-4 text-ui">Pending payments unavailable. Check your connection and refresh.</p>
        : !pending.data ? <Skeleton className="h-28 w-full" />
        : !pending.data.blocks.length ? <div className="empty-state"><p>{pageIndex ? "No payments on this page. Refresh to return to the first page." : "No pending payments"}</p></div>
        : <div className="divide-y rounded-lg border px-4">{pending.data.blocks.map(block => <div key={block.hash} className="flex items-center justify-between gap-3 py-4">
          <div className="min-w-0"><p className="break-all text-ui tabular-nums">{formatAmount(block.amount)} TRST</p><p className={`mt-1 truncate text-caption text-muted-foreground${block.return_credit ? "" : " font-mono"}`}>{block.return_credit ? "Returned funds" : truncateAddress(block.source)}</p></div>
          <Button variant="outline" onClick={() => openReview([block])} disabled={busy || returnBlocked || !!saved.data}>Review</Button>
        </div>)}</div>}
      {!pending.error && (pending.data?.blocks.length ?? 0) > 1 && <Button variant="outline" onClick={() => openReview(pending.data!.blocks)} disabled={busy || returnBlocked || pending.loading || !!saved.data}>{pageIndex || pending.data?.cursor ? "Review this page" : "Review all payments"}</Button>}
      {(pageIndex > 0 || pending.data?.cursor) && <nav aria-label="Pending payment pages" className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" disabled={!pageIndex || busy || returningBusy || pending.loading} onClick={()=>setPagination({context:pageContext,cursors:cursors.slice(0,-1)})}>Previous</Button>
        <span className="text-caption tabular-nums">Page {pageIndex+1}</span>
        <Button variant="ghost" disabled={!pending.data?.cursor || !!pending.error || busy || returningBusy || pending.loading} onClick={()=>{if(pending.data?.cursor) setPagination({context:pageContext,cursors:[...cursors,pending.data.cursor]});}}>Next</Button>
      </nav>}
    </section>

    <Dialog open={!!review} onOpenChange={open => {if (!open && !pendingAction.current && !returningBusy) setReview(null);}}>
      <DialogContent onCloseAutoFocus={event => {event.preventDefault(); const receipt = document.querySelector<HTMLElement>("[data-transaction-receipt]"); if (receipt) receipt.focus(); else if (trigger.current?.isConnected) trigger.current.focus(); else heading.current?.focus();}}>
        <DialogHeader><DialogTitle>{returnReview ? "Return this payment?" : onlyReturns ? "Claim returned funds" : review?.length === 1 ? "Receive payment" : "Receive payments"}</DialogTitle><DialogDescription>{returnReview ? "The TRST goes back to the sender to claim. Its origin and age stay unchanged. This does not undo a BRN burn." : onlyReturns ? "Confirm the return. Expiry and revocation still apply." : "TRST keeps its origin and age when received. Each payment is accepted separately."}</DialogDescription></DialogHeader>
        <div className="max-h-[40dvh] space-y-4 overflow-y-auto overscroll-contain">{review?.map(block => <div key={block.hash} className="space-y-2 rounded-lg bg-muted p-4">
          <p className="flex flex-wrap items-baseline gap-x-1 text-ui tabular-nums"><span className="break-all">{formatAmount(block.amount, 18)}</span>{" "}<span className="whitespace-nowrap text-caption text-muted-foreground">TRST</span></p>
          {block.return_credit && <p className="text-caption text-muted-foreground">Returned after expiry</p>}
          <dl className="space-y-2 text-caption">{!block.return_credit && <div><dt className="text-muted-foreground">From</dt><dd className="break-all select-text font-mono">{block.source}</dd></div>}<div><dt className="text-muted-foreground">Payment ID</dt><dd className="break-all select-text font-mono">{block.hash}</dd></div></dl>
          {!block.return_credit && groupHolds[block.hash] && <p className="text-caption text-warning">Last automatic check: {groupHolds[block.hash]}</p>}
          {!block.return_credit && groupPolicy?.mode !== "protocol" && <p className="text-caption text-muted-foreground">Receiving here is a manual choice. It does not require your automatic group rules to pass.</p>}
          {reviewContextMatches && <PaymentOriginDisclosure key={`${address}:${rpcUrl}:${block.hash}`} rpcUrl={rpcUrl} payment={block.hash} />}
          {received.includes(block.hash) && <p className="text-ui">{block.return_credit ? "Claimed" : "Received"}</p>}
        </div>)}</div>
        {progress && <p role="status" className="text-ui">{progress}</p>}
        {!reviewContextMatches && !actionError && !(returnReview && returning.outcome.status === "error") && <p role="alert" className="text-ui text-destructive">Your wallet or connection changed. Close this review and start again.</p>}
        {actionError && <p role="alert" className="break-words text-ui text-destructive">{actionError}</p>}
        {actionError && reviewContextMatches && !busy && <Button asChild variant="outline"><Link to="/pay/offline?recover=receive">Check saved transaction</Link></Button>}
        {returnReview && returning.outcome.status === "error" && <p role="alert" className="break-words text-ui text-destructive">{returning.outcome.message}</p>}
        {returnReview && autoAccept && <p role="alert" className="text-ui text-destructive">Automatic acceptance is on. Close this review and turn it off in Settings before returning a payment.</p>}
        {returnReview && review?.length === 1 && !review[0].return_credit && <OfflineActionButton request={{kind:"reject",payment:review[0].hash}} address={context.current.address} rpcUrl={context.current.rpcUrl} disabled={returnBlocked || autoAccept || !reviewContextMatches} />}
        {!returnReview && review?.length === 1 && !review[0].return_credit && !received.length && !actionError && !autoAccept && <div className="border-t pt-3"><Button ref={returnButton} variant="ghost" disabled={busy} onClick={() => {setReturnReview(true); requestAnimationFrame(() => backButton.current?.focus());}}>Return payment…</Button></div>}
        {!returnReview && reviewContextMatches && review?.length === 1 && !review[0].return_credit && !received.length && !actionError && !autoAccept && !busy && <Button asChild variant="link"><Link to={`/pay/offline?receive=${encodeURIComponent(review[0].hash)}`}>Sign offline…</Link></Button>}
        <DialogFooter>{returnReview ? <><Button ref={backButton} variant="outline" disabled={returningBusy} onClick={() => {setReturnReview(false); requestAnimationFrame(() => returnButton.current?.focus());}}>Back</Button><Button variant="destructive" disabled={returnBlocked || autoAccept} onClick={returnPayment}>{returningBusy ? "Returning…" : "Return payment"}</Button></> : <><Button variant="outline" disabled={busy} onClick={() => setReview(null)}>{received.length || actionError ? "Done" : "Cancel"}</Button>{!received.length && !actionError && <Button disabled={busy} onClick={receive}>{busy && <Loader2 className="animate-spin" />}{busy ? (onlyReturns ? "Claiming…" : "Receiving…") : onlyReturns ? (review?.length === 1 ? "Claim" : "Claim all") : review?.length === 1 ? "Receive" : "Receive all"}</Button>}</>}</DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}
