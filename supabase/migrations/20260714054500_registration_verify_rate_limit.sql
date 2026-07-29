-- Add a dedicated account-and-IP bound bucket for signup OTP verification.
ALTER TABLE public.rate_limit_attempts
  DROP CONSTRAINT IF EXISTS rate_limit_attempts_action_check;

ALTER TABLE public.rate_limit_attempts
  ADD CONSTRAINT rate_limit_attempts_action_check
  CHECK (
    action IN (
      'unlock',
      '2fa',
      'passkey',
      'emergency',
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
  );
