import {useRef,useState} from "react";
import {invoke} from "@tauri-apps/api/core";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Dialog,DialogContent,DialogDescription,DialogFooter,DialogHeader,DialogTitle} from "@/components/ui/dialog";
import {useWallet} from "@/hooks/use-wallet";
import {useWalletStore} from "@/stores/wallet-store";
import {OfflineActionButton} from "@/components/offline-action-button";
import {parameterDisplay,parameterInput,parameterLabel,parameterRaw,parameterUnit} from "@/lib/parameters";
import type {BlockResult,ConstitutionContext,GovernableParameter} from "@/lib/types";

type Review = {row: GovernableParameter; raw: string; revision: string; account: string | null; rpcUrl: string};

export function ParameterEditor({context,error,canParticipate,onSubmitted}: {
  context: ConstitutionContext | null; error: string | null; canParticipate: boolean; onSubmitted: (hash: string) => void;
}) {
  const {rpcUrl,address} = useWallet();
  const [editing,setEditing] = useState(false);
  const [name,setName] = useState("");
  const [value,setValue] = useState("");
  const [never,setNever] = useState(false);
  const [attempted,setAttempted] = useState(false);
  const [review,setReview] = useState<Review | null>(null);
  const [failure,setFailure] = useState("");
  const [busy,setBusy] = useState(false);
  const pending = useRef(false);
  const trigger = useRef<HTMLElement | null>(null);
  const rows = context?.parameters?.filter(row => !row.legacy) ?? [];
  const row = rows.find(row => row.name === name);
  let raw = "", fieldError = "";
  if (row) {
    try {
      raw = never && row.name === "trst_expiry_secs" ? "18446744073709551615" : parameterRaw(row,value);
      if (raw === row.current) fieldError = "Choose a value different from the current value.";
    } catch (cause) {fieldError = cause instanceof Error ? cause.message : String(cause);}
  }
  function prepare() {
    setAttempted(true);
    if (!row || fieldError || !context || error || !canParticipate) return;
    trigger.current = document.activeElement as HTMLElement;
    setFailure("");
    setReview({row,raw,revision:context.revision,account:address,rpcUrl});
  }
  async function publish() {
    if (!review || pending.current) return;
    pending.current = true;setBusy(true);setFailure("");
    try {
      const wallet = useWalletStore.getState();
      if (wallet.isLocked || wallet.address !== review.account || wallet.rpcUrl !== review.rpcUrl) throw new Error("Your wallet or connection changed. Review the proposal again.");
      const result = await invoke<BlockResult>("propose_parameter",{
        rpcUrl:review.rpcUrl,expectedAccount:review.account,expectedRevision:review.revision,
        parameter:review.row.name,newValue:review.raw,
      });
      if (!result.accepted) throw new Error(result.detail ?? "The network did not accept the proposal.");
      setReview(null);setEditing(false);setName("");setValue("");setAttempted(false);
      onSubmitted(result.hash);
    } catch (cause) {setFailure(String(cause));}
    finally {pending.current=false;setBusy(false);}
  }
  return <section aria-label="Protocol parameters" className="space-y-4">
    <div className="section-heading"><h2>Protocol parameters</h2><Button variant="outline" disabled={!rows.length || !!error || !canParticipate} onClick={() => setEditing(open => !open)}>{editing ? "Close parameter editor" : "Propose a change"}</Button></div>
    {error ? <p role="alert" className="text-caption text-destructive">Parameter values unavailable. {error}</p>
      : context && !rows.length ? <p className="text-caption text-muted-foreground">This node does not provide editable parameter values.</p> : null}
    {editing && <form className="space-y-4" onSubmit={event => {event.preventDefault();prepare();}}>
      <div className="form-field"><label htmlFor="governance-parameter">Parameter</label>
        <select id="governance-parameter" className="form-control min-h-11 px-3" value={name} aria-invalid={attempted&&!row} aria-describedby={attempted&&!row?"parameter-name-error":undefined} onChange={event => {
          const selected = rows.find(row => row.name === event.target.value);
          setName(event.target.value);setValue(selected ? parameterInput(selected) : "");
          setNever(selected?.name === "trst_expiry_secs" && selected.current === "18446744073709551615");setAttempted(false);
        }}><option value="">Choose a parameter</option>{rows.map(row => <option key={row.name} value={row.name}>{parameterLabel(row.name)}</option>)}</select>
        {attempted&&!row&&<p id="parameter-name-error" role="alert" className="text-caption text-destructive">Choose the parameter to change.</p>}
      </div>
      {row && <>
        <p className="text-ui text-muted-foreground">Current: <span className="text-foreground tabular-nums">{parameterDisplay(row)}</span></p>
        {row.name === "trst_expiry_secs" && <label className="flex min-h-11 items-center gap-3 text-ui"><input type="checkbox" checked={never} onChange={event => {setNever(event.target.checked);if(!event.target.checked)setValue("");}} />No expiry</label>}
        <div className="form-field"><label htmlFor="governance-new-value">New value{parameterUnit(row.unit) ? ` (${parameterUnit(row.unit)})` : ""}</label>
          <Input id="governance-new-value" inputMode="decimal" autoComplete="off" spellCheck={false} disabled={never} value={never ? "" : value} onChange={event => setValue(event.target.value)} aria-invalid={attempted&&!!fieldError} aria-describedby={attempted&&fieldError?"parameter-value-error":undefined} />
          {attempted&&fieldError&&<p id="parameter-value-error" role="alert" className="text-caption text-destructive">{fieldError}</p>}
        </div>
        {row.name === "min_work_difficulty" && <p className="text-caption text-muted-foreground">Higher values require more work for every transaction.</p>}
      </>}
      <Button type="submit" disabled={!canParticipate || !!error}>Review proposal</Button>
    </form>}
    <Dialog open={!!review} onOpenChange={open => {if(!open&&!pending.current)setReview(null);}}><DialogContent onCloseAutoFocus={event => {event.preventDefault();if(trigger.current?.isConnected)trigger.current.focus();}}>
      <DialogHeader><DialogTitle>Review parameter change</DialogTitle><DialogDescription>This publishes a proposal. Changing the network rule requires endorsements and a successful community vote.</DialogDescription></DialogHeader>
      {review && <><h3 className="text-heading">{parameterLabel(review.row.name)}</h3><dl className="divide-y text-ui">{[["Current",review.row.current],["Proposed",review.raw]].map(([label,raw]) => <div key={label} className="grid grid-cols-[5rem_1fr] items-baseline gap-4 py-3"><dt className="text-muted-foreground">{label}</dt><dd className="break-words tabular-nums">{parameterDisplay(review.row,raw)}</dd></div>)}</dl></>}
      {failure&&<p role="alert" className="text-caption text-destructive break-words">{failure}</p>}
      <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setReview(null)}>Back to editing</Button>
        {review && <OfflineActionButton address={review.account} rpcUrl={review.rpcUrl} request={{kind:"parameter",parameter:review.row.name,value:review.raw,revision:review.revision}} disabled={busy || !!failure} />}
        <Button disabled={busy||!!failure} onClick={publish}>{busy?"Publishing…":"Publish proposal"}</Button></DialogFooter>
    </DialogContent></Dialog>
  </section>;
}
