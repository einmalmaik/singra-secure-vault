# TOTP Key Rotation Runbook (2026-02-08)

## Goal
Rotate the server-side encryption key used for `public.user_2fa.totp_secret_enc` without losing existing 2FA data.

## Prerequisites
- Migration `20260208152000_encrypt_user_2fa_totp_secret.sql` already applied.
- New migration `20260208161000_add_totp_key_rotation.sql` applied.
- Access with elevated SQL privileges (owner/service role).

## 1) Pre-checks
```sql
select count(*) as encrypted_rows
from public.user_2fa
where totp_secret_enc is not null;

select count(*) as legacy_plaintext_rows
from public.user_2fa
where totp_secret is not null;
```

## 2) Generate new key
```sql
select encode(gen_random_bytes(32), 'hex') as new_key;
```
- Store this key securely outside DB before rotation.

## 3) Rotate key
```sql
select public.rotate_totp_encryption_key('PASTE_NEW_64_HEX_KEY_HERE') as rotated_rows;
```

## 4) Verify
```sql
select name, length(value) as len
from private.app_secrets
where name = 'totp_encryption_key';

select count(*) as encrypted_rows_after
from public.user_2fa
where totp_secret_enc is not null;

select count(*) as legacy_plaintext_rows_after
from public.user_2fa
where totp_secret is not null;
```
Expected:
- `len = 64`
- encrypted rows still present
- plaintext rows should be `0`

## Operational Notes
- Rotation is atomic inside one function call. On failure, transaction rolls back.
- Do not rotate during major auth incidents.
- Keep old key temporarily in secure backup until you validate logins and vault unlock flows.
- Never store this key in client-side env (`VITE_*`).

## Rollback Strategy
- If rotation fails: no change should persist (transaction rollback).
- If rotation succeeds but app issues occur: rotate again to previous key value (if retained in secure backup).
