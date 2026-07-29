import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20260729121000_admin_console_release_contract.sql',
  'utf8',
);
const userDirectoryMigration = readFileSync(
  'supabase/migrations/20260729230000_admin_user_directory_pagination.sql',
  'utf8',
);

describe('admin console release migration', () => {
  it('keeps privileged storage deny-by-default and service-authorized', () => {
    expect(migration).toContain('ALTER TABLE public.user_permission_overrides FORCE ROW LEVEL SECURITY');
    expect(migration).toContain('ALTER TABLE public.admin_notifications FORCE ROW LEVEL SECURITY');
    expect(migration).toContain('ALTER TABLE public.danger_action_requests');
    expect(migration).toContain('REVOKE ALL PRIVILEGES ON TABLE public.admin_notifications');
    expect(migration).not.toContain('CREATE POLICY');
  });

  it('uses the existing one-time reauthentication proof for sensitive writes', () => {
    expect(migration).toContain('PERFORM public.consume_reauth_proof(_reauth_proof_id)');
    expect(migration).toContain('request_admin_danger_action');
    expect(migration).toContain('approve_admin_danger_action');
    expect(migration).toContain('set_admin_global_settings');
    expect(migration).not.toContain('CREATE TABLE public.admin_reauth');
  });

  it('enforces adaptive danger states and four-eyes self-approval protection', () => {
    for (const state of [
      'pending', 'scheduled', 'approved', 'cancelled', 'expired', 'executed', 'failed',
    ]) {
      expect(migration).toContain(`'${state}'`);
    }
    expect(migration).toContain('single_admin_delay');
    expect(migration).toContain('four_eyes');
    expect(migration).toContain('self_approval_forbidden');
    expect(migration).toContain("INTERVAL '10 minutes'");
    expect(migration).toContain("INTERVAL '30 minutes'");
  });

  it('exposes only constrained settings, notification and audit contracts', () => {
    expect(migration).toContain("support_widget_id !~ '^[A-Za-z0-9_-]{1,128}$'");
    expect(migration).toContain('attachment_limit_bytes BETWEEN 1048576 AND 1073741824');
    expect(migration).toContain('notification_retention_days BETWEEN 7 AND 3650');
    expect(migration).toContain('list_admin_notifications');
    expect(migration).toContain('list_admin_audit_events_v2');
    expect(migration).not.toContain('guest_email');
    expect(migration).not.toContain('vault_key');
  });

  it('keeps user-directory search masked, bounded and service-role only', () => {
    expect(userDirectoryMigration).toContain('get_admin_user_directory');
    expect(userDirectoryMigration).toContain("public.has_permission(_actor_user_id, 'team.roles.read')");
    expect(userDirectoryMigration).toContain('pg_catalog.length(normalized_search) > 120');
    expect(userDirectoryMigration).toContain('auth_user.created_at < _cursor_created_at');
    expect(userDirectoryMigration).toContain("|| '***@'");
    expect(userDirectoryMigration).toContain('FROM PUBLIC, anon, authenticated');
    expect(userDirectoryMigration).toContain('TO service_role');
    expect(userDirectoryMigration).not.toContain('RETURNS TABLE(\n  user_id UUID,\n  email TEXT');
  });
});
