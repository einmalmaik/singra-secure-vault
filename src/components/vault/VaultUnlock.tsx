/**
 * @fileoverview Vault Unlock Component
 * 
 * Displayed when the vault is locked. Prompts user to enter
 * their master password to derive the encryption key.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Shield, Lock, Eye, EyeOff, Loader2, Info, LogOut } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { useVault } from '@/contexts/VaultContext';
import { useAuth } from '@/contexts/AuthContext';

export function VaultUnlock() {
    const { t } = useTranslation();
    const { toast } = useToast();
    const { unlock, passwordHint } = useVault();
    const { signOut } = useAuth();

    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [showHint, setShowHint] = useState(false);
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!password) return;

        setLoading(true);
        const { error } = await unlock(password);
        setLoading(false);

        if (error) {
            toast({
                variant: 'destructive',
                title: t('common.error'),
                description: t('auth.errors.invalidCredentials'),
            });
            setPassword('');
        }
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

                        {/* Password Hint */}
                        {passwordHint && (
                            <div className="space-y-2">
                                <button
                                    type="button"
                                    className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1"
                                    onClick={() => setShowHint(!showHint)}
                                >
                                    <Info className="w-3 h-3" />
                                    {t('auth.unlock.forgot')}
                                </button>
                                {showHint && (
                                    <p className="text-sm p-2 bg-muted rounded">
                                        <span className="font-medium">Hinweis:</span> {passwordHint}
                                    </p>
                                )}
                            </div>
                        )}

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
        </div>
    );
}
