// Copyright (c) 2025-2026 Maunting Studios
// Licensed under the Business Source License 1.1 — see LICENSE

import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminEntryButton } from '@/components/admin/AdminEntryButton';

const mockUseAdminPanelAccess = vi.fn();
const mockIsPremiumActive = vi.fn();

vi.mock('@/hooks/use-admin-panel-access', () => ({
  useAdminPanelAccess: (options?: { enabled?: boolean }) => mockUseAdminPanelAccess(options),
}));

vi.mock('@/extensions/registry', () => ({
  isPremiumActive: () => mockIsPremiumActive(),
}));

vi.mock('@/platform/appShell', () => ({
  getAdminEntryPath: () => '/admin',
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

describe('AdminEntryButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsPremiumActive.mockReturnValue(true);
    mockUseAdminPanelAccess.mockReturnValue({
      isAdminUser: true,
      showAdminButton: true,
    });
  });

  it('loads admin access without requiring vault unlock state', () => {
    render(
      <MemoryRouter initialEntries={['/vault']}>
        <AdminEntryButton />
      </MemoryRouter>,
    );

    expect(mockUseAdminPanelAccess).toHaveBeenCalledWith({ enabled: true });
  });

  it('navigates to the admin route when visible', () => {
    render(
      <MemoryRouter initialEntries={['/vault']}>
        <Routes>
          <Route path="/vault" element={<AdminEntryButton />} />
          <Route path="/admin" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'admin.title' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/admin');
  });

  it('stays hidden without server-confirmed admin access', () => {
    mockUseAdminPanelAccess.mockReturnValue({
      isAdminUser: false,
      showAdminButton: false,
    });

    render(
      <MemoryRouter>
        <AdminEntryButton />
      </MemoryRouter>,
    );

    expect(screen.queryByRole('button', { name: 'admin.title' })).not.toBeInTheDocument();
  });
});