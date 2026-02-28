import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { QRCodeSVG } from "qrcode.react";
import { Copy, Check, Download, Loader2, Info } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useWallet, useRpc } from "@/hooks/use-wallet";
import { formatAmount, truncateAddress } from "@/lib/utils";
import type { PendingBlocks, BlockResult } from "@/lib/types";

export default function ReceivePage() {
  const { address, rpcUrl } = useWallet();
  const [copied, setCopied] = useState(false);
  const [receiving, setReceiving] = useState<string | null>(null);
  const [receivingAll, setReceivingAll] = useState(false);

  const {
    data: pending,
    loading,
    refetch,
  } = useRpc<PendingBlocks>("get_pending", { rpcUrl }, 10_000);

  async function copyAddress() {
    if (!address) return;
    await navigator.clipboard.writeText(address);
    setCopied(true);
    toast.success("Address copied");
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleReceive(hash: string) {
    setReceiving(hash);
    try {
      const result = await invoke<BlockResult>("receive_pending", {
        rpcUrl,
        hash,
      });
      if (result.accepted) {
        toast.success("Block received", {
          description: `Hash: ${result.hash.slice(0, 16)}…`,
        });
        refetch();
      } else {
        toast.error("Receive failed", {
          description: result.detail ?? "Unknown error",
        });
      }
    } catch (e) {
      toast.error("Receive failed", { description: String(e) });
    } finally {
      setReceiving(null);
    }
  }

  async function handleReceiveAll() {
    if (!pending?.blocks.length) return;
    setReceivingAll(true);
    let successCount = 0;
    let failCount = 0;

    for (const block of pending.blocks) {
      try {
        const result = await invoke<BlockResult>("receive_pending", {
          rpcUrl,
          hash: block.hash,
        });
        if (result.accepted) successCount++;
        else failCount++;
      } catch {
        failCount++;
      }
    }

    if (successCount > 0) {
      toast.success(`Received ${successCount} block${successCount > 1 ? "s" : ""}`);
    }
    if (failCount > 0) {
      toast.error(`${failCount} block${failCount > 1 ? "s" : ""} failed to receive`);
    }

    refetch();
    setReceivingAll(false);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Receive</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Share your address to receive TRST from payments and transfers.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your Address</CardTitle>
          <CardDescription>
            Share this address to receive TRST
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4">
          {address && (
            <div className="rounded-lg bg-white p-4">
              <QRCodeSVG value={address} size={180} />
            </div>
          )}
          <div className="flex w-full items-center gap-2">
            <code className="flex-1 overflow-hidden break-all rounded-md bg-muted p-3 font-mono text-xs">
              {address ?? "No address"}
            </code>
            <Button variant="outline" size="icon" onClick={copyAddress}>
              {copied ? (
                <Check className="h-4 w-4 text-success" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/50 p-4">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <p className="text-sm text-muted-foreground">
          You receive TRST when someone burns BRN to pay you (freshly minted TRST),
          or when someone transfers their existing TRST to you. Pending blocks must be
          explicitly received to credit your wallet.
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Pending Receivables</CardTitle>
              <CardDescription>
                Blocks waiting to be received
              </CardDescription>
            </div>
            <div className="flex gap-2">
              {(pending?.blocks.length ?? 0) > 1 && (
                <Button
                  size="sm"
                  onClick={handleReceiveAll}
                  disabled={receivingAll}
                >
                  {receivingAll && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Receive All
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={refetch}>
                Refresh
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : !pending?.blocks.length ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No pending blocks
            </p>
          ) : (
            <div className="space-y-2">
              {pending.blocks.map((block) => (
                <div
                  key={block.hash}
                  className="flex items-center gap-3 rounded-md border p-3"
                >
                  <Download className="h-4 w-4 shrink-0 text-warning" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-mono text-xs text-muted-foreground">
                        {truncateAddress(block.source)}
                      </p>
                      <Badge variant="outline" className="text-[10px] capitalize">
                        {block.block_type}
                      </Badge>
                    </div>
                    <p className="font-mono text-sm font-medium text-success">
                      +{formatAmount(block.amount)}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => handleReceive(block.hash)}
                    disabled={receiving === block.hash || receivingAll}
                  >
                    {receiving === block.hash ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      "Receive"
                    )}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
