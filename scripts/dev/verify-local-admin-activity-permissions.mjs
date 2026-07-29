#!/usr/bin/env node
import { config } from 'dotenv';
import * as opaque from '@serenity-kit/opaque';
import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const scratchDir = process.env.SINGRA_ADMIN_ACTIVITY_SCRATCH
  ?? 'C:/Users/einma/AppData/Local/Temp/grok-goal-f419ae5cedab/implementer';

config({ path: resolve(repoRoot, '.env') });
config({ path: resolve(repoRoot, '.env.local'), override: true });

await opaque.ready;

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = process.env.SINGRA_DEV_TEST_EMAIL;
const password = process.env.SINGRA_DEV_TEST_PASSWORD;
const lines = [];

function log(line) {
  lines.push(line);
  console.log(line);
}

log('=== scripts/dev/verify-local-admin-activity-permissions.mjs ===');
log(`timestamp: ${new Date().toISOString()}`);
log(`supabase_url: ${url ?? 'missing'}`);

if (!url || !key || !service || !email || !password) {
  log('SKIP: incomplete local env for admin activity/permissions verification');
  writeFileSync(resolve(scratchDir, 'local-admin-activity-permissions.log'), `${lines.join('\n')}\n`);
  process.exit(0);
}

const { clientLoginState, startLoginRequest } = opaque.client.startLogin({ password });
const startRes = await fetch(`${url}/functions/v1/auth-opaque`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
  body: JSON.stringify({ action: 'login-start', userIdentifier: email, startLoginRequest }),
});
const startJson = await startRes.json();
const finished = opaque.client.finishLogin({
  clientLoginState,
  loginResponse: startJson.loginResponse,
  password,
  keyStretching: 'memory-constrained',
});
const finishRes = await fetch(`${url}/functions/v1/auth-opaque`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
  body: JSON.stringify({
    action: 'login-finish',
    userIdentifier: email,
    finishLoginRequest: finished.finishLoginRequest,
    loginId: startJson.loginId,
    skipCookie: true,
  }),
});
const finishJson = await finishRes.json();
const token = finishJson.session?.access_token;
log(`login status=${finishRes.status} has_token=${Boolean(token)}`);

async function invokeAdminTeam(body) {
  const response = await fetch(`${url}/functions/v1/admin-team`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      apikey: key,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: response.status, json };
}

const overview = await invokeAdminTeam({ action: 'get_overview_summary' });
log(`overview status=${overview.status} success=${overview.json?.success}`);
log(`overview activity=${JSON.stringify(overview.json?.summary?.user_activity ?? null)}`);

const customRole = `qa_role_${Date.now().toString(36).slice(-6)}`;
const createRole = await invokeAdminTeam({
  action: 'create_role',
  role_name: customRole,
  description: 'verification role',
});
log(`create_role status=${createRole.status} success=${createRole.json?.success} role=${customRole}`);

const matrixBefore = await invokeAdminTeam({ action: 'list_role_permissions' });
const assignable = matrixBefore.json?.assignable_roles ?? [];
log(`matrix roles count=${assignable.length} includes_custom=${assignable.includes(customRole)}`);

const setPermission = await invokeAdminTeam({
  action: 'set_role_permission',
  role: customRole,
  permission_key: 'team.roles.read',
  enabled: true,
});
log(`set_role_permission status=${setPermission.status} success=${setPermission.json?.success}`);

const matrixAfter = await invokeAdminTeam({ action: 'list_role_permissions' });
const row = (matrixAfter.json?.permissions ?? []).find((entry) => entry.permission_key === 'team.roles.read');
log(`matrix reload custom_enabled=${Boolean(row?.roles?.[customRole])}`);

const cleanup = await invokeAdminTeam({ action: 'delete_role', role_name: customRole });
log(`delete_role status=${cleanup.status} success=${cleanup.json?.success}`);

writeFileSync(resolve(scratchDir, 'local-admin-activity-permissions.log'), `${lines.join('\n')}\n`);