# Security Critical Files (Encryption/Decryption)

Diese Liste markiert die wichtigsten sicherheitskritischen Dateien im Projekt.
Änderungen hier immer mit besonderer Vorsicht, Tests und Review.

## 1) Core Crypto (Client)

- `src/services/cryptoService.ts`
  - Master-Passwort KDF (Argon2id), AES-GCM Encrypt/Decrypt, Vault-Item Encrypt/Decrypt, Re-Encryption.
- `src/services/pqCryptoService.ts`
  - Hybrid-PQ-Kryptografie (ML-KEM-768 + RSA), Wrap/Unwrap, Versionierung der Ciphertexte.
- `src/services/keyMaterialService.ts`
  - Provisionierung von RSA/PQ-Keymaterial, Verschlüsselung privater Schlüssel.
- `src/services/passkeyService.ts`
  - WebAuthn/PRF-Key-Wrapping und Entschlüsselung für Passkey-Unlock.

## 2) Vault State / Unlock Flow

- `src/contexts/VaultContext.tsx`
  - Unlock/Lock-Logik, Key-Lebenszyklus im Speicher, KDF-Migration, decryptItem/encryptItem Pfad.
- `src/components/vault/VaultUnlock.tsx`
  - UI-Einstieg für Master-Passwort- und Passkey-Unlock.

## 3) Sharing / Emergency Key Exchange

- `src/services/collectionService.ts`
  - Shared-Collection-Key Handling inkl. Hybrid-PQ-Wrapping.
- `src/services/emergencyAccessService.ts`
  - Notfallzugang-Key-Handling inkl. PQ-verschlüsseltem Master-Key.

## 4) Edge Function Auth + Sensitive Endpoints

- `src/services/edgeFunctionService.ts`
  - Authentifizierte Function-Calls mit JWT-Prüfung/Refresh und Error-Normalisierung.
- `supabase/functions/webauthn/index.ts`
  - Serverseitiger WebAuthn-Flow (Challenge, Verify, Credential-Handling).
- `supabase/functions/invite-family-member/index.ts`
  - Familien-Invite Endpoint (Auth, Berechtigungen, Limits, Mailversand).
- `supabase/functions/invite-emergency-access/index.ts`
  - Notfall-Invite Endpoint (Auth, Validierung, Mailversand).
- `supabase/functions/_shared/cors.ts`
  - CORS-Regeln für Function-Zugriff.

## 5) DB Schema / Security Constraints (Supabase)

- `supabase/migrations/20260212004634_add_post_quantum_keys.sql`
  - PQ-Spalten für Profiles/Emergency/Collection Keys.
- `supabase/migrations/20260217213000_security_standard_v1_profiles_and_hybrid_constraints.sql`
  - Security-Standard-v1 Constraints (PQ/Hybrid Pflichtbedingungen).
- `supabase/migrations/20260217230000_validate_security_standard_v1_constraints.sql`
  - Validierung und Mirror-Constraint für Hybrid-Key-Felder.
- `supabase/migrations/20260210181000_emergency_access_keys.sql`
  - Schlüsselstruktur für Emergency Access.
- `supabase/migrations/20260210181100_emergency_access_policies.sql`
  - Sicherheits-/Zugriffsregeln für Emergency Access.

## 6) Zugehörige Tests (sicherheitsrelevant)

- `src/services/pqCryptoService.test.ts`
- `src/test/encryption-roundtrip.test.ts`
- `src/test/encryption-edge-cases.test.ts`
- `src/test/kdf-reencryption.test.ts`
- `src/test/integration-crypto-pipeline.test.ts`
- `src/services/__tests__/collectionService.test.ts`
- `src/services/__tests__/emergencyAccessService.test.ts`
- `src/services/__tests__/keyMaterialService.test.ts`
- `src/services/edgeFunctionService.test.ts`

