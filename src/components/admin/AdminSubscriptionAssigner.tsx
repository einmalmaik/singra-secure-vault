// Copyright (c) 2025-2026 Maunting Studios
// Licensed under the Business Source License 1.1 — see LICENSE
/**
 * @fileoverview Admin Subscription Assigner
 *
 * Manual subscription assignment workflow for authorized admins.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import {
    type SubscriptionTier,
    assignUserSubscription,
    lookupAdminUser,
} from '@/services/adminService';

const TIER_OPTIONS: SubscriptionTier[] = ['free', 'premium', 'families', 'self_hosted'];
const DEFAULT_TARGET_TIER: SubscriptionTier = 'free';

interface AdminSubscriptionAssignerProps {
    defaultUserId?: string;
    ticketId?: string;
}

/**
 * Builds the reset snapshot when ticket context switches.
 *
 * @param defaultUserId - Ticket user id to prefill the lookup input
 * @returns Reset values for assignment state
 */
function getAssignerResetState(defaultUserId?: string): {
    lookupInput: string;
    resolvedUserId: string;
    targetTier: SubscriptionTier;
    reason: string;
} {
    return {
        lookupInput: defaultUserId || '',
        resolvedUserId: '',
        targetTier: DEFAULT_TARGET_TIER,
        reason: '',
    };
}

/**
 * Manual assignment form for subscription tier management.
 *
 * @param props - Component props
 * @returns Subscription assignment section
 */
export function AdminSubscriptionAssigner({ defaultUserId, ticketId }: AdminSubscriptionAssignerProps) {
    const { t } = useTranslation();
    const { toast } = useToast();

    const [lookupInput, setLookupInput] = useState('');
    const [resolvedUserId, setResolvedUserId] = useState('');
    const [resolvedEmail, setResolvedEmail] = useState<string | null>(null);
    const [currentTier, setCurrentTier] = useState<SubscriptionTier>(DEFAULT_TARGET_TIER);
    const [currentStatus, setCurrentStatus] = useState('active');
    const [targetTier, setTargetTier] = useState<SubscriptionTier>(DEFAULT_TARGET_TIER);
    const [reason, setReason] = useState('');
    const [isLookingUp, setIsLookingUp] = useState(false);
    const [isAssigning, setIsAssigning] = useState(false);

    useEffect(() => {
        // Reset on both user AND ticket change to prevent cross-ticket leakage
        const resetState = getAssignerResetState(defaultUserId);
        setLookupInput(resetState.lookupInput);
        setResolvedUserId(resetState.resolvedUserId);
        setResolvedEmail(null);
        setCurrentTier(DEFAULT_TARGET_TIER);
        setCurrentStatus('active');
        setTargetTier(resetState.targetTier);
        setReason(resetState.reason);
    }, [defaultUserId, ticketId]);

    const handleLookup = useCallback(async () => {
        const value = lookupInput.trim();
        if (!value) {
            return;
        }

        setIsLookingUp(true);
        const payload = value.includes('@') ? { email: value } : { userId: value };
        const { user, error } = await lookupAdminUser(payload);
        setIsLookingUp(false);

        if (error || !user) {
            setResolvedUserId('');
            setResolvedEmail(null);
            toast({
                variant: 'destructive',
                title: t('common.error'),
                description: t('admin.support.subscription.lookupError'),
            });
            return;
        }

        setResolvedUserId(user.user_id);
        setResolvedEmail(user.email);
        setCurrentTier(user.tier);
        setCurrentStatus(user.status);
        setTargetTier(user.tier);
    }, [lookupInput, t, toast]);

    const handleAssign = useCallback(async () => {
        if (!resolvedUserId || reason.trim().length < 5) {
            return;
        }

        setIsAssigning(true);
        const { error } = await assignUserSubscription({
            ticketId,
            userId: resolvedUserId,
            tier: targetTier,
            reason: reason.trim(),
        });
        setIsAssigning(false);

        if (error) {
            toast({
                variant: 'destructive',
                title: t('common.error'),
                description: t('admin.support.subscription.assignError'),
            });
            return;
        }

        setCurrentTier(targetTier);
        setCurrentStatus('active');
        setReason('');
        toast({
            title: t('common.success'),
            description: t('admin.support.subscription.assignSuccess'),
        });
    }, [reason, resolvedUserId, targetTier, t, ticketId, toast]);

    return (
        <div className="rounded-lg border p-3 space-y-3">
            <p className="text-sm font-medium">{t('admin.support.subscription.title')}</p>

            <div className="space-y-2">
                <Label htmlFor="subscription-lookup">{t('admin.support.subscription.lookupLabel')}</Label>
                <div className="flex items-center gap-2">
                    <Input
                        id="subscription-lookup"
                        value={lookupInput}
                        onChange={(event) => setLookupInput(event.target.value)}
                        placeholder={t('admin.support.subscription.lookupPlaceholder')}
                    />
                    <Button type="button" variant="secondary" onClick={handleLookup} disabled={isLookingUp}>
                        {isLookingUp ? <Loader2 className="w-4 h-4 animate-spin" /> : t('admin.support.subscription.lookupAction')}
                    </Button>
                </div>
            </div>

            {resolvedUserId && (
                <>
                    <div className="rounded-md bg-muted/40 p-2 text-xs space-y-1">
                        <p>{t('admin.support.subscription.resolvedUser', { userId: resolvedUserId })}</p>
                        <p>{t('admin.support.subscription.currentTier', { tier: currentTier })}</p>
                        <p>{t('admin.support.subscription.currentStatus', { status: currentStatus })}</p>
                        {resolvedEmail && <p>{t('admin.support.subscription.currentEmail', { email: resolvedEmail })}</p>}
                    </div>

                    <div className="space-y-2">
                        <Label>{t('admin.support.subscription.targetTier')}</Label>
                        <Select value={targetTier} onValueChange={(value) => setTargetTier(value as SubscriptionTier)}>
                            <SelectTrigger className="w-full sm:w-[220px]">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {TIER_OPTIONS.map((tier) => (
                                    <SelectItem key={tier} value={tier}>
                                        {t(`admin.support.subscription.tiers.${tier}`)}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="subscription-reason">{t('admin.support.subscription.reasonLabel')}</Label>
                        <Textarea
                            id="subscription-reason"
                            value={reason}
                            onChange={(event) => setReason(event.target.value)}
                            rows={3}
                            maxLength={500}
                            placeholder={t('admin.support.subscription.reasonPlaceholder')}
                        />
                    </div>

                    <Button
                        type="button"
                        onClick={handleAssign}
                        disabled={isAssigning || reason.trim().length < 5}
                    >
                        {isAssigning ? <Loader2 className="w-4 h-4 animate-spin" /> : t('admin.support.subscription.assignAction')}
                    </Button>
                </>
            )}
        </div>
    );
}

if (import.meta.vitest) {
    const { describe, it, expect } = import.meta.vitest;

    describe('getAssignerResetState', () => {
        it('should reset resolved assignment state when switching ticket default user', () => {
            const fromUserA = getAssignerResetState('user-a');
            expect(fromUserA.lookupInput).toBe('user-a');
            expect(fromUserA.resolvedUserId).toBe('');
            expect(fromUserA.targetTier).toBe('free');
            expect(fromUserA.reason).toBe('');

            const toUserB = getAssignerResetState('user-b');
            expect(toUserB.lookupInput).toBe('user-b');
            expect(toUserB.resolvedUserId).toBe('');
            expect(toUserB.targetTier).toBe('free');
            expect(toUserB.reason).toBe('');
        });
    });
}
