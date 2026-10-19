import { useEffect, useId, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useWallet } from "@/hooks/use-wallet";
import { defaultGroupPolicy, readGroupPolicy, type GroupEndpoint, type GroupPolicy } from "@/lib/group-policy";
import { toast } from "sonner";

export function GroupPolicySettings({onDraftChange}:{onDraftChange?:(dirty:boolean)=>void}) {
  const {groupPolicy}=useWallet();
  return <details className="settings-disclosure">
    <summary><span>Group checks</span><span className="ml-auto text-caption text-muted-foreground">{!groupPolicy ? "Needs review" : groupPolicy.mode==="protocol" ? "Protocol only" : `${groupPolicy.groups.filter(group=>group.trust_directly!==false).length} trusted`}</span></summary>
    <GroupPolicyEditor key={JSON.stringify(groupPolicy)} saved={groupPolicy} onDraftChange={onDraftChange} />
  </details>;
}

function GroupPolicyEditor({saved,onDraftChange}:{saved:GroupPolicy|null;onDraftChange?:(dirty:boolean)=>void}) {
  const {setGroupPolicy}=useWallet();
  const [draft,setDraft]=useState<GroupPolicy>(()=>saved ?? defaultGroupPolicy);
  const [url,setUrl]=useState("");
  const [directory,setDirectory]=useState<GroupEndpoint[]|null>(null);
  const [page,setPage]=useState(0);
  const [error,setError]=useState("");
  const [directoryError,setDirectoryError]=useState("");
  const [loading,setLoading]=useState(false);
  const [saving,setSaving]=useState(false);
  const pending=useRef(false);
  const generation=useRef(0);
  const id=useId();
  const dirty=JSON.stringify(saved)!==JSON.stringify(draft);
  useEffect(()=>{onDraftChange?.(dirty);},[dirty,onDraftChange]);
  useEffect(()=>()=>{generation.current++;},[]);

  async function save() {
    if (pending.current) return;
    const checked=readGroupPolicy(draft);
    if (!checked) {setError("Trust at least one group directly, or use protocol checks only.");return;}
    pending.current=true; setSaving(true); setError("");
    const request=generation.current;
    try {
      const validated=await invoke<GroupPolicy>("validate_group_policy",{policy:checked});
      if (generation.current!==request) return;
      const policy=readGroupPolicy(validated);
      if (!policy) throw new Error("The saved group rules could not be validated.");
      setGroupPolicy(policy); toast.success("Group rules saved");
    } catch(error) {if (generation.current===request) setError(String(error));}
    finally {pending.current=false;if (generation.current===request) setSaving(false);}
  }

  async function loadDirectory() {
    if (pending.current) return;
    let parsed:URL;
    try {
      parsed=new URL(url.trim());
      if (!["http:","https:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error();
    } catch {setDirectoryError("Enter an HTTP or HTTPS directory URL without credentials, a query or a fragment.");return;}
    pending.current=true; setLoading(true); setDirectoryError(""); setDirectory(null);
    const request=generation.current;
    try {
      const groups=await invoke<GroupEndpoint[]>("load_group_directory",{url:parsed.href});
      if (generation.current===request) {setDirectory(groups);setPage(0);}
    } catch(error) {if (generation.current===request) setDirectoryError(String(error));}
    finally {pending.current=false;if (generation.current===request) setLoading(false);}
  }

  function add(group:GroupEndpoint) {
    const previous=draft.groups.find(selected=>selected.id===group.id);
    if (previous) {
      if (previous.endpoint_url!==group.endpoint_url) setDirectoryError("This ID already has a selected endpoint. Remove that group first if you intend to replace it.");
      return;
    }
    if (draft.groups.length>=32) {setDirectoryError("Choose at most 32 groups.");return;}
    setDraft({...draft,groups:[...draft.groups,{...group,trust_directly:true}]});setError("");
  }

  function setDirectTrust(groupId:string, trustDirectly:boolean) {
    const next={...draft,groups:draft.groups.map(group=>group.id===groupId?{...group,trust_directly:trustDirectly}:group)};
    setDraft(next);
    if (error && readGroupPolicy(next)) setError("");
  }

  return <div className="space-y-5 pt-3">
    {!saved && <p role="alert" className="field-error">Saved group rules could not be read. Automation is paused until you save valid rules.</p>}
    <form className="space-y-4" onSubmit={event=>{event.preventDefault();void save();}}>
      <fieldset disabled={saving || loading} className="space-y-4">
        <div className="form-field">
          <label htmlFor={`${id}-mode`}>Automatic receive checks</label>
          <select id={`${id}-mode`} className="form-control min-h-11 px-3" value={draft.mode} onChange={event=>{setDraft({...draft,mode:event.target.value as GroupPolicy["mode"]});setError("");}}>
            <option value="protocol">Protocol checks only</option><option value="any">Any trusted group per creator</option><option value="all">Every trusted group per creator</option>
          </select>
          <p className="field-help">Group checks apply to original BRN creators, not just the sender. Manual acceptance stays available.</p>
        </div>
        {draft.mode!=="protocol" && <>
          <div className="form-field">
            <label htmlFor={`${id}-depth`}>Groups they vouch for</label>
            <select id={`${id}-depth`} className="form-control min-h-11 px-3" value={draft.max_hops??0} aria-describedby={`${id}-depth-help`} onChange={event=>setDraft({...draft,max_hops:Number(event.target.value)})}>
              <option value={0}>Off · direct membership only</option>
              {Array.from({length:8},(_,index)=>index+1).map(depth=><option key={depth} value={depth}>Up to {depth} {depth===1?"step":"steps"}</option>)}
            </select>
            <p id={`${id}-depth-help`} className="field-help">Only groups you add below can be checked. A chain must start at a group you trust directly.</p>
          </div>
          <div className="form-field">
            <label htmlFor={`${id}-fallback`}>When groups are unavailable</label>
            <select id={`${id}-fallback`} className="form-control min-h-11 px-3" value={draft.offline_fallback} onChange={event=>setDraft({...draft,offline_fallback:event.target.value as GroupPolicy["offline_fallback"]})}>
              <option value="protocol">Use protocol checks</option><option value="review">Keep pending for review</option>
            </select>
            <p className="field-help">A negative or invalid response never counts as an outage.</p>
          </div>
          {draft.groups.length ? <ul aria-label="Selected groups" className="divide-y">{draft.groups.map(group=><li key={group.id} className="flex items-start justify-between gap-3 py-3">
            <div className="min-w-0"><p className="break-words text-ui">{group.name}</p><p className="break-all text-caption text-muted-foreground">{group.endpoint_url}</p>
              {((draft.max_hops??0)>0 || group.trust_directly===false) && <label className="flex min-h-11 cursor-pointer items-center gap-2 text-caption">
                <input type="checkbox" checked={group.trust_directly!==false} aria-label={`Trust ${group.name} directly`} onChange={event=>setDirectTrust(group.id,event.target.checked)} />
                Trust directly
              </label>}
            </div>
            <Button type="button" variant="ghost" size="sm" aria-label={`Remove ${group.name}`} onClick={()=>setDraft({...draft,groups:draft.groups.filter(item=>item.id!==group.id)})}>Remove</Button>
          </li>)}</ul> : <p className="field-help">Load a directory below, then select the groups you trust.</p>}
          <p className="field-help">Queries share original creator addresses. {(draft.max_hops??0)>0 && "Unchecked groups are contacted only through a trusted group's endorsement. "}Membership is checked live for each payment.</p>
        </>}
        {error && <p role="alert" className="field-error break-words">{error}</p>}
        <Button type="submit" variant="secondary" disabled={!dirty}>{saving ? "Saving…" : "Save group rules"}</Button>
      </fieldset>
    </form>
    {draft.mode!=="protocol" && <div className="space-y-3 border-t pt-4">
      <form noValidate className="form-field" onSubmit={event=>{event.preventDefault();void loadDirectory();}}>
        <label htmlFor={`${id}-directory`}>Group directory URL</label>
        <div className="field-action"><Input id={`${id}-directory`} type="url" value={url} onChange={event=>{setUrl(event.target.value);setDirectoryError("");}} disabled={loading || saving} spellCheck={false} autoComplete="off" aria-invalid={!!directoryError} /><Button type="submit" variant="outline" disabled={loading || saving}>{loading ? "Loading…" : "Load directory"}</Button></div>
        <p className="field-help">Loading a public listing does not select its groups or share wallet addresses.</p>
        {directoryError && <p role="alert" className="field-error break-words">{directoryError}</p>}
      </form>
      {directory && !directory.length && <p role="status" className="field-help">This directory has no groups.</p>}
      {!!directory?.length && <>
        <ul aria-label="Directory groups" className="divide-y">{directory.slice(page*10,(page+1)*10).map(group=><li key={group.id} className="space-y-1 py-3">
          <div className="flex items-center justify-between gap-3"><p className="min-w-0 break-words text-ui">{group.name}</p><Button type="button" variant="outline" size="sm" aria-label={`Select ${group.name}`} disabled={saving || draft.groups.some(item=>item.id===group.id && item.endpoint_url===group.endpoint_url)} onClick={()=>add(group)}>{draft.groups.some(item=>item.id===group.id && item.endpoint_url===group.endpoint_url) ? "Selected" : "Select"}</Button></div>
          <p className="break-all text-caption text-muted-foreground">{group.endpoint_url}</p>
          {group.description && <p className="break-words text-caption text-muted-foreground">{group.description}</p>}
        </li>)}</ul>
        {directory.length>10 && <nav aria-label="Group directory pages" className="flex flex-wrap items-center gap-2"><Button variant="ghost" size="sm" disabled={!page} onClick={()=>setPage(page-1)}>Previous</Button><span className="text-caption tabular-nums">{page+1} / {Math.ceil(directory.length/10)}</span><Button variant="ghost" size="sm" disabled={(page+1)*10>=directory.length} onClick={()=>setPage(page+1)}>Next</Button></nav>}
      </>}
    </div>}
  </div>;
}
