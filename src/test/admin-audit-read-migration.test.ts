import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20260714030000_admin_audit_read_contract.sql',
  'utf8',
);

describe('admin audit read migration', () => {
  it('adds an admin-only permission and a service-role-only read RPC', () => {
    expect(migration).toContain("'admin.audit.read'");
    expect(migration).toContain("'admin'::public.app_role, 'admin.audit.read'");
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.list_admin_audit_events');
    expect(migration).toContain("SECURITY DEFINER\nSET search_path = ''");
    expect(migration).toContain('TO service_role');
    expect(migration).toContain('FROM PUBLIC, anon, authenticated');
  });

  it('rechecks authorization and constrains every query parameter', () => {
    expect(migration).toContain("actor_role.role = 'admin'::public.app_role");
    expect(migration).toContain("permission.permission_key = 'admin.audit.read'");
    expect(migration).toContain("RAISE EXCEPTION 'invalid_admin_audit_query'");
    expect(migration).toContain('_limit IS NULL');
    expect(migration).toContain("RAISE EXCEPTION 'invalid_admin_audit_event_type'");
    expect(migration).toContain("RAISE EXCEPTION 'invalid_admin_audit_outcome'");
    expect(migration).toContain('LIMIT _limit');
  });

  it('returns only constrained audit fields and never free-form details', () => {
    const returnShape = migration.slice(
      migration.indexOf('RETURNS TABLE'),
      migration.indexOf('LANGUAGE plpgsql'),
    );
    expect(returnShape).toContain('actor_user_id UUID');
    expect(returnShape).toContain('target_user_id UUID');
    expect(returnShape).toContain('detail_code TEXT');
    expect(returnShape).not.toMatch(/\b(email|ip_address|user_agent|payload|jsonb|vault)\b/i);
  });
});
