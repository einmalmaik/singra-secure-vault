// Copyright (c) 2025-2026 Maunting Studios
// Licensed under the Business Source License 1.1 - see LICENSE
/**
 * @fileoverview Cookie consent wrapper that coordinates banner visibility,
 * settings dialog state, and backwards-compatible localStorage persistence.
 */

import { useEffect, useState } from 'react';

import { CookieBanner } from '@/components/CookieBanner';
import { CookieSettingsDialog } from '@/components/CookieSettingsDialog';
import { isTauriRuntime } from '@/platform/runtime';
import {
    clearOptionalCookieData,
    readCookieConsent,
    saveCookieConsent,
} from '@/lib/cookieConsent';
const BANNER_ENTER_DELAY_MS = 80;
const BANNER_EXIT_DELAY_MS = 250;

interface CookieConsentProps {
    variant?: 'default' | 'minimal';
}

export function CookieConsent({ variant: _variant = 'default' }: CookieConsentProps) {
    const [isBannerVisible, setIsBannerVisible] = useState(false);
    const [isBannerMounted, setIsBannerMounted] = useState(false);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [optional, setOptional] = useState(false);
    const [supportIntegration, setSupportIntegration] = useState(false);

    useEffect(() => {
        if (isTauriRuntime()) {
            return;
        }

        const consent = readCookieConsent();
        if (!consent) {
            clearOptionalCookieData();
            setIsBannerMounted(true);
            const timer = window.setTimeout(() => setIsBannerVisible(true), BANNER_ENTER_DELAY_MS);
            return () => window.clearTimeout(timer);
        }

        setOptional(consent.optional === true);
        setSupportIntegration(consent.supportIntegration === true);
        if (!consent.optional) {
            clearOptionalCookieData();
        }
    }, []);

    useEffect(() => {
        const handleOpenSettings = () => {
            const consent = readCookieConsent();
            if (consent) {
                setOptional(consent.optional === true);
                setSupportIntegration(consent.supportIntegration === true);
            }
            setIsSettingsOpen(true);
        };

        window.addEventListener('singra:open-cookie-settings', handleOpenSettings);
        return () => window.removeEventListener('singra:open-cookie-settings', handleOpenSettings);
    }, []);

    const dismissBanner = () => {
        setIsBannerVisible(false);
        window.setTimeout(() => setIsBannerMounted(false), BANNER_EXIT_DELAY_MS);
    };

    const handleAcceptAll = () => {
        saveCookieConsent({ optional: true, supportIntegration: true });
        setOptional(true);
        setSupportIntegration(true);
        window.dispatchEvent(new Event('singra:support-consent-changed'));
        dismissBanner();
    };

    const handleEssentialOnly = () => {
        saveCookieConsent({ optional: false, supportIntegration: false });
        clearOptionalCookieData();
        setOptional(false);
        setSupportIntegration(false);
        window.dispatchEvent(new Event('singra:support-consent-changed'));
        dismissBanner();
    };

    const handleCustomize = () => {
        setIsSettingsOpen(true);
    };

    const handleSettingsOpenChange = (open: boolean) => {
        if (open) {
            const consent = readCookieConsent();
            if (consent) {
                setOptional(consent.optional === true);
                setSupportIntegration(consent.supportIntegration === true);
            }
        }

        setIsSettingsOpen(open);
    };

    const handleSaveSettings = () => {
        const previouslyEnabled = readCookieConsent()?.supportIntegration === true;
        saveCookieConsent({ optional, supportIntegration });
        if (!optional) {
            clearOptionalCookieData();
        }
        setIsSettingsOpen(false);
        window.dispatchEvent(new Event('singra:support-consent-changed'));

        if (isBannerMounted) {
            dismissBanner();
        }

        if (previouslyEnabled && !supportIntegration) {
            window.location.reload();
        }
    };

    if (!isBannerMounted && !isSettingsOpen) {
        return null;
    }

    return (
        <>
            <CookieBanner
                visible={isBannerMounted}
                isActive={isBannerVisible}
                onAcceptAll={handleAcceptAll}
                onEssentialOnly={handleEssentialOnly}
                onCustomize={handleCustomize}
            />
            <CookieSettingsDialog
                open={isSettingsOpen}
                optional={optional}
                supportIntegration={supportIntegration}
                onOpenChange={handleSettingsOpenChange}
                onOptionalChange={setOptional}
                onSupportIntegrationChange={setSupportIntegration}
                onSave={handleSaveSettings}
            />
        </>
    );
}
