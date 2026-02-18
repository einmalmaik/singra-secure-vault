import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";

const FUNCTION_NAME = "invite-family-member";

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
      from: "Singra <noreply@mauntingstudios.de>",
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

Deno.serve(async (req: Request) => {
  let actorUserId: string | null = null;
  let inviteEmail: string | null = null;

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      console.warn(`${FUNCTION_NAME}: missing_authorization_header`);
      return new Response(JSON.stringify({ error: "Missing authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseService = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const client = createClient(supabaseUrl, supabaseAnon, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await client.auth.getUser();
    if (authError || !user) {
      console.warn(`${FUNCTION_NAME}: unauthorized_user`, {
        authError: authError?.message || null,
      });
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    actorUserId = user.id;

    const { email } = await req.json();
    if (!email || typeof email !== "string") {
      console.warn(`${FUNCTION_NAME}: invalid_email_payload`, {
        actorUserId,
      });
      return new Response(JSON.stringify({ error: "Invalid email" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    inviteEmail = email.trim().toLowerCase();

    const admin = createClient(supabaseUrl, supabaseService);

    // =====================================================
    // VALIDATION 1: Check subscription tier
    // =====================================================
    const { data: subscription } = await admin
      .from("subscriptions")
      .select("tier")
      .eq("user_id", user.id)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (!subscription || subscription.tier !== "families") {
      console.warn(`${FUNCTION_NAME}: families_tier_required`, {
        actorUserId,
      });
      return new Response(
        JSON.stringify({ error: "Families subscription required" }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // =====================================================
    // VALIDATION 2: Check family size (max 6 members)
    // =====================================================
    const { count: memberCount } = await admin
      .from("family_members")
      .select("*", { count: "exact", head: true })
      .eq("family_owner_id", user.id)
      .in("status", ["active", "invited"]);

    // Bug-Fix: memberCount kann null sein → null >= 6 wäre false → Limit umgehbar
    if ((memberCount ?? 0) >= 6) {
      console.warn(`${FUNCTION_NAME}: family_limit_reached`, {
        actorUserId,
        memberCount,
      });
      return new Response(
        JSON.stringify({ error: "Maximale Familiengröße erreicht (6 Mitglieder)" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Verhindere Doppeleinladung derselben E-Mail-Adresse
    const { data: existingMember } = await admin
      .from("family_members")
      .select("id, status")
      .eq("family_owner_id", user.id)
      .eq("member_email", inviteEmail)
      .in("status", ["invited", "active"])
      .maybeSingle();

    if (existingMember) {
      console.warn(`${FUNCTION_NAME}: duplicate_invite`, {
        actorUserId,
        inviteEmail,
        existingStatus: existingMember.status,
      });
      return new Response(
        JSON.stringify({ error: "Diese E-Mail-Adresse ist bereits eingeladen oder aktives Mitglied" }),
        {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const { error: insertError } = await admin
      .from("family_members")
      .insert({
        family_owner_id: user.id,
        member_email: inviteEmail,
        status: "invited",
        role: "member",
      });

    if (insertError) {
      console.warn(`${FUNCTION_NAME}: invite_insert_failed`, {
        actorUserId,
        inviteEmail,
        dbError: insertError.message,
      });
      return new Response(JSON.stringify({ error: insertError.message }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const siteUrl = Deno.env.get("SITE_URL") || "https://singrapw.mauntingstudios.de";
    const subject = "Einladung zur Familien-Organisation bei Singra PW";
    const html = `
      <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111">
        <h2>Du wurdest zur Familien-Organisation eingeladen</h2>
        <p>Hallo,</p>
        <p><strong>${user.email}</strong> hat dich zur Familien-Organisation in Singra PW eingeladen.</p>
        <p>Öffne Singra PW und melde dich an, um die Einladung anzunehmen:</p>
        <p><a href="${siteUrl}/settings" style="display:inline-block;padding:10px 16px;background:#111;color:#fff;text-decoration:none;border-radius:8px">Zu den Einstellungen</a></p>
        <p>Falls du kein Konto hast, registriere dich zuerst mit dieser E-Mail-Adresse.</p>
      </div>
    `;

    await sendResendMail(inviteEmail, subject, html);

    return new Response(JSON.stringify({ success: true, requires_signup_possible: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error(`${FUNCTION_NAME}: unhandled_error`, {
      actorUserId,
      inviteEmail,
      error: err instanceof Error ? err.message : String(err),
    });
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
