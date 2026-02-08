import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate } from 'k6/metrics';
import { buildRampingOptions, getIntEnv, getSleepSeconds } from '../lib/config.js';
import {
  buildRestParams,
  fetchDefaultVaultId,
  getTokenForVu,
  restUrl,
} from '../lib/supabase.js';

const readSuccessRate = new Rate('vault_read_success_rate');
const read429Count = new Counter('vault_read_429_count');
const read5xxCount = new Counter('vault_read_5xx_count');
const missingVaultCount = new Counter('vault_read_missing_default_vault_count');

const defaultItemsLimit = getIntEnv('K6_ITEMS_LIMIT', 200);

export const options = buildRampingOptions({
  scenarioName: 'vault_read',
  defaultStages: [
    { duration: '1m', target: 100 },
    { duration: '3m', target: 1000 },
    { duration: '5m', target: 3000 },
    { duration: '3m', target: 0 },
  ],
  smokeStages: [
    { duration: '30s', target: 10 },
    { duration: '1m', target: 40 },
    { duration: '30s', target: 0 },
  ],
  tenKStages: [
    { duration: '2m', target: 500 },
    { duration: '5m', target: 5000 },
    { duration: '8m', target: 10000 },
    { duration: '10m', target: 10000 },
    { duration: '3m', target: 0 },
  ],
  extraThresholds: {
    vault_read_success_rate: [__ENV.K6_VAULT_READ_SUCCESS_THRESHOLD || 'rate>0.98'],
  },
});

function countErrors(...responses) {
  for (const response of responses) {
    if (!response) continue;
    if (response.status === 429) read429Count.add(1);
    if (response.status >= 500) read5xxCount.add(1);
  }
}

export default function vaultReadScenario() {
  const token = getTokenForVu();
  const vaultId = fetchDefaultVaultId(token);

  if (!vaultId) {
    missingVaultCount.add(1);
    readSuccessRate.add(false);
    sleep(getSleepSeconds(1));
    return;
  }

  const itemsUrl = restUrl(
    `vault_items?select=id,title,item_type,updated_at,is_favorite,category_id&vault_id=eq.${encodeURIComponent(
      vaultId,
    )}&order=updated_at.desc&limit=${defaultItemsLimit}`,
  );
  const categoriesUrl = restUrl(
    'categories?select=id,name,color,icon,updated_at&order=sort_order.asc',
  );

  const [itemsResponse, categoriesResponse] = http.batch([
    {
      method: 'GET',
      url: itemsUrl,
      params: buildRestParams(token, { endpoint: 'vault_items_list' }),
    },
    {
      method: 'GET',
      url: categoriesUrl,
      params: buildRestParams(token, { endpoint: 'categories_list' }),
    },
  ]);

  countErrors(itemsResponse, categoriesResponse);

  const success = check(itemsResponse, {
    'vault items status 200': (r) => r.status === 200,
  }) && check(categoriesResponse, {
    'categories status 200': (r) => r.status === 200,
  });

  readSuccessRate.add(success);
  sleep(getSleepSeconds(1));
}
