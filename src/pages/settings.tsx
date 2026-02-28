import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  Globe,
  Users,
  Shield,
  Lock,
  Loader2,
  Eye,
  EyeOff,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
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

export default function SettingsPage() {
  const { rpcUrl, setRpcUrl, setAddress, setLocked, setVerificationState } = useWallet();
  const navigate = useNavigate();
  const [localRpc, setLocalRpc] = useState(rpcUrl);
  const [representative, setRepresentative] = useState("");
  const [changingRep, setChangingRep] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exportPassword, setExportPassword] = useState("");
  const [exportedSeed, setExportedSeed] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [showSeed, setShowSeed] = useState(false);

  function handleSaveRpc() {
    setRpcUrl(localRpc);
    toast.success("RPC URL updated");
  }

  async function handleChangeRep() {
    if (!representative.startsWith("brst_")) {
      toast.error("Address must start with brst_");
      return;
    }
    setChangingRep(true);
    try {
      const result = await invoke<BlockResult>("change_representative", {
        rpcUrl,
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
    if (!exportPassword) {
      toast.error("Enter your password");
      return;
    }
    setExporting(true);
    try {
      const seed = await invoke<string>("export_mnemonic", {
        password: exportPassword,
      });
      setExportedSeed(seed);
    } catch (e) {
      toast.error("Export failed", { description: String(e) });
    } finally {
      setExporting(false);
    }
  }

  async function handleLock() {
    try {
      await invoke("lock_wallet");
    } catch {
      // may already be locked
    }
    setLocked(true);
    setAddress(null);
    setVerificationState("Unverified");
    navigate("/onboarding");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Node connection, representative, and wallet security.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Globe className="h-4 w-4 text-primary" />
            Node Connection
          </CardTitle>
          <CardDescription>Configure the RPC endpoint</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input
              className="font-mono"
              value={localRpc}
              onChange={(e) => setLocalRpc(e.target.value)}
              placeholder="http://127.0.0.1:7077"
            />
            <Button onClick={handleSaveRpc}>Save</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-4 w-4 text-primary" />
            Representative
          </CardTitle>
          <CardDescription>
            Change your voting representative for consensus
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input
            className="font-mono"
            placeholder="brst_..."
            value={representative}
            onChange={(e) => setRepresentative(e.target.value)}
          />
          <Button
            onClick={handleChangeRep}
            disabled={changingRep || !representative.trim()}
          >
            {changingRep && <Loader2 className="animate-spin" />}
            Change Representative
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Shield className="h-4 w-4 text-primary" />
            Security
          </CardTitle>
          <CardDescription>
            Export seed and manage wallet security
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button variant="outline" onClick={() => setExportDialogOpen(true)}>
            Export Seed
          </Button>
          <Separator />
          <Button variant="destructive" onClick={handleLock}>
            <Lock className="h-4 w-4" />
            Lock Wallet
          </Button>
        </CardContent>
      </Card>

      <Dialog
        open={exportDialogOpen}
        onOpenChange={(open) => {
          setExportDialogOpen(open);
          if (!open) {
            setExportedSeed(null);
            setExportPassword("");
            setShowSeed(false);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Export Seed</DialogTitle>
            <DialogDescription>
              Enter your password to reveal your mnemonic seed phrase.
            </DialogDescription>
          </DialogHeader>
          {exportedSeed ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <code className="flex-1 break-all rounded-md bg-muted p-3 font-mono text-xs">
                  {showSeed ? exportedSeed : "•".repeat(64)}
                </code>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowSeed(!showSeed)}
                >
                  {showSeed ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </Button>
              </div>
              <p className="text-xs text-destructive">
                Keep this seed safe. Anyone with access can control your wallet.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <Input
                type="password"
                placeholder="Wallet password"
                value={exportPassword}
                onChange={(e) => setExportPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleExport()}
              />
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setExportDialogOpen(false)}
                >
                  Cancel
                </Button>
                <Button onClick={handleExport} disabled={exporting}>
                  {exporting && <Loader2 className="animate-spin" />}
                  Reveal Seed
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
