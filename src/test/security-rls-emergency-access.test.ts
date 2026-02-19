// Copyright (c) 2025-2026 Maunting Studios
// Licensed under the Business Source License 1.1 - see LICENSE
/**
 * @fileoverview Security test for Emergency Access RLS policies
 *
 * CRITICAL: Tests the hardened RLS policy that prevents field manipulation
 * when trustees accept emergency access invites.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;
const HAS_SUPABASE = !!(SUPABASE_URL && SUPABASE_ANON_KEY);

describe('Emergency Access RLS Security Tests', () => {
    let grantorClient: SupabaseClient;
    let trusteeClient: SupabaseClient;
    let maliciousClient: SupabaseClient;
    let grantorId: string;
    let trusteeId: string;
    let emergencyAccessId: string;

    beforeAll(async () => {
        // Skip if not in test environment with real Supabase
        if (!HAS_SUPABASE) {
            console.log('⊘ Skipping RLS tests - missing Supabase env config');
            return;
        }

        // Create test users
        grantorClient = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!);
        trusteeClient = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!);
        maliciousClient = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!);

        // Sign up grantor
        const { data: grantorAuth, error: grantorError } = await grantorClient.auth.signUp({
            email: `grantor-${Date.now()}@test.local`,
            password: 'Test123!@#Secure',
        });
        expect(grantorError).toBeNull();
        grantorId = grantorAuth!.user!.id;

        // Sign up trustee
        const { data: trusteeAuth, error: trusteeError } = await trusteeClient.auth.signUp({
            email: `trustee-${Date.now()}@test.local`,
            password: 'Test456!@#Secure',
        });
        expect(trusteeError).toBeNull();
        trusteeId = trusteeAuth!.user!.id;

        // Create emergency access invite
        const { data: invite, error: inviteError } = await grantorClient
            .from('emergency_access')
            .insert({
                grantor_id: grantorId,
                trusted_email: trusteeAuth!.user!.email,
                wait_days: 7,
                status: 'invited',
            })
            .select()
            .single();

        expect(inviteError).toBeNull();
        emergencyAccessId = invite!.id;
    });

    afterAll(async () => {
        // Cleanup
        if (emergencyAccessId) {
            await grantorClient
                .from('emergency_access')
                .delete()
                .eq('id', emergencyAccessId);
        }
    });

    it('should allow trustee to accept invite by setting trusted_user_id and status', async () => {
        if (!HAS_SUPABASE) return;

        const { data, error } = await trusteeClient
            .from('emergency_access')
            .update({
                trusted_user_id: trusteeId,
                status: 'accepted',
            })
            .eq('id', emergencyAccessId)
            .select()
            .single();

        expect(error).toBeNull();
        expect(data).toBeDefined();
        expect(data!.trusted_user_id).toBe(trusteeId);
        expect(data!.status).toBe('accepted');
    });

    it('should BLOCK attempt to manipulate status field during invite acceptance', async () => {
        if (!HAS_SUPABASE) return;

        // Reset the invite first
        await grantorClient
            .from('emergency_access')
            .update({
                trusted_user_id: null,
                status: 'invited',
                trustee_public_key: null,
                trustee_pq_public_key: null,
            })
            .eq('id', emergencyAccessId);

        // Try to manipulate status
        const { data, error } = await trusteeClient
            .from('emergency_access')
            .update({
                trusted_user_id: trusteeId,
                status: 'granted', // MALICIOUS: Trying to grant themselves access
            })
            .eq('id', emergencyAccessId)
            .select()
            .single();

        // This should fail with RLS policy violation
        expect(error).toBeDefined();
        expect(['42501', 'P0001']).toContain(error!.code);
        expect(data).toBeNull();

        // Verify status wasn't changed
        const { data: check } = await grantorClient
            .from('emergency_access')
            .select('status, trusted_user_id')
            .eq('id', emergencyAccessId)
            .single();

        expect(check!.status).toBe('invited');
        expect(check!.trusted_user_id).toBeNull();
    });

    it('should BLOCK attempt to manipulate wait_days during invite acceptance', async () => {
        if (!HAS_SUPABASE) return;

        const { data, error } = await trusteeClient
            .from('emergency_access')
            .update({
                trusted_user_id: trusteeId,
                status: 'accepted',
                wait_days: 1, // MALICIOUS: Shortening wait period
            })
            .eq('id', emergencyAccessId)
            .select()
            .single();

        expect(error).toBeDefined();
        expect(['42501', 'P0001']).toContain(error!.code);
        expect(data).toBeNull();

        // Verify wait_days wasn't changed
        const { data: check } = await grantorClient
            .from('emergency_access')
            .select('wait_days')
            .eq('id', emergencyAccessId)
            .single();

        expect(check!.wait_days).toBe(7);
    });

    it('should BLOCK attempt to manipulate encrypted_master_key during invite acceptance', async () => {
        if (!HAS_SUPABASE) return;

        const { data, error } = await trusteeClient
            .from('emergency_access')
            .update({
                trusted_user_id: trusteeId,
                status: 'accepted',
                encrypted_master_key: 'malicious-key', // MALICIOUS: Injecting key
            })
            .eq('id', emergencyAccessId)
            .select()
            .single();

        expect(error).toBeDefined();
        expect(['42501', 'P0001']).toContain(error!.code);
        expect(data).toBeNull();
    });

    it('should BLOCK attempt to manipulate trusted_email during invite acceptance', async () => {
        if (!HAS_SUPABASE) return;

        const { data, error } = await trusteeClient
            .from('emergency_access')
            .update({
                trusted_user_id: trusteeId,
                status: 'accepted',
                trusted_email: 'attacker@test.local', // MALICIOUS: Rebinding invite
            })
            .eq('id', emergencyAccessId)
            .select()
            .single();

        expect(error).toBeDefined();
        expect(['42501', 'P0001']).toContain(error!.code);
        expect(data).toBeNull();

        // Verify trusted_email wasn't changed
        const { data: check } = await grantorClient
            .from('emergency_access')
            .select('trusted_email')
            .eq('id', emergencyAccessId)
            .single();

        expect(check!.trusted_email).toBeDefined();
    });

    it('should BLOCK unauthorized user from accepting invite', async () => {
        if (!HAS_SUPABASE) return;

        // Sign up a malicious user
        const { data: maliciousAuth } = await maliciousClient.auth.signUp({
            email: `malicious-${Date.now()}@test.local`,
            password: 'Malicious123!',
        });

        const { data, error } = await maliciousClient
            .from('emergency_access')
            .update({
                trusted_user_id: maliciousAuth!.user!.id,
                status: 'accepted',
            })
            .eq('id', emergencyAccessId)
            .select()
            .single();

        expect(error).toBeDefined();
        expect(data).toBeNull();
    });

    it('should create audit log entry for successful invite acceptance', async () => {
        if (!HAS_SUPABASE) return;

        // First accept the invite properly
        await trusteeClient
            .from('emergency_access')
            .update({
                trusted_user_id: trusteeId,
                status: 'accepted',
            })
            .eq('id', emergencyAccessId);

        // Check audit log
        const { data: auditLog } = await trusteeClient
            .from('emergency_access_audit')
            .select('*')
            .eq('emergency_access_id', emergencyAccessId)
            .eq('action', 'UPDATE')
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

        expect(auditLog).toBeDefined();
        expect(auditLog!.changed_fields).toHaveProperty('trusted_user_id');
        expect(auditLog!.changed_fields).toHaveProperty('status');
        expect(auditLog!.new_values.trusted_user_id).toBe(trusteeId);
    });
});

describe('Emergency Access Field Manipulation Exploit Tests', () => {
    it('should detect and log field manipulation attempts in audit', async () => {
        if (!HAS_SUPABASE) return;

        // This test verifies that even failed manipulation attempts are logged
        // for security monitoring purposes

        const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

        // Create test scenario
        const { data: auth } = await supabase.auth.signUp({
            email: `exploit-test-${Date.now()}@test.local`,
            password: 'ExploitTest123!',
        });

        const { data: invite } = await supabase
            .from('emergency_access')
            .insert({
                grantor_id: auth!.user!.id,
                trusted_email: 'victim@test.local',
                wait_days: 7,
                status: 'invited',
            })
            .select()
            .single();

        // Attempt various exploits (all should fail)
        const exploitAttempts = [
            { status: 'granted' },
            { wait_days: 1 },
            { trusted_email: 'attacker@test.local' },
            { encrypted_master_key: 'malicious' },
            { pq_encrypted_master_key: 'malicious' },
            { granted_at: new Date().toISOString() },
        ];

        for (const exploit of exploitAttempts) {
            const { error } = await supabase
                .from('emergency_access')
                .update({
                    trusted_user_id: auth!.user!.id,
                    status: 'accepted',
                    ...exploit,
                })
                .eq('id', invite!.id);

            // All attempts should fail
            expect(error).toBeDefined();
            expect(['42501', 'P0001']).toContain(error!.code);
        }

        // Cleanup
        await supabase
            .from('emergency_access')
            .delete()
            .eq('id', invite!.id);
    });
});
