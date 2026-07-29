import type { User } from "npm:@supabase/supabase-js@2";
import { createClient } from "npm:@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseAnonKey =
  Deno.env.get("SUPABASE_INTERNAL_PUBLISHABLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY")!;
const supabaseServiceRoleKey =
  Deno.env.get("SUPABASE_INTERNAL_SECRET_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

export function parseBearerToken(authHeader: string | null): string | null {
  if (!authHeader) {
    return null;
  }

  if (authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice("Bearer ".length).trim();
    return token || null;
  }

  const token = authHeader.trim();
  return token || null;
}

export function createAdminClient() {
  return createClient(supabaseUrl, supabaseServiceRoleKey);
}

export function createUserClient(accessToken: string) {
  return createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });
}

export async function resolveAuthenticatedUser(accessToken: string): Promise<User | null> {
  if (!accessToken) {
    return null;
  }

  const adminClient = createAdminClient();
  const {
    data: { user },
    error,
  } = await adminClient.auth.getUser(accessToken);

  if (error || !user) {
    return null;
  }

  return user;
}