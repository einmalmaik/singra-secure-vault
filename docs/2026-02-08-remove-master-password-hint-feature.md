# Remove Master Password Hint Feature (2026-02-08)

## Summary
- Removed the master password hint feature from setup and unlock UI.
- Stopped reading/storing hints in active vault flow.
- Cleared existing persisted hints in the database via migration.

## Code Changes
- `src/contexts/VaultContext.tsx`
  - Removed hint state and hint-related encrypt/decrypt logic.
  - `setupMasterPassword(...)` now accepts only the master password.
  - Profile setup no longer writes `master_password_hint`.
  - Unlock flow no longer processes or exposes any hint value.
- `src/components/vault/MasterPasswordSetup.tsx`
  - Removed hint input field and related state.
- `src/components/vault/VaultUnlock.tsx`
  - Removed hint display toggle and hint rendering.
- `src/i18n/locales/en.json`
  - Removed `auth.masterPassword.hint`, `auth.masterPassword.hintHelp`, `auth.unlock.forgot`.
- `src/i18n/locales/de.json`
  - Removed `auth.masterPassword.hint`, `auth.masterPassword.hintHelp`, `auth.unlock.forgot`.

## Database Migration
- `supabase/migrations/20260208132000_remove_master_password_hints.sql`
  - Sets all existing `profiles.master_password_hint` values to `NULL`.

## Security Impact
- Eliminates hint-based information disclosure risk.
- Enforces policy: if master password is forgotten, vault data remains unrecoverable.
