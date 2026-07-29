// Copyright (c) 2025-2026 Maunting Studios
// Licensed under the Business Source License 1.1 — see LICENSE
/**
 * @fileoverview Admin entry control for account-authenticated surfaces.
 *
 * Admin access is intentionally independent from vault unlock state.
 * Authorization is confirmed server-side when the admin route loads.
 */

import { useLocation, useNavigate } from 'react-router-dom';
import { Wrench } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { isPremiumActive } from '@/extensions/registry';
import { useAdminPanelAccess } from '@/hooks/use-admin-panel-access';
import { getAdminEntryPath } from '@/platform/appShell';
import { buildReturnState } from '@/services/returnNavigationState';

interface AdminEntryButtonProps {
    variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link';
    size?: 'default' | 'sm' | 'lg' | 'icon';
    className?: string;
    showLabel?: boolean;
    labelClassName?: string;
    fullWidth?: boolean;
}

export function AdminEntryButton({
    variant = 'outline',
    size = 'default',
    className,
    showLabel = true,
    labelClassName,
    fullWidth = false,
}: AdminEntryButtonProps) {
    const navigate = useNavigate();
    const location = useLocation();
    const { t } = useTranslation();
    const adminEntryPath = getAdminEntryPath();
    const { showAdminButton } = useAdminPanelAccess({
        enabled: isPremiumActive(),
    });

    if (!showAdminButton || !adminEntryPath) {
        return null;
    }

    return (
        <Button
            type="button"
            variant={variant}
            size={size}
            className={fullWidth ? `w-full ${className ?? ''}`.trim() : className}
            onClick={() => navigate(adminEntryPath, { state: buildReturnState(location) })}
        >
            <Wrench className={showLabel ? 'mr-2 h-4 w-4' : 'h-4 w-4'} />
            {showLabel ? (
                <span className={labelClassName}>{t('admin.title')}</span>
            ) : (
                <span className="sr-only">{t('admin.title')}</span>
            )}
        </Button>
    );
}