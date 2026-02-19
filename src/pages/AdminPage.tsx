// Copyright (c) 2025-2026 Maunting Studios
// Licensed under the Business Source License 1.1 — see LICENSE
/**
 * @fileoverview Admin Page
 *
 * Internal area for support operations and no-code team access management.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Shield, ShieldAlert, Wrench } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AdminSupportPanel } from '@/components/admin/AdminSupportPanel';
import { AdminTeamPermissionsPanel } from '@/components/admin/AdminTeamPermissionsPanel';
import { useAuth } from '@/contexts/AuthContext';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { getTeamAccess, type TeamAccess } from '@/services/adminService';

const SUPPORT_TAB_PERMISSIONS = [
    'support.tickets.read',
    'support.tickets.reply',
    'support.tickets.reply_internal',
    'support.tickets.status',
    'support.metrics.read',
    'subscriptions.read',
    'subscriptions.manage',
];

/**
 * Checks whether the support tab should be visible.
 *
 * @param access - Team access snapshot
 * @param billingDisabled - Self-hosted billing flag
 * @returns True when support tab can be used
 */
function canShowSupportTab(access: TeamAccess | null, billingDisabled: boolean): boolean {
    if (billingDisabled) return false; // Self-host: no managed support
    if (!access?.can_access_admin) {
        return false;
    }
    if (!access.permissions.includes('support.admin.access')) {
        return false;
    }
    return access.permissions.some((permission) => SUPPORT_TAB_PERMISSIONS.includes(permission));
}

export default function AdminPage() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const { user, loading } = useAuth();
    const { billingDisabled } = useSubscription();

    const [access, setAccess] = useState<TeamAccess | null>(null);
    const [isLoadingAccess, setIsLoadingAccess] = useState(true);
    const [accessError, setAccessError] = useState<string | null>(null);

    useEffect(() => {
        if (!loading && !user) {
            navigate('/auth', { replace: true });
        }
    }, [loading, navigate, user]);

    useEffect(() => {
        const loadAccess = async () => {
            if (!user) {
                setAccess(null);
                setIsLoadingAccess(false);
                return;
            }

            setIsLoadingAccess(true);
            setAccessError(null);

            const { access: accessPayload, error } = await getTeamAccess();
            setIsLoadingAccess(false);

            if (error || !accessPayload) {
                setAccess(null);
                setAccessError(error?.message || t('admin.loadError'));
                return;
            }

            setAccess(accessPayload);
        };

        void loadAccess();
    }, [t, user]);

    const canSupportTab = useMemo(() => {
        return canShowSupportTab(access, billingDisabled);
    }, [access, billingDisabled]);

    const canTeamTab = useMemo(() => {
        if (!access?.is_admin) {
            return false;
        }
        return access.permissions.some((permission) =>
            [
                'team.roles.read',
                'team.roles.manage',
                'team.permissions.read',
                'team.permissions.manage',
            ].includes(permission),
        );
    }, [access]);

    const defaultTab = canSupportTab ? 'support' : 'team';

    if (loading || isLoadingAccess) {
        return (
            <div className="flex items-center justify-center min-h-screen">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
            </div>
        );
    }

    if (!user) {
        return null;
    }

    if (!access?.can_access_admin || (!canSupportTab && !canTeamTab)) {
        return (
            <div className="min-h-screen bg-background">
                <header className="border-b">
                    <div className="container max-w-6xl mx-auto px-4 h-16 flex items-center gap-3">
                        <Button variant="ghost" size="icon" onClick={() => navigate('/settings')}>
                            <ArrowLeft className="w-5 h-5" />
                        </Button>
                        <div className="flex items-center gap-2">
                            <Shield className="w-5 h-5 text-primary" />
                            <h1 className="text-lg font-semibold">{t('admin.title')}</h1>
                        </div>
                    </div>
                </header>
                <main className="container max-w-3xl mx-auto px-4 py-8">
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <ShieldAlert className="w-5 h-5 text-destructive" />
                                {t('admin.accessDeniedTitle')}
                            </CardTitle>
                            <CardDescription>
                                {accessError || t('admin.accessDeniedDescription')}
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <Button onClick={() => navigate('/settings')}>{t('admin.backToSettings')}</Button>
                        </CardContent>
                    </Card>
                </main>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-background">
            <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
                <div className="container max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <Button variant="ghost" size="icon" onClick={() => navigate('/settings')}>
                            <ArrowLeft className="w-5 h-5" />
                        </Button>
                        <div className="flex items-center gap-2">
                            <Wrench className="w-5 h-5 text-primary" />
                            <h1 className="text-lg font-semibold">{t('admin.title')}</h1>
                        </div>
                    </div>
                    <Link
                        to="/"
                        className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
                    >
                        <Shield className="w-4 h-4" />
                        <span className="hidden sm:inline text-sm font-medium">{t('admin.brand')}</span>
                    </Link>
                </div>
            </header>

            <main className="container max-w-6xl mx-auto px-4 py-6 space-y-4">
                <Card>
                    <CardHeader>
                        <CardTitle>{t('admin.title')}</CardTitle>
                        <CardDescription>{t('admin.description')}</CardDescription>
                    </CardHeader>
                </Card>

                <Tabs defaultValue={defaultTab} className="space-y-4">
                    <TabsList>
                        {canSupportTab && <TabsTrigger value="support">{t('admin.tabs.support')}</TabsTrigger>}
                        {canTeamTab && <TabsTrigger value="team">{t('admin.tabs.team')}</TabsTrigger>}
                    </TabsList>

                    {canSupportTab && (
                        <TabsContent value="support">
                            <AdminSupportPanel permissions={access.permissions} />
                        </TabsContent>
                    )}

                    {canTeamTab && (
                        <TabsContent value="team">
                            <AdminTeamPermissionsPanel permissions={access.permissions} />
                        </TabsContent>
                    )}
                </Tabs>
            </main>
        </div>
    );
}

if (import.meta.vitest) {
    const { describe, it, expect } = import.meta.vitest;

    describe('canShowSupportTab', () => {
        it('should return false when user only has subscriptions.manage without support.admin.access', () => {
            const access: TeamAccess = {
                roles: ['moderator'],
                permissions: ['subscriptions.manage'],
                is_admin: false,
                can_access_admin: true,
            };

            expect(canShowSupportTab(access, false)).toBe(false);
        });
    });
}
