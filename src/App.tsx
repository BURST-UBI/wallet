import { lazy } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { viewOnlyPaths } from "@/lib/wallet-access";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWallet } from "@/hooks/use-wallet";
import Layout from "@/components/layout";
import Onboarding from "@/pages/onboarding";
import Dashboard from "@/pages/dashboard";
import PayPage from "@/pages/pay";
import TransferPage from "@/pages/transfer";
import ReceivePage from "@/pages/receive";
const PortfolioPage = lazy(() => import("@/pages/portfolio"));
const VerificationPage = lazy(() => import("@/pages/verification"));
const GovernancePage = lazy(() => import("@/pages/governance"));
const HistoryPage = lazy(() => import("@/pages/history"));
const SettingsPage = lazy(() => import("@/pages/settings"));
const OfflinePayPage = lazy(() => import("@/pages/offline-pay"));

function RootRedirect() {
  const { address, isLocked } = useWallet();
  if (!address || isLocked) return <Navigate to="/onboarding" replace />;
  return <Navigate to="/" replace />;
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { address, isLocked, watchOnly } = useWallet();
  const { pathname } = useLocation();
  if (!address || isLocked) return <Navigate to="/onboarding" replace />;
  if (watchOnly && !viewOnlyPaths.has(pathname)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <TooltipProvider delayDuration={300}>
        <Routes>
          <Route path="/onboarding" element={<Onboarding />} />
          <Route
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route path="/" element={<Dashboard />} />
            <Route path="/pay" element={<PayPage />} />
            <Route path="/pay/offline" element={<OfflinePayPage />} />
            <Route path="/transfer" element={<TransferPage />} />
            <Route path="/receive" element={<ReceivePage />} />
            <Route path="/portfolio" element={<PortfolioPage />} />
            <Route path="/verification" element={<VerificationPage />} />
            <Route path="/governance" element={<GovernancePage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
          <Route path="*" element={<RootRedirect />} />
        </Routes>
        <Toaster
          position="bottom-right"
          mobileOffset={{ bottom: "calc(16px + env(safe-area-inset-bottom, 0px))", left: "calc(16px + env(safe-area-inset-left, 0px))", right: "calc(16px + env(safe-area-inset-right, 0px))" }}
          toastOptions={{
            style: {
              background: "var(--color-popover)",
              border: "1px solid var(--color-border)",
              color: "var(--color-foreground)",
            },
          }}
        />
      </TooltipProvider>
    </BrowserRouter>
  );
}
