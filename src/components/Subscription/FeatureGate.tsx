import { ReactNode } from 'react';

interface FeatureGateProps {
    children: ReactNode;
    feature?: string;
    featureLabel?: string;
}

/**
 * A pass-through stub for the premium FeatureGate component.
 * Since migrated features are now free, this component simply renders its children.
 */
export function FeatureGate({ children }: FeatureGateProps) {
    return <>{children}</>;
}
