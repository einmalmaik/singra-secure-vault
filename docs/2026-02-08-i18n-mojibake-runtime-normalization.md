# i18n Mojibake Runtime Normalization (2026-02-08)

## Problem
- German locale strings showed mojibake artifacts in UI (e.g. `PasswÃ¶rter`, `HÃ¶chste`).
- The issue affected many keys, so manual per-string fixes were not robust.

## Solution
- Updated `src/i18n/index.ts`:
  - Added `decodeMojibakeString(...)` to repair common UTF-8/Latin1 mojibake sequences.
  - Added `normalizeLocaleObject(...)` to recursively normalize all locale strings at load time.
  - Applied normalization to both locale resources before i18next init.
  - Replaced broken language flags with explicit Unicode escapes:
    - DE: `\u{1F1E9}\u{1F1EA}`
    - EN: `\u{1F1EC}\u{1F1E7}`

## Why this approach
- Fixes widespread legacy encoding artifacts centrally.
- Avoids fragile one-off text patches across hundreds of keys.
- Keeps future maintenance simple and safe.
