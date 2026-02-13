// Copyright (c) 2025-2026 Maunting Studios
// Licensed under the Business Source License 1.1 — see LICENSE
/**
 * @fileoverview Category Icon Component
 * 
 * Renders category icons that can be either emoji or inline SVG.
 * Detects the type automatically based on content.
 */

import { Folder } from 'lucide-react';
import { cn } from '@/lib/utils';
import { sanitizeInlineSvg } from '@/lib/sanitizeSvg';

interface CategoryIconProps {
    icon: string | null | undefined;
    className?: string;
    fallbackSize?: number;
}

/**
 * Detects if the given string is an SVG
 */
function isSvg(str: string): boolean {
    return str.trim().startsWith('<svg') || str.trim().startsWith('<?xml');
}

/**
 * Detects if the given string is an emoji
 * (rough check: short content that isn't SVG)
 */
function isEmoji(str: string): boolean {
    const trimmed = str.trim();
    return trimmed.length <= 4 && !isSvg(trimmed);
}

export function CategoryIcon({ icon, className, fallbackSize = 4 }: CategoryIconProps) {
    // No icon - show folder fallback
    if (!icon || icon.trim() === '') {
        return <Folder className={cn(`w-${fallbackSize} h-${fallbackSize}`, className)} />;
    }

    const trimmedIcon = icon.trim();

    // SVG icon - render inline
    if (isSvg(trimmedIcon)) {
        const safeSvg = sanitizeInlineSvg(trimmedIcon);
        if (!safeSvg) {
            return <Folder className={cn(`w-${fallbackSize} h-${fallbackSize}`, className)} />;
        }

        return (
            <span
                className={cn('inline-flex items-center justify-center', className)}
                dangerouslySetInnerHTML={{ __html: safeSvg }}
            />
        );
    }

    // Emoji or text icon
    return (
        <span className={cn('text-base leading-none', className)}>
            {trimmedIcon}
        </span>
    );
}
