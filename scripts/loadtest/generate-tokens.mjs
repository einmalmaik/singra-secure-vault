import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';

function argValue(flag, fallback) {
  const idx = process.argv.indexOf(flag);
  if (idx === -1 || idx + 1 >= process.argv.length) return fallback;
  return process.argv[idx + 1];
}

function requiredEnvAny(names) {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.trim()) return value.trim();
  }
  throw new Error(`Missing one of env vars: ${names.join(', ')}`);
}

function intEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw || !raw.trim()) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid integer for ${name}: ${raw}`);
  }
  return parsed;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureDirForFile(filePath) {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
}

async function readUsersFile(usersPath) {
  const raw = await fs.readFile(usersPath, 'utf8');
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const firstComma = line.indexOf(',');
      if (firstComma === -1) {
        throw new Error(`Invalid line in users file (expected email,password): ${line}`);
      }
      const email = line.slice(0, firstComma).trim();
      const password = line.slice(firstComma + 1).trim();
      if (!email || !password) {
        throw new Error(`Invalid line in users file (empty values): ${line}`);
      }
      return { email, password };
    });
}

async function signInWithRetry(client, email, password, maxRetries, baseDelayMs) {
  let attempt = 0;
  let lastError = null;

  while (attempt <= maxRetries) {
    const { data, error } = await client.auth.signInWithPassword({
      email,
      password,
    });

    if (!error && data.session?.access_token) {
      return { token: data.session.access_token, error: null };
    }

    lastError = error?.message || 'Missing access token';
    const isRateLimited = String(lastError).toLowerCase().includes('rate limit');
    if (!isRateLimited || attempt === maxRetries) {
      return { token: null, error: lastError };
    }

    const jitterMs = Math.floor(Math.random() * baseDelayMs);
    const delayMs = baseDelayMs * (2 ** attempt) + jitterMs;
    await sleep(delayMs);
    attempt += 1;
  }

  return { token: null, error: lastError || 'Unknown sign-in error' };
}

async function main() {
  const supabaseUrl = requiredEnvAny(['SUPABASE_URL', 'VITE_SUPABASE_URL']);
  const anonKey = requiredEnvAny(['SUPABASE_ANON_KEY', 'VITE_SUPABASE_PUBLISHABLE_KEY']);
  const batchSize = intEnv('TOKEN_GEN_BATCH_SIZE', 20);
  const maxRetries = intEnv('TOKEN_GEN_MAX_RETRIES', 5);
  const baseDelayMs = intEnv('TOKEN_GEN_RETRY_BASE_MS', 300);

  const usersPath = path.resolve(
    process.cwd(),
    argValue('--users', process.env.LOADTEST_USERS_FILE || 'loadtest/users.txt'),
  );
  const tokensPath = path.resolve(
    process.cwd(),
    argValue('--output', process.env.LOADTEST_TOKENS_FILE || 'loadtest/tokens.txt'),
  );

  const users = await readUsersFile(usersPath);
  if (users.length === 0) {
    throw new Error(`No users found in ${usersPath}`);
  }

  const client = createClient(supabaseUrl, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  const tokens = [];
  const failures = [];

  for (let offset = 0; offset < users.length; offset += batchSize) {
    const chunk = users.slice(offset, offset + batchSize);
    const results = await Promise.all(
      chunk.map(async ({ email, password }) => {
        const result = await signInWithRetry(
          client,
          email,
          password,
          maxRetries,
          baseDelayMs,
        );
        return { email, token: result.token, error: result.error };
      }),
    );

    for (const result of results) {
      if (result.token) {
        tokens.push(result.token);
      } else {
        failures.push(`${result.email}: ${result.error}`);
      }
    }
  }

  if (tokens.length === 0) {
    throw new Error('Token generation failed for all users.');
  }

  await ensureDirForFile(tokensPath);
  await fs.writeFile(tokensPath, `${tokens.join('\n')}\n`, 'utf8');

  console.log(`Token generation complete. Success: ${tokens.length}, failed: ${failures.length}`);
  console.log(`Tokens file written: ${tokensPath}`);

  if (failures.length > 0) {
    const failedPath = `${tokensPath}.failed.txt`;
    await fs.writeFile(failedPath, `${failures.join('\n')}\n`, 'utf8');
    console.log(`Failures written: ${failedPath}`);
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
