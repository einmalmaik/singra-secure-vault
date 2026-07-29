import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20260715100000_admin_user_activity_summary.sql',
  'utf8',
);

describe('admin user activity summary migration', () => {
  it('adds a service-role-only aggregate RPC without exposing identifiers', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.get_admin_user_activity_summary');
    expect(migration).toContain('active_accounts INTEGER');
    expect(migration).toContain('suspended_accounts INTEGER');
    expect(migration).toContain('sign_ins_last_24h INTEGER');
    expect(migration).toContain('sign_ins_last_7d INTEGER');
    expect(migration).toContain('last_observed_sign_in_at TIMESTAMPTZ');
    expect(migration).toContain("permission.permission_key = 'team.roles.read'");
    expect(migration).toContain('FROM auth.users AS users');
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.get_admin_user_activity_summary(UUID) TO service_role');
    const aggregateQuery = migration.split('RETURN QUERY')[1] ?? '';
    expect(aggregateQuery).not.toMatch(/user_id|email/i);
    expect(aggregateQuery).toContain('pg_catalog.count(*)');
  });
});