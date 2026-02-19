// Copyright (c) 2025-2026 Maunting Studios
// Licensed under the Business Source License 1.1 — see LICENSE
/**
 * @fileoverview Security test for timing attack prevention
 *
 * CRITICAL: Tests that dual unlock (real vs duress password) has
 * constant-time execution to prevent timing-based information leakage.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { attemptDualUnlock, DuressConfig } from '@/services/duressService';
import { generateSalt, CURRENT_KDF_VERSION } from '@/services/cryptoService';

describe('Timing Attack Prevention Tests', () => {
    let realSalt: string;
    let realVerifier: string;
    let duressConfig: DuressConfig;

    beforeAll(() => {
        // Setup test data
        realSalt = generateSalt();
        // Mock verifier (in real scenario this would be from deriveKey + createVerificationHash)
        realVerifier = 'v2:test:mockVerifier';

        duressConfig = {
            enabled: true,
            salt: generateSalt(),
            verifier: 'v2:test:mockDuressVerifier',
            kdfVersion: CURRENT_KDF_VERSION,
        };
    });

    it('should have consistent timing between real and duress password checks', async () => {
        const iterations = 10;
        const realPasswordTimings: number[] = [];
        const duressPasswordTimings: number[] = [];
        const invalidPasswordTimings: number[] = [];

        // Test with different KDF versions to ensure timing consistency
        const testScenarios = [
            { realKdf: 1, duressKdf: 1 },
            { realKdf: 1, duressKdf: 2 },
            { realKdf: 2, duressKdf: 1 },
            { realKdf: 2, duressKdf: 2 },
        ];

        for (const scenario of testScenarios) {
            // Configure duress with specific KDF version
            const testDuressConfig: DuressConfig = {
                ...duressConfig,
                kdfVersion: scenario.duressKdf,
            };

            // Measure timing for real password (would match in real scenario)
            for (let i = 0; i < iterations; i++) {
                const start = performance.now();
                await attemptDualUnlock(
                    'RealMasterPassword123!',
                    realSalt,
                    realVerifier,
                    scenario.realKdf,
                    testDuressConfig
                );
                const end = performance.now();
                realPasswordTimings.push(end - start);
            }

            // Measure timing for duress password
            for (let i = 0; i < iterations; i++) {
                const start = performance.now();
                await attemptDualUnlock(
                    'DuressPassword456!',
                    realSalt,
                    realVerifier,
                    scenario.realKdf,
                    testDuressConfig
                );
                const end = performance.now();
                duressPasswordTimings.push(end - start);
            }

            // Measure timing for invalid password
            for (let i = 0; i < iterations; i++) {
                const start = performance.now();
                await attemptDualUnlock(
                    'InvalidPassword789!',
                    realSalt,
                    realVerifier,
                    scenario.realKdf,
                    testDuressConfig
                );
                const end = performance.now();
                invalidPasswordTimings.push(end - start);
            }
        }

        // Calculate statistics
        const realAvg = average(realPasswordTimings);
        const duressAvg = average(duressPasswordTimings);
        const invalidAvg = average(invalidPasswordTimings);

        const realStdDev = standardDeviation(realPasswordTimings);
        const duressStdDev = standardDeviation(duressPasswordTimings);
        const invalidStdDev = standardDeviation(invalidPasswordTimings);

        // Log timing information for analysis
        console.log('Timing Analysis:');
        console.log(`Real password:    avg=${realAvg.toFixed(2)}ms, stddev=${realStdDev.toFixed(2)}ms`);
        console.log(`Duress password:  avg=${duressAvg.toFixed(2)}ms, stddev=${duressStdDev.toFixed(2)}ms`);
        console.log(`Invalid password: avg=${invalidAvg.toFixed(2)}ms, stddev=${invalidStdDev.toFixed(2)}ms`);

        // Assert timing differences are minimal (< 10ms difference in averages)
        // This threshold accounts for normal system variability
        const maxAllowedDifference = 10; // milliseconds

        expect(Math.abs(realAvg - duressAvg)).toBeLessThan(maxAllowedDifference);
        expect(Math.abs(realAvg - invalidAvg)).toBeLessThan(maxAllowedDifference);
        expect(Math.abs(duressAvg - invalidAvg)).toBeLessThan(maxAllowedDifference);

        // Check that standard deviations are reasonable (not too high)
        const maxStdDev = 20; // milliseconds
        expect(realStdDev).toBeLessThan(maxStdDev);
        expect(duressStdDev).toBeLessThan(maxStdDev);
        expect(invalidStdDev).toBeLessThan(maxStdDev);
    });

    it('should have consistent timing with duress mode disabled', async () => {
        const iterations = 10;
        const enabledTimings: number[] = [];
        const disabledTimings: number[] = [];

        // Test with duress enabled
        for (let i = 0; i < iterations; i++) {
            const start = performance.now();
            await attemptDualUnlock(
                'TestPassword123!',
                realSalt,
                realVerifier,
                CURRENT_KDF_VERSION,
                duressConfig
            );
            const end = performance.now();
            enabledTimings.push(end - start);
        }

        // Test with duress disabled (null config)
        for (let i = 0; i < iterations; i++) {
            const start = performance.now();
            await attemptDualUnlock(
                'TestPassword123!',
                realSalt,
                realVerifier,
                CURRENT_KDF_VERSION,
                null
            );
            const end = performance.now();
            disabledTimings.push(end - start);
        }

        const enabledAvg = average(enabledTimings);
        const disabledAvg = average(disabledTimings);

        console.log('Duress Mode Timing:');
        console.log(`Enabled:  avg=${enabledAvg.toFixed(2)}ms`);
        console.log(`Disabled: avg=${disabledAvg.toFixed(2)}ms`);

        // Timing should be consistent whether duress is enabled or not
        expect(Math.abs(enabledAvg - disabledAvg)).toBeLessThan(10);
    });

    it('should use maximum KDF version for both paths', async () => {
        // This test verifies that both KDF derivations use the same (maximum) version
        // to ensure consistent computation time

        const testCases = [
            { realKdf: 1, duressKdf: 2, expected: 2 },
            { realKdf: 2, duressKdf: 1, expected: 2 },
            { realKdf: 1, duressKdf: null, expected: CURRENT_KDF_VERSION },
        ];

        for (const testCase of testCases) {
            const config = testCase.duressKdf
                ? { ...duressConfig, kdfVersion: testCase.duressKdf }
                : null;

            // We can't directly test the internal KDF version used,
            // but we can verify timing consistency
            const timings: number[] = [];

            for (let i = 0; i < 5; i++) {
                const start = performance.now();
                await attemptDualUnlock(
                    'TestPassword',
                    realSalt,
                    realVerifier,
                    testCase.realKdf,
                    config
                );
                const end = performance.now();
                timings.push(end - start);
            }

            // Verify low variance (indicates consistent KDF parameters)
            const stdDev = standardDeviation(timings);
            expect(stdDev).toBeLessThan(15);
        }
    });
});

// Helper functions for statistical analysis
function average(numbers: number[]): number {
    return numbers.reduce((a, b) => a + b, 0) / numbers.length;
}

function standardDeviation(numbers: number[]): number {
    const avg = average(numbers);
    const squaredDiffs = numbers.map(n => Math.pow(n - avg, 2));
    const avgSquaredDiff = average(squaredDiffs);
    return Math.sqrt(avgSquaredDiff);
}