// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import VaultHealthPage from './VaultHealthPage';

const mockNavigate = vi.fn();
const mockGetVaultHealthAnalysisItems = vi.fn();
const mockUser = { id: 'user-1' };
let mockVaultDataVersion = 1;
let useFreshAnalysisGetterIdentity = false;
const mockCheckPasswordStrength = vi.hoisted(() => vi.fn(async (password: string) => ({
  score: password === '1234567' || password === 'abcdefg' ? 0 : 4,
  isStrong: password !== '1234567' && password !== 'abcdefg',
  feedback: [],
  crackTimeDisplay: 'synthetic-test-display',
})));
const mockCheckPasswordPwned = vi.hoisted(() => vi.fn(async () => ({
  isPwned: false,
  pwnedCount: 0,
})));

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  Link: ({
    to,
    children,
    onClick,
    ...props
  }: {
    to: string;
    children: React.ReactNode;
    onClick?: React.MouseEventHandler<HTMLAnchorElement>;
  }) => (
    <a
      href={to}
      onClick={(event) => {
        event.preventDefault();
        onClick?.(event);
      }}
      {...props}
    >
      {children}
    </a>
  ),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (key === 'vaultHealth.analyzed') {
        return `${options?.count} von ${options?.total} Passwort-Einträgen analysiert`;
      }
      return key;
    },
  }),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: mockUser }),
}));

vi.mock('@/contexts/VaultContext', () => ({
  useVault: () => ({
    getVaultHealthAnalysisItems: useFreshAnalysisGetterIdentity
      ? () => mockGetVaultHealthAnalysisItems()
      : mockGetVaultHealthAnalysisItems,
    isLocked: false,
    vaultDataVersion: mockVaultDataVersion,
  }),
}));

vi.mock('@/components/Subscription/FeatureGate', () => ({
  FeatureGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/landing/Footer', () => ({
  Footer: () => null,
}));

vi.mock('@/platform/appShell', () => ({
  shouldShowWebsiteChrome: () => false,
}));

vi.mock('@/services/passwordStrengthService', () => ({
  checkPasswordStrength: mockCheckPasswordStrength,
  checkPasswordPwned: mockCheckPasswordPwned,
}));

describe('VaultHealthPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVaultDataVersion = 1;
    useFreshAnalysisGetterIdentity = false;
    mockGetVaultHealthAnalysisItems.mockResolvedValue([
      {
        id: 'weak-1',
        title: 'Weak Login',
        password: '1234567',
        itemType: 'password',
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'weak-2',
        title: 'Second Weak Login',
        password: 'abcdefg',
        itemType: 'password',
        updatedAt: new Date().toISOString(),
      },
    ]);
  });

  it('uses the core health-analysis item API instead of loading vault data directly', async () => {
    render(<VaultHealthPage />);

    await waitFor(() => {
      expect(mockGetVaultHealthAnalysisItems).toHaveBeenCalledTimes(1);
    });

    expect(await screen.findByText('2 von 2 Passwort-Einträgen analysiert')).toBeInTheDocument();
    expect(screen.getByText('vaultHealth.scoreGood')).toBeInTheDocument();
    expect(screen.getByText('vaultHealth.issues (2)')).toBeInTheDocument();
  });

  it('reanalyzes when the vault data version changes after editing an item', async () => {
    mockGetVaultHealthAnalysisItems
      .mockResolvedValueOnce([
        {
          id: 'login-1',
          title: 'First Login',
          password: 'SyntheticStrongSecret#2026-A',
          itemType: 'password',
          updatedAt: new Date().toISOString(),
        },
        {
          id: 'login-2',
          title: 'Second Login',
          password: 'SyntheticStrongSecret#2026-B',
          itemType: 'password',
          updatedAt: new Date().toISOString(),
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'login-1',
          title: 'First Login',
          password: '1234567',
          itemType: 'password',
          updatedAt: new Date().toISOString(),
        },
        {
          id: 'login-2',
          title: 'Second Login',
          password: '1234567',
          itemType: 'password',
          updatedAt: new Date().toISOString(),
        },
      ]);

    const { rerender } = render(<VaultHealthPage />);

    expect(await screen.findByText('vaultHealth.allGood')).toBeInTheDocument();

    mockVaultDataVersion = 2;
    rerender(<VaultHealthPage />);

    await waitFor(() => {
      expect(mockGetVaultHealthAnalysisItems).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByText('vaultHealth.issues (2)')).toBeInTheDocument();
  });

  it('links health issues to the vault preview focus flow', async () => {
    render(<VaultHealthPage />);

    const issueLink = (await screen.findByText('Weak Login')).closest('a');

    expect(issueLink).toHaveAttribute('href', '/vault?item=weak-1&source=vault-health');
  });

  it('does not restart analysis during issue navigation when the vault context rerenders', async () => {
    const { rerender } = render(<VaultHealthPage />);

    const issueLink = (await screen.findByText('Weak Login')).closest('a');
    expect(mockGetVaultHealthAnalysisItems).toHaveBeenCalledTimes(1);

    useFreshAnalysisGetterIdentity = true;
    fireEvent.click(issueLink as HTMLAnchorElement);
    rerender(<VaultHealthPage />);

    await Promise.resolve();

    expect(mockGetVaultHealthAnalysisItems).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('vaultHealth.analyzing')).not.toBeInTheDocument();
  });
});
