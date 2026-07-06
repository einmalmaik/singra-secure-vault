// Copyright (c) 2025-2026 Maunting Studios
// Licensed under the Business Source License 1.1 — see LICENSE
/**
 * Regression test for the pre-OpLog Premium duress setup bug.
 *
 * Older builds of `DuressSettings.tsx` populated the user's `vault_items`
 * legacy table directly with 10 default decoy entries (encrypted with the
 * duress key). On a modern USK + OpLog Core that path:
 *
 *  - makes `evaluateVaultMigrationGate` see `hasLegacyRows = 10` plus an
 *    OpLog head with no manifest, which surfaces as "Tresor-Migration
 *    erforderlich" + IntegrityV2 `orphan_remote`;
 *  - silently breaks master + duress unlock for a freshly-created vault
 *    after the panic password is enabled.
 *
 * This test guards the Premium-side of that contract: no source file in
 * this package may issue a direct `INSERT` / `UPDATE` / `UPSERT` against
 * `vault_items` or `categories`. The signed OpLog path
 * (`submit_vault_operation`) is the only sanctioned write channel.
 *
 * SELECT and DELETE remain allowed — SELECT is needed for emergency-access
 * read flows, DELETE is needed for the Core's `purgeLegacyDuressDecoys`
 * recovery surface (which only ever runs from the Core).
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const REPO_ROOT = process.cwd();

const FROM_VAULT_ITEMS = String.raw`\.from\((?:['"])vault_items(?:['"])\)`;
const FROM_CATEGORIES = String.raw`\.from\((?:['"])categories(?:['"])\)`;
const FORBIDDEN_WRITE_METHOD = String.raw`\.(?:insert|update|upsert)\s*\(`;

// Forbidden = ".from('vault_items')" or ".from('categories')" followed
// (within 240 chars of chained calls) by an .insert / .update / .upsert.
const FORBIDDEN_WRITE = new RegExp(
    `(?:${FROM_VAULT_ITEMS}|${FROM_CATEGORIES})[\\s\\S]{0,240}${FORBIDDEN_WRITE_METHOD}`,
    'm',
);

function listSourceFiles(root: string): string[] {
    const files: string[] = [];
    for (const entry of readdirSync(root)) {
        if (entry === 'node_modules' || entry === 'dist' || entry === '__tests__') {
            continue;
        }
        const absolute = join(root, entry);
        const stats = statSync(absolute);
        if (stats.isDirectory()) {
            files.push(...listSourceFiles(absolute));
            continue;
        }
        if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
            // Skip test files — they may intentionally simulate the legacy
            // write to assert that the regression test catches it.
            if (entry.endsWith('.test.ts') || entry.endsWith('.test.tsx')) {
                continue;
            }
            files.push(absolute);
        }
    }
    return files;
}

describe('premium legacy vault table write contract', () => {
    it('does not issue direct INSERT/UPDATE/UPSERT against vault_items or categories from premium source', () => {
        const runtimeFiles = listSourceFiles(join(REPO_ROOT, 'src'));

        const offenders = runtimeFiles
            .filter((file) => FORBIDDEN_WRITE.test(readFileSync(file, 'utf8')))
            .map((file) => relative(REPO_ROOT, file).replace(/\\/g, '/'));

        expect(
            offenders,
            offenders.length > 0
                ? `Premium source must write vault items / categories via the signed OpLog path, not directly. Offenders:\n${
                    offenders.map((path) => `  ${path}`).join('\n')
                }`
                : '',
        ).toEqual([]);
    });
});
