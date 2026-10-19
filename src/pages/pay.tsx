import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { BrnIcon } from "@/components/burst-icons";
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
import { useWallet, useBrn } from "@/hooks/use-wallet";
import { parseAmount } from "@/lib/brn";
import { formatAmount } from "@/lib/utils";


import { useTransaction } from "@/hooks/use-transaction";
import { TransactionReceipt } from "@/components/transaction-receipt";

export default function PayPage() {
  const { rpcUrl, address } = useWallet();
  const reviewContext = useRef({ rpcUrl, address });
  const [formError, setFormError] = useState("");
  const transaction = useTransaction(rpcUrl, address, "pay");
  const [provider, setProvider] = useState("");
  const [amount, setAmount] = useState("");
  const reviewButtonRef = useRef<HTMLButtonElement>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const paying = transaction.outcome.status === "sending";
  const blocked = paying || ["confirmed", "uncertain"].includes(transaction.outcome.status);

  const { balance: brnBalance, loading, error: balanceError } = useBrn(rpcUrl);

  function validate(): string | null {
    if (!provider.startsWith("brst_")) return "Provider address must start with brst_";
    try {
      const raw = parseAmount(amount);
      if (brnBalance === null) return "Connect to your node before paying";
      if (BigInt(raw) > BigInt(brnBalance)) return "Insufficient available BRN";
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
    setConfirmOpen(true);
  }

  async function handleConfirm() {
    const err = validate();
    if (err) { setFormError(err); setConfirmOpen(false); return; }
    const completed = await transaction.submit({
      provider: provider.trim(),
      amount: parseAmount(amount),
    }, reviewContext.current);
    if (completed) {
      setConfirmOpen(false);
      setProvider("");
      setAmount("");
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <TransactionReceipt status={transaction.outcome.status} hash={transaction.outcome.hash} onDone={transaction.clear} />
      <Card>
        <CardHeader>
          <CardTitle className="text-heading">Pay with BRN</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-baseline justify-between gap-3 border-b pb-4">
            <span className="text-ui text-muted-foreground">Available BRN</span>
            {loading && brnBalance === null ? <Skeleton className="h-7 w-32" /> : <span className="text-title tabular-nums">{brnBalance === null ? "—" : formatAmount(brnBalance)}</span>}
          </div>
        </CardContent>
        <CardContent>
          <form className="space-y-4" onSubmit={event => { event.preventDefault(); handleSubmit(); }}>
          {balanceError && <p role="alert" className="text-sm text-warning">Balance unavailable. Check your node connection before paying.</p>}
          <div className="space-y-2">
            <label htmlFor="provider" className="text-ui">Provider address</label>
            <Input
              className="font-mono"
              placeholder="brst_..."
              id="provider"
              autoComplete="off"
              spellCheck={false}
              value={provider}
              disabled={blocked}
              onChange={(e) => { setProvider(e.target.value); setFormError(""); }}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="pay-amount" className="text-ui">Amount (BRN)</label>
            <Input
              className="font-mono"
              type="text"
              id="pay-amount"
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
            <BrnIcon className="h-4 w-4" />
            Pay
          </Button>
          </form>
        </CardContent>
      </Card>

      <p className="max-w-prose text-caption text-muted-foreground">
        Payments permanently burn BRN and create the same amount of TRST for the provider, never for yourself.
      </p>
      <Button asChild variant="link"><Link to="/pay/offline">Prepare or recover an offline payment</Link></Button>

      <Dialog open={confirmOpen} onOpenChange={open => { if (!paying) setConfirmOpen(open); }}>
        <DialogContent onCloseAutoFocus={event => { event.preventDefault(); const target = reviewButtonRef.current; if (target && !target.disabled) target.focus(); else (document.querySelector<HTMLElement>("[data-transaction-receipt]") ?? document.getElementById("main-content"))?.focus(); }}>
          <DialogHeader>
            <DialogTitle>Confirm payment</DialogTitle>
            <DialogDescription>
              This will permanently burn your BRN. The provider receives TRST.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 rounded-md bg-muted p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">You burn</span>
              <span className="font-mono font-normal text-warning">{amount} BRN</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Provider receives</span>
              <span className="font-mono font-normal text-success">{amount} TRST</span>
            </div>
            <div>
              <span className="text-caption text-muted-foreground">Provider</span>
              <p className="mt-0.5 break-all font-mono text-caption">{provider}</p>
            </div>
          </div>
          {transaction.outcome.status === "error" && <p role="alert" className="text-ui text-destructive break-words">{transaction.outcome.message}</p>}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={paying}
            >
              Cancel
            </Button>
            <Button onClick={handleConfirm} disabled={paying}>
              {paying && <Loader2 className="animate-spin" />}
              {paying ? "Submitting…" : "Confirm Payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
