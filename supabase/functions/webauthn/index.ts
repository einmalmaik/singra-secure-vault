/**
 * @fileoverview WebAuthn Edge Function for Passkey Registration & Authentication
 *
 * Handles all WebAuthn server-side operations:
 *   - generate-registration-options: Creates a challenge for passkey registration
 *   - verify-registration: Verifies the registration response from the browser
 *   - generate-authentication-options: Creates a challenge for passkey authentication
 *   - verify-authentication: Verifies the authentication response
 *   - list-credentials: Lists all registered passkeys for a user
 *   - delete-credential: Removes a registered passkey
 *
 * Uses @simplewebauthn/server v13 via JSR for Deno compatibility.
 *
 * SECURITY: All operations require a valid Supabase JWT.
 * Challenge storage is server-side with 5-minute TTL.
 * PRF salt is generated server-side with CSPRNG.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
    generateRegistrationOptions,
    verifyRegistrationResponse,
    generateAuthenticationOptions,
    verifyAuthenticationResponse,
} from "jsr:@simplewebauthn/server@13.2.2";
import { isoBase64URL } from "jsr:@simplewebauthn/server@13.2.2/helpers";
import type {
    RegistrationResponseJSON,
    AuthenticationResponseJSON,
} from "jsr:@simplewebauthn/server@13.2.2";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getCorsHeaders } from "../_shared/cors.ts";

// ============ Configuration ============

/**
 * Relying Party configuration.
 * rpID must match the domain the user is on.
 * In production this is "singra.pw", in dev "localhost".
 */
function getRpConfig(req: Request): { rpName: string; rpID: string; origin: string } {
    const origin = req.headers.get("origin") || Deno.env.get("SITE_URL") || "http://localhost:8080";
    const url = new URL(origin);
    return {
        rpName: "SingraPW",
        rpID: url.hostname,
        origin: origin,
    };
}

// ============ Main Handler ============

Deno.serve(async (req: Request) => {
    const corsHeaders = getCorsHeaders(req);

    // Handle CORS preflight
    if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (req.method !== "POST") {
        return jsonResponse({ error: "Method not allowed" }, 405, corsHeaders);
    }

    try {
        console.log("WebAuthn function called. Method:", req.method);

        // 1. Authenticate user via Supabase JWT
        const authHeader = req.headers.get("Authorization");
        console.log("Auth header provided:", !!authHeader, authHeader ? `(Length: ${authHeader.length})` : "");

        if (!authHeader) {
            console.log("Missing authorization header");
            return jsonResponse({ error: "Missing authorization header" }, 401, corsHeaders);
        }

        const accessToken = extractBearerToken(authHeader);
        if (!accessToken) {
            return jsonResponse({ error: "Missing bearer token" }, 401, corsHeaders);
        }

        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

        // Admin client (bypasses RLS for challenge management)
        const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

        const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(accessToken);

        if (authError || !user) {
            console.log("Auth failed in Edge Function:", authError);
            if (authError) console.log("Auth error message:", authError.message);
            console.log("User object:", user);
            return jsonResponse({ error: "Unauthorized", details: authError?.message }, 401, corsHeaders);
        }

        console.log("User authenticated successfully:", user.id);

        // 2. Parse action
        const body = await req.json();
        const { action } = body;

        const rp = getRpConfig(req);

        switch (action) {
            case "generate-registration-options":
                return await handleGenerateRegistrationOptions(user, rp, supabaseAdmin, body, corsHeaders);

            case "verify-registration":
                return await handleVerifyRegistration(user, rp, supabaseAdmin, body, corsHeaders);

            case "generate-authentication-options":
                return await handleGenerateAuthenticationOptions(user, rp, supabaseAdmin, body, corsHeaders);

            case "verify-authentication":
                return await handleVerifyAuthentication(user, rp, supabaseAdmin, body, corsHeaders);

            case "list-credentials":
                return await handleListCredentials(user, supabaseAdmin, corsHeaders);

            case "delete-credential":
                return await handleDeleteCredential(user, supabaseAdmin, body, corsHeaders);

            default:
                return jsonResponse({ error: `Unknown action: ${action}` }, 400, corsHeaders);
        }
    } catch (err) {
        console.error("WebAuthn edge function error:", err);
        return jsonResponse({ error: "Internal server error" }, 500, corsHeaders);
    }
});

// ============ Registration ============

async function handleGenerateRegistrationOptions(
    user: { id: string; email?: string },
    rp: { rpName: string; rpID: string },
    supabase: ReturnType<typeof createClient>,
    body: Record<string, unknown>,
    corsHeaders: Record<string, string>,
) {
    // Fetch existing credentials to exclude (prevent re-registration)
    const { data: existingCreds } = await supabase
        .from("passkey_credentials")
        .select("credential_id")
        .eq("user_id", user.id);

    const excludeCredentials = (existingCreds || []).map((c: { credential_id: string }) => ({
        id: c.credential_id,
        transports: undefined,
    }));

    // Generate registration options
    const options = await generateRegistrationOptions({
        rpName: rp.rpName,
        rpID: rp.rpID,
        userName: user.email || user.id,
        userDisplayName: (body.displayName as string) || user.email || "User",
        // Require resident key (discoverable credential) for passkey
        authenticatorSelection: {
            residentKey: "required",
            userVerification: "required",
        },
        // Prefer ES256 (-7) and RS256 (-257) — widest compatibility
        supportedAlgorithmIDs: [-7, -257],
        excludeCredentials,
    });

    // Generate PRF salt (32 random bytes) — will be stored with the credential
    const prfSaltBytes = new Uint8Array(32);
    crypto.getRandomValues(prfSaltBytes);
    const prfSalt = isoBase64URL.fromBuffer(prfSaltBytes);

    // Clean up expired challenges first
    await supabase.rpc("cleanup_expired_webauthn_challenges").catch(() => { });

    // Store challenge server-side (5 min TTL)
    await supabase.from("webauthn_challenges").insert({
        user_id: user.id,
        challenge: options.challenge,
        type: "registration",
    });

    return jsonResponse({
        options,
        prfSalt,
    }, 200, corsHeaders);
}

async function handleVerifyRegistration(
    user: { id: string },
    rp: { rpName: string; rpID: string; origin: string },
    supabase: ReturnType<typeof createClient>,
    body: Record<string, unknown>,
    corsHeaders: Record<string, string>,
) {
    const { credential, deviceName, prfSalt, wrappedMasterKey, prfEnabled } = body as {
        credential: unknown;
        deviceName?: string;
        prfSalt: string;
        wrappedMasterKey?: string;
        prfEnabled?: boolean;
    };

    if (!credential) {
        return jsonResponse({ error: "Missing credential response" }, 400, corsHeaders);
    }

    // Retrieve the stored challenge
    const { data: challenges } = await supabase
        .from("webauthn_challenges")
        .select("*")
        .eq("user_id", user.id)
        .eq("type", "registration")
        .order("created_at", { ascending: false })
        .limit(1);

    if (!challenges || challenges.length === 0) {
        return jsonResponse({ error: "No pending registration challenge" }, 400, corsHeaders);
    }

    const storedChallenge = challenges[0];

    // Check expiry
    if (new Date(storedChallenge.expires_at) < new Date()) {
        await supabase.from("webauthn_challenges").delete().eq("id", storedChallenge.id);
        return jsonResponse({ error: "Challenge expired" }, 400, corsHeaders);
    }

    try {
        // Verify the registration response
        const verification = await verifyRegistrationResponse({
            response: credential as RegistrationResponseJSON,
            expectedChallenge: storedChallenge.challenge,
            expectedOrigin: rp.origin,
            expectedRPID: rp.rpID,
        });

        if (!verification.verified || !verification.registrationInfo) {
            return jsonResponse({ error: "Registration verification failed" }, 400, corsHeaders);
        }

        const { credential: regCredential } = verification.registrationInfo;

        // Store the credential in the database
        const { error: insertError } = await supabase
            .from("passkey_credentials")
            .insert({
                user_id: user.id,
                credential_id: regCredential.id,
                public_key: isoBase64URL.fromBuffer(regCredential.publicKey),
                counter: regCredential.counter,
                transports: regCredential.transports || [],
                device_name: deviceName || "Passkey",
                prf_salt: prfSalt || null,
                wrapped_master_key: wrappedMasterKey || null,
                prf_enabled: !!prfEnabled && !!wrappedMasterKey,
            });

        if (insertError) {
            console.error("Failed to store credential:", insertError);
            if (insertError.code === "23505") { // Unique violation
                return jsonResponse({ error: "Passkey already registered on this device" }, 409, corsHeaders);
            }
            return jsonResponse({ error: "Failed to store credential" }, 500, corsHeaders);
        }

        // Clean up the used challenge
        await supabase.from("webauthn_challenges").delete().eq("id", storedChallenge.id);

        return jsonResponse({
            verified: true,
            credentialId: regCredential.id,
        }, 200, corsHeaders);
    } catch (err) {
        console.error("Registration verification error:", err);
        return jsonResponse({ error: "Verification failed" }, 400, corsHeaders);
    }
}

// ============ Authentication ============

async function handleGenerateAuthenticationOptions(
    user: { id: string },
    rp: { rpID: string },
    supabase: ReturnType<typeof createClient>,
    body: Record<string, unknown>,
    corsHeaders: Record<string, string>,
) {
    const { credentialId } = body as { credentialId?: string };

    // Fetch user's registered credentials
    const { data: credentials } = await supabase
        .from("passkey_credentials")
        .select("credential_id, transports, prf_salt, prf_enabled")
        .eq("user_id", user.id);

    if (!credentials || credentials.length === 0) {
        return jsonResponse({ error: "No passkeys registered" }, 404, corsHeaders);
    }

    const scopedCredentials = credentialId
        ? credentials.filter((credential: { credential_id: string }) => credential.credential_id === credentialId)
        : credentials;

    if (scopedCredentials.length === 0) {
        return jsonResponse({ error: "Requested passkey credential not found" }, 404, corsHeaders);
    }

    const allowCredentials = scopedCredentials.map((c: { credential_id: string; transports?: string[]; prf_salt?: string; prf_enabled?: boolean }) => ({
        id: c.credential_id,
        transports: c.transports || undefined,
    }));

    const options = await generateAuthenticationOptions({
        rpID: rp.rpID,
        allowCredentials,
        userVerification: "required",
    });

    // Clean up expired challenges first
    await supabase.rpc("cleanup_expired_webauthn_challenges").catch(() => { });

    // Store challenge server-side
    await supabase.from("webauthn_challenges").insert({
        user_id: user.id,
        challenge: options.challenge,
        type: "authentication",
    });

    // Build a map of credential_id -> prfSalt for PRF-enabled credentials
    const prfSalts: Record<string, string> = {};
    for (const cred of scopedCredentials) {
        if (cred.prf_enabled && cred.prf_salt) {
            prfSalts[cred.credential_id] = cred.prf_salt;
        }
    }

    return jsonResponse({
        options,
        prfSalts,
    }, 200, corsHeaders);
}

async function handleVerifyAuthentication(
    user: { id: string },
    rp: { rpID: string; origin: string },
    supabase: ReturnType<typeof createClient>,
    body: Record<string, unknown>,
    corsHeaders: Record<string, string>,
) {
    const { credential, expectedCredentialId } = body as {
        credential: unknown;
        expectedCredentialId?: string;
    };

    if (!credential) {
        return jsonResponse({ error: "Missing credential response" }, 400, corsHeaders);
    }

    // Extract credential ID from the response to find the matching DB record
    const credentialResponse = credential as { id: string };

    if (expectedCredentialId && credentialResponse.id !== expectedCredentialId) {
        return jsonResponse({ error: "Unexpected passkey credential used" }, 400, corsHeaders);
    }

    // Retrieve the stored challenge
    const { data: challenges } = await supabase
        .from("webauthn_challenges")
        .select("*")
        .eq("user_id", user.id)
        .eq("type", "authentication")
        .order("created_at", { ascending: false })
        .limit(1);

    if (!challenges || challenges.length === 0) {
        return jsonResponse({ error: "No pending authentication challenge" }, 400, corsHeaders);
    }

    const storedChallenge = challenges[0];

    // Check expiry
    if (new Date(storedChallenge.expires_at) < new Date()) {
        await supabase.from("webauthn_challenges").delete().eq("id", storedChallenge.id);
        return jsonResponse({ error: "Challenge expired" }, 400, corsHeaders);
    }

    // Challenge sofort löschen — verhindert Replay-Angriffe auch bei Verifikationsfehlern
    await supabase.from("webauthn_challenges").delete().eq("id", storedChallenge.id);

    // Find the matching credential in DB
    const { data: dbCredentials } = await supabase
        .from("passkey_credentials")
        .select("*")
        .eq("user_id", user.id)
        .eq("credential_id", credentialResponse.id);

    if (!dbCredentials || dbCredentials.length === 0) {
        return jsonResponse({ error: "Credential not found" }, 400, corsHeaders);
    }

    const dbCredential = dbCredentials[0] as {
        id: string;
        credential_id: string;
        public_key: string;
        counter: number;
        transports?: string[];
        wrapped_master_key?: string;
        prf_enabled?: boolean;
    };

    try {
        const verification = await verifyAuthenticationResponse({
            response: credential as AuthenticationResponseJSON,
            expectedChallenge: storedChallenge.challenge,
            expectedOrigin: rp.origin,
            expectedRPID: rp.rpID,
            credential: {
                id: dbCredential.credential_id,
                publicKey: isoBase64URL.toBuffer(dbCredential.public_key),
                counter: dbCredential.counter,
                transports: dbCredential.transports || undefined,
            },
        });

        if (!verification.verified) {
            return jsonResponse({ error: "Authentication verification failed" }, 400, corsHeaders);
        }

        // Update the counter (clone detection)
        await supabase
            .from("passkey_credentials")
            .update({
                counter: verification.authenticationInfo.newCounter,
                last_used_at: new Date().toISOString(),
            })
            .eq("id", dbCredential.id);

        // Challenge wurde bereits vor der Verifikation gelöscht (Replay-Schutz)

        return jsonResponse({
            verified: true,
            credentialId: dbCredential.credential_id,
            wrappedMasterKey: dbCredential.wrapped_master_key,
            prfEnabled: dbCredential.prf_enabled,
        }, 200, corsHeaders);
    } catch (err) {
        console.error("Authentication verification error:", err);
        return jsonResponse({ error: "Verification failed" }, 400, corsHeaders);
    }
}

// ============ Credential Management ============

async function handleListCredentials(
    user: { id: string },
    supabase: ReturnType<typeof createClient>,
    corsHeaders: Record<string, string>,
) {
    const { data: credentials, error } = await supabase
        .from("passkey_credentials")
        .select("id, credential_id, device_name, prf_enabled, created_at, last_used_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

    if (error) {
        return jsonResponse({ error: "Failed to list credentials" }, 500, corsHeaders);
    }

    return jsonResponse({ credentials: credentials || [] }, 200, corsHeaders);
}

async function handleDeleteCredential(
    user: { id: string },
    supabase: ReturnType<typeof createClient>,
    body: Record<string, unknown>,
    corsHeaders: Record<string, string>,
) {
    const { credentialId } = body as { credentialId: string };

    if (!credentialId) {
        return jsonResponse({ error: "Missing credentialId" }, 400, corsHeaders);
    }

    const { error } = await supabase
        .from("passkey_credentials")
        .delete()
        .eq("user_id", user.id)
        .eq("id", credentialId);

    if (error) {
        return jsonResponse({ error: "Failed to delete credential" }, 500, corsHeaders);
    }

    return jsonResponse({ deleted: true }, 200, corsHeaders);
}

// ============ Helpers ============

function jsonResponse(data: unknown, status = 200, corsHeaders: Record<string, string> = {}): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
}

function extractBearerToken(authHeader: string): string | null {
    if (!authHeader.toLowerCase().startsWith("bearer ")) {
        return null;
    }

    const token = authHeader.slice("bearer ".length).trim();
    return token.length > 0 ? token : null;
}
