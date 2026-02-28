import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { ArrowUpRight, Loader2, Info } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
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
import type { TrstBalance, BlockResult } from "@/lib/types";

export default function TransferPage() {
  const { rpcUrl } = useWallet();
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);

  const { data: trstBalance, loading } = useRpc<TrstBalance>(
    "get_trst_balance",
    { rpcUrl },
    10_000,
  );

  function validate(): string | null {
    if (!recipient.startsWith("brst_")) return "Address must start with brst_";
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0)
      return "Enter a valid amount";
    return null;
  }

  function handleSubmit() {
    const err = validate();
    if (err) {
      toast.error(err);
      return;
    }
    setConfirmOpen(true);
  }

  async function handleConfirm() {
    setSending(true);
    try {
      const result = await invoke<BlockResult>("transfer_trst", {
        rpcUrl,
        to: recipient.trim(),
        amount: amount.trim(),
      });
      if (result.accepted) {
        toast.success("Transfer sent", {
          description: `${amount} TRST → ${recipient.slice(0, 12)}… Hash: ${result.hash.slice(0, 16)}…`,
        });
        setRecipient("");
        setAmount("");
      } else {
        toast.error("Transfer rejected", {
          description: result.detail ?? "Unknown error",
        });
      }
    } catch (e) {
      toast.error("Transfer failed", { description: String(e) });
    } finally {
      setSending(false);
      setConfirmOpen(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Transfer TRST</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Send your existing TRST to another wallet.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Available TRST</CardTitle>
          <CardDescription>Active TRST you can transfer</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-8 w-40" />
          ) : (
            <p className="font-mono text-2xl font-bold text-success">
              {formatAmount(trstBalance?.active ?? "0")}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Transfer Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Recipient Address</label>
            <Input
              className="font-mono"
              placeholder="brst_..."
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Amount</label>
            <Input
              className="font-mono"
              type="text"
              inputMode="decimal"
              placeholder="0.000000"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <Button className="w-full" onClick={handleSubmit} disabled={sending}>
            <ArrowUpRight className="h-4 w-4" />
            Transfer TRST
          </Button>
        </CardContent>
      </Card>

      <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/50 p-4">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div className="text-sm text-muted-foreground">
          <p className="font-medium text-foreground">About TRST transfers</p>
          <p className="mt-1">
            TRST transfers carry origin and link metadata. Each TRST unit traces back to the
            burn transaction that created it. The recipient can verify the full provenance chain.
            TRST retains its original expiry date regardless of how many times it's transferred.
          </p>
        </div>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Transfer</DialogTitle>
            <DialogDescription>
              Review the details before sending.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 rounded-md bg-muted p-4">
            <div>
              <p className="text-xs text-muted-foreground">To</p>
              <p className="break-all font-mono text-sm">{recipient}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Amount</p>
              <p className="font-mono text-lg font-bold">{amount} TRST</p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={sending}
            >
              Cancel
            </Button>
            <Button onClick={handleConfirm} disabled={sending}>
              {sending && <Loader2 className="animate-spin" />}
              Confirm Transfer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
