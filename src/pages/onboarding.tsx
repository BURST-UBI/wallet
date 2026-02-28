import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import {
  Plus,
  FileText,
  Key,
  FolderOpen,
  Zap,
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

type FlowStep = "choose" | "create" | "mnemonic" | "private-key" | "keystore" | "keystore-unlock" | "post-create";

const allSteps: FlowStep[] = ["choose", "create", "mnemonic", "private-key", "keystore", "keystore-unlock", "post-create"];

function StepDots({ current }: { current: FlowStep }) {
  const mainSteps: FlowStep[] = ["choose", "create", "post-create"];
  const idx = current === "choose" ? 0 : current === "post-create" ? 2 : 1;
  return (
    <div className="flex items-center justify-center gap-2 mb-6">
      {mainSteps.map((_, i) => (
        <div
          key={i}
          className={`h-2 rounded-full transition-all duration-300 ${
            i === idx ? "w-6 bg-primary" : i < idx ? "w-2 bg-primary/50" : "w-2 bg-muted"
          }`}
        />
      ))}
    </div>
  );
}

function AnimatedBackground({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center p-4 overflow-hidden">
      <div
        className="absolute inset-0 animate-gradient-shift"
        style={{
          background: "linear-gradient(135deg, oklch(0.145 0.005 285), oklch(0.18 0.03 75 / 0.3), oklch(0.145 0.005 285), oklch(0.16 0.02 285))",
          backgroundSize: "400% 400%",
        }}
      />
      <div className="absolute top-1/4 -left-20 h-64 w-64 rounded-full bg-primary/10 blur-3xl animate-float" />
      <div className="absolute bottom-1/4 -right-20 h-48 w-48 rounded-full bg-primary/8 blur-3xl animate-float" style={{ animationDelay: "1.5s" }} />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-96 w-96 rounded-full bg-primary/5 blur-3xl" />
      <div className="relative z-10 w-full">
        {children}
      </div>
    </div>
  );
}

export default function Onboarding() {
  const [step, setStep] = useState<FlowStep>("choose");
  const [loading, setLoading] = useState(false);
  const [walletInfo, setWalletInfo] = useState<WalletInfo | null>(null);
  const [mnemonic, setMnemonic] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [keystorePath, setKeystorePath] = useState("");
  const [savePath, setSavePath] = useState("");
  const [showSave, setShowSave] = useState(false);
  const { setAddress, setLocked, setVerificationState } = useWallet();
  const navigate = useNavigate();

  function finalize(info: WalletInfo) {
    setAddress(info.address);
    setLocked(false);
    setVerificationState(info.verification_state);
    toast.success("Wallet ready");
    setStep("post-create");
  }

  async function handleCreate() {
    setLoading(true);
    try {
      const info = await invoke<WalletInfo>("create_wallet");
      setWalletInfo(info);
      setShowSave(true);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleImportMnemonic() {
    if (!mnemonic.trim()) return;
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
      setLoading(false);
    }
  }

  async function handleImportPrivateKey() {
    if (!privateKey.trim()) return;
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
      setLoading(false);
    }
  }

  async function handleSaveKeystore() {
    if (!password || password !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }
    if (!savePath.trim()) {
      toast.error("Please enter a file path");
      return;
    }
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
      setLoading(false);
    }
  }

  function handleSkipSave() {
    if (walletInfo) finalize(walletInfo);
  }

  async function handleLoadKeystore() {
    if (!keystorePath.trim()) return;
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
      setLoading(false);
    }
  }

  async function handleUnlock() {
    if (!password) return;
    setLoading(true);
    try {
      const info = await invoke<WalletInfo>("unlock_wallet", { password });
      finalize(info);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setLoading(false);
    }
  }

  if (step === "post-create") {
    return (
      <AnimatedBackground>
        <div className="mx-auto max-w-md animate-fade-in-up">
          <StepDots current={step} />
          <Card className="border-primary/20">
            <CardHeader className="text-center">
              <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-warning/10">
                <AlertTriangle className="h-8 w-8 text-warning" />
              </div>
              <CardTitle>Wallet Created — Not Yet Verified</CardTitle>
              <CardDescription>
                Your wallet is ready but you cannot earn BRN until your identity is verified.
                You need endorsements from verified wallets before you can start accruing birthright income.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button
                className="w-full"
                onClick={() => navigate("/verification")}
              >
                <ShieldCheck className="h-4 w-4" />
                Go to Verification
              </Button>
              <Button
                variant="ghost"
                className="w-full"
                onClick={() => navigate("/")}
              >
                Go to Dashboard
              </Button>
            </CardContent>
          </Card>
        </div>
      </AnimatedBackground>
    );
  }

  if (showSave && walletInfo) {
    return (
      <AnimatedBackground>
        <div className="mx-auto max-w-md animate-fade-in-up">
          <StepDots current="create" />
          <Card className="border-primary/20">
            <CardHeader>
              <CardTitle>Save Keystore</CardTitle>
              <CardDescription>
                Protect your wallet with a password and save the keystore file.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="mb-1 text-xs text-muted-foreground">Your address</p>
                <p className="break-all rounded-md bg-muted p-2 font-mono text-xs">
                  {walletInfo.address}
                </p>
              </div>
              <Input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <Input
                type="password"
                placeholder="Confirm password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
              <Input
                placeholder="Save path (e.g. ~/burst-wallet.json)"
                value={savePath}
                onChange={(e) => setSavePath(e.target.value)}
              />
              <div className="flex gap-2">
                <Button
                  className="flex-1"
                  onClick={handleSaveKeystore}
                  disabled={loading}
                >
                  {loading && <Loader2 className="animate-spin" />}
                  Save & Continue
                </Button>
                <Button variant="ghost" onClick={handleSkipSave}>
                  Skip
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </AnimatedBackground>
    );
  }

  if (step === "keystore-unlock") {
    return (
      <AnimatedBackground>
        <div className="mx-auto max-w-md animate-fade-in-up">
          <StepDots current={step} />
          <Card className="border-primary/20">
            <CardHeader>
              <CardTitle>Unlock Wallet</CardTitle>
              <CardDescription>
                Enter your password to unlock the keystore.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleUnlock()}
              />
              <div className="flex gap-2">
                <Button
                  className="flex-1"
                  onClick={handleUnlock}
                  disabled={loading}
                >
                  {loading && <Loader2 className="animate-spin" />}
                  Unlock
                </Button>
                <Button variant="ghost" onClick={() => setStep("choose")}>
                  <ArrowLeft className="h-4 w-4" />
                  Back
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </AnimatedBackground>
    );
  }

  if (step === "create") {
    return (
      <AnimatedBackground>
        <div className="mx-auto max-w-md animate-fade-in-up">
          <StepDots current={step} />
          <Card className="border-primary/20">
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
                variant="ghost"
                className="w-full"
                onClick={() => setStep("choose")}
              >
                <ArrowLeft className="h-4 w-4" />
                Back
              </Button>
            </CardContent>
          </Card>
        </div>
      </AnimatedBackground>
    );
  }

  if (step === "mnemonic") {
    return (
      <AnimatedBackground>
        <div className="mx-auto max-w-md animate-fade-in-up">
          <StepDots current={step} />
          <Card className="border-primary/20">
            <CardHeader>
              <CardTitle>Import from Mnemonic</CardTitle>
              <CardDescription>
                Enter your 24-word recovery phrase.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <textarea
                className="flex min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="word1 word2 word3 ..."
                value={mnemonic}
                onChange={(e) => setMnemonic(e.target.value)}
              />
              <Button
                className="w-full"
                onClick={handleImportMnemonic}
                disabled={loading || !mnemonic.trim()}
              >
                {loading && <Loader2 className="animate-spin" />}
                Import
              </Button>
              <Button
                variant="ghost"
                className="w-full"
                onClick={() => setStep("choose")}
              >
                <ArrowLeft className="h-4 w-4" />
                Back
              </Button>
            </CardContent>
          </Card>
        </div>
      </AnimatedBackground>
    );
  }

  if (step === "private-key") {
    return (
      <AnimatedBackground>
        <div className="mx-auto max-w-md animate-fade-in-up">
          <StepDots current={step} />
          <Card className="border-primary/20">
            <CardHeader>
              <CardTitle>Import from Private Key</CardTitle>
              <CardDescription>
                Enter your hex-encoded private key.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Input
                className="font-mono"
                placeholder="Hex private key"
                value={privateKey}
                onChange={(e) => setPrivateKey(e.target.value)}
              />
              <Button
                className="w-full"
                onClick={handleImportPrivateKey}
                disabled={loading || !privateKey.trim()}
              >
                {loading && <Loader2 className="animate-spin" />}
                Import
              </Button>
              <Button
                variant="ghost"
                className="w-full"
                onClick={() => setStep("choose")}
              >
                <ArrowLeft className="h-4 w-4" />
                Back
              </Button>
            </CardContent>
          </Card>
        </div>
      </AnimatedBackground>
    );
  }

  if (step === "keystore") {
    return (
      <AnimatedBackground>
        <div className="mx-auto max-w-md animate-fade-in-up">
          <StepDots current={step} />
          <Card className="border-primary/20">
            <CardHeader>
              <CardTitle>Load Existing Keystore</CardTitle>
              <CardDescription>
                Enter the path to your keystore file.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Input
                placeholder="Path to keystore file"
                value={keystorePath}
                onChange={(e) => setKeystorePath(e.target.value)}
              />
              <Button
                className="w-full"
                onClick={handleLoadKeystore}
                disabled={loading || !keystorePath.trim()}
              >
                {loading && <Loader2 className="animate-spin" />}
                Load Keystore
              </Button>
              <Button
                variant="ghost"
                className="w-full"
                onClick={() => setStep("choose")}
              >
                <ArrowLeft className="h-4 w-4" />
                Back
              </Button>
            </CardContent>
          </Card>
        </div>
      </AnimatedBackground>
    );
  }

  return (
    <AnimatedBackground>
      <div className="flex flex-col items-center gap-8">
        <div className="text-center animate-fade-in-up">
          <div className="mb-4 flex justify-center">
            <div className="rounded-full bg-primary/10 p-5 animate-glow-ring">
              <Zap className="h-14 w-14 text-primary animate-pulse-glow" />
            </div>
          </div>
          <h1 className="text-4xl font-bold tracking-tight gradient-text">BURST Wallet</h1>
          <p className="mx-auto mt-3 max-w-sm text-muted-foreground">
            Manage your birthright income (BRN) and transferable trust currency (TRST)
          </p>
        </div>

        <StepDots current={step} />

        <div className="grid w-full max-w-2xl gap-4 sm:grid-cols-2">
          {[
            { step: "create" as FlowStep, icon: Plus, title: "Create New Wallet", desc: "Generate a new keypair", delay: 100 },
            { step: "mnemonic" as FlowStep, icon: FileText, title: "Import Mnemonic", desc: "24-word recovery phrase", delay: 200 },
            { step: "private-key" as FlowStep, icon: Key, title: "Import Private Key", desc: "Hex-encoded key", delay: 300 },
            { step: "keystore" as FlowStep, icon: FolderOpen, title: "Load Keystore", desc: "Existing keystore file", delay: 400 },
          ].map((item) => (
            <Card
              key={item.step}
              className="cursor-pointer border-primary/10 transition-all duration-300 hover:border-primary/40 hover:-translate-y-1 hover:shadow-lg hover:shadow-primary/10 animate-fade-in-up"
              style={{ animationDelay: `${item.delay}ms` }}
              onClick={() => setStep(item.step)}
            >
              <CardHeader className="text-center">
                <div className="mx-auto mb-2 w-fit rounded-lg bg-primary/10 p-3">
                  <item.icon className="h-6 w-6 text-primary" />
                </div>
                <CardTitle className="text-base">{item.title}</CardTitle>
                <CardDescription>{item.desc}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      </div>
    </AnimatedBackground>
  );
}
