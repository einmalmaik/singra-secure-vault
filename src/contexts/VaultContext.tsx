/**
 * @fileoverview Vault Context for Singra PW
 * 
 * Manages vault encryption state including:
 * - Master password unlock status
 * - Derived encryption key (kept in memory only)
 * - Auto-lock on inactivity
 * - Vault item encryption/decryption helpers
 */

import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import {
    deriveKey,
    deriveRawKey,
    generateSalt,
    encrypt,
    decrypt,
    importMasterKey,
    createVerificationHash,
    verifyKey,
    encryptVaultItem,
    decryptVaultItem,
    secureClear,
    attemptKdfUpgrade,
    CURRENT_KDF_VERSION,
    VaultItemData
} from '@/services/cryptoService';
import {
    isLikelyOfflineError,
    getOfflineCredentials,
    saveOfflineCredentials,
} from '@/services/offlineVaultService';
import {
    authenticatePasskey,
    isWebAuthnAvailable,
} from '@/services/passkeyService';
import {
    getDuressConfig,
    attemptDualUnlock,
    isDecoyItem,
    DuressConfig,
} from '@/services/duressService';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './AuthContext';
import {
    getUnlockCooldown,
    recordFailedAttempt,
    resetUnlockAttempts,
} from '@/services/rateLimiterService';
import {
    deriveIntegrityKey,
    verifyVaultIntegrity,
    updateIntegrityRoot,
    clearIntegrityRoot,
    type VaultItemForIntegrity,
    type IntegrityVerificationResult,
} from '@/services/vaultIntegrityService';

// Auto-lock timeout in milliseconds (default 15 minutes)
const DEFAULT_AUTO_LOCK_TIMEOUT = 15 * 60 * 1000;

// Session storage keys
const SESSION_KEY = 'singra_session';
const SESSION_TIMESTAMP_KEY = 'singra_session_ts';
const SESSION_PASSWORD_HINT_KEY = 'singra_session_hint';

interface VaultContextType {
    // State
    isLocked: boolean;
    isSetupRequired: boolean;
    isLoading: boolean;
    pendingSessionRestore: boolean;
    /** Whether the vault is currently in duress (decoy) mode */
    isDuressMode: boolean;

    // Actions
    setupMasterPassword: (masterPassword: string) => Promise<{ error: Error | null }>;
    unlock: (masterPassword: string) => Promise<{ error: Error | null }>;
    unlockWithPasskey: () => Promise<{ error: Error | null }>;
    lock: () => void;

    // Passkey support
    /** Whether the browser supports WebAuthn */
    webAuthnAvailable: boolean;
    /** Whether the user has registered passkeys with PRF */
    hasPasskeyUnlock: boolean;
    /**
     * Derives raw AES-256 key bytes from the master password (for passkey registration).
     * Must be called while vault is unlocked. Returns null if vault is locked.
     */
    getRawKeyForPasskey: (masterPassword: string) => Promise<Uint8Array | null>;

    // Encryption helpers
    encryptData: (plaintext: string) => Promise<string>;
    decryptData: (encrypted: string) => Promise<string>;
    encryptItem: (data: VaultItemData) => Promise<string>;
    decryptItem: (encryptedData: string) => Promise<VaultItemData>;

    // Settings
    autoLockTimeout: number;
    setAutoLockTimeout: (timeout: number) => void;

    // Vault Integrity (tamper detection)
    /**
     * Verifies vault items against stored integrity root.
     * Call this after loading vault items to detect server-side tampering.
     * @returns Verification result with valid flag and details
     */
    verifyIntegrity: (items: VaultItemForIntegrity[]) => Promise<IntegrityVerificationResult | null>;
    /**
     * Updates the integrity root after vault modifications.
     * Call this after creating, updating, or deleting vault items.
     */
    updateIntegrity: (items: VaultItemForIntegrity[]) => Promise<void>;
    /**
     * Whether integrity verification has been performed since unlock
     */
    integrityVerified: boolean;
    /**
     * Last integrity verification result (null if not yet verified)
     */
    lastIntegrityResult: IntegrityVerificationResult | null;
}

const VaultContext = createContext<VaultContextType | undefined>(undefined);

interface VaultProviderProps {
    children: ReactNode;
}

export function VaultProvider({ children }: VaultProviderProps) {
    const { user } = useAuth();

    // Get initial auto-lock timeout from localStorage
    const getInitialAutoLockTimeout = () => {
        const saved = localStorage.getItem('singra_autolock');
        return saved ? parseInt(saved, 10) : DEFAULT_AUTO_LOCK_TIMEOUT;
    };

    // Check if session is still valid based on timestamp and auto-lock settings
    const isSessionValid = () => {
        const sessionData = sessionStorage.getItem(SESSION_KEY);
        const timestamp = sessionStorage.getItem(SESSION_TIMESTAMP_KEY);
        const timeout = getInitialAutoLockTimeout();

        if (!sessionData || !timestamp) return false;

        // If auto-lock is disabled (0 = never), session is always valid
        if (timeout === 0) return true;

        // Check if session has expired based on auto-lock timeout
        const elapsed = Date.now() - parseInt(timestamp, 10);
        return elapsed < timeout;
    };

    // State - isLocked always starts true because encryptionKey cannot be persisted
    // pendingSessionRestore indicates if we should show the session restore hint
    const [isLocked, setIsLocked] = useState(true);
    const [isSetupRequired, setIsSetupRequired] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [encryptionKey, setEncryptionKey] = useState<CryptoKey | null>(null);
    const [salt, setSalt] = useState<string | null>(null);
    const [verificationHash, setVerificationHash] = useState<string | null>(null);
    const [kdfVersion, setKdfVersion] = useState<number>(1);
    const [autoLockTimeout, setAutoLockTimeoutState] = useState(getInitialAutoLockTimeout);
    // Show session restore hint if session is still valid (user just needs to re-enter password)
    const [pendingSessionRestore, setPendingSessionRestore] = useState(() => isSessionValid());
    // Passkey state
    const [hasPasskeyUnlock, setHasPasskeyUnlock] = useState(false);
    const webAuthnAvailable = isWebAuthnAvailable();
    // Duress (panic password) state
    const [isDuressMode, setIsDuressMode] = useState(false);
    const [duressConfig, setDuressConfig] = useState<DuressConfig | null>(null);
    // Vault integrity state
    const [integrityKey, setIntegrityKey] = useState<CryptoKey | null>(null);
    const [integrityVerified, setIntegrityVerified] = useState(false);
    const [lastIntegrityResult, setLastIntegrityResult] = useState<IntegrityVerificationResult | null>(null);

    const setAutoLockTimeout = (timeout: number) => {
        // Check for optional cookie consent
        const consent = localStorage.getItem("singra-cookie-consent");
        if (consent) {
            try {
                const parsed = JSON.parse(consent);
                if (parsed.optional) {
                    localStorage.setItem('singra_autolock', timeout.toString());
                }
            } catch (e) {
                // If parse fails, err on safe side and don't save
            }
        }
        setAutoLockTimeoutState(timeout);
    };

    const [lastActivity, setLastActivity] = useState(Date.now());

    // Check if master password is set up
    useEffect(() => {
        async function checkSetup() {
            if (!user) {
                setIsLoading(false);
                return;
            }

            try {
                // NOTE: kdf_version may not exist in generated Supabase types until
                // types are regenerated. Using explicit column list + type assertion.
                const { data: profile, error } = await supabase
                    .from('profiles')
                    .select('encryption_salt, master_password_verifier, kdf_version')
                    .eq('user_id', user.id)
                    .single() as { data: Record<string, unknown> | null; error: unknown };

                if (error || !profile?.encryption_salt) {
                    // Online but no profile found - check if it's a network error
                    if (error && isLikelyOfflineError(error)) {
                        // Offline: try to use cached credentials
                        const cached = await getOfflineCredentials(user.id);
                        if (cached) {
                            setIsSetupRequired(false);
                            setSalt(cached.salt);
                            setVerificationHash(cached.verifier);
                            setIsLoading(false);
                            return;
                        }
                    }
                    // No cached data or truly no profile - setup required
                    setIsSetupRequired(true);
                    setIsLocked(true);
                } else {
                    setIsSetupRequired(false);
                    setSalt(profile.encryption_salt as string);
                    setVerificationHash((profile.master_password_verifier as string) || null);
                    setKdfVersion((profile.kdf_version as number) ?? 1);
                    // Cache credentials for offline use
                    await saveOfflineCredentials(
                        user.id,
                        profile.encryption_salt as string,
                        (profile.master_password_verifier as string) || null
                    );

                    // Check if user has passkeys with PRF for vault unlock
                    if (webAuthnAvailable) {
                        try {
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- passkey_credentials not in generated Supabase types
                            const { data: passkeys } = await (supabase as any)
                                .from('passkey_credentials')
                                .select('id')
                                .eq('user_id', user.id)
                                .eq('prf_enabled', true)
                                .limit(1) as { data: Record<string, unknown>[] | null };
                            setHasPasskeyUnlock(passkeys && passkeys.length > 0);
                        } catch {
                            // Non-fatal: passkey check can fail silently
                        }
                    }

                    // Load duress (panic password) configuration
                    try {
                        const duress = await getDuressConfig(user.id);
                        setDuressConfig(duress);
                    } catch {
                        // Non-fatal: duress config can fail silently
                    }
                }
            } catch (err) {
                console.error('Error checking vault setup:', err);
                // Try offline fallback on any error
                if (isLikelyOfflineError(err)) {
                    const cached = await getOfflineCredentials(user.id);
                    if (cached) {
                        setIsSetupRequired(false);
                        setSalt(cached.salt);
                        setVerificationHash(cached.verifier);
                        setIsLoading(false);
                        return;
                    }
                }
                setIsSetupRequired(true);
            } finally {
                setIsLoading(false);
            }
        }

        checkSetup();
    }, [user, webAuthnAvailable]);

    // Auto-lock on inactivity
    useEffect(() => {
        if (isLocked || !encryptionKey) return;

        const checkInactivity = setInterval(() => {
            const timeSinceActivity = Date.now() - lastActivity;
            if (timeSinceActivity >= autoLockTimeout) {
                lock();
            }
        }, 10000); // Check every 10 seconds

        return () => clearInterval(checkInactivity);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- lock is defined later via useCallback with stable identity
    }, [isLocked, encryptionKey, lastActivity, autoLockTimeout]);

    // Track user activity
    useEffect(() => {
        if (isLocked) return;

        const updateActivity = () => setLastActivity(Date.now());

        const events = ['mousedown', 'keydown', 'scroll', 'touchstart'];
        events.forEach(event => {
            document.addEventListener(event, updateActivity, { passive: true });
        });

        return () => {
            events.forEach(event => {
                document.removeEventListener(event, updateActivity);
            });
        };
    }, [isLocked]);

    /**
     * Sets up the master password for first-time users
     */
    const setupMasterPassword = useCallback(async (
        masterPassword: string
    ): Promise<{ error: Error | null }> => {
        if (!user) {
            return { error: new Error('No user logged in') };
        }

        try {
            // Generate new salt
            const newSalt = generateSalt();

            // Derive encryption key (new users start on latest KDF version)
            const key = await deriveKey(masterPassword, newSalt, CURRENT_KDF_VERSION);

            // Create verification hash
            const verifyHash = await createVerificationHash(key);

            // Create default vault
            const { data: existingVault } = await supabase
                .from('vaults')
                .select('id')
                .eq('user_id', user.id)
                .eq('is_default', true)
                .single();

            if (!existingVault) {
                await supabase.from('vaults').insert({
                    user_id: user.id,
                    name: 'Encrypted Vault',
                    is_default: true,
                });
            }

            // Save salt, verifier, and KDF version to profile (NOT the password!)
            const { error: updateError } = await supabase
                .from('profiles')
                .update({
                    encryption_salt: newSalt,
                    master_password_verifier: verifyHash,
                    kdf_version: CURRENT_KDF_VERSION,
                } as Record<string, unknown>)
                .eq('user_id', user.id);

            if (updateError) {
                return { error: new Error(updateError.message) };
            }

            // Update state
            setSalt(newSalt);
            setVerificationHash(verifyHash);
            setEncryptionKey(key);
            setKdfVersion(CURRENT_KDF_VERSION);
            setIsSetupRequired(false);
            setIsLocked(false);
            setLastActivity(Date.now());

            // Derive integrity key for tamper detection
            try {
                const iKey = await deriveIntegrityKey(masterPassword, newSalt);
                setIntegrityKey(iKey);
            } catch {
                console.warn('Failed to derive integrity key during setup');
            }

            // Store session indicator in sessionStorage
            sessionStorage.setItem(SESSION_KEY, 'active');
            sessionStorage.setItem(SESSION_TIMESTAMP_KEY, Date.now().toString());
            setPendingSessionRestore(false);

            // Cache credentials for offline use
            await saveOfflineCredentials(user.id, newSalt, verifyHash);

            return { error: null };
        } catch (err) {
            console.error('Error setting up master password:', err);
            return { error: err as Error };
        }
    }, [user]);

    /**
     * Unlocks the vault with the master password.
     * Enforces client-side rate limiting with exponential backoff.
     * 
     * If duress mode is enabled and the entered password matches the duress
     * password (not the real one), the vault opens in duress mode showing
     * only decoy items.
     */
    const unlock = useCallback(async (
        masterPassword: string
    ): Promise<{ error: Error | null }> => {
        if (!user || !salt) {
            return { error: new Error('Vault not set up') };
        }

        // Check rate-limit cooldown
        const cooldown = getUnlockCooldown();
        if (cooldown !== null) {
            const seconds = Math.ceil(cooldown / 1000);
            return { error: new Error(`Too many attempts. Try again in ${seconds}s.`) };
        }

        // Primary verifier from profile, fallback to legacy localStorage.
        const legacyHash = localStorage.getItem(`singra_verify_${user.id}`);
        const verifier = verificationHash || legacyHash;

        if (!verifier) {
            return { error: new Error('Vault verification data missing') };
        }

        try {
            // ── Dual Unlock: Check both real and duress passwords ──
            // If duress mode is enabled, we check both passwords to determine
            // which vault to open. This is done in parallel to maintain
            // constant timing (prevent timing attacks).
            if (duressConfig?.enabled) {
                const result = await attemptDualUnlock(
                    masterPassword,
                    salt,
                    verifier,
                    kdfVersion,
                    duressConfig,
                );

                if (result.mode === 'invalid') {
                    recordFailedAttempt();
                    return { error: new Error('Invalid master password') };
                }

                // Success — reset rate-limiter
                resetUnlockAttempts();

                if (result.mode === 'duress') {
                    // Duress mode: user entered panic password
                    // Note: No integrity key for duress mode (decoy vault)
                    setEncryptionKey(result.key);
                    setIsLocked(false);
                    setIsDuressMode(true);
                    setIntegrityKey(null); // No integrity for duress
                    setLastActivity(Date.now());

                    // Store session indicator
                    sessionStorage.setItem(SESSION_KEY, 'active');
                    sessionStorage.setItem(SESSION_TIMESTAMP_KEY, Date.now().toString());
                    setPendingSessionRestore(false);

                    return { error: null };
                }

                // Real mode: continue with normal flow (KDF migration, etc.)
                // result.key is already the real key
                let activeKey = result.key!;

                // KDF Auto-Migration (only for real password, not duress)
                try {
                    const upgrade = await attemptKdfUpgrade(masterPassword, salt, kdfVersion);
                    if (upgrade.upgraded && upgrade.newKey && upgrade.newVerifier) {
                        const { error: upgradeError } = await supabase
                            .from('profiles')
                            .update({
                                master_password_verifier: upgrade.newVerifier,
                                kdf_version: upgrade.activeVersion,
                            } as Record<string, unknown>)
                            .eq('user_id', user.id);

                        if (!upgradeError) {
                            activeKey = upgrade.newKey;
                            setVerificationHash(upgrade.newVerifier);
                            setKdfVersion(upgrade.activeVersion);
                            await saveOfflineCredentials(user.id, salt, upgrade.newVerifier);
                            console.info(`KDF upgraded from v${kdfVersion} to v${upgrade.activeVersion}`);
                        }
                    }
                } catch {
                    console.warn('KDF upgrade failed, continuing with current version');
                }

                // One-time migration: persist legacy verifier to profile.
                if (!verificationHash && legacyHash) {
                    const { error: migrateError } = await supabase
                        .from('profiles')
                        .update({ master_password_verifier: legacyHash })
                        .eq('user_id', user.id);

                    if (!migrateError) {
                        setVerificationHash(legacyHash);
                    }
                }

                setEncryptionKey(activeKey);
                setIsLocked(false);
                setIsDuressMode(false);
                setLastActivity(Date.now());

                // Derive integrity key for tamper detection (real vault only)
                try {
                    const iKey = await deriveIntegrityKey(masterPassword, salt);
                    setIntegrityKey(iKey);
                } catch {
                    console.warn('Failed to derive integrity key');
                }

                sessionStorage.setItem(SESSION_KEY, 'active');
                sessionStorage.setItem(SESSION_TIMESTAMP_KEY, Date.now().toString());
                setPendingSessionRestore(false);

                return { error: null };
            }

            // ── Standard Unlock (no duress configured) ──
            // Derive key from password using the user's CURRENT KDF version.
            const key = await deriveKey(masterPassword, salt, kdfVersion);

            const isValid = await verifyKey(verifier, key);
            if (!isValid) {
                recordFailedAttempt();
                return { error: new Error('Invalid master password') };
            }

            // Success — reset rate-limiter
            resetUnlockAttempts();

            // One-time migration: persist legacy verifier to profile.
            if (!verificationHash && legacyHash) {
                const { error: migrateError } = await supabase
                    .from('profiles')
                    .update({ master_password_verifier: legacyHash })
                    .eq('user_id', user.id);

                if (!migrateError) {
                    setVerificationHash(legacyHash);
                }
            }

            // Success - store key in memory (may be upgraded below)
            let activeKey = key;

            // ── KDF Auto-Migration ──
            try {
                const upgrade = await attemptKdfUpgrade(masterPassword, salt, kdfVersion);
                if (upgrade.upgraded && upgrade.newKey && upgrade.newVerifier) {
                    const { error: upgradeError } = await supabase
                        .from('profiles')
                        .update({
                            master_password_verifier: upgrade.newVerifier,
                            kdf_version: upgrade.activeVersion,
                        } as Record<string, unknown>)
                        .eq('user_id', user.id);

                    if (!upgradeError) {
                        activeKey = upgrade.newKey;
                        setVerificationHash(upgrade.newVerifier);
                        setKdfVersion(upgrade.activeVersion);
                        await saveOfflineCredentials(user.id, salt, upgrade.newVerifier);
                        console.info(`KDF upgraded from v${kdfVersion} to v${upgrade.activeVersion}`);
                    } else {
                        console.warn('KDF upgrade: DB update failed, staying on old version', upgradeError);
                    }
                }
            } catch {
                console.warn('KDF upgrade failed, continuing with current version');
            }

            setEncryptionKey(activeKey);
            setIsLocked(false);
            setIsDuressMode(false);
            setLastActivity(Date.now());

            // Derive integrity key for tamper detection
            try {
                const iKey = await deriveIntegrityKey(masterPassword, salt);
                setIntegrityKey(iKey);
            } catch {
                console.warn('Failed to derive integrity key');
            }

            sessionStorage.setItem(SESSION_KEY, 'active');
            sessionStorage.setItem(SESSION_TIMESTAMP_KEY, Date.now().toString());
            setPendingSessionRestore(false);

            return { error: null };
        } catch (err) {
            console.error('Error unlocking vault:', err);
            recordFailedAttempt();
            return { error: new Error('Invalid master password') };
        }
    }, [user, salt, verificationHash, kdfVersion, duressConfig]);

    /**
     * Unlocks the vault using a registered passkey with PRF.
     * The PRF output is used to unwrap the stored encryption key.
     */
    const unlockWithPasskey = useCallback(async (): Promise<{ error: Error | null }> => {
        if (!user) {
            return { error: new Error('No user logged in') };
        }

        try {
            const result = await authenticatePasskey();

            if (!result.success) {
                if (result.error === 'CANCELLED') {
                    return { error: new Error('Passkey authentication was cancelled') };
                }
                if (result.error === 'NO_PRF') {
                    return { error: new Error('This passkey does not support vault unlock (no PRF)') };
                }
                return { error: new Error(result.error || 'Passkey authentication failed') };
            }

            if (!result.encryptionKey) {
                return { error: new Error('Passkey authenticated but no encryption key derived') };
            }

            // Verify the key works by checking the verification hash
            const legacyHash = localStorage.getItem(`singra_verify_${user.id}`);
            const verifier = verificationHash || legacyHash;

            if (verifier) {
                const isValid = await verifyKey(verifier, result.encryptionKey);
                if (!isValid) {
                    return { error: new Error('Passkey-derived key does not match vault — key may be outdated') };
                }
            }

            // Success — reset rate-limiter and unlock
            resetUnlockAttempts();

            setEncryptionKey(result.encryptionKey);
            setIsLocked(false);
            setIsDuressMode(false); // Passkey always unlocks real vault
            setLastActivity(Date.now());

            // Note: Cannot derive integrity key during passkey unlock because
            // we don't have access to the master password. Integrity verification
            // is skipped for passkey-unlocked sessions. This is an acceptable
            // trade-off since passkey unlock is already hardware-secured.
            setIntegrityKey(null);

            // Store session indicator
            sessionStorage.setItem(SESSION_KEY, 'active');
            sessionStorage.setItem(SESSION_TIMESTAMP_KEY, Date.now().toString());
            setPendingSessionRestore(false);

            return { error: null };
        } catch (err) {
            console.error('Passkey unlock error:', err);
            return { error: new Error('Passkey unlock failed') };
        }
    }, [user, verificationHash]);

    /**
     * Derives raw AES-256 key bytes for passkey registration.
     * Requires the master password and must be called while vault is unlocked.
     *
     * @param masterPassword - The user's master password
     * @returns Raw 32-byte key or null if derivation fails
     */
    const getRawKeyForPasskey = useCallback(async (
        masterPassword: string,
    ): Promise<Uint8Array | null> => {
        if (!user || !salt || isLocked) return null;

        try {
            return await deriveRawKey(masterPassword, salt, kdfVersion);
        } catch (err) {
            console.error('Failed to derive raw key for passkey:', err);
            return null;
        }
    }, [user, salt, kdfVersion, isLocked]);

    /**
     * Locks the vault and clears encryption key from memory
     */
    const lock = useCallback(() => {
        setEncryptionKey(null);
        setIntegrityKey(null);
        setIsLocked(true);
        setIsDuressMode(false);
        setIntegrityVerified(false);
        setLastIntegrityResult(null);
        // Clear session data
        sessionStorage.removeItem(SESSION_KEY);
        sessionStorage.removeItem(SESSION_TIMESTAMP_KEY);
        setPendingSessionRestore(false);
    }, []);

    /**
     * Verifies vault items against stored integrity root.
     * Detects server-side tampering (deleted/modified/added items).
     */
    const verifyIntegrity = useCallback(async (
        items: VaultItemForIntegrity[]
    ): Promise<IntegrityVerificationResult | null> => {
        if (!user || !integrityKey) {
            return null;
        }

        try {
            const result = await verifyVaultIntegrity(items, integrityKey, user.id);
            setIntegrityVerified(true);
            setLastIntegrityResult(result);

            if (!result.valid && !result.isFirstCheck) {
                console.warn('Vault integrity check FAILED — possible tampering detected!');
            } else if (result.isFirstCheck) {
                // First check: establish baseline
                await updateIntegrityRoot(items, integrityKey, user.id);
                console.info('Vault integrity baseline established');
            }

            return result;
        } catch (err) {
            console.error('Vault integrity verification error:', err);
            return null;
        }
    }, [user, integrityKey]);

    /**
     * Updates the integrity root after vault modifications.
     */
    const updateIntegrity = useCallback(async (
        items: VaultItemForIntegrity[]
    ): Promise<void> => {
        if (!user || !integrityKey) {
            return;
        }

        try {
            await updateIntegrityRoot(items, integrityKey, user.id);
        } catch (err) {
            console.error('Failed to update integrity root:', err);
        }
    }, [user, integrityKey]);

    /**
     * Encrypts plaintext data
     */
    const encryptData = useCallback(async (plaintext: string): Promise<string> => {
        if (!encryptionKey) {
            throw new Error('Vault is locked');
        }
        return encrypt(plaintext, encryptionKey);
    }, [encryptionKey]);

    /**
     * Decrypts encrypted data
     */
    const decryptData = useCallback(async (encrypted: string): Promise<string> => {
        if (!encryptionKey) {
            throw new Error('Vault is locked');
        }
        return decrypt(encrypted, encryptionKey);
    }, [encryptionKey]);

    /**
     * Encrypts a vault item
     */
    const encryptItem = useCallback(async (data: VaultItemData): Promise<string> => {
        if (!encryptionKey) {
            throw new Error('Vault is locked');
        }
        return encryptVaultItem(data, encryptionKey);
    }, [encryptionKey]);

    /**
     * Decrypts a vault item
     */
    const decryptItem = useCallback(async (encryptedData: string): Promise<VaultItemData> => {
        if (!encryptionKey) {
            throw new Error('Vault is locked');
        }
        return decryptVaultItem(encryptedData, encryptionKey);
    }, [encryptionKey]);

    return (
        <VaultContext.Provider
            value={{
                isLocked,
                isSetupRequired,
                isLoading,
                isDuressMode,
                setupMasterPassword,
                unlock,
                unlockWithPasskey,
                lock,
                webAuthnAvailable,
                hasPasskeyUnlock,
                getRawKeyForPasskey,
                encryptData,
                decryptData,
                encryptItem,
                decryptItem,
                autoLockTimeout,
                setAutoLockTimeout,
                pendingSessionRestore,
                verifyIntegrity,
                updateIntegrity,
                integrityVerified,
                lastIntegrityResult,
            }}
        >
            {children}
        </VaultContext.Provider>
    );
}

/**
 * Hook to access vault context
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useVault() {
    const context = useContext(VaultContext);
    if (context === undefined) {
        throw new Error('useVault must be used within a VaultProvider');
    }
    return context;
}

