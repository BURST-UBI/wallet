import { useRef, useState } from "react";
import { ArrowUpRight, Loader2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useWallet, useRpc } from "@/hooks/use-wallet";
import { formatAmount } from "@/lib/utils";
import { parseAmount } from "@/lib/brn";
import type { TrstPortfolio } from "@/lib/types";

import { useTransaction } from "@/hooks/use-transaction";
import { TransactionReceipt } from "@/components/transaction-receipt";
import { OfflineActionButton } from "@/components/offline-action-button";

export default function TransferPage() {
  const { rpcUrl, address } = useWallet();
  const reviewContext = useRef({ rpcUrl, address });
  const [formError, setFormError] = useState("");
  const transaction = useTransaction(rpcUrl, address, "transfer_trst");
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const reviewButtonRef = useRef<HTMLButtonElement>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [offlineRequest, setOfflineRequest] = useState<object | null>(null);
  const sending = transaction.outcome.status === "sending";
  const blocked = sending || ["confirmed", "uncertain"].includes(transaction.outcome.status);

  const { data: portfolio, loading, error: balanceError } = useRpc<TrstPortfolio>(
    "get_trst_portfolio",
    { rpcUrl },
    10_000,
  );

  const sources = new Map<string, bigint>();
  for (const batch of portfolio?.batches ?? []) {
    if (batch.status === "active") sources.set(batch.origin, (sources.get(batch.origin) ?? 0n) + BigInt(batch.amount));
  }
  const largestSource = [...sources.values()].reduce((largest, value) => value > largest ? value : largest, 0n);
  function sourceFor(raw: string) {
    return [...sources.entries()].sort(([a], [b]) => a.localeCompare(b)).find(([, balance]) => balance >= BigInt(raw))?.[0];
  }
  function validate(): string | null {
    if (!recipient.startsWith("brst_")) return "Address must start with brst_";
    try {
      const raw = parseAmount(amount);
      if (balanceError || !portfolio) return "Connect to your node before transferring";
      if (!sourceFor(raw)) return "A single origin must cover this transfer. Enter " + formatAmount(largestSource.toString(), 18) + " TRST or less.";
    } catch (error) { return String(error); }
    return null;
  }

  function handleSubmit() {
    if (blocked) return;
    const err = validate();
    if (err) {
      setFormError(err);
      return;
    }
    setFormError("");
    transaction.clear();
    reviewContext.current = { rpcUrl, address };
    const raw = parseAmount(amount);
    setOfflineRequest({kind:"transfer",to:recipient.trim(),amount:raw,origin:sourceFor(raw)});
    setConfirmOpen(true);
  }

  async function handleConfirm() {
    const err = validate();
    if (err) { setFormError(err); setConfirmOpen(false); return; }
    const completed = await transaction.submit({
      to: recipient.trim(),
      amount: parseAmount(amount),
      origin: sourceFor(parseAmount(amount)),
    }, reviewContext.current);
    if (completed) {
      setConfirmOpen(false);
      setRecipient("");
      setAmount("");
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <TransactionReceipt status={transaction.outcome.status} hash={transaction.outcome.hash} onDone={transaction.clear} />
      <Card>
        <CardHeader>
          <CardTitle className="text-heading">Transfer TRST</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-baseline justify-between gap-3 border-b pb-4">
            <span className="text-ui text-muted-foreground">Available TRST</span>
            {loading && !portfolio ? <Skeleton className="h-7 w-32" /> : <span className="text-title tabular-nums">{balanceError || !portfolio ? "—" : formatAmount(portfolio.total_active)}</span>}
          </div>
          {portfolio && !balanceError && <p className="mt-3 text-caption text-muted-foreground">Up to {formatAmount(largestSource.toString(), 18)} TRST in one transfer. Each transfer keeps one origin.</p>}
        </CardContent>
        <CardContent>
          <form className="space-y-4" onSubmit={event => { event.preventDefault(); handleSubmit(); }}>
          {balanceError && <p role="alert" className="text-ui text-warning">Balance unavailable. Check your node connection before transferring.</p>}
          <div className="space-y-2">
            <label htmlFor="recipient" className="text-ui">Recipient address</label>
            <Input
              className="font-mono"
              placeholder="brst_..."
              id="recipient"
              autoComplete="off"
              spellCheck={false}
              value={recipient}
              disabled={blocked}
              onChange={(e) => { setRecipient(e.target.value); setFormError(""); }}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="transfer-amount" className="text-ui">Amount (TRST)</label>
            <Input
              className="font-mono"
              type="text"
              id="transfer-amount"
              inputMode="decimal"
              placeholder="0.000000"
              value={amount}
              disabled={blocked}
              aria-describedby={formError ? "payment-error" : undefined}
              onChange={(e) => { setAmount(e.target.value); setFormError(""); }}
            />
          </div>
          {formError && <p id="payment-error" role="alert" className="text-ui text-destructive">{formError}</p>}
          <Button ref={reviewButtonRef} type="submit" className="w-full" disabled={blocked}>
            <ArrowUpRight className="h-4 w-4" />
            Transfer TRST
          </Button>
          </form>
        </CardContent>
      </Card>

      <p className="max-w-prose text-caption text-muted-foreground">
        Transferring TRST does not reset its age. Its origin stays visible, and the community’s expiry rules still apply.
      </p>

      <Dialog open={confirmOpen} onOpenChange={open => { if (!sending) setConfirmOpen(open); }}>
        <DialogContent onCloseAutoFocus={event => { event.preventDefault(); const target = reviewButtonRef.current; if (target && !target.disabled) target.focus(); else (document.querySelector<HTMLElement>("[data-transaction-receipt]") ?? document.getElementById("main-content"))?.focus(); }}>
          <DialogHeader>
            <DialogTitle>Confirm transfer</DialogTitle>
            <DialogDescription>
              Review the details before sending.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 rounded-md bg-muted p-4">
            <div>
              <p className="text-caption text-muted-foreground">To</p>
              <p className="break-all font-mono text-sm">{recipient}</p>
            </div>
            <div>
              <p className="text-caption text-muted-foreground">Amount</p>
              <p className="tabular-nums text-heading font-normal">{amount} TRST</p>
            </div>
          </div>
          {transaction.outcome.status === "error" && <p role="alert" className="text-ui text-destructive break-words">{transaction.outcome.message}</p>}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={sending}
            >
              Cancel
            </Button>
            {offlineRequest && <OfflineActionButton request={offlineRequest} address={reviewContext.current.address} rpcUrl={reviewContext.current.rpcUrl} disabled={sending} />}
            <Button onClick={handleConfirm} disabled={sending}>
              {sending && <Loader2 className="animate-spin" />}
              {sending ? "Submitting…" : "Confirm Transfer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
