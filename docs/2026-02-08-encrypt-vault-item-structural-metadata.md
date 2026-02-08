# Encrypt Vault Item Structural Metadata (2026-02-08)

## Summary
- Moved additional `vault_items` metadata into encrypted payload (`encrypted_data`):
  - `itemType`
  - `isFavorite`
  - `categoryId`
- Added cleanup for plaintext `icon_url` at write/migration paths.
- Updated filtering, category counts, export/import, and category delete handling to use decrypted metadata.

## Code Changes
- `src/services/cryptoService.ts`
  - Extended `VaultItemData` with `itemType`, `isFavorite`, `categoryId`.
- `src/components/vault/VaultItemDialog.tsx`
  - Reads type/favorite/category from decrypted payload (fallback to legacy columns).
  - Stores type/favorite/category only in encrypted payload.
  - Writes DB placeholders: `item_type='password'`, `is_favorite=false`, `category_id=null`, `icon_url=null`.
- `src/components/vault/VaultItemList.tsx`
  - Filters by decrypted metadata.
  - Lazy-migrates legacy plaintext columns into encrypted payload.
  - Clears plaintext columns (`title`, `website_url`, `icon_url`, `item_type`, `is_favorite`, `category_id`) after migration.
- `src/components/vault/VaultItemCard.tsx`
  - Renders icon/favorite/type from decrypted metadata.
- `src/components/vault/VaultSidebar.tsx`
  - Category counts now computed from decrypted `categoryId`.
  - Includes lazy metadata migration + plaintext cleanup.
- `src/components/vault/CategoryDialog.tsx`
  - On category delete, clears encrypted `categoryId` references in vault items and cleans legacy columns.
- `src/components/settings/DataSettings.tsx`
  - Export resolves type/favorite/category from decrypted payload.
  - Import stores metadata in encrypted payload and keeps DB metadata columns as placeholders.

## Database Migration
- `supabase/migrations/20260208184500_clear_vault_item_icon_url_plaintext.sql`
  - Sets `public.vault_items.icon_url` to `NULL` for existing rows.

## Security Impact
- Reduces additional metadata leakage at-rest from DB-only compromise scenarios.
- Keeps relational/technical fields required for operation (IDs, timestamps, ownership references) unchanged.
