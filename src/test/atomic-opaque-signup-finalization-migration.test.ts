import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20260714053000_atomic_opaque_signup_finalization.sql',
  'utf8',
);

describe('atomic OPAQUE signup finalization', () => {
  it('locks and validates the exact unconsumed signup challenge', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.finish_opaque_signup');
    expect(migration).toContain("challenge.purpose = 'signup'");
    expect(migration).toContain('challenge.consumed_at IS NULL');
    expect(migration).toContain('challenge.expires_at > v_now');
    expect(migration).toContain('FOR UPDATE');
  });

  it('requires a matching confirmed auth user and finalizes all state atomically', () => {
    expect(migration).toContain('auth_user.email_confirmed_at IS NOT NULL');
    expect(migration).toContain('INSERT INTO public.user_opaque_records');
    expect(migration).toContain('SET encrypted_password = NULL');
    expect(migration).toContain("SET auth_protocol = 'opaque'");
    expect(migration).toContain('SET consumed_at = v_now');
  });

  it('is service-role-only', () => {
    expect(migration).toContain('FROM PUBLIC, anon, authenticated');
    expect(migration).toContain('TO service_role');
  });
});
