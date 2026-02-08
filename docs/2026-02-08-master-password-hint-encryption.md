# Master Password Hint Encryption Fix (2026-02-08)

## Summary
- The `master_password_hint` is no longer stored in plaintext.
- Hints are now encrypted client-side before being written to `profiles.master_password_hint`.
- Encryption uses the already-derived vault key (from the user's master password).

## Technical Changes
- File changed: `src/contexts/VaultContext.tsx`
- Added encrypted hint format prefix: `enc:v1:`.
- During setup (`setupMasterPassword`):
  - Optional hint is encrypted with AES-GCM via existing `encrypt(...)` helper.
  - Only encrypted payload is persisted to Supabase.
- During unlock (`unlock`):
  - Encrypted hint is decrypted using the derived master key.
  - Legacy plaintext hints are detected and migrated to encrypted storage after successful unlock.
- On lock (`lock`):
  - Decrypted hint is cleared from runtime state.

## Security Impact
- Reduces risk from database-only data exposure by removing plaintext hint storage.
- Keeps encryption/decryption in the existing zero-knowledge flow.
- Preserves backward compatibility with automatic migration of old plaintext records.

## Notes
- Existing plaintext hints are encrypted automatically after the next successful unlock.
- If hint decryption fails, unlock still succeeds; hint display is suppressed for safety.
