import encoding from 'k6/encoding';
import http from 'k6/http';
import { check, sleep } from 'k6';
import exec from 'k6/execution';
import { Counter, Rate } from 'k6/metrics';
import { buildRampingOptions, getBoolEnv, getIntEnv, getSleepSeconds } from '../lib/config.js';
import {
  buildRestParams,
  fetchAuthenticatedUserId,
  fetchDefaultVaultId,
  getTokenForVu,
  randomUuidV4,
  restGet,
  restUrl,
} from '../lib/supabase.js';

const offlineSyncSuccessRate = new Rate('offline_sync_replay_success_rate');
const offlineSync429Count = new Counter('offline_sync_replay_429_count');
const offlineSync5xxCount = new Counter('offline_sync_replay_5xx_count');
const offlineSyncMissingUserCount = new Counter('offline_sync_replay_missing_user_count');
const offlineSyncMissingVaultCount = new Counter('offline_sync_replay_missing_vault_count');

const BATCH_SIZE = Math.max(1, getIntEnv('K6_SYNC_BATCH_SIZE', 5));
const CLEANUP_AFTER_SYNC = getBoolEnv('K6_SYNC_CLEANUP', true);
const ITEM_TITLE = __ENV.K6_ITEM_TITLE || 'Encrypted Item';

export const options = buildRampingOptions({
  scenarioName: 'offline_sync_replay',
  defaultStages: [
    { duration: '1m', target: 20 },
    { duration: '3m', target: 200 },
    { duration: '5m', target: 1000 },
    { duration: '3m', target: 0 },
  ],
  smokeStages: [
    { duration: '30s', target: 4 },
    { duration: '1m', target: 15 },
    { duration: '30s', target: 0 },
  ],
  tenKStages: [
    { duration: '2m', target: 120 },
    { duration: '5m', target: 800 },
    { duration: '6m', target: 1600 },
    { duration: '3m', target: 0 },
  ],
  extraThresholds: {
    offline_sync_replay_success_rate: [__ENV.K6_OFFLINE_SYNC_SUCCESS_THRESHOLD || 'rate>0.96'],
  },
});

function countStatusErrors(responses) {
  for (const response of responses) {
    if (!response) continue;
    if (response.status === 429) offlineSync429Count.add(1);
    if (response.status >= 500) offlineSync5xxCount.add(1);
  }
}

function buildEncryptedData(index) {
  const payload = JSON.stringify({
    kind: 'offline-sync-replay',
    index,
    vu: Number(exec.vu.idInTest || 0),
    iteration: Number(exec.scenario.iterationInTest || 0),
    at: Date.now(),
  });
  return encoding.b64encode(payload, 'std');
}

function buildBatchPayload(userId, vaultId) {
  const items = [];
  for (let i = 0; i < BATCH_SIZE; i += 1) {
    items.push({
      id: randomUuidV4(`sync-${exec.vu.idInTest}-${exec.scenario.iterationInTest}-${i}`),
      user_id: userId,
      vault_id: vaultId,
      title: ITEM_TITLE,
      website_url: null,
      icon_url: null,
      item_type: 'password',
      is_favorite: false,
      category_id: null,
      encrypted_data: buildEncryptedData(i),
    });
  }
  return items;
}

function makeUpsertRequests(token, items) {
  return items.map((item, index) => ({
    method: 'POST',
    url: restUrl('vault_items?on_conflict=id'),
    body: JSON.stringify(item),
    params: buildRestParams(
      token,
      { endpoint: 'offline_sync_upsert', batch_index: String(index) },
      {
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
    ),
  }));
}

function makeDeleteRequests(token, items) {
  return items.map((item, index) => ({
    method: 'DELETE',
    url: restUrl(`vault_items?id=eq.${encodeURIComponent(item.id)}`),
    params: buildRestParams(token, { endpoint: 'offline_sync_delete', batch_index: String(index) }),
  }));
}

export default function offlineSyncReplayScenario() {
  const token = getTokenForVu();
  const userId = fetchAuthenticatedUserId(token);
  if (!userId) {
    offlineSyncMissingUserCount.add(1);
    offlineSyncSuccessRate.add(false);
    sleep(getSleepSeconds(1));
    return;
  }

  const vaultId = fetchDefaultVaultId(token);
  if (!vaultId) {
    offlineSyncMissingVaultCount.add(1);
    offlineSyncSuccessRate.add(false);
    sleep(getSleepSeconds(1));
    return;
  }

  const items = buildBatchPayload(userId, vaultId);
  const upsertResponses = http.batch(makeUpsertRequests(token, items));
  countStatusErrors(upsertResponses);

  const refreshResponse = restGet(
    `vault_items?select=id,updated_at&vault_id=eq.${encodeURIComponent(vaultId)}&order=updated_at.desc&limit=100`,
    token,
    { endpoint: 'offline_sync_refresh' },
  );
  countStatusErrors([refreshResponse]);

  let cleanupResponses = [];
  if (CLEANUP_AFTER_SYNC) {
    cleanupResponses = http.batch(makeDeleteRequests(token, items));
    countStatusErrors(cleanupResponses);
  }

  const upsertsOk = check(upsertResponses, {
    'all offline upserts are 201/204': (responses) =>
      responses.every((response) => response.status === 201 || response.status === 204),
  });

  const refreshOk = check(refreshResponse, {
    'offline refresh status 200': (response) => response.status === 200,
  });

  const cleanupOk = !CLEANUP_AFTER_SYNC || check(cleanupResponses, {
    'offline cleanup deletes are 204': (responses) =>
      responses.every((response) => response.status === 204),
  });

  offlineSyncSuccessRate.add(upsertsOk && refreshOk && cleanupOk);
  sleep(getSleepSeconds(1));
}
