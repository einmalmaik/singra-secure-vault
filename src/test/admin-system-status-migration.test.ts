import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20260714043000_admin_system_status.sql',
  'utf8',
);

describe('admin system status migration', () => {
  it('adds an admin-only service-role RPC', () => {
    expect(migration).toContain("'admin.system.read'");
    expect(migration).toContain("'admin'::public.app_role, 'admin.system.read'");
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.get_admin_system_status');
    expect(migration).toContain("SECURITY DEFINER\nSET search_path = ''");
    expect(migration).toContain('TO service_role');
    expect(migration).toContain('FROM PUBLIC, anon, authenticated');
  });

  it('rechecks the actor and reports only evidence-backed booleans', () => {
    expect(migration).toContain("actor_role.role = 'admin'::public.app_role");
    expect(migration).toContain("permission.permission_key = 'admin.system.read'");
    expect(migration).toContain("bucket.id = 'vault-attachments'");
    expect(migration).toContain('relation.relrowsecurity');
    expect(migration).toContain('relation.relforcerowsecurity');
    expect(migration).toContain("row_trigger.tgname = 'prevent_admin_audit_log_row_mutation'");
    expect(migration).toContain("row_trigger.tgenabled IN ('O', 'A')");
    expect(migration).toContain('row_trigger.tgtype = 27');
    expect(migration).toContain("truncate_trigger.tgname = 'prevent_admin_audit_log_truncate'");
    expect(migration).toContain("truncate_trigger.tgenabled IN ('O', 'A')");
    expect(migration).toContain('truncate_trigger.tgtype = 34');
    expect(migration).toContain("'public.prevent_admin_audit_log_mutation()'::pg_catalog.regprocedure");
    expect(migration).toContain("extension.extname = 'pg_cron'");
  });

  it('does not expose infrastructure topology or mutable operational payloads', () => {
    const returnShape = migration.slice(
      migration.indexOf('RETURNS TABLE'),
      migration.indexOf('LANGUAGE plpgsql'),
    );
    expect(returnShape).toContain('database_reachable BOOLEAN');
    expect(returnShape).toContain('checked_at TIMESTAMPTZ');
    expect(returnShape).not.toMatch(/\b(url|host|port|path|secret|queue|payload|email|backup_location)\b/i);
    expect(migration).not.toContain('storage.objects');
    expect(migration).not.toContain('cron.job');
  });
});
