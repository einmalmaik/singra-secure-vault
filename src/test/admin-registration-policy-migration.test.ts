import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20260714050000_admin_registration_policy.sql',
  'utf8',
);

describe('admin registration policy migration', () => {
  it('stores only a constrained singleton registration policy', () => {
    expect(migration).toContain('CREATE TABLE public.admin_platform_settings');
    expect(migration).toContain("CHECK (registration_mode IN ('open', 'closed'))");
    expect(migration).toContain("VALUES (TRUE, 'open')");
    expect(migration).toContain('ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('FORCE ROW LEVEL SECURITY');
    expect(migration).toContain('FROM PUBLIC, anon, authenticated, service_role');
    const tableDefinition = migration.slice(
      migration.indexOf('CREATE TABLE public.admin_platform_settings'),
      migration.indexOf('INSERT INTO public.admin_platform_settings'),
    );
    expect(tableDefinition).not.toMatch(/email|user_agent|ip_address|vault|secret/i);
  });

  it('makes the public policy check service-role-only and fail-closed', () => {
    expect(migration).toContain('FUNCTION public.is_public_registration_open()');
    expect(migration).toContain('), FALSE)');
    expect(migration).toContain('TO service_role');
    expect(migration).toContain('FROM PUBLIC, anon, authenticated');
  });

  it('rechecks admin role and the dedicated read permission', () => {
    expect(migration).toContain("'admin.settings.read'");
    expect(migration).toContain("actor_role.role = 'admin'::public.app_role");
    expect(migration).toContain("permission.permission_key = 'admin.settings.read'");
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.get_admin_global_settings');
  });
});
