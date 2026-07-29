#!/usr/bin/env node
// Copyright (c) 2025-2026 Maunting Studios
// Licensed under the Business Source License 1.1 - see LICENSE

import { config } from "dotenv";
import * as opaque from "@serenity-kit/opaque";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const scratchDir = process.env.SINGRA_DEV_OPAQUE_VERIFY_SCRATCH
  ? resolve(process.env.SINGRA_DEV_OPAQUE_VERIFY_SCRATCH)
  : join(repoRoot, "tmp", "dev-opaque-verify");

mkdirSync(scratchDir, { recursive: true });

config({ path: join(repoRoot, ".env") });
config({ path: join(repoRoot, ".env.local"), override: true });

await opaque.ready;

const email = process.env.SINGRA_DEV_TEST_EMAIL;
const password = process.env.SINGRA_DEV_TEST_PASSWORD;
const url = process.env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!email || !password || !url || !key) {
  throw new Error("Missing dev OPAQUE verification env (email, password, Supabase URL, publishable key).");
}

const loginStartLog = [];
for (let i = 1; i <= 2; i++) {
  const { startLoginRequest } = opaque.client.startLogin({ password });
  const reqBody = { action: "login-start", userIdentifier: email, startLoginRequest };
  const startRes = await fetch(`${url}/functions/v1/auth-opaque`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(reqBody),
  });
  const startText = await startRes.text();
  loginStartLog.push(`=== run ${i} login-start ===`);
  loginStartLog.push(`request: ${JSON.stringify(reqBody)}`);
  loginStartLog.push(`status: ${startRes.status}`);
  loginStartLog.push(`response: ${startText}`);
}

writeFileSync(join(scratchDir, "auth-opaque-login-start.log"), loginStartLog.join("\n"));

const results = [];
for (let i = 1; i <= 2; i++) {
  const { clientLoginState, startLoginRequest } = opaque.client.startLogin({ password });
  const startRes = await fetch(`${url}/functions/v1/auth-opaque`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      action: "login-start",
      userIdentifier: email,
      startLoginRequest,
    }),
  });
  const startJson = await startRes.json();
  const finished = opaque.client.finishLogin({
    clientLoginState,
    loginResponse: startJson.loginResponse,
    password,
    keyStretching: "memory-constrained",
  });
  if (!finished) {
    throw new Error(`OPAQUE finishLogin failed on run ${i}`);
  }

  const finishRes = await fetch(`${url}/functions/v1/auth-opaque`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      action: "login-finish",
      userIdentifier: email,
      finishLoginRequest: finished.finishLoginRequest,
      loginId: startJson.loginId,
      skipCookie: true,
    }),
  });
  const finishJson = await finishRes.json();
  results.push({
    run: i,
    loginStartStatus: startRes.status,
    loginFinishStatus: finishRes.status,
    hasAccessToken:
      typeof finishJson.session?.access_token === "string" &&
      finishJson.session.access_token.length > 0,
    accessTokenPrefix: finishJson.session?.access_token?.slice(0, 24) ?? null,
  });
}

writeFileSync(join(scratchDir, "dev-opaque-login.json"), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));