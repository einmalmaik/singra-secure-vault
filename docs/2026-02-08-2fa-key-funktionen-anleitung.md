# 2FA Key-Funktionen Anleitung (2026-02-08)

## Zweck
Diese Anleitung erklärt, wie die neuen 2FA-Key-Funktionen genutzt werden:
- verschlüsselte Speicherung von `user_2fa`-Secrets
- sichere Key-Rotation

## Architektur in Kurzform
- `private.app_secrets` enthält den Server-Key `totp_encryption_key`.
- `public.user_2fa.totp_secret_enc` enthält verschlüsselte 2FA-Secrets.
- Direkter Klartext-Zugriff auf `totp_secret` wird nicht mehr genutzt.
- Zugriff erfolgt über Security-Definer-Funktionen:
  - `public.initialize_user_2fa_secret(...)`
  - `public.get_user_2fa_secret(...)`
  - `public.rotate_totp_encryption_key(...)`

## Einmalige Einrichtung
1. Migrationen ausführen:
   - `20260208152000_encrypt_user_2fa_totp_secret.sql`
   - `20260208161000_add_totp_key_rotation.sql`
2. Falls noch nicht gesetzt: Key anlegen
```sql
select encode(gen_random_bytes(32), 'hex') as k;

insert into private.app_secrets (name, value)
values ('totp_encryption_key', 'HIER_64_HEX_KEY')
on conflict (name) do update set value = excluded.value;
```

## Laufender Betrieb
- App nutzt intern:
  - Setup: `initialize_user_2fa_secret`
  - Lesen/Verifizieren: `get_user_2fa_secret`
- User müssen nichts tun, kein zusätzlicher User-Key nötig.

## Key-Rotation
1. Vorher prüfen:
```sql
select count(*) as encrypted_rows
from public.user_2fa
where totp_secret_enc is not null;

select count(*) as legacy_plaintext_rows
from public.user_2fa
where totp_secret is not null;
```
2. Neuen Key erzeugen:
```sql
select encode(gen_random_bytes(32), 'hex') as new_key;
```
3. Rotation ausführen:
```sql
select public.rotate_totp_encryption_key('NEUER_64_HEX_KEY') as rotated_rows;
```
4. Nachher prüfen:
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

## Wichtige Hinweise
- Key nie in Client-Variablen (`VITE_*`) speichern.
- Key zusätzlich außerhalb der DB sichern (Secret Manager/Passwortmanager).
- Alten Key bis zur erfolgreichen Validierung aufbewahren.
- Rotation möglichst außerhalb von Stoßzeiten ausführen.

## Fehlerfälle
- `Missing secret private.app_secrets(totp_encryption_key)`:
  - Key fehlt in `private.app_secrets`.
- `Invalid key format: expected 64 hex chars`:
  - Key ist nicht korrekt formatiert.
- Bei fehlender Entschlüsselung funktionieren 2FA-Validierungen nicht korrekt.

## Schneller Health-Check
```sql
select count(*) as enabled_2fa
from public.user_2fa
where is_enabled = true;

select count(*) as encrypted_present
from public.user_2fa
where totp_secret_enc is not null;
```
