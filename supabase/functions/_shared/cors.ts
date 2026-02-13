/**
 * @fileoverview Shared CORS configuration for Supabase Edge Functions.
 *
 * Reads `ALLOWED_ORIGIN` from environment (comma-separated list) to restrict
 * cross-origin requests. Falls back to wildcard ("*") when the env var is unset.
 * Automatically allows localhost origins for development.
 *
 * Usage in an Edge Function (preferred — dynamic):
 *   import { getCorsHeaders } from "../_shared/cors.ts";
 *   const cors = getCorsHeaders(req);
 *
 * Legacy (static — does not support localhost):
 *   import { corsHeaders } from "../_shared/cors.ts";
 */

const configuredOrigin = Deno.env.get("ALLOWED_ORIGIN") || "*";
const productionOrigins = configuredOrigin === "*"
    ? ["*"]
    : configuredOrigin.split(",").map((o) => o.trim().replace(/\/+$/, ""));

function isAllowedOrigin(origin: string): boolean {
    if (productionOrigins.includes("*")) return true;
    if (productionOrigins.includes(origin)) return true;
    if (/^https?:\/\/localhost(:\d+)?$/.test(origin)) return true;
    return false;
}

/**
 * Returns CORS headers with the correct Access-Control-Allow-Origin
 * based on the incoming request's Origin header.
 *
 * @param req - The incoming request
 * @returns CORS headers record
 */
export function getCorsHeaders(req: Request): Record<string, string> {
    const origin = req.headers.get("Origin") || "";
    const allowed = isAllowedOrigin(origin) ? origin : productionOrigins[0];

    return {
        "Access-Control-Allow-Origin": allowed,
        "Access-Control-Allow-Headers":
            "authorization, x-client-info, apikey, content-type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
    };
}

/** Static CORS headers (legacy — prefer getCorsHeaders for dynamic origin matching). */
export const corsHeaders: Record<string, string> = {
    "Access-Control-Allow-Origin": productionOrigins[0] || "*",
    "Access-Control-Allow-Headers":
        "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
};
