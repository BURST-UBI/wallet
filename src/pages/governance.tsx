import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import {
  Vote,
  ThumbsUp,
  ThumbsDown,
  Minus,
  Loader2,
  Users,
  Link2,
  Link2Off,
  Info,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { useWallet, useRpc } from "@/hooks/use-wallet";
import { truncateAddress } from "@/lib/utils";
import type { BlockResult, DelegationInfo } from "@/lib/types";

export default function GovernancePage() {
  const { rpcUrl } = useWallet();
  const [proposalHash, setProposalHash] = useState("");
  const [voting, setVoting] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<BlockResult | null>(null);

  const [delegateTo, setDelegateTo] = useState("");
  const [delegating, setDelegating] = useState(false);
  const [revoking, setRevoking] = useState(false);

  const { data: delegation, loading: delegationLoading, refetch: refetchDelegation } =
    useRpc<DelegationInfo>("get_delegation_info", { rpcUrl }, 15_000);

  async function handleVote(vote: string) {
    if (!proposalHash.trim()) {
      toast.error("Enter a proposal hash");
      return;
    }
    setVoting(vote);
    try {
      const result = await invoke<BlockResult>("vote_proposal", {
        rpcUrl,
        proposal: proposalHash.trim(),
        vote,
      });
      setLastResult(result);
      if (result.accepted) {
        toast.success(`Vote "${vote}" submitted`, {
          description: `Hash: ${result.hash.slice(0, 16)}…`,
        });
      } else {
        toast.error("Vote rejected", {
          description: result.detail ?? "Unknown error",
        });
      }
    } catch (e) {
      toast.error("Vote failed", { description: String(e) });
    } finally {
      setVoting(null);
    }
  }

  async function handleDelegate() {
    if (!delegateTo.startsWith("brst_")) {
      toast.error("Address must start with brst_");
      return;
    }
    setDelegating(true);
    try {
      const result = await invoke<BlockResult>("delegate_vote", {
        rpcUrl,
        delegateTo: delegateTo.trim(),
      });
      if (result.accepted) {
        toast.success("Vote delegated", {
          description: `Delegated to ${truncateAddress(delegateTo)}`,
        });
        setDelegateTo("");
        refetchDelegation();
      } else {
        toast.error("Delegation rejected", {
          description: result.detail ?? "Unknown error",
        });
      }
    } catch (e) {
      toast.error("Delegation failed", { description: String(e) });
    } finally {
      setDelegating(false);
    }
  }

  async function handleRevoke() {
    setRevoking(true);
    try {
      const result = await invoke<BlockResult>("revoke_delegation", { rpcUrl });
      if (result.accepted) {
        toast.success("Delegation revoked");
        refetchDelegation();
      } else {
        toast.error("Revocation rejected", {
          description: result.detail ?? "Unknown error",
        });
      }
    } catch (e) {
      toast.error("Revocation failed", { description: String(e) });
    } finally {
      setRevoking(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Governance</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          One wallet = one vote. Vote on proposals or delegate your vote.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Vote className="h-4 w-4 text-primary" />
            Vote on Proposal
          </CardTitle>
          <CardDescription>
            Submit your vote on a governance proposal. 4-phase process:
            Proposal → Voting → Cooldown → Activation.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Proposal Hash</label>
            <Input
              className="font-mono"
              placeholder="Enter proposal hash"
              value={proposalHash}
              onChange={(e) => setProposalHash(e.target.value)}
            />
          </div>

          <Separator />

          <div className="flex gap-3">
            <Button
              className="flex-1"
              onClick={() => handleVote("yea")}
              disabled={!!voting}
            >
              {voting === "yea" ? (
                <Loader2 className="animate-spin" />
              ) : (
                <ThumbsUp className="h-4 w-4" />
              )}
              Yea
            </Button>
            <Button
              variant="destructive"
              className="flex-1"
              onClick={() => handleVote("nay")}
              disabled={!!voting}
            >
              {voting === "nay" ? (
                <Loader2 className="animate-spin" />
              ) : (
                <ThumbsDown className="h-4 w-4" />
              )}
              Nay
            </Button>
            <Button
              variant="secondary"
              className="flex-1"
              onClick={() => handleVote("abstain")}
              disabled={!!voting}
            >
              {voting === "abstain" ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Minus className="h-4 w-4" />
              )}
              Abstain
            </Button>
          </div>
        </CardContent>
      </Card>

      {lastResult && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Vote Result</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Status</span>
                <span className={lastResult.accepted ? "text-success" : "text-destructive"}>
                  {lastResult.accepted ? "Accepted" : "Rejected"}
                </span>
              </div>
              <div>
                <span className="text-sm text-muted-foreground">Transaction Hash</span>
                <p className="mt-1 break-all font-mono text-xs">{lastResult.hash}</p>
              </div>
              {lastResult.detail && (
                <div>
                  <span className="text-sm text-muted-foreground">Detail</span>
                  <p className="mt-1 text-sm">{lastResult.detail}</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-4 w-4 text-primary" />
            Vote Delegation
          </CardTitle>
          <CardDescription>
            Delegate your governance vote to a representative. Revoke at any time.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {delegationLoading ? (
            <Skeleton className="h-12 w-full" />
          ) : delegation?.delegated_to ? (
            <div className="flex items-center justify-between rounded-md border border-primary/20 bg-primary/5 p-3">
              <div className="flex items-center gap-2">
                <Link2 className="h-4 w-4 text-primary" />
                <div>
                  <p className="text-sm font-medium">Your vote is delegated to</p>
                  <p className="font-mono text-xs text-muted-foreground">
                    {truncateAddress(delegation.delegated_to)}
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleRevoke}
                disabled={revoking}
              >
                {revoking ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Link2Off className="h-3.5 w-3.5" />
                )}
                Revoke
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-2">
                <label className="text-sm font-medium">Delegate to</label>
                <Input
                  className="font-mono"
                  placeholder="brst_..."
                  value={delegateTo}
                  onChange={(e) => setDelegateTo(e.target.value)}
                />
              </div>
              <Button
                className="w-full"
                onClick={handleDelegate}
                disabled={delegating || !delegateTo.trim()}
              >
                {delegating && <Loader2 className="animate-spin" />}
                Delegate Vote
              </Button>
            </div>
          )}

          {delegation && delegation.delegated_from.length > 0 && (
            <>
              <Separator />
              <div>
                <p className="mb-2 text-sm font-medium text-muted-foreground">
                  Wallets delegating to you ({delegation.delegated_from.length})
                </p>
                <div className="space-y-1">
                  {delegation.delegated_from.map((addr) => (
                    <p key={addr} className="font-mono text-xs">
                      {truncateAddress(addr)}
                    </p>
                  ))}
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/50 p-4">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div className="text-sm text-muted-foreground">
          <p className="font-medium text-foreground">How governance works</p>
          <p className="mt-1">
            BURST governance is democratic: one wallet = one vote, regardless of balance.
            Delegation lets you entrust your vote to a representative via secondary key pairs.
            Proposals follow a 4-phase lifecycle: Proposal → Voting → Cooldown → Activation.
            You can revoke your delegation at any time.
          </p>
        </div>
      </div>
    </div>
  );
}
