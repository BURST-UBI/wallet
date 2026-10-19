import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface DeviceReview {
  head: string;
  grant: string;
  params_hash: string;
  active_here: boolean;
  enrolled: boolean;
}

export function SigningDeviceSettings({ address, rpcUrl }: { address: string; rpcUrl: string }) {
  const [open, setOpen] = useState(false);
  const [review, setReview] = useState<DeviceReview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [complete, setComplete] = useState(false);
  const pending = useRef(false);
  const generation = useRef(0);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => () => { generation.current++; }, []);

  async function inspect() {
    if (pending.current) return;
    pending.current = true;
    const current = generation.current;
    setBusy(true); setError(""); setReview(null); setComplete(false); setOpen(true);
    try {
      const result = await invoke<DeviceReview>("signing_device_status", { rpcUrl, expectedAccount: address });
      if (generation.current === current) setReview(result);
    } catch (e) {
      if (generation.current === current) setError(String(e));
    } finally {
      pending.current = false;
      if (generation.current === current) setBusy(false);
    }
  }

  async function takeOver() {
    if (!review || pending.current) return;
    pending.current = true;
    const current = generation.current;
    setBusy(true); setError("");
    try {
      await invoke("take_over_signing", { rpcUrl, expectedAccount: address,
        reviewedHead: review.head, reviewedGrant: review.grant, reviewedParams: review.params_hash });
      if (generation.current === current) { setComplete(true); setReview(null); }
    } catch (e) {
      if (generation.current === current) { setError(String(e)); setReview(null); }
    } finally {
      pending.current = false;
      if (generation.current === current) setBusy(false);
    }
  }

  return <div className="form-field">
    <p className="field-help">One device signs transactions. Other devices can view your wallet by address.</p>
    <div className="field-actions"><Button ref={trigger} variant="secondary" onClick={() => void inspect()}>Signing device</Button></div>
    <Dialog open={open} onOpenChange={value => { if (!busy) setOpen(value); }}>
      <DialogContent onCloseAutoFocus={event => { event.preventDefault(); trigger.current?.focus(); }}>
        <DialogHeader>
          <DialogTitle>{complete || review?.active_here ? "This is your signing device" : "Use this signing device?"}</DialogTitle>
          <DialogDescription>{complete ? "The network confirmed the change. You can sign here, including offline." :
            review?.active_here ? "Your saved device matches the network. No change is needed." :
            "After confirmation, unsent transactions from your previous device will no longer work. Confirmed payments are unchanged. Keep your recovery phrase safe."}</DialogDescription>
        </DialogHeader>
        {busy && <p role="status" className="field-help">{review ? "Waiting for network confirmation…" : "Checking your wallet…"}</p>}
        {error && <div className="space-y-2"><p role="alert" className="field-error">{error}</p><Link className="text-sm underline" to="/pay/offline">Review saved transaction</Link></div>}
        <DialogFooter>
          <Button variant="secondary" disabled={busy} onClick={() => setOpen(false)}>{complete || review?.active_here ? "Done" : "Cancel"}</Button>
          {!complete && !review?.active_here && (review ?
            <Button disabled={busy} aria-busy={busy} onClick={() => void takeOver()}>Use this device</Button> :
            <Button disabled={busy} onClick={() => void inspect()}>Check again</Button>)}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}
