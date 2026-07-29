-- Allow filtering audit reads for protection-rule mutations.
CREATE OR REPLACE FUNCTION public.list_admin_audit_events(
  _actor_user_id UUID,
  _limit INTEGER DEFAULT 50,
  _event_type TEXT DEFAULT NULL,
  _outcome TEXT DEFAULT NULL
)
RETURNS TABLE (
  actor_user_id UUID,
  target_user_id UUID,
  event_type TEXT,
  outcome TEXT,
  detail_code TEXT,
  reason_code TEXT,
  occurred_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF _actor_user_id IS NULL OR _limit IS NULL OR _limit < 1 OR _limit > 100 THEN
    RAISE EXCEPTION 'invalid_admin_audit_query' USING ERRCODE = '22023';
  END IF;

  IF _event_type IS NOT NULL AND _event_type NOT IN (
    'team.role.changed',
    'team.permission.changed',
    'user.lifecycle.changed',
    'user.deleted',
    'security.rule.changed'
  ) THEN
    RAISE EXCEPTION 'invalid_admin_audit_event_type' USING ERRCODE = '22023';
  END IF;

  IF _outcome IS NOT NULL AND _outcome NOT IN (
    'started', 'succeeded', 'failed', 'denied'
  ) THEN
    RAISE EXCEPTION 'invalid_admin_audit_outcome' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.user_roles AS actor_role
    JOIN public.role_permissions AS permission
      ON permission.role = actor_role.role
    WHERE actor_role.user_id = _actor_user_id
      AND actor_role.role = 'admin'
      AND permission.permission_key = 'admin.audit.read'
  ) THEN
    RAISE EXCEPTION 'insufficient_permissions' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    audit.actor_user_id,
    audit.target_user_id,
    audit.event_type,
    audit.outcome,
    audit.detail_code,
    audit.reason_code,
    audit.occurred_at
  FROM public.admin_audit_log AS audit
  WHERE (_event_type IS NULL OR audit.event_type = _event_type)
    AND (_outcome IS NULL OR audit.outcome = _outcome)
  ORDER BY audit.occurred_at DESC, audit.id DESC
  LIMIT _limit;
END;
$$;