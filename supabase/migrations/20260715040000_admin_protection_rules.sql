-- Server-authoritative auth protection rules for the admin security center.
INSERT INTO public.team_permissions (permission_key, label, description, category)
VALUES (
  'admin.security.manage',
  'Manage Security Protection Rules',
  'Configure aggregate auth throttling rules without exposing identifiers or Vault data.',
  'admin'
)
ON CONFLICT (permission_key) DO UPDATE
SET label = EXCLUDED.label,
    description = EXCLUDED.description,
    category = EXCLUDED.category;

INSERT INTO public.role_permissions (role, permission_key)
VALUES ('admin', 'admin.security.manage')
ON CONFLICT (role, permission_key) DO NOTHING;

CREATE TABLE public.admin_protection_rules (
  action_key TEXT PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  max_attempts INTEGER NOT NULL,
  window_seconds INTEGER NOT NULL,
  lockout_seconds INTEGER NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT admin_protection_rules_action_key_check CHECK (
    action_key IN (
      'password_login',
      'recovery_request',
      'recovery_verify',
      'totp_verify',
      'backup_code_verify',
      'login_totp_verify',
      'login_backup_code_verify',
      'password_reset_totp_verify',
      'password_reset_backup_code_verify',
      'vault_totp_verify',
      'vault_backup_code_verify',
      'disable_2fa_verify',
      'critical_2fa_verify',
      'opaque_login',
      'opaque_reset',
      'opaque_register',
      'opaque_register_verify',
      'account_delete',
      'webauthn_challenge',
      'webauthn_verify',
      'webauthn_manage',
      'vault_recovery_code_redeem'
    )
  ),
  CONSTRAINT admin_protection_rules_max_attempts_check CHECK (max_attempts BETWEEN 1 AND 50),
  CONSTRAINT admin_protection_rules_window_seconds_check CHECK (window_seconds BETWEEN 60 AND 86400),
  CONSTRAINT admin_protection_rules_lockout_seconds_check CHECK (lockout_seconds BETWEEN 60 AND 604800)
);

ALTER TABLE public.admin_protection_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_protection_rules FORCE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.admin_protection_rules
  FROM PUBLIC, anon, authenticated, service_role;

INSERT INTO public.admin_protection_rules (action_key, enabled, max_attempts, window_seconds, lockout_seconds)
VALUES
  ('password_login', TRUE, 5, 900, 900),
  ('recovery_request', TRUE, 5, 900, 3600),
  ('recovery_verify', TRUE, 5, 900, 3600),
  ('totp_verify', TRUE, 5, 300, 900),
  ('backup_code_verify', TRUE, 5, 1800, 3600),
  ('login_totp_verify', TRUE, 5, 300, 900),
  ('login_backup_code_verify', TRUE, 5, 1800, 3600),
  ('password_reset_totp_verify', TRUE, 5, 300, 1800),
  ('password_reset_backup_code_verify', TRUE, 5, 1800, 3600),
  ('vault_totp_verify', TRUE, 5, 300, 900),
  ('vault_backup_code_verify', TRUE, 5, 1800, 3600),
  ('disable_2fa_verify', TRUE, 3, 600, 3600),
  ('critical_2fa_verify', TRUE, 3, 600, 3600),
  ('opaque_login', TRUE, 5, 900, 900),
  ('opaque_reset', TRUE, 5, 900, 3600),
  ('opaque_register', TRUE, 5, 900, 3600),
  ('opaque_register_verify', TRUE, 5, 900, 3600),
  ('account_delete', TRUE, 3, 600, 3600),
  ('webauthn_challenge', TRUE, 10, 600, 600),
  ('webauthn_verify', TRUE, 5, 600, 1800),
  ('webauthn_manage', TRUE, 30, 600, 600),
  ('vault_recovery_code_redeem', TRUE, 5, 1800, 3600)
ON CONFLICT (action_key) DO NOTHING;

ALTER TABLE public.admin_audit_log
  DROP CONSTRAINT IF EXISTS admin_audit_log_event_type_check;

ALTER TABLE public.admin_audit_log
  ADD CONSTRAINT admin_audit_log_event_type_check CHECK (
    event_type IN (
      'team.role.changed',
      'team.permission.changed',
      'user.lifecycle.changed',
      'user.deleted',
      'security.rule.changed'
    )
  );

CREATE OR REPLACE FUNCTION public.list_admin_protection_rules(
  _actor_user_id UUID
)
RETURNS TABLE (
  action_key TEXT,
  enabled BOOLEAN,
  max_attempts INTEGER,
  window_seconds INTEGER,
  lockout_seconds INTEGER,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF _actor_user_id IS NULL THEN
    RAISE EXCEPTION 'invalid_admin_protection_rules_query' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.user_roles AS actor_role
    JOIN public.role_permissions AS permission
      ON permission.role = actor_role.role
    WHERE actor_role.user_id = _actor_user_id
      AND actor_role.role = 'admin'
      AND permission.permission_key = 'admin.security.read'
  ) THEN
    RAISE EXCEPTION 'insufficient_permissions' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    rules.action_key,
    rules.enabled,
    rules.max_attempts,
    rules.window_seconds,
    rules.lockout_seconds,
    rules.updated_at
  FROM public.admin_protection_rules AS rules
  ORDER BY rules.action_key ASC;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_admin_protection_rule(
  _actor_user_id UUID,
  _action_key TEXT,
  _enabled BOOLEAN,
  _max_attempts INTEGER,
  _window_seconds INTEGER,
  _lockout_seconds INTEGER
)
RETURNS TABLE (
  action_key TEXT,
  enabled BOOLEAN,
  max_attempts INTEGER,
  window_seconds INTEGER,
  lockout_seconds INTEGER,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  detail_code TEXT;
BEGIN
  IF _actor_user_id IS NULL
    OR _action_key IS NULL
    OR _enabled IS NULL
    OR _max_attempts IS NULL
    OR _window_seconds IS NULL
    OR _lockout_seconds IS NULL
  THEN
    RAISE EXCEPTION 'invalid_admin_protection_rule_payload' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.user_roles AS actor_role
    JOIN public.role_permissions AS permission
      ON permission.role = actor_role.role
    WHERE actor_role.user_id = _actor_user_id
      AND actor_role.role = 'admin'
      AND permission.permission_key = 'admin.security.manage'
  ) THEN
    RAISE EXCEPTION 'insufficient_permissions' USING ERRCODE = '42501';
  END IF;

  IF _action_key NOT IN (
    'password_login', 'recovery_request', 'recovery_verify', 'totp_verify',
    'backup_code_verify', 'login_totp_verify', 'login_backup_code_verify',
    'password_reset_totp_verify', 'password_reset_backup_code_verify',
    'vault_totp_verify', 'vault_backup_code_verify', 'disable_2fa_verify',
    'critical_2fa_verify', 'opaque_login', 'opaque_reset', 'opaque_register',
    'opaque_register_verify', 'account_delete', 'webauthn_challenge',
    'webauthn_verify', 'webauthn_manage', 'vault_recovery_code_redeem'
  ) THEN
    RAISE EXCEPTION 'invalid_protection_rule_action' USING ERRCODE = '22023';
  END IF;

  IF _max_attempts < 1 OR _max_attempts > 50
    OR _window_seconds < 60 OR _window_seconds > 86400
    OR _lockout_seconds < 60 OR _lockout_seconds > 604800
  THEN
    RAISE EXCEPTION 'invalid_protection_rule_bounds' USING ERRCODE = '22023';
  END IF;

  UPDATE public.admin_protection_rules AS rules
  SET
    enabled = _enabled,
    max_attempts = _max_attempts,
    window_seconds = _window_seconds,
    lockout_seconds = _lockout_seconds,
    updated_at = pg_catalog.now()
  WHERE rules.action_key = _action_key;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown_protection_rule_action' USING ERRCODE = 'P0002';
  END IF;

  detail_code := 'RULE_' || pg_catalog.upper(pg_catalog.replace(_action_key, '-', '_'));

  PERFORM public.append_admin_audit_event(
    pg_catalog.gen_random_uuid(),
    _actor_user_id,
    NULL,
    'security.rule.changed',
    'succeeded',
    detail_code,
    NULL
  );

  RETURN QUERY
  SELECT
    rules.action_key,
    rules.enabled,
    rules.max_attempts,
    rules.window_seconds,
    rules.lockout_seconds,
    rules.updated_at
  FROM public.admin_protection_rules AS rules
  WHERE rules.action_key = _action_key;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_auth_protection_rule(
  _action_key TEXT
)
RETURNS TABLE (
  enabled BOOLEAN,
  max_attempts INTEGER,
  window_seconds INTEGER,
  lockout_seconds INTEGER
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    rules.enabled,
    rules.max_attempts,
    rules.window_seconds,
    rules.lockout_seconds
  FROM public.admin_protection_rules AS rules
  WHERE rules.action_key = _action_key
    AND rules.enabled = TRUE;
$$;

REVOKE ALL ON FUNCTION public.list_admin_protection_rules(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_admin_protection_rules(UUID)
  TO service_role;

REVOKE ALL ON FUNCTION public.set_admin_protection_rule(UUID, TEXT, BOOLEAN, INTEGER, INTEGER, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_admin_protection_rule(UUID, TEXT, BOOLEAN, INTEGER, INTEGER, INTEGER)
  TO service_role;

REVOKE ALL ON FUNCTION public.get_auth_protection_rule(TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_auth_protection_rule(TEXT)
  TO service_role;

COMMENT ON TABLE public.admin_protection_rules IS
  'Server-side auth throttling rule storage. Contains no identifiers, network data or Vault material.';
COMMENT ON FUNCTION public.list_admin_protection_rules(UUID) IS
  'Service-role-only read contract for configured auth protection rules with database-level admin authorization.';
COMMENT ON FUNCTION public.set_admin_protection_rule(UUID, TEXT, BOOLEAN, INTEGER, INTEGER, INTEGER) IS
  'Service-role-only manage contract with bounds validation and append-only audit.';
COMMENT ON FUNCTION public.get_auth_protection_rule(TEXT) IS
  'Service-role-only runtime lookup for enabled auth protection rules.';