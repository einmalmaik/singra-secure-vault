// Copyright (c) 2025-2026 Maunting Studios
// Licensed under the Business Source License 1.1 — see LICENSE
/**
 * @fileoverview TOTP (Time-based One-Time Password) Service
 * 
 * Implements RFC 6238 TOTP generation for 2FA codes.
 * Uses the otpauth library for reliable OTP handling.
 */

import * as OTPAuth from 'otpauth';

/**
 * Generates a TOTP code from a secret
 * 
 * @param secret - Base32 encoded TOTP secret
 * @returns Current 6-digit TOTP code
 */
export function generateTOTP(secret: string): string {
    try {
        const totp = new OTPAuth.TOTP({
            issuer: 'Singra PW',
            algorithm: 'SHA1',
            digits: 6,
            period: 30,
            secret: OTPAuth.Secret.fromBase32(secret.replace(/\s/g, '').toUpperCase()),
        });

        return totp.generate();
    } catch (error) {
        console.error('TOTP generation error:', error);
        return '------';
    }
}

/**
 * Gets the remaining seconds until the next TOTP period
 * 
 * @returns Seconds remaining (0-29)
 */
export function getTimeRemaining(): number {
    const now = Math.floor(Date.now() / 1000);
    return 30 - (now % 30);
}

/**
 * Validates a TOTP secret format
 * 
 * @param secret - Secret to validate
 * @returns true if the secret is valid Base32
 */
export function isValidTOTPSecret(secret: string): boolean {
    // Remove spaces and convert to uppercase
    const cleanSecret = secret.replace(/\s/g, '').toUpperCase();

    // Check if it's valid Base32 (A-Z and 2-7)
    const base32Regex = /^[A-Z2-7]+=*$/;

    if (!base32Regex.test(cleanSecret)) {
        return false;
    }

    // Should be at least 16 characters for security
    return cleanSecret.length >= 16;
}

/**
 * Validates a TOTP secret with detailed error messages
 * 
 * @param secret - Secret to validate
 * @returns Validation result with error message if invalid
 */
export function validateTOTPSecret(secret: string): { valid: boolean; error?: string } {
    // Remove spaces and convert to uppercase
    const cleaned = secret.replace(/\s/g, '').toUpperCase();

    // Check length
    if (cleaned.length < 16) {
        return { valid: false, error: 'Secret zu kurz (mindestens 16 Zeichen)' };
    }

    // Check Base32 format (A-Z, 2-7, optional padding =)
    if (!/^[A-Z2-7]+=*$/.test(cleaned)) {
        return { valid: false, error: 'Ungültiges Format (nur A-Z und 2-7 erlaubt)' };
    }

    return { valid: true };
}

/**
 * Parses an otpauth:// URI and extracts TOTP information
 * 
 * @param uri - otpauth:// URI from QR code
 * @returns Parsed data with secret, issuer, and label, or null if invalid
 */
export function parseOTPAuthUri(uri: string): {
    secret: string;
    issuer?: string;
    label?: string;
} | null {
    try {
        const url = new URL(uri);

        if (url.protocol !== 'otpauth:' || url.host !== 'totp') {
            return null;
        }

        const secret = url.searchParams.get('secret');
        if (!secret) return null;

        const issuer = url.searchParams.get('issuer') || undefined;
        const label = decodeURIComponent(url.pathname.slice(1)) || undefined;

        return { secret: secret.toUpperCase(), issuer, label };
    } catch {
        return null;
    }
}

/**
 * Formats a TOTP code for display (adds space in middle)
 * 
 * @param code - 6-digit code
 * @returns Formatted code like "123 456"
 */
export function formatTOTPCode(code: string): string {
    if (code.length !== 6) return code;
    return `${code.slice(0, 3)} ${code.slice(3)}`;
}

/**
 * Parses a TOTP URI (otpauth://totp/...) and extracts the secret
 * 
 * @param uri - TOTP URI from QR code
 * @returns Parsed TOTP data or null if invalid
 */
export function parseTOTPUri(uri: string): TOTPData | null {
    try {
        const url = new URL(uri);

        if (url.protocol !== 'otpauth:' || url.host !== 'totp') {
            return null;
        }

        const secret = url.searchParams.get('secret');
        if (!secret) return null;

        // Extract label (issuer:account or just account)
        const label = decodeURIComponent(url.pathname.slice(1));
        const issuer = url.searchParams.get('issuer') || '';

        return {
            secret: secret.toUpperCase(),
            label,
            issuer,
            algorithm: url.searchParams.get('algorithm') || 'SHA1',
            digits: parseInt(url.searchParams.get('digits') || '6', 10),
            period: parseInt(url.searchParams.get('period') || '30', 10),
        };
    } catch {
        return null;
    }
}

/**
 * Generates a TOTP URI for QR code display
 * 
 * @param data - TOTP configuration data
 * @returns otpauth:// URI
 */
export function generateTOTPUri(data: TOTPData): string {
    const totp = new OTPAuth.TOTP({
        issuer: data.issuer,
        label: data.label,
        algorithm: data.algorithm || 'SHA1',
        digits: data.digits || 6,
        period: data.period || 30,
        secret: OTPAuth.Secret.fromBase32(data.secret),
    });

    return totp.toString();
}

// ============ Type Definitions ============

export interface TOTPData {
    secret: string;
    label: string;
    issuer: string;
    algorithm?: string;
    digits?: number;
    period?: number;
}
