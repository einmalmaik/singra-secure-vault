// Copyright (c) 2025-2026 Maunting Studios
// Licensed under the Business Source License 1.1 — see LICENSE
/**
 * @fileoverview Main App Component — Open Core Architecture
 *
 * Core routes are always available. Premium routes are loaded
 * dynamically via the Extension Registry.
 */

import { HelmetProvider } from "react-helmet-async";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DesktopUpdateOverlay } from "@/components/desktop/DesktopUpdateOverlay";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";

import { ThemeProvider } from "@/contexts/ThemeProvider";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { VaultProvider } from "@/contexts/VaultContext";
import { SubscriptionProvider } from "@/contexts/SubscriptionContext";
import { ProtectedRoute } from "./components/layout/ProtectedRoute";
import { VaultUnlockRequiredRoute } from "./components/layout/VaultUnlockRequiredRoute";
import { CookieConsent } from "./components/CookieConsent";
import { AppConfigurationNotice } from "@/components/AppConfigurationNotice";
import { getExtensionRoutes } from "@/extensions/registry";
import { SingraSupportIntegration } from '@/components/support/SingraSupportIntegration';
import { checkForDesktopUpdates } from "@/services/desktopUpdateService";
import { useEffect } from "react";

// Import i18n configuration
import "@/i18n";

// Core Pages (always available)
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import VaultPage from "./pages/VaultPage";
import SettingsPage from "./pages/SettingsPage";
import VaultSettingsPage from "./pages/VaultSettingsPage";
import NotFound from "./pages/NotFound";
import PrivacyPolicy from "./pages/PrivacyPolicy";
import SecurityWhitepaper from "./pages/SecurityWhitepaper";
import DesktopUpdatePreviewPage from "./pages/DesktopUpdatePreviewPage";
import VaultHealthPage from "./pages/VaultHealthPage";
import AuthenticatorPage from "./pages/AuthenticatorPage";
import GrantorVaultPage from "./pages/GrantorVaultPage";
import SupportPage from './pages/SupportPage';

const queryClient = new QueryClient();

const App = () => {
  const premiumRoutes = getExtensionRoutes();

  useEffect(() => {
    void checkForDesktopUpdates();
  }, []);

  return (
    <HelmetProvider>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <AuthProvider>
            <SubscriptionProvider>
              <VaultProvider>
                <TooltipProvider>
                  <Toaster />
                  <Sonner />
                  <DesktopUpdateOverlay />
                  <BrowserRouter
                    future={{
                      v7_startTransition: true,
                      v7_relativeSplatPath: true,
                    }}
                  >
                    <AppConfigurationNotice />
                    <CookieConsent />
                    <SingraSupportIntegration />
                    <Routes>
                      {/* Core Routes */}
                      <Route path="/" element={<Index />} />
                      <Route path="/auth" element={<Auth />} />
                      <Route
                        path="/vault"
                        element={
                          <ProtectedRoute>
                            <VaultPage />
                          </ProtectedRoute>
                        }
                      />
                      <Route path="/settings" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
                      <Route
                        path="/vault/settings"
                        element={
                          <ProtectedRoute>
                            <VaultUnlockRequiredRoute>
                              <VaultSettingsPage />
                            </VaultUnlockRequiredRoute>
                          </ProtectedRoute>
                        }
                      />
                      {/* Admin route is now registered via initPremium as a premium route */}
                      <Route path="/security" element={<SecurityWhitepaper />} />
                      <Route path="/privacy" element={<PrivacyPolicy />} />
                      <Route path="/support" element={<SupportPage />} />
                      <Route
                        path="/vault-health"
                        element={
                          <ProtectedRoute>
                            <VaultUnlockRequiredRoute>
                              <VaultHealthPage />
                            </VaultUnlockRequiredRoute>
                          </ProtectedRoute>
                        }
                      />
                      <Route
                        path="/authenticator"
                        element={
                          <ProtectedRoute>
                            <VaultUnlockRequiredRoute>
                              <AuthenticatorPage />
                            </VaultUnlockRequiredRoute>
                          </ProtectedRoute>
                        }
                      />
                      <Route
                        path="/vault/emergency/:id"
                        element={
                          <ProtectedRoute>
                            <VaultUnlockRequiredRoute>
                              <GrantorVaultPage />
                            </VaultUnlockRequiredRoute>
                          </ProtectedRoute>
                        }
                      />
                      {import.meta.env.DEV && (
                        <Route
                          path="/debug/desktop-update"
                          element={<DesktopUpdatePreviewPage />}
                        />
                      )}

                      {/* Premium Routes (dynamically registered) */}
                      {premiumRoutes.map((route) => {
                        const requiresVaultUnlock = route.requiresVaultUnlock === true;

                        const routeElement = requiresVaultUnlock
                          ? (
                            <VaultUnlockRequiredRoute>
                              <route.component />
                            </VaultUnlockRequiredRoute>
                          )
                          : <route.component />;

                        return (
                          <Route
                            key={route.path}
                            path={route.path}
                            element={route.protected ? <ProtectedRoute>{routeElement}</ProtectedRoute> : routeElement}
                          />
                        );
                      })}

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
    </HelmetProvider>
  );
};

export default App;
