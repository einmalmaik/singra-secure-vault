/**
 * @fileoverview Shared CORS configuration for Supabase Edge Functions.
 *
 * Reads `ALLOWED_ORIGIN` from environment to restrict cross-origin requests
 * to only the production domain. Falls back to wildcard ("*") when the
 * env var is unset (local development / Supabase CLI).
 *
 * Usage in an Edge Function:
 *   import { corsHeaders } from "../_shared/cors.ts";
 */

const allowedOrigin = Deno.env.get("ALLOWED_ORIGIN") || "*";

export const corsHeaders: Record<string, string> = {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
};
