/**
 * @fileoverview Vault Page - Main Dashboard
 * 
 * Central hub for managing all vault items including passwords,
 * secure notes, and TOTP entries.
 */

import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import {
    Plus,
    Search,
    Key,
    FileText,
    Shield,
    Star,
    Grid3X3,
    List,
    Loader2
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/contexts/AuthContext';
import { useVault } from '@/contexts/VaultContext';
import { MasterPasswordSetup } from '@/components/vault/MasterPasswordSetup';
import { VaultUnlock } from '@/components/vault/VaultUnlock';
import { VaultSidebar } from '@/components/vault/VaultSidebar';
import { VaultItemList } from '@/components/vault/VaultItemList';
import { VaultItemDialog } from '@/components/vault/VaultItemDialog';

export type ItemFilter = 'all' | 'passwords' | 'notes' | 'totp' | 'favorites';
export type ViewMode = 'grid' | 'list';

export default function VaultPage() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const { user, loading: authLoading } = useAuth();
    const { isLocked, isSetupRequired, isLoading: vaultLoading } = useVault();

    // State
    const [searchQuery, setSearchQuery] = useState('');
    const [activeFilter, setActiveFilter] = useState<ItemFilter>('all');
    const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
    const [viewMode, setViewMode] = useState<ViewMode>('grid');
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editingItemId, setEditingItemId] = useState<string | null>(null);
    const [refreshKey, setRefreshKey] = useState(0);

    // Redirect if not authenticated
    if (!authLoading && !user) {
        navigate('/auth');
        return null;
    }

    // Loading state
    if (authLoading || vaultLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-background">
                <div className="text-center space-y-4">
                    <Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" />
                    <p className="text-muted-foreground">{t('common.loading')}</p>
                </div>
            </div>
        );
    }

    // Master password setup required
    if (isSetupRequired) {
        return <MasterPasswordSetup />;
    }

    // Vault is locked
    if (isLocked) {
        return <VaultUnlock />;
    }

    const handleOpenNewItem = () => {
        setEditingItemId(null);
        setDialogOpen(true);
    };

    const handleEditItem = (itemId: string) => {
        setEditingItemId(itemId);
        setDialogOpen(true);
    };

    const handleItemSaved = () => {
        // Trigger refresh of item list without full page reload
        setRefreshKey(prev => prev + 1);
    };

    return (
        <div className="min-h-screen bg-background flex">
            {/* Sidebar */}
            <VaultSidebar
                selectedCategory={selectedCategory}
                onSelectCategory={setSelectedCategory}
            />

            {/* Main Content */}
            <div className="flex-1 flex flex-col">
                {/* Header */}
                <header className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b px-4 lg:px-6 py-4">
                    <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
                        {/* Search */}
                        <div className="relative w-full sm:max-w-md">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                            <Input
                                placeholder={t('vault.search.placeholder')}
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="pl-10"
                            />
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-2">
                            <Button asChild variant="outline">
                                <Link to="/">{t('nav.home')}</Link>
                            </Button>

                            {/* View Mode Toggle */}
                            <div className="hidden sm:flex border rounded-lg p-0.5">
                                <Button
                                    variant={viewMode === 'grid' ? 'secondary' : 'ghost'}
                                    size="icon"
                                    className="h-8 w-8"
                                    onClick={() => setViewMode('grid')}
                                >
                                    <Grid3X3 className="w-4 h-4" />
                                </Button>
                                <Button
                                    variant={viewMode === 'list' ? 'secondary' : 'ghost'}
                                    size="icon"
                                    className="h-8 w-8"
                                    onClick={() => setViewMode('list')}
                                >
                                    <List className="w-4 h-4" />
                                </Button>
                            </div>

                            {/* New Item Button */}
                            <Button onClick={handleOpenNewItem}>
                                <Plus className="w-4 h-4 mr-2" />
                                {t('vault.actions.add')}
                            </Button>
                        </div>
                    </div>

                    {/* Filters */}
                    <Tabs value={activeFilter} onValueChange={(v) => setActiveFilter(v as ItemFilter)} className="mt-4">
                        <TabsList>
                            <TabsTrigger value="all" className="flex items-center gap-1.5">
                                <Shield className="w-4 h-4" />
                                <span className="hidden sm:inline">{t('vault.filters.all')}</span>
                            </TabsTrigger>
                            <TabsTrigger value="passwords" className="flex items-center gap-1.5">
                                <Key className="w-4 h-4" />
                                <span className="hidden sm:inline">{t('vault.filters.passwords')}</span>
                            </TabsTrigger>
                            <TabsTrigger value="notes" className="flex items-center gap-1.5">
                                <FileText className="w-4 h-4" />
                                <span className="hidden sm:inline">{t('vault.filters.notes')}</span>
                            </TabsTrigger>
                            <TabsTrigger value="totp" className="flex items-center gap-1.5">
                                <Shield className="w-4 h-4" />
                                <span className="hidden sm:inline">{t('vault.filters.totp')}</span>
                            </TabsTrigger>
                            <TabsTrigger value="favorites" className="flex items-center gap-1.5">
                                <Star className="w-4 h-4" />
                                <span className="hidden sm:inline">{t('vault.filters.favorites')}</span>
                            </TabsTrigger>
                        </TabsList>
                    </Tabs>
                </header>

                {/* Item List */}
                <main className="flex-1 p-4 lg:p-6">
                    <VaultItemList
                        searchQuery={searchQuery}
                        filter={activeFilter}
                        categoryId={selectedCategory}
                        viewMode={viewMode}
                        onEditItem={handleEditItem}
                        refreshKey={refreshKey}
                    />
                </main>

                <footer className="border-t px-4 lg:px-6 py-3 text-xs text-muted-foreground">
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
            </div>

            {/* Create/Edit Dialog */}
            <VaultItemDialog
                open={dialogOpen}
                onOpenChange={setDialogOpen}
                itemId={editingItemId}
                onSave={handleItemSaved}
            />
        </div>
    );
}
