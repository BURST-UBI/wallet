import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ArrowLeft, ArrowUpRight, ChevronDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useWallet, useRpc } from "@/hooks/use-wallet";
import { useWalletStore } from "@/stores/wallet-store";
import { governanceParameterLabel, governancePhaseLabel, governanceTitle, governanceValue } from "@/lib/governance";
import { formatAmount } from "@/lib/utils";
import { amendmentReadable, validOperations } from "@/lib/constitution";
import { AmendmentReview } from "@/components/amendment-review";
import { ConstitutionEditor } from "@/components/constitution-editor";
import { ParameterEditor } from "@/components/parameter-editor";
import { ScopedDelegation } from "@/components/scoped-delegation";
import { OfflineActionButton } from "@/components/offline-action-button";
import type { AccountInfo, BlockResult, ConstitutionContext, Proposal, ProposalList } from "@/lib/types";

const choices = { yea: "Support", nay: "Oppose", abstain: "Abstain" } as const;
type Choice = keyof typeof choices;
type Review = { kind: "vote"; proposal: Proposal; choice: Choice }
  | {kind:"endorse";proposal:Proposal;revision:string;cost:string}
  | {kind:"withdraw";proposal:Proposal;revision:string};
function withdrawalOpen(proposal: Proposal, address: string | null) {
  return address !== null && proposal.proposer === address && proposal.phase === "Proposal" &&
    !!proposal.phase_deadline && proposal.phase_deadline > Date.now() / 1000;
}
function votingOpen(proposal: Proposal) {
  return proposal.phase === "Exploration" &&
    !!proposal.phase_deadline && proposal.phase_deadline > Date.now() / 1000;
}

export default function GovernancePage() {
  const { rpcUrl, address } = useWallet();
  const [pages, setPages] = useState<(string | undefined)[]>([undefined]);
  const [selected, setSelected] = useState<string | null>(null);
  const [lookup, setLookup] = useState("");
  const [lookupError, setLookupError] = useState("");
  const [review, setReview] = useState<Review | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const pending = useRef(false);
  const trigger = useRef<HTMLElement | null>(null);
  const context = useRef({rpcUrl, address});
  const proposals = useRpc<ProposalList>("get_governance_proposals", {rpcUrl, cursor:pages[pages.length - 1]}, 15_000);
  const detail = useRpc<Proposal>("get_governance_proposal_info", selected ? {rpcUrl, hash:selected} : null, 15_000);
  const account = useRpc<AccountInfo>("get_account_info", {rpcUrl,expectedAccount:address}, 10_000);
  const constitution = useRpc<ConstitutionContext>("get_constitution_context", {rpcUrl,expectedAccount:address}, 30_000);
  const canParticipate = !account.error && ["verified", "challenged"].includes(account.data?.verification_state.toLowerCase() ?? "");
  const proposal = detail.data?.hash === selected ? detail.data : null;
  const view = useRef<HTMLElement>(null);
  useEffect(() => { view.current?.focus({preventScroll:true}); }, [selected]);

  useEffect(() => {
    setPages([undefined]); setSelected(null);
    if (!pending.current) { setReview(null); setActionError(""); }
  }, [rpcUrl, address]);

  function openReview(next: Review) {
    trigger.current = document.activeElement as HTMLElement;
    context.current = {rpcUrl, address};
    setActionError(""); setReview(next);
  }
  async function confirm() {
    if (!review || pending.current) return;
    const current = useWalletStore.getState();
    if (current.rpcUrl !== context.current.rpcUrl || current.address !== context.current.address || current.isLocked) {
      setActionError("Your wallet or connection changed. Close this review and start again."); return;
    }
    pending.current = true; setBusy(true); setActionError("");
    try {
      {
        const latest = await invoke<Proposal>("get_governance_proposal_info", {rpcUrl, hash:review.proposal.hash});
        if (latest.hash !== review.proposal.hash || latest.phase !== review.proposal.phase || (review.kind === "vote" && !votingOpen(latest)) || (review.kind === "withdraw" && !withdrawalOpen(latest, address))) {
          throw new Error("This proposal changed or the action is no longer available. Close this review and refresh its status.");
        }
        if (review.kind !== "withdraw" && (!amendmentReadable(latest) || JSON.stringify(latest.amendment_operations) !== JSON.stringify(review.proposal.amendment_operations) || latest.amendment_text !== review.proposal.amendment_text)) throw new Error("The amendment content changed or is incomplete. Read the proposal again.");
      }
      const signingWallet = useWalletStore.getState();
      if (signingWallet.isLocked || signingWallet.rpcUrl !== context.current.rpcUrl || signingWallet.address !== context.current.address) {
        throw new Error("Your wallet or connection changed. Close this review and start again.");
      }
      const result = review.kind === "vote"
        ? await invoke<BlockResult>("vote_proposal", {rpcUrl,expectedAccount:address,proposal:review.proposal.hash,vote:review.choice})
        : await invoke<BlockResult>(review.kind === "withdraw" ? "withdraw_governance_proposal" : "endorse_governance_proposal", {rpcUrl,expectedAccount:address,proposal:review.proposal.hash,expectedRevision:review.revision});
      if (!result.accepted) throw new Error(result.detail ?? "The network did not accept this action.");
      toast.success(review.kind === "vote" ? "Vote recorded" : review.kind === "withdraw" ? "Proposal withdrawn" : "Endorsement recorded");
      if (review.kind === "withdraw") trigger.current = view.current;
      setReview(null);
      detail.refetch(); proposals.refetch();
    } catch (error) { setActionError(String(error)); }
    finally { pending.current = false; setBusy(false); }
  }

  return <div className="mx-auto max-w-3xl space-y-6">
    <div className="page-heading"><div><h1>Your voice</h1><p>One verified person, one vote. Your balance does not change your vote.</p></div></div>
    {!canParticipate && <p role="status" className="rounded-lg bg-muted p-4 text-ui">{account.error ? "Verification status is unavailable. You can read proposals, but cannot submit an action right now." : account.loading && !account.data ? "Checking your verification…" : "You can read proposals. Verification is required to vote or delegate."}</p>}

    {selected ? <section ref={view} tabIndex={-1} aria-label="Proposal" className="space-y-4">
      <Button variant="ghost" onClick={() => setSelected(null)}><ArrowLeft />All proposals</Button>
      {detail.error ? <div role="alert" className="balance-panel"><h2>Proposal unavailable</h2><p className="break-words text-caption text-muted-foreground">{detail.error}</p><Button variant="outline" onClick={detail.refetch}>Try again</Button></div>
        : !proposal ? <Skeleton className="h-64 w-full" />
        : <article className="balance-panel">
          <div className="space-y-3"><p className="text-caption text-muted-foreground">{governancePhaseLabel(proposal)}</p><h2 className="break-words text-heading">{governanceTitle(proposal)}</h2></div>
          {proposal.param && proposal.param !== "constitution" && <dl className="space-y-3 text-ui"><div><dt className="text-muted-foreground">Proposed change</dt><dd className="mt-1 break-words">{governanceParameterLabel(proposal.param)} · {governanceValue(proposal)}</dd></div></dl>}
          {proposal.amendment_text && <div className="whitespace-pre-wrap break-words text-ui">{proposal.amendment_text}</div>}
          {validOperations(proposal.amendment_operations) && <AmendmentReview operations={proposal.amendment_operations} document={constitution.data?.document} />}
          {!amendmentReadable(proposal) && <p role="alert" className="text-warning text-ui">This node has not provided the complete amendment text or changes. Voting is unavailable until you can read the full proposal.</p>}
          {proposal.phase === "Conflicted" && !proposal.phase_projected && <p role="alert" className="text-warning text-ui">A referenced article is missing or repealed. None of this amendment’s changes were applied.</p>}
          {proposal.phase_projected && <p role="status" className="text-caption text-muted-foreground">Phase and vote counts are provisional until the network confirms them.</p>}
          <dl className="grid grid-cols-3 gap-3 text-ui">{[["Support",proposal.votes_yea],["Oppose",proposal.votes_nay],["Abstain",proposal.votes_abstain]].map(([label,value]) => <div key={label}><dt className="text-caption text-muted-foreground">{label}</dt><dd className="mt-1 tabular-nums">{value ?? "—"}</dd></div>)}</dl>
          <p className="text-caption text-muted-foreground">{proposal.phase_deadline ? "This phase ends " + new Date(proposal.phase_deadline * 1000).toLocaleString() : "No deadline provided for this phase."}</p>
          {votingOpen(proposal) ? <div className="flex flex-wrap gap-2">{(Object.keys(choices) as Choice[]).map(choice => <Button key={choice} variant="outline" disabled={!canParticipate || !!detail.error || !amendmentReadable(proposal)} onClick={() => openReview({kind:"vote",proposal,choice})}>{choices[choice]}</Button>)}</div>
            : proposal.phase === "Proposal" ? <Button variant="outline" disabled={!canParticipate || !amendmentReadable(proposal) || !constitution.data || !!constitution.error} onClick={() => {if(constitution.data) openReview({kind:"endorse",proposal,revision:constitution.data.revision,cost:constitution.data.endorsement_cost});}}>Endorse proposal</Button>
            : <p className="text-ui text-muted-foreground">Voting is not open for this proposal.</p>}
          <details className="balance-details"><summary className="text-caption text-muted-foreground">Proposal details<ChevronDown aria-hidden className="size-4" /></summary><dl className="space-y-3 text-caption"><div><dt>Proposal ID</dt><dd className="break-all select-text font-mono">{proposal.hash}</dd></div><div><dt>Proposed by</dt><dd className="break-all select-text font-mono">{proposal.proposer}</dd></div><div><dt>Network phase</dt><dd>{proposal.phase}</dd></div></dl></details>
          {withdrawalOpen(proposal, address) && <div className="border-t pt-3"><Button variant="ghost" disabled={!constitution.data || !!constitution.error} onClick={() => {if (constitution.data) openReview({kind:"withdraw",proposal,revision:constitution.data.revision});}}>Withdraw proposal</Button></div>}
        </article>}
    </section> : <section ref={view} tabIndex={-1} aria-label="Community proposals" className="space-y-4">
      <div className="section-heading"><h2>Community proposals</h2><Button variant="ghost" onClick={proposals.refetch} disabled={proposals.loading}>Refresh</Button></div>
      {proposals.error ? <div role="alert" className="balance-panel"><p>Proposals unavailable</p><p className="text-caption break-words text-muted-foreground">{proposals.error}</p><Button variant="outline" onClick={proposals.refetch}>Try again</Button></div>
        : !proposals.data ? <div className="space-y-3"><Skeleton className="h-24" /><Skeleton className="h-24" /></div>
        : proposals.data.proposals.length === 0 ? <div className="empty-state"><div><p>No proposals on this page</p><p>Community decisions will appear here when proposed.</p></div></div>
        : <div className="divide-y rounded-lg border px-4">{proposals.data.proposals.map(item => <div key={item.hash} className="flex flex-wrap items-center justify-between gap-3 py-4"><div className="min-w-0 flex-1"><p className="text-caption text-muted-foreground">{governancePhaseLabel(item)}</p><p className="mt-1 break-words text-ui">{governanceTitle(item)}</p></div><Button variant="ghost" aria-label={"Read proposal: " + governanceTitle(item)} onClick={() => setSelected(item.hash)}>Read <ArrowUpRight /></Button></div>)}</div>}
      <div className="flex justify-between gap-3">{pages.length > 1 ? <Button variant="outline" onClick={() => setPages(previous => previous.slice(0,-1))}>Previous</Button> : <span />}{proposals.data?.cursor && !proposals.error && <Button variant="outline" onClick={() => setPages(previous => [...previous,proposals.data!.cursor])}>Next</Button>}</div>
      <details className="rounded-lg border p-4"><summary className="flex min-h-11 cursor-pointer items-center justify-between text-ui">Find a proposal by ID<ChevronDown aria-hidden className="size-4" /></summary>
        <form className="mt-3 space-y-3" onSubmit={event => { event.preventDefault(); if (!/^[a-fA-F0-9]{64}$/.test(lookup.trim())) { setLookupError("Enter the full 64-character proposal ID."); return; } setLookupError(""); setSelected(lookup.trim()); }}>
          <label htmlFor="proposal-hash" className="text-ui">Proposal ID</label><Input id="proposal-hash" value={lookup} onChange={event => {setLookup(event.target.value);setLookupError("");}} aria-invalid={!!lookupError} aria-describedby={lookupError ? "proposal-error" : undefined} spellCheck={false} className="font-mono" />
          {lookupError && <p id="proposal-error" role="alert" className="text-caption text-destructive">{lookupError}</p>}<Button variant="outline" type="submit">Read proposal</Button>
        </form>
      </details>
    </section>}

    <ScopedDelegation key={`${rpcUrl}-${address}`} proposal={proposal} canParticipate={canParticipate} />
    <ParameterEditor key={`parameters-${rpcUrl}-${address}`} context={constitution.data} error={constitution.error} canParticipate={canParticipate} onSubmitted={hash => {setSelected(hash);proposals.refetch();constitution.refetch();}} />
    <ConstitutionEditor key={`constitution-${rpcUrl}-${address}`} context={constitution.data} error={constitution.error} canParticipate={canParticipate} onSubmitted={hash => {setSelected(hash);proposals.refetch();constitution.refetch();}} />

    <Dialog open={!!review} onOpenChange={open => {if (!open && !pending.current) setReview(null);}}>
      <DialogContent onCloseAutoFocus={event => {event.preventDefault();if (trigger.current?.isConnected) trigger.current.focus();else view.current?.focus({preventScroll:true});}}>
        <DialogHeader><DialogTitle>{review?.kind === "withdraw" ? "Withdraw this proposal?" : review?.kind === "endorse" ? "Endorse this proposal?" : "Review your vote"}</DialogTitle><DialogDescription>{review?.kind === "withdraw" ? "This ends the proposal and cannot be undone. BRN already burned by endorsers is not refunded." : review?.kind === "endorse" ? "Endorsement permanently burns BRN to help this proposal reach voting. It does not cast your vote." : "Your vote is public and will be signed by this wallet."}</DialogDescription></DialogHeader>
        {review?.kind === "vote" && <div className="space-y-3"><p className="break-words text-ui">{governanceTitle(review.proposal)}</p><p className="text-heading">{choices[review.choice]}</p><p className="text-caption text-muted-foreground">{governancePhaseLabel(review.proposal)}</p></div>}
        {review?.kind === "endorse" && <div className="space-y-3"><p>{governanceTitle(review.proposal)}</p><p className="text-heading">Burn {formatAmount(review.cost,18).replace(/0+$/,"").replace(/\.$/,"")} BRN</p></div>}
        {review?.kind === "withdraw" && <p className="break-words text-ui">{governanceTitle(review.proposal)}</p>}
        {review && review.kind !== "withdraw" && validOperations(review.proposal.amendment_operations) && <AmendmentReview operations={review.proposal.amendment_operations} />}
        {actionError && <p role="alert" className="break-words text-ui text-destructive">{actionError}</p>}
        <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setReview(null)}>Cancel</Button>
          {review && <OfflineActionButton address={address} rpcUrl={rpcUrl} disabled={busy || !!actionError} request={review.kind === "vote" ? {kind:"vote",proposal:review.proposal.hash,vote:review.choice} : review.kind === "endorse" ? {kind:"endorse_proposal",proposal:review.proposal.hash,amount:review.cost} : {kind:"withdraw",proposal:review.proposal.hash}} />}
          <Button variant={review?.kind === "withdraw" ? "destructive" : "default"} disabled={busy || !!actionError} onClick={confirm}>{busy && <Loader2 className="animate-spin" />}{busy ? "Submitting…" : review?.kind === "withdraw" ? "Withdraw proposal" : review?.kind === "endorse" ? "Burn BRN and endorse" : "Confirm vote"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}
