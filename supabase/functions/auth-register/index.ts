// Copyright (c) 2025-2026 Maunting Studios
// Licensed under the Business Source License 1.1 — see LICENSE

/**
 * @fileoverview OPAQUE Registration Edge Function
 *
 * Diese Edge Function implementiert die Benutzerregistrierung mit dem OPAQUE-Protokoll.
 * OPAQUE ist ein asymmetrisches Password-Authenticated Key Exchange (PAKE) Protokoll,
 * bei dem das Passwort NIEMALS den Server erreicht - nicht einmal als Hash.
 *
 * ## Warum OPAQUE statt klassischem Passwort-Hash?
 *
 * Bei klassischer Registrierung:
 * 1. Client sendet Passwort (oder Hash) an Server
 * 2. Server hasht (erneut) und speichert
 * 3. Problem: Server sieht das Passwort temporär im Klartext/Hash
 *
 * Bei OPAQUE:
 * 1. Client berechnet lokalen "Registration Request" aus Passwort
 * 2. Server antwortet mit "Registration Response" (ohne Passwort-Kenntnis)
 * 3. Client berechnet "Registration Record" und sendet an Server
 * 4. Server speichert Record, kann aber daraus KEIN Passwort ableiten
 *
 * ## Zwei-Phasen-Registrierung
 *
 * ### Phase 1: `start` (handleRegistrationStart)
 * - Validiert E-Mail und prüft auf Duplikate
 * - Erstellt GoTrue-User mit zufälligem, unbrauchbarem Passwort
 * - Generiert OPAQUE Registration Response
 * - Sendet Verifizierungs-E-Mail (OTP)
 * - Speichert Challenge mit 15 Min. TTL
 *
 * ### Phase 2: `finish` (handleRegistrationFinish)
 * - Konsumiert Challenge (einmalig verwendbar)
 * - Speichert OPAQUE Registration Record
 * - Deaktiviert GoTrue-Passwort-Login (nur OPAQUE erlaubt)
 *
 * ## Aufruf aus dem Frontend
 *
 * Aufgerufen via `invokeAuthedFunction('auth-register', {...})` aus:
 * - `src/services/opaqueService.ts` - `startRegistration()` und `finishRegistration()`
 * - Registrierungsformular in `src/pages/Auth.tsx`
 *
 * ## Sicherheitsmaßnahmen
 *
 * - Rate-Limiting: Max. Registrierungsversuche pro E-Mail/IP
 * - E-Mail-Verifizierung: OTP-Code vor Abschluss erforderlich
 * - Rollback: Bei Fehlern werden erstellte User/Challenges gelöscht
 * - Log-Redaktion: E-Mail-Adressen werden in Logs maskiert
 *
 * ## Datenbankstruktur
 *
 * Tabellen:
 * - `user_opaque_records`: Speichert Registration Records
 * - `opaque_registration_challenges`: Temporäre Challenges (15 Min. TTL)
 * - `profiles`: Benutzerprofile mit `auth_protocol: 'opaque'`
 *
 * @see src/services/opaqueService.ts - Frontend OPAQUE-Client
 * @see _shared/opaqueAuth.ts - Shared OPAQUE-Utilities
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import * as opaque from "npm:@serenity-kit/opaque";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import {
    authRateLimitResponse,
    checkAuthRateLimit,
    recordAuthRateLimitFailure,
    resetAuthRateLimit,
} from "../_shared/authRateLimit.ts";
import {
    createUnusableGotruePassword,
    isValidOpaqueIdentifier,
    normalizeOpaqueIdentifier,
} from "../_shared/opaqueAuth.ts";
import { AUTH_ERROR_CODES, isUniqueViolation, jsonError } from "../_shared/authErrors.ts";

// ============================================================================
// Konfiguration
// ============================================================================

/**
 * Supabase-URL aus Umgebungsvariablen.
 */
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;

/**
 * Service Role Key für Admin-Operationen.
 * ACHTUNG: Umgeht RLS - nur für User-Erstellung und Record-Speicherung verwenden!
 */
const supabaseServiceKey = Deno.env.get("SUPABASE_INTERNAL_SECRET_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

/**
 * Anonymer Schlüssel für OTP-Versand via Supabase Auth.
 */
const supabaseAnonKey = Deno.env.get("SUPABASE_INTERNAL_PUBLISHABLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY")!;

/**
 * OPAQUE Server Setup - kryptografische Serverkonfiguration.
 * Wird bei Server-Initialisierung einmalig generiert und muss geheim bleiben.
 */
const OPAQUE_SERVER_SETUP = Deno.env.get("OPAQUE_SERVER_SETUP")!;

/**
 * Admin-Client für Datenbankoperationen mit vollen Rechten.
 */
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

/**
 * Initialisiert die OPAQUE-Bibliothek (WASM-basiert).
 * Muss vor Verwendung der OPAQUE-Funktionen abgeschlossen sein.
 */
await opaque.ready;

// ============================================================================
// Request Handler
// ============================================================================

/**
 * Haupteinstiegspunkt der Edge Function.
 *
 * Routet basierend auf `action`-Feld:
 * - `start` oder ohne action: Startet Registrierung
 * - `finish`: Schließt Registrierung ab
 */
Deno.serve(async (req) => {
    const corsHeaders = getCorsHeaders(req);
    const headers = new Headers({
        ...corsHeaders,
        "Content-Type": "application/json",
    });

    if (req.method === "OPTIONS") {
        return new Response("ok", { headers });
    }

    if (req.method !== "POST") {
        return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers });
    }

    try {
        const body = await req.json();
        const action = typeof body.action === "string" ? body.action : "start";

        if (action === "finish") {
            return await handleRegistrationFinish(req, body, headers);
        }

        return await handleRegistrationStart(req, body, headers);
    } catch (err) {
        console.error("Auth Register Error:", err);
        return new Response(JSON.stringify({ error: "Internal Server Error" }), { status: 500, headers });
    }
});

// ============================================================================
// Handler-Funktionen
// ============================================================================

/**
 * Startet die OPAQUE-Registrierung (Phase 1).
 *
 * Workflow:
 * 1. Validiert E-Mail-Format und Registrierungsrequest
 * 2. Prüft Rate-Limits (opaque_register Action)
 * 3. Prüft ob E-Mail bereits verwendet (GoTrue + OPAQUE)
 * 4. Erstellt GoTrue-User mit zufälligem Passwort
 * 5. Generiert OPAQUE Registration Response
 * 6. Erstellt Challenge in DB (15 Min. gültig)
 * 7. Sendet Verifizierungs-E-Mail
 *
 * @param req - Original-Request (für Rate-Limiting)
 * @param body - Request-Body mit `email` und `registrationRequest`
 * @param headers - Response-Headers
 * @returns JSON mit `registrationId`, `registrationResponse`, `expiresAt`
 */
async function handleRegistrationStart(
    req: Request,
    body: { email?: unknown; registrationRequest?: unknown },
    headers: Headers,
): Promise<Response> {
    const email = normalizeOpaqueIdentifier(body.email);
    const registrationRequest = typeof body.registrationRequest === "string" ? body.registrationRequest : "";

    if (!isValidOpaqueIdentifier(email) || !registrationRequest) {
        return new Response(JSON.stringify({ error: "Invalid input" }), { status: 400, headers });
    }

    const { data: registrationOpen, error: registrationPolicyError } =
        await supabaseAdmin.rpc("is_public_registration_open");
    if (registrationPolicyError || registrationOpen !== true) {
        return jsonError(
            AUTH_ERROR_CODES.REGISTRATION_CLOSED,
            "Registration is currently closed",
            403,
            headers,
        );
    }

    const registerRateLimit = await checkAuthRateLimit({
        supabaseAdmin,
        req,
        action: "opaque_register",
        account: { kind: "email", value: email },
    });
    if (!registerRateLimit.allowed) {
        return authRateLimitResponse(registerRateLimit, headers);
    }

    const registerFailure = await recordAuthRateLimitFailure(registerRateLimit);
    if (registerFailure.lockedUntil) {
        return authRateLimitResponse({
            status: 429,
            error: "Too many attempts",
            attemptsRemaining: registerFailure.attemptsRemaining,
            lockedUntil: registerFailure.lockedUntil,
            retryAfterSeconds: registerFailure.retryAfterSeconds,
        }, headers);
    }

    const { data: existingUsers } = await supabaseAdmin.rpc("get_user_id_by_email", { p_email: email });
    const existingUserId = Array.isArray(existingUsers) && existingUsers.length > 0
        ? existingUsers[0].id as string
        : null;

    const { data: existingOpaqueRecord, error: opaqueLookupError } = await supabaseAdmin
        .from("user_opaque_records")
        .select("user_id")
        .eq("opaque_identifier", email)
        .maybeSingle();
    if (opaqueLookupError) {
        console.error("Failed to check OPAQUE registration identifier:", sanitizeAuthError(opaqueLookupError));
        return jsonError(
            AUTH_ERROR_CODES.OPAQUE_REGISTRATION_FAILED,
            "Registration failed",
            500,
            headers,
        );
    }
    if (existingOpaqueRecord) {
        return createDecoyRegistrationStart(email, registrationRequest, headers);
    }

    if (existingUserId) {
        const [{ data: existingAuthUser }, { data: pendingChallenge }] = await Promise.all([
            supabaseAdmin.auth.admin.getUserById(existingUserId),
            supabaseAdmin
                .from("opaque_registration_challenges")
                .select("id")
                .eq("user_id", existingUserId)
                .eq("email", email)
                .eq("purpose", "signup")
                .is("consumed_at", null)
                .gt("expires_at", new Date().toISOString())
                .maybeSingle(),
        ]);
        const canRestartPendingSignup =
            existingAuthUser.user !== null
            && normalizeOpaqueIdentifier(existingAuthUser.user.email) === email
            && existingAuthUser.user.email_confirmed_at === null
            && existingAuthUser.user.app_metadata?.signup_origin === "opaque"
            && pendingChallenge !== null;

        if (!canRestartPendingSignup) {
            return createDecoyRegistrationStart(email, registrationRequest, headers);
        }

        const { error: deletePendingUserError } =
            await supabaseAdmin.auth.admin.deleteUser(existingUserId);
        if (deletePendingUserError) {
            console.error(
                "Failed to restart pending OPAQUE signup:",
                sanitizeAuthError(deletePendingUserError),
            );
            return createDecoyRegistrationStart(email, registrationRequest, headers);
        }
    }

    let userId: string;
    try {
        userId = await createOpaqueOnlyUser(email);
    } catch (error) {
        console.error("Failed to create OPAQUE-only auth user:", sanitizeAuthError(error));
        return jsonError(
            AUTH_ERROR_CODES.OPAQUE_REGISTRATION_FAILED,
            "Registration failed",
            500,
            headers,
        );
    }

    const registrationResponse = opaque.server.createRegistrationResponse({
        serverSetup: OPAQUE_SERVER_SETUP,
        userIdentifier: email,
        registrationRequest,
    }).registrationResponse;

    const registrationId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const { error: challengeError } = await supabaseAdmin
        .from("opaque_registration_challenges")
        .insert({
            id: registrationId,
            user_id: userId,
            email,
            purpose: "signup",
            expires_at: expiresAt,
        });

    if (challengeError) {
        await supabaseAdmin.auth.admin.deleteUser(userId).catch(() => undefined);
        throw challengeError;
    }

    try {
        await sendSignupOtp(email);
    } catch (error) {
        console.error("Failed to send signup verification code:", sanitizeAuthError(error));
        await rollbackRegistrationStart(userId, registrationId);
        return jsonError(
            AUTH_ERROR_CODES.OPAQUE_REGISTRATION_FAILED,
            "Registration failed",
            502,
            headers,
        );
    }

    return new Response(JSON.stringify({
        success: true,
        registrationId,
        registrationResponse,
        expiresAt,
    }), { status: 200, headers });
}

/**
 * Schließt die OPAQUE-Registrierung ab (Phase 2).
 *
 * Workflow:
 * 1. Validiert Eingaben
 * 2. Verifiziert den Supabase-Signup-OTP
 * 3. Finalisiert Challenge, OPAQUE-Record und GoTrue-Deaktivierung atomar
 *
 * WICHTIG: Nach diesem Schritt kann sich der User NUR noch via OPAQUE
 * authentifizieren, nicht mehr mit GoTrue-Passwort.
 *
 * @param body - Request-Body mit `email`, `registrationId`, `registrationRecord`, `verificationCode`
 * @param headers - Response-Headers
 * @returns JSON mit `success: true` bei Erfolg
 */
async function handleRegistrationFinish(
    req: Request,
    body: {
        email?: unknown;
        registrationId?: unknown;
        registrationRecord?: unknown;
        verificationCode?: unknown;
    },
    headers: Headers,
): Promise<Response> {
    const email = normalizeOpaqueIdentifier(body.email);
    const registrationId = typeof body.registrationId === "string" ? body.registrationId : "";
    const registrationRecord = typeof body.registrationRecord === "string" ? body.registrationRecord : "";
    const verificationCode = typeof body.verificationCode === "string" ? body.verificationCode.trim() : "";

    if (
        !isValidOpaqueIdentifier(email)
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(registrationId)
        || !registrationRecord
        || !/^\d{6}$/.test(verificationCode)
    ) {
        return new Response(JSON.stringify({ error: "Invalid input" }), { status: 400, headers });
    }

    const { data: pendingChallenge, error: challengeError } = await supabaseAdmin
        .from("opaque_registration_challenges")
        .select("user_id, email, purpose")
        .eq("id", registrationId)
        .in("purpose", ["signup", "signup-decoy"])
        .is("consumed_at", null)
        .gt("expires_at", new Date().toISOString())
        .maybeSingle();

    if (challengeError || !pendingChallenge) {
        return jsonError(
            AUTH_ERROR_CODES.AUTH_INVALID_OR_EXPIRED_CODE,
            "Invalid or expired code",
            401,
            headers,
        );
    }

    const verifyAccount = pendingChallenge.purpose === "signup"
        ? { kind: "email" as const, value: pendingChallenge.email }
        : { kind: "email" as const, value: `signup-decoy:${registrationId}` };
    const verifyRateLimit = await checkAuthRateLimit({
        supabaseAdmin,
        req,
        action: "opaque_register_verify",
        account: verifyAccount,
    });
    if (!verifyRateLimit.allowed) {
        return authRateLimitResponse(verifyRateLimit, headers);
    }

    if (
        pendingChallenge.purpose !== "signup"
        || !pendingChallenge.user_id
        || normalizeOpaqueIdentifier(pendingChallenge.email) !== email
    ) {
        await recordAuthRateLimitFailure(verifyRateLimit);
        return jsonError(
            AUTH_ERROR_CODES.AUTH_INVALID_OR_EXPIRED_CODE,
            "Invalid or expired code",
            401,
            headers,
        );
    }

    const verificationClient = createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false,
        },
    });
    const { data: otpData, error: otpError } = await verificationClient.auth.verifyOtp({
        email,
        token: verificationCode,
        type: "signup",
    });

    const verifiedUser = otpData.user;
    if (
        otpError
        || !verifiedUser
        || verifiedUser.id !== pendingChallenge.user_id
        || !verifiedUser.email_confirmed_at
    ) {
        await recordAuthRateLimitFailure(verifyRateLimit);
        return jsonError(
            AUTH_ERROR_CODES.AUTH_INVALID_OR_EXPIRED_CODE,
            "Invalid or expired code",
            401,
            headers,
        );
    }

    await resetAuthRateLimit(verifyRateLimit);
    const startRateLimit = await checkAuthRateLimit({
        supabaseAdmin,
        req,
        action: "opaque_register",
        account: { kind: "email", value: pendingChallenge.email },
    });
    await resetAuthRateLimit(startRateLimit);

    const { error: finalizeError } = await supabaseAdmin.rpc("finish_opaque_signup", {
        p_registration_id: registrationId,
        p_user_id: verifiedUser.id,
        p_email: email,
        p_registration_record: registrationRecord,
    });

    if (finalizeError) {
        const { data: finalizedRecord } = await supabaseAdmin
            .from("user_opaque_records")
            .select("user_id")
            .eq("user_id", verifiedUser.id)
            .eq("opaque_identifier", email)
            .eq("registration_record", registrationRecord)
            .maybeSingle();
        if (finalizedRecord?.user_id === verifiedUser.id) {
            return new Response(JSON.stringify({ success: true }), { status: 200, headers });
        }

        console.error("Failed to finalize OPAQUE signup:", sanitizeAuthError(finalizeError));
        return jsonError(
            isUniqueViolation(finalizeError)
                ? AUTH_ERROR_CODES.OPAQUE_RECORD_CONFLICT
                : AUTH_ERROR_CODES.OPAQUE_REGISTRATION_FAILED,
            isUniqueViolation(finalizeError) ? "Account already exists" : "Registration failed",
            isUniqueViolation(finalizeError) ? 409 : 500,
            headers,
        );
    }

    return new Response(JSON.stringify({ success: true }), { status: 200, headers });
}

function sanitizeAuthError(error: unknown): Record<string, unknown> {
    const candidate = error as { code?: unknown; message?: unknown; name?: unknown } | null;
    return {
        code: typeof candidate?.code === "string" ? candidate.code : undefined,
        name: typeof candidate?.name === "string" ? candidate.name : undefined,
        message: redactSensitiveLogText(typeof candidate?.message === "string" ? candidate.message : String(error)),
    };
}

function redactSensitiveLogText(value: string): string {
    return value.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]");
}

async function createOpaqueOnlyUser(email: string): Promise<string> {
    const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email,
        password: createUnusableGotruePassword(),
        email_confirm: false,
        app_metadata: { signup_origin: "opaque" },
    });

    if (createError || !newUser.user?.id) {
        throw createError ?? new Error("User creation failed");
    }

    return newUser.user.id;
}

async function createDecoyRegistrationStart(
    email: string,
    registrationRequest: string,
    headers: Headers,
): Promise<Response> {
    const registrationResponse = opaque.server.createRegistrationResponse({
        serverSetup: OPAQUE_SERVER_SETUP,
        userIdentifier: email,
        registrationRequest,
    }).registrationResponse;
    const registrationId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const { error } = await supabaseAdmin
        .from("opaque_registration_challenges")
        .insert({
            id: registrationId,
            user_id: null,
            email: "signup-decoy@example.invalid",
            purpose: "signup-decoy",
            expires_at: expiresAt,
        });
    if (error) {
        console.error("Failed to create OPAQUE registration decoy:", sanitizeAuthError(error));
        return jsonError(
            AUTH_ERROR_CODES.OPAQUE_REGISTRATION_FAILED,
            "Registration failed",
            500,
            headers,
        );
    }

    return new Response(JSON.stringify({
        success: true,
        registrationId,
        registrationResponse,
        expiresAt,
    }), { status: 200, headers });
}

async function sendSignupOtp(email: string): Promise<void> {
    const anonClient = createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
            persistSession: false,
            autoRefreshToken: false,
        },
    });
    const { error } = await anonClient.auth.resend({
        type: "signup",
        email,
        options: {
            emailRedirectTo: Deno.env.get("SITE_URL") || "https://singravault.mauntingstudios.de/auth",
        },
    });

    if (error) {
        throw new Error(error.message || "Failed to trigger signup OTP email");
    }
}

async function rollbackRegistrationStart(userId: string, registrationId: string): Promise<void> {
    const [challengeCleanup, userCleanup] = await Promise.allSettled([
        supabaseAdmin
            .from("opaque_registration_challenges")
            .delete()
            .eq("id", registrationId),
        supabaseAdmin.auth.admin.deleteUser(userId),
    ]);

    if (challengeCleanup.status === "rejected") {
        console.error("Failed to delete signup registration challenge after OTP send failure:", challengeCleanup.reason);
    }
    if (userCleanup.status === "rejected") {
        console.error("Failed to delete signup auth user after OTP send failure:", userCleanup.reason);
    }
}
