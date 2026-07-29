#!/usr/bin/env node
import { config } from 'dotenv';
import * as opaque from '@serenity-kit/opaque';
import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const scratchDir = process.env.SINGRA_PROTECTION_RULES_SCRATCH
  ?? 'C:/Users/einma/AppData/Local/Temp/grok-goal-ef3058d12c84/implementer';

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

log('=== scripts/dev/verify-local-protection-rules.mjs ===');
log(`command: node scripts/dev/verify-local-protection-rules.mjs`);
log(`cwd: ${repoRoot}`);
log(`timestamp: ${new Date().toISOString()}`);
log(`supabase_url: ${url}`);

const { clientLoginState, startLoginRequest } = opaque.client.startLogin({ password });
const startRes = await fetch(`${url}/functions/v1/auth-opaque`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
  body: JSON.stringify({ action: 'login-start', userIdentifier: email, startLoginRequest }),
});
const startJson = await startRes.json();
log(`auth-opaque login-start status=${startRes.status}`);

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
log(`auth-opaque login-finish status=${finishRes.status} has_token=${Boolean(token)}`);

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

const list = await invokeAdminTeam({ action: 'list_admin_protection_rules' });
log(`admin-team list_admin_protection_rules status=${list.status} success=${list.json?.success} count=${list.json?.rules?.length ?? 0}`);
log(`admin-team list_admin_protection_rules body=${JSON.stringify(list.json).slice(0, 800)}`);

const before = list.json?.rules?.find((rule) => rule.action_key === 'opaque_login');
const manageEnabled = await invokeAdminTeam({
  action: 'set_admin_protection_rule',
  action_key: 'opaque_login',
  enabled: true,
  max_attempts: 8,
  window_seconds: 900,
  lockout_seconds: 900,
});
log(`admin-team set_admin_protection_rule(enabled=true) status=${manageEnabled.status} success=${manageEnabled.json?.success} max=${manageEnabled.json?.rule?.max_attempts}`);
log(`admin-team set_admin_protection_rule(enabled=true) body=${JSON.stringify(manageEnabled.json)}`);

const admin = createClient(url, service, { auth: { autoRefreshToken: false, persistSession: false } });
const runtimeEnabled = await admin.rpc('get_auth_protection_rule', { _action_key: 'opaque_login' });
log(`rpc get_auth_protection_rule(enabled=true) row=${JSON.stringify(runtimeEnabled.data?.[0] ?? null)}`);

const manageDisabled = await invokeAdminTeam({
  action: 'set_admin_protection_rule',
  action_key: 'opaque_login',
  enabled: false,
  max_attempts: 8,
  window_seconds: 900,
  lockout_seconds: 900,
});
log(`admin-team set_admin_protection_rule(enabled=false) status=${manageDisabled.status} success=${manageDisabled.json?.success} enabled=${manageDisabled.json?.rule?.enabled}`);
log(`admin-team set_admin_protection_rule(enabled=false) body=${JSON.stringify(manageDisabled.json)}`);

const runtimeDisabled = await admin.rpc('get_auth_protection_rule', { _action_key: 'opaque_login' });
log(`rpc get_auth_protection_rule(enabled=false) row=${JSON.stringify(runtimeDisabled.data?.[0] ?? null)}`);

const audit = await invokeAdminTeam({
  action: 'list_admin_audit_events',
  event_type: 'security.rule.changed',
  outcome: 'succeeded',
});
log(`admin-team list_admin_audit_events status=${audit.status} count=${audit.json?.events?.length ?? 0}`);
log(`admin-team list_admin_audit_events body=${JSON.stringify(audit.json).slice(0, 800)}`);

const restore = await invokeAdminTeam({
  action: 'set_admin_protection_rule',
  action_key: 'opaque_login',
  enabled: before?.enabled ?? true,
  max_attempts: before?.max_attempts ?? 5,
  window_seconds: before?.window_seconds ?? 900,
  lockout_seconds: before?.lockout_seconds ?? 900,
});
log(`admin-team restore status=${restore.status} success=${restore.json?.success}`);

writeFileSync(resolve(scratchDir, 'local-supabase-protection-rules.log'), `${lines.join('\n')}\n`);