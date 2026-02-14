import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getCorsHeaders } from "../_shared/cors.ts";

function jsonResponse(
  corsHeaders: Record<string, string>,
  body: Record<string, unknown>,
  status: number,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function handleListTickets(
  client: ReturnType<typeof createClient>,
  userId: string,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  const { data: tickets, error: ticketsError } = await client
    .from("support_tickets")
    .select("id, subject, category, status, priority_reason, tier_snapshot, is_priority, sla_hours, sla_due_at, first_response_at, first_response_minutes, created_at, updated_at, last_message_at")
    .order("created_at", { ascending: false })
    .limit(20);

  if (ticketsError) {
    return jsonResponse(corsHeaders, { error: ticketsError.message || "Failed to load tickets" }, 500);
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

  // Count unread support replies per ticket (messages from support after last user message)
  const unreadCounts: Record<string, number> = {};
  if (ticketIds.length > 0) {
    const { data: allMessages } = await client
      .from("support_messages")
      .select("ticket_id, author_role, created_at")
      .eq("is_internal", false)
      .in("ticket_id", ticketIds)
      .order("created_at", { ascending: false });

    if (allMessages) {
      for (const ticketId of ticketIds) {
        const ticketMessages = allMessages.filter((m) => m.ticket_id === ticketId);
        let unread = 0;
        for (const msg of ticketMessages) {
          if (msg.author_role === "support" || msg.author_role === "system") {
            unread++;
          } else {
            break; // Stop at first user message
          }
        }
        unreadCounts[ticketId] = unread;
      }
    }
  }

  const { data: entitlementRows } = await client
    .rpc("get_support_sla_for_user", { _user_id: userId });

  const entitlement = (entitlementRows && entitlementRows[0])
    ? entitlementRows[0]
    : {
      priority_reason: "free",
      tier_snapshot: "free",
      sla_hours: 72,
      is_priority: false,
    };

  return jsonResponse(
    corsHeaders,
    {
      success: true,
      entitlement,
      tickets: (tickets || []).map((ticket) => ({
        ...ticket,
        latest_message: latestMessages[ticket.id] || null,
        unread_count: unreadCounts[ticket.id] || 0,
      })),
    },
    200,
  );
}

async function handleGetTicket(
  client: ReturnType<typeof createClient>,
  _userId: string,
  ticketId: string,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  if (!ticketId) {
    return jsonResponse(corsHeaders, { error: "Invalid ticket_id" }, 400);
  }

  // RLS ensures the user can only see their own tickets
  const { data: ticket, error: ticketError } = await client
    .from("support_tickets")
    .select("id, subject, category, status, priority_reason, tier_snapshot, is_priority, sla_hours, sla_due_at, first_response_at, first_response_minutes, created_at, updated_at, last_message_at, resolved_at, closed_at")
    .eq("id", ticketId)
    .single();

  if (ticketError || !ticket) {
    return jsonResponse(corsHeaders, { error: ticketError?.message || "Ticket not found" }, 404);
  }

  const { data: messages, error: messagesError } = await client
    .from("support_messages")
    .select("id, ticket_id, author_user_id, author_role, body, created_at")
    .eq("ticket_id", ticketId)
    .eq("is_internal", false)
    .order("created_at", { ascending: true });

  if (messagesError) {
    return jsonResponse(corsHeaders, { error: messagesError.message }, 500);
  }

  return jsonResponse(
    corsHeaders,
    {
      success: true,
      ticket,
      messages: messages || [],
    },
    200,
  );
}

async function handleReplyTicket(
  client: ReturnType<typeof createClient>,
  userId: string,
  ticketId: string,
  messageBody: string,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  if (!ticketId) {
    return jsonResponse(corsHeaders, { error: "Invalid ticket_id" }, 400);
  }

  if (messageBody.length < 1 || messageBody.length > 5000) {
    return jsonResponse(corsHeaders, { error: "Message must be between 1 and 5000 characters" }, 400);
  }

  // RLS ensures only owner can see/insert on their ticket
  const { data: ticket, error: ticketError } = await client
    .from("support_tickets")
    .select("id, status")
    .eq("id", ticketId)
    .single();

  if (ticketError || !ticket) {
    return jsonResponse(corsHeaders, { error: "Ticket not found" }, 404);
  }

  if (ticket.status === "closed") {
    return jsonResponse(corsHeaders, { error: "Ticket is closed" }, 400);
  }

  const { data: insertedMessage, error: messageError } = await client
    .from("support_messages")
    .insert({
      ticket_id: ticketId,
      author_user_id: userId,
      author_role: "user",
      is_internal: false,
      body: messageBody,
    })
    .select("id, ticket_id, author_user_id, author_role, body, created_at")
    .single();

  if (messageError || !insertedMessage) {
    return jsonResponse(corsHeaders, { error: messageError?.message || "Failed to send message" }, 500);
  }

  // Re-open ticket if it was resolved/waiting
  if (ticket.status === "resolved" || ticket.status === "waiting_user") {
    await client
      .from("support_tickets")
      .update({ status: "open", resolved_at: null })
      .eq("id", ticketId);
  }

  return jsonResponse(
    corsHeaders,
    {
      success: true,
      message: insertedMessage,
    },
    200,
  );
}

async function handleCloseTicket(
  client: ReturnType<typeof createClient>,
  userId: string,
  ticketId: string,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  if (!ticketId) {
    return jsonResponse(corsHeaders, { error: "Invalid ticket_id" }, 400);
  }

  // RLS ensures only owner can see their ticket
  const { data: ticket, error: ticketError } = await client
    .from("support_tickets")
    .select("id, status, user_id")
    .eq("id", ticketId)
    .single();

  if (ticketError || !ticket) {
    return jsonResponse(corsHeaders, { error: "Ticket not found" }, 404);
  }

  if (ticket.status === "closed") {
    return jsonResponse(corsHeaders, { error: "Ticket is already closed" }, 400);
  }

  const nowIso = new Date().toISOString();

  const { data: updated, error: updateError } = await client
    .from("support_tickets")
    .update({ status: "closed", closed_at: nowIso })
    .eq("id", ticketId)
    .select("id, status, closed_at, updated_at")
    .single();

  if (updateError || !updated) {
    return jsonResponse(corsHeaders, { error: updateError?.message || "Failed to close ticket" }, 500);
  }

  // Add a system message noting the user closed the ticket
  await client
    .from("support_messages")
    .insert({
      ticket_id: ticketId,
      author_user_id: userId,
      author_role: "system",
      is_internal: false,
      body: "Ticket wurde vom Benutzer geschlossen. / Ticket closed by user.",
    });

  return jsonResponse(
    corsHeaders,
    {
      success: true,
      ticket: updated,
    },
    200,
  );
}

Deno.serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse(corsHeaders, { error: "Method not allowed" }, 405);
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse(corsHeaders, { error: "Missing authorization header" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnon = Deno.env.get("SUPABASE_ANON_KEY")!;

    const client = createClient(supabaseUrl, supabaseAnon, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await client.auth.getUser();
    if (authError || !user) {
      return jsonResponse(corsHeaders, { error: "Unauthorized" }, 401);
    }

    const body = (await req.json().catch((e) => {
      console.error("support-list: req.json() failed:", e);
      return {};
    })) as Record<string, unknown>;
    const action = typeof body.action === "string" ? body.action : "list";

    if (action === "list") {
      return handleListTickets(client, user.id, corsHeaders);
    }

    if (action === "get_ticket") {
      const ticketId = typeof body.ticket_id === "string" ? body.ticket_id : "";
      return handleGetTicket(client, user.id, ticketId, corsHeaders);
    }

    if (action === "reply_ticket") {
      const ticketId = typeof body.ticket_id === "string" ? body.ticket_id : "";
      const message = typeof body.message === "string" ? body.message.trim() : "";
      return handleReplyTicket(client, user.id, ticketId, message, corsHeaders);
    }

    if (action === "close_ticket") {
      const ticketId = typeof body.ticket_id === "string" ? body.ticket_id : "";
      return handleCloseTicket(client, user.id, ticketId, corsHeaders);
    }

    return jsonResponse(corsHeaders, { error: "Unsupported action" }, 400);
  } catch (err) {
    console.error("support-list error:", err);
    return jsonResponse(corsHeaders, { error: "Internal server error" }, 500);
  }
});
