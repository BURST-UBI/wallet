import { useRef, useState } from "react";
import { useRpc } from "@/hooks/use-wallet";
import { useTransaction } from "@/hooks/use-transaction";
import { TransactionReceipt } from "@/components/transaction-receipt";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatAmount } from "@/lib/utils";
import { OfflineActionButton } from "@/components/offline-action-button";

interface AppealReview {
  account: string;
  enabled: boolean;
  challenge_active: boolean;
  required_stake: string;
  outcome: null | { hash: string; checkpoint: string; reason: "Fraud" | "Inactivity"; legitimate: boolean; completed_at: number };
}

function decision(review: AppealReview) {
  return `${review.outcome!.reason} ${review.outcome!.legitimate ? "dismissed" : "confirmed"}`;
}
function stake(review: AppealReview) {
  return formatAmount(review.required_stake, 18).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}

export function AppealPanel({ rpcUrl, address, canSponsor }: { rpcUrl: string; address: string | null; canSponsor: boolean }) {
  const [target, setTarget] = useState("");
  const [query, setQuery] = useState<string | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);
  const [reviewed, setReviewed] = useState<AppealReview | null>(null);
  const reviewContext = useRef({ rpcUrl, address });
  const trigger = useRef<HTMLButtonElement>(null);
  const action = useTransaction(rpcUrl, address, "appeal_wallet");
  const result = useRpc<AppealReview>("get_appeal_review", query ? { rpcUrl, target: query } : null);
  const report = result.data?.account === query && !result.error && !result.loading ? result.data : null;
  const busy = action.outcome.status === "sending";
  const locked = ["sending", "confirmed", "uncertain"].includes(action.outcome.status);
  const available = report?.enabled === true && !report.challenge_active && !!report.outcome && canSponsor;

  async function submit() {
    if (!reviewed || !canSponsor || !reviewContext.current.address) return;
    if (await action.submit({ reviewed, expectedAccount: reviewContext.current.address }, reviewContext.current)) {
      setReviewed(null);
      result.refetch();
    }
  }

  return <section aria-label="Appeal a decision" className="space-y-4">
    <TransactionReceipt {...action.outcome} onDone={action.clear}
      description="Your appeal is recorded. The previous decision stays in effect until the review is settled."
      uncertainDescription="Your appeal may already be accepted. Check activity before submitting again." />
    <details className="rounded-lg border p-4">
      <summary className="min-h-11 cursor-pointer content-center text-ui">Appeal a decision</summary>
      <div className="mt-3 space-y-4">
        <p className="max-w-prose text-ui text-muted-foreground">Dispute a completed fraud or inactivity review. A verified wallet must sponsor the appeal.</p>
        <form className="form-field" onSubmit={event => {
          event.preventDefault();
          const value = target.trim();
          if (!/^brst_[a-z0-9]{60}$/.test(value)) { setInputError("Enter a complete BURST wallet address."); return; }
          setInputError(null);
          if (query === value) result.refetch(); else setQuery(value);
        }}>
          <label htmlFor="appeal-address" className="text-ui">Wallet address</label>
          <div className="field-action">
            <Input id="appeal-address" value={target} disabled={locked} autoComplete="off" spellCheck={false}
              aria-invalid={!!inputError} aria-describedby={inputError ? "appeal-address-error" : undefined}
              onChange={event => { setTarget(event.target.value); setQuery(null); setInputError(null); }} />
            <Button type="submit" variant="outline" disabled={locked || (!!query && result.loading)}>{query && result.loading ? "Loading…" : "Find decision"}</Button>
          </div>
          {inputError && <p id="appeal-address-error" role="alert" className="text-ui text-destructive">{inputError}</p>}
        </form>
        {query && result.error && <div role="alert" className="space-y-2 text-ui">
          <p>Couldn’t load this decision.</p><p className="break-words text-muted-foreground">{result.error}</p>
          <Button variant="outline" onClick={result.refetch}>Try again</Button>
        </div>}
        {report && <div className="space-y-3 text-ui">
          {report.outcome ? <>
            <dl className="space-y-2 border-t pt-4">
              <div className="flex flex-wrap gap-x-6 gap-y-1"><dt className="min-w-20 text-muted-foreground">Decision</dt><dd>{decision(report)}</dd></div>
              <div className="flex flex-wrap gap-x-6 gap-y-1"><dt className="min-w-20 text-muted-foreground">Completed</dt><dd>{new Date(report.outcome.completed_at * 1000).toLocaleDateString()}</dd></div>
              <div className="flex flex-wrap gap-x-6 gap-y-1"><dt className="min-w-20 text-muted-foreground">Stake at risk</dt><dd className="break-all tabular-nums">{stake(report)} BRN</dd></div>
            </dl>
            <details className="text-caption text-muted-foreground">
              <summary className="min-h-11 cursor-pointer content-center">Decision details</summary>
              <p>Reported by your node.</p>
              <p className="mt-2">Outcome</p><p className="break-all font-mono select-text">{report.outcome.hash}</p>
              <p className="mt-2">Checkpoint</p><p className="break-all font-mono select-text">{report.outcome.checkpoint}</p>
            </details>
          </> : <p role="status" className="text-muted-foreground">No certified challenge outcome is available to appeal.</p>}
          {!report.enabled && <p role="status" className="text-muted-foreground">Appeals are not enabled on this node. No BRN will be staked.</p>}
          {report.challenge_active && <p role="status">A review is already active for this wallet.</p>}
          {!canSponsor && <p className="text-muted-foreground">Ask a verified person to sponsor this appeal using your address.</p>}
          {available && <>
            <p className="max-w-prose text-muted-foreground">You lose the stake if the decision is upheld. Existing restrictions stay in place during review.</p>
            <Button ref={trigger} disabled={locked} onClick={() => { action.clear(); reviewContext.current = { rpcUrl, address }; setReviewed(report); }}>Review appeal</Button>
          </>}
        </div>}
        {action.outcome.status === "error" && !reviewed && <p role="alert" className="text-ui text-destructive break-words">{action.outcome.message}</p>}
      </div>
    </details>
    <Dialog open={reviewed !== null} onOpenChange={open => { if (!open && !busy) setReviewed(null); }}>
      <DialogContent onCloseAutoFocus={event => {
        event.preventDefault();
        if (trigger.current && !trigger.current.disabled) trigger.current.focus();
        else (document.querySelector<HTMLElement>("[data-transaction-receipt]") ?? document.getElementById("main-content"))?.focus();
      }}>
        <DialogHeader><DialogTitle>Confirm appeal</DialogTitle>
          <DialogDescription>Ask a new verifier panel to review this decision. The stake is lost if the decision is upheld.</DialogDescription>
        </DialogHeader>
        {reviewed?.outcome && <div className="space-y-3 text-ui">
          <p>{decision(reviewed)}</p><p className="break-all font-mono text-caption">{reviewed.account}</p>
          <p className="tabular-nums">{stake(reviewed)} BRN at risk</p>
          <p className="text-muted-foreground">{reviewed.outcome.legitimate
            ? reviewed.outcome.reason === "Fraud" ? "If overturned, the wallet is revoked along with its originated TRST." : "If overturned, income and transaction rights pause. Legitimate TRST is not revoked."
            : "If overturned, wallet access resumes. Restoration does not make expired TRST spendable or erase independent revocations."}</p>
          <details className="text-caption text-muted-foreground"><summary className="min-h-11 cursor-pointer content-center">Outcome ID</summary><p className="break-all font-mono select-text">{reviewed.outcome.hash}</p></details>
        </div>}
        {action.outcome.status === "error" && <p role="alert" className="text-ui text-destructive break-words">{action.outcome.message}</p>}
        <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setReviewed(null)}>Cancel</Button>
          {reviewed && <OfflineActionButton address={address} rpcUrl={rpcUrl} request={{kind:"appeal",reviewed}} disabled={locked || !canSponsor} />}
          <Button disabled={locked || !canSponsor} onClick={submit}>{busy ? "Submitting…" : "Stake and appeal"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </section>;
}
