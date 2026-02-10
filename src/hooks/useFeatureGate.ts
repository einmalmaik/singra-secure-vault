/**
 * @fileoverview Feature Gate Hook
 *
 * Returns whether the current user has access to a specific feature
 * based on their subscription tier. Supports self-host mode.
 */

import { useSubscription } from '@/contexts/SubscriptionContext';
import { type FeatureName, getRequiredTier, type SubscriptionTier } from '@/config/planConfig';

interface FeatureGateResult {
    /** Whether the feature is available to the user */
    allowed: boolean;
    /** The minimum tier required for this feature */
    requiredTier: SubscriptionTier;
    /** The user's current tier */
    currentTier: SubscriptionTier;
    /** Whether billing is disabled (self-host mode) */
    billingDisabled: boolean;
}

/**
 * Check if the current user has access to a specific feature.
 *
 * @example
 * const { allowed, requiredTier } = useFeatureGate('file_attachments');
 * if (!allowed) {
 *   // Show upgrade prompt
 * }
 */
export function useFeatureGate(feature: FeatureName): FeatureGateResult {
    const { tier, hasFeature, billingDisabled } = useSubscription();

    return {
        allowed: hasFeature(feature),
        requiredTier: getRequiredTier(feature),
        currentTier: tier,
        billingDisabled,
    };
}
