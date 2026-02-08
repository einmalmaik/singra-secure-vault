/**
 * @fileoverview Vault Sidebar Component
 * 
 * Navigation sidebar showing categories, quick filters,
 * and vault stats.
 */

import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
    ChevronLeft,
    ChevronRight,
    Folder,
    Plus,
    Settings,
    Lock,
    Home,
    MoreHorizontal,
    Pencil,
    Trash2
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from '@/components/ui/tooltip';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { useVault } from '@/contexts/VaultContext';
import { useAuth } from '@/contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { CategoryIcon } from './CategoryIcon';
import { CategoryDialog } from './CategoryDialog';

interface Category {
    id: string;
    name: string;
    icon: string | null;
    color: string | null;
    count?: number;
}

interface VaultSidebarProps {
    selectedCategory: string | null;
    onSelectCategory: (categoryId: string | null) => void;
}

const ENCRYPTED_CATEGORY_PREFIX = 'enc:cat:v1:';
const ENCRYPTED_ITEM_TITLE_PLACEHOLDER = 'Encrypted Item';

export function VaultSidebar({ selectedCategory, onSelectCategory }: VaultSidebarProps) {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const { lock, encryptData, decryptData, decryptItem, encryptItem } = useVault();
    const { user } = useAuth();
    const [collapsed, setCollapsed] = useState(false);

    // Categories state
    const [categories, setCategories] = useState<Category[]>([]);
    const [loading, setLoading] = useState(true);

    // Dialog state
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editingCategory, setEditingCategory] = useState<Category | null>(null);

    // Fetch categories
    const fetchCategories = useCallback(async () => {
        if (!user) return;

        try {
            // Get categories
            const { data: cats, error } = await supabase
                .from('categories')
                .select('id, name, icon, color')
                .eq('user_id', user.id)
                .order('sort_order', { ascending: true });

            if (error) throw error;

            // Get item counts per category
            const { data: vault } = await supabase
                .from('vaults')
                .select('id')
                .eq('user_id', user.id)
                .eq('is_default', true)
                .single();

            if (vault) {
                const { data: items } = await supabase
                    .from('vault_items')
                    .select('id, title, website_url, icon_url, item_type, is_favorite, category_id, encrypted_data')
                    .eq('vault_id', vault.id);

                // Count items per category
                const counts: Record<string, number> = {};
                await Promise.all(
                    (items || []).map(async (item) => {
                        try {
                            const decryptedData = await decryptItem(item.encrypted_data);
                            const resolvedCategoryId = decryptedData.categoryId ?? item.category_id;
                            const resolvedTitle = decryptedData.title || item.title;
                            const resolvedWebsiteUrl = decryptedData.websiteUrl || item.website_url || undefined;
                            const resolvedItemType = decryptedData.itemType || item.item_type || 'password';
                            const resolvedIsFavorite = typeof decryptedData.isFavorite === 'boolean'
                                ? decryptedData.isFavorite
                                : !!item.is_favorite;
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
                                    title: resolvedTitle,
                                    websiteUrl: resolvedWebsiteUrl,
                                    itemType: resolvedItemType,
                                    isFavorite: resolvedIsFavorite,
                                    categoryId: resolvedCategoryId,
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
                            }

                            if (resolvedCategoryId) {
                                counts[resolvedCategoryId] = (counts[resolvedCategoryId] || 0) + 1;
                            }
                        } catch (err) {
                            console.error('Failed to decrypt vault item for category counts:', item.id, err);
                            if (item.category_id) {
                                counts[item.category_id] = (counts[item.category_id] || 0) + 1;
                            }
                        }
                    })
                );

                const resolvedCategories = await Promise.all(
                    (cats || []).map(async (cat) => {
                        let resolvedName = cat.name;
                        let resolvedIcon = cat.icon;
                        let resolvedColor = cat.color;

                        if (cat.name.startsWith(ENCRYPTED_CATEGORY_PREFIX)) {
                            try {
                                resolvedName = await decryptData(cat.name.slice(ENCRYPTED_CATEGORY_PREFIX.length));
                            } catch (err) {
                                console.error('Failed to decrypt category name:', cat.id, err);
                                resolvedName = 'Encrypted Category';
                            }
                        } else {
                            try {
                                const encryptedName = await encryptData(cat.name);
                                await supabase
                                    .from('categories')
                                    .update({ name: `${ENCRYPTED_CATEGORY_PREFIX}${encryptedName}` })
                                    .eq('id', cat.id);
                            } catch (err) {
                                console.error('Failed to migrate category name:', cat.id, err);
                            }
                        }

                        if (cat.icon && cat.icon.startsWith(ENCRYPTED_CATEGORY_PREFIX)) {
                            try {
                                resolvedIcon = await decryptData(cat.icon.slice(ENCRYPTED_CATEGORY_PREFIX.length));
                            } catch (err) {
                                console.error('Failed to decrypt category icon:', cat.id, err);
                                resolvedIcon = null;
                            }
                        } else if (cat.icon) {
                            try {
                                const encryptedIcon = await encryptData(cat.icon);
                                await supabase
                                    .from('categories')
                                    .update({ icon: `${ENCRYPTED_CATEGORY_PREFIX}${encryptedIcon}` })
                                    .eq('id', cat.id);
                            } catch (err) {
                                console.error('Failed to migrate category icon:', cat.id, err);
                            }
                        }

                        if (cat.color && cat.color.startsWith(ENCRYPTED_CATEGORY_PREFIX)) {
                            try {
                                resolvedColor = await decryptData(cat.color.slice(ENCRYPTED_CATEGORY_PREFIX.length));
                            } catch (err) {
                                console.error('Failed to decrypt category color:', cat.id, err);
                                resolvedColor = '#3b82f6';
                            }
                        } else if (cat.color) {
                            try {
                                const encryptedColor = await encryptData(cat.color);
                                await supabase
                                    .from('categories')
                                    .update({ color: `${ENCRYPTED_CATEGORY_PREFIX}${encryptedColor}` })
                                    .eq('id', cat.id);
                            } catch (err) {
                                console.error('Failed to migrate category color:', cat.id, err);
                            }
                        }

                        return {
                            ...cat,
                            name: resolvedName,
                            icon: resolvedIcon,
                            color: resolvedColor,
                            count: counts[cat.id] || 0,
                        };
                    })
                );

                setCategories(resolvedCategories);
            } else {
                const resolvedCategories = await Promise.all(
                    (cats || []).map(async (cat) => {
                        let resolvedName = cat.name;
                        let resolvedIcon = cat.icon;
                        let resolvedColor = cat.color;

                        if (cat.name.startsWith(ENCRYPTED_CATEGORY_PREFIX)) {
                            try {
                                resolvedName = await decryptData(cat.name.slice(ENCRYPTED_CATEGORY_PREFIX.length));
                            } catch (err) {
                                console.error('Failed to decrypt category name:', cat.id, err);
                                resolvedName = 'Encrypted Category';
                            }
                        }

                        if (cat.icon && cat.icon.startsWith(ENCRYPTED_CATEGORY_PREFIX)) {
                            try {
                                resolvedIcon = await decryptData(cat.icon.slice(ENCRYPTED_CATEGORY_PREFIX.length));
                            } catch (err) {
                                console.error('Failed to decrypt category icon:', cat.id, err);
                                resolvedIcon = null;
                            }
                        }

                        if (cat.color && cat.color.startsWith(ENCRYPTED_CATEGORY_PREFIX)) {
                            try {
                                resolvedColor = await decryptData(cat.color.slice(ENCRYPTED_CATEGORY_PREFIX.length));
                            } catch (err) {
                                console.error('Failed to decrypt category color:', cat.id, err);
                                resolvedColor = '#3b82f6';
                            }
                        }

                        return {
                            ...cat,
                            name: resolvedName,
                            icon: resolvedIcon,
                            color: resolvedColor,
                        };
                    })
                );

                setCategories(resolvedCategories);
            }
        } catch (err) {
            console.error('Error fetching categories:', err);
        } finally {
            setLoading(false);
        }
    }, [user, encryptData, decryptData, decryptItem, encryptItem]);

    useEffect(() => {
        fetchCategories();
    }, [fetchCategories, t]);

    const handleAddCategory = () => {
        setEditingCategory(null);
        setDialogOpen(true);
    };

    const handleEditCategory = (category: Category) => {
        setEditingCategory(category);
        setDialogOpen(true);
    };

    const handleCategoryChange = () => {
        fetchCategories();
    };

    return (
        <>
            <aside
                className={cn(
                    'h-screen bg-card border-r flex flex-col transition-all duration-300',
                    collapsed ? 'w-16' : 'w-64'
                )}
            >
                {/* Header */}
                <div className="p-4 flex items-center justify-between border-b">
                    {!collapsed && (
                        <h2 className="font-semibold text-lg">
                            {t('vault.sidebar.title')}
                        </h2>
                    )}
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => setCollapsed(!collapsed)}
                    >
                        {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
                    </Button>
                </div>

                {/* Quick Navigation */}
                <div className="p-2">
                    <SidebarItem
                        icon={<Home className="w-4 h-4" />}
                        label={t('vault.sidebar.allItems')}
                        collapsed={collapsed}
                        active={!selectedCategory}
                        onClick={() => onSelectCategory(null)}
                    />
                </div>

                <Separator />

                {/* Categories */}
                <ScrollArea className="flex-1 p-2">
                    <div className="space-y-1">
                        {!collapsed && (
                            <div className="flex items-center justify-between px-2 py-1.5">
                                <span className="text-xs font-medium text-muted-foreground uppercase">
                                    {t('vault.sidebar.categories')}
                                </span>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-6 w-6"
                                    onClick={handleAddCategory}
                                >
                                    <Plus className="w-3 h-3" />
                                </Button>
                            </div>
                        )}

                        {loading ? (
                            <div className="px-3 py-2 text-sm text-muted-foreground">
                                {t('common.loading')}...
                            </div>
                        ) : categories.length === 0 ? (
                            !collapsed && (
                                <div className="px-3 py-4 text-center">
                                    <Folder className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
                                    <p className="text-sm text-muted-foreground">
                                        {t('categories.empty')}
                                    </p>
                                    <Button
                                        variant="link"
                                        size="sm"
                                        onClick={handleAddCategory}
                                        className="mt-1"
                                    >
                                        {t('categories.addFirst')}
                                    </Button>
                                </div>
                            )
                        ) : (
                            categories.map((category) => (
                                <div key={category.id} className="group relative">
                                    <SidebarItem
                                        icon={
                                            collapsed ? (
                                                <Folder className="w-4 h-4" />
                                            ) : (
                                                <CategoryIcon icon={category.icon} />
                                            )
                                        }
                                        label={category.name}
                                        count={category.count}
                                        collapsed={collapsed}
                                        active={selectedCategory === category.id}
                                        onClick={() => onSelectCategory(category.id)}
                                        color={category.color}
                                    />

                                    {/* Edit menu (visible on hover) */}
                                    {!collapsed && (
                                        <div className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <Button variant="ghost" size="icon" className="h-6 w-6">
                                                        <MoreHorizontal className="w-3 h-3" />
                                                    </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end">
                                                    <DropdownMenuItem onClick={() => handleEditCategory(category)}>
                                                        <Pencil className="w-4 h-4 mr-2" />
                                                        {t('common.edit')}
                                                    </DropdownMenuItem>
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        </div>
                                    )}
                                </div>
                            ))
                        )}
                    </div>
                </ScrollArea>

                <Separator />

                {/* Footer Actions */}
                <div className="p-2 space-y-1">
                    <SidebarItem
                        icon={<Settings className="w-4 h-4" />}
                        label={t('vault.sidebar.settings')}
                        collapsed={collapsed}
                        onClick={() => navigate('/settings')}
                    />
                    <SidebarItem
                        icon={<Lock className="w-4 h-4" />}
                        label={t('vault.sidebar.lock')}
                        collapsed={collapsed}
                        onClick={() => {
                            lock();
                            navigate('/vault', { replace: true });
                        }}
                        variant="destructive"
                    />
                </div>
            </aside>

            {/* Category Dialog */}
            <CategoryDialog
                open={dialogOpen}
                onOpenChange={setDialogOpen}
                category={editingCategory}
                onSave={handleCategoryChange}
            />
        </>
    );
}

interface SidebarItemProps {
    icon: React.ReactNode;
    label: string;
    count?: number;
    collapsed?: boolean;
    active?: boolean;
    variant?: 'default' | 'destructive';
    color?: string | null;
    onClick?: () => void;
}

function SidebarItem({
    icon,
    label,
    count,
    collapsed,
    active,
    variant = 'default',
    color,
    onClick
}: SidebarItemProps) {
    const content = (
        <button
            onClick={onClick}
            className={cn(
                'w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors',
                'hover:bg-accent/50',
                active && 'bg-accent text-accent-foreground',
                variant === 'destructive' && 'text-destructive hover:bg-destructive/10',
                collapsed && 'justify-center px-0'
            )}
        >
            <span style={color ? { color } : undefined}>{icon}</span>
            {!collapsed && (
                <>
                    <span className="flex-1 text-left text-sm truncate">{label}</span>
                    {count !== undefined && count > 0 && (
                        <span className="text-xs text-muted-foreground">{count}</span>
                    )}
                </>
            )}
        </button>
    );

    if (collapsed) {
        return (
            <Tooltip>
                <TooltipTrigger asChild>
                    {content}
                </TooltipTrigger>
                <TooltipContent side="right">
                    <p>{label}</p>
                </TooltipContent>
            </Tooltip>
        );
    }

    return content;
}

