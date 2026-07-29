export const CONSENT_STORAGE_KEY = 'singra-cookie-consent';

const OPTIONAL_STORAGE_KEYS = ['Singra-language', 'i18nextLng', 'singra_autolock'] as const;
const LEGACY_SIDEBAR_COOKIE = 'sidebar:state';

export interface StoredCookieConsent {
    version: 2;
    necessary: true;
    optional: boolean;
    supportIntegration: boolean;
    analytics?: boolean;
    timestamp?: string;
}

interface SaveCookieConsentInput {
    optional: boolean;
    supportIntegration: boolean;
}

const isStoredCookieConsent = (value: unknown): value is StoredCookieConsent => {
    if (typeof value !== 'object' || value === null) {
        return false;
    }

    const candidate = value as Partial<StoredCookieConsent>;
    return candidate.version === 2
        && candidate.necessary === true
        && typeof candidate.optional === 'boolean'
        && typeof candidate.supportIntegration === 'boolean';
};

export function readCookieConsent(): StoredCookieConsent | null {
    try {
        const stored = localStorage.getItem(CONSENT_STORAGE_KEY);
        if (!stored) {
            return null;
        }

        const parsed = JSON.parse(stored) as unknown;
        return isStoredCookieConsent(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

export function saveCookieConsent({ optional, supportIntegration }: SaveCookieConsentInput): StoredCookieConsent {
    const consent: StoredCookieConsent = {
        version: 2,
        necessary: true,
        optional,
        supportIntegration,
        analytics: false,
        timestamp: new Date().toISOString(),
    };

    localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(consent));
    return consent;
}

export function hasOptionalCookieConsent(): boolean {
    return readCookieConsent()?.optional === true;
}

export function hasSupportIntegrationConsent(): boolean {
    return readCookieConsent()?.supportIntegration === true;
}

export function clearOptionalCookieData(): void {
    OPTIONAL_STORAGE_KEYS.forEach((key) => {
        localStorage.removeItem(key);
    });

    document.cookie = `${LEGACY_SIDEBAR_COOKIE}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}
