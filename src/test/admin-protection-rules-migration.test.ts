import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20260715040000_admin_protection_rules.sql',
  'utf8',
);

describe('admin protection rules migration', () => {
  it('adds manage permission and a service-role-only rule table', () => {
    expect(migration).toContain("'admin.security.manage'");
    expect(migration).toContain('CREATE TABLE public.admin_protection_rules');
    expect(migration).toContain('REVOKE ALL PRIVILEGES ON TABLE public.admin_protection_rules');
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.list_admin_protection_rules');
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.set_admin_protection_rule');
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.get_auth_protection_rule');
  });

  it('reauthorizes read and manage inside the database with TEXT admin roles', () => {
    expect(migration).toContain("permission.permission_key = 'admin.security.read'");
    expect(migration).toContain("permission.permission_key = 'admin.security.manage'");
    expect(migration).toContain("actor_role.role = 'admin'");
    expect(migration).not.toContain("'admin'::public.app_role");
  });

  it('returns fixed rule fields without identity or Vault data', () => {
    const readFunction = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION public.list_admin_protection_rules'),
      migration.indexOf('CREATE OR REPLACE FUNCTION public.set_admin_protection_rule'),
    );
    const readShape = readFunction.slice(
      readFunction.indexOf('RETURNS TABLE'),
      readFunction.indexOf('LANGUAGE plpgsql'),
    );
    expect(readShape).toContain('action_key TEXT');
    expect(readShape).toContain('max_attempts INTEGER');
    expect(readShape).toContain('window_seconds INTEGER');
    expect(readShape).toContain('lockout_seconds INTEGER');
    expect(readShape).not.toMatch(/\b(identifier|email|ip_address|user_agent|user_id|vault)\b/i);
    expect(migration).toContain("'security.rule.changed'");
    expect(migration).toContain('append_admin_audit_event');
  });
});

describe('protection rule disabled runtime fix migration', () => {
  const fixMigration = readFileSync(
    'supabase/migrations/20260715042000_fix_protection_rule_disabled_runtime.sql',
    'utf8',
  );

  it('returns disabled rules for runtime enforcement decisions', () => {
    expect(fixMigration).toContain('CREATE OR REPLACE FUNCTION public.get_auth_protection_rule');
    expect(fixMigration).not.toContain('AND rules.enabled = TRUE');
    expect(fixMigration).toContain('WHERE rules.action_key = _action_key');
  });
});