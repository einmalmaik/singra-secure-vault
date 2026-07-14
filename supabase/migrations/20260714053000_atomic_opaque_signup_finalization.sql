-- Atomically finalize an OTP-confirmed OPAQUE signup.
CREATE OR REPLACE FUNCTION public.finish_opaque_signup(
  p_registration_id UUID,
  p_user_id UUID,
  p_email TEXT,
  p_registration_record TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now TIMESTAMPTZ := pg_catalog.now();
  v_email TEXT := pg_catalog.lower(pg_catalog.btrim(p_email));
  v_challenge public.opaque_registration_challenges%ROWTYPE;
BEGIN
  IF p_registration_id IS NULL
    OR p_user_id IS NULL
    OR v_email = ''
    OR p_registration_record IS NULL
    OR p_registration_record = ''
  THEN
    RAISE EXCEPTION 'invalid_opaque_signup_finish' USING ERRCODE = '22023';
  END IF;

  SELECT challenge.*
  INTO v_challenge
  FROM public.opaque_registration_challenges AS challenge
  WHERE challenge.id = p_registration_id
    AND challenge.user_id = p_user_id
    AND pg_catalog.lower(pg_catalog.btrim(challenge.email)) = v_email
    AND challenge.purpose = 'signup'
    AND challenge.consumed_at IS NULL
    AND challenge.expires_at > v_now
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_or_expired_signup_challenge' USING ERRCODE = 'P0002';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM auth.users AS auth_user
    WHERE auth_user.id = p_user_id
      AND pg_catalog.lower(pg_catalog.btrim(auth_user.email::TEXT)) = v_email
      AND auth_user.email_confirmed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'signup_email_not_confirmed' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.user_opaque_records AS existing_record
    WHERE existing_record.opaque_identifier = v_email
      AND existing_record.user_id <> p_user_id
  ) THEN
    RAISE EXCEPTION 'OPAQUE_RECORD_CONFLICT' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.user_opaque_records (
    user_id,
    opaque_identifier,
    registration_record,
    updated_at
  )
  VALUES (p_user_id, v_email, p_registration_record, v_now)
  ON CONFLICT (user_id) DO UPDATE
  SET opaque_identifier = EXCLUDED.opaque_identifier,
      registration_record = EXCLUDED.registration_record,
      updated_at = EXCLUDED.updated_at;

  UPDATE auth.users
  SET encrypted_password = NULL,
      updated_at = v_now
  WHERE id = p_user_id;

  UPDATE public.profiles
  SET auth_protocol = 'opaque'
  WHERE profiles.user_id = p_user_id;

  DELETE FROM public.user_security
  WHERE id = p_user_id;

  UPDATE public.opaque_registration_challenges
  SET consumed_at = v_now
  WHERE id = p_registration_id;

  RETURN p_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.finish_opaque_signup(UUID, UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_opaque_signup(UUID, UUID, TEXT, TEXT)
  TO service_role;

COMMENT ON FUNCTION public.finish_opaque_signup(UUID, UUID, TEXT, TEXT) IS
  'Atomically consumes one confirmed signup challenge, stores the OPAQUE record and disables direct GoTrue password login.';
