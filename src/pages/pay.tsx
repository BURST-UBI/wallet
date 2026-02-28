import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { Zap, Loader2, Info, ArrowRight } from "lucide-react";
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
import type { BlockResult } from "@/lib/types";

export default function PayPage() {
  const { rpcUrl } = useWallet();
  const [provider, setProvider] = useState("");
  const [amount, setAmount] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [paying, setPaying] = useState(false);

  const { data: brnBalance, loading } = useRpc<string>(
    "get_brn_balance",
    { rpcUrl },
    10_000,
  );

  function validate(): string | null {
    if (!provider.startsWith("brst_")) return "Provider address must start with brst_";
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
    setPaying(true);
    try {
      const result = await invoke<BlockResult>("pay", {
        rpcUrl,
        provider: provider.trim(),
        amount: amount.trim(),
      });
      if (result.accepted) {
        toast.success("Payment successful", {
          description: `${amount} BRN burned → Provider receives TRST. Hash: ${result.hash.slice(0, 16)}…`,
        });
        setProvider("");
        setAmount("");
      } else {
        toast.error("Payment rejected", {
          description: result.detail ?? "Unknown error",
        });
      }
    } catch (e) {
      toast.error("Payment failed", { description: String(e) });
    } finally {
      setPaying(false);
      setConfirmOpen(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Pay with BRN</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Burn your BRN to pay a provider. They receive freshly minted TRST.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your BRN</CardTitle>
          <CardDescription>Available birthright income to spend</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center gap-6 py-2">
            <div className="text-center">
              <p className="text-xs text-muted-foreground">Your BRN</p>
              {loading ? (
                <Skeleton className="mx-auto mt-1 h-8 w-32" />
              ) : (
                <p className="font-mono text-2xl font-bold">
                  {formatAmount(brnBalance ?? "0")}
                </p>
              )}
            </div>
            <ArrowRight className="h-5 w-5 text-muted-foreground" />
            <div className="text-center">
              <p className="text-xs text-muted-foreground">Provider gets TRST</p>
              <p className="font-mono text-2xl font-bold text-success">
                {amount && !isNaN(Number(amount)) ? Number(amount).toFixed(6) : "0.000000"}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Payment Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Provider Address</label>
            <Input
              className="font-mono"
              placeholder="brst_..."
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
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
          <Button className="w-full" onClick={handleSubmit} disabled={paying}>
            <Zap className="h-4 w-4" />
            Pay
          </Button>
        </CardContent>
      </Card>

      <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/50 p-4">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div className="text-sm text-muted-foreground">
          <p className="font-medium text-foreground">How payment works</p>
          <p className="mt-1">
            When you pay, your BRN (birthright income) is permanently consumed. The provider
            receives an equal amount of freshly minted TRST — this is how new TRST enters
            circulation. The ratio is always 1:1. You never create TRST for yourself.
          </p>
        </div>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Payment</DialogTitle>
            <DialogDescription>
              This will permanently burn your BRN. The provider receives TRST.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 rounded-md bg-muted p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">You burn</span>
              <span className="font-mono font-bold text-warning">{amount} BRN</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Provider receives</span>
              <span className="font-mono font-bold text-success">{amount} TRST</span>
            </div>
            <div>
              <span className="text-xs text-muted-foreground">Provider</span>
              <p className="mt-0.5 break-all font-mono text-xs">{provider}</p>
            </div>
          </div>
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
              Confirm Payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
