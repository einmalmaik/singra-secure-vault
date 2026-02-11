/**
 * @fileoverview TOTP Display Component
 * 
 * Displays a TOTP code with countdown timer and copy functionality.
 */

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { generateTOTP, getTimeRemaining, formatTOTPCode } from '@/services/totpService';
import { writeClipboard } from '@/services/clipboardService';
import { cn } from '@/lib/utils';

interface TOTPDisplayProps {
    secret: string;
    className?: string;
}

export function TOTPDisplay({ secret, className }: TOTPDisplayProps) {
    const { t } = useTranslation();
    const { toast } = useToast();

    const [code, setCode] = useState('------');
    const [timeRemaining, setTimeRemaining] = useState(30);
    const [isRefreshing, setIsRefreshing] = useState(false);

    // Generate and refresh TOTP code
    useEffect(() => {
        const updateCode = () => {
            const newCode = generateTOTP(secret);
            setCode(newCode);
            setIsRefreshing(true);
            setTimeout(() => setIsRefreshing(false), 300);
        };

        // Initial generation
        updateCode();

        // Update countdown every second
        const interval = setInterval(() => {
            const remaining = getTimeRemaining();
            setTimeRemaining(remaining);

            // Regenerate code when timer resets
            if (remaining === 30) {
                updateCode();
            }
        }, 1000);

        return () => clearInterval(interval);
    }, [secret]);

    const copyCode = async () => {
        try {
            await writeClipboard(code);
            toast({
                title: t('vault.copied'),
                description: `${t('vault.copiedCode')} ${t('vault.clipboardAutoClear')}`,
            });
        } catch {
            toast({
                variant: 'destructive',
                title: t('common.error'),
                description: t('vault.copyFailed'),
            });
        }
    };

    const progressPercent = (timeRemaining / 30) * 100;
    const isLow = timeRemaining <= 5;

    return (
        <div className={cn('flex items-center gap-3', className)}>
            {/* Code Display */}
            <div
                className={cn(
                    'flex-1 flex items-center justify-between px-3 py-2 rounded-lg bg-muted font-mono text-lg tracking-widest transition-colors',
                    isRefreshing && 'bg-primary/10'
                )}
            >
                <span className={cn(
                    'transition-all duration-300',
                    isRefreshing && 'scale-105 text-primary'
                )}>
                    {formatTOTPCode(code)}
                </span>

                {/* Countdown */}
                <div className="flex items-center gap-2">
                    <div className="relative w-6 h-6">
                        <svg className="w-6 h-6 -rotate-90">
                            <circle
                                cx="12"
                                cy="12"
                                r="10"
                                stroke="currentColor"
                                strokeWidth="2"
                                fill="none"
                                className="text-muted-foreground/20"
                            />
                            <circle
                                cx="12"
                                cy="12"
                                r="10"
                                stroke="currentColor"
                                strokeWidth="2"
                                fill="none"
                                strokeDasharray={`${2 * Math.PI * 10}`}
                                strokeDashoffset={`${2 * Math.PI * 10 * (1 - progressPercent / 100)}`}
                                className={cn(
                                    'transition-all duration-1000 ease-linear',
                                    isLow ? 'text-destructive' : 'text-primary'
                                )}
                            />
                        </svg>
                        <span
                            className={cn(
                                'absolute inset-0 flex items-center justify-center text-xs font-medium',
                                isLow && 'text-destructive'
                            )}
                        >
                            {timeRemaining}
                        </span>
                    </div>
                </div>
            </div>

            {/* Copy Button */}
            <Button
                variant="outline"
                size="icon"
                onClick={copyCode}
                className="flex-shrink-0"
            >
                <Copy className="w-4 h-4" />
            </Button>
        </div>
    );
}
