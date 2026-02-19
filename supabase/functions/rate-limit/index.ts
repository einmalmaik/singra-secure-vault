// Copyright (c) 2025-2026 Maunting Studios
// Licensed under the Business Source License 1.1 — see LICENSE

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Rate limiting configuration
const MAX_ATTEMPTS = 5;
const LOCKOUT_DURATION = 15 * 60 * 1000; // 15 minutes in milliseconds
const ATTEMPT_WINDOW = 10 * 60 * 1000; // 10 minutes window for attempts

interface RateLimitRequest {
  userId?: string;
  email?: string;
  action: 'unlock' | '2fa' | 'passkey';
  success: boolean;
}

interface RateLimitResponse {
  allowed: boolean;
  attemptsRemaining: number;
  lockedUntil?: string;
}

serve(async (req) => {
  // Handle CORS
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { userId, email, action, success }: RateLimitRequest = await req.json();

    // Determine identifier (userId or email)
    const identifier = userId || email;
    if (!identifier) {
      return new Response(
        JSON.stringify({ error: "userId or email required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const now = new Date();
    const windowStart = new Date(now.getTime() - ATTEMPT_WINDOW);

    // Get recent attempts
    const { data: attempts, error: fetchError } = await supabase
      .from('rate_limit_attempts')
      .select('*')
      .eq('identifier', identifier)
      .eq('action', action)
      .gte('attempted_at', windowStart.toISOString())
      .order('attempted_at', { ascending: false });

    if (fetchError) {
      console.error('Error fetching rate limit attempts:', fetchError);
      // Fail open - allow the attempt if we can't check
      return new Response(
        JSON.stringify({ allowed: true, attemptsRemaining: MAX_ATTEMPTS }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if currently locked out
    const lockedAttempt = attempts?.find(a => a.locked_until && new Date(a.locked_until) > now);
    if (lockedAttempt) {
      return new Response(
        JSON.stringify({
          allowed: false,
          attemptsRemaining: 0,
          lockedUntil: lockedAttempt.locked_until
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Count failed attempts in window
    const failedAttempts = attempts?.filter(a => !a.success).length || 0;

    // Record this attempt
    const lockUntil = (!success && failedAttempts >= MAX_ATTEMPTS - 1)
      ? new Date(now.getTime() + LOCKOUT_DURATION).toISOString()
      : null;

    const { error: insertError } = await supabase
      .from('rate_limit_attempts')
      .insert({
        identifier,
        action,
        success,
        attempted_at: now.toISOString(),
        locked_until: lockUntil,
        ip_address: req.headers.get('CF-Connecting-IP') ||
                    req.headers.get('X-Forwarded-For')?.split(',')[0] ||
                    'unknown'
      });

    if (insertError) {
      console.error('Error recording rate limit attempt:', insertError);
    }

    // Clean up old attempts (older than 24 hours)
    const cleanupTime = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    await supabase
      .from('rate_limit_attempts')
      .delete()
      .lt('attempted_at', cleanupTime.toISOString());

    const attemptsRemaining = Math.max(0, MAX_ATTEMPTS - failedAttempts - (success ? 0 : 1));

    return new Response(
      JSON.stringify({
        allowed: !lockUntil,
        attemptsRemaining,
        lockedUntil: lockUntil
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error('Rate limit error:', error);
    // Fail open on error
    return new Response(
      JSON.stringify({ allowed: true, attemptsRemaining: MAX_ATTEMPTS }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});