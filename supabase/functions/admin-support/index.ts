import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getCorsHeaders } from "../_shared/cors.ts";

type TicketStatus = "open" | "in_progress" | "waiting_user" | "resolved" | "closed";
type SubscriptionTier = "free" | "premium" | "families" | "self_hosted";
type TeamRole = "admin" | "moderator" | "user";

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
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_SEARCH_LENGTH = 120;
const MAX_REASON_LENGTH = 500;

const ALLOWED_STATUS_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  open: ["in_progress", "waiting_user", "resolved", "closed"],
  in_progress: ["waiting_user", "resolved", "closed", "open"],
  waiting_user: ["in_progress", "resolved", "closed", "open"],
  resolved: ["closed", "open", "in_progress"],
  closed: ["open", "in_progress"],
};

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
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
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

function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_REGEX.test(value);
}

function maskEmail(email: string): string {
  const atIdx = email.indexOf("@");
  if (atIdx > 1) {
    return email[0] + "***" + email.substring(atIdx);
  }
  return "***";
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
  role: TeamRole,
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

async function requireSupportConsoleAccess(
  client: ReturnType<typeof createClient>,
  userId: string,
): Promise<boolean> {
  const [isAdmin, isModerator, hasSupportAccess] = await Promise.all([
    hasRole(client, userId, "admin"),
    hasRole(client, userId, "moderator"),
    hasPermission(client, userId, "support.admin.access"),
  ]);

  return (isAdmin || isModerator) && hasSupportAccess;
}

function buildTicketStatusPatch(
  currentStatus: TicketStatus,
  nextStatus: TicketStatus,
): { patch: Record<string, string | null> | null; error: string | null } {
  if (currentStatus === nextStatus) {
    return { patch: { status: nextStatus }, error: null };
  }

  if (!ALLOWED_STATUS_TRANSITIONS[currentStatus].includes(nextStatus)) {
    return {
      patch: null,
      error: `Status transition not allowed: ${currentStatus} -> ${nextStatus}`,
    };
  }

  const nowIso = new Date().toISOString();

  if (nextStatus === "resolved") {
    return {
      patch: {
        status: nextStatus,
        resolved_at: nowIso,
        closed_at: null,
      },
      error: null,
    };
  }

  if (nextStatus === "closed") {
    return {
      patch: {
        status: nextStatus,
        closed_at: nowIso,
      },
      error: null,
    };
  }

  return {
    patch: {
      status: nextStatus,
      resolved_at: null,
      closed_at: null,
    },
    error: null,
  };
}

async function updateTicketStatus(
  adminClient: ReturnType<typeof createClient>,
  ticketId: string,
  status: TicketStatus,
  actorUserId: string,
): Promise<{ data: Record<string, unknown> | null; error: string | null }> {
  const { data: currentTicket, error: currentTicketError } = await adminClient
    .from("support_tickets")
    .select("id, status")
    .eq("id", ticketId)
    .single();

  if (currentTicketError || !currentTicket) {
    return { data: null, error: currentTicketError?.message || "Ticket not found" };
  }

  const currentStatus = parseTicketStatus(currentTicket.status);
  if (!currentStatus) {
    return { data: null, error: "Invalid current ticket status" };
  }

  const { patch: statusPatch, error: patchError } = buildTicketStatusPatch(currentStatus, status);
  if (patchError || !statusPatch) {
    return { data: null, error: patchError || "Invalid status update" };
  }

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

async function checkSupportReplyRateLimit(
  adminClient: ReturnType<typeof createClient>,
  userId: string,
): Promise<boolean> {
  const cutoff = new Date(Date.now() - 60 * 1000).toISOString();
  const { count, error } = await adminClient
    .from("support_messages")
    .select("id", { count: "exact", head: true })
    .eq("author_user_id", userId)
    .eq("author_role", "support")
    .gte("created_at", cutoff);

  if (error) {
    console.warn("Support reply rate-limit check failed", error);
    return true;
  }

  return (count ?? 0) < 30;
}

async function checkSubscriptionAssignRateLimit(
  adminClient: ReturnType<typeof createClient>,
  actorUserId: string,
): Promise<boolean> {
  const cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const { count, error } = await adminClient
    .from("team_access_audit_log")
    .select("id", { count: "exact", head: true })
    .eq("actor_user_id", actorUserId)
    .eq("action", "assign_subscription")
    .gte("created_at", cutoff);

  if (error) {
    console.warn("Subscription rate-limit check failed", error);
    return true;
  }

  return (count ?? 0) < 25;
}

async function findAuthUserByEmail(
  adminClient: ReturnType<typeof createClient>,
  email: string,
): Promise<{ id: string; email: string | null } | null> {
  let page = 1;
  const perPage = 200;
  const normalizedEmail = email.trim().toLowerCase();

  while (page <= 20) {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage });
    if (error) {
      console.error("Failed to list auth users", error);
      return null;
    }

    const users = data?.users || [];
    const matchedUser = users.find((user) =>
      (user.email || "").trim().toLowerCase() === normalizedEmail
    );
    if (matchedUser) {
      return { id: matchedUser.id, email: matchedUser.email || null };
    }

    if (users.length < perPage) {
      break;
    }
    page += 1;
  }

  return null;
}

async function findAuthUserById(
  adminClient: ReturnType<typeof createClient>,
  userId: string,
): Promise<{ id: string; email: string | null } | null> {
  let page = 1;
  const perPage = 200;

  while (page <= 20) {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage });
    if (error) {
      console.error("Failed to list auth users", error);
      return null;
    }

    const users = data?.users || [];
    const matchedUser = users.find((user) => user.id === userId);
    if (matchedUser) {
      return { id: matchedUser.id, email: matchedUser.email || null };
    }

    if (users.length < perPage) {
      break;
    }
    page += 1;
  }

  return null;
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
  const searchInput = typeof body.search === "string" ? body.search.trim() : "";
  const search = searchInput.slice(0, MAX_SEARCH_LENGTH);

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
    const escapedSearch = search.replace(/[%_\\]/g, "\\$&");
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
        if (!canReadPII && mapped.requester_email) {
          mapped.requester_email = maskEmail(mapped.requester_email as string);
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
  if (!isValidUuid(ticketId)) {
    return jsonResponse(corsHeaders, { error: "Invalid ticket_id" }, 400);
  }

  const [canReadInternal, canReply, canUpdateStatus, canReadPII] = await Promise.all([
    hasPermission(client, userId, "support.tickets.reply_internal"),
    hasPermission(client, userId, "support.tickets.reply"),
    hasPermission(client, userId, "support.tickets.status"),
    hasPermission(client, userId, "support.pii.read"),
  ]);

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

  if (!canReadPII && ticket.requester_email) {
    ticket.requester_email = maskEmail(ticket.requester_email);
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

  if (!isValidUuid(ticketId) || message.length < 1 || message.length > 5000) {
    return jsonResponse(corsHeaders, { error: "Invalid payload" }, 400);
  }

  const isUnderReplyLimit = await checkSupportReplyRateLimit(adminClient, userId);
  if (!isUnderReplyLimit) {
    return jsonResponse(corsHeaders, { error: "Reply rate limit exceeded" }, 429);
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

  if (!isInternal) {
    try {
      const { data: ticket } = await adminClient
        .from("support_tickets")
        .select("requester_email, subject")
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

  if (!isValidUuid(ticketId) || !status || !VALID_STATUSES.has(status)) {
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

async function handleLookupUser(
  client: ReturnType<typeof createClient>,
  adminClient: ReturnType<typeof createClient>,
  userId: string,
  body: Record<string, unknown>,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  const [canReadSubscriptions, canManageSubscriptions, canReadPII] = await Promise.all([
    hasPermission(client, userId, "subscriptions.read"),
    hasPermission(client, userId, "subscriptions.manage"),
    hasPermission(client, userId, "support.pii.read"),
  ]);

  if (!canReadSubscriptions && !canManageSubscriptions) {
    return jsonResponse(corsHeaders, { error: "Insufficient permissions" }, 403);
  }

  const inputUserId = typeof body.user_id === "string" ? body.user_id.trim() : "";
  const inputEmail = typeof body.email === "string" ? body.email.trim() : "";

  if (!inputUserId && !inputEmail) {
    return jsonResponse(corsHeaders, { error: "Invalid payload" }, 400);
  }

  let foundUser: { id: string; email: string | null } | null = null;
  if (inputUserId) {
    if (!isValidUuid(inputUserId)) {
      return jsonResponse(corsHeaders, { error: "Invalid user_id" }, 400);
    }
    foundUser = await findAuthUserById(adminClient, inputUserId);
  } else if (inputEmail) {
    if (inputEmail.length < 5 || inputEmail.length > 255 || !inputEmail.includes("@")) {
      return jsonResponse(corsHeaders, { error: "Invalid email" }, 400);
    }
    foundUser = await findAuthUserByEmail(adminClient, inputEmail);
  }

  if (!foundUser) {
    return jsonResponse(corsHeaders, { error: "User not found" }, 404);
  }

  const { data: subscription, error: subscriptionError } = await adminClient
    .from("subscriptions")
    .select("tier, status")
    .eq("user_id", foundUser.id)
    .maybeSingle();

  if (subscriptionError) {
    return jsonResponse(corsHeaders, { error: subscriptionError.message }, 500);
  }

  const emailValue = foundUser.email || "";
  return jsonResponse(
    corsHeaders,
    {
      success: true,
      user: {
        user_id: foundUser.id,
        email: canReadPII ? emailValue || null : emailValue ? maskEmail(emailValue) : null,
        tier: (subscription?.tier as string | undefined) || "free",
        status: (subscription?.status as string | undefined) || "active",
      },
    },
    200,
  );
}

async function handleAssignSubscription(
  client: ReturnType<typeof createClient>,
  adminClient: ReturnType<typeof createClient>,
  actorUserId: string,
  body: Record<string, unknown>,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  const [isAdmin, canManageSubscriptions] = await Promise.all([
    hasRole(client, actorUserId, "admin"),
    hasPermission(client, actorUserId, "subscriptions.manage"),
  ]);

  if (!isAdmin || !canManageSubscriptions) {
    return jsonResponse(corsHeaders, { error: "Insufficient permissions" }, 403);
  }

  const targetUserId = typeof body.user_id === "string" ? body.user_id.trim() : "";
  const tier = parseSubscriptionTier(body.tier);
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  const ticketId = typeof body.ticket_id === "string" ? body.ticket_id.trim() : null;

  if (!isValidUuid(targetUserId) || !tier || !VALID_SUBSCRIPTION_TIERS.has(tier)) {
    return jsonResponse(corsHeaders, { error: "Invalid payload" }, 400);
  }

  if (reason.length < 5 || reason.length > MAX_REASON_LENGTH) {
    return jsonResponse(corsHeaders, { error: "Invalid reason" }, 400);
  }

  if (ticketId && !isValidUuid(ticketId)) {
    return jsonResponse(corsHeaders, { error: "Invalid ticket_id" }, 400);
  }

  const isUnderLimit = await checkSubscriptionAssignRateLimit(adminClient, actorUserId);
  if (!isUnderLimit) {
    return jsonResponse(corsHeaders, { error: "Assignment rate limit exceeded" }, 429);
  }

  const { data: previousSubscription, error: previousSubscriptionError } = await adminClient
    .from("subscriptions")
    .select("id, user_id, tier, status, stripe_customer_id, stripe_subscription_id, current_period_end, has_used_intro_discount, cancel_at_period_end, stripe_price_id")
    .eq("user_id", targetUserId)
    .maybeSingle();

  if (previousSubscriptionError) {
    return jsonResponse(corsHeaders, { error: previousSubscriptionError.message }, 500);
  }

  const { data: updatedSubscription, error: upsertError } = await adminClient
    .from("subscriptions")
    .upsert(
      {
        user_id: targetUserId,
        tier,
        status: "active",
      },
      { onConflict: "user_id" },
    )
    .select("user_id, tier, status, updated_at")
    .single();

  if (upsertError || !updatedSubscription) {
    return jsonResponse(corsHeaders, { error: upsertError?.message || "Failed to update subscription" }, 500);
  }

  const { error: auditError } = await adminClient
    .from("team_access_audit_log")
    .insert({
      actor_user_id: actorUserId,
      target_user_id: targetUserId,
      action: "assign_subscription",
      payload: {
        ticket_id: ticketId,
        tier,
        reason,
      },
    });

  if (auditError) {
    if (previousSubscription) {
      await adminClient
        .from("subscriptions")
        .upsert(previousSubscription, { onConflict: "user_id" });
    } else {
      await adminClient.from("subscriptions").delete().eq("user_id", targetUserId);
    }
    return jsonResponse(corsHeaders, { error: "Audit logging failed, operation aborted" }, 500);
  }

  if (ticketId) {
    const { error: eventError } = await adminClient
      .from("support_events")
      .insert({
        ticket_id: ticketId,
        actor_user_id: actorUserId,
        event_type: "subscription_assigned",
        event_payload: {
          user_id: targetUserId,
          tier,
          reason,
        },
      });

    if (eventError) {
      console.warn("Failed to insert support event for subscription assignment", eventError);
    }
  }

  const authUser = await findAuthUserById(adminClient, targetUserId);
  if (authUser?.email) {
    const siteUrl = Deno.env.get("SITE_URL") || "https://singrapw.mauntingstudios.de";
    const subject = "Dein Singra-Abonnement wurde aktualisiert";
    const html = `
      <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111">
        <h2>Abonnement aktualisiert</h2>
        <p>Hallo,</p>
        <p>dein Abonnement wurde durch unser Support-Team angepasst.</p>
        <ul>
          <li><strong>Neuer Plan:</strong> ${escapeHtml(tier)}</li>
          <li><strong>Grund:</strong> ${escapeHtml(reason)}</li>
        </ul>
        <p><a href="${siteUrl}/settings" style="display:inline-block;padding:10px 16px;background:#111;color:#fff;text-decoration:none;border-radius:8px">Zu den Einstellungen</a></p>
      </div>
    `;
    await sendResendMail(authUser.email, subject, html);
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

    const canAccessSupportConsole = await requireSupportConsoleAccess(client, user.id);
    if (!canAccessSupportConsole) {
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

    if (action === "lookup_user") {
      return handleLookupUser(client, adminClient, user.id, body, corsHeaders);
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
