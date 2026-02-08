/**
 * @fileoverview Vault Unlock Component
 * 
 * Displayed when the vault is locked. Prompts user to enter
 * their master password to derive the encryption key.
 * Optionally requires 2FA if vault 2FA protection is enabled.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Shield, Lock, Eye, EyeOff, Loader2, LogOut } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { useVault } from '@/contexts/VaultContext';
import { useAuth } from '@/contexts/AuthContext';
import { TwoFactorVerificationModal } from '@/components/auth/TwoFactorVerificationModal';
import { get2FAStatus, verifyTwoFactorForLogin } from '@/services/twoFactorService';

export function VaultUnlock() {
    const { t } = useTranslation();
    const { toast } = useToast();
    const { unlock, pendingSessionRestore } = useVault();
    const { signOut, user } = useAuth();

    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);

    // Vault 2FA state
    const [show2FAModal, setShow2FAModal] = useState(false);
    const [pendingPassword, setPendingPassword] = useState('');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!password || !user) return;

        setLoading(true);

        // First, check if vault 2FA is enabled
        try {
            const status = await get2FAStatus(user.id);
            if (status && status.vaultTwoFactorEnabled) {
                // Vault 2FA is enabled - validate master password first (without unlocking)
                setPendingPassword(password);
                setShow2FAModal(true);
                setLoading(false);
                return;
            }
        } catch (err) {
            console.error('Error checking vault 2FA status:', err);
            // Continue without 2FA if check fails
        }

        // No vault 2FA - proceed with normal unlock
        await performUnlock(password);
    };

    const performUnlock = async (masterPassword: string) => {
        setLoading(true);
        const { error } = await unlock(masterPassword);
        setLoading(false);

        if (error) {
            toast({
                variant: 'destructive',
                title: t('common.error'),
                description: t('auth.errors.invalidCredentials'),
            });
            setPassword('');
            setPendingPassword('');
        }
    };

    const handle2FAVerify = async (code: string, isBackupCode: boolean): Promise<boolean> => {
        if (!user || !pendingPassword) return false;

        try {
            const isValid = await verifyTwoFactorForLogin(user.id, code, isBackupCode);

            if (isValid) {
                setShow2FAModal(false);
                // Now unlock with the stored password
                await performUnlock(pendingPassword);
                setPendingPassword('');
                return true;
            }
            return false;
        } catch (err) {
            console.error('2FA verification error:', err);
            return false;
        }
    };

    const handle2FACancel = () => {
        setShow2FAModal(false);
        setPendingPassword('');
        setPassword('');
    };

    const handleLogout = async () => {
        await signOut();
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/5 via-background to-primary/10 p-4">
            <Card className="w-full max-w-md shadow-xl">
                <CardHeader className="text-center">
                    <div className="flex justify-center mb-4">
                        <div className="p-3 rounded-full bg-primary/10">
                            <Shield className="w-8 h-8 text-primary" />
                        </div>
                    </div>
                    <CardTitle className="text-2xl">
                        {t('auth.unlock.title')}
                    </CardTitle>
                    <CardDescription>
                        {t('auth.unlock.subtitle')}
                    </CardDescription>
                    {pendingSessionRestore && (
                        <div className="mt-3 px-3 py-2 rounded-lg bg-blue-500/10 border border-blue-500/20 text-sm text-blue-600 dark:text-blue-400">
                            {t('auth.unlock.sessionRestore', 'Please re-enter your master password to continue your session.')}
                        </div>
                    )}
                </CardHeader>

                <CardContent>
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="unlock-password">
                                {t('auth.unlock.password')}
                            </Label>
                            <div className="relative">
                                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                                <Input
                                    id="unlock-password"
                                    type={showPassword ? 'text' : 'password'}
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    className="pl-10 pr-10"
                                    placeholder="••••••••••••"
                                    autoFocus
                                    required
                                />
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
                                    onClick={() => setShowPassword(!showPassword)}
                                >
                                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                </Button>
                            </div>
                        </div>

                        <Button
                            type="submit"
                            className="w-full"
                            disabled={loading || !password}
                        >
                            {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                            {t('auth.unlock.submit')}
                        </Button>

                        <div className="pt-4 border-t">
                            <Button
                                type="button"
                                variant="ghost"
                                className="w-full text-muted-foreground"
                                onClick={handleLogout}
                            >
                                <LogOut className="w-4 h-4 mr-2" />
                                {t('auth.unlock.logout')}
                            </Button>
                        </div>
                    </form>
                </CardContent>
            </Card>

            {/* Two-Factor Verification Modal for Vault */}
            <TwoFactorVerificationModal
                open={show2FAModal}
                onVerify={handle2FAVerify}
                onCancel={handle2FACancel}
            />
        </div>
    );
}
