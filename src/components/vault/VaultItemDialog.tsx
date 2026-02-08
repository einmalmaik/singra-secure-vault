/**
 * @fileoverview Vault Item Dialog Component
 * 
 * Modal for creating and editing vault items with
 * integrated password generator and TOTP support.
 */

import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
    Key,
    FileText,
    Shield,
    Eye,
    EyeOff,
    Wand2,
    Star,
    Loader2,
    Trash2,
    Link,
    Folder,
    Plus
} from 'lucide-react';

import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Switch } from '@/components/ui/switch';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useVault } from '@/contexts/VaultContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { PasswordGenerator } from './PasswordGenerator';
import { CategoryIcon } from './CategoryIcon';
import { CategoryDialog } from './CategoryDialog';
import { cn } from '@/lib/utils';

interface Category {
    id: string;
    name: string;
    icon: string | null;
    color: string | null;
}

const itemSchema = z.object({
    title: z.string().min(1, 'Title is required'),
    url: z.string().optional(), // URL is optional, no strict validation
    username: z.string().optional(),
    password: z.string().optional(),
    notes: z.string().optional(),
    totpSecret: z.string().optional(),
    isFavorite: z.boolean().default(false),
});

// Helper to auto-prefix https:// to URLs
const normalizeUrl = (url: string | undefined): string | null => {
    if (!url || url.trim() === '') return null;
    const trimmed = url.trim();
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
        return trimmed;
    }
    return `https://${trimmed}`;
};

type ItemFormData = z.infer<typeof itemSchema>;
const ENCRYPTED_ITEM_TITLE_PLACEHOLDER = 'Encrypted Item';

interface VaultItemDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    itemId: string | null;
    onSave?: () => void; // Callback when item is saved
}

const ENCRYPTED_CATEGORY_PREFIX = 'enc:cat:v1:';

export function VaultItemDialog({ open, onOpenChange, itemId, onSave }: VaultItemDialogProps) {
    const { t } = useTranslation();
    const { toast } = useToast();
    const { user } = useAuth();
    const { encryptItem, decryptItem, encryptData, decryptData } = useVault();

    const [itemType, setItemType] = useState<'password' | 'note' | 'totp'>('password');
    const [showPassword, setShowPassword] = useState(false);
    const [showGenerator, setShowGenerator] = useState(false);
    const [loading, setLoading] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [categories, setCategories] = useState<Category[]>([]);
    const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
    const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);

    const isEditing = !!itemId;

    const form = useForm<ItemFormData>({
        resolver: zodResolver(itemSchema),
        defaultValues: {
            title: '',
            url: '',
            username: '',
            password: '',
            notes: '',
            totpSecret: '',
            isFavorite: false,
        },
    });

    const fetchCategories = useCallback(async () => {
        if (!user || !open) return;

        const { data, error } = await supabase
            .from('categories')
            .select('id, name, icon, color')
            .eq('user_id', user.id)
            .order('sort_order', { ascending: true });

        if (!error && data) {
            const resolvedCategories = await Promise.all(
                data.map(async (cat) => {
                    let resolvedName = cat.name;
                    let resolvedIcon = cat.icon;
                    let resolvedColor = cat.color;

                    if (cat.name.startsWith(ENCRYPTED_CATEGORY_PREFIX)) {
                        try {
                            resolvedName = await decryptData(cat.name.slice(ENCRYPTED_CATEGORY_PREFIX.length));
                        } catch (err) {
                            console.error('Failed to decrypt category name:', cat.id, err);
                            resolvedName = 'Encrypted Category';
                        }
                    } else {
                        try {
                            const encryptedName = await encryptData(cat.name);
                            await supabase
                                .from('categories')
                                .update({ name: `${ENCRYPTED_CATEGORY_PREFIX}${encryptedName}` })
                                .eq('id', cat.id);
                        } catch (err) {
                            console.error('Failed to migrate category name:', cat.id, err);
                        }
                    }

                    if (cat.icon && cat.icon.startsWith(ENCRYPTED_CATEGORY_PREFIX)) {
                        try {
                            resolvedIcon = await decryptData(cat.icon.slice(ENCRYPTED_CATEGORY_PREFIX.length));
                        } catch (err) {
                            console.error('Failed to decrypt category icon:', cat.id, err);
                            resolvedIcon = null;
                        }
                    } else if (cat.icon) {
                        try {
                            const encryptedIcon = await encryptData(cat.icon);
                            await supabase
                                .from('categories')
                                .update({ icon: `${ENCRYPTED_CATEGORY_PREFIX}${encryptedIcon}` })
                                .eq('id', cat.id);
                        } catch (err) {
                            console.error('Failed to migrate category icon:', cat.id, err);
                        }
                    }

                    if (cat.color && cat.color.startsWith(ENCRYPTED_CATEGORY_PREFIX)) {
                        try {
                            resolvedColor = await decryptData(cat.color.slice(ENCRYPTED_CATEGORY_PREFIX.length));
                        } catch (err) {
                            console.error('Failed to decrypt category color:', cat.id, err);
                            resolvedColor = '#3b82f6';
                        }
                    } else if (cat.color) {
                        try {
                            const encryptedColor = await encryptData(cat.color);
                            await supabase
                                .from('categories')
                                .update({ color: `${ENCRYPTED_CATEGORY_PREFIX}${encryptedColor}` })
                                .eq('id', cat.id);
                        } catch (err) {
                            console.error('Failed to migrate category color:', cat.id, err);
                        }
                    }

                    return {
                        ...cat,
                        name: resolvedName,
                        icon: resolvedIcon,
                        color: resolvedColor,
                    };
                })
            );

            setCategories(resolvedCategories);
        }
    }, [user, open, decryptData, encryptData]);

    // Fetch categories
    useEffect(() => {
        fetchCategories();
    }, [fetchCategories]);

    // Load existing item data
    useEffect(() => {
        async function loadItem() {
            if (!itemId || !open) return;

            setLoading(true);
            try {
                const { data: item, error } = await supabase
                    .from('vault_items')
                    .select('*')
                    .eq('id', itemId)
                    .single();

                if (error) throw error;

                // Decrypt data
                const decrypted = await decryptItem(item.encrypted_data);
                const resolvedTitle = decrypted.title || item.title || '';
                const resolvedUrl = decrypted.websiteUrl || item.website_url || '';
                const resolvedFavorite = typeof decrypted.isFavorite === 'boolean'
                    ? decrypted.isFavorite
                    : !!item.is_favorite;
                const candidateType = decrypted.itemType || item.item_type || 'password';
                const resolvedType: 'password' | 'note' | 'totp' =
                    candidateType === 'note' || candidateType === 'totp' ? candidateType : 'password';
                const resolvedCategoryId = decrypted.categoryId ?? item.category_id ?? null;

                form.reset({
                    title: resolvedTitle,
                    url: resolvedUrl,
                    username: decrypted.username || '',
                    password: decrypted.password || '',
                    notes: decrypted.notes || '',
                    totpSecret: decrypted.totpSecret || '',
                    isFavorite: resolvedFavorite,
                });

                setItemType(resolvedType);
                setSelectedCategoryId(resolvedCategoryId);
            } catch (err) {
                console.error('Error loading item:', err);
                toast({
                    variant: 'destructive',
                    title: t('common.error'),
                    description: 'Failed to load item',
                });
            } finally {
                setLoading(false);
            }
        }

        loadItem();
    }, [itemId, open, decryptItem, form, toast, t]);

    // Reset form when dialog closes
    useEffect(() => {
        if (!open) {
            form.reset();
            setItemType('password');
            setShowPassword(false);
            setShowGenerator(false);
            setSelectedCategoryId(null);
            setCategoryDialogOpen(false);
        }
    }, [open, form]);

    const onSubmit = async (data: ItemFormData) => {
        if (!user) return;

        setLoading(true);
        try {
            // Get the default vault
            const { data: vault, error: vaultError } = await supabase
                .from('vaults')
                .select('id')
                .eq('user_id', user.id)
                .eq('is_default', true)
                .single();

            if (vaultError || !vault) {
                throw new Error('No vault found');
            }

            // Encrypt sensitive data
            const encryptedData = await encryptItem({
                title: data.title,
                websiteUrl: normalizeUrl(data.url) || undefined,
                itemType,
                isFavorite: data.isFavorite,
                categoryId: selectedCategoryId,
                username: data.username,
                password: data.password,
                notes: data.notes,
                totpSecret: data.totpSecret,
            });

            const itemData = {
                user_id: user.id,
                vault_id: vault.id,
                title: ENCRYPTED_ITEM_TITLE_PLACEHOLDER,
                website_url: null,
                icon_url: null,
                item_type: 'password' as const,
                is_favorite: false,
                encrypted_data: encryptedData,
                category_id: null,
            };

            if (isEditing) {
                // Update existing item
                const { error } = await supabase
                    .from('vault_items')
                    .update(itemData)
                    .eq('id', itemId);

                if (error) throw error;

                toast({
                    title: t('common.success'),
                    description: t('vault.itemUpdated'),
                });
            } else {
                // Create new item
                const { error } = await supabase
                    .from('vault_items')
                    .insert(itemData);

                if (error) throw error;

                toast({
                    title: t('common.success'),
                    description: t('vault.itemCreated'),
                });
            }

            onOpenChange(false);
            // Trigger data refresh without page reload
            onSave?.();
        } catch (err) {
            console.error('Error saving item:', err);
            toast({
                variant: 'destructive',
                title: t('common.error'),
                description: 'Failed to save item',
            });
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async () => {
        if (!itemId) return;

        setDeleting(true);
        try {
            const { error } = await supabase
                .from('vault_items')
                .delete()
                .eq('id', itemId);

            if (error) throw error;

            toast({
                title: t('common.success'),
                description: t('vault.itemDeleted'),
            });
            onOpenChange(false);
        } catch (err) {
            console.error('Error deleting item:', err);
            toast({
                variant: 'destructive',
                title: t('common.error'),
                description: 'Failed to delete item',
            });
        } finally {
            setDeleting(false);
        }
    };

    const handleGeneratedPassword = (password: string) => {
        form.setValue('password', password);
        setShowGenerator(false);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>
                        {isEditing ? t('vault.editItem') : t('vault.newItem')}
                    </DialogTitle>
                </DialogHeader>

                {/* Item Type Tabs */}
                {!isEditing && (
                    <Tabs value={itemType} onValueChange={(v) => setItemType(v as typeof itemType)}>
                        <TabsList className="w-full">
                            <TabsTrigger value="password" className="flex-1">
                                <Key className="w-4 h-4 mr-2" />
                                {t('vault.itemTypes.password')}
                            </TabsTrigger>
                            <TabsTrigger value="note" className="flex-1">
                                <FileText className="w-4 h-4 mr-2" />
                                {t('vault.itemTypes.note')}
                            </TabsTrigger>
                            <TabsTrigger value="totp" className="flex-1">
                                <Shield className="w-4 h-4 mr-2" />
                                {t('vault.itemTypes.totp')}
                            </TabsTrigger>
                        </TabsList>
                    </Tabs>
                )}

                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                        {/* Title */}
                        <FormField
                            control={form.control}
                            name="title"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>{t('vault.fields.title')}</FormLabel>
                                    <FormControl>
                                        <Input placeholder={t('vault.fields.titlePlaceholder')} {...field} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        {/* URL (for password type) */}
                        {(itemType === 'password' || itemType === 'totp') && (
                            <FormField
                                control={form.control}
                                name="url"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>{t('vault.fields.url')}</FormLabel>
                                        <FormControl>
                                            <div className="relative">
                                                <Link className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                                                <Input
                                                    className="pl-10"
                                                    placeholder="example.com"
                                                    {...field}
                                                    onBlur={(e) => {
                                                        const val = e.target.value.trim();
                                                        if (val && !val.startsWith('http://') && !val.startsWith('https://')) {
                                                            field.onChange(`https://${val}`);
                                                        }
                                                        field.onBlur();
                                                    }}
                                                />
                                            </div>
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        )}

                        {/* Username */}
                        {itemType === 'password' && (
                            <FormField
                                control={form.control}
                                name="username"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>{t('vault.fields.username')}</FormLabel>
                                        <FormControl>
                                            <Input placeholder={t('vault.fields.usernamePlaceholder')} {...field} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        )}

                        {/* Password */}
                        {itemType === 'password' && (
                            <FormField
                                control={form.control}
                                name="password"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>{t('vault.fields.password')}</FormLabel>
                                        <FormControl>
                                            <div className="flex gap-2">
                                                <div className="relative flex-1">
                                                    <Input
                                                        type={showPassword ? 'text' : 'password'}
                                                        className="pr-10 font-mono"
                                                        {...field}
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
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="icon"
                                                    onClick={() => setShowGenerator(!showGenerator)}
                                                >
                                                    <Wand2 className="w-4 h-4" />
                                                </Button>
                                            </div>
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        )}

                        {/* Password Generator */}
                        <Collapsible open={showGenerator} onOpenChange={setShowGenerator}>
                            <CollapsibleContent className="mt-2">
                                <div className="p-4 border rounded-lg bg-muted/50">
                                    <PasswordGenerator onSelect={handleGeneratedPassword} />
                                </div>
                            </CollapsibleContent>
                        </Collapsible>

                        {/* TOTP Secret */}
                        {itemType === 'totp' && (
                            <FormField
                                control={form.control}
                                name="totpSecret"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>{t('vault.fields.totpSecret')}</FormLabel>
                                        <FormControl>
                                            <Input
                                                placeholder="JBSWY3DPEHPK3PXP"
                                                className="font-mono"
                                                {...field}
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        )}

                        {/* Notes */}
                        <FormField
                            control={form.control}
                            name="notes"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>{t('vault.fields.notes')}</FormLabel>
                                    <FormControl>
                                        <Textarea
                                            placeholder={t('vault.fields.notesPlaceholder')}
                                            rows={3}
                                            {...field}
                                        />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        {/* Category */}
                        <FormItem>
                            <FormLabel>{t('vault.form.category')}</FormLabel>
                            <div className="flex gap-2">
                                <Select
                                    value={selectedCategoryId ?? '__none__'}
                                    onValueChange={(value) => {
                                        setSelectedCategoryId(value === '__none__' ? null : value);
                                    }}
                                >
                                    <SelectTrigger className="flex-1">
                                        <SelectValue placeholder={t('vault.form.selectCategory')} />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="__none__">
                                            <span className="inline-flex items-center gap-2">
                                                <Folder className="w-4 h-4 text-muted-foreground" />
                                                {t('vault.categories.uncategorized')}
                                            </span>
                                        </SelectItem>
                                        {categories.map((category) => (
                                            <SelectItem key={category.id} value={category.id}>
                                                <span className="inline-flex items-center gap-2">
                                                    <span style={category.color ? { color: category.color } : undefined}>
                                                        <CategoryIcon icon={category.icon} className="w-4 h-4" />
                                                    </span>
                                                    {category.name}
                                                </span>
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="icon"
                                    onClick={() => setCategoryDialogOpen(true)}
                                    title={t('vault.categories.addCategory')}
                                >
                                    <Plus className="w-4 h-4" />
                                </Button>
                            </div>
                        </FormItem>

                        {/* Favorite Toggle */}
                        <FormField
                            control={form.control}
                            name="isFavorite"
                            render={({ field }) => (
                                <FormItem className="flex items-center justify-between">
                                    <FormLabel className="flex items-center gap-2">
                                        <Star className={cn('w-4 h-4', field.value && 'text-amber-500 fill-amber-500')} />
                                        {t('vault.fields.favorite')}
                                    </FormLabel>
                                    <FormControl>
                                        <Switch
                                            checked={field.value}
                                            onCheckedChange={field.onChange}
                                        />
                                    </FormControl>
                                </FormItem>
                            )}
                        />

                        {/* Actions */}
                        <div className="flex gap-2 pt-4 border-t">
                            {isEditing && (
                                <Button
                                    type="button"
                                    variant="destructive"
                                    onClick={handleDelete}
                                    disabled={loading || deleting}
                                >
                                    {deleting ? (
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                    ) : (
                                        <Trash2 className="w-4 h-4" />
                                    )}
                                </Button>
                            )}
                            <div className="flex-1" />
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => onOpenChange(false)}
                                disabled={loading}
                            >
                                {t('common.cancel')}
                            </Button>
                            <Button type="submit" disabled={loading}>
                                {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                                {isEditing ? t('common.save') : t('common.create')}
                            </Button>
                        </div>
                    </form>
                </Form>
            </DialogContent>

            <CategoryDialog
                open={categoryDialogOpen}
                onOpenChange={setCategoryDialogOpen}
                category={null}
                onSave={fetchCategories}
            />
        </Dialog>
    );
}
