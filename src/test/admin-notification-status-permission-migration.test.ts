import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20260714060000_admin_notification_status_permission.sql',
  'utf8',
);

describe('admin notification status permission', () => {
  it('adds only the read permission and grants it to the persisted admin role', () => {
    expect(migration).toContain("'admin.notifications.read'");
    expect(migration).toContain("'admin'::public.app_role, 'admin.notifications.read'");
    expect(migration).not.toContain('admin.notifications.manage');
  });
});
