import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20260714033000_atomic_admin_role_permission_update.sql',
  'utf8',
);

describe('atomic admin role permission migration', () => {
  it('authorizes, serializes and audits the mutation in one RPC transaction', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.admin_set_role_permission');
    expect(migration).toContain('pg_advisory_xact_lock');
    expect(migration).toContain("permission.permission_key = 'team.permissions.manage'");
    expect(migration).toContain('_enabled IS NULL');
    expect(migration).toContain('PERFORM public.append_admin_audit_event');
    expect(migration).toContain("'team.permission.changed'");
    expect(migration).toContain('TO service_role');
    expect(migration).toContain('FROM PUBLIC, anon, authenticated');
  });

  it('prevents removal of the minimum admin control plane', () => {
    for (const permission of [
      'team.roles.read',
      'team.roles.manage',
      'team.permissions.read',
      'team.permissions.manage',
      'admin.audit.read',
    ]) {
      expect(migration).toContain(`'${permission}'`);
    }
    expect(migration).toContain("RAISE EXCEPTION 'protected_admin_permission'");
  });

  it('uses only a constrained code and rejects oversized audit details before mutation', () => {
    expect(migration).toContain('audit_detail_code :=');
    expect(migration).toContain("'[^A-Z0-9]+'");
    expect(migration).toContain("RAISE EXCEPTION 'permission_audit_code_too_long'");
    expect(migration).not.toContain('jsonb_build_object');
    expect(migration).not.toContain('team_access_audit_log');
  });
});
