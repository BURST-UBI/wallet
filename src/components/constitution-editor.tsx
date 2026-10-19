import {useRef, useState} from "react";
import {invoke} from "@tauri-apps/api/core";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle} from "@/components/ui/dialog";
import {AmendmentReview} from "@/components/amendment-review";
import {useWallet} from "@/hooks/use-wallet";
import {useWalletStore} from "@/stores/wallet-store";
import {OfflineActionButton} from "@/components/offline-action-button";
import {amendmentCharacters, validOperations} from "@/lib/constitution";
import type {AmendmentOperation, BlockResult, ConstitutionContext} from "@/lib/types";

type Draft = {title: string; operations: AmendmentOperation[]};
type Change = {kind: "add" | "modify" | "repeal"; article: string; title: string; text: string};
const blank = (): Change => ({kind:"add",article:"",title:"",text:""});

export function ConstitutionEditor({context, error, canParticipate, onSubmitted}: {
  context: ConstitutionContext | null; error: string | null; canParticipate: boolean; onSubmitted: (hash: string) => void;
}) {
  const {rpcUrl,address} = useWallet();
  const [editing,setEditing] = useState(false);
  const [title,setTitle] = useState("");
  const [changes,setChanges] = useState<Change[]>([blank()]);
  const [formError,setFormError] = useState("");
  const [attempted,setAttempted] = useState(false);
  const [review,setReview] = useState<{draft: Draft; context: ConstitutionContext; rpcUrl: string; address: string | null} | null>(null);
  const [failure,setFailure] = useState("");
  const [busy,setBusy] = useState(false);
  const [preparing,setPreparing] = useState(false);
  const pending = useRef(false);
  const trigger = useRef<HTMLElement | null>(null);
  const update = (index: number, value: Partial<Change>) => {setChanges(items => items.map((item,n) => n === index ? {...item,...value} : item));setFormError("");};
  async function prepare() {
    if (pending.current || !context?.enabled || !canParticipate) return;
    setAttempted(true);
    const operations: AmendmentOperation[] = changes.map(change => change.kind === "add" ? {AddArticle:{title:change.title,text:change.text}}
      : change.kind === "modify" ? {ModifyArticle:{article_number:change.article,new_text:change.text}} : {RepealArticle:{article_number:change.article}});
    if (!title.trim() || !validOperations(operations)) {setFormError("Give the amendment a title and complete each change.");return;}
    if (amendmentCharacters(operations) > 50_000) {setFormError("Amendments can contain up to 50,000 characters of article text.");return;}
    trigger.current = document.activeElement as HTMLElement;
    pending.current = true;setPreparing(true);setFormError("");
    try {
      const fresh = await invoke<ConstitutionContext>("get_constitution_context",{rpcUrl,expectedAccount:address});
      const current = useWalletStore.getState();
      if (current.isLocked || current.address !== address || current.rpcUrl !== rpcUrl) throw new Error("Your wallet or connection changed. Review your amendment again.");
      if (!fresh.enabled) throw new Error("Amendment publishing is not enabled on this node.");
      setFailure("");setReview({draft:{title,operations},context:fresh,rpcUrl,address});
    } catch (cause) {setFormError(String(cause));}
    finally {pending.current=false;setPreparing(false);}
  }
  async function submit() {
    if (!review || pending.current) return;
    pending.current = true;setBusy(true);setFailure("");
    try {
      const current = useWalletStore.getState();
      if (current.isLocked || current.address !== review.address || current.rpcUrl !== review.rpcUrl) throw new Error("Your wallet or connection changed. Close this review and start again.");
      const result = await invoke<BlockResult>("propose_constitution",{rpcUrl:review.rpcUrl,expectedAccount:review.address,expectedRevision:review.context.revision,draft:review.draft});
      if (!result.accepted) throw new Error(result.detail ?? "The network did not accept the amendment.");
      setReview(null);setEditing(false);setTitle("");setChanges([blank()]);setAttempted(false);onSubmitted(result.hash);
    } catch (cause) {setFailure(String(cause));}
    finally {pending.current=false;setBusy(false);}
  }
  return <section className="space-y-4" aria-label="Constitution">
    <div className="section-heading"><h2>Constitution</h2><Button variant="outline" disabled={!context?.enabled || !canParticipate} onClick={() => setEditing(value => !value)}>{editing ? "Close editor" : "New amendment"}</Button></div>
    {error ? <p role="alert" className="text-caption text-destructive">Constitution unavailable. {error}</p>
      : !context ? <p role="status" className="text-caption text-muted-foreground">Loading constitution…</p> : <>
      <details className="text-ui"><summary className="min-h-11 cursor-pointer py-3">Read current constitution · Version {context.document.version}</summary><div className="divide-y">{context.document.articles.map(article => <article key={article.id} className="space-y-2 py-4"><h3 className="font-medium">{article.id}. {article.title}</h3><p className="whitespace-pre-wrap break-words">{article.text}</p></article>)}</div></details>
      {!context.enabled && <p className="text-caption text-muted-foreground">Amendment publishing is not enabled on this node yet.</p>}
    </>}
    {editing && context?.enabled && <form className="space-y-5" onSubmit={event => {event.preventDefault();prepare();}} onKeyDown={event => {if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {event.preventDefault();prepare();}}}>
      <div className="form-field"><label htmlFor="amendment-title">Amendment title</label><Input id="amendment-title" value={title} onChange={event => {setTitle(event.target.value);setFormError("");}} autoComplete="off" aria-invalid={attempted&&!title.trim()} aria-describedby={attempted&&!title.trim()?"amendment-title-error":undefined} />{attempted&&!title.trim()&&<p id="amendment-title-error" className="text-caption text-destructive">Enter an amendment title.</p>}</div>
      <div className="divide-y">{changes.map((change,index) => <fieldset key={index} className="space-y-3 py-4 first:pt-0"><legend className="sr-only">Change {index+1}</legend>
        <div className="flex flex-wrap items-center gap-2"><span className="text-caption text-muted-foreground">Change {index+1}</span><Button type="button" variant="ghost" aria-label={`Remove change ${index+1}`} onClick={() => setChanges(items => items.filter((_,n) => n !== index))}>Remove</Button>{index > 0 && <Button type="button" variant="ghost" aria-label={`Move change ${index+1} up`} onClick={() => setChanges(items => {const next=[...items];[next[index-1],next[index]]=[next[index],next[index-1]];return next;})}>Move up</Button>}</div>
        <div className="form-field"><label htmlFor={`amendment-kind-${index}`}>Action</label><select id={`amendment-kind-${index}`} className="form-control min-h-11 px-3" value={change.kind} onChange={event => update(index,{kind:event.target.value as Change["kind"]})}><option value="add">Add article</option><option value="modify">Replace article text</option><option value="repeal">Repeal article</option></select></div>
        {change.kind === "add" ? <div className="form-field"><label htmlFor={`amendment-article-title-${index}`}>Article title</label><Input id={`amendment-article-title-${index}`} value={change.title} onChange={event => update(index,{title:event.target.value})} aria-invalid={attempted&&!change.title} aria-describedby={attempted&&!change.title?`article-title-error-${index}`:undefined} />{attempted&&!change.title&&<p id={`article-title-error-${index}`} className="text-caption text-destructive">Enter an article title.</p>}</div>
          : <div className="form-field"><label htmlFor={`amendment-article-${index}`}>Article</label><select id={`amendment-article-${index}`} className="form-control min-h-11 px-3" value={change.article} onChange={event => update(index,{article:event.target.value})} aria-invalid={attempted&&!change.article} aria-describedby={attempted&&!change.article?`article-error-${index}`:undefined}><option value="">Choose an article</option>{context.document.articles.map(article => <option key={article.id} value={article.id}>{article.id}. {article.title}</option>)}</select>{attempted&&!change.article&&<p id={`article-error-${index}`} className="text-caption text-destructive">Choose the article to change.</p>}</div>}
        {change.kind !== "repeal" && <div className="form-field"><label htmlFor={`amendment-text-${index}`}>{change.kind === "modify" ? "Replacement text" : "Article text"}</label><textarea id={`amendment-text-${index}`} className="form-control p-3" rows={5} value={change.text} onChange={event => update(index,{text:event.target.value})} aria-invalid={attempted&&!change.text} aria-describedby={attempted&&!change.text?`article-text-error-${index}`:undefined} />{attempted&&!change.text&&<p id={`article-text-error-${index}`} className="text-caption text-destructive">Enter the full article text.</p>}</div>}
      </fieldset>)}</div>
      <Button type="button" variant="ghost" onClick={() => setChanges(items => [...items,blank()])}>Add change</Button>
      {formError && <p role="alert" className="text-caption text-destructive">{formError}</p>}
      <div><Button type="submit" disabled={!canParticipate || preparing}>{preparing ? "Preparing review…" : "Review amendment"}</Button></div>
    </form>}
    <Dialog open={!!review} onOpenChange={open => {if (!open && !pending.current) setReview(null);}}><DialogContent onCloseAutoFocus={event => {event.preventDefault();if (trigger.current?.isConnected) trigger.current.focus();}}>
      <DialogHeader><DialogTitle>Review amendment</DialogTitle><DialogDescription>These exact changes will be published. Activation requires endorsements and a successful community vote.</DialogDescription></DialogHeader>
      {review && <><h3 className="text-heading">{review.draft.title}</h3><p className="text-caption text-muted-foreground">Based on constitution version {review.context.document.version}. Other amendments may change articles before activation.</p><AmendmentReview operations={review.draft.operations} document={review.context.document} /></>}
      {failure && <p role="alert" className="text-caption text-destructive break-words">{failure}</p>}
      <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setReview(null)}>Back to editing</Button>
        {review && <OfflineActionButton address={review.address} rpcUrl={review.rpcUrl} request={{kind:"constitution",draft:review.draft,revision:review.context.revision}} disabled={busy || !!failure} />}
        <Button disabled={busy || !!failure} onClick={submit}>{busy ? "Publishing…" : "Publish amendment"}</Button></DialogFooter>
    </DialogContent></Dialog>
  </section>;
}
