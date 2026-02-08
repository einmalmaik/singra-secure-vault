# Vault Legal Footer & Navigation Update (2026-02-08)

## Summary
- Added a minimal legal footer to the vault page for quick access to required legal links.
- Added a direct "Startseite/Home" action in the vault header.
- Existing landing navigation already provides the reverse path back to `/vault` for authenticated users.

## Code Changes
- `src/pages/VaultPage.tsx`
  - Added `Link` import from `react-router-dom`.
  - Added a header action button linking to `/` (`nav.home`).
  - Added a minimal footer with links/buttons for:
    - Privacy (`/privacy`)
    - Impressum (`/impressum`)
    - Cookie settings trigger (`singra:open-cookie-settings` event)

## UX Result
- Logged-in users can now go from vault to start page in one click.
- From start page, logged-in users can already return to vault via the existing header vault button.

## Scope
- Kept intentionally minimal (no extra sections, no heavy redesign).
