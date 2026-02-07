/**
 * @fileoverview Settings Page
 * 
 * User settings management page with sections for:
 * - Account (email, logout, delete)
 * - Security (auto-lock, lock now)
 * - Appearance (theme, language)
 * - Data (export, import)
 */

import { useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Settings, ArrowLeft, Shield } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';

import { AccountSettings } from '@/components/settings/AccountSettings';
import { SecuritySettings } from '@/components/settings/SecuritySettings';
import { AppearanceSettings } from '@/components/settings/AppearanceSettings';
import { DataSettings } from '@/components/settings/DataSettings';

import { useAuth } from '@/contexts/AuthContext';
import { useVault } from '@/contexts/VaultContext';

export default function SettingsPage() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const { user, loading } = useAuth();
    const { isLocked } = useVault();

    // Redirect to auth if not logged in
    useEffect(() => {
        if (!loading && !user) {
            navigate('/auth', { replace: true });
        }
    }, [user, loading, navigate]);

    // Redirect to vault if locked (auto-lock or manual lock)
    useEffect(() => {
        if (isLocked) {
            navigate('/vault', { replace: true });
        }
    }, [isLocked, navigate]);

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-primary/10">
            {/* Header */}
            <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-lg border-b">
                <div className="container max-w-4xl mx-auto px-4 py-4">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => navigate('/vault')}
                            >
                                <ArrowLeft className="w-5 h-5" />
                            </Button>
                            <div className="flex items-center gap-2">
                                <Settings className="w-6 h-6 text-primary" />
                                <h1 className="text-xl font-bold">
                                    {t('settings.title')}
                                </h1>
                            </div>
                        </div>
                        <Link to="/" className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors">
                            <Shield className="w-5 h-5" />
                            <span className="hidden sm:inline font-semibold">Singra PW</span>
                        </Link>
                    </div>
                </div>
            </header>

            {/* Main Content */}
            <main className="container max-w-4xl mx-auto px-4 py-8">
                <div className="space-y-6">
                    {/* Appearance Settings */}
                    <AppearanceSettings />

                    <Separator />

                    {/* Security Settings */}
                    <SecuritySettings />

                    <Separator />

                    {/* Data Settings */}
                    <DataSettings />

                    <Separator />

                    {/* Account Settings */}
                    <AccountSettings />
                </div>

                {/* Footer */}
                <div className="mt-12 text-center text-sm text-muted-foreground">
                    <p>Singra PW v1.0.0</p>
                    <p className="mt-1">
                        {t('settings.footer')}
                    </p>
                </div>
            </main>
        </div>
    );
}
