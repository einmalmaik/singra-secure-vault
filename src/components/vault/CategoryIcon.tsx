// Copyright (c) 2025-2026 Maunting Studios
// Licensed under the Business Source License 1.1 — see LICENSE
/**
 * @fileoverview Category Icon Component
 * 
 * Renders category icons as emoji/text only.
 * Legacy SVG payloads are intentionally ignored for security hardening.
 */

import { Folder } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CategoryIconProps {
    icon: string | null | undefined;
    className?: string;
    fallbackSize?: number;
}

function isSvgPayload(str: string): boolean {
    return str.trim().startsWith('<svg') || str.trim().startsWith('<?xml');
}

export function CategoryIcon({ icon, className, fallbackSize = 4 }: CategoryIconProps) {
    // No icon - show folder fallback
    if (!icon || icon.trim() === '') {
        return <Folder className={cn(`w-${fallbackSize} h-${fallbackSize}`, className)} />;
    }

    const trimmedIcon = icon.trim();

    // Legacy SVG icon payloads are blocked and replaced with fallback icon.
    if (isSvgPayload(trimmedIcon)) {
        return <Folder className={cn(`w-${fallbackSize} h-${fallbackSize}`, className)} />;
    }

    // Emoji or text icon
    return (
        <span className={cn('text-base leading-none', className)}>
            {trimmedIcon}
        </span>
    );
}
