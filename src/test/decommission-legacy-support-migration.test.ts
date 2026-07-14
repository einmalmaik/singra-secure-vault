import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20260713190000_decommission_legacy_support_system.sql',
  'utf8',
);

describe('legacy support decommission migration', () => {
  it('revokes access and stops runtime integrations without deleting retained rows', () => {
    expect(migration).toContain("permission_key LIKE 'support.%'");
    expect(migration).toContain("REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC, anon, authenticated, service_role");
    expect(migration).toContain('ALTER PUBLICATION supabase_realtime DROP TABLE');
    expect(migration).toContain('ALTER COLUMN user_id DROP NOT NULL');
    expect(migration).toContain('REFERENCES auth.users(id) ON DELETE SET NULL');
    expect(migration).toContain("cron.unschedule('auto-close-stale-support-tickets')");
    expect(migration).toContain('DROP FUNCTION IF EXISTS public.auto_close_stale_support_tickets()');
    expect(migration).not.toMatch(/^\s*DROP\s+TABLE/im);
    expect(migration).not.toMatch(/DELETE\s+FROM\s+public\.support_(tickets|messages|events)/i);
  });
});

const atomicRoleMigration = readFileSync(
  'supabase/migrations/20260713223000_atomic_admin_team_role_update.sql',
  'utf8',
);

const centralAuditMigration = readFileSync(
  'supabase/migrations/20260714023000_admin_audit_log_foundation.sql',
  'utf8',
);

describe('atomic admin role update migration', () => {
  it('keeps role assignment and audit in one service-role-only transaction', () => {
    expect(atomicRoleMigration).toContain('CREATE OR REPLACE FUNCTION public.admin_set_team_member_role');
    expect(atomicRoleMigration).toContain('pg_advisory_xact_lock');
    expect(atomicRoleMigration).toContain("permission.permission_key = 'team.roles.manage'");
    expect(atomicRoleMigration).toContain("RAISE EXCEPTION 'last_admin_protected'");
    expect(centralAuditMigration).toContain('PERFORM public.append_admin_audit_event');
    expect(centralAuditMigration).not.toContain('INSERT INTO public.team_access_audit_log');
    expect(atomicRoleMigration).toContain('REVOKE ALL ON FUNCTION public.admin_set_team_member_role');
    expect(atomicRoleMigration).toContain('TO service_role');
  });
});