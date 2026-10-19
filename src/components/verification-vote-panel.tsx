import { useEffect, useRef, useState } from "react";
import { useRpc } from "@/hooks/use-wallet";
import { useTransaction } from "@/hooks/use-transaction";
import { TransactionReceipt } from "@/components/transaction-receipt";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatAmount } from "@/lib/utils";
import { OfflineActionButton } from "@/components/offline-action-button";

interface Review {
  target: string;
  selection_context: string | null;
  phase: string | null;
  enabled: boolean;
  selected: boolean;
  voted: boolean;
  stake: string;
  params_hash: string;
}

const choices = ["Legitimate", "Illegitimate", "Neither"];

export function VerificationVotePanel({ rpcUrl, address, disabled }: { rpcUrl: string; address: string | null; disabled: boolean }) {
  const [target, setTarget] = useState("");
  const [query, setQuery] = useState<string | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);
  const [choice, setChoice] = useState<number | null>(null);
  const [reviewed, setReviewed] = useState<{ report: Review; vote: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDetailsElement>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const assignments = useRpc<{ targets: string[]; cursor: string | null }>("get_verifier_assignments", disabled ? null : { rpcUrl, cursor }, 30_000);
  const context = useRef({ rpcUrl, address });
  const action = useTransaction(rpcUrl, address, "cast_verification_vote");
  const result = useRpc<Review>("get_verification_review", !disabled && query ? { rpcUrl, target: query } : null);
  useEffect(() => {
    if (disabled) { setReviewed(null); setQuery(null); setChoice(null); }
  }, [disabled]);
  const report = !result.loading && !result.error && result.data?.target === query ? result.data : null;
  const busy = action.outcome.status === "sending";
  const locked = ["sending", "confirmed", "uncertain"].includes(action.outcome.status);
  const eligible = report?.enabled && report.selected && !report.voted && !!report.selection_context && ["voting", "challenged"].includes(report.phase ?? "");

  return <section aria-label="Review an identity" className="space-y-4">
    <TransactionReceipt {...action.outcome} onDone={action.clear} description="Your identity review vote has been recorded." uncertainDescription="Your vote may already be recorded. Check activity and refresh the panel before trying again." />
    {disabled && action.outcome.status === "error" && <p role="alert" className="text-ui text-destructive">{action.outcome.message}</p>}
    {!disabled && <>
    <div className="space-y-3">
      <h2 className="text-ui font-medium">Your assigned reviews</h2>
      {assignments.error ? <div role="alert" className="text-ui"><p>{assignments.error}</p><Button variant="outline" onClick={assignments.refetch}>Retry assignments</Button></div>
        : assignments.loading ? <p role="status" className="text-ui text-muted-foreground">Checking assignments…</p>
        : <>
          {assignments.data?.targets.length === 0 && <p className="text-ui text-muted-foreground">No pending reviews on this page.</p>}
          <ul className="divide-y">{assignments.data?.targets.map(target => <li key={target} className="flex min-w-0 items-center gap-3 py-3">
            <span className="min-w-0 flex-1 break-all font-mono text-ui">{target}</span>
            <Button variant="outline" disabled={locked} aria-label={`Review ${target}`} onClick={() => {
              setTarget(target); setChoice(null); setInputError(null);
              if (query === target) result.refetch(); else setQuery(target);
              if (panel.current) panel.current.open = true;
            }}>Review</Button>
          </li>)}</ul>
          <div className="flex gap-2">
            {cursor && <Button variant="outline" onClick={() => setCursor(null)}>First page</Button>}
            {assignments.data?.cursor && <Button variant="outline" onClick={() => setCursor(assignments.data!.cursor)}>More reviews</Button>}
          </div>
        </>}
    </div>
    <details ref={panel} className="rounded-lg border p-4">
      <summary className="min-h-11 cursor-pointer content-center text-ui">Review an identity</summary>
      <div className="mt-3 space-y-4">
        <p className="max-w-prose text-ui text-muted-foreground">Only the randomly selected panel can vote. Check the person’s evidence before deciding.</p>
        <form className="form-field" onSubmit={event => {
          event.preventDefault();
          const value = target.trim();
          if (!/^brst_[a-z0-9]{60}$/.test(value)) { setInputError("Enter a complete BURST wallet address."); return; }
          setInputError(null); setChoice(null);
          if (query === value) result.refetch(); else setQuery(value);
        }}>
          <label htmlFor="identity-review-address" className="text-ui">Wallet to review</label>
          <div className="field-action">
            <Input id="identity-review-address" value={target} disabled={locked} autoComplete="off" spellCheck={false}
              aria-invalid={!!inputError} aria-describedby={inputError ? "identity-review-error" : undefined}
              onChange={event => { setTarget(event.target.value); setQuery(null); setInputError(null); setChoice(null); }} />
            <Button type="submit" variant="outline" disabled={locked || (!!query && result.loading)}>{query && result.loading ? "Loading…" : "Check panel"}</Button>
          </div>
          {inputError && <p id="identity-review-error" role="alert" className="text-ui text-destructive">{inputError}</p>}
        </form>
        {query && result.error && <div role="alert" className="space-y-2 text-ui"><p className="break-words">{result.error}</p><Button variant="outline" onClick={result.refetch}>Try again</Button></div>}
        {report && !eligible && <p role="status" className="text-ui text-muted-foreground">{report.voted ? "You’ve already voted in this round." : !report.enabled ? "Identity reviews are paused on this node." : !report.selected ? "You’re not selected for this panel." : "This panel isn’t accepting votes."}</p>}
        {report && eligible && <div className="space-y-3">
          <fieldset disabled={locked} className="space-y-1">
            <legend className="mb-2 text-ui">Your decision</legend>
            {choices.map((label, index) => <label key={label} className="flex min-h-11 cursor-pointer items-center gap-3 text-ui">
              <input type="radio" name="identity-decision" checked={choice === index + 1} onChange={() => setChoice(index + 1)} />{label}
            </label>)}
          </fieldset>
          <p className="text-ui text-muted-foreground">{choice === 3 ? "Neither stakes no BRN. Repeated Neither votes may affect your eligibility." : `${formatAmount(report.stake, 18)} BRN is at risk if your vote is ruled incorrect.`}</p>
          <Button ref={trigger} disabled={choice === null || locked} onClick={() => {
            if (choice === null) return;
            action.clear(); context.current = { rpcUrl, address }; setReviewed({ report, vote: choice });
          }}>Review vote</Button>
        </div>}
        {action.outcome.status === "error" && !reviewed && <p role="alert" className="text-ui text-destructive">{action.outcome.message}</p>}
      </div>
    </details>
    <Dialog open={reviewed !== null} onOpenChange={open => { if (!open && !busy) setReviewed(null); }}>
      <DialogContent onCloseAutoFocus={event => { event.preventDefault(); if (trigger.current && !trigger.current.disabled) trigger.current.focus(); else document.getElementById("main-content")?.focus(); }}>
        <DialogHeader><DialogTitle>Confirm identity vote</DialogTitle><DialogDescription>Your vote is recorded publicly. A staked vote can lose BRN if ruled incorrect.</DialogDescription></DialogHeader>
        {reviewed && <dl className="space-y-3 text-ui">
          <div><dt className="text-muted-foreground">Wallet</dt><dd className="break-all font-mono">{reviewed.report.target}</dd></div>
          <div className="flex gap-4"><dt className="text-muted-foreground">Decision</dt><dd>{choices[reviewed.vote - 1]}</dd></div>
          <div className="flex gap-4"><dt className="text-muted-foreground">Stake at risk</dt><dd>{reviewed.vote === 3 ? "0" : formatAmount(reviewed.report.stake, 18)} BRN</dd></div>
        </dl>}
        {action.outcome.status === "error" && <p role="alert" className="text-ui text-destructive">{action.outcome.message}</p>}
        <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setReviewed(null)}>Cancel</Button>
          {reviewed && <OfflineActionButton address={address} rpcUrl={rpcUrl} request={{kind:"verification_vote",target:reviewed.report.target,context:reviewed.report.selection_context,vote:reviewed.vote,stake:reviewed.vote === 3 ? "0" : reviewed.report.stake}} disabled={busy || disabled} />}
          <Button disabled={busy} onClick={async () => {
          if (!reviewed || disabled) return;
          if (await action.submit({ reviewed: reviewed.report, vote: reviewed.vote }, context.current)) { setReviewed(null); result.refetch(); assignments.refetch(); }
        }}>{busy ? "Recording…" : "Record vote"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    </>}
  </section>;
}
