// Copyright (c) 2025-2026 Maunting Studios
// Licensed under the Business Source License 1.1 — see LICENSE
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FolderOpen, Plus, Trash2, Loader2 } from 'lucide-react';

import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FeatureGate } from '@/components/Subscription/FeatureGate';
import {
  getSharedCollections,
  deleteSharedCollection,
  type SharedCollection,
} from '@/services/familyService';
import { createCollectionWithHybridKey, createCollectionWithKey } from '@/services/collectionService';
import { supabase } from '@/integrations/supabase/client';
import { generatePQKeyPair } from '@/services/pqCryptoService';
import { deriveKey, encrypt, generateSalt } from '@/services/cryptoService';

export function SharedCollectionsSettings() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<SharedCollection[]>([]);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    if (!user) return;
    setLoading(true);
    try {
      setItems(await getSharedCollections(user.id));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to load collections.';
      toast({ variant: 'destructive', title: t('common.error'), description: msg });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const onCreate = async () => {
    if (!user || !name.trim()) return;
    setSaving(true);
    try {
      const { data: userKeyRow, error: userKeyError } = await supabase
        .from('user_keys')
        .select('public_key')
        .eq('user_id', user.id)
        .maybeSingle();

      if (userKeyError || !userKeyRow?.public_key) {
        throw new Error(t('settings.sharedCollections.missingRsaKey', { defaultValue: 'RSA key setup missing. Configure Emergency Access first.' }));
      }

      const { data: profileRow, error: profileError } = await supabase
        .from('profiles')
        .select('pq_public_key, pq_key_version')
        .eq('user_id', user.id)
        .single();

      if (profileError) throw profileError;

      let pqPublicKey = profileRow?.pq_public_key || null;
      let pqVersion = profileRow?.pq_key_version || null;

      if (!pqPublicKey) {
        const masterPassword = window.prompt(t('passkey.confirmPassword'));
        if (!masterPassword) {
          setSaving(false);
          return;
        }

        const pqKeys = generatePQKeyPair();
        const salt = generateSalt();
        const key = await deriveKey(masterPassword, salt);
        const encryptedPrivateKey = await encrypt(pqKeys.secretKey, key);

        const { error: enablePqError } = await supabase
          .from('profiles')
          .update({
            pq_public_key: pqKeys.publicKey,
            pq_encrypted_private_key: `${salt}:${encryptedPrivateKey}`,
            pq_key_version: 1,
            pq_enforced_at: new Date().toISOString(),
          } as Record<string, unknown>)
          .eq('user_id', user.id);

        if (enablePqError) throw enablePqError;

        pqPublicKey = pqKeys.publicKey;
        pqVersion = 1;
      }

      if (pqPublicKey && pqVersion) {
        await createCollectionWithHybridKey(
          name.trim(),
          null,
          userKeyRow.public_key,
          pqPublicKey
        );
      } else {
        await createCollectionWithKey(
          name.trim(),
          null,
          userKeyRow.public_key
        );
      }

      setName('');
      await load();
      toast({ title: t('common.success'), description: t('settings.sharedCollections.created', { defaultValue: 'Collection created.' }) });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : t('settings.sharedCollections.createError', { defaultValue: 'Failed to create collection.' });
      toast({ variant: 'destructive', title: t('common.error'), description: msg });
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async (id: string) => {
    try {
      await deleteSharedCollection(id);
      await load();
      toast({ title: t('common.success'), description: t('settings.sharedCollections.deleted', { defaultValue: 'Collection deleted.' }) });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : t('settings.sharedCollections.deleteError', { defaultValue: 'Failed to delete collection.' });
      toast({ variant: 'destructive', title: t('common.error'), description: msg });
    }
  };

  return (
    <FeatureGate feature="shared_collections" featureLabel={t('subscription.features.shared_collections')}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FolderOpen className="w-5 h-5" />
            {t('settings.sharedCollections.title', { defaultValue: 'Shared Collections' })}
          </CardTitle>
          <CardDescription>
            {t('settings.sharedCollections.description', { defaultValue: 'Create collections for sharing vault items with family members.' })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input
              placeholder={t('settings.sharedCollections.namePlaceholder', { defaultValue: 'Collection name' })}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <Button onClick={onCreate} disabled={saving || !name.trim()}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            </Button>
          </div>

          {loading ? (
            <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin" /></div>
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('settings.sharedCollections.empty', { defaultValue: 'No shared collections yet.' })}</p>
          ) : (
            <div className="space-y-2">
              {items.map((c) => (
                <div key={c.id} className="flex items-center justify-between border rounded-lg p-3">
                  <div>
                    <p className="font-medium text-sm">{c.name}</p>
                    <p className="text-xs text-muted-foreground">{c.description || t('settings.sharedCollections.noDescription', { defaultValue: 'No description' })}</p>
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => onDelete(c.id)}>
                    <Trash2 className="w-4 h-4 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </FeatureGate>
  );
}
