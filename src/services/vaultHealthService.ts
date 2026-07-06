// Copyright (c) 2025-2026 Maunting Studios
// Licensed under the Business Source License 1.1 — see LICENSE
/**
 * @fileoverview Vault Health Analysis Service
 *
 * Client-side password analysis engine that evaluates vault items
 * for weak, pwned, duplicate, old, and reused passwords.
 * Password comparison happens locally in memory. HIBP uses the Core
 * k-anonymity password service, which never sends the password itself.
 */

import {
    checkPasswordPwned,
    checkPasswordStrength,
    type PwnedResult,
    type StrengthResult,
} from '@/services/passwordStrengthService';

// ============ Types ============

export type HealthIssueType = 'weak' | 'pwned' | 'duplicate' | 'old' | 'reused';

export interface HealthIssue {
    itemId: string;
    title: string;
    type: HealthIssueType;
    types: HealthIssueType[];
    severity: 'critical' | 'warning' | 'info';
    description: string;
    descriptions: Partial<Record<HealthIssueType, string>>;
}

export interface HealthReport {
    score: number; // 0–100
    totalItems: number;
    passwordItems: number;
    issues: HealthIssue[];
    stats: {
        weak: number;
        pwned: number;
        duplicate: number;
        old: number;
        reused: number;
        strong: number;
    };
}

export interface VaultHealthSidebarSummary {
    status: 'healthy' | 'review' | 'critical';
    score: number;
    passwordItems: number;
    affectedItems: number;
    criticalItems: number;
    warningItems: number;
    stats: HealthReport['stats'];
}

export interface VaultHealthSidebarSummaryInput {
    score: number;
    passwordItems: number;
    affectedItems: number;
    criticalItems: number;
    warningItems: number;
    stats: HealthReport['stats'];
}

export interface DecryptedPasswordItem {
    id: string;
    title: string;
    password: string;
    itemType?: 'password' | 'note' | 'totp' | 'card';
    username?: string;
    websiteUrl?: string;
    updatedAt: string;
}

function isAnalyzablePasswordItem(item: DecryptedPasswordItem): boolean {
    return item.itemType !== 'totp' && Boolean(item.password);
}

// ============ Analysis Functions ============

/**
 * Check if a password is old (>90 days since last update)
 */
function isOldPassword(updatedAt: string): boolean {
    const ageMs = Date.now() - new Date(updatedAt).getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    return ageDays > 90;
}

/**
 * Find duplicate passwords across items
 */
function findDuplicateIdGroups(items: DecryptedPasswordItem[]): string[][] {
    const passwordMap = new Map<string, string[]>();

    for (const item of items) {
        if (!item.password) continue;
        const existing = passwordMap.get(item.password) || [];
        existing.push(item.id);
        passwordMap.set(item.password, existing);
    }

    // Only return groups with 2+ items
    const duplicates: string[][] = [];
    for (const ids of passwordMap.values()) {
        if (ids.length >= 2) {
            duplicates.push([...ids]);
        }
    }
    passwordMap.clear();
    return duplicates;
}

function getHostname(url: string | undefined): string | null {
    if (!url) {
        return null;
    }

    try {
        return new URL(url).hostname;
    } catch {
        return null;
    }
}

function buildPasswordStrengthContext(item: DecryptedPasswordItem): string[] {
    const hostname = getHostname(item.websiteUrl);
    return [item.title, item.username, hostname].filter((value): value is string => (
        typeof value === 'string' && value.trim().length > 0
    ));
}

interface PasswordHealthCheck {
    item: DecryptedPasswordItem;
    strength: StrengthResult;
    pwned: PwnedResult;
}

interface HealthIssueDraft {
    itemId: string;
    title: string;
    types: Set<HealthIssueType>;
    severity: HealthIssue['severity'];
    descriptions: Partial<Record<HealthIssueType, string>>;
}

async function analyzePasswordHealthChecks(
    items: DecryptedPasswordItem[],
): Promise<PasswordHealthCheck[]> {
    const pwnedChecksBySecret = new Map<string, Promise<PwnedResult>>();

    try {
        return await Promise.all(items.map(async (item) => {
            let pwnedCheck = pwnedChecksBySecret.get(item.password);
            if (!pwnedCheck) {
                pwnedCheck = checkPasswordPwned(item.password);
                pwnedChecksBySecret.set(item.password, pwnedCheck);
            }

            const [strength, pwned] = await Promise.all([
                checkPasswordStrength(item.password, { userInputs: buildPasswordStrengthContext(item) }),
                pwnedCheck,
            ]);

            return { item, strength, pwned };
        }));
    } finally {
        pwnedChecksBySecret.clear();
    }
}

// ============ Main Analysis ============

const ISSUE_TYPE_PRIORITY: HealthIssueType[] = ['pwned', 'weak', 'duplicate', 'old', 'reused'];

function compareSeverity(
    current: HealthIssue['severity'],
    next: HealthIssue['severity'],
): HealthIssue['severity'] {
    const weights: Record<HealthIssue['severity'], number> = {
        info: 0,
        warning: 1,
        critical: 2,
    };
    return weights[next] > weights[current] ? next : current;
}

function addIssue(
    issuesByItemId: Map<string, HealthIssueDraft>,
    item: DecryptedPasswordItem,
    type: HealthIssueType,
    severity: HealthIssue['severity'],
    description: string,
): void {
    const draft = issuesByItemId.get(item.id) ?? {
        itemId: item.id,
        title: item.title,
        types: new Set<HealthIssueType>(),
        severity: 'info' as const,
        descriptions: {},
    };

    draft.types.add(type);
    draft.severity = compareSeverity(draft.severity, severity);
    draft.descriptions[type] = description;
    issuesByItemId.set(item.id, draft);
}

function finalizeIssues(issuesByItemId: Map<string, HealthIssueDraft>): HealthIssue[] {
    return Array.from(issuesByItemId.values()).map((draft) => {
        const types = ISSUE_TYPE_PRIORITY.filter((type) => draft.types.has(type));
        const primaryType = types[0] ?? 'old';
        return {
            itemId: draft.itemId,
            title: draft.title,
            type: primaryType,
            types,
            severity: draft.severity,
            description: draft.descriptions[primaryType] ?? '',
            descriptions: draft.descriptions,
        };
    });
}

/**
 * Analyze all decrypted password items and generate a health report.
 * All processing happens client-side.
 */
export async function analyzeVaultHealth(items: DecryptedPasswordItem[]): Promise<HealthReport> {
    const issuesByItemId = new Map<string, HealthIssueDraft>();
    const passwordItems = items.filter(isAnalyzablePasswordItem);
    const itemMap = new Map(passwordItems.map(i => [i.id, i]));
    let weakCount = 0;
    let pwnedCount = 0;
    let duplicateCount = 0;
    let oldCount = 0;
    let reusedCount = 0;
    let strongCount = 0;

    // 1. Check for weak and pwned passwords
    const checkedItems = await analyzePasswordHealthChecks(passwordItems);
    for (const { item, strength, pwned } of checkedItems) {
        if (strength.score <= 2) {
            weakCount++;
            addIssue(issuesByItemId, item, 'weak', strength.score <= 1 ? 'critical' : 'warning', `score_${strength.score}`);
        }

        if (pwned.isPwned) {
            pwnedCount++;
            addIssue(issuesByItemId, item, 'pwned', 'critical', String(pwned.pwnedCount));
        }

        if (strength.score >= 3 && !pwned.isPwned) {
            strongCount++;
        }
    }

    // 2. Check for duplicates
    const duplicates = findDuplicateIdGroups(passwordItems);
    const seenDuplicateIds = new Set<string>();
    for (const ids of duplicates) {
        for (const id of ids) {
            if (seenDuplicateIds.has(id)) continue;
            seenDuplicateIds.add(id);
            duplicateCount++;
            const item = itemMap.get(id)!;
            const otherTitles = ids
                .filter(otherId => otherId !== id)
                .map(otherId => itemMap.get(otherId)?.title || 'Unknown')
                .join(', ');
            addIssue(issuesByItemId, item, 'duplicate', 'warning', otherTitles);
        }
    }

    // 3. Check for old passwords
    for (const item of passwordItems) {
        if (isOldPassword(item.updatedAt)) {
            oldCount++;
            addIssue(issuesByItemId, item, 'old', 'info', item.updatedAt);
        }
    }

    // 4. Check for reused passwords across different domains
    const domainPasswordMap = new Map<string, Set<string>>();
    for (const item of passwordItems) {
        if (!item.password) continue;
        const domain = getHostname(item.websiteUrl);
        if (domain) {
            const existing = domainPasswordMap.get(item.password) || new Set();
            existing.add(domain);
            domainPasswordMap.set(item.password, existing);
        }
    }
    for (const [, domains] of domainPasswordMap) {
        if (domains.size >= 2) {
            reusedCount += domains.size;
        }
    }
    domainPasswordMap.clear();

    // Calculate score (weighted)
    const totalPasswords = passwordItems.length;
    if (totalPasswords === 0) {
        return {
            score: 100,
            totalItems: items.length,
            passwordItems: 0,
            issues: [],
            stats: { weak: 0, pwned: 0, duplicate: 0, old: 0, reused: 0, strong: 0 },
        };
    }

    const weakPenalty = (weakCount / totalPasswords) * 40;
    const pwnedPenalty = (pwnedCount / totalPasswords) * 40;
    const dupPenalty = (duplicateCount / totalPasswords) * 30;
    const oldPenalty = (oldCount / totalPasswords) * 15;
    const reusedPenalty = Math.min((reusedCount / totalPasswords) * 15, 15);
    const score = Math.max(0, Math.round(100 - weakPenalty - pwnedPenalty - dupPenalty - oldPenalty - reusedPenalty));

    return {
        score,
        totalItems: items.length,
        passwordItems: totalPasswords,
        issues: finalizeIssues(issuesByItemId),
        stats: {
            weak: weakCount,
            pwned: pwnedCount,
            duplicate: duplicateCount,
            old: oldCount,
            reused: reusedCount,
            strong: strongCount,
        },
    };
}

export function analyzeVaultHealthSummary(input: VaultHealthSidebarSummaryInput): VaultHealthSidebarSummary {
    const status = input.criticalItems > 0 || input.score < 40
        ? 'critical'
        : input.affectedItems > 0
            ? 'review'
            : 'healthy';

    return {
        status,
        score: input.score,
        passwordItems: input.passwordItems,
        affectedItems: input.affectedItems,
        criticalItems: input.criticalItems,
        warningItems: input.warningItems,
        stats: input.stats,
    };
}
