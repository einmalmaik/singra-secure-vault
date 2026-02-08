# Final Plaintext Audit Checklist (2026-02-08)

## Ziel
Pruefen, dass unnoetiger Klartext in App-Daten minimiert wurde.

## Erwartete Schutzlage nach allen neuen Migrationen
- `vault_items.encrypted_data` enthaelt sensible Vault-Daten inkl. Titel/URL.
- `vault_items.encrypted_data` enthaelt sensible Vault-Metadaten inkl. `itemType`, `isFavorite`, `categoryId`.
- `categories.name/icon/color` werden als `enc:cat:v1:...` gespeichert (oder null fuer icon/color).
- `user_2fa.totp_secret_enc` enthaelt verschluesseltes Secret.
- `user_2fa.totp_secret` sollte leer (`NULL`) sein.
- `profiles.master_password_hint` ist `NULL`.
- `profiles.display_name/avatar_url` sind auf `NULL` gesetzt.
- `vaults.name` ist auf technischen Placeholder reduziert.
- `tags.name/color` werden als `enc:tag:v1:...` gespeichert.

## SQL-Checks
```sql
-- 1) Master hint entfernt
select count(*) as hints_left
from public.profiles
where master_password_hint is not null;

-- 2) Vault item metadata plaintext reduziert
select count(*) as vault_meta_plain
from public.vault_items
where title <> 'Encrypted Item' or website_url is not null;

select count(*) as vault_item_type_plain
from public.vault_items
where item_type <> 'password';

select count(*) as vault_is_favorite_plain
from public.vault_items
where is_favorite is true;

select count(*) as vault_category_plain
from public.vault_items
where category_id is not null;

select count(*) as vault_icon_url_plain
from public.vault_items
where icon_url is not null;

-- 3) Kategorien plaintext reduziert
select count(*) as categories_name_plain
from public.categories
where name is not null and name not like 'enc:cat:v1:%';

select count(*) as categories_icon_plain
from public.categories
where icon is not null and icon not like 'enc:cat:v1:%';

select count(*) as categories_color_plain
from public.categories
where color is not null and color not like 'enc:cat:v1:%';

-- 4) 2FA secret plaintext reduziert
select count(*) as user_2fa_plain_secret
from public.user_2fa
where totp_secret is not null;

select count(*) as user_2fa_missing_encrypted
from public.user_2fa
where is_enabled = true and totp_secret_enc is null;

-- 5) Tag plaintext reduziert
select count(*) as tags_name_plain
from public.tags
where name is not null and name not like 'enc:tag:v1:%';

select count(*) as tags_color_plain
from public.tags
where color is not null and color not like 'enc:tag:v1:%';

-- 6) Profil-PII minimiert
select count(*) as profiles_plain_pii
from public.profiles
where display_name is not null or avatar_url is not null;
```

## Wichtiger Hinweis (Architektur)
Eine strikt perfekte Zero-Knowledge-Architektur ist mit dem aktuellen relationalen Modell nicht vollstaendig erreicht,
weil einige strukturierende Felder technisch im Klartext bleiben muessen (z.B. IDs, Zeitstempel, teilweise Flags/Enums fuer App-Logik).
Die wirklich sensiblen Inhalte wurden aber konsequent auf verschluesselte Speicherung bzw. Hashing migriert.
