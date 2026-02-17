import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";

const FUNCTION_NAME = "invite-emergency-access";

async function sendResendMail(to: string, subject: string, html: string) {
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  if (!resendApiKey) throw new Error("Missing RESEND_API_KEY secret");

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

    const { email, wait_days } = await req.json();
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

    const waitDays = Number(wait_days || 7);
    if (!Number.isFinite(waitDays) || waitDays < 1 || waitDays > 90) {
      console.warn(`${FUNCTION_NAME}: invalid_wait_days`, {
        actorUserId,
        waitDaysInput: wait_days,
      });
      return new Response(JSON.stringify({ error: "wait_days must be between 1 and 90" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(supabaseUrl, supabaseService);

    const { error: insertError } = await admin
      .from("emergency_access")
      .insert({
        grantor_id: user.id,
        trusted_email: inviteEmail,
        wait_days: waitDays,
        status: "invited",
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
    const subject = "Notfallzugang-Einladung für Singra PW";
    const html = `
      <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111">
        <h2>Du wurdest als Notfallkontakt eingeladen</h2>
        <p>Hallo,</p>
        <p><strong>${user.email}</strong> hat dich als Notfallkontakt in Singra PW eingeladen.</p>
        <p>Um die Einladung zu bestätigen, melde dich mit dieser E-Mail-Adresse an und öffne die Einstellungen:</p>
        <p><a href="${siteUrl}/settings" style="display:inline-block;padding:10px 16px;background:#111;color:#fff;text-decoration:none;border-radius:8px">Einladung bestätigen</a></p>
        <p>Wartezeit für Notfallzugriff: <strong>${waitDays} Tage</strong>.</p>
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
