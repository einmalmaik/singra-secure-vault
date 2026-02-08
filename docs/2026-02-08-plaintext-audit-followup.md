# Additional Plaintext Audit & Encryption (2026-02-08)

## Scope
Follow-up audit after encrypting vault item metadata (`title`, `website_url`).

## Implemented in this step

### Encrypted `categories.name`
- Category names are now encrypted client-side before writing to DB.
- Encrypted format uses prefix: `enc:cat:v1:`.

Changed files:
- `src/components/vault/CategoryDialog.tsx`
  - On create/update, category `name` is encrypted via `encryptData(...)`.

- `src/components/vault/VaultSidebar.tsx`
  - On fetch, category names are decrypted for display.
  - Legacy plaintext names are auto-migrated to encrypted values.

- `src/components/vault/VaultItemDialog.tsx`
  - Category selector now decrypts category names.
  - Legacy plaintext names are auto-migrated on fetch.

## Security impact
- Category labels are no longer stored in plaintext at rest.
- Legacy plaintext category rows are migrated opportunistically when loaded in an unlocked vault.

## Residual plaintext audit notes
- `user_2fa.totp_secret` is still stored plaintext in current architecture.
- Secure migration of `totp_secret` to true at-rest encryption requires server-side key handling (e.g., Edge Function / KMS-backed encryption), because login-time 2FA verification happens before vault unlock and therefore cannot rely on master-password key.
