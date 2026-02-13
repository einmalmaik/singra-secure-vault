// Copyright (c) 2025-2026 Maunting Studios
// Licensed under the Business Source License 1.1 — see LICENSE
/**
 * @fileoverview Two-Factor Authentication Verification Modal
 * 
 * Modal shown during login when 2FA is enabled.
 * Allows entry of TOTP code or backup code.
 */

import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Shield, Key, Loader2, Timer } from 'lucide-react';

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import { getTimeRemaining } from '@/services/totpService';

interface TwoFactorVerificationModalProps {
    open: boolean;
    onVerify: (code: string, isBackupCode: boolean) => Promise<boolean>;
    onCancel: () => void;
}

export function TwoFactorVerificationModal({
    open,
    onVerify,
    onCancel,
}: TwoFactorVerificationModalProps) {
    const { t } = useTranslation();
    const inputRef = useRef<HTMLInputElement>(null);

    const [code, setCode] = useState('');
    const [isBackupCode, setIsBackupCode] = useState(false);
    const [verifying, setVerifying] = useState(false);
    const [error, setError] = useState('');
    const [timeRemaining, setTimeRemaining] = useState(getTimeRemaining());

    // Focus input when modal opens
    useEffect(() => {
        if (open) {
            setTimeout(() => inputRef.current?.focus(), 100);
        }
    }, [open]);

    // Reset state when modal closes
    useEffect(() => {
        if (!open) {
            setCode('');
            setIsBackupCode(false);
            setError('');
            setVerifying(false);
        }
    }, [open]);

    // Update timer every second
    useEffect(() => {
        if (!open || isBackupCode) return;

        const interval = setInterval(() => {
            setTimeRemaining(getTimeRemaining());
        }, 1000);

        return () => clearInterval(interval);
    }, [open, isBackupCode]);

    const handleCodeChange = (value: string) => {
        setError('');

        if (isBackupCode) {
            // Backup code format: XXXX-XXXX (allow letters and numbers)
            const cleaned = value.toUpperCase().replace(/[^A-Z0-9-]/g, '');
            setCode(cleaned.slice(0, 9)); // 8 chars + 1 hyphen
        } else {
            // TOTP code: 6 digits
            const cleaned = value.replace(/\D/g, '');
            setCode(cleaned.slice(0, 6));
        }
    };

    const handleVerify = async () => {
        if (!code) return;

        setVerifying(true);
        setError('');

        const success = await onVerify(code, isBackupCode);

        if (!success) {
            setError(t('settings.security.twoFactor.verify.invalid'));
            setCode('');
            inputRef.current?.focus();
        }

        setVerifying(false);
    };

    const toggleBackupCode = () => {
        setIsBackupCode(!isBackupCode);
        setCode('');
        setError('');
        setTimeout(() => inputRef.current?.focus(), 100);
    };

    const canSubmit = isBackupCode
        ? code.length === 9 && code.includes('-')
        : code.length === 6;

    return (
        <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onCancel()}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Shield className="w-5 h-5 text-primary" />
                        {t('auth.twoFactor.title')}
                    </DialogTitle>
                    <DialogDescription>
                        {isBackupCode
                            ? t('auth.twoFactor.backupCodeDesc')
                            : t('auth.twoFactor.description')}
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-6 py-4">
                    {/* Timer (only for TOTP) */}
                    {!isBackupCode && (
                        <div className="flex items-center justify-center gap-2 text-muted-foreground">
                            <Timer className="w-4 h-4" />
                            <span className="text-sm">
                                {t('auth.twoFactor.newCodeIn', { seconds: timeRemaining })}
                            </span>
                            <div
                                className="h-1 w-16 bg-muted rounded-full overflow-hidden"
                                aria-hidden
                            >
                                <div
                                    className="h-full bg-primary transition-all duration-1000"
                                    style={{ width: `${(timeRemaining / 30) * 100}%` }}
                                />
                            </div>
                        </div>
                    )}

                    {/* Code input */}
                    <div className="space-y-2">
                        <Label>
                            {isBackupCode
                                ? t('auth.twoFactor.backupCodeLabel')
                                : t('auth.twoFactor.codeLabel')}
                        </Label>
                        <Input
                            ref={inputRef}
                            type="text"
                            inputMode={isBackupCode ? 'text' : 'numeric'}
                            value={code}
                            onChange={(e) => handleCodeChange(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && canSubmit && !verifying) {
                                    handleVerify();
                                }
                            }}
                            placeholder={isBackupCode ? 'XXXX-XXXX' : '000000'}
                            className="text-center text-2xl font-mono tracking-widest"
                            maxLength={isBackupCode ? 9 : 6}
                            autoComplete="one-time-code"
                        />
                    </div>

                    {error && (
                        <p className="text-sm text-destructive text-center">{error}</p>
                    )}

                    {/* Actions */}
                    <div className="flex flex-col gap-2">
                        <Button
                            onClick={handleVerify}
                            disabled={!canSubmit || verifying}
                            className="w-full"
                        >
                            {verifying && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                            {t('auth.twoFactor.verify')}
                        </Button>

                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={toggleBackupCode}
                            className="text-muted-foreground"
                        >
                            <Key className="w-4 h-4 mr-2" />
                            {isBackupCode
                                ? t('auth.twoFactor.useAuthenticator')
                                : t('auth.twoFactor.useBackupCode')}
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
