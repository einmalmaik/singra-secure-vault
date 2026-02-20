import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getCorsHeaders } from "../_shared/cors.ts";

type TeamRole = "admin" | "moderator" | "user";
type PermissionRole = "admin" | "moderator";

const VALID_ROLES = new Set<TeamRole>(["admin", "moderator", "user"]);
const ROLE_WEIGHTS: Record<TeamRole, number> = {
  admin: 3,
  moderator: 2,
  user: 1,
};

const ADMIN_ACCESS_PERMISSION_KEYS = [
  "support.admin.access",
  "support.tickets.read",
  "support.tickets.reply",
  "support.tickets.reply_internal",
  "support.tickets.status",
  "support.metrics.read",
  "subscriptions.read",
  "subscriptions.manage",
  "team.roles.read",
  "team.roles.manage",
  "team.permissions.read",
  "team.permissions.manage",
];

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

function parseRole(value: unknown): TeamRole | null {
  if (value === "admin" || value === "moderator" || value === "user") {
    return value;
  }
  return null;
}

function parsePermissionRole(value: unknown): PermissionRole | null {
  if (value === "admin" || value === "moderator") {
    return value;
  }
  return null;
}

function getPrimaryRole(roles: TeamRole[]): TeamRole {
  if (roles.includes("admin")) {
    return "admin";
  }
  if (roles.includes("moderator")) {
    return "moderator";
  }
  return "user";
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

async function requirePermission(
  client: ReturnType<typeof createClient>,
  userId: string,
  permissionKey: string,
): Promise<boolean> {
  return hasPermission(client, userId, permissionKey);
}

async function getUserRoles(
  client: ReturnType<typeof createClient>,
  userId: string,
): Promise<TeamRole[]> {
  const { data, error } = await client
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);

  if (error) {
    console.error("Failed to load roles", error);
    return [];
  }

  return (data || [])
    .map((row) => parseRole(row.role))
    .filter((role): role is TeamRole => role !== null);
}

async function getUserPermissions(
  client: ReturnType<typeof createClient>,
): Promise<string[]> {
  const { data, error } = await client.rpc("get_my_permissions");

  if (error) {
    console.error("Failed to load permissions", error);
    return [];
  }

  return (data || [])
    .map((row: { permission_key?: string }) => row.permission_key)
    .filter((permissionKey): permissionKey is string => typeof permissionKey === "string");
}

async function listUserEmails(
  adminClient: ReturnType<typeof createClient>,
  userIds: string[],
): Promise<Map<string, string | null>> {
  const userIdSet = new Set(userIds);
  const emailMap = new Map<string, string | null>();

  if (userIds.length === 0) {
    return emailMap;
  }

  let page = 1;
  const perPage = 200;

  while (page <= 20 && userIdSet.size > 0) {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage });
    if (error) {
      console.error("Failed to list auth users", error);
      break;
    }

    const users = data?.users || [];
    for (const authUser of users) {
      if (userIdSet.has(authUser.id)) {
        emailMap.set(authUser.id, authUser.email || null);
        userIdSet.delete(authUser.id);
      }
    }

    if (users.length < perPage) {
      break;
    }

    page += 1;
  }

  return emailMap;
}

async function handleGetAccess(
  client: ReturnType<typeof createClient>,
  userId: string,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  const roles = await getUserRoles(client, userId);
  const permissions = await getUserPermissions(client);
  const isAdmin = roles.includes("admin");
  const isInternalTeam = roles.includes("admin") || roles.includes("moderator");
  const canAccessAdmin = isInternalTeam && permissions.some((permissionKey) =>
    ADMIN_ACCESS_PERMISSION_KEYS.includes(permissionKey)
  );

  return jsonResponse(
    corsHeaders,
    {
      success: true,
      access: {
        roles,
        permissions,
        is_admin: isAdmin,
        can_access_admin: canAccessAdmin,
      },
    },
    200,
  );
}

async function handleListMembers(
  client: ReturnType<typeof createClient>,
  adminClient: ReturnType<typeof createClient>,
  userId: string,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  const canReadRoles = await requirePermission(client, userId, "team.roles.read");
  const isAdmin = await hasRole(client, userId, "admin");
  if (!isAdmin || !canReadRoles) {
    return jsonResponse(corsHeaders, { error: "Insufficient permissions" }, 403);
  }

  const { data: roleRows, error: roleError } = await adminClient
    .from("user_roles")
    .select("user_id, role, created_at")
    .in("role", ["admin", "moderator"])
    .order("created_at", { ascending: false })
    .limit(500);

  if (roleError) {
    return jsonResponse(corsHeaders, { error: roleError.message }, 500);
  }

  const groupedRoles = new Map<string, { roles: Set<TeamRole>; createdAt: string | null }>();
  for (const row of roleRows || []) {
    const parsedRole = parseRole(row.role);
    if (!parsedRole) {
      continue;
    }

    const current = groupedRoles.get(row.user_id) || {
      roles: new Set<TeamRole>(),
      createdAt: null,
    };
    current.roles.add(parsedRole);
    if (!current.createdAt || (row.created_at && row.created_at < current.createdAt)) {
      current.createdAt = row.created_at;
    }
    groupedRoles.set(row.user_id, current);
  }

  const userIds = Array.from(groupedRoles.keys());
  let profileMap = new Map<string, string | null>();

  if (userIds.length > 0) {
    const { data: profiles, error: profileError } = await adminClient
      .from("profiles")
      .select("user_id, display_name")
      .in("user_id", userIds);

    if (profileError) {
      console.warn("Failed to load profiles for team members", profileError);
    } else {
      profileMap = new Map(
        (profiles || []).map((profile) => [profile.user_id, profile.display_name || null]),
      );
    }
  }

  const emailMap = await listUserEmails(adminClient, userIds);

  const members = userIds
    .map((memberUserId) => {
      const grouped = groupedRoles.get(memberUserId)!;
      const roles = Array.from(grouped.roles);
      const primaryRole = getPrimaryRole(roles);

      return {
        user_id: memberUserId,
        email: emailMap.get(memberUserId) || null,
        display_name: profileMap.get(memberUserId) || null,
        roles,
        primary_role: primaryRole,
        created_at: grouped.createdAt,
      };
    })
    .sort((a, b) => {
      const roleCompare = ROLE_WEIGHTS[b.primary_role] - ROLE_WEIGHTS[a.primary_role];
      if (roleCompare !== 0) {
        return roleCompare;
      }

      const aEmail = a.email || "";
      const bEmail = b.email || "";
      return aEmail.localeCompare(bEmail);
    });

  return jsonResponse(
    corsHeaders,
    {
      success: true,
      members,
    },
    200,
  );
}

async function handleSetMemberRole(
  client: ReturnType<typeof createClient>,
  adminClient: ReturnType<typeof createClient>,
  actorUserId: string,
  body: Record<string, unknown>,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  const canManageRoles = await requirePermission(client, actorUserId, "team.roles.manage");
  const isAdmin = await hasRole(client, actorUserId, "admin");
  if (!isAdmin || !canManageRoles) {
    return jsonResponse(corsHeaders, { error: "Insufficient permissions" }, 403);
  }

  const targetUserId = typeof body.user_id === "string" ? body.user_id : "";
  const role = parseRole(body.role);

  if (!targetUserId || !role || !VALID_ROLES.has(role)) {
    return jsonResponse(corsHeaders, { error: "Invalid payload" }, 400);
  }

  // Prevent admin from changing their own role
  if (targetUserId === actorUserId) {
    return jsonResponse(corsHeaders, { error: "Cannot change your own role" }, 403);
  }

  // Prevent removing the last admin
  if (role !== "admin") {
    const targetIsAdmin = await hasRole(adminClient, targetUserId, "admin");
    if (targetIsAdmin) {
      const { count, error: countError } = await adminClient
        .from("user_roles")
        .select("id", { count: "exact", head: true })
        .eq("role", "admin");

      if (countError) {
        return jsonResponse(corsHeaders, { error: "Failed to verify admin count" }, 500);
      }

      if ((count ?? 0) <= 1) {
        return jsonResponse(corsHeaders, { error: "Cannot remove the last admin" }, 403);
      }
    }
  }

  const { error: deleteError } = await adminClient
    .from("user_roles")
    .delete()
    .eq("user_id", targetUserId)
    .in("role", ["admin", "moderator"]);

  if (deleteError) {
    return jsonResponse(corsHeaders, { error: deleteError.message }, 400);
  }

  const { data: existingUserRole, error: existingUserRoleError } = await adminClient
    .from("user_roles")
    .select("id")
    .eq("user_id", targetUserId)
    .eq("role", "user")
    .maybeSingle();

  if (existingUserRoleError) {
    return jsonResponse(corsHeaders, { error: existingUserRoleError.message }, 400);
  }

  if (!existingUserRole) {
    const { error: userRoleInsertError } = await adminClient
      .from("user_roles")
      .insert({ user_id: targetUserId, role: "user" });

    if (userRoleInsertError) {
      return jsonResponse(corsHeaders, { error: userRoleInsertError.message }, 400);
    }
  }

  if (role !== "user") {
    const { error: roleInsertError } = await adminClient
      .from("user_roles")
      .insert({ user_id: targetUserId, role });

    if (roleInsertError) {
      return jsonResponse(corsHeaders, { error: roleInsertError.message }, 400);
    }
  }

  const { error: auditError } = await adminClient
    .from("team_access_audit_log")
    .insert({
      actor_user_id: actorUserId,
      target_user_id: targetUserId,
      action: "set_member_role",
      payload: {
        role,
      },
    });

  if (auditError) {
    console.error("Failed to write team access audit log — aborting operation", auditError);
    // Roll back role change by deleting the newly assigned role
    await adminClient
      .from("user_roles")
      .delete()
      .eq("user_id", targetUserId)
      .eq("role", role);
    return jsonResponse(corsHeaders, { error: "Audit logging failed, operation aborted" }, 500);
  }

  return jsonResponse(
    corsHeaders,
    {
      success: true,
      role,
    },
    200,
  );
}

async function handleListRolePermissions(
  client: ReturnType<typeof createClient>,
  adminClient: ReturnType<typeof createClient>,
  userId: string,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  const canReadPermissions = await requirePermission(client, userId, "team.permissions.read");
  const isAdmin = await hasRole(client, userId, "admin");
  if (!isAdmin || !canReadPermissions) {
    return jsonResponse(corsHeaders, { error: "Insufficient permissions" }, 403);
  }

  const { data: permissionRows, error: permissionError } = await adminClient
    .from("team_permissions")
    .select("permission_key, label, description, category")
    .order("category", { ascending: true })
    .order("permission_key", { ascending: true });

  if (permissionError) {
    return jsonResponse(corsHeaders, { error: permissionError.message }, 500);
  }

  const { data: rolePermissionRows, error: rolePermissionError } = await adminClient
    .from("role_permissions")
    .select("role, permission_key");

  if (rolePermissionError) {
    return jsonResponse(corsHeaders, { error: rolePermissionError.message }, 500);
  }

  const matrix = new Map<string, { admin: boolean; moderator: boolean }>();

  for (const row of rolePermissionRows || []) {
    const role = parseRole(row.role);
    if (!role) {
      continue;
    }

    const permissionRole = parsePermissionRole(role);
    if (!permissionRole) {
      continue;
    }

    const current = matrix.get(row.permission_key) || {
      admin: false,
      moderator: false,
    };
    current[permissionRole] = true;
    matrix.set(row.permission_key, current);
  }

  const permissions = (permissionRows || []).map((row) => {
    const roles = matrix.get(row.permission_key) || {
      admin: false,
      moderator: false,
    };

    return {
      permission_key: row.permission_key,
      label: row.label,
      description: row.description,
      category: row.category,
      roles,
    };
  });

  return jsonResponse(
    corsHeaders,
    {
      success: true,
      permissions,
    },
    200,
  );
}

async function handleSetRolePermission(
  client: ReturnType<typeof createClient>,
  adminClient: ReturnType<typeof createClient>,
  actorUserId: string,
  body: Record<string, unknown>,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  const canManagePermissions = await requirePermission(client, actorUserId, "team.permissions.manage");
  const isAdmin = await hasRole(client, actorUserId, "admin");
  if (!isAdmin || !canManagePermissions) {
    return jsonResponse(corsHeaders, { error: "Insufficient permissions" }, 403);
  }

  const role = parsePermissionRole(body.role);
  const permissionKey = typeof body.permission_key === "string" ? body.permission_key : "";
  const enabled = body.enabled === true;

  if (!role || !permissionKey) {
    return jsonResponse(corsHeaders, { error: "Invalid payload" }, 400);
  }

  const { data: permissionDef, error: permissionDefError } = await adminClient
    .from("team_permissions")
    .select("permission_key")
    .eq("permission_key", permissionKey)
    .maybeSingle();

  if (permissionDefError) {
    return jsonResponse(corsHeaders, { error: permissionDefError.message }, 400);
  }

  if (!permissionDef) {
    return jsonResponse(corsHeaders, { error: "Unknown permission_key" }, 400);
  }

  const { data: existingPermission, error: existingPermissionError } = await adminClient
    .from("role_permissions")
    .select("role, permission_key")
    .eq("role", role)
    .eq("permission_key", permissionKey)
    .maybeSingle();

  if (existingPermissionError) {
    return jsonResponse(corsHeaders, { error: existingPermissionError.message }, 400);
  }

  const wasEnabled = existingPermission !== null;

  if (enabled) {
    const { error: upsertError } = await adminClient
      .from("role_permissions")
      .upsert({ role, permission_key: permissionKey }, { onConflict: "role,permission_key" });

    if (upsertError) {
      return jsonResponse(corsHeaders, { error: upsertError.message }, 400);
    }
  } else {
    const { error: deleteError } = await adminClient
      .from("role_permissions")
      .delete()
      .eq("role", role)
      .eq("permission_key", permissionKey);

    if (deleteError) {
      return jsonResponse(corsHeaders, { error: deleteError.message }, 400);
    }
  }

  const { error: auditError } = await adminClient
    .from("team_access_audit_log")
    .insert({
      actor_user_id: actorUserId,
      action: "set_role_permission",
      payload: {
        role,
        permission_key: permissionKey,
        enabled,
      },
    });

  if (auditError) {
    // SECURITY: Rollback must restore exact prior state, not blindly re-insert
    // to prevent privilege escalation on audit failure
    if (wasEnabled) {
      await adminClient
        .from("role_permissions")
        .upsert({ role, permission_key: permissionKey }, { onConflict: "role,permission_key" });
    } else {
      await adminClient
        .from("role_permissions")
        .delete()
        .eq("role", role)
        .eq("permission_key", permissionKey);
    }

    return jsonResponse(corsHeaders, { error: "Audit logging failed, operation aborted" }, 500);
  }

  return jsonResponse(
    corsHeaders,
    {
      success: true,
      role,
      permission_key: permissionKey,
      enabled,
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

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = typeof body.action === "string" ? body.action : "get_access";

    if (action === "get_access") {
      return handleGetAccess(client, user.id, corsHeaders);
    }

    if (action === "list_members") {
      return handleListMembers(client, adminClient, user.id, corsHeaders);
    }

    if (action === "set_member_role") {
      return handleSetMemberRole(client, adminClient, user.id, body, corsHeaders);
    }

    if (action === "list_role_permissions") {
      return handleListRolePermissions(client, adminClient, user.id, corsHeaders);
    }

    if (action === "set_role_permission") {
      return handleSetRolePermission(client, adminClient, user.id, body, corsHeaders);
    }

    return jsonResponse(corsHeaders, { error: "Unsupported action" }, 400);
  } catch (err) {
    console.error("admin-team error", err);
    return jsonResponse(corsHeaders, { error: "Internal server error" }, 500);
  }
});
