import { check, sleep } from 'k6';
import exec from 'k6/execution';
import { Counter, Rate } from 'k6/metrics';
import { buildRampingOptions, getSleepSeconds } from '../lib/config.js';
import {
  authPasswordLogin,
  readCredentialsFromEnv,
  safeJson,
} from '../lib/supabase.js';

const loginSuccessRate = new Rate('login_success_rate');
const login429Count = new Counter('login_429_count');
const login5xxCount = new Counter('login_5xx_count');

const credentialPool = readCredentialsFromEnv();
if (credentialPool.length === 0) {
  throw new Error(
    'No login credentials found. Set K6_LOGIN_USERS or K6_LOGIN_USERS_FILE.',
  );
}

export const options = buildRampingOptions({
  scenarioName: 'auth_login',
  defaultStages: [
    { duration: '1m', target: 50 },
    { duration: '3m', target: 300 },
    { duration: '2m', target: 800 },
    { duration: '2m', target: 0 },
  ],
  smokeStages: [
    { duration: '30s', target: 5 },
    { duration: '1m', target: 25 },
    { duration: '30s', target: 0 },
  ],
  tenKStages: [
    { duration: '2m', target: 500 },
    { duration: '4m', target: 2500 },
    { duration: '6m', target: 6000 },
    { duration: '5m', target: 0 },
  ],
  extraThresholds: {
    login_success_rate: [__ENV.K6_LOGIN_SUCCESS_THRESHOLD || 'rate>0.95'],
  },
});

export default function loginScenario() {
  const index =
    (Number(exec.vu.idInTest || 1) - 1 + Number(exec.vu.iterationInScenario || 0)) % credentialPool.length;
  const credential = credentialPool[index];

  const response = authPasswordLogin(credential.email, credential.password, {
    endpoint: 'auth_login_password',
  });

  const payload = safeJson(response);
  const success = check(response, {
    'login status is 200': (r) => r.status === 200,
    'login access token returned': () => Boolean(payload?.access_token),
  });

  loginSuccessRate.add(success);

  if (response.status === 429) login429Count.add(1);
  if (response.status >= 500) login5xxCount.add(1);

  sleep(getSleepSeconds(1));
}
