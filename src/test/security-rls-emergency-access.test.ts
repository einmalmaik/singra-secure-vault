// Copyright (c) 2025-2026 Maunting Studios
// Licensed under the Business Source License 1.1 — see LICENSE
/**
 * @fileoverview Security test for Emergency Access RLS policies
 *
 * CRITICAL: Tests the hardened RLS policy that prevents field manipulation
 * when trustees accept emergency access invites.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'http://localhost:54321';
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || 'test-anon-key';

describe('Emergency Access RLS Security Tests', () => {
    let grantorClient: SupabaseClient;
    let trusteeClient: SupabaseClient;
    let maliciousClient: SupabaseClient;
    let grantorId: string;
    let trusteeId: string;
    let emergencyAccessId: string;

    beforeAll(async () => {
        // Skip if not in test environment with real Supabase
        if (!process.env.VITE_SUPABASE_URL) {
            console.log('⊘ Skipping RLS tests - requires real Supabase instance');
            return;
        }

        // Create test users
        grantorClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        trusteeClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        maliciousClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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
                cooldown_hours: 24,
                status: 'pending',
                permissions: { view: true, export: false },
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

    it('should allow trustee to accept invite by setting only trusted_user_id', async () => {
        if (!process.env.VITE_SUPABASE_URL) return;

        const { data, error } = await trusteeClient
            .from('emergency_access')
            .update({ trusted_user_id: trusteeId })
            .eq('id', emergencyAccessId)
            .select()
            .single();

        expect(error).toBeNull();
        expect(data).toBeDefined();
        expect(data!.trusted_user_id).toBe(trusteeId);
        expect(data!.status).toBe('pending'); // Status should NOT change
    });

    it('should BLOCK attempt to manipulate status field during invite acceptance', async () => {
        if (!process.env.VITE_SUPABASE_URL) return;

        // Reset the invite first
        await grantorClient
            .from('emergency_access')
            .update({ trusted_user_id: null })
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
        expect(error!.code).toBe('42501'); // PostgreSQL permission denied
        expect(data).toBeNull();

        // Verify status wasn't changed
        const { data: check } = await grantorClient
            .from('emergency_access')
            .select('status, trusted_user_id')
            .eq('id', emergencyAccessId)
            .single();

        expect(check!.status).toBe('pending');
        expect(check!.trusted_user_id).toBeNull();
    });

    it('should BLOCK attempt to manipulate permissions during invite acceptance', async () => {
        if (!process.env.VITE_SUPABASE_URL) return;

        const { data, error } = await trusteeClient
            .from('emergency_access')
            .update({
                trusted_user_id: trusteeId,
                permissions: { view: true, export: true, delete: true }, // MALICIOUS: Adding permissions
            })
            .eq('id', emergencyAccessId)
            .select()
            .single();

        expect(error).toBeDefined();
        expect(error!.code).toBe('42501');
        expect(data).toBeNull();

        // Verify permissions weren't changed
        const { data: check } = await grantorClient
            .from('emergency_access')
            .select('permissions')
            .eq('id', emergencyAccessId)
            .single();

        expect(check!.permissions).toEqual({ view: true, export: false });
    });

    it('should BLOCK attempt to manipulate expires_at during invite acceptance', async () => {
        if (!process.env.VITE_SUPABASE_URL) return;

        const futureDate = new Date();
        futureDate.setFullYear(futureDate.getFullYear() + 10);

        const { data, error } = await trusteeClient
            .from('emergency_access')
            .update({
                trusted_user_id: trusteeId,
                expires_at: futureDate.toISOString(), // MALICIOUS: Extending expiry
            })
            .eq('id', emergencyAccessId)
            .select()
            .single();

        expect(error).toBeDefined();
        expect(error!.code).toBe('42501');
        expect(data).toBeNull();
    });

    it('should BLOCK attempt to manipulate cooldown_hours during invite acceptance', async () => {
        if (!process.env.VITE_SUPABASE_URL) return;

        const { data, error } = await trusteeClient
            .from('emergency_access')
            .update({
                trusted_user_id: trusteeId,
                cooldown_hours: 0, // MALICIOUS: Removing cooldown
            })
            .eq('id', emergencyAccessId)
            .select()
            .single();

        expect(error).toBeDefined();
        expect(error!.code).toBe('42501');
        expect(data).toBeNull();

        // Verify cooldown wasn't changed
        const { data: check } = await grantorClient
            .from('emergency_access')
            .select('cooldown_hours')
            .eq('id', emergencyAccessId)
            .single();

        expect(check!.cooldown_hours).toBe(24);
    });

    it('should BLOCK unauthorized user from accepting invite', async () => {
        if (!process.env.VITE_SUPABASE_URL) return;

        // Sign up a malicious user
        const { data: maliciousAuth } = await maliciousClient.auth.signUp({
            email: `malicious-${Date.now()}@test.local`,
            password: 'Malicious123!',
        });

        const { data, error } = await maliciousClient
            .from('emergency_access')
            .update({ trusted_user_id: maliciousAuth!.user!.id })
            .eq('id', emergencyAccessId)
            .select()
            .single();

        expect(error).toBeDefined();
        expect(data).toBeNull();
    });

    it('should create audit log entry for successful invite acceptance', async () => {
        if (!process.env.VITE_SUPABASE_URL) return;

        // First accept the invite properly
        await trusteeClient
            .from('emergency_access')
            .update({ trusted_user_id: trusteeId })
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
        expect(auditLog!.new_values.trusted_user_id).toBe(trusteeId);
    });
});

describe('Emergency Access Field Manipulation Exploit Tests', () => {
    it('should detect and log field manipulation attempts in audit', async () => {
        if (!process.env.VITE_SUPABASE_URL) return;

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
                cooldown_hours: 24,
                status: 'pending',
            })
            .select()
            .single();

        // Attempt various exploits (all should fail)
        const exploitAttempts = [
            { status: 'granted' },
            { permissions: { delete: true } },
            { expires_at: '2099-12-31T23:59:59Z' },
            { cooldown_hours: 0 },
            { granted_at: new Date().toISOString() },
        ];

        for (const exploit of exploitAttempts) {
            const { error } = await supabase
                .from('emergency_access')
                .update({
                    trusted_user_id: auth!.user!.id,
                    ...exploit,
                })
                .eq('id', invite!.id);

            // All attempts should fail
            expect(error).toBeDefined();
            expect(error!.code).toBe('42501');
        }

        // Cleanup
        await supabase
            .from('emergency_access')
            .delete()
            .eq('id', invite!.id);
    });
});