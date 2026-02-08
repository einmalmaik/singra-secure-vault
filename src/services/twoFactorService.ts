/**
 * @fileoverview Two-Factor Authentication Service
 * 
 * Provides TOTP-based 2FA functionality including:
 * - Secret generation and QR code URI
 * - TOTP code verification
 * - Backup code generation and verification
 * - 2FA enable/disable with security checks
 */

import * as OTPAuth from 'otpauth';
import { supabase } from '@/integrations/supabase/client';

// ============ Types ============

export interface TwoFactorStatus {
    isEnabled: boolean;
    vaultTwoFactorEnabled: boolean;
    lastVerifiedAt: string | null;
    backupCodesRemaining: number;
}

export interface SetupData {
    secret: string;
    qrCodeUri: string;
    backupCodes: string[];
}

// ============ Constants ============

const ISSUER = 'Singra PW';
const BACKUP_CODE_COUNT = 5;
const BACKUP_CODE_LENGTH = 8;

// ============ Secret Generation ============

/**
 * Generates a new TOTP secret
 * @returns Base32 encoded secret
 */
export function generateTOTPSecret(): string {
    const secret = new OTPAuth.Secret({ size: 20 });
    return secret.base32;
}

/**
 * Generates the QR code URI for authenticator apps
 * @param secret - Base32 encoded secret
 * @param email - User's email for the label
 * @returns otpauth:// URI for QR code generation
 */
export function generateQRCodeUri(secret: string, email: string): string {
    const totp = new OTPAuth.TOTP({
        issuer: ISSUER,
        label: email,
        algorithm: 'SHA1',
        digits: 6,
        period: 30,
        secret: OTPAuth.Secret.fromBase32(secret),
    });

    return totp.toString();
}

/**
 * Formats secret for manual entry (with spaces for readability)
 * @param secret - Base32 encoded secret
 * @returns Formatted secret like "JBSW Y3DP EHPK 3PXP"
 */
export function formatSecretForDisplay(secret: string): string {
    return secret.match(/.{1,4}/g)?.join(' ') || secret;
}

// ============ TOTP Verification ============

/**
 * Verifies a TOTP code against a secret
 * @param secret - Base32 encoded secret
 * @param code - 6-digit code to verify
 * @returns true if code is valid
 */
export function verifyTOTPCode(secret: string, code: string): boolean {
    try {
        const totp = new OTPAuth.TOTP({
            issuer: ISSUER,
            algorithm: 'SHA1',
            digits: 6,
            period: 30,
            secret: OTPAuth.Secret.fromBase32(secret.replace(/\s/g, '')),
        });

        // Allow 1 period window (30 seconds) for clock drift
        const delta = totp.validate({ token: code.replace(/\s/g, ''), window: 1 });
        return delta !== null;
    } catch (error) {
        console.error('TOTP verification error:', error);
        return false;
    }
}

// ============ Backup Codes ============

/**
 * Generates random backup codes
 * @returns Array of backup codes (not hashed, for display to user)
 */
export function generateBackupCodes(): string[] {
    const codes: string[] = [];
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Excluded similar chars (0, O, 1, I)

    for (let i = 0; i < BACKUP_CODE_COUNT; i++) {
        let code = '';
        for (let j = 0; j < BACKUP_CODE_LENGTH; j++) {
            const randomIndex = Math.floor(Math.random() * chars.length);
            code += chars[randomIndex];
        }
        // Format as XXXX-XXXX
        codes.push(`${code.slice(0, 4)}-${code.slice(4)}`);
    }

    return codes;
}

/**
 * Hashes a backup code for secure storage
 * @param code - Plain backup code
 * @returns SHA-256 hash of the code
 */
export async function hashBackupCode(code: string): Promise<string> {
    const normalizedCode = code.replace(/-/g, '').toUpperCase();
    const encoder = new TextEncoder();
    const data = encoder.encode(normalizedCode);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// ============ Database Operations ============

/**
 * Gets the current 2FA status for a user
 * @param userId - User ID
 * @returns 2FA status or null if not set up
 */
export async function get2FAStatus(userId: string): Promise<TwoFactorStatus | null> {
    const { data, error } = await supabase
        .from('user_2fa')
        .select('is_enabled, vault_2fa_enabled, last_verified_at')
        .eq('user_id', userId)
        .single();

    if (error || !data) {
        return null;
    }

    // Count remaining backup codes
    const { count } = await supabase
        .from('backup_codes')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('is_used', false);

    return {
        isEnabled: data.is_enabled,
        vaultTwoFactorEnabled: data.vault_2fa_enabled,
        lastVerifiedAt: data.last_verified_at,
        backupCodesRemaining: count || 0,
    };
}

/**
 * Gets the TOTP secret for a user (for verification)
 * @param userId - User ID
 * @returns Secret or null
 */
export async function getTOTPSecret(userId: string): Promise<string | null> {
    const { data, error } = await supabase.rpc('get_user_2fa_secret', {
        p_user_id: userId,
        p_require_enabled: true,
    });

    if (error || !data) {
        return null;
    }

    return data;
}

/**
 * Initializes 2FA setup (stores secret but not enabled yet)
 * @param userId - User ID
 * @param secret - TOTP secret
 * @returns Success status
 */
export async function initializeTwoFactorSetup(
    userId: string,
    secret: string
): Promise<{ success: boolean; error?: string }> {
    const { error } = await supabase.rpc('initialize_user_2fa_secret', {
        p_user_id: userId,
        p_secret: secret,
    });

    if (error) {
        console.error('Error initializing 2FA:', error);
        return { success: false, error: error.message };
    }

    return { success: true };
}

/**
 * Enables 2FA after successful code verification
 * @param userId - User ID
 * @param code - TOTP code for verification
 * @param backupCodes - Generated backup codes to store
 * @returns Success status
 */
export async function enableTwoFactor(
    userId: string,
    code: string,
    backupCodes: string[]
): Promise<{ success: boolean; error?: string }> {
    // Get the pending secret
    const { data: pendingSecret, error: fetchError } = await supabase.rpc('get_user_2fa_secret', {
        p_user_id: userId,
        p_require_enabled: false,
    });

    if (fetchError || !pendingSecret) {
        return { success: false, error: '2FA setup not found. Please start again.' };
    }

    // Verify the code
    if (!verifyTOTPCode(pendingSecret, code)) {
        return { success: false, error: 'Invalid code. Please try again.' };
    }

    // Enable 2FA
    const { error: updateError } = await supabase
        .from('user_2fa')
        .update({
            is_enabled: true,
            enabled_at: new Date().toISOString(),
            last_verified_at: new Date().toISOString(),
        })
        .eq('user_id', userId);

    if (updateError) {
        return { success: false, error: updateError.message };
    }

    // Store hashed backup codes
    const hashedCodes = await Promise.all(
        backupCodes.map(async (code) => ({
            user_id: userId,
            code_hash: await hashBackupCode(code),
        }))
    );

    const { error: codesError } = await supabase
        .from('backup_codes')
        .insert(hashedCodes);

    if (codesError) {
        console.error('Error storing backup codes:', codesError);
        // Don't fail the whole operation, 2FA is still enabled
    }

    return { success: true };
}

/**
 * Verifies a backup code and marks it as used
 * @param userId - User ID
 * @param code - Backup code to verify
 * @returns Whether the code was valid
 */
export async function verifyAndConsumeBackupCode(
    userId: string,
    code: string
): Promise<boolean> {
    const codeHash = await hashBackupCode(code);

    // Find unused backup code
    const { data, error } = await supabase
        .from('backup_codes')
        .select('id')
        .eq('user_id', userId)
        .eq('code_hash', codeHash)
        .eq('is_used', false)
        .single();

    if (error || !data) {
        return false;
    }

    // Mark as used
    const { error: updateError } = await supabase
        .from('backup_codes')
        .update({
            is_used: true,
            used_at: new Date().toISOString(),
        })
        .eq('id', data.id);

    if (updateError) {
        console.error('Error consuming backup code:', updateError);
        return false;
    }

    // Update last verified timestamp
    await supabase
        .from('user_2fa')
        .update({ last_verified_at: new Date().toISOString() })
        .eq('user_id', userId);

    return true;
}

/**
 * Disables 2FA for a user (requires valid TOTP code)
 * @param userId - User ID
 * @param code - Current TOTP code (NOT backup code)
 * @returns Success status
 */
export async function disableTwoFactor(
    userId: string,
    code: string
): Promise<{ success: boolean; error?: string }> {
    // Get the secret
    const secret = await getTOTPSecret(userId);
    if (!secret) {
        return { success: false, error: '2FA is not enabled.' };
    }

    // Verify the code (backup codes NOT allowed for disabling)
    if (!verifyTOTPCode(secret, code)) {
        return {
            success: false,
            error: 'Invalid code. Backup codes cannot be used to disable 2FA.',
        };
    }

    // Delete 2FA settings
    const { error: deleteError } = await supabase
        .from('user_2fa')
        .delete()
        .eq('user_id', userId);

    if (deleteError) {
        return { success: false, error: deleteError.message };
    }

    // Delete all backup codes
    await supabase.from('backup_codes').delete().eq('user_id', userId);

    return { success: true };
}

/**
 * Toggles vault 2FA requirement
 * @param userId - User ID
 * @param enabled - Whether to require 2FA for vault unlock
 * @returns Success status
 */
export async function setVaultTwoFactor(
    userId: string,
    enabled: boolean
): Promise<{ success: boolean; error?: string }> {
    const { error } = await supabase
        .from('user_2fa')
        .update({ vault_2fa_enabled: enabled })
        .eq('user_id', userId)
        .eq('is_enabled', true);

    if (error) {
        return { success: false, error: error.message };
    }

    return { success: true };
}

/**
 * Regenerates backup codes (deletes old ones)
 * @param userId - User ID
 * @returns New backup codes or error
 */
export async function regenerateBackupCodes(
    userId: string
): Promise<{ success: boolean; codes?: string[]; error?: string }> {
    // Check if 2FA is enabled
    const status = await get2FAStatus(userId);
    if (!status?.isEnabled) {
        return { success: false, error: '2FA is not enabled.' };
    }

    // Delete old backup codes
    await supabase.from('backup_codes').delete().eq('user_id', userId);

    // Generate new codes
    const newCodes = generateBackupCodes();

    // Store hashed codes
    const hashedCodes = await Promise.all(
        newCodes.map(async (code) => ({
            user_id: userId,
            code_hash: await hashBackupCode(code),
        }))
    );

    const { error } = await supabase.from('backup_codes').insert(hashedCodes);

    if (error) {
        return { success: false, error: error.message };
    }

    return { success: true, codes: newCodes };
}

/**
 * Verifies 2FA for login (either TOTP or backup code)
 * @param userId - User ID
 * @param code - Code to verify
 * @param isBackupCode - Whether this is a backup code
 * @returns Whether verification succeeded
 */
export async function verifyTwoFactorForLogin(
    userId: string,
    code: string,
    isBackupCode: boolean
): Promise<boolean> {
    if (isBackupCode) {
        return await verifyAndConsumeBackupCode(userId, code);
    }

    const secret = await getTOTPSecret(userId);
    if (!secret) {
        return false;
    }

    const isValid = verifyTOTPCode(secret, code);

    if (isValid) {
        // Update last verified timestamp
        await supabase
            .from('user_2fa')
            .update({ last_verified_at: new Date().toISOString() })
            .eq('user_id', userId);
    }

    return isValid;
}
