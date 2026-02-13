// Copyright (c) 2025-2026 Maunting Studios
// Licensed under the Business Source License 1.1 — see LICENSE
/**
 * @fileoverview Post-Quantum Encryption Settings Component
 * 
 * Allows users to enable and manage post-quantum encryption
 * for Emergency Access and Shared Collections.
 * 
 * Feature-gated: Premium and Families tiers only.
 */

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Shield, ShieldCheck, ShieldAlert, ExternalLink, Loader2 } from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { useFeatureGate } from '@/hooks/useFeatureGate';
import { supabase } from '@/integrations/supabase/client';
import { generatePQKeyPair } from '@/services/pqCryptoService';
import { encrypt, generateSalt, deriveKey } from '@/services/cryptoService';

export function PostQuantumSettings() {
    const { t } = useTranslation();
    const { toast } = useToast();
    const navigate = useNavigate();
    const { user } = useAuth();
    const { tier } = useSubscription();
    const { allowed: hasAccess, requiredTier } = useFeatureGate('post_quantum_encryption');

    const [pqEnabled, setPqEnabled] = useState<boolean | null>(null);
    const [pqKeyVersion, setPqKeyVersion] = useState<number | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isEnabling, setIsEnabling] = useState(false);

    // Load PQ status on mount
    useEffect(() => {
        async function loadPQStatus() {
            if (!user?.id) return;

            try {
                const { data, error } = await supabase
                    .from('profiles')
                    .select('pq_public_key, pq_key_version')
                    .eq('user_id', user.id)
                    .single();

                if (error) throw error;

                const profile = data as unknown as Record<string, unknown>;
                setPqEnabled(!!profile?.pq_public_key);
                setPqKeyVersion((profile?.pq_key_version as number) || null);
            } catch (err) {
                console.error('Failed to load PQ status:', err);
            } finally {
                setIsLoading(false);
            }
        }

        loadPQStatus();
    }, [user?.id]);

    /**
     * Enables post-quantum encryption by generating ML-KEM-768 keys
     * and storing them encrypted with the user's master password.
     */
    async function enablePostQuantum() {
        if (!user?.id || !hasAccess) {
            navigate('/settings?tab=subscription');
            return;
        }

        setIsEnabling(true);

        try {
            // 1. Generate ML-KEM-768 key pair
            const pqKeys = generatePQKeyPair();

            // 2. Encrypt private key with a new salt
            // We need the user's master password for this
            // For now, we'll use a prompt (in a real app, this would be cached from unlock)
            const masterPassword = window.prompt(t('passkey.confirmPassword'));
            if (!masterPassword) {
                setIsEnabling(false);
                return;
            }

            const salt = generateSalt();
            const key = await deriveKey(masterPassword, salt);
            const encryptedPrivateKey = await encrypt(pqKeys.secretKey, key);
            const encryptedPrivateKeyWithSalt = `${salt}:${encryptedPrivateKey}`;

            // 3. Store keys in profile
            const { error } = await supabase
                .from('profiles')
                .update({
                    pq_public_key: pqKeys.publicKey,
                    pq_encrypted_private_key: encryptedPrivateKeyWithSalt,
                    pq_key_version: 1,
                } as Record<string, unknown>)
                .eq('user_id', user.id);

            if (error) throw error;

            setPqEnabled(true);
            setPqKeyVersion(1);

            toast({
                title: t('postQuantum.enableSuccess'),
                description: t('postQuantum.algorithmValue'),
            });
        } catch (err) {
            console.error('Failed to enable PQ:', err);
            toast({
                variant: 'destructive',
                title: t('common.error'),
                description: t('postQuantum.enableFailed'),
            });
        } finally {
            setIsEnabling(false);
        }
    }

    if (isLoading) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Shield className="h-5 w-5" />
                        {t('postQuantum.title')}
                    </CardTitle>
                </CardHeader>
                <CardContent className="flex justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </CardContent>
            </Card>
        );
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    {pqEnabled ? (
                        <ShieldCheck className="h-5 w-5 text-green-500" />
                    ) : (
                        <ShieldAlert className="h-5 w-5 text-yellow-500" />
                    )}
                    {t('postQuantum.title')}
                </CardTitle>
                <CardDescription>
                    {t('postQuantum.description')}
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                {/* Info Alert */}
                <Alert>
                    <Shield className="h-4 w-4" />
                    <AlertDescription>
                        {t('postQuantum.infoText')}
                    </AlertDescription>
                </Alert>

                {/* Status */}
                <div className="flex items-center justify-between py-2">
                    <span className="text-sm font-medium">{t('postQuantum.status')}</span>
                    <Badge variant={pqEnabled ? 'default' : 'secondary'}>
                        {pqEnabled ? t('postQuantum.enabled') : t('postQuantum.disabled')}
                    </Badge>
                </div>

                {pqEnabled ? (
                    /* PQ Details when enabled */
                    <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                            <span className="text-muted-foreground">{t('postQuantum.algorithm')}</span>
                            <span className="font-mono">{t('postQuantum.algorithmValue')}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-muted-foreground">{t('postQuantum.keyVersion')}</span>
                            <span className="font-mono">v{pqKeyVersion}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-muted-foreground">{t('postQuantum.securityLevel')}</span>
                            <span>{t('postQuantum.securityLevelValue')}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-muted-foreground">{t('postQuantum.nistStandard')}</span>
                            <Badge variant="outline" className="text-xs">
                                {t('postQuantum.quantumSafe')}
                            </Badge>
                        </div>
                    </div>
                ) : hasAccess ? (
                    /* Enable button when not enabled but has access */
                    <div className="space-y-3">
                        <p className="text-sm text-muted-foreground">
                            {t('postQuantum.enableDescription')}
                        </p>
                        <Button
                            onClick={enablePostQuantum}
                            disabled={isEnabling}
                            className="w-full"
                        >
                            {isEnabling ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    {t('postQuantum.enabling')}
                                </>
                            ) : (
                                <>
                                    <ShieldCheck className="mr-2 h-4 w-4" />
                                    {t('postQuantum.enableButton')}
                                </>
                            )}
                        </Button>
                    </div>
                ) : (
                    /* Upgrade prompt when no access */
                    <div className="space-y-3">
                        <Alert variant="default">
                            <ShieldAlert className="h-4 w-4" />
                            <AlertDescription>
                                {t('postQuantum.premiumRequired')}
                            </AlertDescription>
                        </Alert>
                        <Button
                            variant="outline"
                            onClick={() => navigate('/settings?tab=subscription')}
                            className="w-full"
                        >
                            {t('postQuantum.upgradeNow')}
                        </Button>
                    </div>
                )}

                {/* Learn more link */}
                <a
                    href="https://nvlpubs.nist.gov/nistpubs/FIPS/NIST.FIPS.203.pdf"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                    <ExternalLink className="h-3 w-3" />
                    {t('postQuantum.learnMore')} (NIST FIPS 203)
                </a>
            </CardContent>
        </Card>
    );
}
