import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20260714054500_registration_verify_rate_limit.sql',
  'utf8',
);

describe('registration verify rate limit migration', () => {
  it('adds the dedicated action without dropping existing actions', () => {
    expect(migration).toContain("'opaque_register_verify'");
    expect(migration).toContain("'opaque_register'");
    expect(migration).toContain("'vault_recovery_code_redeem'");
    expect(migration).toContain('rate_limit_attempts_action_check');
  });
});
