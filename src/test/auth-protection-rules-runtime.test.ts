import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  checkAuthRateLimit,
  clearAuthProtectionRuleCacheForTests,
  DEFAULT_AUTH_RATE_LIMITS,
  resolveAuthRateLimitConfig,
} from '../../supabase/functions/_shared/authRateLimit.ts';

function createRpcClient(rows: Array<Record<string, unknown>> | null, error: { message?: string } | null = null) {
  return {
    from: vi.fn(),
    rpc: vi.fn().mockResolvedValue({ data: rows, error }),
  };
}

describe('resolveAuthRateLimitConfig', () => {
  beforeEach(() => {
    clearAuthProtectionRuleCacheForTests();
  });

  it('uses configured DB limits when the rule is enabled', async () => {
    const client = createRpcClient([{
      enabled: true,
      max_attempts: 9,
      window_seconds: 1200,
      lockout_seconds: 2400,
    }]);

    const config = await resolveAuthRateLimitConfig(client, 'opaque_login');

    expect(config.maxAttempts).toBe(9);
    expect(config.windowMs).toBe(1_200_000);
    expect(config.lockoutMs).toBe(2_400_000);
    expect(config.enforcementEnabled).toBe(true);
  });

  it('disables enforcement when the server rule is inactive', async () => {
    const client = createRpcClient([{
      enabled: false,
      max_attempts: 9,
      window_seconds: 1200,
      lockout_seconds: 2400,
    }]);

    const config = await resolveAuthRateLimitConfig(client, 'opaque_login');

    expect(config.maxAttempts).toBe(9);
    expect(config.enforcementEnabled).toBe(false);
    expect(config.maxAttempts).not.toBe(DEFAULT_AUTH_RATE_LIMITS.opaque_login.maxAttempts);
  });

  it('falls back to code defaults when the RPC returns no row', async () => {
    const client = createRpcClient([]);

    const config = await resolveAuthRateLimitConfig(client, 'opaque_login');

    expect(config).toEqual(DEFAULT_AUTH_RATE_LIMITS.opaque_login);
  });
});

describe('checkAuthRateLimit', () => {
  beforeEach(() => {
    clearAuthProtectionRuleCacheForTests();
  });

  it('allows requests without querying attempts when enforcement is disabled', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{
        enabled: false,
        max_attempts: 4,
        window_seconds: 900,
        lockout_seconds: 900,
      }],
      error: null,
    });
    const from = vi.fn();
    const client = { rpc, from };

    const state = await checkAuthRateLimit({
      supabaseAdmin: client,
      req: new Request('https://example.test/auth', {
        headers: { 'CF-Connecting-IP': '203.0.113.10' },
      }),
      action: 'opaque_login',
      account: { kind: 'email', value: 'codex@local.de' },
    });

    expect(state.allowed).toBe(true);
    expect(state.status).toBe(200);
    expect(state.limits.enforcementEnabled).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });
});