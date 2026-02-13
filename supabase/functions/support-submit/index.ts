import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getCorsHeaders } from "../_shared/cors.ts";

const ALLOWED_CATEGORIES = new Set([
  "general",
  "technical",
  "billing",
  "security",
  "family",
  "other",
]);

async function sendResendMail(to: string, subject: string, html: string) {
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  if (!resendApiKey) {
    throw new Error("Missing RESEND_API_KEY secret");
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
    throw new Error(`Resend API error: ${res.status} ${txt}`);
  }
}

function buildSlaLabel(slaHours: number): string {
  if (slaHours <= 24) {
    return "in der Regel 24h";
  }
  return "in der Regel 72h";
}

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
    const supabaseService = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supportEmail = Deno.env.get("SUPPORT_EMAIL") || "support@mauntingstudios.de";
    const siteUrl = Deno.env.get("SITE_URL") || "https://singrapw.mauntingstudios.de";

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

    const body = await req.json();
    const subject = String(body?.subject || "").trim();
    const message = String(body?.message || "").trim();
    const categoryRaw = String(body?.category || "general").trim().toLowerCase();
    const category = ALLOWED_CATEGORIES.has(categoryRaw) ? categoryRaw : "general";

    if (subject.length < 3 || subject.length > 160) {
      return new Response(JSON.stringify({ error: "Subject must be between 3 and 160 characters" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (message.length < 10 || message.length > 5000) {
      return new Response(JSON.stringify({ error: "Message must be between 10 and 5000 characters" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(supabaseUrl, supabaseService);

    const { data: ticket, error: ticketError } = await admin
      .from("support_tickets")
      .insert({
        user_id: user.id,
        requester_email: user.email || null,
        subject,
        category,
        status: "open",
      })
      .select("id, subject, category, priority_reason, tier_snapshot, is_priority, sla_hours, sla_due_at, created_at")
      .single();

    if (ticketError || !ticket) {
      return new Response(JSON.stringify({ error: ticketError?.message || "Failed to create support ticket" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { error: messageError } = await admin
      .from("support_messages")
      .insert({
        ticket_id: ticket.id,
        author_user_id: user.id,
        author_role: "user",
        is_internal: false,
        body: message,
      });

    if (messageError) {
      await admin.from("support_tickets").delete().eq("id", ticket.id);
      return new Response(JSON.stringify({ error: messageError.message || "Failed to save support message" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Best effort email notifications (ticket creation is source of truth)
    const slaLabel = buildSlaLabel(ticket.sla_hours);
    const priorityTag = ticket.is_priority ? `PRIO-${ticket.sla_hours}H` : `STD-${ticket.sla_hours}H`;
    const reasonTag = String(ticket.priority_reason || "free").toUpperCase();

    if (user.email) {
      try {
        await sendResendMail(
          user.email,
          `Dein Support-Ticket bei Singra PW (#${ticket.id.slice(0, 8)})`,
          `
          <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111">
            <h2>Support-Ticket erstellt</h2>
            <p>Hallo,</p>
            <p>dein Ticket wurde erfolgreich erstellt:</p>
            <ul>
              <li><strong>Ticket-ID:</strong> ${ticket.id}</li>
              <li><strong>Betreff:</strong> ${subject}</li>
              <li><strong>SLA-Ziel:</strong> ${slaLabel}</li>
            </ul>
            <p>Du kannst den Status jederzeit in den Einstellungen unter <strong>Support</strong> ansehen.</p>
            <p><a href="${siteUrl}/settings" style="display:inline-block;padding:10px 16px;background:#111;color:#fff;text-decoration:none;border-radius:8px">Zu den Einstellungen</a></p>
          </div>
          `,
        );
      } catch (mailErr) {
        console.warn("Failed to send user acknowledgement email:", mailErr);
      }
    }

    try {
      await sendResendMail(
        supportEmail,
        `[${priorityTag}][${reasonTag}] Neues Support-Ticket ${ticket.id.slice(0, 8)}`,
        `
        <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111">
          <h2>Neues Support-Ticket</h2>
          <ul>
            <li><strong>Ticket-ID:</strong> ${ticket.id}</li>
            <li><strong>User-ID:</strong> ${user.id}</li>
            <li><strong>E-Mail:</strong> ${user.email || "n/a"}</li>
            <li><strong>Betreff:</strong> ${subject}</li>
            <li><strong>Kategorie:</strong> ${category}</li>
            <li><strong>SLA:</strong> ${slaLabel}</li>
          </ul>
          <h3>Nachricht</h3>
          <p style="white-space:pre-wrap">${message}</p>
        </div>
        `,
      );
    } catch (mailErr) {
      console.warn("Failed to send support notification email:", mailErr);
    }

    return new Response(
      JSON.stringify({
        success: true,
        ticket: {
          id: ticket.id,
          subject: ticket.subject,
          category: ticket.category,
          priority_reason: ticket.priority_reason,
          tier_snapshot: ticket.tier_snapshot,
          is_priority: ticket.is_priority,
          sla_hours: ticket.sla_hours,
          sla_due_at: ticket.sla_due_at,
          created_at: ticket.created_at,
          sla_label: slaLabel,
        },
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    console.error("support-submit error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
