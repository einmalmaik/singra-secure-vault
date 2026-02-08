/**
 * @fileoverview Category Dialog Component
 * 
 * Modal for creating and editing categories with emoji or SVG icon support.
 */

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Folder, Trash2, Palette } from 'lucide-react';

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';

import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useVault } from '@/contexts/VaultContext';
import { useToast } from '@/hooks/use-toast';
import { CategoryIcon } from './CategoryIcon';
import { sanitizeInlineSvg } from '@/lib/sanitizeSvg';

// Common emojis for quick selection
const COMMON_EMOJIS = [
    '📱', '💼', '💳', '🛒', '🎮', '🏠', '✈️', '🎵',
    '📚', '🔧', '🏦', '💊', '🎬', '📧', '🔐', '⭐',
    '🌐', '💻', '📷', '🎨', '🏃', '🍔', '🚗', '📝',
];

// Preset colors
const PRESET_COLORS = [
    '#ef4444', '#f97316', '#eab308', '#22c55e',
    '#14b8a6', '#3b82f6', '#8b5cf6', '#ec4899',
];

interface Category {
    id: string;
    name: string;
    icon: string | null;
    color: string | null;
}

interface CategoryDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    category: Category | null; // null = create new
    onSave?: () => void;
}

const ENCRYPTED_CATEGORY_PREFIX = 'enc:cat:v1:';

export function CategoryDialog({ open, onOpenChange, category, onSave }: CategoryDialogProps) {
    const { t } = useTranslation();
    const { toast } = useToast();
    const { user } = useAuth();
    const { encryptData } = useVault();

    const [name, setName] = useState('');
    const [icon, setIcon] = useState('');
    const [iconType, setIconType] = useState<'emoji' | 'svg'>('emoji');
    const [color, setColor] = useState<string>('#3b82f6');
    const [loading, setLoading] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

    const isEditing = !!category;

    // Load category data when editing
    useEffect(() => {
        if (category) {
            setName(category.name);
            setIcon(category.icon || '');
            setColor(category.color || '#3b82f6');
            // Detect icon type
            if (category.icon?.trim().startsWith('<svg') || category.icon?.trim().startsWith('<?xml')) {
                setIconType('svg');
            } else {
                setIconType('emoji');
            }
        } else {
            setName('');
            setIcon('');
            setColor('#3b82f6');
            setIconType('emoji');
        }
    }, [category, open]);

    const handleSave = async () => {
        if (!user || !name.trim()) return;

        setLoading(true);
        try {
            let normalizedIcon: string | null = icon.trim() || null;

            if (iconType === 'svg' && normalizedIcon) {
                normalizedIcon = sanitizeInlineSvg(normalizedIcon);
                if (!normalizedIcon) {
                    throw new Error('Invalid SVG icon');
                }
            } else if (iconType === 'emoji' && normalizedIcon) {
                normalizedIcon = normalizedIcon.replace(/[<>]/g, '').slice(0, 4);
            }

            const categoryData = {
                name: `${ENCRYPTED_CATEGORY_PREFIX}${await encryptData(name.trim())}`,
                icon: normalizedIcon,
                color: color,
                user_id: user.id,
            };

            if (isEditing) {
                const { error } = await supabase
                    .from('categories')
                    .update(categoryData)
                    .eq('id', category.id);

                if (error) throw error;

                toast({
                    title: t('common.success'),
                    description: t('categories.updated'),
                });
            } else {
                const { error } = await supabase
                    .from('categories')
                    .insert(categoryData);

                if (error) throw error;

                toast({
                    title: t('common.success'),
                    description: t('categories.created'),
                });
            }

            onOpenChange(false);
            onSave?.();
        } catch (err) {
            console.error('Error saving category:', err);
            toast({
                variant: 'destructive',
                title: t('common.error'),
                description: t('categories.saveFailed'),
            });
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async () => {
        if (!category) return;

        setLoading(true);
        try {
            // First, unlink all items from this category
            const { error: unlinkError } = await supabase
                .from('vault_items')
                .update({ category_id: null })
                .eq('category_id', category.id);
            if (unlinkError) throw unlinkError;

            // Then delete the category
            const { error } = await supabase
                .from('categories')
                .delete()
                .eq('id', category.id);

            if (error) throw error;

            toast({
                title: t('common.success'),
                description: t('categories.deleted'),
            });

            setShowDeleteConfirm(false);
            onOpenChange(false);
            onSave?.();
        } catch (err) {
            console.error('Error deleting category:', err);
            toast({
                variant: 'destructive',
                title: t('common.error'),
                description: t('categories.deleteFailed'),
            });
        } finally {
            setLoading(false);
        }
    };

    return (
        <>
            <Dialog open={open} onOpenChange={onOpenChange}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Folder className="w-5 h-5" />
                            {isEditing ? t('categories.edit') : t('categories.add')}
                        </DialogTitle>
                        <DialogDescription>
                            {t('categories.description')}
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-4">
                        {/* Name Input */}
                        <div className="space-y-2">
                            <Label htmlFor="name">{t('categories.name')}</Label>
                            <Input
                                id="name"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder={t('categories.namePlaceholder')}
                            />
                        </div>

                        {/* Icon Selection */}
                        <div className="space-y-2">
                            <Label>{t('categories.icon')}</Label>
                            <Tabs value={iconType} onValueChange={(v) => setIconType(v as 'emoji' | 'svg')}>
                                <TabsList className="w-full">
                                    <TabsTrigger value="emoji" className="flex-1">Emoji</TabsTrigger>
                                    <TabsTrigger value="svg" className="flex-1">SVG</TabsTrigger>
                                </TabsList>

                                <TabsContent value="emoji" className="space-y-2">
                                    {/* Quick emoji picker */}
                                    <div className="grid grid-cols-8 gap-1">
                                        {COMMON_EMOJIS.map((emoji) => (
                                            <button
                                                key={emoji}
                                                type="button"
                                                onClick={() => setIcon(emoji)}
                                                className={`p-2 text-lg rounded hover:bg-accent transition-colors ${icon === emoji ? 'bg-accent ring-2 ring-primary' : ''
                                                    }`}
                                            >
                                                {emoji}
                                            </button>
                                        ))}
                                    </div>
                                    <Input
                                        value={icon}
                                        onChange={(e) => setIcon(e.target.value)}
                                        placeholder={t('categories.emojiPlaceholder')}
                                        maxLength={4}
                                    />
                                </TabsContent>

                                <TabsContent value="svg" className="space-y-2">
                                    <Textarea
                                        value={icon}
                                        onChange={(e) => setIcon(e.target.value)}
                                        placeholder='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">...</svg>'
                                        className="font-mono text-xs h-24"
                                    />
                                    <p className="text-xs text-muted-foreground">
                                        {t('categories.svgHint')}
                                    </p>
                                </TabsContent>
                            </Tabs>
                        </div>

                        {/* Color Picker */}
                        <div className="space-y-2">
                            <Label className="flex items-center gap-2">
                                <Palette className="w-4 h-4" />
                                {t('categories.color')}
                            </Label>
                            <div className="flex items-center gap-2">
                                <div className="flex gap-1">
                                    {PRESET_COLORS.map((presetColor) => (
                                        <button
                                            key={presetColor}
                                            type="button"
                                            onClick={() => setColor(presetColor)}
                                            className={`w-6 h-6 rounded-full border-2 transition-transform ${color === presetColor
                                                    ? 'border-foreground scale-110'
                                                    : 'border-transparent hover:scale-105'
                                                }`}
                                            style={{ backgroundColor: presetColor }}
                                        />
                                    ))}
                                </div>
                                <Input
                                    type="color"
                                    value={color}
                                    onChange={(e) => setColor(e.target.value)}
                                    className="w-10 h-8 p-0 border-0"
                                />
                            </div>
                        </div>

                        {/* Preview */}
                        <div className="flex items-center gap-3 p-3 rounded-lg bg-muted">
                            <div
                                className="w-8 h-8 rounded flex items-center justify-center"
                                style={{ backgroundColor: color + '20' }}
                            >
                                <CategoryIcon icon={icon} className="w-5 h-5" />
                            </div>
                            <span className="font-medium">{name || t('categories.preview')}</span>
                        </div>
                    </div>

                    <DialogFooter className="flex gap-2">
                        {isEditing && (
                            <Button
                                variant="destructive"
                                onClick={() => setShowDeleteConfirm(true)}
                                disabled={loading}
                            >
                                <Trash2 className="w-4 h-4 mr-2" />
                                {t('common.delete')}
                            </Button>
                        )}
                        <div className="flex-1" />
                        <Button variant="outline" onClick={() => onOpenChange(false)}>
                            {t('common.cancel')}
                        </Button>
                        <Button onClick={handleSave} disabled={loading || !name.trim()}>
                            {loading ? t('common.loading') : t('common.save')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Delete Confirmation */}
            <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{t('categories.deleteConfirmTitle')}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {t('categories.deleteConfirmDesc')}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">
                            {t('common.delete')}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
}
