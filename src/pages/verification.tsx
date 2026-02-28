import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import {
  ShieldCheck,
  ShieldAlert,
  ShieldQuestion,
  UserCheck,
  Swords,
  Loader2,
  AlertTriangle,
  Info,
  CheckCircle,
  XCircle,
  MinusCircle,
  Clock,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import { Separator } from "@/components/ui/separator";
import { useWallet, useRpc } from "@/hooks/use-wallet";
import { truncateAddress, formatTimeSince, cn } from "@/lib/utils";
import type { VerificationStatus, BlockResult } from "@/lib/types";

function stateConfig(state: string) {
  switch (state) {
    case "Verified":
      return { icon: ShieldCheck, color: "text-success", bg: "bg-success/10", label: "Verified" };
    case "Endorsed":
      return { icon: UserCheck, color: "text-warning", bg: "bg-warning/10", label: "Endorsed — Awaiting Verification" };
    case "Voting":
      return { icon: ShieldQuestion, color: "text-blue-400", bg: "bg-blue-400/10", label: "Voting in Progress" };
    case "Challenged":
      return { icon: ShieldAlert, color: "text-destructive", bg: "bg-destructive/10", label: "Challenged" };
    case "Revoked":
      return { icon: ShieldAlert, color: "text-destructive", bg: "bg-destructive/10", label: "Revoked" };
    default:
      return { icon: ShieldQuestion, color: "text-muted-foreground", bg: "bg-muted", label: "Unverified" };
  }
}

export default function VerificationPage() {
  const { rpcUrl } = useWallet();

  const { data: status, loading } = useRpc<VerificationStatus>(
    "get_verification_status",
    { rpcUrl },
    10_000,
  );

  const [endorseTarget, setEndorseTarget] = useState("");
  const [endorseAmount, setEndorseAmount] = useState("");
  const [endorseConfirm, setEndorseConfirm] = useState(false);
  const [endorsing, setEndorsing] = useState(false);

  const [challengeTarget, setChallengeTarget] = useState("");
  const [challengeStake, setChallengeStake] = useState("");
  const [challengeConfirm, setChallengeConfirm] = useState(false);
  const [challenging, setChallenging] = useState(false);

  async function handleEndorse() {
    setEndorsing(true);
    try {
      const result = await invoke<BlockResult>("endorse_wallet", {
        rpcUrl,
        target: endorseTarget.trim(),
        amount: endorseAmount.trim(),
      });
      if (result.accepted) {
        toast.success("Endorsement submitted", {
          description: `${endorseAmount} BRN permanently burned. Hash: ${result.hash.slice(0, 16)}…`,
        });
        setEndorseTarget("");
        setEndorseAmount("");
      } else {
        toast.error("Endorsement rejected", {
          description: result.detail ?? "Unknown error",
        });
      }
    } catch (e) {
      toast.error("Endorsement failed", { description: String(e) });
    } finally {
      setEndorsing(false);
      setEndorseConfirm(false);
    }
  }

  async function handleChallenge() {
    setChallenging(true);
    try {
      const result = await invoke<BlockResult>("challenge_wallet", {
        rpcUrl,
        target: challengeTarget.trim(),
        stake: challengeStake.trim(),
      });
      if (result.accepted) {
        toast.success("Challenge submitted", {
          description: `Staked ${challengeStake} BRN. Hash: ${result.hash.slice(0, 16)}…`,
        });
        setChallengeTarget("");
        setChallengeStake("");
      } else {
        toast.error("Challenge rejected", {
          description: result.detail ?? "Unknown error",
        });
      }
    } catch (e) {
      toast.error("Challenge failed", { description: String(e) });
    } finally {
      setChallenging(false);
      setChallengeConfirm(false);
    }
  }

  const config = status ? stateConfig(status.state) : stateConfig("Unverified");
  const StateIcon = config.icon;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Verification</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Prove your humanity to start accruing BRN. Endorse others or challenge suspicious wallets.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your Verification Status</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-4 w-48" />
            </div>
          ) : status ? (
            <div className="space-y-4">
              <div className={cn("flex items-center gap-3 rounded-lg p-4", config.bg)}>
                <StateIcon className={cn("h-8 w-8", config.color)} />
                <div>
                  <p className={cn("text-lg font-bold", config.color)}>{config.label}</p>
                  {status.state === "Verified" && status.verified_at && (
                    <p className="text-sm text-muted-foreground">
                      BRN has been accruing since{" "}
                      {new Date(status.verified_at * 1000).toLocaleDateString()}{" "}
                      ({formatTimeSince(status.verified_at)})
                    </p>
                  )}
                  {status.challenge_active && (
                    <p className="mt-1 text-sm text-destructive">
                      An active challenge is pending against your wallet.
                    </p>
                  )}
                </div>
              </div>

              {status.state !== "Verified" && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Endorsement Progress</span>
                    <span className="font-mono font-medium">
                      {status.endorsement_count} / {status.endorsement_threshold}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary transition-all"
                      style={{
                        width: `${Math.min(100, (status.endorsement_count / Math.max(1, status.endorsement_threshold)) * 100)}%`,
                      }}
                    />
                  </div>
                  {status.endorsers.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-muted-foreground">Endorsers</p>
                      {status.endorsers.map((addr) => (
                        <p key={addr} className="font-mono text-xs text-foreground">
                          {truncateAddress(addr)}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {status.state === "Voting" && status.verifier_votes.length > 0 && (
                <div className="space-y-2">
                  <Separator />
                  <p className="text-sm font-medium">Verifier Votes</p>
                  <div className="space-y-1">
                    {status.verifier_votes.map((v) => (
                      <div key={v.verifier} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                        <span className="font-mono text-xs text-muted-foreground">
                          {truncateAddress(v.verifier)}
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Clock className="h-3 w-3" />
                            {formatTimeSince(v.timestamp)}
                          </span>
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-[10px]",
                              v.vote === "Legitimate"
                                ? "border-success/30 text-success"
                                : v.vote === "Illegitimate"
                                  ? "border-destructive/30 text-destructive"
                                  : "border-border text-muted-foreground",
                            )}
                          >
                            {v.vote === "Legitimate" && <CheckCircle className="mr-1 h-2.5 w-2.5" />}
                            {v.vote === "Illegitimate" && <XCircle className="mr-1 h-2.5 w-2.5" />}
                            {v.vote === "Neither" && <MinusCircle className="mr-1 h-2.5 w-2.5" />}
                            {v.vote}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Unable to load verification status.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <UserCheck className="h-4 w-4 text-purple-400" />
            Endorse a Wallet
          </CardTitle>
          <CardDescription>
            Vouch for another person's humanity by permanently burning your BRN.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start gap-3 rounded-lg border border-warning/30 bg-warning/5 p-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <p className="text-xs text-muted-foreground">
              Endorsing <span className="font-medium text-warning">permanently burns</span> your
              BRN to vouch for another person's humanity. This BRN is gone forever — it is
              not staked or recoverable. Only endorse people you know are real humans.
            </p>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Target Address</label>
            <Input
              className="font-mono"
              placeholder="brst_..."
              value={endorseTarget}
              onChange={(e) => setEndorseTarget(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">BRN to Burn</label>
            <Input
              className="font-mono"
              type="text"
              inputMode="decimal"
              placeholder="0.000000"
              value={endorseAmount}
              onChange={(e) => setEndorseAmount(e.target.value)}
            />
          </div>
          <Button
            className="w-full"
            variant="secondary"
            onClick={() => {
              if (!endorseTarget.startsWith("brst_")) {
                toast.error("Address must start with brst_");
                return;
              }
              if (!endorseAmount || Number(endorseAmount) <= 0) {
                toast.error("Enter a valid amount");
                return;
              }
              setEndorseConfirm(true);
            }}
          >
            <UserCheck className="h-4 w-4" />
            Endorse
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Swords className="h-4 w-4 text-destructive" />
            Challenge a Wallet
          </CardTitle>
          <CardDescription>
            Challenge a wallet you believe is fraudulent by staking BRN.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/50 p-3">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <p className="text-xs text-muted-foreground">
              Challenge a wallet you believe is operated by a bot or sybil. You must stake BRN.
              If the challenge succeeds, you are rewarded and their TRST is revoked via the MergerGraph.
              If it fails, <span className="font-medium text-destructive">you lose your staked BRN</span>.
            </p>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Target Address</label>
            <Input
              className="font-mono"
              placeholder="brst_..."
              value={challengeTarget}
              onChange={(e) => setChallengeTarget(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">BRN to Stake</label>
            <Input
              className="font-mono"
              type="text"
              inputMode="decimal"
              placeholder="0.000000"
              value={challengeStake}
              onChange={(e) => setChallengeStake(e.target.value)}
            />
          </div>
          <Button
            className="w-full"
            variant="destructive"
            onClick={() => {
              if (!challengeTarget.startsWith("brst_")) {
                toast.error("Address must start with brst_");
                return;
              }
              if (!challengeStake || Number(challengeStake) <= 0) {
                toast.error("Enter a valid stake amount");
                return;
              }
              setChallengeConfirm(true);
            }}
          >
            <Swords className="h-4 w-4" />
            Challenge
          </Button>
        </CardContent>
      </Card>

      <Dialog open={endorseConfirm} onOpenChange={setEndorseConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-warning">Confirm Endorsement</DialogTitle>
            <DialogDescription>
              This action is irreversible. Your BRN will be permanently burned.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 rounded-md bg-warning/5 p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">BRN to burn (forever)</span>
              <span className="font-mono font-bold text-warning">{endorseAmount} BRN</span>
            </div>
            <div>
              <span className="text-xs text-muted-foreground">Endorsing</span>
              <p className="break-all font-mono text-xs">{endorseTarget}</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEndorseConfirm(false)} disabled={endorsing}>
              Cancel
            </Button>
            <Button variant="default" onClick={handleEndorse} disabled={endorsing}>
              {endorsing && <Loader2 className="animate-spin" />}
              Burn & Endorse
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={challengeConfirm} onOpenChange={setChallengeConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive">Confirm Challenge</DialogTitle>
            <DialogDescription>
              If the challenge fails, you will lose your staked BRN.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 rounded-md bg-destructive/5 p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">BRN at risk</span>
              <span className="font-mono font-bold text-destructive">{challengeStake} BRN</span>
            </div>
            <div>
              <span className="text-xs text-muted-foreground">Challenging</span>
              <p className="break-all font-mono text-xs">{challengeTarget}</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setChallengeConfirm(false)} disabled={challenging}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleChallenge} disabled={challenging}>
              {challenging && <Loader2 className="animate-spin" />}
              Submit Challenge
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
