import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const edgeFunction = readFileSync(
  '../singra-premium/supabase/functions/admin-team/index.ts',
  'utf8',
);

describe('admin dynamic role permissions contract', () => {
  it('returns assignable roles and dynamic role maps from list_role_permissions', () => {
    expect(edgeFunction).toContain('assignable_roles: assignableRoles');
    expect(edgeFunction).toContain('.from("team_roles")');
    expect(edgeFunction).toContain('createRoleBooleanMap(assignableRoles)');
    expect(edgeFunction).toContain('createLockedRoleMap(assignableRoles');
  });

  it('includes pseudonymized user activity in overview summary', () => {
    expect(edgeFunction).toContain('get_admin_user_activity_summary');
    expect(edgeFunction).toContain('user_activity: userActivity');
    expect(edgeFunction).toContain('isAdminUserActivitySummary');
  });
});