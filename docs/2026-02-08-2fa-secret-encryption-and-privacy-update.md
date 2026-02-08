# 2FA Secret Encryption At Rest (2026-02-08)

## Summary
- Implemented server-side encryption at rest for `user_2fa.totp_secret`.
- App code no longer reads/writes plaintext TOTP secret directly from table rows.
- Added privacy policy updates in EN/DE to explicitly describe encrypted 2FA secret handling.

## Database Changes
- Migration: `supabase/migrations/20260208152000_encrypt_user_2fa_totp_secret.sql`
- Adds `totp_secret_enc` column to `user_2fa`.
- Makes legacy `totp_secret` nullable and migrates existing plaintext secrets into encrypted storage.
- Sets legacy plaintext column to `NULL` after migration.
- Adds secure RPCs:
  - `initialize_user_2fa_secret(p_user_id, p_secret)`
  - `get_user_2fa_secret(p_user_id, p_require_enabled)`
- Uses `pgcrypto` (`pgp_sym_encrypt` / `pgp_sym_decrypt`) with DB setting:
  - `app.settings.totp_encryption_key`

## Application Changes
- `src/services/twoFactorService.ts`
  - `initializeTwoFactorSetup(...)` now calls RPC `initialize_user_2fa_secret`.
  - `getTOTPSecret(...)` now calls RPC `get_user_2fa_secret`.
  - `enableTwoFactor(...)` validates against secret retrieved via RPC.

- `src/integrations/supabase/types.ts`
  - Added typed function definitions for the two new RPCs.

## Privacy Policy Updates
- `src/i18n/locales/en.json`
  - Added explicit note that 2FA/TOTP secret is collected in encrypted form.
  - Added explicit note for server-side encryption of stored 2FA/TOTP secrets.

- `src/i18n/locales/de.json`
  - Added equivalent disclosure in German.

## Operational Requirement
- Before applying migration in production, configure DB setting:
  - `app.settings.totp_encryption_key`
- Without this setting, migration intentionally fails to prevent insecure fallback.
