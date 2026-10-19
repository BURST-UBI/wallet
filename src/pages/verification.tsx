import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTransaction } from "@/hooks/use-transaction";
import { OfflineActionButton } from "@/components/offline-action-button";
import { TransactionReceipt } from "@/components/transaction-receipt";
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
  ChevronDown,
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
import type { VerificationStatus } from "@/lib/types";
import { parseAmount } from "@/lib/brn";
import { AppealPanel } from "@/components/appeal-panel";
import { VerificationVotePanel } from "@/components/verification-vote-panel";

function stateConfig(state: string) {
  switch (state.toLowerCase()) {
    case "verified":
      return { icon: ShieldCheck, color: "text-success", bg: "bg-success/10", label: "Verified" };
    case "endorsing":
    case "endorsed":
      return { icon: UserCheck, color: "text-warning", bg: "bg-warning/10", label: "Endorsed — Awaiting Verification" };
    case "voting":
      return { icon: ShieldQuestion, color: "text-blue-400", bg: "bg-blue-400/10", label: "Voting in Progress" };
    case "challenged":
      return { icon: ShieldAlert, color: "text-destructive", bg: "bg-destructive/10", label: "Challenged" };
    case "deactivated":
      return { icon: ShieldAlert, color: "text-warning", bg: "bg-warning/10", label: "Deactivated — TRST not revoked" };
    case "revoked":
      return { icon: ShieldAlert, color: "text-destructive", bg: "bg-destructive/10", label: "Revoked" };
    default:
      return { icon: ShieldQuestion, color: "text-muted-foreground", bg: "bg-muted", label: "Unverified" };
  }
}

export default function VerificationPage() {
  const { rpcUrl, address } = useWallet();
  const reviewContext = useRef({ rpcUrl, address });
  const endorseAction = useTransaction(rpcUrl, address, "endorse_wallet");
  const challengeAction = useTransaction(rpcUrl, address, "challenge_wallet");
  const volunteerAction = useTransaction(rpcUrl, address, "set_verifier_participation");
  const navigate = useNavigate();

  const { data: status, loading, error, refetch } = useRpc<VerificationStatus>(
    "get_verification_status",
    { rpcUrl },
    10_000,
  );

  const endorseTrigger = useRef<HTMLButtonElement>(null);
  const challengeTrigger = useRef<HTMLButtonElement>(null);
  const [endorseTarget, setEndorseTarget] = useState("");
  const [endorseAmount, setEndorseAmount] = useState("");
  const [endorseConfirm, setEndorseConfirm] = useState(false);
  const endorsing = endorseAction.outcome.status === "sending";

  const [challengeTarget, setChallengeTarget] = useState("");
  const [challengeStake, setChallengeStake] = useState("");
  const [challengeReason, setChallengeReason] = useState("fraud");
  const [challengeConfirm, setChallengeConfirm] = useState(false);
  const challenging = challengeAction.outcome.status === "sending";

  async function handleEndorse() {
    if (!canParticipate) return;
    const completed = await endorseAction.submit({ target: endorseTarget.trim(), amount: parseAmount(endorseAmount) }, reviewContext.current);
    if (completed) { setEndorseConfirm(false); setEndorseTarget(""); setEndorseAmount(""); refetch(); }
  }
  async function handleChallenge() {
    if (!canChallenge) return;
    const completed = await challengeAction.submit({ target: challengeTarget.trim(), stake: parseAmount(challengeStake), reason: challengeReason }, reviewContext.current);
    if (completed) { setChallengeConfirm(false); setChallengeTarget(""); setChallengeStake(""); refetch(); }
  }

  const config = status ? stateConfig(status.state) : stateConfig("Unverified");
  const StateIcon = config.icon;
  const state = status?.state.toLowerCase();
  const canParticipate = !error && (state === "verified" || state === "challenged");
  const reviewsAvailable = !error && status?.selection_available === true;
  const canChallenge = canParticipate && reviewsAvailable;
  const reviewAvailability = status?.selection_available === false
    ? "Identity reviews are paused on this node."
    : "Your node hasn't reported whether identity reviews are available.";
  const needsEndorsements = state === "unverified" || state === "endorsing" || state === "endorsed";


  return (
    <div className="space-y-6">
      {error && <div role="alert" className="balance-panel"><p>Verification status unavailable</p><p className="text-ui text-muted-foreground">{error}</p><Button onClick={refetch}>Try again</Button></div>}
      <TransactionReceipt {...endorseAction.outcome} onDone={endorseAction.clear} description="Your endorsement has been recorded." />
      <TransactionReceipt {...challengeAction.outcome} onDone={challengeAction.clear} description="Your request for re-verification has been recorded." />
      <TransactionReceipt {...volunteerAction.outcome} onDone={volunteerAction.clear} description="Your verifier participation change has been recorded." uncertainDescription="Your participation may already have changed. Check activity and refresh your status before trying again." />
      <div>
        <h1 className="text-title font-normal tracking-tight">Verification</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          One person, one wallet. Your verification gives you access to payments, income, and voting.
        </p>
      </div>

      <Card>
        <CardContent className="pt-6">
          {loading && !status ? (
            <div className="space-y-3">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-4 w-48" />
            </div>
          ) : status && !error ? (
            <div className="space-y-4">
              <div className={cn("flex items-center gap-3 rounded-lg p-4", config.bg)}>
                <StateIcon className={cn("h-8 w-8", config.color)} />
                <div>
                  <p className={cn("text-heading font-normal", config.color)}>{state === "voting" && !reviewsAvailable ? "Review on hold" : config.label}</p>
                  {status.state.toLowerCase() === "verified" && status.verified_at && (
                    <p className="text-sm text-muted-foreground">
                      Verified since{" "}
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

              {!reviewsAvailable && <p role="status" className="text-ui text-muted-foreground">{reviewAvailability}</p>}

              {needsEndorsements && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-muted-foreground">People who have vouched for you</span>
                    <span className="shrink-0 whitespace-nowrap tabular-nums">
                      {status.endorsement_count} / {status.endorsement_threshold}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary transition-opacity"
                      style={{
                        width: `${Math.min(100, (status.endorsement_count / Math.max(1, status.endorsement_threshold)) * 100)}%`,
                      }}
                    />
                  </div>
                  {status.endorsers.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-caption font-normal text-muted-foreground">Endorsers</p>
                      {status.endorsers.map((addr) => (
                        <p key={addr} className="font-mono text-caption text-foreground">
                          {truncateAddress(addr)}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {needsEndorsements && <div className="space-y-3 border-t pt-4">
                <p className="text-ui">Ask verified people who know you to vouch for you.</p>
                <p className="text-caption text-muted-foreground">{reviewsAvailable
                  ? "Share your address. Randomly selected verifiers review your identity next. Endorsements alone do not verify your wallet."
                  : "You can collect endorsements, but this node cannot complete verification yet. Endorsements alone do not verify your wallet."}</p>
                <Button variant="outline" onClick={() => navigate("/receive")}>Share your address</Button>
              </div>}
              {state === "voting" && reviewsAvailable && <p className="text-ui text-muted-foreground">Your identity is being reviewed. The result will appear here.</p>}
              {state === "deactivated" && <p className="text-ui text-muted-foreground">Income and transaction rights are paused. Your legitimate TRST has not been revoked. Re-verification is needed to restore access.</p>}
              {state === "revoked" && <p className="text-ui text-destructive">This wallet cannot transact or receive new income. TRST created from this wallet’s BRN has been revoked, including TRST passed to others.</p>}

              {status.state.toLowerCase() === "voting" && status.verifier_votes.length > 0 && (
                <div className="space-y-2">
                  <Separator />
                  <p className="text-sm font-normal">Verifier Votes</p>
                  <div className="space-y-1">
                    {status.verifier_votes.map((v) => (
                      <div key={v.verifier} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
                        <span className="font-mono text-caption text-muted-foreground">
                          {truncateAddress(v.verifier)}
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="flex items-center gap-1 text-caption text-muted-foreground">
                            <Clock className="h-3 w-3" />
                            {formatTimeSince(v.timestamp)}
                          </span>
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-caption",
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

      {canParticipate && <section aria-labelledby="verifier-participation" className="space-y-3 border-t pt-4">
        <h2 id="verifier-participation" className="text-heading">Help verify people</h2>
        <p className="max-w-prose text-ui text-muted-foreground">Volunteer for randomly selected identity reviews. Each review has a separate vote and stake.</p>
        {typeof status?.verifier_opted_in === "boolean" ? <>
          <p className="text-ui">{status.verifier_opted_in ? "You’re volunteering. Stopping does not cancel existing assignments." : "You’re not volunteering."}</p>
          <Button variant="outline"
            disabled={(!reviewsAvailable && !status.verifier_opted_in) || loading || ["sending", "confirmed", "uncertain"].includes(volunteerAction.outcome.status)}
            onClick={async () => {
              if (await volunteerAction.submit({ optedIn: !status.verifier_opted_in }, { rpcUrl, address })) refetch();
            }}>
            {volunteerAction.outcome.status === "sending" ? "Updating…" : status.verifier_opted_in ? "Stop new assignments" : "Volunteer to verify"}
          </Button>
          {volunteerAction.outcome.status === "error" && <p role="alert" className="text-ui text-destructive">{volunteerAction.outcome.message}</p>}
          <OfflineActionButton address={address} rpcUrl={rpcUrl} request={{kind:"participation",enabled:!status.verifier_opted_in}} disabled={loading || (!reviewsAvailable && !status.verifier_opted_in) || volunteerAction.outcome.status === "sending"} />
        </> : <p role="status" className="text-ui text-muted-foreground">Your node hasn’t reported verifier participation. Update the node before changing it.</p>}
      </section>}

      <VerificationVotePanel key={JSON.stringify(["vote", rpcUrl, address])} rpcUrl={rpcUrl} address={address} disabled={!canParticipate} />

      {canParticipate && <details className="rounded-lg border p-4">
        <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 text-ui">Vouch for someone<ChevronDown aria-hidden="true" className="size-4" /></summary>
      <Card className="mt-3 border-0 bg-transparent shadow-none">
        <CardHeader className="p-0 pb-4">
          <CardTitle className="flex items-center gap-2 text-heading">
            <UserCheck className="h-4 w-4 text-purple-400" />
            Endorse a person
          </CardTitle>
          <CardDescription>
            Vouch for another person's humanity by permanently burning your BRN.
          </CardDescription>
          {!reviewsAvailable && <p className="text-ui text-muted-foreground">Endorsements can be recorded, but cannot complete verification on this node yet.</p>}
        </CardHeader>
        <CardContent className="p-0"><form className="space-y-4" onSubmit={event => {
            event.preventDefault();
            if (!endorseTarget.startsWith("brst_")) { toast.error("Enter a BURST address starting with brst_"); return; }
            try { parseAmount(endorseAmount); } catch (error) { toast.error(String(error)); return; }
            reviewContext.current = { rpcUrl, address };
            endorseAction.clear();
            setEndorseConfirm(true);
          }}>
          <div className="flex items-start gap-3 rounded-lg border border-warning/30 bg-warning/5 p-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <p className="text-caption text-muted-foreground">
              Endorsements permanently spend your BRN. You cannot get it back, even if verification fails. Only vouch for a real person who does not already have another verified wallet.
            </p>
          </div>
          <div className="space-y-2">
            <label htmlFor="endorse-address" className="text-sm font-normal">Their wallet address</label>
            <Input
              className="font-mono"
              placeholder="brst_..."
              id="endorse-address"
              value={endorseTarget}
              onChange={(e) => setEndorseTarget(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="endorse-amount" className="text-sm font-normal">BRN to spend permanently</label>
            <Input
              className="font-mono"
              type="text"
              inputMode="decimal"
              placeholder="0.000000"
              id="endorse-amount"
              value={endorseAmount}
              onChange={(e) => setEndorseAmount(e.target.value)}
            />
          </div>
          <Button
            className="w-full"
            variant="secondary"
            ref={endorseTrigger}
            type="submit"
            disabled={["sending", "confirmed", "uncertain"].includes(endorseAction.outcome.status)}
          >
            <UserCheck className="h-4 w-4" />
            Endorse
          </Button>
        </form>
        </CardContent>
      </Card>
      </details>}

      {canParticipate && <details className="rounded-lg border p-4">
        <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 text-ui">Report a wallet<ChevronDown aria-hidden="true" className="size-4" /></summary>
      {!canChallenge ? <p className="mt-3 text-ui text-muted-foreground">Re-verification is unavailable on this node. No BRN will be staked.</p> :
      <Card className="mt-3 border-0 bg-transparent shadow-none">
        <CardHeader className="p-0 pb-4">
          <CardTitle className="flex items-center gap-2 text-heading">
            <Swords className="h-4 w-4 text-destructive" />
            Request re-verification
          </CardTitle>
          <CardDescription>
            Stake BRN to request re-verification for fraud or prolonged inactivity.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0"><form className="space-y-4" onSubmit={event => {
            event.preventDefault();
            if (!canChallenge) return;
            if (!challengeTarget.startsWith("brst_")) { toast.error("Enter a BURST address starting with brst_"); return; }
            try { parseAmount(challengeStake); } catch (error) { toast.error(String(error)); return; }
            reviewContext.current = { rpcUrl, address };
            challengeAction.clear();
            setChallengeConfirm(true);
          }}>
          <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/50 p-3">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <p className="text-caption text-muted-foreground">
              Fraud confirmed: TRST originating from that wallet is revoked through its provenance.
              Inactivity confirmed: accrual and transaction rights stop, but legitimately earned TRST is not revoked.
              If it fails, <span className="font-normal text-destructive">you lose your staked BRN</span>.
            </p>
          </div>
          <div className="space-y-2">
            <label htmlFor="challenge-address" className="text-sm font-normal">Wallet address</label>
            <Input
              className="font-mono"
              placeholder="brst_..."
              id="challenge-address"
              value={challengeTarget}
              onChange={(e) => setChallengeTarget(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="challenge-reason" className="text-sm font-normal">Reason for re-verification</label>
            <select id="challenge-reason" value={challengeReason} onChange={(e) => setChallengeReason(e.target.value)} className="form-control min-h-11 px-3 py-2 text-base">
              <option value="fraud">Fraud — not a unique human</option>
              <option value="inactivity">Death or prolonged inactivity — no TRST revocation</option>
            </select>
            <label htmlFor="challenge-stake" className="text-sm font-normal">BRN to put at risk</label>
            <Input
              className="font-mono"
              type="text"
              inputMode="decimal"
              placeholder="0.000000"
              id="challenge-stake"
              value={challengeStake}
              onChange={(e) => setChallengeStake(e.target.value)}
            />
          </div>
          <Button
            className="w-full"
            variant="destructive"
            ref={challengeTrigger}
            type="submit"
            disabled={["sending", "confirmed", "uncertain"].includes(challengeAction.outcome.status)}
          >
            <Swords className="h-4 w-4" />
            Challenge
          </Button>
        </form>
        </CardContent>
      </Card>
      }
      </details>}

      <AppealPanel key={JSON.stringify(["appeal", rpcUrl, address])} rpcUrl={rpcUrl} address={address} canSponsor={canParticipate} />

      <Dialog open={endorseConfirm} onOpenChange={open => { if (!endorsing) setEndorseConfirm(open); }}>
        <DialogContent onCloseAutoFocus={event => { event.preventDefault(); const target = endorseTrigger.current; if (target && !target.disabled) target.focus(); else (document.querySelector<HTMLElement>("[data-transaction-receipt]") ?? document.getElementById("main-content"))?.focus(); }}>
          <DialogHeader>
            <DialogTitle className="text-warning">Confirm Endorsement</DialogTitle>
            <DialogDescription>
              This action is irreversible. Your BRN will be permanently burned.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 rounded-md bg-warning/5 p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">BRN to burn (forever)</span>
              <span className="font-mono font-normal text-warning">{endorseAmount} BRN</span>
            </div>
            <div>
              <span className="text-caption text-muted-foreground">Endorsing</span>
              <p className="break-all font-mono text-caption">{endorseTarget}</p>
            </div>
          </div>
          {!reviewsAvailable && <p className="text-ui text-muted-foreground">This endorsement spends BRN permanently. Identity reviews cannot finish on this node yet.</p>}
          {!canParticipate && !endorsing && <p role="alert" className="text-ui text-muted-foreground">Your wallet must be verified before you can endorse someone. Check your verification status before continuing.</p>}
          {endorseAction.outcome.status === "error" && <p role="alert" className="text-ui text-destructive break-words">{endorseAction.outcome.message}</p>}
          <DialogFooter>
            <OfflineActionButton address={address} rpcUrl={rpcUrl} request={{kind:"endorse",target:endorseTarget.trim(),amount:endorseConfirm ? parseAmount(endorseAmount) : "0"}} disabled={endorsing || !canParticipate} />
            <Button variant="outline" onClick={() => setEndorseConfirm(false)} disabled={endorsing}>
              Cancel
            </Button>
            <Button variant="default" onClick={handleEndorse} disabled={endorsing || !canParticipate}>
              {endorsing && <Loader2 className="animate-spin" />}
              Burn & Endorse
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={challengeConfirm} onOpenChange={open => { if (!challenging) setChallengeConfirm(open); }}>
        <DialogContent onCloseAutoFocus={event => { event.preventDefault(); const target = challengeTrigger.current; if (target && !target.disabled) target.focus(); else (document.querySelector<HTMLElement>("[data-transaction-receipt]") ?? document.getElementById("main-content"))?.focus(); }}>
          <DialogHeader>
            <DialogTitle className="text-destructive">Confirm Challenge</DialogTitle>
            <DialogDescription>
              If the challenge fails, you will lose your staked BRN.
            </DialogDescription>
          </DialogHeader>
          {!canChallenge && !challenging && <p role="alert" className="text-ui text-muted-foreground">Re-verification is unavailable. No BRN will be staked.</p>}
          <div className="space-y-3 rounded-md bg-destructive/5 p-4">
            <p className="text-ui">{challengeReason === "fraud" ? "Fraud review. If confirmed, TRST originating from this wallet is revoked." : "Inactivity review. If confirmed, wallet access stops, but legitimate TRST is not revoked."}</p>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">BRN at risk</span>
              <span className="font-mono font-normal text-destructive">{challengeStake} BRN</span>
            </div>
            <div>
              <span className="text-caption text-muted-foreground">Challenging</span>
              <p className="break-all font-mono text-caption">{challengeTarget}</p>
            </div>
          </div>
          {challengeAction.outcome.status === "error" && <p role="alert" className="text-ui text-destructive break-words">{challengeAction.outcome.message}</p>}
          <DialogFooter>
            <OfflineActionButton address={address} rpcUrl={rpcUrl} request={{kind:"challenge",target:challengeTarget.trim(),stake:challengeConfirm ? parseAmount(challengeStake) : "0",reason:challengeReason}} disabled={challenging || !canParticipate} />
            <Button variant="outline" onClick={() => setChallengeConfirm(false)} disabled={challenging}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleChallenge} disabled={challenging || !canChallenge}>
              {challenging && <Loader2 className="animate-spin" />}
              Submit Challenge
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
