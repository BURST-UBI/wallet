import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWallet } from "@/hooks/use-wallet";
import Layout from "@/components/layout";
import Onboarding from "@/pages/onboarding";
import Dashboard from "@/pages/dashboard";
import PayPage from "@/pages/pay";
import TransferPage from "@/pages/transfer";
import ReceivePage from "@/pages/receive";
import PortfolioPage from "@/pages/portfolio";
import VerificationPage from "@/pages/verification";
import GovernancePage from "@/pages/governance";
import HistoryPage from "@/pages/history";
import SettingsPage from "@/pages/settings";

function RootRedirect() {
  const { address, isLocked } = useWallet();
  if (!address || isLocked) return <Navigate to="/onboarding" replace />;
  return <Navigate to="/" replace />;
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { address, isLocked } = useWallet();
  if (!address || isLocked) return <Navigate to="/onboarding" replace />;
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
          theme="dark"
          position="bottom-right"
          toastOptions={{
            style: {
              background: "oklch(0.18 0.008 285)",
              border: "1px solid oklch(0.28 0.01 285)",
              color: "oklch(0.95 0.01 90)",
            },
          }}
        />
      </TooltipProvider>
    </BrowserRouter>
  );
}
