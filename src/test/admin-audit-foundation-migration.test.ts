import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20260714023000_admin_audit_log_foundation.sql',
  'utf8',
);

describe('admin audit foundation migration', () => {
  it('creates a constrained append-only table without free-form sensitive metadata', () => {
    expect(migration).toContain('CREATE TABLE public.admin_audit_log');
    expect(migration).toContain('ALTER TABLE public.admin_audit_log FORCE ROW LEVEL SECURITY');
    expect(migration).toContain('BEFORE UPDATE OR DELETE ON public.admin_audit_log');
    expect(migration).toContain('BEFORE TRUNCATE ON public.admin_audit_log');
    expect(migration).toContain("outcome IN ('started', 'succeeded', 'failed', 'denied')");
    expect(migration).toContain("detail_code ~ '^[A-Z][A-Z0-9_]{0,63}$'");
    expect(migration).toContain("reason_code ~ '^[A-Z][A-Z0-9_]{0,63}$'");
    expect(migration).not.toMatch(/\b(email|ip_address|user_agent|vault_data|payload|jsonb)\b/i);
  });

  it('allows writes only through the service-role append boundary', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.append_admin_audit_event');
    expect(migration).toContain("SECURITY DEFINER\nSET search_path = ''");
    expect(migration).toContain(
      'REVOKE ALL PRIVILEGES ON TABLE public.admin_audit_log\n  FROM PUBLIC, anon, authenticated, service_role',
    );
    expect(migration).toContain('TO service_role');
  });

  it('keeps role mutation and its central audit event in one transaction', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.admin_set_team_member_role');
    expect(migration).toContain('pg_advisory_xact_lock');
    expect(migration).toContain("RAISE EXCEPTION 'last_admin_protected'");
    expect(migration).toContain('PERFORM public.append_admin_audit_event');
    expect(migration).toContain("'team.role.changed'");
    expect(migration).toContain("'ROLE_' || pg_catalog.upper(_role::TEXT)");
    expect(migration).not.toContain('INSERT INTO public.team_access_audit_log');
  });
});