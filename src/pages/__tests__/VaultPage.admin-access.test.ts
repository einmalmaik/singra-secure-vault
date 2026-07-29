// Copyright (c) 2025-2026 Maunting Studios
// Licensed under the Business Source License 1.1 — see LICENSE

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('VaultPage admin access contract', () => {
  it('does not gate admin entry on vault unlock state', () => {
    const source = readFileSync('src/pages/VaultPage.tsx', 'utf8');

    expect(source).toContain('AdminEntryButton');
    expect(source).not.toMatch(/useAdminPanelAccess\(\{[\s\S]*isLocked/);
    expect(source).not.toMatch(/enabled:\s*isPremiumActive\(\)[\s\S]*!isLocked/);
  });
});