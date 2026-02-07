/**
 * @fileoverview Appearance Settings Component
 * 
 * Theme and language settings
 */

import { useTranslation } from 'react-i18next';
import { Palette, Sun, Moon, Monitor, Languages } from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';

import { useTheme } from '@/contexts/ThemeProvider';
import { useToast } from '@/hooks/use-toast';

const LANGUAGE_OPTIONS = [
    { value: 'de', label: 'Deutsch', flag: '🇩🇪' },
    { value: 'en', label: 'English', flag: '🇬🇧' },
];

export function AppearanceSettings() {
    const { t, i18n } = useTranslation();
    const { toast } = useToast();
    const { theme, setTheme } = useTheme();

    const handleLanguageChange = (value: string) => {
        i18n.changeLanguage(value);
        localStorage.setItem('i18nextLng', value);

        toast({
            title: t('common.success'),
            description: t('settings.appearance.languageUpdated'),
        });
    };

    const handleThemeChange = (newTheme: 'light' | 'dark' | 'system') => {
        setTheme(newTheme);

        toast({
            title: t('common.success'),
            description: t('settings.appearance.themeUpdated'),
        });
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Palette className="w-5 h-5" />
                    {t('settings.appearance.title')}
                </CardTitle>
                <CardDescription>
                    {t('settings.appearance.description')}
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                {/* Theme Selection */}
                <div className="space-y-3">
                    <Label className="flex items-center gap-2">
                        {t('settings.appearance.theme')}
                    </Label>
                    <div className="flex flex-wrap gap-2">
                        <Button
                            variant={theme === 'light' ? 'default' : 'outline'}
                            size="sm"
                            onClick={() => handleThemeChange('light')}
                            className="flex items-center gap-2"
                        >
                            <Sun className="w-4 h-4" />
                            {t('settings.appearance.themeLight')}
                        </Button>
                        <Button
                            variant={theme === 'dark' ? 'default' : 'outline'}
                            size="sm"
                            onClick={() => handleThemeChange('dark')}
                            className="flex items-center gap-2"
                        >
                            <Moon className="w-4 h-4" />
                            {t('settings.appearance.themeDark')}
                        </Button>
                        <Button
                            variant={theme === 'system' ? 'default' : 'outline'}
                            size="sm"
                            onClick={() => handleThemeChange('system')}
                            className="flex items-center gap-2"
                        >
                            <Monitor className="w-4 h-4" />
                            {t('settings.appearance.themeSystem')}
                        </Button>
                    </div>
                </div>

                {/* Language Selection */}
                <div className="space-y-2">
                    <Label className="flex items-center gap-2">
                        <Languages className="w-4 h-4" />
                        {t('settings.appearance.language')}
                    </Label>
                    <Select
                        value={i18n.language.split('-')[0]}
                        onValueChange={handleLanguageChange}
                    >
                        <SelectTrigger className="w-full sm:w-[200px]">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {LANGUAGE_OPTIONS.map((option) => (
                                <SelectItem key={option.value} value={option.value}>
                                    <span className="flex items-center gap-2">
                                        <span>{option.flag}</span>
                                        <span>{option.label}</span>
                                    </span>
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            </CardContent>
        </Card>
    );
}
