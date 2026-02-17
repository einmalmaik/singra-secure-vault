# Post-Quantum Default Path (Sharing + Emergency)

## Overview

This change set makes hybrid post-quantum key protection the default write path for:

1. Shared Collections key exchange
2. Emergency Access key exchange

Hybrid means ML-KEM-768 + RSA-4096.

## Why

The previous UI flow could fail for accounts without pre-provisioned `user_keys` rows and relied on browser `window.prompt` for master password input in one path.

## What changed

1. Added `src/services/keyMaterialService.ts`:
   - `ensureUserRsaKeyMaterial(...)`
   - `ensureUserPqKeyMaterial(...)`
   - `ensureHybridKeyMaterial(...)`
   - `isMasterPasswordRequiredError(...)`
2. Shared Collections creation now:
   - uses `ensureHybridKeyMaterial(...)`
   - uses controlled password dialog (no `window.prompt`)
   - writes new collections via hybrid wrapping
3. Passkey PRF activation now targets a specific credential ID:
   - client sends expected credential
   - edge function scopes options and validates credential use
4. Emergency Access flow now checks profile update errors explicitly and provisions hybrid material during setup when master password is provided.
5. Added `pq_enforced_at` to generated Supabase types.

## Compatibility

1. New writes are hybrid-first.
2. Existing legacy RSA read paths remain for compatibility.

## Validation

Validated with:

1. Targeted ESLint on changed files
2. Vitest suites for:
   - `keyMaterialService`
   - `PasskeySettings`
   - `collectionService`
   - `emergencyAccessService`
3. Production build (`npm run build`)
