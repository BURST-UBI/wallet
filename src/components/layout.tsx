import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import {
  LayoutDashboard,
  Zap,
  ArrowUpRight,
  Download,
  Wallet,
  ShieldCheck,
  Vote,
  History,
  Settings,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Wifi,
} from "lucide-react";
import { cn, truncateAddress } from "@/lib/utils";
import { useWallet } from "@/hooks/use-wallet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";

const navItems = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard", desc: "Overview" },
  { to: "/pay", icon: Zap, label: "Pay", desc: "Burn BRN to pay" },
  { to: "/transfer", icon: ArrowUpRight, label: "Transfer", desc: "Send TRST" },
  { to: "/receive", icon: Download, label: "Receive", desc: "Receive TRST" },
  { to: "/portfolio", icon: Wallet, label: "Portfolio", desc: "TRST batches" },
  { to: "/verification", icon: ShieldCheck, label: "Verification", desc: "Identity" },
  { to: "/governance", icon: Vote, label: "Governance", desc: "Vote & delegate" },
  { to: "/history", icon: History, label: "History", desc: "Transactions" },
  { to: "/settings", icon: Settings, label: "Settings", desc: "Configure" },
];

function verificationBadgeVariant(state: string) {
  switch (state) {
    case "Verified":
      return "bg-success/15 text-success border-success/30";
    case "Endorsed":
    case "Voting":
      return "bg-warning/15 text-warning border-warning/30";
    case "Revoked":
    case "Challenged":
      return "bg-destructive/15 text-destructive border-destructive/30";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

export default function Layout() {
  const [collapsed, setCollapsed] = useState(false);
  const { address, verificationState, setAddress, setLocked, setVerificationState } = useWallet();
  const navigate = useNavigate();

  async function handleLock() {
    try {
      await invoke("lock_wallet");
    } catch {
      // already locked
    }
    setLocked(true);
    setAddress(null);
    setVerificationState("Unverified");
    navigate("/onboarding");
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <aside
        className={cn(
          "flex flex-col border-r border-sidebar-border bg-sidebar/80 backdrop-blur-lg text-sidebar-foreground transition-all duration-300",
          collapsed ? "w-16" : "w-60",
        )}
      >
        <div className="flex items-center gap-2 px-4 py-4">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/15 animate-glow-ring">
            <Zap className="h-4 w-4 text-primary" />
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold tracking-wide gradient-text">BURST</p>
              {address && (
                <div className="flex items-center gap-1.5">
                  <p className="truncate font-mono text-[10px] text-muted-foreground">
                    {truncateAddress(address)}
                  </p>
                  <Badge
                    variant="outline"
                    className={cn(
                      "h-4 px-1 text-[9px] font-medium leading-none",
                      verificationBadgeVariant(verificationState),
                    )}
                  >
                    {verificationState}
                  </Badge>
                </div>
              )}
            </div>
          )}
        </div>

        <Separator />

        <ScrollArea className="flex-1 py-2">
          <nav className="flex flex-col gap-0.5 px-2">
            {navItems.map(({ to, icon: Icon, label, desc }) => (
              <Tooltip key={to}>
                <TooltipTrigger asChild>
                  <NavLink
                    to={to}
                    end={to === "/"}
                    className={({ isActive }) =>
                      cn(
                        "group relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-all duration-200 hover:bg-accent hover:text-accent-foreground",
                        isActive
                          ? "bg-accent text-primary"
                          : "text-muted-foreground",
                        collapsed && "justify-center px-0",
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        {isActive && (
                          <div className="absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r-full bg-gradient-to-b from-primary to-primary/60" />
                        )}
                        <Icon className="h-4 w-4 shrink-0" />
                        {!collapsed && (
                          <div className="min-w-0 flex-1">
                            <span>{label}</span>
                            <p className="text-[10px] font-normal text-muted-foreground">
                              {desc}
                            </p>
                          </div>
                        )}
                      </>
                    )}
                  </NavLink>
                </TooltipTrigger>
                {collapsed && (
                  <TooltipContent side="right">{label}</TooltipContent>
                )}
              </Tooltip>
            ))}
          </nav>
        </ScrollArea>

        <Separator />

        <div className="flex flex-col gap-1 p-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size={collapsed ? "icon" : "default"}
                className={cn(
                  "text-muted-foreground hover:text-destructive",
                  !collapsed && "justify-start gap-3",
                )}
                onClick={handleLock}
              >
                <LogOut className="h-4 w-4 shrink-0" />
                {!collapsed && <span>Lock Wallet</span>}
              </Button>
            </TooltipTrigger>
            {collapsed && (
              <TooltipContent side="right">Lock Wallet</TooltipContent>
            )}
          </Tooltip>

          <Button
            variant="ghost"
            size="icon"
            className="self-end text-muted-foreground"
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <ChevronLeft className="h-4 w-4" />
            )}
          </Button>
        </div>
      </aside>

      <div className="flex flex-1 flex-col overflow-hidden">
        <main className="flex-1 overflow-auto">
          <div className="mx-auto max-w-5xl p-6">
            <Outlet />
          </div>
        </main>

        {!collapsed && address && (
          <footer className="flex items-center justify-between border-t border-border/50 bg-card/30 backdrop-blur-sm px-6 py-2">
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <Wifi className="h-3 w-3 text-success" />
              <span>Connected</span>
            </div>
            <p className="font-mono text-[11px] text-muted-foreground">
              {truncateAddress(address)}
            </p>
            <span className="text-[11px] text-muted-foreground">v0.1.0</span>
          </footer>
        )}
      </div>
    </div>
  );
}
