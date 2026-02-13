import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getCorsHeaders } from "../_shared/cors.ts";

Deno.serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnon = Deno.env.get("SUPABASE_ANON_KEY")!;

    const client = createClient(supabaseUrl, supabaseAnon, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await client.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: tickets, error: ticketsError } = await client
      .from("support_tickets")
      .select("id, subject, category, status, priority_reason, tier_snapshot, is_priority, sla_hours, sla_due_at, first_response_at, first_response_minutes, created_at, updated_at, last_message_at")
      .order("created_at", { ascending: false })
      .limit(20);

    if (ticketsError) {
      return new Response(JSON.stringify({ error: ticketsError.message || "Failed to load tickets" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ticketIds = (tickets || []).map((t) => t.id);
    const latestMessages: Record<string, { body: string; created_at: string; author_role: string }> = {};

    if (ticketIds.length > 0) {
      const { data: messages } = await client
        .from("support_messages")
        .select("ticket_id, body, created_at, author_role")
        .eq("is_internal", false)
        .in("ticket_id", ticketIds)
        .order("created_at", { ascending: false });

      if (messages) {
        for (const msg of messages) {
          if (!latestMessages[msg.ticket_id]) {
            latestMessages[msg.ticket_id] = {
              body: msg.body,
              created_at: msg.created_at,
              author_role: msg.author_role,
            };
          }
        }
      }
    }

    const { data: entitlementRows } = await client
      .rpc("get_support_sla_for_user", { _user_id: user.id });

    const entitlement = (entitlementRows && entitlementRows[0])
      ? entitlementRows[0]
      : {
        priority_reason: "free",
        tier_snapshot: "free",
        sla_hours: 72,
        is_priority: false,
      };

    return new Response(
      JSON.stringify({
        success: true,
        entitlement,
        tickets: (tickets || []).map((ticket) => ({
          ...ticket,
          latest_message: latestMessages[ticket.id] || null,
        })),
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    console.error("support-list error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
