import encoding from 'k6/encoding';
import { check, sleep } from 'k6';
import exec from 'k6/execution';
import { Counter, Rate } from 'k6/metrics';
import { buildRampingOptions, getBoolEnv, getSleepSeconds } from '../lib/config.js';
import {
  fetchAuthenticatedUserId,
  fetchDefaultVaultId,
  getTokenForVu,
  isStatusAllowed,
  randomUuidV4,
  restDelete,
  restPost,
} from '../lib/supabase.js';

const mutateSuccessRate = new Rate('vault_mutate_success_rate');
const mutate429Count = new Counter('vault_mutate_429_count');
const mutate5xxCount = new Counter('vault_mutate_5xx_count');
const mutateMissingUserCount = new Counter('vault_mutate_missing_user_count');
const mutateMissingVaultCount = new Counter('vault_mutate_missing_vault_count');

const CLEANUP_AFTER_WRITE = getBoolEnv('K6_MUTATE_CLEANUP', true);
const ITEM_TITLE = __ENV.K6_ITEM_TITLE || 'Encrypted Item';

let vuScopedItemId = null;

export const options = buildRampingOptions({
  scenarioName: 'vault_mutate',
  defaultStages: [
    { duration: '1m', target: 50 },
    { duration: '3m', target: 400 },
    { duration: '5m', target: 1500 },
    { duration: '3m', target: 0 },
  ],
  smokeStages: [
    { duration: '30s', target: 5 },
    { duration: '1m', target: 30 },
    { duration: '30s', target: 0 },
  ],
  tenKStages: [
    { duration: '2m', target: 300 },
    { duration: '5m', target: 1500 },
    { duration: '6m', target: 3000 },
    { duration: '3m', target: 0 },
  ],
  extraThresholds: {
    vault_mutate_success_rate: [__ENV.K6_VAULT_MUTATE_SUCCESS_THRESHOLD || 'rate>0.97'],
  },
});

function markStatusCounters(response) {
  if (!response) return;
  if (response.status === 429) mutate429Count.add(1);
  if (response.status >= 500) mutate5xxCount.add(1);
}

function buildEncryptedData() {
  const payload = JSON.stringify({
    kind: 'loadtest',
    vu: Number(exec.vu.idInTest || 0),
    iteration: Number(exec.scenario.iterationInTest || 0),
    at: Date.now(),
  });

  return encoding.b64encode(payload, 'std');
}

export default function vaultMutateScenario() {
  const token = getTokenForVu();
  const userId = fetchAuthenticatedUserId(token);
  if (!userId) {
    mutateMissingUserCount.add(1);
    mutateSuccessRate.add(false);
    sleep(getSleepSeconds(1));
    return;
  }

  const vaultId = fetchDefaultVaultId(token);
  if (!vaultId) {
    mutateMissingVaultCount.add(1);
    mutateSuccessRate.add(false);
    sleep(getSleepSeconds(1));
    return;
  }

  if (!vuScopedItemId) {
    vuScopedItemId = randomUuidV4(`vu-${String(exec.vu.idInTest || '0')}`);
  }

  const itemData = {
    id: vuScopedItemId,
    user_id: userId,
    vault_id: vaultId,
    title: ITEM_TITLE,
    website_url: null,
    icon_url: null,
    item_type: 'password',
    is_favorite: false,
    category_id: null,
    encrypted_data: buildEncryptedData(),
  };

  const upsertResponse = restPost(
    'vault_items?on_conflict=id',
    token,
    itemData,
    {
      tags: { endpoint: 'vault_item_upsert' },
      prefer: 'resolution=merge-duplicates,return=minimal',
    },
  );
  markStatusCounters(upsertResponse);

  let cleanupResponse = null;
  if (CLEANUP_AFTER_WRITE) {
    cleanupResponse = restDelete(
      `vault_items?id=eq.${encodeURIComponent(vuScopedItemId)}`,
      token,
      { endpoint: 'vault_item_delete' },
    );
    markStatusCounters(cleanupResponse);
  }

  const success = check(upsertResponse, {
    'upsert status is 201 or 204': (r) => isStatusAllowed(r, [201, 204]),
  }) && (
    !CLEANUP_AFTER_WRITE
      || check(cleanupResponse, {
        'cleanup delete status is 204': (r) => r.status === 204,
      })
  );

  mutateSuccessRate.add(success);
  sleep(getSleepSeconds(1));
}
