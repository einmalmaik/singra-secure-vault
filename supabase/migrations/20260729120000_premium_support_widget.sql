-- Premium-owned Singra support widget configuration and webhook delivery state.
-- The widget identifier is public. Webhook payloads and guest PII are never stored.

ALTER TABLE public.admin_platform_settings
  ADD COLUMN IF NOT EXISTS support_widget_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS support_widget_id TEXT;

ALTER TABLE public.admin_platform_settings
  DROP CONSTRAINT IF EXISTS admin_platform_settings_support_widget_id_check;
ALTER TABLE public.admin_platform_settings
  ADD CONSTRAINT admin_platform_settings_support_widget_id_check
  CHECK (
    support_widget_id IS NULL
    OR support_widget_id ~ '^[A-Za-z0-9_-]{1,128}$'
  );

CREATE TABLE IF NOT EXISTS public.singra_webhook_deliveries (
  event_id TEXT PRIMARY KEY
    CHECK (event_id ~ '^[A-Za-z0-9_-]{1,128}$'),
  event_type TEXT NOT NULL
    CHECK (event_type IN ('ticket_created', 'ticket_replied', 'webhook_test')),
  status TEXT NOT NULL
    CHECK (status IN ('processing', 'delivered', 'failed')),
  received_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
  processed_at TIMESTAMPTZ,
  failure_code TEXT
    CHECK (failure_code IS NULL OR failure_code ~ '^[A-Z][A-Z0-9_]{0,63}$')
);

ALTER TABLE public.singra_webhook_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.singra_webhook_deliveries FORCE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.singra_webhook_deliveries
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_public_support_widget_config()
RETURNS TABLE (
  enabled BOOLEAN,
  widget_id TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    settings.support_widget_enabled
      AND settings.support_widget_id IS NOT NULL,
    COALESCE(settings.support_widget_id, '')
  FROM public.admin_platform_settings AS settings
  WHERE settings.singleton = TRUE;
$$;

CREATE OR REPLACE FUNCTION public.claim_singra_webhook_event(
  _event_id TEXT,
  _event_type TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  affected_rows INTEGER := 0;
  existing_status TEXT;
  existing_event_type TEXT;
BEGIN
  IF _event_id IS NULL
    OR _event_id !~ '^[A-Za-z0-9_-]{1,128}$'
    OR _event_type NOT IN ('ticket_created', 'ticket_replied', 'webhook_test')
  THEN
    RAISE EXCEPTION 'invalid_singra_webhook_claim' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.singra_webhook_deliveries (
    event_id,
    event_type,
    status
  )
  VALUES (_event_id, _event_type, 'processing')
  ON CONFLICT (event_id) DO NOTHING;

  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  IF affected_rows = 1 THEN
    RETURN 'claimed';
  END IF;

  UPDATE public.singra_webhook_deliveries
  SET status = 'processing',
      received_at = pg_catalog.now(),
      processed_at = NULL,
      failure_code = NULL
  WHERE event_id = _event_id
    AND event_type = _event_type
    AND (
      status = 'failed'
      OR (
        status = 'processing'
        AND received_at < pg_catalog.now() - INTERVAL '10 minutes'
      )
    );

  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  IF affected_rows = 1 THEN
    RETURN 'claimed';
  END IF;

  SELECT delivery.status, delivery.event_type
  INTO existing_status, existing_event_type
  FROM public.singra_webhook_deliveries AS delivery
  WHERE delivery.event_id = _event_id;

  IF existing_event_type IS DISTINCT FROM _event_type THEN
    RETURN 'duplicate';
  END IF;
  IF existing_status = 'delivered' THEN
    RETURN 'delivered';
  END IF;
  RETURN 'processing';
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_singra_webhook_event(
  _event_id TEXT,
  _status TEXT,
  _failure_code TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF _event_id IS NULL
    OR _event_id !~ '^[A-Za-z0-9_-]{1,128}$'
    OR _status NOT IN ('delivered', 'failed')
    OR (
      _failure_code IS NOT NULL
      AND _failure_code !~ '^[A-Z][A-Z0-9_]{0,63}$'
    )
  THEN
    RAISE EXCEPTION 'invalid_singra_webhook_finish' USING ERRCODE = '22023';
  END IF;

  UPDATE public.singra_webhook_deliveries
  SET status = _status,
      processed_at = pg_catalog.now(),
      failure_code = CASE WHEN _status = 'failed' THEN _failure_code ELSE NULL END
  WHERE event_id = _event_id
    AND status = 'processing';
END;
$$;

REVOKE ALL ON FUNCTION public.get_public_support_widget_config()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.claim_singra_webhook_event(TEXT, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.finish_singra_webhook_event(TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.get_public_support_widget_config()
  TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_singra_webhook_event(TEXT, TEXT)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_singra_webhook_event(TEXT, TEXT, TEXT)
  TO service_role;

COMMENT ON TABLE public.singra_webhook_deliveries IS
  'PII-free deduplication and delivery status for signed Singra support webhook events.';
COMMENT ON FUNCTION public.get_public_support_widget_config() IS
  'Service-role-only source for the public enabled/widgetId Premium support contract.';
COMMENT ON FUNCTION public.claim_singra_webhook_event(TEXT, TEXT) IS
  'Atomically claims a new or previously failed Singra webhook event.';
COMMENT ON FUNCTION public.finish_singra_webhook_event(TEXT, TEXT, TEXT) IS
  'Marks a claimed Singra webhook event delivered or retryable without storing payload data.';
