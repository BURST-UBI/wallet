import { useEffect, useRef, useState } from "react";
import { GroupPolicySettings } from "@/components/group-policy-settings";
import { useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import {
  Plus,
  FileText,
  Key,
  FolderOpen,
  ArrowLeft,
  Loader2,
  ShieldCheck,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useWallet } from "@/hooks/use-wallet";
import type { WalletInfo } from "@/lib/types";
import { WalletIcon } from "@/components/burst-icons";
import { AppearanceToggle } from "@/components/appearance-toggle";

type FlowStep = "choose" | "create" | "mnemonic" | "private-key" | "keystore" | "keystore-unlock" | "post-create" | "watch";

function StepDots({ current }: { current: FlowStep }) {
  const idx = current === "choose" ? 0 : current === "post-create" ? 2 : 1;
  return (
    <div className="flex items-center justify-center gap-2 mb-6">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className={`h-1.5 rounded-full  ${
            i === idx ? "w-6 bg-primary" : i < idx ? "w-1.5 bg-primary/40" : "w-1.5 bg-muted"
          }`}
        />
      ))}
    </div>
  );
}

export default function Onboarding() {
  return (
    <div className="onboarding-shell relative min-h-dvh pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
      <div className="absolute right-[calc(1.25rem+env(safe-area-inset-right))] top-[calc(1rem+env(safe-area-inset-top))] z-10"><AppearanceToggle /></div>
      <OnboardingFlow />
    </div>
  );
}

function OnboardingFlow() {
  const [step, setStep] = useState<FlowStep>("choose");
  const operationPending = useRef(false);
  const [loading, setLoading] = useState(false);
  const [walletInfo, setWalletInfo] = useState<WalletInfo | null>(null);
  const [mnemonic, setMnemonic] = useState("");
  const [watchAddress, setWatchAddress] = useState("");
  const [watchError, setWatchError] = useState("");
  const [recoveryPhrase, setRecoveryPhrase] = useState<string | null>(null);
  const [backupConfirmed, setBackupConfirmed] = useState(false);
  const [privateKey, setPrivateKey] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [keystorePath, setKeystorePath] = useState("");
  const [savePath, setSavePath] = useState("");
  const [showSave, setShowSave] = useState(false);
  const [groupDraft, setGroupDraft] = useState(false);
  const { setAddress, setLocked, setVerificationState, setWatchOnly } = useWallet();
  const navigate = useNavigate();

  useEffect(() => {
    const heading = document.querySelector<HTMLElement>(".onboarding-shell h1, .onboarding-shell h2, .onboarding-shell [data-slot='card-title']");
    if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
  }, [step, showSave]);

  function finalize(info: WalletInfo) {
    setRecoveryPhrase(null);
    setWalletInfo({ address: info.address, verification_state: info.verification_state });
    setMnemonic("");
    setPrivateKey("");
    setPassword("");
    setConfirmPassword("");
    setAddress(info.address);
    setWatchOnly(info.watch_only === true);
    setLocked(false);
    setVerificationState(info.verification_state);
    if (info.watch_only) navigate("/", { replace: true });
    else {
      toast.success("Wallet ready");
      setStep("post-create");
    }
  }

  async function handleWatch() {
    if (operationPending.current) return;
    operationPending.current = true;
    setLoading(true);
    setWatchError("");
    try {
      finalize(await invoke<WalletInfo>("watch_wallet", { address: watchAddress.trim() }));
    } catch (error) { setWatchError(String(error)); }
    finally { operationPending.current = false; setLoading(false); }
  }

  async function handleCreate() {
    if (operationPending.current) return;
    operationPending.current = true;
    setLoading(true);
    try {
      const info = await invoke<WalletInfo>("create_wallet");
      if (!info.recovery_phrase) throw new Error("Wallet did not return a recovery phrase. Do not continue without a backup.");
      setRecoveryPhrase(info.recovery_phrase);
      setBackupConfirmed(false);
      setWalletInfo(info);
      setShowSave(true);
    } catch (e) {
      toast.error(String(e));
    } finally {
      operationPending.current = false;
      setLoading(false);
    }
  }

  async function handleImportMnemonic() {
    if (!mnemonic.trim()) return;
    if (operationPending.current) return;
    operationPending.current = true;
    setLoading(true);
    try {
      const info = await invoke<WalletInfo>("import_mnemonic", {
        phrase: mnemonic.trim(),
      });
      setWalletInfo(info);
      setShowSave(true);
    } catch (e) {
      toast.error(String(e));
    } finally {
      operationPending.current = false;
      setLoading(false);
    }
  }

  async function handleImportPrivateKey() {
    if (!privateKey.trim()) return;
    if (operationPending.current) return;
    operationPending.current = true;
    setLoading(true);
    try {
      const info = await invoke<WalletInfo>("import_private_key", {
        hexKey: privateKey.trim(),
      });
      setWalletInfo(info);
      setShowSave(true);
    } catch (e) {
      toast.error(String(e));
    } finally {
      operationPending.current = false;
      setLoading(false);
    }
  }

  async function handleSaveKeystore() {
    if (recoveryPhrase && !backupConfirmed) { toast.error("Record your recovery phrase first"); return; }
    if (!password || password !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }
    if (!savePath.trim()) {
      toast.error("Please enter a file path");
      return;
    }
    if (operationPending.current) return;
    operationPending.current = true;
    setLoading(true);
    try {
      await invoke("save_keystore", {
        password,
        path: savePath.trim(),
      });
      toast.success("Keystore saved");
      if (walletInfo) finalize(walletInfo);
    } catch (e) {
      toast.error(String(e));
    } finally {
      operationPending.current = false;
      setLoading(false);
    }
  }

  function handleSkipSave() {
    if (recoveryPhrase && !backupConfirmed) { toast.error("Record your recovery phrase first"); return; }
    if (walletInfo) finalize(walletInfo);
  }

  async function handleLoadKeystore() {
    if (!keystorePath.trim()) return;
    if (operationPending.current) return;
    operationPending.current = true;
    setLoading(true);
    try {
      const loaded = await invoke<boolean>("load_keystore_cmd", {
        path: keystorePath.trim(),
      });
      if (!loaded) {
        toast.error("Failed to load keystore");
        setLoading(false);
        return;
      }
      setStep("keystore-unlock");
    } catch (e) {
      toast.error(String(e));
    } finally {
      operationPending.current = false;
      setLoading(false);
    }
  }

  async function handleUnlock() {
    if (!password) return;
    if (operationPending.current) return;
    operationPending.current = true;
    setLoading(true);
    try {
      const info = await invoke<WalletInfo>("unlock_wallet", { password });
      finalize(info);
    } catch (e) {
      toast.error(String(e));
    } finally {
      operationPending.current = false;
      setLoading(false);
    }
  }

  if (step === "post-create") {
    return (
      <div className="flex min-h-dvh items-center justify-center p-4">
        <div className="mx-auto w-full max-w-md">
          <StepDots current={step} />
          <Card>
            <CardHeader className="text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-warning/10">
                <AlertTriangle className="h-6 w-6 text-warning" />
              </div>
              <CardTitle>Wallet Created</CardTitle>
              <CardDescription>
                Your wallet is ready. Next, ask verified people who know you to vouch for you. Your identity needs to be verified before you can pay, receive income, or vote.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <GroupPolicySettings onDraftChange={setGroupDraft} />
              {groupDraft && <p className="text-caption text-muted-foreground">Save your group rules before continuing.</p>}
              <Button
                className="w-full"
                disabled={groupDraft}
                onClick={() => navigate("/verification")}
              >
                <ShieldCheck className="h-4 w-4" />
                Go to Verification
              </Button>
              <Button
                type="button" variant="ghost"
                className="w-full"
                disabled={groupDraft}
                onClick={() => navigate("/")}
              >
                Go to Dashboard
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (showSave && walletInfo) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-4">
        <div className="mx-auto w-full max-w-md">
          <StepDots current="create" />
          <Card>
            <CardHeader>
              <CardTitle>{recoveryPhrase ? "Back Up Your Wallet" : "Save Keystore"}</CardTitle>
              <CardDescription>
                {recoveryPhrase ? "Your 24 words restore this wallet. Keep them offline and private. An encrypted file is optional." : "Optionally protect this imported wallet with a password and encrypted file. Keep your original recovery material."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form className="space-y-4" onSubmit={event => { event.preventDefault(); handleSaveKeystore(); }}>
              <div>
                <p className="mb-1 text-caption text-muted-foreground">Your address</p>
                <p className="break-all rounded-lg bg-muted p-2.5 font-mono text-caption">
                  {walletInfo.address}
                </p>
              </div>
              {recoveryPhrase && <div className="space-y-3">
                <div className="grid grid-cols-3 gap-2 rounded-lg bg-muted p-3" aria-label="Recovery phrase">
                  {recoveryPhrase.split(" ").map((word, index) => <span key={index} className="font-mono text-caption"><span className="mr-1 text-muted-foreground">{index + 1}.</span>{word}</span>)}
                </div>
                <p className="text-caption text-warning">Anyone with these words can control your wallet. Do not share them or take a cloud-backed screenshot.</p>
                <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={backupConfirmed} onChange={(e) => setBackupConfirmed(e.target.checked)} />I have recorded all 24 words in a safe place.</label>
              </div>}
              <label htmlFor="wallet-password" className="block text-ui">Password</label>
              <Input
                id="wallet-password"
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <label htmlFor="wallet-confirm-password" className="block text-ui">Confirm password</label>
              <Input
                id="wallet-confirm-password"
                type="password"
                placeholder="Confirm password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
              <label htmlFor="wallet-save-path" className="block text-ui">Save file to</label>
              <Input
                id="wallet-save-path"
                placeholder="Full save path (e.g. /home/you/burst-wallet.json)"
                value={savePath}
                onChange={(e) => setSavePath(e.target.value)}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  className="flex-1"
                  type="submit"
                  disabled={loading || (!!recoveryPhrase && !backupConfirmed)}
                >
                  {loading && <Loader2 className="animate-spin" />}
                  Save & Continue
                </Button>
                <Button type="button" variant="ghost" onClick={handleSkipSave} disabled={loading || (!!recoveryPhrase && !backupConfirmed)}>
                  Continue without file
                </Button>
              </div>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (step === "keystore-unlock") {
    return (
      <div className="flex min-h-dvh items-center justify-center p-4">
        <div className="mx-auto w-full max-w-md">
          <StepDots current={step} />
          <Card>
            <CardHeader>
              <CardTitle>Unlock Wallet</CardTitle>
              <CardDescription>
                Enter your password to unlock the keystore.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form className="space-y-4" onSubmit={event => { event.preventDefault(); handleUnlock(); }}>
              <label htmlFor="wallet-password" className="block text-ui">Password</label>
              <Input
                id="wallet-password"
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  className="flex-1"
                  type="submit"
                  disabled={loading}
                >
                  {loading && <Loader2 className="animate-spin" />}
                  Unlock
                </Button>
                <Button type="button" variant="ghost" disabled={loading} onClick={() => { if (!operationPending.current) setStep("choose"); }}>
                  <ArrowLeft className="h-4 w-4" />
                  Back
                </Button>
              </div>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (step === "create") {
    return (
      <div className="flex min-h-dvh items-center justify-center p-4">
        <div className="mx-auto w-full max-w-md">
          <StepDots current={step} />
          <Card>
            <CardHeader>
              <CardTitle>Create New Wallet</CardTitle>
              <CardDescription>
                Generate a fresh BURST wallet with a new keypair.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button
                className="w-full"
                onClick={handleCreate}
                disabled={loading}
              >
                {loading && <Loader2 className="animate-spin" />}
                Generate Wallet
              </Button>
              <Button
                type="button" variant="ghost"
                className="w-full"
                disabled={loading} onClick={() => { if (!operationPending.current) setStep("choose"); }}
              >
                <ArrowLeft className="h-4 w-4" />
                Back
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (step === "watch") {
    return <div className="flex min-h-dvh items-center justify-center px-6 py-16">
      <div className="w-full max-w-md space-y-6">
        <Button variant="ghost" onClick={() => setStep("choose")} disabled={loading}><ArrowLeft />Back</Button>
        <div className="space-y-2"><h1 className="text-title">View a wallet</h1><p className="text-ui text-muted-foreground">Check balances and activity using a public address. No recovery words or private key needed.</p></div>
        <form className="space-y-4" onSubmit={event => { event.preventDefault(); void handleWatch(); }}>
          <div className="space-y-2">
            <label htmlFor="watch-address">Wallet address</label>
            <Input id="watch-address" value={watchAddress} onChange={event => setWatchAddress(event.target.value)} autoComplete="off" spellCheck={false} placeholder="brst_…" aria-invalid={!!watchError} aria-describedby={watchError ? "watch-error" : undefined} disabled={loading} />
            {watchError && <p id="watch-error" role="alert" className="field-error">{watchError}</p>}
          </div>
          <Button type="submit" disabled={loading || !watchAddress.trim()}>{loading ? "Opening…" : "View wallet"}</Button>
        </form>
      </div>
    </div>;
  }

  if (step === "mnemonic") {
    return (
      <div className="flex min-h-dvh items-center justify-center p-4">
        <div className="mx-auto w-full max-w-md">
          <StepDots current={step} />
          <Card>
            <CardHeader>
              <CardTitle>Import from Mnemonic</CardTitle>
              <CardDescription>
                Enter your 24-word recovery phrase.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form className="space-y-4" onSubmit={event => { event.preventDefault(); handleImportMnemonic(); }}>
              <label htmlFor="wallet-mnemonic" className="block text-ui">Recovery phrase</label>
              <textarea
                id="wallet-mnemonic"
                autoComplete="off"
                spellCheck={false}
                className="form-control min-h-24 px-3 py-2 text-base"
                aria-label="24-word recovery phrase"
                placeholder="word1 word2 word3 ..."
                value={mnemonic}
                onChange={(e) => setMnemonic(e.target.value)}
              />
              <Button
                className="w-full"
                type="submit"
                disabled={loading || !mnemonic.trim()}
              >
                {loading && <Loader2 className="animate-spin" />}
                Import
              </Button>
              <Button
                type="button" variant="ghost"
                className="w-full"
                disabled={loading} onClick={() => { if (!operationPending.current) setStep("choose"); }}
              >
                <ArrowLeft className="h-4 w-4" />
                Back
              </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (step === "private-key") {
    return (
      <div className="flex min-h-dvh items-center justify-center p-4">
        <div className="mx-auto w-full max-w-md">
          <StepDots current={step} />
          <Card>
            <CardHeader>
              <CardTitle>Import from Private Key</CardTitle>
              <CardDescription>
                Enter your hex-encoded private key.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form className="space-y-4" onSubmit={event => { event.preventDefault(); handleImportPrivateKey(); }}>
              <label htmlFor="wallet-private-key" className="block text-ui">Private key</label>
              <Input
                id="wallet-private-key"
                autoComplete="off"
                spellCheck={false}
                className="font-mono"
                placeholder="Hex private key"
                value={privateKey}
                onChange={(e) => setPrivateKey(e.target.value)}
              />
              <Button
                className="w-full"
                type="submit"
                disabled={loading || !privateKey.trim()}
              >
                {loading && <Loader2 className="animate-spin" />}
                Import
              </Button>
              <Button
                type="button" variant="ghost"
                className="w-full"
                disabled={loading} onClick={() => { if (!operationPending.current) setStep("choose"); }}
              >
                <ArrowLeft className="h-4 w-4" />
                Back
              </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (step === "keystore") {
    return (
      <div className="flex min-h-dvh items-center justify-center p-4">
        <div className="mx-auto w-full max-w-md">
          <StepDots current={step} />
          <Card>
            <CardHeader>
              <CardTitle>Load Existing Keystore</CardTitle>
              <CardDescription>
                Enter the path to your keystore file.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form className="space-y-4" onSubmit={event => { event.preventDefault(); handleLoadKeystore(); }}>
              <label htmlFor="wallet-keystore-path" className="block text-ui">Keystore file</label>
              <Input
                id="wallet-keystore-path"
                placeholder="Path to keystore file"
                value={keystorePath}
                onChange={(e) => setKeystorePath(e.target.value)}
              />
              <Button
                className="w-full"
                type="submit"
                disabled={loading || !keystorePath.trim()}
              >
                {loading && <Loader2 className="animate-spin" />}
                Load Keystore
              </Button>
              <Button
                type="button" variant="ghost"
                className="w-full"
                disabled={loading} onClick={() => { if (!operationPending.current) setStep("choose"); }}
              >
                <ArrowLeft className="h-4 w-4" />
                Back
              </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh items-center justify-center px-6 py-16">
      <div className="flex w-full max-w-xl flex-col items-center gap-7">
        <div className="text-center">
          <div className="mb-6 flex justify-center">
            <WalletIcon className="h-14 w-14" />
          </div>
          <h1 className="text-title font-normal tracking-tight text-foreground sm:text-title">Your Burst wallet</h1>
        </div>

        <div className="w-full max-w-md space-y-3">
          {[
            { step: "create" as FlowStep, icon: Plus, title: "Create New Wallet", desc: "Create a wallet and recovery phrase." },
            { step: "mnemonic" as FlowStep, icon: FileText, title: "Import Mnemonic", desc: "Restore with your 24-word recovery phrase." },
          ].map((item) => (
            <button
              type="button"
              key={item.step}
              aria-label={item.title}
              className={`surface-card pressable w-full rounded-[var(--radius-card)] bg-card shadow-[var(--shadow-card)] text-start cursor-pointer focus-visible:outline-2 focus-visible:outline-primary ${item.step === "create" ? "bg-primary/5 hover:bg-primary/10" : "hover:bg-accent/40"}`}
              onClick={() => setStep(item.step)}
            >
              <CardHeader className="flex-row items-center gap-4 space-y-0 p-5">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-primary/10">
                  <item.icon className="h-5 w-5 text-primary" />
                </div>
                <div>
                <CardTitle className="text-sm">{item.title}</CardTitle>
                <CardDescription className="mt-1.5 text-caption">{item.desc}</CardDescription>
                </div>
              </CardHeader>
            </button>
          ))}
        </div>
        <Button variant="ghost" onClick={() => setStep("watch")}>View a wallet by address</Button>
        <details className="w-full max-w-md text-center">
          <summary className="min-h-11 cursor-pointer content-center rounded-md py-2 text-caption font-normal text-muted-foreground">More ways to restore</summary>
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setStep("private-key")}><Key />Import Private Key</Button>
            <Button variant="outline" size="sm" onClick={() => setStep("keystore")}><FolderOpen />Load Keystore</Button>
          </div>
        </details>
        <p className="max-w-xs text-center text-caption leading-relaxed text-muted-foreground">Keep your recovery phrase private and backed up.</p>
      </div>
    </div>
  );
}
