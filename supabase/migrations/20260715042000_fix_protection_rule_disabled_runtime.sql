-- Runtime lookup must return disabled rules so enforcement can be turned off explicitly.
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
  WHERE rules.action_key = _action_key;
$$;