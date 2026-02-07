/**
 * @fileoverview Password Generator Component
 * 
 * UI for generating secure passwords with configurable options.
 */

import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw, Copy, Check } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import {
    generatePassword,
    generatePassphrase,
    calculateStrength,
    DEFAULT_PASSWORD_OPTIONS,
    DEFAULT_PASSPHRASE_OPTIONS,
    PasswordOptions,
    PassphraseOptions,
    PasswordStrength
} from '@/services/passwordGenerator';
import { cn } from '@/lib/utils';

interface PasswordGeneratorProps {
    onSelect?: (password: string) => void;
    className?: string;
}

export function PasswordGenerator({ onSelect, className }: PasswordGeneratorProps) {
    const { t } = useTranslation();
    const { toast } = useToast();

    // Password mode state
    const [passwordOptions, setPasswordOptions] = useState<PasswordOptions>(DEFAULT_PASSWORD_OPTIONS);

    // Passphrase mode state
    const [passphraseOptions, setPassphraseOptions] = useState<PassphraseOptions>(DEFAULT_PASSPHRASE_OPTIONS);

    // Generated password
    const [generatedPassword, setGeneratedPassword] = useState('');
    const [strength, setStrength] = useState<PasswordStrength | null>(null);
    const [copied, setCopied] = useState(false);
    const [mode, setMode] = useState<'password' | 'passphrase'>('password');

    const generate = useCallback(() => {
        let password: string;

        if (mode === 'password') {
            password = generatePassword(passwordOptions);
        } else {
            password = generatePassphrase(passphraseOptions);
        }

        setGeneratedPassword(password);
        setStrength(calculateStrength(password));
        setCopied(false);
    }, [mode, passwordOptions, passphraseOptions]);

    const copyToClipboard = async () => {
        if (!generatedPassword) return;

        try {
            await navigator.clipboard.writeText(generatedPassword);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
            toast({
                title: t('vault.copied'),
                description: t('vault.copiedPassword'),
            });
        } catch {
            toast({
                variant: 'destructive',
                title: t('common.error'),
                description: t('vault.copyFailed'),
            });
        }
    };

    const handleSelect = () => {
        if (onSelect && generatedPassword) {
            onSelect(generatedPassword);
        }
    };

    const getStrengthLabel = () => {
        if (!strength) return '';
        return t(`generator.strength.${strength.label}`);
    };

    const getStrengthProgress = () => {
        if (!strength) return 0;
        return ((strength.score + 1) / 5) * 100;
    };

    return (
        <div className={cn('space-y-4', className)}>
            {/* Generated Password Display */}
            <div className="relative">
                <div className="flex items-center gap-2 p-3 bg-muted rounded-lg font-mono text-sm break-all min-h-[3rem]">
                    {generatedPassword || (
                        <span className="text-muted-foreground italic">
                            {t('generator.placeholder')}
                        </span>
                    )}
                </div>
                <div className="flex gap-1 mt-2">
                    <Button size="sm" onClick={generate} className="flex-1">
                        <RefreshCw className="w-4 h-4 mr-2" />
                        {t('generator.generate')}
                    </Button>
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={copyToClipboard}
                        disabled={!generatedPassword}
                    >
                        {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    </Button>
                    {onSelect && (
                        <Button
                            size="sm"
                            variant="secondary"
                            onClick={handleSelect}
                            disabled={!generatedPassword}
                        >
                            {t('generator.use')}
                        </Button>
                    )}
                </div>
            </div>

            {/* Strength Indicator */}
            {strength && (
                <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">{t('generator.strength.label')}</span>
                        <span className={strength.color.replace('bg-', 'text-')}>
                            {getStrengthLabel()} ({strength.entropy} bits)
                        </span>
                    </div>
                    <Progress value={getStrengthProgress()} className="h-2" />
                </div>
            )}

            {/* Mode Tabs */}
            <Tabs value={mode} onValueChange={(v) => setMode(v as 'password' | 'passphrase')}>
                <TabsList className="w-full">
                    <TabsTrigger value="password" className="flex-1">
                        {t('generator.mode.password')}
                    </TabsTrigger>
                    <TabsTrigger value="passphrase" className="flex-1">
                        {t('generator.mode.passphrase')}
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="password" className="space-y-4 mt-4">
                    {/* Length Slider */}
                    <div className="space-y-2">
                        <div className="flex justify-between">
                            <Label>{t('generator.length')}</Label>
                            <span className="text-sm text-muted-foreground">
                                {passwordOptions.length}
                            </span>
                        </div>
                        <Slider
                            value={[passwordOptions.length]}
                            onValueChange={([value]) =>
                                setPasswordOptions(prev => ({ ...prev, length: value }))
                            }
                            min={8}
                            max={64}
                            step={1}
                        />
                    </div>

                    {/* Character Options */}
                    <div className="grid grid-cols-2 gap-3">
                        <div className="flex items-center justify-between">
                            <Label htmlFor="uppercase" className="text-sm">A-Z</Label>
                            <Switch
                                id="uppercase"
                                checked={passwordOptions.uppercase}
                                onCheckedChange={(checked) =>
                                    setPasswordOptions(prev => ({ ...prev, uppercase: checked }))
                                }
                            />
                        </div>
                        <div className="flex items-center justify-between">
                            <Label htmlFor="lowercase" className="text-sm">a-z</Label>
                            <Switch
                                id="lowercase"
                                checked={passwordOptions.lowercase}
                                onCheckedChange={(checked) =>
                                    setPasswordOptions(prev => ({ ...prev, lowercase: checked }))
                                }
                            />
                        </div>
                        <div className="flex items-center justify-between">
                            <Label htmlFor="numbers" className="text-sm">0-9</Label>
                            <Switch
                                id="numbers"
                                checked={passwordOptions.numbers}
                                onCheckedChange={(checked) =>
                                    setPasswordOptions(prev => ({ ...prev, numbers: checked }))
                                }
                            />
                        </div>
                        <div className="flex items-center justify-between">
                            <Label htmlFor="symbols" className="text-sm">!@#$</Label>
                            <Switch
                                id="symbols"
                                checked={passwordOptions.symbols}
                                onCheckedChange={(checked) =>
                                    setPasswordOptions(prev => ({ ...prev, symbols: checked }))
                                }
                            />
                        </div>
                    </div>
                </TabsContent>

                <TabsContent value="passphrase" className="space-y-4 mt-4">
                    {/* Word Count Slider */}
                    <div className="space-y-2">
                        <div className="flex justify-between">
                            <Label>{t('generator.wordCount')}</Label>
                            <span className="text-sm text-muted-foreground">
                                {passphraseOptions.wordCount}
                            </span>
                        </div>
                        <Slider
                            value={[passphraseOptions.wordCount]}
                            onValueChange={([value]) =>
                                setPassphraseOptions(prev => ({ ...prev, wordCount: value }))
                            }
                            min={3}
                            max={8}
                            step={1}
                        />
                    </div>

                    {/* Passphrase Options */}
                    <div className="grid grid-cols-2 gap-3">
                        <div className="flex items-center justify-between">
                            <Label htmlFor="capitalize" className="text-sm">
                                {t('generator.capitalize')}
                            </Label>
                            <Switch
                                id="capitalize"
                                checked={passphraseOptions.capitalize}
                                onCheckedChange={(checked) =>
                                    setPassphraseOptions(prev => ({ ...prev, capitalize: checked }))
                                }
                            />
                        </div>
                        <div className="flex items-center justify-between">
                            <Label htmlFor="includeNumber" className="text-sm">
                                {t('generator.includeNumber')}
                            </Label>
                            <Switch
                                id="includeNumber"
                                checked={passphraseOptions.includeNumber}
                                onCheckedChange={(checked) =>
                                    setPassphraseOptions(prev => ({ ...prev, includeNumber: checked }))
                                }
                            />
                        </div>
                    </div>
                </TabsContent>
            </Tabs>
        </div>
    );
}
