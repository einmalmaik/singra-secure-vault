import { describe, expect, it, vi } from 'vitest';

import { analyzeVaultHealth, analyzeVaultHealthSummary } from '@/services/vaultHealthService';

const mockCheckPasswordStrength = vi.hoisted(() => vi.fn(async (password: string) => ({
  score: password === '1234567' || password === 'abcdefg' || password.includes('Weak')
    ? 0
    : password.includes('Moderate')
      ? 2
      : 4,
  isStrong: password !== '1234567' && password !== 'abcdefg' && !password.includes('Moderate') && !password.includes('Weak'),
  feedback: [],
  crackTimeDisplay: 'synthetic-test-display',
})));

const mockCheckPasswordPwned = vi.hoisted(() => vi.fn(async (password: string) => (
  password.includes('Leaked')
    ? { isPwned: true, pwnedCount: 42 }
    : { isPwned: false, pwnedCount: 0 }
)));

vi.mock('@/services/passwordStrengthService', () => ({
  checkPasswordStrength: mockCheckPasswordStrength,
  checkPasswordPwned: mockCheckPasswordPwned,
}));

describe('vaultHealthService', () => {
  it('ignores authenticator entries during password health analysis', async () => {
    const report = await analyzeVaultHealth([
      {
        id: 'pwd-1',
        title: 'Main Login',
        itemType: 'password',
        password: 'CorrectHorseBatteryStaple123!',
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'totp-1',
        title: 'Authenticator Code',
        itemType: 'totp',
        password: '123456',
        updatedAt: new Date().toISOString(),
      },
    ]);

    expect(report.totalItems).toBe(2);
    expect(report.passwordItems).toBe(1);
    expect(report.stats.weak).toBe(0);
    expect(report.stats.pwned).toBe(0);
    expect(report.stats.duplicate).toBe(0);
    expect(report.issues).toHaveLength(0);
  });

  it('still analyzes legacy password items without an explicit item type', async () => {
    const report = await analyzeVaultHealth([
      {
        id: 'legacy-1',
        title: 'Legacy Login',
        password: '1234567',
        updatedAt: new Date().toISOString(),
      },
    ]);

    expect(report.passwordItems).toBe(1);
    expect(report.stats.weak).toBe(1);
    expect(report.issues[0]?.type).toBe('weak');
  });

  it('reports pwned passwords without retaining plaintext in the health report', async () => {
    const report = await analyzeVaultHealth([
      {
        id: 'leaked-1',
        title: 'Synthetic Leaked Login',
        password: 'SyntheticLeakedSecret#2026',
        updatedAt: new Date().toISOString(),
      },
    ]);

    expect(report.stats.pwned).toBe(1);
    expect(report.stats.strong).toBe(0);
    expect(report.issues).toEqual([
      expect.objectContaining({
        itemId: 'leaked-1',
        title: 'Synthetic Leaked Login',
        type: 'pwned',
        severity: 'critical',
        description: '42',
      }),
    ]);
    expect(JSON.stringify(report)).not.toContain('SyntheticLeakedSecret#2026');
  });

  it('groups multiple findings for the same item into one issue row', async () => {
    const report = await analyzeVaultHealth([
      {
        id: 'grouped-1',
        title: 'Grouped Login',
        password: 'SyntheticLeakedWeakSecret#2026',
        updatedAt: new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString(),
      },
      {
        id: 'grouped-2',
        title: 'Duplicate Partner',
        password: 'SyntheticLeakedWeakSecret#2026',
        updatedAt: new Date().toISOString(),
      },
    ]);

    expect(report.stats.weak).toBe(2);
    expect(report.stats.pwned).toBe(2);
    expect(report.stats.duplicate).toBe(2);
    expect(report.stats.old).toBe(1);
    expect(report.issues).toHaveLength(2);
    expect(report.issues[0]).toEqual(expect.objectContaining({
      itemId: 'grouped-1',
      type: 'pwned',
      types: ['pwned', 'weak', 'duplicate', 'old'],
      descriptions: expect.objectContaining({
        pwned: '42',
        weak: 'score_0',
        duplicate: 'Duplicate Partner',
      }),
    }));
    expect(JSON.stringify(report)).not.toContain('SyntheticLeakedWeakSecret#2026');
  });

  it('returns a coarse critical sidebar summary without exposing item details', () => {
    const summaryInput = {
      score: 60,
      passwordItems: 2,
      affectedItems: 1,
      criticalItems: 1,
      warningItems: 0,
      stats: {
        weak: 1,
        pwned: 0,
        duplicate: 0,
        old: 0,
        reused: 0,
        strong: 1,
      },
    };
    const summary = analyzeVaultHealthSummary(summaryInput);

    expect(summary.status).toBe('critical');
    expect(summary.affectedItems).toBe(1);
    expect(summary.criticalItems).toBe(1);
    expect(summary.stats.weak).toBe(1);
    expect(summary.stats.strong).toBe(1);
    expect(summary).not.toHaveProperty('issues');
    expect(JSON.stringify(summaryInput)).not.toContain('1234567');
  });
});
