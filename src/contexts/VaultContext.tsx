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
    generateSalt,
    encrypt,
    decrypt,
    createVerificationHash,
    verifyKey,
    encryptVaultItem,
    decryptVaultItem,
    secureClear,
    VaultItemData
} from '@/services/cryptoService';
import {
    isLikelyOfflineError,
    getOfflineCredentials,
    saveOfflineCredentials,
} from '@/services/offlineVaultService';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './AuthContext';
import {
    getUnlockCooldown,
    recordFailedAttempt,
    resetUnlockAttempts,
} from '@/services/rateLimiterService';

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

    // Actions
    setupMasterPassword: (masterPassword: string) => Promise<{ error: Error | null }>;
    unlock: (masterPassword: string) => Promise<{ error: Error | null }>;
    lock: () => void;

    // Encryption helpers
    encryptData: (plaintext: string) => Promise<string>;
    decryptData: (encrypted: string) => Promise<string>;
    encryptItem: (data: VaultItemData) => Promise<string>;
    decryptItem: (encryptedData: string) => Promise<VaultItemData>;

    // Settings
    autoLockTimeout: number;
    setAutoLockTimeout: (timeout: number) => void;
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
    const [autoLockTimeout, setAutoLockTimeoutState] = useState(getInitialAutoLockTimeout);
    // Show session restore hint if session is still valid (user just needs to re-enter password)
    const [pendingSessionRestore, setPendingSessionRestore] = useState(() => isSessionValid());

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
                const { data: profile, error } = await supabase
                    .from('profiles')
                    .select('encryption_salt, master_password_verifier')
                    .eq('user_id', user.id)
                    .single();

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
                    setSalt(profile.encryption_salt);
                    setVerificationHash(profile.master_password_verifier || null);
                    // Cache credentials for offline use
                    await saveOfflineCredentials(
                        user.id,
                        profile.encryption_salt,
                        profile.master_password_verifier || null
                    );
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
    }, [user]);

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

            // Derive encryption key
            const key = await deriveKey(masterPassword, newSalt);

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

            // Save salt and verifier to profile (NOT the password!)
            const { error: updateError } = await supabase
                .from('profiles')
                .update({
                    encryption_salt: newSalt,
                    master_password_verifier: verifyHash,
                })
                .eq('user_id', user.id);

            if (updateError) {
                return { error: new Error(updateError.message) };
            }

            // Update state
            setSalt(newSalt);
            setVerificationHash(verifyHash);
            setEncryptionKey(key);
            setIsSetupRequired(false);
            setIsLocked(false);
            setLastActivity(Date.now());

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

        try {
            // Derive key from password
            const key = await deriveKey(masterPassword, salt);

            // Primary verifier from profile, fallback to legacy localStorage.
            const legacyHash = localStorage.getItem(`singra_verify_${user.id}`);
            const verifier = verificationHash || legacyHash;

            if (!verifier) {
                return { error: new Error('Vault verification data missing') };
            }

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

            // Success - store key in memory
            setEncryptionKey(key);
            setIsLocked(false);
            setLastActivity(Date.now());

            // Store session indicator in sessionStorage
            sessionStorage.setItem(SESSION_KEY, 'active');
            sessionStorage.setItem(SESSION_TIMESTAMP_KEY, Date.now().toString());
            setPendingSessionRestore(false);

            return { error: null };
        } catch (err) {
            console.error('Error unlocking vault:', err);
            recordFailedAttempt();
            return { error: new Error('Invalid master password') };
        }
    }, [user, salt, verificationHash]);

    /**
     * Locks the vault and clears encryption key from memory
     */
    const lock = useCallback(() => {
        setEncryptionKey(null);
        setIsLocked(true);
        // Clear session data
        sessionStorage.removeItem(SESSION_KEY);
        sessionStorage.removeItem(SESSION_TIMESTAMP_KEY);
        setPendingSessionRestore(false);
    }, []);

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
                setupMasterPassword,
                unlock,
                lock,
                encryptData,
                decryptData,
                encryptItem,
                decryptItem,
                autoLockTimeout,
                setAutoLockTimeout,
                pendingSessionRestore,
            }}
        >
            {children}
        </VaultContext.Provider>
    );
}

/**
 * Hook to access vault context
 */
export function useVault() {
    const context = useContext(VaultContext);
    if (context === undefined) {
        throw new Error('useVault must be used within a VaultProvider');
    }
    return context;
}

