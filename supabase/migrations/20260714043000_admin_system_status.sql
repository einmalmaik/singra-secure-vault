-- Read-only, evidence-based system status without topology or secret details.
INSERT INTO public.team_permissions (permission_key, label, description, category)
VALUES (
  'admin.system.read',
  'Read System Status',
  'View constrained service-availability and configuration signals without endpoints, paths or payloads.',
  'admin'
)
ON CONFLICT (permission_key) DO UPDATE
SET label = EXCLUDED.label,
    description = EXCLUDED.description,
    category = EXCLUDED.category;

INSERT INTO public.role_permissions (role, permission_key)
VALUES ('admin'::public.app_role, 'admin.system.read')
ON CONFLICT (role, permission_key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.get_admin_system_status(
  _actor_user_id UUID
)
RETURNS TABLE (
  database_reachable BOOLEAN,
  private_attachment_storage_configured BOOLEAN,
  admin_audit_store_protected BOOLEAN,
  scheduler_available BOOLEAN,
  checked_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF _actor_user_id IS NULL THEN
    RAISE EXCEPTION 'invalid_admin_system_query' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.user_roles AS actor_role
    JOIN public.role_permissions AS permission
      ON permission.role = actor_role.role
    WHERE actor_role.user_id = _actor_user_id
      AND actor_role.role = 'admin'::public.app_role
      AND permission.permission_key = 'admin.system.read'
  ) THEN
    RAISE EXCEPTION 'insufficient_permissions' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    TRUE,
    EXISTS (
      SELECT 1
      FROM storage.buckets AS bucket
      WHERE bucket.id = 'vault-attachments'
        AND bucket.public = FALSE
    ),
    COALESCE((
      SELECT relation.relrowsecurity
        AND relation.relforcerowsecurity
        AND EXISTS (
          SELECT 1
          FROM pg_catalog.pg_trigger AS row_trigger
          WHERE row_trigger.tgrelid = relation.oid
            AND row_trigger.tgname = 'prevent_admin_audit_log_row_mutation'
            AND row_trigger.tgenabled IN ('O', 'A')
            AND row_trigger.tgfoid = 'public.prevent_admin_audit_log_mutation()'::pg_catalog.regprocedure
            AND row_trigger.tgtype = 27
        )
        AND EXISTS (
          SELECT 1
          FROM pg_catalog.pg_trigger AS truncate_trigger
          WHERE truncate_trigger.tgrelid = relation.oid
            AND truncate_trigger.tgname = 'prevent_admin_audit_log_truncate'
            AND truncate_trigger.tgenabled IN ('O', 'A')
            AND truncate_trigger.tgfoid = 'public.prevent_admin_audit_log_mutation()'::pg_catalog.regprocedure
            AND truncate_trigger.tgtype = 34
        )
      FROM pg_catalog.pg_class AS relation
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public'
        AND relation.relname = 'admin_audit_log'
    ), FALSE),
    EXISTS (
      SELECT 1
      FROM pg_catalog.pg_extension AS extension
      WHERE extension.extname = 'pg_cron'
    ),
    pg_catalog.now();
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_system_status(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_system_status(UUID)
  TO service_role;

COMMENT ON FUNCTION public.get_admin_system_status(UUID) IS
  'Service-role-only evidence-based system status with database-level admin authorization and no topology details.';
