#!/usr/bin/env node
// Copyright (c) 2025-2026 Maunting Studios
// Licensed under the Business Source License 1.1 - see LICENSE

import { cpSync, existsSync, lstatSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const premiumFunctionsRoot = resolve(repoRoot, "../singra-premium/supabase/functions");
const coreFunctionsRoot = resolve(repoRoot, "supabase/functions");

const copies = [
  {
    targetDir: resolve(coreFunctionsRoot, "admin-team"),
    sourceDir: resolve(premiumFunctionsRoot, "admin-team"),
    files: ["index.ts"],
  },
  {
    targetDir: resolve(coreFunctionsRoot, "create-checkout-session"),
    sourceDir: resolve(premiumFunctionsRoot, "create-checkout-session"),
    files: ["index.ts"],
  },
  {
    targetDir: resolve(coreFunctionsRoot, "public-support-config"),
    sourceDir: resolve(premiumFunctionsRoot, "public-support-config"),
    files: ["index.ts"],
  },
  {
    targetDir: resolve(coreFunctionsRoot, "singra-support-webhook"),
    sourceDir: resolve(premiumFunctionsRoot, "singra-support-webhook"),
    files: ["index.ts"],
  },
  {
    targetDir: resolve(coreFunctionsRoot, "send-test-mail"),
    sourceDir: resolve(premiumFunctionsRoot, "send-test-mail"),
    files: ["index.ts"],
  },
  {
    targetDir: resolve(coreFunctionsRoot, "_shared"),
    sourceDir: resolve(premiumFunctionsRoot, "_shared"),
    files: ["billing-return-url.ts", "html.ts", "singraWebhook.ts"],
    preserveTargetDir: true,
  },
];

function safeLog(message) {
  console.log(`[dev-premium-functions] ${message}`);
}

function removeReparsePoint(path) {
  if (!existsSync(path)) {
    return;
  }

  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || stat.isDirectory()) {
    rmSync(path, { recursive: true, force: true });
  }
}

function ensureCopied({ targetDir, sourceDir, files, preserveTargetDir = false }) {
  if (!existsSync(sourceDir)) {
    safeLog(`Skipped ${targetDir}; premium source missing at ${sourceDir}`);
    return false;
  }

  if (!preserveTargetDir) {
    removeReparsePoint(targetDir);
  }
  mkdirSync(targetDir, { recursive: true });

  for (const fileName of files) {
    const source = resolve(sourceDir, fileName);
    const target = resolve(targetDir, fileName);
    if (!existsSync(source)) {
      safeLog(`Skipped missing premium source file: ${source}`);
      return false;
    }

    cpSync(source, target, { force: true });
  }

  safeLog(`Copied premium function into ${targetDir}`);
  return true;
}

if (!existsSync(premiumFunctionsRoot)) {
  safeLog("singra-premium checkout not found; admin-team will not be copied.");
  process.exit(0);
}

let copied = 0;
for (const entry of copies) {
  if (ensureCopied(entry)) {
    copied += 1;
  }
}

if (copied === 0) {
  safeLog("No premium edge functions copied.");
  process.exit(0);
}

safeLog(
  "Premium edge functions copied for local Docker. Restart local Supabase when a copied function was added or changed.",
);
