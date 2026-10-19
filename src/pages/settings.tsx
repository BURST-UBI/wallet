import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  Lock,
  Loader2,
  Eye,
  EyeOff,
  ChevronDown,
} from "lucide-react";
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
import { useWallet } from "@/hooks/use-wallet";
import type { BlockResult } from "@/lib/types";
import { GroupPolicySettings } from "@/components/group-policy-settings";
import { SigningDeviceSettings } from "@/components/signing-device-settings";

export default function SettingsPage() {
  const { rpcUrl, address, setRpcUrl, isLocking, lockWallet, autoAccept, trustedSenders, mergeLevel, setAutomation, watchOnly } = useWallet();
  const navigate = useNavigate();
  const { hash } = useLocation();
  const securityHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (hash === "#security") {
      securityHeading.current?.scrollIntoView({ block: "start" });
      securityHeading.current?.focus({ preventScroll: true });
    }
  }, [hash]);
  const exportTrigger = useRef<HTMLButtonElement>(null);
  const exportPending = useRef(false);
  const exportSession = useRef(0);
  const [localRpc, setLocalRpc] = useState(rpcUrl);
  const [rpcError, setRpcError] = useState("");
  const [senderError, setSenderError] = useState("");
  const [representative, setRepresentative] = useState("");
  const [changingRep, setChangingRep] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exportPassword, setExportPassword] = useState("");
  const [exportedSeed, setExportedSeed] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [showSeed, setShowSeed] = useState(false);
  const [senderRules, setSenderRules] = useState(trustedSenders.join("\n"));

  function handleExportOpenChange(open: boolean) {
    setExportDialogOpen(open);
    if (!open) {
      exportSession.current++;
      setExportedSeed(null);
      setExportPassword("");
      setShowSeed(false);
    }
  }

  function handleSaveRpc() {
    try {
      const url = new URL(localRpc.trim());
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error();
    } catch { setRpcError("Enter an HTTP or HTTPS node URL without embedded credentials."); return; }
    setRpcError("");
    setRpcUrl(localRpc.trim());
    toast.success("RPC URL updated");
  }

  async function handleChangeRep() {
    if (changingRep) return;
    if (!representative.startsWith("brst_")) {
      toast.error("Address must start with brst_");
      return;
    }
    setChangingRep(true);
    try {
      const result = await invoke<BlockResult>("change_representative", {
        rpcUrl,
        expectedAccount: address,
        rep: representative.trim(),
      });
      if (result.accepted) {
        toast.success("Representative changed", {
          description: `Hash: ${result.hash.slice(0, 16)}…`,
        });
        setRepresentative("");
      } else {
        toast.error("Change rejected", {
          description: result.detail ?? "Unknown error",
        });
      }
    } catch (e) {
      toast.error("Failed to change representative", {
        description: String(e),
      });
    } finally {
      setChangingRep(false);
    }
  }

  async function handleExport() {
    if (exportPending.current) return;
    if (!exportPassword) {
      toast.error("Enter your password");
      return;
    }
    exportPending.current = true;
    const session = exportSession.current;
    setExporting(true);
    try {
      const seed = await invoke<string>("export_private_key", {
        password: exportPassword,
      });
      if (session === exportSession.current) setExportedSeed(seed);
    } catch (e) {
      toast.error("Export failed", { description: String(e) });
    } finally {
      exportPending.current = false;
      setExporting(false);
    }
  }

  async function handleLock() {
    try {
      if (await lockWallet()) navigate("/onboarding");
    } catch (error) {
      toast.error("Wallet could not be locked", { description: String(error) });
    }
  }

  return (
    <div className="settings-page">
      <div className="page-heading"><h1>Settings</h1></div>

      <section className="settings-section" aria-labelledby="connection-heading">
        <div className="settings-section-heading"><h2 id="connection-heading">Connection</h2><p>The node your wallet uses.</p></div>
        <form noValidate className="settings-fields" onSubmit={event => {event.preventDefault(); handleSaveRpc();}}>
          <div className="form-field">
            <label htmlFor="wallet-node-url">Node URL</label>
            <div className="field-action">
              <Input id="wallet-node-url" type="url" value={localRpc} onChange={event => {setLocalRpc(event.target.value); if (rpcError) setRpcError("");}} placeholder="http://127.0.0.1:7077" spellCheck={false} autoComplete="off" aria-invalid={!!rpcError} aria-describedby={rpcError ? "wallet-node-error" : undefined} />
              <Button type="submit" variant="secondary">Save</Button>
            </div>
            {rpcError && <p id="wallet-node-error" role="alert" className="field-error">{rpcError}</p>}
          </div>
        </form>
      </section>

      <section className="settings-section" aria-labelledby="receive-heading">
        <div className="settings-section-heading"><h2 id="receive-heading">Receive &amp; merge</h2><p>Runs while this wallet is open and unlocked.</p></div>
        <div className="settings-fields">
          <label className="settings-checkbox"><input type="checkbox" checked={autoAccept} aria-describedby={!autoAccept ? "receive-cancellation-note" : undefined} onChange={event => setAutomation({autoAccept:event.target.checked})} /><span>Automatically accept incoming TRST</span></label>
          {!autoAccept && <p id="receive-cancellation-note" className="field-help">A payment already being accepted may still finish.</p>}
          <details className="settings-disclosure">
          <summary><span>Allowed senders</span><span className="ml-auto text-caption text-muted-foreground">{trustedSenders.length ? `${trustedSenders.length} allowed` : "All senders"}</span><ChevronDown aria-hidden="true" className="size-4 text-muted-foreground" /></summary>
          <form className="form-field pt-3" onSubmit={event => {
            event.preventDefault();
            const senders = [...new Set(senderRules.split(/\s+/).filter(Boolean))];
            if (senders.some(sender => !/^brst_[13456789abcdefghijkmnopqrstuwxyz]{60}$/.test(sender))) {setSenderError("Enter complete BURST addresses."); return;}
            setSenderError(""); setAutomation({trustedSenders:senders}); toast.success("Receive rules saved");
          }}>
            <label htmlFor="trusted-senders">Allowed senders <span className="text-muted-foreground">(optional)</span></label>
            <textarea id="trusted-senders" className="form-control px-3 py-2 text-base" rows={3} value={senderRules} onChange={event => {setSenderRules(event.target.value); if(senderError) setSenderError("");}} placeholder="One brst_ address per line" spellCheck={false} autoComplete="off" aria-invalid={!!senderError} aria-describedby={senderError ? "sender-error sender-help sender-scope" : "sender-help sender-scope"} />
            <p id="sender-help" className="field-help">Leave empty to accept all. Other senders stay pending.</p>
            <p id="sender-scope" className="field-help">Checks the immediate sender, not origin reputation or group membership.</p>
            {senderError && <p id="sender-error" role="alert" className="field-error">{senderError}</p>}
            <div className="field-actions"><Button type="submit" variant="secondary">Save Receive Rules</Button></div>
          </form>
          </details>
          {trustedSenders.length > 0 && <p className="field-help">Other senders stay pending for manual review.</p>}
          <GroupPolicySettings />
          <div className="form-field border-t pt-5">
            <label htmlFor="merge-level" className="flex items-center justify-between gap-3"><span>Auto-merge</span><output htmlFor="merge-level" className="text-muted-foreground tabular-nums">{mergeLevel === 0 ? "Off" : mergeLevel === 100 ? "Merge all" : `${mergeLevel}/100`}</output></label>
            <input id="merge-level" className="settings-range" type="range" min="0" max="100" step="5" value={mergeLevel} onChange={event => setAutomation({mergeLevel:Number(event.target.value)})} aria-describedby="merge-help" />
            <p id="merge-help" className="field-help">Merging keeps the earliest expiry and all origin/revocation links. It never renews TRST.</p>
            <details className="settings-details"><summary>How the merge level works</summary><p>Default 50 allows up to 10% loss of remaining lifetime: 90–100 days can merge. At 100, all active batches can merge.</p></details>
          </div>
        </div>
      </section>

      <section className="settings-section" aria-labelledby="representative-heading">
        <div className="settings-section-heading"><h2 id="representative-heading">Representative</h2><p>Your voting representative for consensus.</p></div>
        <form className="settings-fields" onSubmit={event => { event.preventDefault(); void handleChangeRep(); }}>
          <div className="form-field"><label htmlFor="representative-address">Representative address</label><Input id="representative-address" placeholder="brst_…" value={representative} onChange={event => setRepresentative(event.target.value)} spellCheck={false} autoComplete="off" /></div>
          <div className="field-actions"><Button type="submit" variant="secondary" disabled={watchOnly || changingRep || !representative.trim()}>{changingRep && <Loader2 className="animate-spin" />}Change Representative</Button>{watchOnly && <p className="field-help">Change this on your signing device.</p>}</div>
        </form>
      </section>

      <section className="settings-section" aria-labelledby="security-heading">
        <div className="settings-section-heading"><h2 ref={securityHeading} tabIndex={-1} id="security-heading">Security</h2><p>Backup and wallet access.</p></div>
        <div className="settings-fields">
          {!watchOnly && address && <SigningDeviceSettings key={`${address}:${rpcUrl}`} address={address} rpcUrl={rpcUrl} />}
          {!watchOnly && <div className="form-field"><p className="field-help">Export a legacy private-key backup. This is not your 24-word recovery phrase.</p><div className="field-actions"><Button ref={exportTrigger} variant="outline" onClick={() => setExportDialogOpen(true)}>Export Private Key</Button></div></div>}
          <div className="field-actions border-t pt-5"><Button variant="secondary" onClick={handleLock} disabled={isLocking} aria-busy={isLocking}><Lock className="size-4" />{isLocking ? "Locking…" : "Lock Wallet"}</Button></div>
        </div>
      </section>

      <Dialog
        open={exportDialogOpen}
        onOpenChange={handleExportOpenChange}
      >
        <DialogContent onCloseAutoFocus={event => { event.preventDefault(); exportTrigger.current?.focus(); }}>
          <DialogHeader>
            <DialogTitle>Export Private Key</DialogTitle>
            <DialogDescription>
              Enter the encrypted file's password to reveal its hex private key. This is not your 24-word phrase. Restore it using Import Private Key.
            </DialogDescription>
          </DialogHeader>
          {exportedSeed ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <code className="flex-1 break-all rounded-md bg-muted p-3 font-mono text-caption">
                  {showSeed ? exportedSeed : "•".repeat(64)}
                </code>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={showSeed ? "Hide private key" : "Show private key"}
                  onClick={() => setShowSeed(!showSeed)}
                >
                  {showSeed ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </Button>
              </div>
              <p className="text-caption text-destructive">
                Keep this key safe. Anyone with access can control your wallet.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <label htmlFor="export-password" className="block text-ui">Wallet password</label>
              <Input
                id="export-password"
                type="password"
                aria-label="Wallet password"
                autoComplete="current-password"
                placeholder="Wallet password"
                value={exportPassword}
                onChange={(e) => setExportPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleExport()}
              />
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => handleExportOpenChange(false)}
                >
                  Cancel
                </Button>
                <Button onClick={handleExport} disabled={exporting}>
                  {exporting && <Loader2 className="animate-spin" />}
                  Reveal private key
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
