// Copyright (c) 2025-2026 Maunting Studios
// Licensed under the Business Source License 1.1 — see LICENSE
/**
 * @fileoverview Authenticated Edge Function invocation helper.
 *
 * Ensures every invocation carries a user JWT and normalizes HTTP
 * errors from Supabase Functions into a stable error shape.
 */

import { supabase } from '@/integrations/supabase/client';

// ============ Public API ============

/**
 * Invokes a Supabase Edge Function with an explicit user access token.
 *
 * @param functionName - Edge Function slug
 * @param body - JSON payload sent to the function
 * @returns Parsed function response payload
 * @throws EdgeFunctionServiceError when auth/session/function call fails
 */
export async function invokeAuthedFunction<
    TResponse,
    TBody extends Record<string, unknown> = Record<string, unknown>,
>(
    functionName: string,
    body?: TBody,
): Promise<TResponse> {
    const accessToken = await resolveAccessToken();
    if (!accessToken) {
        throw createEdgeFunctionError('Authentication required', 'AUTH_REQUIRED', 401);
    }

    const config = getSupabaseFunctionConfig();
    if (!config) {
        throw createEdgeFunctionError(
            'Supabase configuration missing',
            'UNKNOWN',
            500,
            {
                hasUrl: Boolean(import.meta.env.VITE_SUPABASE_URL),
                hasPublishableKey: Boolean(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY),
            },
        );
    }

    const endpoint = `${config.url}/functions/v1/${functionName}`;
    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            apikey: config.publishableKey,
            Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(body || {}),
    });

    if (!response.ok) {
        throw await normalizeHttpResponseError(response);
    }

    const payload = await readResponsePayload(response);
    return (payload || null) as TResponse;
}

/**
 * Type guard for normalized edge function errors.
 *
 * @param error - Unknown thrown value
 * @returns True when error was normalized by this service
 */
export function isEdgeFunctionServiceError(error: unknown): error is EdgeFunctionServiceError {
    if (!(error instanceof Error)) {
        return false;
    }

    return error.name === 'EdgeFunctionServiceError';
}

// ============ Internal Helpers ============

async function resolveAccessToken(): Promise<string | null> {
    const {
        data: { session },
        error: sessionError,
    } = await supabase.auth.getSession();

    if (sessionError) {
        throw createEdgeFunctionError(
            'Failed to load session',
            'UNKNOWN',
            401,
            { sessionError: sessionError.message },
        );
    }

    if (isUsableUserAccessToken(session)) {
        return session.access_token;
    }

    const {
        data: refreshData,
        error: refreshError,
    } = await supabase.auth.refreshSession();

    if (refreshError) {
        // Fallback: trigger Supabase auth re-hydration from persisted session.
        // getUser() can recover a valid user-bound access token after app reload.
        const { error: userError } = await supabase.auth.getUser();
        if (userError) {
            return null;
        }

        const {
            data: { session: hydratedSession },
            error: hydratedSessionError,
        } = await supabase.auth.getSession();

        if (hydratedSessionError) {
            throw createEdgeFunctionError(
                'Failed to load session',
                'UNKNOWN',
                401,
                { sessionError: hydratedSessionError.message },
            );
        }

        return isUsableUserAccessToken(hydratedSession)
            ? hydratedSession.access_token
            : null;
    }

    return isUsableUserAccessToken(refreshData.session)
        ? refreshData.session.access_token
        : null;
}

function isUsableUserAccessToken(
    session: {
        access_token?: string | null;
        user?: { id?: string | null } | null;
    } | null | undefined,
): session is { access_token: string; user: { id: string } } {
    const token = session?.access_token;
    if (!token || token.split('.').length !== 3) {
        return false;
    }

    const payload = decodeJwtPayload(token);
    if (!payload) {
        return false;
    }

    const tokenSubject = payload.sub;
    const tokenRole = payload.role;
    const tokenExpiry = payload.exp;
    const sessionUserId = session?.user?.id;

    if (typeof sessionUserId !== 'string' || sessionUserId.length === 0) {
        return false;
    }

    if (typeof tokenSubject !== 'string' || tokenSubject.length === 0 || tokenSubject !== sessionUserId) {
        return false;
    }

    if (tokenRole === 'anon') {
        return false;
    }

    if (typeof tokenExpiry !== 'number' || !Number.isFinite(tokenExpiry)) {
        return false;
    }

    const nowInSeconds = Math.floor(Date.now() / 1000);
    const EXPIRY_SKEW_SECONDS = 30;
    if (tokenExpiry <= nowInSeconds + EXPIRY_SKEW_SECONDS) {
        return false;
    }

    return true;
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
    const parts = token.split('.');
    if (parts.length !== 3) {
        return null;
    }

    try {
        const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
        const decoded = atob(padded);
        const payload = JSON.parse(decoded);
        return payload && typeof payload === 'object'
            ? payload as Record<string, unknown>
            : null;
    } catch {
        return null;
    }
}

async function normalizeHttpResponseError(response: Response): Promise<EdgeFunctionServiceError> {
    const payload = await readResponsePayload(response);
    const payloadMessage = extractPayloadMessage(payload);
    const code = mapStatusToCode(response.status);

    const message = code === 'AUTH_REQUIRED'
        ? 'Authentication required'
        : code === 'FORBIDDEN'
            ? 'Forbidden'
            : code === 'SERVER_ERROR'
                ? 'Internal server error'
                : payloadMessage || 'Edge function request failed';

    return createEdgeFunctionError(
        message,
        code,
        response.status,
        payload || undefined,
    );
}

async function readResponsePayload(response: Response): Promise<Record<string, unknown> | null> {
    try {
        const clonedResponse = response.clone();
        const contentType = clonedResponse.headers.get('content-type') || '';

        if (contentType.includes('application/json')) {
            const json = await clonedResponse.json();
            if (json && typeof json === 'object') {
                return json as Record<string, unknown>;
            }
            return null;
        }

        const text = await clonedResponse.text();
        return text ? { message: text } : null;
    } catch {
        return null;
    }
}

function extractPayloadMessage(payload: Record<string, unknown> | null): string | null {
    if (!payload) {
        return null;
    }

    const errorMessage = payload.error;
    if (typeof errorMessage === 'string' && errorMessage.trim().length > 0) {
        return errorMessage;
    }

    const message = payload.message;
    if (typeof message === 'string' && message.trim().length > 0) {
        return message;
    }

    return null;
}

function mapStatusToCode(status?: number): EdgeFunctionErrorCode {
    if (status === 400) return 'BAD_REQUEST';
    if (status === 401) return 'AUTH_REQUIRED';
    if (status === 403) return 'FORBIDDEN';
    if (typeof status === 'number' && status >= 500) return 'SERVER_ERROR';
    return 'UNKNOWN';
}

function getSupabaseFunctionConfig(): { url: string; publishableKey: string } | null {
    const url = import.meta.env.VITE_SUPABASE_URL;
    const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

    if (!url || !publishableKey) {
        return null;
    }

    return { url, publishableKey };
}

function createEdgeFunctionError(
    message: string,
    code: EdgeFunctionErrorCode,
    status?: number,
    details?: Record<string, unknown>,
): EdgeFunctionServiceError {
    const error = new Error(message) as EdgeFunctionServiceError;
    error.name = 'EdgeFunctionServiceError';
    error.code = code;
    error.status = status;
    error.details = details;
    return error;
}

// ============ Type Definitions ============

export type EdgeFunctionErrorCode =
    | 'AUTH_REQUIRED'
    | 'FORBIDDEN'
    | 'BAD_REQUEST'
    | 'SERVER_ERROR'
    | 'UNKNOWN';

export interface EdgeFunctionServiceError extends Error {
    code: EdgeFunctionErrorCode;
    details?: Record<string, unknown>;
    status?: number;
}
