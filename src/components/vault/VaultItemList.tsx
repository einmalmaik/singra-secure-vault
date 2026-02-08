/**
 * @fileoverview Vault Item List Component
 * 
 * Displays vault items in grid or list view with filtering,
 * search, and decryption.
 */

import { useMemo, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Plus, Shield, KeyRound } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { VaultItemCard } from './VaultItemCard';
import { ItemFilter, ViewMode } from '@/pages/VaultPage';
import { useVault } from '@/contexts/VaultContext';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { VaultItemData } from '@/services/cryptoService';
import { cn } from '@/lib/utils';

const ENCRYPTED_ITEM_TITLE_PLACEHOLDER = 'Encrypted Item';

interface VaultItem {
    id: string;
    vault_id: string;
    title: string;
    website_url: string | null;
    icon_url: string | null;
    item_type: 'password' | 'note' | 'totp' | 'card';
    is_favorite: boolean | null;
    category_id: string | null;
    created_at: string;
    updated_at: string;
    // Decrypted data
    decryptedData?: VaultItemData;
}

interface VaultItemListProps {
    searchQuery: string;
    filter: ItemFilter;
    categoryId: string | null;
    viewMode: ViewMode;
    onEditItem: (itemId: string) => void;
    refreshKey?: number; // Incremented to trigger data refresh
}

export function VaultItemList({
    searchQuery,
    filter,
    categoryId,
    viewMode,
    onEditItem,
    refreshKey,
}: VaultItemListProps) {
    const { t } = useTranslation();
    const { user } = useAuth();
    const { decryptItem, encryptItem } = useVault();

    const [items, setItems] = useState<VaultItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [decrypting, setDecrypting] = useState(false);

    // Fetch vault items
    useEffect(() => {
        async function fetchItems() {
            if (!user) return;

            setLoading(true);
            try {
                // Get default vault
                const { data: vault } = await supabase
                    .from('vaults')
                    .select('id')
                    .eq('user_id', user.id)
                    .eq('is_default', true)
                    .single();

                if (!vault) {
                    setItems([]);
                    return;
                }

                // Fetch items
                const { data: vaultItems, error } = await supabase
                    .from('vault_items')
                    .select('*')
                    .eq('vault_id', vault.id)
                    .order('updated_at', { ascending: false });

                if (error) throw error;

                // Decrypt items
                setDecrypting(true);
                const decryptedItems = await Promise.all(
                    (vaultItems || []).map(async (item) => {
                        try {
                            const decryptedData = await decryptItem(item.encrypted_data);
                            const hasLegacyPlaintextMeta =
                                (!decryptedData.title && item.title && item.title !== ENCRYPTED_ITEM_TITLE_PLACEHOLDER) ||
                                (!decryptedData.websiteUrl && !!item.website_url) ||
                                (!decryptedData.itemType && !!item.item_type) ||
                                (typeof decryptedData.isFavorite !== 'boolean' && item.is_favorite !== null) ||
                                (typeof decryptedData.categoryId === 'undefined' && item.category_id !== null);
                            const hasPlaintextColumnsToCleanup =
                                item.title !== ENCRYPTED_ITEM_TITLE_PLACEHOLDER ||
                                item.website_url !== null ||
                                item.icon_url !== null ||
                                item.item_type !== 'password' ||
                                !!item.is_favorite ||
                                item.category_id !== null;

                            if (hasLegacyPlaintextMeta || hasPlaintextColumnsToCleanup) {
                                const migratedEncryptedData = await encryptItem({
                                    ...decryptedData,
                                    title: decryptedData.title || item.title,
                                    websiteUrl: decryptedData.websiteUrl || item.website_url || undefined,
                                    itemType: decryptedData.itemType || item.item_type || 'password',
                                    isFavorite: typeof decryptedData.isFavorite === 'boolean'
                                        ? decryptedData.isFavorite
                                        : !!item.is_favorite,
                                    categoryId: typeof decryptedData.categoryId !== 'undefined'
                                        ? decryptedData.categoryId
                                        : item.category_id,
                                });

                                await supabase
                                    .from('vault_items')
                                    .update({
                                        encrypted_data: migratedEncryptedData,
                                        title: ENCRYPTED_ITEM_TITLE_PLACEHOLDER,
                                        website_url: null,
                                        icon_url: null,
                                        item_type: 'password',
                                        is_favorite: false,
                                        category_id: null,
                                    })
                                    .eq('id', item.id);

                                const resolvedDecryptedData = {
                                    ...decryptedData,
                                    title: decryptedData.title || item.title,
                                    websiteUrl: decryptedData.websiteUrl || item.website_url || undefined,
                                    itemType: decryptedData.itemType || item.item_type || 'password',
                                    isFavorite: typeof decryptedData.isFavorite === 'boolean'
                                        ? decryptedData.isFavorite
                                        : !!item.is_favorite,
                                    categoryId: typeof decryptedData.categoryId !== 'undefined'
                                        ? decryptedData.categoryId
                                        : item.category_id,
                                };

                                return {
                                    ...item,
                                    title: ENCRYPTED_ITEM_TITLE_PLACEHOLDER,
                                    website_url: null,
                                    icon_url: null,
                                    item_type: 'password',
                                    is_favorite: false,
                                    category_id: null,
                                    decryptedData: resolvedDecryptedData,
                                };
                            }

                            return { ...item, decryptedData };
                        } catch (err) {
                            console.error('Failed to decrypt item:', item.id, err);
                            return { ...item, decryptedData: undefined };
                        }
                    })
                );

                setItems(decryptedItems as VaultItem[]);
            } catch (err) {
                console.error('Error fetching vault items:', err);
            } finally {
                setLoading(false);
                setDecrypting(false);
            }
        }

        fetchItems();
    }, [user, decryptItem, encryptItem, refreshKey]); // Added refreshKey to trigger refetch

    // Filter items
    const filteredItems = useMemo(() => {
        return items.filter((item) => {
            const resolvedCategoryId = item.decryptedData?.categoryId ?? item.category_id;
            const resolvedItemType = item.decryptedData?.itemType || item.item_type;
            const resolvedIsFavorite = typeof item.decryptedData?.isFavorite === 'boolean'
                ? item.decryptedData.isFavorite
                : !!item.is_favorite;

            // Category filter
            if (categoryId && resolvedCategoryId !== categoryId) return false;

            // Type filter
            if (filter === 'passwords' && resolvedItemType !== 'password') return false;
            if (filter === 'notes' && resolvedItemType !== 'note') return false;
            if (filter === 'totp' && resolvedItemType !== 'totp') return false;
            if (filter === 'favorites' && !resolvedIsFavorite) return false;

            // Search filter
            if (searchQuery) {
                const query = searchQuery.toLowerCase();
                const resolvedTitle = item.decryptedData?.title || item.title;
                const resolvedUrl = item.decryptedData?.websiteUrl || item.website_url;
                const matchTitle = resolvedTitle.toLowerCase().includes(query);
                const matchUrl = resolvedUrl?.toLowerCase().includes(query);
                const matchUsername = item.decryptedData?.username?.toLowerCase().includes(query);
                if (!matchTitle && !matchUrl && !matchUsername) return false;
            }

            return true;
        });
    }, [items, filter, categoryId, searchQuery]);

    if (loading || decrypting) {
        return (
            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                <Loader2 className="w-8 h-8 animate-spin mb-4" />
                <p>{decrypting ? t('vault.items.decrypting') : t('common.loading')}</p>
            </div>
        );
    }

    if (items.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-64 text-center">
                <div className="p-4 rounded-full bg-muted mb-4">
                    <Shield className="w-8 h-8 text-muted-foreground" />
                </div>
                <h3 className="text-lg font-medium mb-2">{t('vault.empty.title')}</h3>
                <p className="text-muted-foreground mb-4 max-w-sm">
                    {t('vault.empty.description')}
                </p>
                <Button onClick={() => onEditItem('')}>
                    <Plus className="w-4 h-4 mr-2" />
                    {t('vault.empty.action')}
                </Button>
            </div>
        );
    }

    if (filteredItems.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-64 text-center">
                <div className="p-4 rounded-full bg-muted mb-4">
                    <KeyRound className="w-8 h-8 text-muted-foreground" />
                </div>
                <h3 className="text-lg font-medium mb-2">{t('vault.search.noResults')}</h3>
                <p className="text-muted-foreground max-w-sm">
                    {t('vault.search.noResultsDescription')}
                </p>
            </div>
        );
    }

    return (
        <div
            className={cn(
                viewMode === 'grid'
                    ? 'grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'
                    : 'flex flex-col gap-2'
            )}
        >
            {filteredItems.map((item) => (
                <VaultItemCard
                    key={item.id}
                    item={item}
                    viewMode={viewMode}
                    onEdit={() => onEditItem(item.id)}
                />
            ))}
        </div>
    );
}
