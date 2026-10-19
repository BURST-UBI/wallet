import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useNavigate, useLocation } from "react-router-dom";
import { toast } from "sonner";
import { Wallet as WalletNavigationIcon, ArrowLeft, ArrowUpRight, ArrowDownLeft, ShieldCheck, Vote, History, Settings, LockKeyhole, Ellipsis, Wifi } from "lucide-react";
import { WalletIcon, TrstIcon } from "@/components/burst-icons";
import { cn, truncateAddress } from "@/lib/utils";
import { useWallet, useRpc } from "@/hooks/use-wallet";
import { useAutomation } from "@/hooks/use-automation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog";
import { AppearanceToggle } from "@/components/appearance-toggle";
import { PageBoundary } from "@/components/page-boundary";
import { RevocationNotice } from "@/components/revocation-notice";
import type { AccountInfo } from "@/lib/types";
import { viewOnlyPaths } from "@/lib/wallet-access";

const destinations = [
  { to: "/", icon: WalletNavigationIcon, label: "Wallet", group: "everyday" },
  { to: "/history", icon: History, label: "Activity", group: "everyday" },
  { to: "/portfolio", icon: TrstIcon, label: "TRST", group: "everyday" },
  { to: "/verification", icon: ShieldCheck, label: "Verification", group: "community" },
  { to: "/governance", icon: Vote, label: "Governance", group: "community" },
  { to: "/pay", icon: ArrowUpRight, label: "Pay", group: "payments" },
  { to: "/transfer", icon: ArrowUpRight, label: "Transfer", group: "payments" },
  { to: "/receive", icon: ArrowDownLeft, label: "Receive", group: "payments" },
  { to: "/settings", icon: Settings, label: "Settings", group: "settings" },
];

export default function Layout() {
  const automationError = useAutomation();
  const [menuOpen, setMenuOpen] = useState(false);
  const { address, rpcUrl, isLocking, lockWallet, watchOnly } = useWallet();
  const account = useRpc<AccountInfo>("get_account_info", {rpcUrl, expectedAccount: address}, 10_000);
  const verificationState = account.error ? "Status unavailable"
    : account.data?.address === address && account.data?.verification_state
      ? account.data.verification_state[0].toUpperCase() + account.data.verification_state.slice(1).toLowerCase()
      : "Checking verification…";
  const { data: node, error: nodeError } = useRpc<{ network?: string; faucet_enabled?: boolean }>("get_node_info", { rpcUrl }, 10_000);
  const navigate = useNavigate();
  const location = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  const menuNavigated = useRef(false);
  const previousPath = useRef(location.pathname);
  const pageTitle = location.pathname === "/pay/offline" ? "Offline payment" : destinations.find(item => item.to === location.pathname)?.label ?? "Wallet";
  const isPayment = ["/pay", "/pay/offline", "/transfer", "/receive"].includes(location.pathname);

  useEffect(() => {
    if (previousPath.current !== location.pathname) {
      mainRef.current?.scrollTo(0, 0);
      mainRef.current?.focus();
      previousPath.current = location.pathname;
    }
  }, [location.pathname]);

  async function handleLock() {
    try {
      if (await lockWallet()) navigate("/onboarding");
    } catch (error) {
      toast.error("Wallet could not be locked", { description: String(error) });
    }
  }

  function link(item: typeof destinations[number], close = false) {
    if (watchOnly && !viewOnlyPaths.has(item.to)) return null;
    const Icon = item.icon;
    return <NavLink key={item.to} to={item.to} end={item.to === "/"} onClick={() => { if (close) { menuNavigated.current = true; setMenuOpen(false); } }} className="nav-item" aria-label={item.label}>
      <Icon aria-hidden="true" className="size-[18px] shrink-0" /><span>{item.label}</span>
    </NavLink>;
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <aside className="app-sidebar">
        <NavLink to="/" className="brand-lockup" aria-label="Burst wallet home"><WalletIcon className="size-6" /><span className="brand-wordmark">burst<span className="brand-product">Wallet</span></span></NavLink>
        <nav aria-label="Wallet navigation" className="sidebar-navigation">
          <div className="nav-group">{destinations.filter(item => item.group === "everyday").map(item => link(item))}</div>
          {!watchOnly && <div className="nav-group"><p className="nav-group-label">Community</p>{destinations.filter(item => item.group === "community").map(item => link(item))}</div>}
        </nav>
        <div className="sidebar-footer">
          {link(destinations[8])}
          <button className="nav-item w-full" onClick={handleLock} disabled={isLocking} aria-busy={isLocking}><LockKeyhole aria-hidden="true" className="size-[18px]" /><span>{isLocking ? "Locking…" : "Lock wallet"}</span></button>
          <div className="wallet-identity"><span className="identity-dot" /><div className="min-w-0"><p className="truncate" title={address ?? undefined}>{address ? truncateAddress(address) : "Your wallet"}</p><p className="text-caption text-muted-foreground">{verificationState}</p></div></div>
        </div>
      </aside>
      <div className="app-workspace">
        <header className="app-header">
          <div className="flex min-w-0 items-center gap-2">
            <WalletIcon className="mobile-brand size-6" />
            {isPayment && <Button variant="ghost" size="icon" aria-label="Back to wallet" onClick={() => navigate("/")}><ArrowLeft /></Button>}
            <span className={cn("text-ui text-muted-foreground", !isPayment && "mobile-page-title")}>{pageTitle}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="connection-state" title={rpcUrl}><Wifi aria-hidden="true" className={cn("size-3.5", nodeError && "text-warning")} /><span>{nodeError ? "Offline" : node ? "Connected" : "Connecting…"}</span></span>
            <AppearanceToggle />
          </div>
        </header>
        <main ref={mainRef} id="main-content" tabIndex={-1}>
          <div className="app-content">
            <div role="status" className="network-notice">
              {nodeError ? "Network unavailable. Check your node connection." : !node ? "Checking network…" : node.network === "dev" || node.network === "test"
                ? (node.network === "dev" ? "Devnet" : "Testnet") + " · Test funds only, no real value."
                : node.network === "live" ? "Mainnet · Real transactions. Test tools are unavailable."
                  : "Network unknown. Do not assume this is mainnet."}
              {node && (node.network === "dev" || node.network === "test") && <span className="network-detail">{node.faucet_enabled ? "Test faucet enabled." : "Test faucet disabled."}</span>}
            </div>
            {watchOnly && <p role="status" className="mb-4 text-caption text-muted-foreground">View only · Opened by address. Signing is unavailable.</p>}
            {address && <RevocationNotice key={JSON.stringify([rpcUrl, address])} rpcUrl={rpcUrl} address={address} />}
            <PageBoundary key={location.pathname}><Outlet /></PageBoundary>
          </div>
        </main>
        {automationError && <div role="status" className="automation-notice" title={automationError}>Wallet automation paused. Check your connection and pending payments.</div>}
        <nav className="mobile-navigation" aria-label="Mobile wallet navigation">
          {link(destinations[0])}{link(destinations[1])}{link(destinations[watchOnly ? 2 : 7])}
          <Dialog open={menuOpen} onOpenChange={setMenuOpen}>
            <DialogTrigger asChild><button className="nav-item" aria-label="More"><Ellipsis aria-hidden="true" className="size-5" /><span>More</span></button></DialogTrigger>
            <DialogContent className="navigation-dialog" onCloseAutoFocus={event => { if (menuNavigated.current) { event.preventDefault(); menuNavigated.current = false; mainRef.current?.focus(); } }}>
              <DialogHeader><DialogTitle>Your wallet</DialogTitle><DialogDescription>Payments, community, and settings.</DialogDescription></DialogHeader>
              <nav aria-label="All wallet destinations" className="grid grid-cols-2 gap-2">{destinations.filter(item => item.to !== "/" && item.to !== "/history").map(item => link(item, true))}</nav>
              <Button variant="secondary" onClick={handleLock} disabled={isLocking} aria-busy={isLocking}><LockKeyhole />{isLocking ? "Locking…" : "Lock wallet"}</Button>
            </DialogContent>
          </Dialog>
        </nav>
      </div>
    </div>
  );
}
