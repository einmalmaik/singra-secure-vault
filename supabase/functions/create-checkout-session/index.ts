import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "https://esm.sh/stripe@17.7.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

// Server-side plan mapping — client CANNOT override prices
const PLAN_CONFIG: Record<string, { priceId: string; tier: string }> = {
    premium_monthly: { priceId: "price_1Sz4ydPOxkvnea3yiUS9yZsV", tier: "premium" },
    premium_yearly: { priceId: "price_1Sz4ydPOxkvnea3yjs4Tfnzt", tier: "premium" },
    families_monthly: { priceId: "price_1Sz4yePOxkvnea3ywl0Ggaqj", tier: "families" },
    families_yearly: { priceId: "price_1Sz4ygPOxkvnea3yy7lrqSmP", tier: "families" },
};

const INTRO_COUPON_ID = "K3tViKjk";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
    // Handle CORS preflight
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
        // 1. Authenticate user via Supabase JWT
        const authHeader = req.headers.get("Authorization");
        if (!authHeader) {
            return new Response(JSON.stringify({ error: "Missing authorization header" }), {
                status: 401,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        const stripeApiKey = Deno.env.get("STRIPE_API_KEY")!;

        const supabaseClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
            global: { headers: { Authorization: authHeader } },
        });

        const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
        if (authError || !user) {
            return new Response(JSON.stringify({ error: "Unauthorized" }), {
                status: 401,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        // 2. Parse and validate request body
        const body = await req.json();
        const { plan_key, widerruf_consent_execution, widerruf_consent_loss } = body;

        // Validate plan key
        if (!plan_key || !(plan_key in PLAN_CONFIG)) {
            return new Response(JSON.stringify({ error: "Invalid plan_key" }), {
                status: 400,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        // 3. Validate Widerruf checkboxes (German law requirement)
        if (widerruf_consent_execution !== true || widerruf_consent_loss !== true) {
            return new Response(
                JSON.stringify({
                    error: "Both Widerruf consent checkboxes must be accepted",
                    code: "WIDERRUF_CONSENT_REQUIRED",
                }),
                {
                    status: 400,
                    headers: { ...corsHeaders, "Content-Type": "application/json" },
                }
            );
        }

        const planInfo = PLAN_CONFIG[plan_key];
        const stripe = new Stripe(stripeApiKey, { apiVersion: "2024-12-18.acacia" });

        // 4. Get or create Stripe customer
        const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

        const { data: subscription } = await supabaseAdmin
            .from("subscriptions")
            .select("stripe_customer_id, has_used_intro_discount")
            .eq("user_id", user.id)
            .single();

        let stripeCustomerId = subscription?.stripe_customer_id;

        if (!stripeCustomerId) {
            // Create new Stripe customer
            const customer = await stripe.customers.create({
                email: user.email,
                metadata: { supabase_user_id: user.id },
            });
            stripeCustomerId = customer.id;

            // Save customer ID to DB
            if (subscription) {
                await supabaseAdmin
                    .from("subscriptions")
                    .update({ stripe_customer_id: stripeCustomerId })
                    .eq("user_id", user.id);
            } else {
                await supabaseAdmin
                    .from("subscriptions")
                    .insert({
                        user_id: user.id,
                        stripe_customer_id: stripeCustomerId,
                        tier: "free",
                        status: "active",
                    });
            }
        }

        // 5. Check intro discount eligibility (monthly plans only, one-time)
        const hasUsedDiscount = subscription?.has_used_intro_discount ?? false;

        const sessionParams: Stripe.Checkout.SessionCreateParams = {
            customer: stripeCustomerId,
            mode: "subscription",
            line_items: [{ price: planInfo.priceId, quantity: 1 }],
            success_url: `${req.headers.get("origin") || Deno.env.get("SITE_URL") || "http://localhost:8080"}/settings?checkout=success`,
            cancel_url: `${req.headers.get("origin") || Deno.env.get("SITE_URL") || "http://localhost:8080"}/pricing?checkout=cancel`,
            metadata: {
                supabase_user_id: user.id,
                plan_key,
                tier: planInfo.tier,
            },
            subscription_data: {
                metadata: {
                    supabase_user_id: user.id,
                    plan_key,
                    tier: planInfo.tier,
                },
            },
        };

        // Apply 50% intro coupon only for monthly plans if user hasn't used it yet
        if (!hasUsedDiscount && plan_key.endsWith("_monthly")) {
            sessionParams.discounts = [{ coupon: INTRO_COUPON_ID }];
        }

        // 6. Create Stripe Checkout Session
        const checkoutSession = await stripe.checkout.sessions.create(sessionParams);

        return new Response(
            JSON.stringify({ url: checkoutSession.url }),
            {
                status: 200,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
        );
    } catch (err) {
        console.error("Error creating checkout session:", err);
        return new Response(
            JSON.stringify({ error: "Internal server error" }),
            {
                status: 500,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
        );
    }
});
