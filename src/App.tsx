/**
 * @fileoverview Main App Component
 * 
 * Sets up providers and routing for Singra PW.
 */

import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";

import { ThemeProvider } from "@/contexts/ThemeProvider";
import { AuthProvider } from "@/contexts/AuthContext";
import { VaultProvider } from "@/contexts/VaultContext";
import { SubscriptionProvider } from "@/contexts/SubscriptionContext";

// Import i18n configuration
import "@/i18n";

// Pages
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import VaultPage from "./pages/VaultPage";
import SettingsPage from "./pages/SettingsPage";
import PricingPage from "./pages/PricingPage";
import VaultHealthPage from "./pages/VaultHealthPage";
import AuthenticatorPage from "./pages/AuthenticatorPage";
import NotFound from "./pages/NotFound";
import PrivacyPolicy from "./pages/PrivacyPolicy";
import { CookieConsent } from "./components/CookieConsent";
import Impressum from "./pages/Impressum";
import GrantorVaultPage from "./pages/GrantorVaultPage";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <AuthProvider>
        <SubscriptionProvider>
          <VaultProvider>
            <TooltipProvider>
              <Toaster />
              <Sonner />
              <CookieConsent />
              <BrowserRouter>
                <Routes>
                  <Route path="/" element={<Index />} />
                  <Route path="/auth" element={<Auth />} />
                  <Route path="/vault" element={<VaultPage />} />
                  <Route path="/settings" element={<SettingsPage />} />
                  <Route path="/pricing" element={<PricingPage />} />
                  <Route path="/vault-health" element={<VaultHealthPage />} />
                  <Route path="/authenticator" element={<AuthenticatorPage />} />
                  <Route path="/vault/emergency/:id" element={<GrantorVaultPage />} />
                  <Route path="/privacy" element={<PrivacyPolicy />} />
                  <Route path="/impressum" element={<Impressum />} />
                  {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </BrowserRouter>
            </TooltipProvider>
          </VaultProvider>
        </SubscriptionProvider>
      </AuthProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;

