import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getCorsHeaders } from "../_shared/cors.ts";

type TicketStatus = "open" | "in_progress" | "waiting_user" | "resolved" | "closed";
type SubscriptionTier = "free" | "premium" | "families" | "self_hosted";

const VALID_STATUSES = new Set<TicketStatus>([
  "open",
  "in_progress",
  "waiting_user",
  "resolved",
  "closed",
]);
const VALID_SUBSCRIPTION_TIERS = new Set<SubscriptionTier>([
  "free",
  "premium",
  "families",
  "self_hosted",
]);

async function sendResendMail(to: string, subject: string, html: string) {
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  if (!resendApiKey) {
    console.warn("RESEND_API_KEY not set, skipping email notification");
    return;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Singra Support <support@mauntingstudios.de>",
      to: [to],
      subject,
      html,
    }),
  });

  if (!res.ok) {
    const txt = await res.text();
    console.warn(`Resend API error: ${res.status} ${txt}`);
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function jsonResponse(
  corsHeaders: Record<string, string>,
  body: Record<string, unknown>,
  status: number,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function parseTicketStatus(value: unknown): TicketStatus | null {
  if (
    value === "open" ||
    value === "in_progress" ||
    value === "waiting_user" ||
    value === "resolved" ||
    value === "closed"
  ) {
    return value;
  }
  return null;
}

function parseSubscriptionTier(value: unknown): SubscriptionTier | null {
  if (
    value === "free" ||
    value === "premium" ||
    value === "families" ||
    value === "self_hosted"
  ) {
    return value;
  }

  return null;
}

async function hasPermission(
  client: ReturnType<typeof createClient>,
  userId: string,
  permissionKey: string,
): Promise<boolean> {
  const { data, error } = await client.rpc("has_permission", {
    _user_id: userId,
    _permission_key: permissionKey,
  });

  if (error) {
    console.error("has_permission RPC failed", permissionKey, error);
    return false;
  }

  return data === true;
}

async function hasRole(
  client: ReturnType<typeof createClient>,
  userId: string,
  role: "admin" | "moderator" | "user",
): Promise<boolean> {
  const { data, error } = await client.rpc("has_role", {
    _user_id: userId,
    _role: role,
  });

  if (error) {
    console.error("has_role RPC failed", role, error);
    return false;
  }

  return data === true;
}

function buildTicketStatusPatch(status: TicketStatus): Record<string, string | null> {
  const nowIso = new Date().toISOString();

  if (status === "resolved") {
    return {
      status,
      resolved_at: nowIso,
      closed_at: null,
    };
  }

  if (status === "closed") {
    return {
      status,
      closed_at: nowIso,
    };
  }

  return {
    status,
    resolved_at: null,
    closed_at: null,
  };
}

async function updateTicketStatus(
  adminClient: ReturnType<typeof createClient>,
  ticketId: string,
  status: TicketStatus,
  actorUserId: string,
): Promise<{ data: Record<string, unknown> | null; error: string | null }> {
  const statusPatch = buildTicketStatusPatch(status);

  const { data, error } = await adminClient
    .from("support_tickets")
    .update(statusPatch)
    .eq("id", ticketId)
    .select("id, status, resolved_at, closed_at, updated_at")
    .single();

  if (error) {
    return { data: null, error: error.message };
  }

  const { error: eventError } = await adminClient.from("support_events").insert({
    ticket_id: ticketId,
    actor_user_id: actorUserId,
    event_type: "ticket_status_changed",
    event_payload: {
      status,
    },
  });

  if (eventError) {
    console.warn("Failed to create support status event", eventError);
  }

  return { data: data as Record<string, unknown>, error: null };
}

async function handleListTickets(
  client: ReturnType<typeof createClient>,
  adminClient: ReturnType<typeof createClient>,
  userId: string,
  body: Record<string, unknown>,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  const canReadTickets = await hasPermission(client, userId, "support.tickets.read");
  if (!canReadTickets) {
    return jsonResponse(corsHeaders, { error: "Insufficient permissions" }, 403);
  }

  const canReadInternal = await hasPermission(client, userId, "support.tickets.reply_internal");

  const statusFilter = parseTicketStatus(body.status);
  const rawLimit = Number(body.limit || 50);
  const limit = Number.isFinite(rawLimit)
    ? Math.max(1, Math.min(Math.floor(rawLimit), 100))
    : 50;
  const search = typeof body.search === "string" ? body.search.trim() : "";

  let query = adminClient
    .from("support_tickets")
    .select(
      "id, user_id, requester_email, subject, category, status, priority_reason, tier_snapshot, is_priority, sla_hours, sla_due_at, first_response_at, first_response_minutes, created_at, updated_at, last_message_at",
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (statusFilter) {
    query = query.eq("status", statusFilter);
  }

  if (search.length >= 2) {
    const escapedSearch = search.replace(/[%_\\]/g, '\\$&');
    query = query.ilike("subject", `%${escapedSearch}%`);
  }

  const { data: tickets, error: ticketsError } = await query;
  if (ticketsError) {
    return jsonResponse(corsHeaders, { error: ticketsError.message }, 500);
  }

  const ticketIds = (tickets || []).map((ticket) => ticket.id);
  const latestMessagesByTicket = new Map<
    string,
    {
      body: string;
      created_at: string;
      author_role: string;
      is_internal: boolean;
    }
  >();

  if (ticketIds.length > 0) {
    let messageQuery = adminClient
      .from("support_messages")
      .select("ticket_id, body, created_at, author_role, is_internal")
      .in("ticket_id", ticketIds)
      .order("created_at", { ascending: false });

    if (!canReadInternal) {
      messageQuery = messageQuery.eq("is_internal", false);
    }

    const { data: messages } = await messageQuery;
    for (const message of messages || []) {
      if (!latestMessagesByTicket.has(message.ticket_id)) {
        latestMessagesByTicket.set(message.ticket_id, {
          body: message.body,
          created_at: message.created_at,
          author_role: message.author_role,
          is_internal: message.is_internal,
        });
      }
    }
  }

  const canReadPII = await hasPermission(client, userId, "support.pii.read");

  return jsonResponse(
    corsHeaders,
    {
      success: true,
      tickets: (tickets || []).map((ticket) => {
        const mapped = {
          ...ticket,
          latest_message: latestMessagesByTicket.get(ticket.id) || null,
        };
        // Mask PII for users without explicit PII read permission
        if (!canReadPII && mapped.requester_email) {
          const email = mapped.requester_email as string;
          const atIdx = email.indexOf("@");
          if (atIdx > 1) {
            mapped.requester_email =
              email[0] + "***" + email.substring(atIdx);
          } else {
            mapped.requester_email = "***";
          }
        }
        return mapped;
      }),
      permissions: {
        can_read_internal: canReadInternal,
      },
    },
    200,
  );
}

async function handleGetTicket(
  client: ReturnType<typeof createClient>,
  adminClient: ReturnType<typeof createClient>,
  userId: string,
  body: Record<string, unknown>,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  const canReadTickets = await hasPermission(client, userId, "support.tickets.read");
  if (!canReadTickets) {
    return jsonResponse(corsHeaders, { error: "Insufficient permissions" }, 403);
  }

  const ticketId = typeof body.ticket_id === "string" ? body.ticket_id : "";
  if (!ticketId) {
    return jsonResponse(corsHeaders, { error: "Invalid ticket_id" }, 400);
  }

  const canReadInternal = await hasPermission(client, userId, "support.tickets.reply_internal");
  const canReply = await hasPermission(client, userId, "support.tickets.reply");
  const canUpdateStatus = await hasPermission(client, userId, "support.tickets.status");

  const { data: ticket, error: ticketError } = await adminClient
    .from("support_tickets")
    .select(
      "id, user_id, requester_email, subject, category, status, priority_reason, tier_snapshot, is_priority, sla_hours, sla_due_at, first_response_at, first_response_minutes, created_at, updated_at, last_message_at, resolved_at, closed_at",
    )
    .eq("id", ticketId)
    .single();

  if (ticketError || !ticket) {
    return jsonResponse(corsHeaders, { error: ticketError?.message || "Ticket not found" }, 404);
  }

  let messageQuery = adminClient
    .from("support_messages")
    .select("id, ticket_id, author_user_id, author_role, is_internal, body, created_at")
    .eq("ticket_id", ticketId)
    .order("created_at", { ascending: true });

  if (!canReadInternal) {
    messageQuery = messageQuery.eq("is_internal", false);
  }

  const { data: messages, error: messagesError } = await messageQuery;
  if (messagesError) {
    return jsonResponse(corsHeaders, { error: messagesError.message }, 500);
  }

  return jsonResponse(
    corsHeaders,
    {
      success: true,
      ticket,
      messages: messages || [],
      permissions: {
        can_reply: canReply,
        can_read_internal: canReadInternal,
        can_update_status: canUpdateStatus,
      },
    },
    200,
  );
}

async function handleReplyTicket(
  client: ReturnType<typeof createClient>,
  adminClient: ReturnType<typeof createClient>,
  userId: string,
  body: Record<string, unknown>,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  const canReply = await hasPermission(client, userId, "support.tickets.reply");
  if (!canReply) {
    return jsonResponse(corsHeaders, { error: "Insufficient permissions" }, 403);
  }

  const ticketId = typeof body.ticket_id === "string" ? body.ticket_id : "";
  const message = typeof body.message === "string" ? body.message.trim() : "";
  const isInternal = body.is_internal === true;
  const statusUpdate = parseTicketStatus(body.status);

  if (!ticketId || message.length < 1 || message.length > 5000) {
    return jsonResponse(corsHeaders, { error: "Invalid payload" }, 400);
  }

  if (isInternal) {
    const canWriteInternal = await hasPermission(client, userId, "support.tickets.reply_internal");
    if (!canWriteInternal) {
      return jsonResponse(corsHeaders, { error: "Insufficient permissions" }, 403);
    }
  }

  if (statusUpdate) {
    const canUpdateStatus = await hasPermission(client, userId, "support.tickets.status");
    if (!canUpdateStatus) {
      return jsonResponse(corsHeaders, { error: "Insufficient status permissions" }, 403);
    }
  }

  const { data: insertedMessage, error: messageError } = await adminClient
    .from("support_messages")
    .insert({
      ticket_id: ticketId,
      author_user_id: userId,
      author_role: "support",
      is_internal: isInternal,
      body: message,
    })
    .select("id, ticket_id, author_user_id, author_role, is_internal, body, created_at")
    .single();

  if (messageError || !insertedMessage) {
    return jsonResponse(corsHeaders, { error: messageError?.message || "Failed to insert message" }, 500);
  }

  let statusResult: Record<string, unknown> | null = null;
  if (statusUpdate) {
    const { data: updatedTicket, error: statusError } = await updateTicketStatus(
      adminClient,
      ticketId,
      statusUpdate,
      userId,
    );

    if (statusError) {
      return jsonResponse(corsHeaders, { error: statusError }, 400);
    }

    statusResult = updatedTicket;
  }

  // Send email notification to the ticket owner for non-internal replies
  if (!isInternal) {
    try {
      const { data: ticket } = await adminClient
        .from("support_tickets")
        .select("user_id, requester_email, subject")
        .eq("id", ticketId)
        .single();

      if (ticket?.requester_email) {
        const siteUrl = Deno.env.get("SITE_URL") || "https://singrapw.mauntingstudios.de";
        await sendResendMail(
          ticket.requester_email,
          `Neue Antwort auf dein Support-Ticket (#${ticketId.slice(0, 8)})`,
          `
          <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111">
            <h2>Neue Antwort auf dein Ticket</h2>
            <p>Hallo,</p>
            <p>unser Support-Team hat auf dein Ticket geantwortet:</p>
            <ul>
              <li><strong>Betreff:</strong> ${escapeHtml(ticket.subject || "Support-Ticket")}</li>
            </ul>
            <div style="background:#f5f5f5;border-radius:8px;padding:12px 16px;margin:16px 0;white-space:pre-wrap">${escapeHtml(message.slice(0, 500))}${message.length > 500 ? "..." : ""}</div>
            <p>Oeffne das Support-Widget in der App, um zu antworten.</p>
            <p><a href="${siteUrl}/vault" style="display:inline-block;padding:10px 16px;background:#111;color:#fff;text-decoration:none;border-radius:8px">Zur App</a></p>
          </div>
          `,
        );
      }
    } catch (notifyErr) {
      console.warn("Failed to send user reply notification email:", notifyErr);
    }
  }

  return jsonResponse(
    corsHeaders,
    {
      success: true,
      message: insertedMessage,
      ticket: statusResult,
    },
    200,
  );
}

async function handleUpdateTicket(
  client: ReturnType<typeof createClient>,
  adminClient: ReturnType<typeof createClient>,
  userId: string,
  body: Record<string, unknown>,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  const canUpdateStatus = await hasPermission(client, userId, "support.tickets.status");
  if (!canUpdateStatus) {
    return jsonResponse(corsHeaders, { error: "Insufficient permissions" }, 403);
  }

  const ticketId = typeof body.ticket_id === "string" ? body.ticket_id : "";
  const status = parseTicketStatus(body.status);

  if (!ticketId || !status || !VALID_STATUSES.has(status)) {
    return jsonResponse(corsHeaders, { error: "Invalid payload" }, 400);
  }

  const { data: updatedTicket, error: statusError } = await updateTicketStatus(
    adminClient,
    ticketId,
    status,
    userId,
  );

  if (statusError) {
    return jsonResponse(corsHeaders, { error: statusError }, 400);
  }

  return jsonResponse(
    corsHeaders,
    {
      success: true,
      ticket: updatedTicket,
    },
    200,
  );
}

async function handleListMetrics(
  client: ReturnType<typeof createClient>,
  userId: string,
  body: Record<string, unknown>,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  const canReadMetrics = await hasPermission(client, userId, "support.metrics.read");
  if (!canReadMetrics) {
    return jsonResponse(corsHeaders, { error: "Insufficient permissions" }, 403);
  }

  const rawDays = Number(body.days || 30);
  const days = Number.isFinite(rawDays) ? Math.max(1, Math.min(Math.floor(rawDays), 365)) : 30;

  const { data, error } = await client.rpc("get_support_response_metrics", {
    _days: days,
  });

  if (error) {
    const lowered = error.message?.toLowerCase() || "";
    const statusCode = lowered.includes("insufficient") ? 403 : 400;
    return jsonResponse(corsHeaders, { error: error.message }, statusCode);
  }

  return jsonResponse(
    corsHeaders,
    {
      success: true,
      metrics: data || [],
    },
    200,
  );
}

async function handleAssignSubscription(
  client: ReturnType<typeof createClient>,
  adminClient: ReturnType<typeof createClient>,
  userId: string,
  body: Record<string, unknown>,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  const isAdmin = await hasRole(client, userId, "admin");
  const canManageSubscriptions = await hasPermission(client, userId, "subscriptions.manage");
  if (!isAdmin || !canManageSubscriptions) {
    return jsonResponse(corsHeaders, { error: "Insufficient permissions" }, 403);
  }

  const targetUserId = typeof body.user_id === "string" ? body.user_id.trim() : "";
  const tier = parseSubscriptionTier(body.tier);
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  const ticketId = typeof body.ticket_id === "string" ? body.ticket_id : null;

  if (!targetUserId || !tier || !VALID_SUBSCRIPTION_TIERS.has(tier) || reason.length < 3) {
    return jsonResponse(corsHeaders, { error: "Invalid payload" }, 400);
  }

  const { data: previousSubscription, error: previousSubscriptionError } = await adminClient
    .from("subscriptions")
    .select("id, user_id, tier, status")
    .eq("user_id", targetUserId)
    .maybeSingle();

  if (previousSubscriptionError) {
    return jsonResponse(corsHeaders, { error: previousSubscriptionError.message }, 500);
  }

  const { data: updatedSubscription, error: updateError } = await adminClient
    .from("subscriptions")
    .upsert(
      {
        user_id: targetUserId,
        tier,
        status: "active",
      },
      { onConflict: "user_id" },
    )
    .select("id, user_id, tier, status")
    .single();

  if (updateError || !updatedSubscription) {
    return jsonResponse(corsHeaders, { error: updateError?.message || "Failed to assign subscription" }, 400);
  }

  const { error: auditError } = await adminClient
    .from("team_access_audit_log")
    .insert({
      actor_user_id: userId,
      target_user_id: targetUserId,
      action: "assign_subscription",
      payload: {
        tier,
        reason,
        ticketId,
      },
    });

  if (auditError) {
    if (previousSubscription) {
      await adminClient
        .from("subscriptions")
        .update({
          tier: previousSubscription.tier,
          status: previousSubscription.status,
        })
        .eq("id", updatedSubscription.id);
    } else {
      await adminClient
        .from("subscriptions")
        .delete()
        .eq("id", updatedSubscription.id);
    }

    return jsonResponse(corsHeaders, { error: "Audit logging failed, operation aborted" }, 500);
  }

  if (ticketId) {
    const { error: eventError } = await adminClient.from("support_events").insert({
      ticket_id: ticketId,
      actor_user_id: userId,
      event_type: "subscription_assigned",
      event_payload: {
        tier,
      },
    });

    if (eventError) {
      console.warn("Failed to create support subscription event", eventError);
    }
  }

  return jsonResponse(
    corsHeaders,
    {
      success: true,
      subscription: updatedSubscription,
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
    const supabaseService = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const client = createClient(supabaseUrl, supabaseAnon, {
      global: { headers: { Authorization: authHeader } },
    });
    const adminClient = createClient(supabaseUrl, supabaseService);

    const {
      data: { user },
      error: authError,
    } = await client.auth.getUser();

    if (authError || !user) {
      return jsonResponse(corsHeaders, { error: "Unauthorized" }, 401);
    }

    const isAdmin = await hasRole(client, user.id, "admin");
    const isModerator = await hasRole(client, user.id, "moderator");
    if (!isAdmin && !isModerator) {
      return jsonResponse(corsHeaders, { error: "Insufficient permissions" }, 403);
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = typeof body.action === "string" ? body.action : "";

    if (action === "list_tickets") {
      return handleListTickets(client, adminClient, user.id, body, corsHeaders);
    }

    if (action === "get_ticket") {
      return handleGetTicket(client, adminClient, user.id, body, corsHeaders);
    }

    if (action === "reply_ticket") {
      return handleReplyTicket(client, adminClient, user.id, body, corsHeaders);
    }

    if (action === "update_ticket") {
      return handleUpdateTicket(client, adminClient, user.id, body, corsHeaders);
    }

    if (action === "list_metrics") {
      return handleListMetrics(client, user.id, body, corsHeaders);
    }

    if (action === "assign_subscription") {
      return handleAssignSubscription(client, adminClient, user.id, body, corsHeaders);
    }

    return jsonResponse(corsHeaders, { error: "Unsupported action" }, 400);
  } catch (err) {
    console.error("admin-support error", err);
    return jsonResponse(corsHeaders, { error: "Internal server error" }, 500);
  }
});
