import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20260714040000_admin_security_summary.sql',
  'utf8',
);
const textCompatibilityFix = readFileSync(
  'supabase/migrations/20260714200000_fix_has_role_text_compatibility.sql',
  'utf8',
);

describe('admin security summary migration', () => {
  it('adds an admin-only permission and service-role-only RPC', () => {
    expect(migration).toContain("'admin.security.read'");
    expect(migration).toContain("'admin'::public.app_role, 'admin.security.read'");
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.get_admin_security_summary');
    expect(migration).toContain("SECURITY DEFINER\nSET search_path = ''");
    expect(migration).toContain('TO service_role');
    expect(migration).toContain('FROM PUBLIC, anon, authenticated');
  });

  it('rechecks the actor role and permission inside the database', () => {
    expect(migration).toContain("actor_role.role = 'admin'::public.app_role");
    expect(migration).toContain("permission.permission_key = 'admin.security.read'");
    expect(migration).toContain("RAISE EXCEPTION 'invalid_admin_security_query'");
    expect(migration).toContain("RAISE EXCEPTION 'insufficient_permissions'");
  });

  it('returns fixed aggregate windows without identity or Vault fields', () => {
    const returnShape = migration.slice(
      migration.indexOf('RETURNS TABLE'),
      migration.indexOf('LANGUAGE plpgsql'),
    );
    expect(returnShape).toContain('failed_attempts_1h BIGINT');
    expect(returnShape).toContain('failed_attempts_24h BIGINT');
    expect(returnShape).toContain('active_lockouts BIGINT');
    expect(returnShape).not.toMatch(/\b(identifier|email|ip_address|user_agent|user_id|vault)\b/i);
    expect(migration).not.toContain('GROUP BY attempts.identifier');
    expect(migration).toContain('COUNT(DISTINCT (attempts.identifier, attempts.action)) FILTER');
    expect(migration).toContain('MAX(attempts.attempted_at) FILTER');
  });
});

describe('admin text-role compatibility fix migration', () => {
  it('drops legacy app_role overloads and rewrites admin read RPC checks to TEXT', () => {
    expect(textCompatibilityFix).toContain('DROP FUNCTION IF EXISTS public.has_role(UUID, public.app_role)');
    expect(textCompatibilityFix).toContain("actor_role.role = 'admin'");
    expect(textCompatibilityFix).not.toContain("'admin'::public.app_role");
    expect(textCompatibilityFix).toContain('CREATE OR REPLACE FUNCTION public.get_admin_security_summary');
    expect(textCompatibilityFix).toContain('CREATE OR REPLACE FUNCTION public.list_admin_audit_events');
  });
});
