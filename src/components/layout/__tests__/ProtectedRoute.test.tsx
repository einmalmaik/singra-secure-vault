// Copyright (c) 2025-2026 Maunting Studios
// Licensed under the Business Source License 1.1 - see LICENSE

import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProtectedRoute } from "../ProtectedRoute";

const mockUseAuth = vi.fn();

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

function LocationProbe() {
  const location = useLocation();
  return (
    <div data-testid="location">
      {location.pathname}
      {location.search}
      {location.hash}
    </div>
  );
}

function renderProtectedRoute(path: string, label: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path={path.split("?")[0]}
          element={(
            <ProtectedRoute>
              <div>{label}</div>
              <LocationProbe />
            </ProtectedRoute>
          )}
        />
        <Route path="/auth" element={<LocationProbe />} />
        <Route path="/vault" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ProtectedRoute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows account settings for an authenticated account even before vault unlock", () => {
    mockUseAuth.mockReturnValue({
      user: { id: "user-1", email: "user@example.com" },
      loading: false,
      authReady: true,
      isOfflineSession: false,
    });

    renderProtectedRoute("/settings?tab=security#profile-device-key", "Account security settings");

    expect(screen.getByText("Account security settings")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/settings?tab=security#profile-device-key");
  });

  it("allows the admin console for an authenticated account without vault unlock", () => {
    mockUseAuth.mockReturnValue({
      user: { id: "user-1", email: "admin@example.com" },
      loading: false,
      authReady: true,
      isOfflineSession: false,
    });

    renderProtectedRoute("/admin", "Admin console");

    expect(screen.getByText("Admin console")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/admin");
  });

  it("keeps offline sessions on admin without forcing vault unlock first", () => {
    mockUseAuth.mockReturnValue({
      user: { id: "user-1", email: "admin@example.com" },
      loading: false,
      authReady: true,
      isOfflineSession: true,
    });

    renderProtectedRoute("/admin", "Admin console");

    expect(screen.getByText("Admin console")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/admin");
  });

  it("keeps the full target URL when unauthenticated users are redirected to auth", () => {
    mockUseAuth.mockReturnValue({
      user: null,
      loading: false,
      authReady: true,
      isOfflineSession: false,
    });

    renderProtectedRoute("/settings?tab=security#profile-device-key", "Account security settings");

    const location = screen.getByTestId("location").textContent ?? "";
    expect(location).toContain("/auth?redirect=");
    expect(decodeURIComponent(location)).toContain("/settings?tab=security#profile-device-key");
  });
});
