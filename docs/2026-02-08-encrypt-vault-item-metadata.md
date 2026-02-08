# Encrypt Vault Item Metadata (2026-02-08)

## Summary
- `title` and `website_url` are now stored inside encrypted vault payload (`encrypted_data`).
- Database metadata columns no longer store plaintext values for new/updated items.
- Legacy plaintext metadata is migrated automatically when items are loaded in an unlocked vault.

## Code Changes
- `src/services/cryptoService.ts`
  - Extended `VaultItemData` with encrypted metadata fields:
    - `title`
    - `websiteUrl`
  - Extended `secureClear(...)` to wipe these fields.

- `src/components/vault/VaultItemDialog.tsx`
  - On save, writes `title` + normalized URL into encrypted payload.
  - Persists DB metadata as placeholders:
    - `title = 'Encrypted Item'`
    - `website_url = null`
  - On load, supports legacy fallback to plaintext columns if metadata is not yet in encrypted payload.

- `src/components/vault/VaultItemList.tsx`
  - Uses decrypted `title`/`websiteUrl` for search.
  - Automatically migrates legacy plaintext metadata into encrypted payload, then clears plaintext columns.

- `src/components/vault/VaultItemCard.tsx`
  - Uses decrypted metadata for display and external URL action.

- `src/components/settings/DataSettings.tsx`
  - Export now resolves title/URL from encrypted data when available.
  - Import writes title/URL into encrypted payload and stores placeholder metadata in DB columns.

## Database Migration
- `supabase/migrations/20260208143000_encrypt_vault_item_metadata_defaults.sql`
  - Sets default `vault_items.title` to `Encrypted Item`.
  - Clears `website_url` for already placeholder-tagged rows.

## Security Impact
- Reduces metadata leakage risk from database-only exposure.
- Legacy rows are upgraded opportunistically in-app after unlock without data loss.
