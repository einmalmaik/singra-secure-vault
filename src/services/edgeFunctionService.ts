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

    const { data, error } = await supabase.functions.invoke(functionName, {
        body: body || {},
        headers: {
            Authorization: `Bearer ${accessToken}`,
        },
    });

    if (error) {
        throw await normalizeFunctionError(error);
    }

    return data as TResponse;
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

    if (isUserAccessToken(session?.access_token)) {
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

        return isUserAccessToken(hydratedSession?.access_token)
            ? hydratedSession.access_token
            : null;
    }

    return isUserAccessToken(refreshData.session?.access_token)
        ? refreshData.session.access_token
        : null;
}

function isUserAccessToken(token: string | null | undefined): token is string {
    if (!token || token.split('.').length !== 3) {
        return false;
    }

    const payload = decodeJwtPayload(token);
    if (!payload || typeof payload.sub !== 'string' || payload.sub.length === 0) {
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

async function normalizeFunctionError(error: unknown): Promise<EdgeFunctionServiceError> {
    const fallbackMessage = extractErrorMessage(error) || 'Edge function request failed';

    const httpContext = getHttpErrorContext(error);
    if (!httpContext) {
        return createEdgeFunctionError(fallbackMessage, 'UNKNOWN');
    }

    const status = httpContext.status;
    const payload = await readResponsePayload(httpContext);
    const payloadMessage = extractPayloadMessage(payload);
    const code = mapStatusToCode(status);

    const message = code === 'AUTH_REQUIRED'
        ? 'Authentication required'
        : code === 'FORBIDDEN'
            ? 'Forbidden'
            : code === 'SERVER_ERROR'
                ? 'Internal server error'
                : payloadMessage || fallbackMessage;

    return createEdgeFunctionError(message, code, status, payload || undefined);
}

function extractErrorMessage(error: unknown): string | null {
    if (error instanceof Error && error.message.trim().length > 0) {
        return error.message;
    }

    if (error && typeof error === 'object') {
        const maybeMessage = (error as { message?: unknown }).message;
        if (typeof maybeMessage === 'string' && maybeMessage.trim().length > 0) {
            return maybeMessage;
        }
    }

    return null;
}

function getHttpErrorContext(error: unknown): Response | null {
    if (!error || typeof error !== 'object') {
        return null;
    }

    const maybeContext = (error as { context?: unknown }).context;
    if (typeof Response === 'undefined' || !(maybeContext instanceof Response)) {
        return null;
    }

    return maybeContext;
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
