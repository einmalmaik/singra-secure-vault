// Copyright (c) 2025-2026 Maunting Studios
// Licensed under the Business Source License 1.1 — see LICENSE
/**
 * @fileoverview Authenticator Page
 *
 * Dedicated dashboard for TOTP codes.
 * Features:
 * - Grid view of all TOTP items
 * - Real-time code generation and countdown
 * - Search/Filter
 * - Quick add with scanner support
 * - Premium feature gated
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Clock3, Copy, Edit, Eye, Loader2, Plus, Search, Shield, Star, Trash2, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useAuth } from '@/contexts/AuthContext';
import { useVault } from '@/contexts/VaultContext';
import { FeatureGate } from '@/components/Subscription/FeatureGate';
import { VaultItemDialog } from '@/components/vault/VaultItemDialog';
import { VaultItemPreviewPanel } from '@/components/vault/VaultItemPreviewPanel';
import { TOTPDisplay } from '@/components/vault/TOTPDisplay';
import { VaultIcon } from '@/components/icons/VaultIcon';

import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { generateTOTP, isValidTOTPSecret, normalizeTOTPConfig } from '@/services/totpService';
import { shouldShowWebsiteChrome } from '@/platform/appShell';
import { loadVaultSnapshot } from '@/services/offlineVaultService';
import type { ItemPlaintext } from '@/services/vaultOpLog/vaultOpLogCrudService';
import type { LocalVerifiedRecord } from '@/services/vaultOpLog/vaultStateMachine';
import { writeClipboard } from '@/services/clipboardService';

// Reusing VaultItemData from cryptoService but adding id
import { VaultItemData } from '@/services/cryptoService';

interface AuthenticatorItem extends VaultItemData {
    id: string;
    totpSecret: string; // Guaranteed to exist for this view
    createdAt: string | null;
    updatedAt: string | null;
}

type AuthenticatorFilter = 'all' | 'favorites' | 'recent';

const FAVORITE_LIMIT = 4;
const RECENT_LIMIT = 8;
const ALL_TABLE_LIMIT = 20;

function chunkItems<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let index = 0; index < items.length; index += size) {
        chunks.push(items.slice(index, index + size));
    }
    return chunks;
}

function parseVerifiedTotpRecord(record: LocalVerifiedRecord): AuthenticatorItem | null {
    if (
        (record.recordState !== 'verified' && record.recordState !== 'restoredFromSnapshot')
        || record.record.recordType !== 'item'
        || !record.plaintext
    ) {
        return null;
    }

    try {
        const parsed = JSON.parse(new TextDecoder().decode(record.plaintext)) as VaultItemData;
        const totpConfig = normalizeTOTPConfig({
            algorithm: parsed.totpAlgorithm,
            digits: parsed.totpDigits,
            period: parsed.totpPeriod,
        });

        if ((parsed.itemType ?? 'password') !== 'totp' || !parsed.totpSecret || !isValidTOTPSecret(parsed.totpSecret) || !totpConfig) {
            return null;
        }

        return {
            ...parsed,
            id: record.record.recordId,
            totpSecret: parsed.totpSecret,
            totpAlgorithm: totpConfig.algorithm,
            totpDigits: totpConfig.digits,
            totpPeriod: totpConfig.period,
            createdAt: record.record.createdAt,
            updatedAt: record.record.updatedAt,
        };
    } catch {
        return null;
    }
}

function buildTotpPlaintext(item: AuthenticatorItem, isFavorite: boolean): ItemPlaintext {
    return {
        title: item.title,
        websiteUrl: item.websiteUrl ?? null,
        username: item.username ?? null,
        password: item.password ?? null,
        notes: item.notes ?? null,
        itemType: 'totp',
        categoryRecordId: item.categoryId ?? null,
        isFavorite,
        sortOrder: null,
        totpSecret: item.totpSecret,
        totpIssuer: item.totpIssuer ?? null,
        totpLabel: item.totpLabel ?? null,
        totpAlgorithm: item.totpAlgorithm ?? null,
        totpDigits: item.totpDigits ?? null,
        totpPeriod: item.totpPeriod ?? null,
        customFields: item.customFields ?? null,
    };
}

function formatMetaDate(value: string | null): string {
    if (!value) {
        return '—';
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return '—';
    }

    return new Intl.DateTimeFormat('de-DE', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    }).format(date);
}

export default function AuthenticatorPage() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const { user } = useAuth();
    const {
        decryptItem,
        lastIntegrityResult,
        opLogDeleteItem,
        opLogLocalVaultState,
        opLogUpdateItem,
        vaultDataVersion,
        vaultMigrationStatus,
    } = useVault();
    const { toast } = useToast();
    const showWebsiteChrome = shouldShowWebsiteChrome();
    const useOpLogVerifiedRuntime = vaultMigrationStatus === 'verified';

    const [items, setItems] = useState<AuthenticatorItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [activeFilter, setActiveFilter] = useState<AuthenticatorFilter>('all');
    const [favoriteExpanded, setFavoriteExpanded] = useState(false);
    const [recentlyUsedItemIds, setRecentlyUsedItemIds] = useState<string[]>([]);
    const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
    const [deleteItemId, setDeleteItemId] = useState<string | null>(null);
    const [deleting, setDeleting] = useState(false);

    // Dialog states
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editingItemId, setEditingItemId] = useState<string | null>(null);
    const quarantinedItemIds = useMemo(
        () => new Set((lastIntegrityResult?.quarantinedItems ?? []).map((item) => item.id)),
        [lastIntegrityResult],
    );

    // Fetch and decrypt items
    const loadItems = useCallback(async () => {
        if (!user) return;
        setLoading(true);

        try {
            const decryptedItems: AuthenticatorItem[] = [];

            if (useOpLogVerifiedRuntime) {
                const opLogItems = opLogLocalVaultState
                    ? Array.from(opLogLocalVaultState.recordsById.values())
                        .map(parseVerifiedTotpRecord)
                        .filter((item): item is AuthenticatorItem => !!item)
                    : [];

                setItems(opLogItems.sort((left, right) => (right.updatedAt ?? '').localeCompare(left.updatedAt ?? '')));
                return;
            }

            const { snapshot } = await loadVaultSnapshot(user.id);

            for (const item of snapshot.items) {
                if (quarantinedItemIds.has(item.id)) {
                    continue;
                }

                try {
                    const decrypted = await decryptItem(item.encrypted_data, item.id);
                    const resolvedItemType = decrypted.itemType || item.item_type;
                    const totpConfig = normalizeTOTPConfig({
                        algorithm: decrypted.totpAlgorithm,
                        digits: decrypted.totpDigits,
                        period: decrypted.totpPeriod,
                    });
                    if (resolvedItemType === 'totp' && decrypted.totpSecret && isValidTOTPSecret(decrypted.totpSecret) && totpConfig) {
                        decryptedItems.push({
                            ...decrypted,
                            id: item.id,
                            totpSecret: decrypted.totpSecret,
                            totpAlgorithm: totpConfig.algorithm,
                            totpDigits: totpConfig.digits,
                            totpPeriod: totpConfig.period,
                            createdAt: item.created_at ?? null,
                            updatedAt: item.updated_at ?? null,
                        });
                    }
                } catch {
                    console.debug('Failed to decrypt authenticator item:', item.id);
                }
            }

            setItems(decryptedItems);
        } catch {
            console.error('Failed to load authenticator items.');
            toast({
                title: t('common.error'),
                description: t('vault.loadError'),
                variant: 'destructive',
            });
        } finally {
            setLoading(false);
        }
    }, [decryptItem, opLogLocalVaultState, quarantinedItemIds, t, toast, useOpLogVerifiedRuntime, user]);

    useEffect(() => {
        void loadItems();
    }, [loadItems, user, vaultDataVersion]);

    const markItemRecentlyUsed = useCallback((itemId: string) => {
        setRecentlyUsedItemIds((current) => [
            itemId,
            ...current.filter((id) => id !== itemId),
        ].slice(0, 20));
    }, []);

    const filteredItems = useMemo(() => {
        let candidates = items;
        const lowerQuery = searchQuery.toLowerCase();

        if (searchQuery) {
            candidates = candidates.filter(
                (item) =>
                item.title.toLowerCase().includes(lowerQuery) ||
                (item.username && item.username.toLowerCase().includes(lowerQuery)) ||
                (item.websiteUrl && item.websiteUrl.toLowerCase().includes(lowerQuery)) ||
                (item.totpIssuer && item.totpIssuer.toLowerCase().includes(lowerQuery))
            );
        }

        if (activeFilter === 'favorites') {
            candidates = candidates.filter((item) => item.isFavorite);
        }

        if (activeFilter === 'recent') {
            const recentIds = new Set(recentlyUsedItemIds);
            candidates = candidates.filter((item) => recentIds.has(item.id));
        }

        return [...candidates].sort((left, right) => left.title.localeCompare(right.title, 'de'));
    }, [activeFilter, items, recentlyUsedItemIds, searchQuery]);

    const favoriteItems = useMemo(
        () => items.filter((item) => item.isFavorite).sort((left, right) => left.title.localeCompare(right.title, 'de')),
        [items],
    );

    const recentItems = useMemo(() => {
        const byId = new Map(items.map((item) => [item.id, item]));
        const explicit = recentlyUsedItemIds
            .map((id) => byId.get(id))
            .filter((item): item is AuthenticatorItem => !!item);
        const explicitIds = new Set(explicit.map((item) => item.id));
        const fallback = [...items]
            .filter((item) => !explicitIds.has(item.id))
            .sort((left, right) => (right.updatedAt ?? '').localeCompare(left.updatedAt ?? ''))
            .slice(0, RECENT_LIMIT - explicit.length);

        return [...explicit, ...fallback].slice(0, RECENT_LIMIT);
    }, [items, recentlyUsedItemIds]);

    const selectedItem = useMemo(
        () => items.find((item) => item.id === selectedItemId) ?? null,
        [items, selectedItemId],
    );

    const deleteItem = useMemo(
        () => items.find((item) => item.id === deleteItemId) ?? null,
        [deleteItemId, items],
    );

    useEffect(() => {
        if (selectedItemId && !items.some((item) => item.id === selectedItemId)) {
            setSelectedItemId(null);
        }
    }, [items, selectedItemId]);

    const handleSelectItem = useCallback((id: string) => {
        setSelectedItemId(id);
        markItemRecentlyUsed(id);
    }, [markItemRecentlyUsed]);

    const handleEdit = useCallback((id: string) => {
        markItemRecentlyUsed(id);
        setSelectedItemId(null);
        setEditingItemId(id);
        setDialogOpen(true);
    }, [markItemRecentlyUsed]);

    const toggleFavorite = useCallback(async (item: AuthenticatorItem) => {
        if (!useOpLogVerifiedRuntime) {
            toast({
                title: t('authenticator.favoriteUnavailableTitle', { defaultValue: 'Favorit im Editor ändern' }),
                description: t('authenticator.favoriteUnavailableDescription', { defaultValue: 'Dieser Tresorstand unterstützt direkte Favoritenänderungen erst nach der OpLog-Verifizierung.' }),
            });
            return;
        }

        const nextFavorite = !item.isFavorite;
        setItems((current) => current.map((candidate) => (
            candidate.id === item.id ? { ...candidate, isFavorite: nextFavorite } : candidate
        )));
        markItemRecentlyUsed(item.id);

        const result = await opLogUpdateItem(item.id, buildTotpPlaintext(item, nextFavorite));
        if (!result.error) {
            return;
        }

        setItems((current) => current.map((candidate) => (
            candidate.id === item.id ? { ...candidate, isFavorite: !nextFavorite } : candidate
        )));
        toast({
            variant: 'destructive',
            title: t('common.error'),
            description: result.error.message,
        });
    }, [markItemRecentlyUsed, opLogUpdateItem, t, toast, useOpLogVerifiedRuntime]);

    const copyCode = useCallback(async (item: AuthenticatorItem) => {
        const config = normalizeTOTPConfig({
            algorithm: item.totpAlgorithm,
            digits: item.totpDigits,
            period: item.totpPeriod,
        });

        if (!config) {
            return;
        }

        try {
            await writeClipboard(generateTOTP(item.totpSecret, config));
            markItemRecentlyUsed(item.id);
            toast({
                title: t('vault.copied'),
                description: `${t('vault.copiedCode')} ${t('vault.clipboardAutoClear')}`,
            });
        } catch {
            toast({
                variant: 'destructive',
                title: t('common.error'),
                description: t('vault.copyFailed'),
            });
        }
    }, [markItemRecentlyUsed, t, toast]);

    const confirmDelete = useCallback(async () => {
        if (!deleteItem) {
            return;
        }

        setDeleting(true);
        const result = await opLogDeleteItem(deleteItem.id);
        setDeleting(false);

        if (result.error) {
            toast({
                variant: 'destructive',
                title: t('common.error'),
                description: result.error.message,
            });
            return;
        }

        setDeleteItemId(null);
        setSelectedItemId(null);
        toast({
            title: t('common.success'),
            description: t('vault.itemDeleted'),
        });
        void loadItems();
    }, [deleteItem, loadItems, opLogDeleteItem, t, toast]);

    const renderAuthenticatorCard = useCallback((item: AuthenticatorItem, variant: 'featured' | 'compact' = 'compact') => {
        const favorite = !!item.isFavorite;

        return (
            <Card
                key={item.id}
                className={cn(
                    'group overflow-hidden border-[hsl(var(--border)/0.32)] bg-[hsl(var(--el-1)/0.78)] shadow-[0_18px_48px_hsl(0_0%_0%/0.24)] backdrop-blur transition-all duration-200 hover:border-primary/55',
                    selectedItemId === item.id && 'border-primary/70 ring-1 ring-primary/35',
                )}
            >
                <CardContent className={cn('space-y-4', variant === 'featured' ? 'p-4' : 'p-3')}>
                    <button
                        type="button"
                        className="flex w-full min-w-0 items-start gap-3 text-left"
                        onClick={() => handleSelectItem(item.id)}
                    >
                        <VaultIcon
                            title={item.title}
                            websiteUrl={item.websiteUrl}
                            issuer={item.totpIssuer}
                            label={item.totpLabel}
                            className={variant === 'featured' ? 'h-12 w-12 rounded-xl' : 'h-10 w-10'}
                            iconClassName={variant === 'featured' ? 'h-6 w-6' : undefined}
                        />
                        <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold text-foreground">{item.title}</span>
                            <span className="block truncate text-xs text-muted-foreground">{item.username || item.totpLabel || item.totpIssuer || '—'}</span>
                        </span>
                    </button>

                    <TOTPDisplay
                        secret={item.totpSecret}
                        algorithm={item.totpAlgorithm}
                        digits={item.totpDigits}
                        period={item.totpPeriod}
                        className={cn(variant === 'compact' && '[&_span:first-child]:text-base')}
                    />

                    <div className="flex items-center gap-1">
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-10 w-10 text-muted-foreground hover:text-primary sm:h-8 sm:w-8"
                            aria-label={t('vault.actions.copyCode', { defaultValue: 'Code kopieren' })}
                            onClick={() => void copyCode(item)}
                        >
                            <Copy className="h-4 w-4" />
                        </Button>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className={cn('h-10 w-10 text-muted-foreground hover:text-amber-300 sm:h-8 sm:w-8', favorite && 'text-amber-400')}
                            aria-label={favorite
                                ? t('vault.actions.removeFavorite', { defaultValue: 'Favorit entfernen' })
                                : t('vault.actions.addFavorite', { defaultValue: 'Als Favorit markieren' })}
                            onClick={() => void toggleFavorite(item)}
                        >
                            <Star className={cn('h-4 w-4', favorite && 'fill-current')} />
                        </Button>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-10 w-10 text-muted-foreground hover:text-primary sm:h-8 sm:w-8"
                            aria-label={t('authenticator.details', { defaultValue: 'Details anzeigen' })}
                            onClick={() => handleSelectItem(item.id)}
                        >
                            <Eye className="h-4 w-4" />
                        </Button>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-10 w-10 text-muted-foreground hover:text-primary sm:h-8 sm:w-8"
                            aria-label={t('common.edit')}
                            onClick={() => handleEdit(item.id)}
                        >
                            <Edit className="h-4 w-4" />
                        </Button>
                    </div>
                </CardContent>
            </Card>
        );
    }, [copyCode, handleEdit, handleSelectItem, selectedItemId, t, toggleFavorite]);

    const renderAuthenticatorRow = useCallback((item: AuthenticatorItem) => {
        const favorite = !!item.isFavorite;

        return (
            <div
                key={item.id}
                className={cn(
                    'group grid min-h-16 cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t border-[hsl(var(--border)/0.22)] px-3 py-2.5 transition-all duration-200 ease-out hover:bg-white/[0.035] lg:grid-cols-[minmax(170px,1.25fr)_minmax(110px,0.8fr)_minmax(150px,0.9fr)_minmax(150px,0.75fr)_144px]',
                    selectedItemId === item.id && 'bg-primary/[0.055]',
                )}
                onClick={() => handleSelectItem(item.id)}
            >
                <button
                    type="button"
                    className="flex min-w-0 items-center gap-2.5 text-left"
                    onClick={(event) => {
                        event.stopPropagation();
                        handleSelectItem(item.id);
                    }}
                >
                    <VaultIcon
                        title={item.title}
                        websiteUrl={item.websiteUrl}
                        issuer={item.totpIssuer}
                        label={item.totpLabel}
                        className="h-9 w-9 shrink-0"
                    />
                    <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-foreground hover:text-primary">{item.title}</span>
                        <span className="mt-0.5 block truncate text-[11px] text-muted-foreground lg:hidden">
                            {item.username || item.totpLabel || item.totpIssuer || '—'}
                        </span>
                    </span>
                </button>

                <span className="hidden min-w-0 truncate text-sm text-muted-foreground lg:block">
                    {item.username || item.totpLabel || item.totpIssuer || '—'}
                </span>
                <div className="hidden min-w-0 lg:block" onClick={(event) => event.stopPropagation()}>
                    <TOTPDisplay
                        secret={item.totpSecret}
                        algorithm={item.totpAlgorithm}
                        digits={item.totpDigits}
                        period={item.totpPeriod}
                        className="min-w-0 [&>button]:hidden [&_span:first-child]:whitespace-nowrap [&_span:first-child]:text-base"
                    />
                </div>
                <span className="hidden min-w-0 truncate text-sm text-muted-foreground lg:block">
                    {formatMetaDate(item.updatedAt)}
                </span>

                <div className="flex items-center justify-end gap-1">
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className={cn('h-10 w-10 text-muted-foreground hover:text-amber-300 sm:h-8 sm:w-8', favorite && 'text-amber-400')}
                        aria-label={favorite
                            ? t('vault.actions.removeFavorite', { defaultValue: 'Favorit entfernen' })
                            : t('vault.actions.addFavorite', { defaultValue: 'Als Favorit markieren' })}
                        onClick={(event) => {
                            event.stopPropagation();
                            void toggleFavorite(item);
                        }}
                    >
                        <Star className={cn('h-4 w-4', favorite && 'fill-current')} />
                    </Button>
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-10 w-10 text-muted-foreground hover:text-primary sm:h-8 sm:w-8"
                        aria-label={t('vault.actions.copyCode', { defaultValue: 'Code kopieren' })}
                        onClick={(event) => {
                            event.stopPropagation();
                            void copyCode(item);
                        }}
                    >
                        <Copy className="h-4 w-4" />
                    </Button>
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-10 w-10 text-muted-foreground hover:text-primary sm:h-8 sm:w-8"
                        aria-label={t('authenticator.details', { defaultValue: 'Details anzeigen' })}
                        onClick={(event) => {
                            event.stopPropagation();
                            handleSelectItem(item.id);
                        }}
                    >
                        <Eye className="h-4 w-4" />
                    </Button>
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-10 w-10 text-muted-foreground hover:text-primary sm:h-8 sm:w-8"
                        aria-label={t('common.edit')}
                        onClick={(event) => {
                            event.stopPropagation();
                            handleEdit(item.id);
                        }}
                    >
                        <Edit className="h-4 w-4" />
                    </Button>
                </div>
            </div>
        );
    }, [copyCode, handleEdit, handleSelectItem, selectedItemId, t, toggleFavorite]);

    const renderAuthenticatorTable = useCallback((tableItems: AuthenticatorItem[]) => (
        <div className="overflow-hidden rounded-xl border border-[hsl(var(--border)/0.32)] bg-[hsl(var(--el-1)/0.72)] shadow-[0_18px_48px_hsl(0_0%_0%/0.24)] backdrop-blur transition-all duration-200 ease-out">
            <div className="hidden grid-cols-[minmax(170px,1.25fr)_minmax(110px,0.8fr)_minmax(150px,0.9fr)_minmax(150px,0.75fr)_144px] gap-3 px-3 py-2 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground lg:grid">
                <span>{t('vault.table.name', { defaultValue: 'Name' })}</span>
                <span>{t('vault.table.username', { defaultValue: 'Benutzername' })}</span>
                <span>{t('authenticator.code', { defaultValue: 'Code' })}</span>
                <span className="truncate">{t('vault.table.lastUsed', { defaultValue: 'Zuletzt verwendet' })}</span>
                <span className="text-right">{t('vault.table.actions', { defaultValue: 'Aktionen' })}</span>
            </div>
            {tableItems.map((item) => renderAuthenticatorRow(item))}
        </div>
    ), [renderAuthenticatorRow, t]);

    const renderFilterButton = useCallback((filter: AuthenticatorFilter, icon: JSX.Element, label: string) => (
        <Button
            type="button"
            variant={activeFilter === filter ? 'secondary' : 'ghost'}
            size="sm"
            className="h-9 gap-2 rounded-lg"
            onClick={() => setActiveFilter(filter)}
        >
            {icon}
            {label}
        </Button>
    ), [activeFilter]);

    const visibleFavorites = favoriteExpanded ? favoriteItems : favoriteItems.slice(0, FAVORITE_LIMIT);
    const hiddenFavoriteCount = Math.max(0, favoriteItems.length - FAVORITE_LIMIT);
    const allTableGroups = chunkItems(filteredItems.slice(0, ALL_TABLE_LIMIT), 4);
    const recentTableGroups = chunkItems(recentItems.slice(0, RECENT_LIMIT), 4);

    const handleCloseDialog = (open: boolean) => {
        setDialogOpen(open);
        if (!open) {
            setEditingItemId(null);
            void loadItems(); // Refresh on close
        }
    };

    return (
        <div className="min-h-screen flex flex-col bg-gradient-to-br from-primary/5 via-background to-primary/10">
            <header className="ms-glass-header sticky top-0 z-50">
                <div className="container max-w-7xl mx-auto px-4 py-4">
                    <div className="flex items-center gap-4">
                        <Button variant="ghost" size="icon" onClick={() => navigate('/vault')}>
                            <ArrowLeft className="w-5 h-5" />
                        </Button>
                        <div className="flex items-center gap-2">
                            <Shield className="w-6 h-6 text-primary" />
                            <h1 className="text-xl font-bold">{t('authenticator.title')}</h1>
                        </div>
                    </div>
                </div>
            </header>

            <main className="container mx-auto max-w-7xl flex-1 space-y-6 px-4 py-6 md:px-6">
                <FeatureGate feature="builtin_authenticator" featureLabel={t('authenticator.title')}>
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div>
                            <h2 className="singra-headline-serif text-2xl font-bold tracking-tight sm:text-3xl">{t('authenticator.title')}</h2>
                            <p className="text-muted-foreground mt-1">{t('authenticator.subtitle')}</p>
                        </div>
                        <Button onClick={() => setDialogOpen(true)} className="gap-2">
                            <Plus className="w-4 h-4" />
                            {t('common.add')}
                        </Button>
                    </div>

                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                        <div className="relative w-full max-w-md">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                            <Input
                                placeholder={t('common.search')}
                                className="ms-glass-input h-11 pl-9"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                            />
                        </div>
                        <div className="flex w-full gap-2 overflow-x-auto rounded-xl border border-border/45 bg-[hsl(var(--el-1)/0.72)] p-1 [mask-image:linear-gradient(to_right,transparent,black_0.75rem,black_calc(100%_-_0.75rem),transparent)] sm:w-auto sm:[mask-image:none]">
                            {renderFilterButton('all', <Shield className="h-4 w-4" />, t('vault.filters.all', { defaultValue: 'Alle' }))}
                            {renderFilterButton('favorites', <Star className="h-4 w-4" />, t('vault.filters.favorites', { defaultValue: 'Favoriten' }))}
                            {renderFilterButton('recent', <Clock3 className="h-4 w-4" />, t('vault.sections.recentlyUsed', { defaultValue: 'Zuletzt verwendet' }))}
                        </div>
                    </div>

                    {loading ? (
                        <div className="flex justify-center py-12">
                            <Loader2 className="w-8 h-8 animate-spin text-primary" />
                        </div>
                    ) : items.length === 0 ? (
                        <div className="text-center py-12 border border-border/40 rounded-xl bg-[hsl(var(--el-1)/0.72)]">
                            <Shield className="w-12 h-12 mx-auto text-muted-foreground/50 mb-3" />
                            <h3 className="text-lg font-medium">{t('authenticator.emptyTitle')}</h3>
                            <p className="text-muted-foreground mt-1 mb-4">
                                {searchQuery ? t('common.noResults') : t('authenticator.emptyDesc')}
                            </p>
                            {!searchQuery && (
                                <Button variant="outline" onClick={() => setDialogOpen(true)}>
                                    <Plus className="w-4 h-4 mr-2" />
                                    {t('authenticator.addFirst')}
                                </Button>
                            )}
                        </div>
                    ) : (
                        <div className="space-y-7">
                            {favoriteItems.length > 0 && activeFilter === 'all' && !searchQuery && (
                                <section className="space-y-3">
                                    <div className="flex items-center justify-between gap-3 px-1">
                                        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                                            <Star className="h-4 w-4 text-amber-400 fill-amber-400" aria-hidden="true" />
                                            <span>{t('vault.sections.favorites', { defaultValue: 'Favoriten' })}</span>
                                        </div>
                                        {hiddenFavoriteCount > 0 && (
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                className="h-8 rounded-full px-3 text-xs text-primary hover:text-primary"
                                                onClick={() => setFavoriteExpanded((expanded) => !expanded)}
                                            >
                                                {favoriteExpanded
                                                    ? t('vault.sections.showFewerFavorites', { defaultValue: 'Weniger anzeigen' })
                                                    : t('vault.sections.showMoreFavorites', {
                                                        defaultValue: '+ {{count}} weitere anzeigen',
                                                        count: hiddenFavoriteCount,
                                                    })}
                                            </Button>
                                        )}
                                    </div>
                                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                                        {visibleFavorites.map((item) => renderAuthenticatorCard(item, 'featured'))}
                                    </div>
                                </section>
                            )}

                            {recentItems.length > 0 && activeFilter === 'all' && !searchQuery && (
                                <section className={cn('space-y-3', favoriteItems.length > 0 && 'border-t border-border/35 pt-5')}>
                                    <div className="flex items-center gap-2 px-1 text-sm font-semibold text-foreground">
                                        <Clock3 className="h-4 w-4 text-primary" aria-hidden="true" />
                                        <span>{t('vault.sections.recentlyUsed', { defaultValue: 'Zuletzt verwendet' })}</span>
                                    </div>
                                    <div className="grid gap-3">
                                        {recentTableGroups.map((group, index) => (
                                            <div key={`recent-${index}`}>
                                                {renderAuthenticatorTable(group)}
                                            </div>
                                        ))}
                                    </div>
                                </section>
                            )}

                            <section className={cn('space-y-3', (favoriteItems.length > 0 || recentItems.length > 0) && activeFilter === 'all' && !searchQuery && 'border-t border-border/35 pt-5')}>
                                <div className="flex flex-wrap items-center justify-between gap-3 px-1">
                                    <h3 className="text-sm font-semibold text-foreground">
                                        {activeFilter === 'favorites'
                                            ? t('vault.sections.favorites', { defaultValue: 'Favoriten' })
                                            : activeFilter === 'recent'
                                                ? t('vault.sections.recentlyUsed', { defaultValue: 'Zuletzt verwendet' })
                                                : t('authenticator.allCodes', { defaultValue: 'Alle Authenticator-Codes' })}
                                    </h3>
                                    <span className="text-xs text-muted-foreground">
                                        {t('vault.sections.entryCount', {
                                            defaultValue: '{{count}} Einträge',
                                            count: filteredItems.length,
                                        })}
                                    </span>
                                </div>
                                {filteredItems.length === 0 ? (
                                    <div className="rounded-xl border border-border/40 bg-[hsl(var(--el-1)/0.72)] p-8 text-center text-sm text-muted-foreground">
                                        {t('common.noResults')}
                                    </div>
                                ) : (
                                    <div className="grid gap-3">
                                        {allTableGroups.map((group, index) => (
                                            <div key={`all-${index}`}>
                                                {renderAuthenticatorTable(group)}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </section>
                        </div>
                    )}

                    <VaultItemDialog
                        open={dialogOpen}
                        onOpenChange={handleCloseDialog}
                        itemId={editingItemId}
                        initialType="totp"
                        onSave={() => {
                            handleCloseDialog(false);
                            void loadItems();
                        }}
                    />
                </FeatureGate>
            </main>

            {selectedItem && (
                <VaultItemPreviewPanel breakpoint="xl">
                    <div className="flex items-start justify-between gap-3 rounded-2xl border border-border/30 bg-white/[0.015] p-3 shadow-[0_14px_34px_hsl(0_0%_0%/0.18)]">
                        <div className="flex min-w-0 items-center gap-3">
                            <VaultIcon
                                title={selectedItem.title}
                                websiteUrl={selectedItem.websiteUrl}
                                issuer={selectedItem.totpIssuer}
                                label={selectedItem.totpLabel}
                                className="h-12 w-12 rounded-xl"
                                iconClassName="h-6 w-6"
                            />
                            <div className="min-w-0">
                                <h3 className="truncate text-base font-semibold">{selectedItem.title}</h3>
                                <p className="truncate text-xs text-muted-foreground">{selectedItem.username || selectedItem.totpLabel || selectedItem.totpIssuer || '—'}</p>
                            </div>
                        </div>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
                            aria-label={t('common.close', { defaultValue: 'Schließen' })}
                            onClick={() => {
                                setDeleteItemId(null);
                                setSelectedItemId(null);
                            }}
                        >
                            <X className="h-4 w-4" />
                        </Button>
                    </div>

                    <div className="mt-6 space-y-2 rounded-2xl border border-border/30 bg-[hsl(var(--el-1)/0.5)] p-3">
                        <p className="text-xs font-medium text-muted-foreground">{t('authenticator.code', { defaultValue: 'Code' })}</p>
                        <TOTPDisplay
                            secret={selectedItem.totpSecret}
                            algorithm={selectedItem.totpAlgorithm}
                            digits={selectedItem.totpDigits}
                            period={selectedItem.totpPeriod}
                        />
                        <p className="text-xs text-muted-foreground">
                            {t('authenticator.autoRefreshHint', { defaultValue: 'Der Code ändert sich automatisch alle 30 Sekunden.' })}
                        </p>
                    </div>

                    <div className="mt-5 space-y-2 rounded-2xl border border-border/25 bg-white/[0.012] p-2">
                        <Button type="button" variant="outline" className="w-full justify-start" onClick={() => void copyCode(selectedItem)}>
                            <Copy className="mr-2 h-4 w-4" />
                            {t('vault.actions.copyCode', { defaultValue: 'Code kopieren' })}
                        </Button>
                        <Button type="button" variant="outline" className="w-full justify-start" onClick={() => void toggleFavorite(selectedItem)}>
                            <Star className={cn('mr-2 h-4 w-4 text-amber-400', selectedItem.isFavorite && 'fill-current')} />
                            {selectedItem.isFavorite
                                ? t('vault.actions.removeFavorite', { defaultValue: 'Favorit entfernen' })
                                : t('vault.actions.addFavorite', { defaultValue: 'Als Favorit markieren' })}
                        </Button>
                        <Button type="button" variant="outline" className="w-full justify-start" onClick={() => handleEdit(selectedItem.id)}>
                            <Edit className="mr-2 h-4 w-4" />
                            {t('vault.actions.editEntry', { defaultValue: 'Eintrag bearbeiten' })}
                        </Button>
                        <Button type="button" variant="ghost" className="w-full justify-start text-destructive hover:text-destructive" onClick={() => setDeleteItemId(selectedItem.id)}>
                            <Trash2 className="mr-2 h-4 w-4" />
                            {t('vault.actions.deleteEntry', { defaultValue: 'Eintrag löschen' })}
                        </Button>
                    </div>

                    <div className="mt-5 rounded-2xl border border-border/25 bg-white/[0.012] p-3">
                        <details className="group">
                            <summary className="cursor-pointer list-none text-sm font-medium text-foreground">
                                {t('authenticator.details', { defaultValue: 'Details anzeigen' })}
                            </summary>
                            <dl className="mt-3 space-y-2 text-xs text-muted-foreground">
                                <div className="flex justify-between gap-3">
                                    <dt>{t('common.created', { defaultValue: 'Erstellt' })}</dt>
                                    <dd className="text-right">{formatMetaDate(selectedItem.createdAt)}</dd>
                                </div>
                                <div className="flex justify-between gap-3">
                                    <dt>{t('common.updated', { defaultValue: 'Geändert' })}</dt>
                                    <dd className="text-right">{formatMetaDate(selectedItem.updatedAt)}</dd>
                                </div>
                            </dl>
                        </details>
                    </div>
                </VaultItemPreviewPanel>
            )}

            <AlertDialog open={!!deleteItem} onOpenChange={(open) => !open && setDeleteItemId(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{t('vault.confirmDeleteTitle', { defaultValue: 'Eintrag löschen?' })}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {t('vault.confirmDeleteDescription', {
                                defaultValue: 'Dieser Authenticator-Eintrag wird aus dem Tresor entfernt. Diese Aktion kann nicht direkt rückgängig gemacht werden.',
                            })}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={deleting}>{t('common.cancel', { defaultValue: 'Abbrechen' })}</AlertDialogCancel>
                        <AlertDialogAction
                            disabled={deleting}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            onClick={(event) => {
                                event.preventDefault();
                                void confirmDelete();
                            }}
                        >
                            {deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            {t('common.delete', { defaultValue: 'Löschen' })}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {showWebsiteChrome && (
                <footer className="border-t border-border/40 px-4 lg:px-6 py-3 text-xs text-muted-foreground">
                    <nav className="flex flex-wrap items-center gap-3">
                        <Link to="/privacy" className="hover:text-foreground transition-colors">
                            {t('landing.footer.privacy')}
                        </Link>
                        <Link to="/impressum" className="hover:text-foreground transition-colors">
                            {t('landing.footer.imprint')}
                        </Link>
                        <button
                            type="button"
                            onClick={() => window.dispatchEvent(new Event('singra:open-cookie-settings'))}
                            className="hover:text-foreground transition-colors"
                        >
                            {t('landing.footer.cookies')}
                        </button>
                    </nav>
                </footer>
            )}
        </div>
    );
}
