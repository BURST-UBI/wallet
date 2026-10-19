import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useRpc, useWallet } from "@/hooks/use-wallet";
import { useWalletStore } from "@/stores/wallet-store";
import type { BlockResult, Proposal } from "@/lib/types";
import { governanceTitle } from "@/lib/governance";
import { amendmentReadable, validOperations } from "@/lib/constitution";
import { AmendmentReview } from "@/components/amendment-review";
import { OfflineActionButton } from "@/components/offline-action-button";

type Scope = {kind: "parameter" | "proposal"; value: string};
type Entry = {owner: string; scope: Scope; generation: string; delegate: string | null; grant_block: string | null; confirmed: boolean};
type Page = {enabled: boolean; network: string; genesis: string; entries: Entry[]; cursor: string | null; parameters: string[]};
type Choice = "yea" | "nay" | "abstain";
type Review = {kind: "set"; scope: Scope; generation: string; genesis: string; delegate: string | null} | {kind: "vote"; entry: Entry; proposal: Proposal; choice: Choice};
const choices: Record<Choice, string> = {yea: "Support", nay: "Oppose", abstain: "Abstain"};
const parameterLabel = (name: string) => name.replace(/_/g, " ").replace(/\bbrn\b/g, "BRN").replace(/\btrst\b/g, "TRST").replace(/ secs$/, " (seconds)").replace(/ bps$/, " (basis points)");
const label = (scope: Scope) => scope.kind === "parameter" ? parameterLabel(scope.value) : `Proposal ${scope.value.slice(0, 8)}…`;
const short = (address: string) => `${address.slice(0, 12)}…${address.slice(-6)}`;
const open = (proposal: Proposal) => proposal.phase === "Exploration" && !!proposal.phase_deadline && proposal.phase_deadline > Date.now() / 1000;
const selectStyle = "min-h-11 w-full rounded-md border bg-background px-3 text-base focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2";

export function ScopedDelegation({proposal, canParticipate}: {proposal: Proposal | null; canParticipate: boolean}) {
  const {rpcUrl, address} = useWallet();
  const [scope, setScope] = useState<Scope>({kind: "parameter", value: "brn_rate"});
  const [delegate, setDelegate] = useState("");
  const [incoming, setIncoming] = useState(false);
  const [pages, setPages] = useState<(string | undefined)[]>([undefined]);
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState("");
  const [fieldError, setFieldError] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const trigger = useRef<HTMLElement | null>(null);
  const context = useRef({rpcUrl, address});
  const list = useRpc<Page>("get_scoped_delegations", {rpcUrl, incoming, cursor: pages[pages.length - 1]}, 15_000);
  const validScope = scope.kind === "parameter" ? !!scope.value : /^[a-f0-9]{64}$/i.test(scope.value) && !/^0+$/.test(scope.value);
  const current = useRpc<Page>("get_scoped_delegations", validScope ? {rpcUrl, incoming: false, scope} : null, 15_000);
  const entry = current.data?.entries[0];
  const available = list.data?.enabled === true && !list.error;
  const editable = available && !current.error && !!current.data && current.data.enabled && (!entry || entry.confirmed);

  useEffect(() => {setPages([undefined]); if (!pending.current) {setReview(null); setError("");}}, [rpcUrl, address, incoming]);
  function begin(next: Review) {
    trigger.current = document.activeElement as HTMLElement;
    context.current = {rpcUrl, address};
    setError(""); setReview(next);
  }
  function unchanged() {
    const wallet = useWalletStore.getState();
    if (wallet.isLocked || wallet.address !== context.current.address || wallet.rpcUrl !== context.current.rpcUrl) throw new Error("Your wallet or connection changed. Close this review and start again.");
  }
  function reviewScope(delegate: string | null) {
    if (!editable || !current.data) return;
    begin({kind:"set",scope:{...scope},generation:entry?.generation ?? "0",genesis:current.data.genesis,delegate});
  }
  async function confirm() {
    if (!review || pending.current) return;
    pending.current = true; setBusy(true); setError("");
    try {
      unchanged();
      if (review.kind === "vote") {
        const latest = await invoke<Proposal>("get_governance_proposal_info", {rpcUrl, hash:review.proposal.hash});
        if (latest.hash !== review.proposal.hash || !open(latest)) throw new Error("Voting changed or closed. Read the proposal again.");
        if (!amendmentReadable(latest) || JSON.stringify(latest.amendment_operations) !== JSON.stringify(review.proposal.amendment_operations) || latest.amendment_text !== review.proposal.amendment_text) throw new Error("The amendment content changed or is incomplete. Read it again.");
      }
      unchanged();
      const result = review.kind === "set"
        ? await invoke<BlockResult>("set_scoped_delegation", {rpcUrl, expectedAccount: address, expectedGenesis: review.genesis, scope: review.scope, generation: review.generation, delegate: review.delegate})
        : await invoke<BlockResult>("vote_with_delegation", {rpcUrl, expectedAccount: address, entry: review.entry, proposal: review.proposal.hash, vote: review.choice});
      if (!result.accepted) throw new Error(result.detail ?? "The network did not accept this action.");
      toast.success(review.kind === "vote" ? "Delegated ballot recorded" : review.delegate ? "Delegation updated" : "Delegation revoked");
      setReview(null); setDelegate(""); list.refetch(); current.refetch();
    } catch (cause) {setError(String(cause));}
    finally {pending.current = false; setBusy(false);}
  }

  return <section className="space-y-4" aria-label="Voting delegation">
    <div><h2 className="text-heading">Voting delegation</h2><p className="text-caption text-muted-foreground">Choose who votes for you, and on what. They cannot spend your funds.</p></div>
    {list.error ? <div role="alert"><p className="text-ui">Delegation is unavailable.</p><p className="text-caption text-muted-foreground break-words">{list.error}</p><Button variant="outline" onClick={list.refetch}>Try again</Button></div>
      : !list.data ? <p role="status" className="text-caption text-muted-foreground">Loading delegation…</p>
      : !available ? <p role="status" className="text-caption text-muted-foreground">Scoped delegation is not enabled on this node yet.</p> : <>
      <div className="flex gap-2" role="group" aria-label="Delegation direction"><Button variant={!incoming ? "secondary" : "ghost"} aria-pressed={!incoming} onClick={() => setIncoming(false)}>Your delegates</Button><Button variant={incoming ? "secondary" : "ghost"} aria-pressed={incoming} onClick={() => setIncoming(true)}>Delegated to you</Button></div>
      {!list.data.entries.length && <p className="text-caption text-muted-foreground">{incoming ? "No active grants on this page." : "No delegation choices on this page."}</p>}
      <div className="divide-y">{list.data.entries.map(item => {
        const compatible = proposal && (item.scope.kind === "proposal" ? item.scope.value === proposal.hash : item.scope.value === proposal.param?.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase());
        const canVote = incoming && canParticipate && item.confirmed && proposal && open(proposal) && compatible && amendmentReadable(proposal);
        return <div className="flex flex-wrap items-center justify-between gap-3 py-3" key={`${item.owner}-${item.scope.kind}-${item.scope.value}`}>
          <div className="min-w-0"><p className="text-ui break-words">{label(item.scope)}</p><p className="text-caption text-muted-foreground">{!item.confirmed ? "Awaiting confirmation" : incoming ? short(item.owner) : item.delegate ? short(item.delegate) : "Revoked"}</p></div>
          {incoming ? <div className="flex flex-wrap gap-2">{canVote ? (Object.keys(choices) as Choice[]).map(choice => <Button key={choice} variant="outline" onClick={() => begin({kind:"vote",entry:item,proposal,choice})}>{choices[choice]}</Button>) : <p className="text-caption text-muted-foreground">Read a matching open proposal to vote.</p>}</div>
          : <Button variant="ghost" onClick={() => {setScope(item.scope);setFieldError("");}}>Manage<span className="sr-only"> {label(item.scope)}</span></Button>}
        </div>;
      })}</div>
      {(pages.length > 1 || list.data.cursor) && <div className="flex justify-between gap-3">{pages.length > 1 ? <Button variant="outline" onClick={() => setPages(value => value.slice(0,-1))}>Previous</Button> : <span />}{list.data.cursor && <Button variant="outline" onClick={() => setPages(value => [...value,list.data!.cursor!])}>Next</Button>}</div>}
      {!incoming && <form className="space-y-4 border-t pt-4" onSubmit={event => {event.preventDefault();if (!editable || !canParticipate) return;if (!/^brst_[13456789abcdefghijkmnopqrstuwxyz]{60}$/.test(delegate.trim()) || delegate.trim() === address) {setFieldError("Enter another person’s complete BURST address.");return;}setFieldError("");reviewScope(delegate.trim());}}>
        <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-2"><label htmlFor="delegation-kind" className="text-ui">Delegate for</label><select id="delegation-kind" className={selectStyle} value={scope.kind} onChange={event => setScope(event.target.value === "parameter" ? {kind:"parameter",value:"brn_rate"} : {kind:"proposal",value:proposal?.hash ?? ""})}><option value="parameter">A parameter</option><option value="proposal">One proposal</option></select></div>
        <div className="space-y-2"><label htmlFor="delegation-scope" className="text-ui">{scope.kind === "parameter" ? "Parameter" : "Proposal ID"}</label>{scope.kind === "parameter" ? <select id="delegation-scope" className={selectStyle} value={scope.value} onChange={event => setScope({...scope,value:event.target.value})}>{list.data.parameters.map(name => <option key={name} value={name}>{parameterLabel(name)}</option>)}</select> : <Input id="delegation-scope" className="font-mono" value={scope.value} onChange={event => setScope({...scope,value:event.target.value.trim().toLowerCase()})} spellCheck={false} autoComplete="off" />}</div></div>
        {current.error && <p role="alert" className="text-caption text-destructive">{current.error}</p>}
        {entry?.delegate && <p className="text-caption text-muted-foreground break-all">Current delegate: {entry.delegate}</p>}
        <div className="space-y-2"><label htmlFor="delegate-address" className="text-ui">Delegate’s address</label><Input id="delegate-address" value={delegate} onChange={event => {setDelegate(event.target.value);setFieldError("");}} className="font-mono" autoComplete="off" spellCheck={false} aria-invalid={!!fieldError} aria-describedby={fieldError ? "delegate-error" : undefined} />{fieldError && <p id="delegate-error" role="alert" className="text-caption text-destructive">{fieldError}</p>}</div>
        <div className="flex flex-wrap gap-3"><Button variant="outline" type="submit" disabled={!editable || !canParticipate}>Review delegation</Button><Button type="button" variant="ghost" disabled={!editable} onClick={() => reviewScope(null)}>Revoke for this scope</Button></div>
        <details className="text-caption text-muted-foreground"><summary className="min-h-11 cursor-pointer py-3">How scopes work</summary><p>A proposal-specific choice overrides its parameter delegate, including revocation. Revocation does not change a result already counted.</p></details>
      </form>}
    </>}
    <Dialog open={!!review} onOpenChange={value => {if (!value && !pending.current) setReview(null);}}><DialogContent onCloseAutoFocus={event => {event.preventDefault();if (trigger.current?.isConnected) trigger.current.focus();}}>
      <DialogHeader><DialogTitle>{review?.kind === "vote" ? "Review delegated ballot" : review?.delegate ? "Review delegation" : "Revoke delegation?"}</DialogTitle><DialogDescription>{review?.kind === "vote" ? "This public ballot counts only while the grant remains effective at counting." : "Only this scope changes. Your primary key and funds stay with you."}</DialogDescription></DialogHeader>
      {review?.kind === "set" ? <div className="space-y-2"><p>{label(review.scope)}</p><p className="break-all text-caption">{review.scope.value}</p>{review.delegate && <p className="break-all text-caption">{review.delegate}</p>}</div> : review && <div className="space-y-2"><p>{governanceTitle(review.proposal)}</p><p className="text-heading">{choices[review.choice]}</p><p className="break-all text-caption">For {review.entry.owner}</p></div>}
      {error && <p role="alert" className="text-caption text-destructive break-words">{error}</p>}
      {review?.kind === "vote" && validOperations(review.proposal.amendment_operations) && <AmendmentReview operations={review.proposal.amendment_operations} />}
      <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setReview(null)}>Cancel</Button>
        {review && <OfflineActionButton address={address} rpcUrl={rpcUrl} request={review.kind === "set" ? {kind:"delegation",scope:review.scope,delegate:review.delegate,generation:review.generation,genesis:review.genesis} : {kind:"delegated_vote",entry:review.entry,proposal:review.proposal.hash,vote:review.choice}} disabled={busy || !!error} />}
        <Button disabled={busy || !!error} onClick={confirm}>{busy ? "Submitting…" : "Confirm"}</Button></DialogFooter>
    </DialogContent></Dialog>
  </section>;
}
