const DEFAULT_SUMMARY_STATS = ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'];

function parseNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function parseStagesJson(raw) {
  if (!raw || !String(raw).trim()) return null;

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid K6_CUSTOM_STAGES JSON: ${error}`);
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('K6_CUSTOM_STAGES must be a non-empty JSON array');
  }

  for (const stage of parsed) {
    if (!stage || typeof stage !== 'object') {
      throw new Error('Each K6_CUSTOM_STAGES entry must be an object');
    }
    if (!stage.duration || typeof stage.duration !== 'string') {
      throw new Error('Each K6_CUSTOM_STAGES entry requires a duration string');
    }
    if (typeof stage.target !== 'number') {
      throw new Error('Each K6_CUSTOM_STAGES entry requires a numeric target');
    }
  }

  return parsed;
}

function selectStages({
  defaultStages,
  smokeStages,
  tenKStages,
}) {
  const customStages = parseStagesJson(__ENV.K6_CUSTOM_STAGES);
  if (customStages) {
    return customStages;
  }

  const profile = String(__ENV.K6_PROFILE || 'default').trim().toLowerCase();
  if (profile === 'smoke' && Array.isArray(smokeStages) && smokeStages.length > 0) {
    return smokeStages;
  }
  if (profile === '10k' && Array.isArray(tenKStages) && tenKStages.length > 0) {
    return tenKStages;
  }
  return defaultStages;
}

export function getSleepSeconds(defaultSeconds = 1) {
  return Math.max(0, parseNumber(__ENV.K6_SLEEP_SECONDS, defaultSeconds));
}

export function getIntEnv(name, fallback) {
  const value = parseNumber(__ENV[name], fallback);
  return Math.max(0, Math.floor(value));
}

export function getBoolEnv(name, fallback = false) {
  return parseBoolean(__ENV[name], fallback);
}

export function buildRampingOptions({
  scenarioName,
  defaultStages,
  smokeStages,
  tenKStages,
  extraThresholds = {},
  tags = {},
}) {
  if (!scenarioName) throw new Error('scenarioName is required');
  if (!Array.isArray(defaultStages) || defaultStages.length === 0) {
    throw new Error('defaultStages is required');
  }

  const stages = selectStages({
    defaultStages,
    smokeStages,
    tenKStages,
  });

  return {
    scenarios: {
      [scenarioName]: {
        executor: 'ramping-vus',
        startVUs: getIntEnv('K6_START_VUS', 1),
        stages,
        gracefulRampDown: __ENV.K6_GRACEFUL_RAMP_DOWN || '30s',
      },
    },
    thresholds: {
      http_req_failed: [__ENV.K6_HTTP_FAILED_THRESHOLD || 'rate<0.01'],
      http_req_duration: [__ENV.K6_HTTP_P95_THRESHOLD || 'p(95)<800'],
      checks: [__ENV.K6_CHECKS_THRESHOLD || 'rate>0.99'],
      ...extraThresholds,
    },
    summaryTrendStats: DEFAULT_SUMMARY_STATS,
    insecureSkipTLSVerify: getBoolEnv('K6_INSECURE_SKIP_TLS_VERIFY', false),
    discardResponseBodies: !getBoolEnv('K6_KEEP_BODIES', true),
    noConnectionReuse: getBoolEnv('K6_NO_CONNECTION_REUSE', false),
    userAgent: __ENV.K6_USER_AGENT || 'zingra-vault-k6/1.0',
    tags: {
      service: 'zingra-secure-vault',
      scenario: scenarioName,
      ...tags,
    },
  };
}
