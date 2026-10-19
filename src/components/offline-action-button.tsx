import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Link } from "react-router-dom";
import { useWalletStore } from "@/stores/wallet-store";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export type ActionReview = { title: string; fields: [string, string][] };
type Prepared = { context: string; review: ActionReview };

export function ActionDetails({ review }: { review: ActionReview }) {
  return <dl className="divide-y text-ui">{review.fields.map(([label, value], index) => <div key={`${label}-${index}`} className="space-y-1 py-3"><dt className="text-caption text-muted-foreground">{label}</dt><dd className="whitespace-pre-wrap break-words [overflow-wrap:anywhere] tabular-nums">{value}</dd></div>)}</dl>;
}

export function OfflineActionButton({ request, address, rpcUrl, disabled = false }: {
  request: object; address: string | null; rpcUrl: string; disabled?: boolean;
}) {
  return <OfflineActionFlow key={JSON.stringify([address, rpcUrl, request])} request={request} address={address} rpcUrl={rpcUrl} disabled={disabled} />;
}

function OfflineActionFlow({ request, address, rpcUrl, disabled }: {
  request: object; address: string | null; rpcUrl: string; disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [hash, setHash] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const active = useRef(true);
  const pending = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  function current() {
    const wallet = useWalletStore.getState();
    return active.current && !wallet.isLocked && wallet.address === address && wallet.rpcUrl === rpcUrl;
  }
  async function run(label: string, action: () => Promise<void>) {
    if (pending.current || !current()) return;
    pending.current = true; setBusy(label); setError("");
    try { await action(); } catch (cause) { if (current()) setError(String(cause)); }
    finally { pending.current = false; if (active.current) setBusy(""); }
  }
  return <>
    <Button type="button" variant="ghost" disabled={disabled || !address || !!busy} onClick={() => { setOpen(true); }}>Sign offline</Button>
    <Dialog open={open} onOpenChange={value => { if (!pending.current) setOpen(value); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>{prepared?.review.title ?? "Prepare for offline signing"}</DialogTitle><DialogDescription>{confirmed ? "The network confirmed this action." : hash ? "Signed and saved on this device. Reconnect to submit it." : prepared ? "You can disconnect now. Signing saves this action locally without submitting it." : "Capture the current account and network rules while connected. Review and sign after disconnecting."}</DialogDescription></DialogHeader>
        {prepared && <ActionDetails review={prepared.review} />}
        {hash && <p className="break-all font-mono text-caption text-muted-foreground">{hash}</p>}
        {error && <p role="alert" className="break-words text-ui text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" disabled={!!busy} onClick={() => setOpen(false)}>Close</Button>
          {!prepared ? <Button disabled={!!busy} onClick={() => run("Preparing…", async () => {
            const result = await invoke<Prepared>("prepare_offline_review", { request, rpcUrl, expectedAccount: address });
            if (current()) setPrepared(result);
          })}>{busy || "Prepare action"}</Button>
            : !hash ? <Button disabled={!!busy} onClick={() => run("Saving…", async () => {
              const result = await invoke<string>("sign_offline_action", { context: prepared.context, expectedAccount: address });
              if (current()) setHash(result);
            })}>{busy || "Sign and save"}</Button>
            : !confirmed ? <Button disabled={!!busy} onClick={() => run("Submitting…", async () => {
              await invoke("submit_offline_action", { rpcUrl, expectedAccount: address, expectedHash: hash });
              if (current()) setConfirmed(true);
            })}>{busy || "Submit saved action"}</Button> : null}
        </DialogFooter>
        {hash && !confirmed && <Button asChild variant="link"><Link to="/pay/offline">Saved transaction and recovery</Link></Button>}
      </DialogContent>
    </Dialog>
  </>;
}
