# SingraPW Security Hardening Plan

> Erstellt: 2026-02-11
> Basierend auf: Vollständigem Code-Audit + Recherche zu Bitwarden, LastPass, KeePass, 1Password Schwachstellen
> Ziel: SingraPW sicherer machen als die Konkurrenz, bekannte Angriffsvektoren eliminieren
> 
> **Phase 1: ABGESCHLOSSEN (2026-02-11)**
> - 1.1 Backup-Codes CSPRNG: `src/services/twoFactorService.ts` - Math.random() durch crypto.getRandomValues() mit Rejection Sampling ersetzt
> - 1.2 Clipboard Auto-Clear: Neuer `src/services/clipboardService.ts` - 30s Timer, nur löscht wenn noch eigener Inhalt. Integriert in VaultItemCard, TOTPDisplay, PasswordGenerator, TwoFactorSettings. Locale-Keys in DE+EN hinzugefügt.
> - 1.3 Key-Bytes Zeroing: `src/services/cryptoService.ts` - deriveKey() nutzt try/finally mit keyBytes.fill(0). secureClear() Kommentar erweitert.
> - 1.4 Security Headers: `vite.config.ts` - Permissions-Policy und X-Permitted-Cross-Domain-Policies hinzugefügt.

---

## Phase 0: Aktueller Sicherheitsstatus (IST-Zustand)

### Was SingraPW bereits richtig macht

| Eigenschaft | Implementierung | Dateien | Bewertung |
|---|---|---|---|
| Key Derivation | Argon2id (64 MiB, 3 iter, p=4) | `src/services/cryptoService.ts:14-18` | Gut (besser als Bitwarden-Standard PBKDF2) |
| Symmetrische Verschl. | AES-256-GCM, 12-byte IV, 128-bit Tag | `src/services/cryptoService.ts:99-161` | Industriestandard |
| CryptoKey-Schutz | non-extractable via Web Crypto API | `src/services/cryptoService.ts:93` | Stark |
| Zero-Knowledge | Master-PW verlässt nie den Client | `src/services/cryptoService.ts:8` | Korrekt |
| Salt | CSPRNG via crypto.getRandomValues(), 16 byte | `src/services/cryptoService.ts:28-30` | Korrekt |
| IV-Generierung | Frisch pro Encryption, CSPRNG | `src/services/cryptoService.ts:113` | Korrekt |
| Key-Speicherung | Nur React useState, nie persistiert | `src/contexts/VaultContext.tsx:99` | Stark |
| Auto-Lock | 15 Min Standard, konfigurierbar | `src/contexts/VaultContext.tsx:33` | Gut |
| RLS | Auf ALLEN Tabellen mit auth.uid() | Alle Migrations in `supabase/migrations/` | Solide |
| TOTP at-rest | pgp_sym_encrypt(AES-256) in private Schema | `supabase/migrations/20260208152000_*` | Über Standard |
| Metadaten-Minimierung | Titel, Avatar, Vault-Namen bereinigt | Migrations `20260208143000` bis `20260208184500` | Lehre aus LastPass |
| PW-Hint entfernt | Spalte auf NULL gesetzt | `supabase/migrations/20260208132000_*` | Gut |
| Asymmetrisch | RSA-4096 + RSA-OAEP + SHA-256 | `src/services/cryptoService.ts:288-504` | Stark |
| PW-Generator | CSPRNG + Rejection Sampling | `src/services/passwordGenerator.ts:220-237` | Korrekt |
| Service Worker | Cached nur App-Shell, keine sensiblen Daten | `public/sw.js` | Korrekt |
| Stripe Webhook | Signaturprüfung aktiv | `supabase/functions/stripe-webhook/index.ts:40` | Korrekt |
| Preisvalidierung | Server-seitig, Client kann nichts manipulieren | `supabase/functions/create-checkout-session/index.ts:5-6` | Korrekt |
| CSP | script-src 'self' (prod), frame-ancestors 'none' | `vite.config.ts:18-29` | Gut |
| Account-Löschung | Atomarer Cascade via SECURITY DEFINER | `supabase/migrations/20260207111500_*` | Korrekt |

### Bekannte Konkurrenz-Schwachstellen die uns NICHT betreffen

| Schwachstelle | Betroffen | Warum nicht bei uns |
|---|---|---|
| LastPass: Unverschlüsselte URLs im Vault | LastPass | Wir haben Metadaten in encrypted_data verlagert |
| LastPass: Niedrige KDF-Iterationen (PBKDF2 100k) | LastPass | Wir nutzen Argon2id mit 64 MiB RAM |
| Bitwarden: Autofill-Iframe-Attacke | Bitwarden | Wir haben keine Browser-Extension |
| KeePass: Config-File Memory-Leak | KeePass | Wir sind web-basiert, keine lokale Config |
| LastPass: Geteilte Vaults unter einem Master-PW | LastPass | Shared Collections haben eigene AES-Keys |

---

## ABGESCHLOSSEN: Phase 1: Quick Wins (1-2 Tage)

### 1.1 KRITISCH: Backup-Codes von Math.random() auf CSPRNG umstellen

**Datei:** `src/services/twoFactorService.ts:107-122`

**Aktueller Code (UNSICHER):**
```typescript
// Zeile 114
const randomIndex = Math.floor(Math.random() * chars.length);
```

**Problem:** `Math.random()` ist kein kryptographisch sicherer Zufallsgenerator. Die Ausgabe ist vorhersagbar, wenn der interne State bekannt ist. Bei einem Passwort-Manager ist das inakzeptabel.

**Vergleich:** Der eigene `passwordGenerator.ts` nutzt bereits `crypto.getRandomValues()` mit Rejection Sampling (Zeile 220-237). Die Backup-Code-Generierung wurde offenbar übersehen.

**Fix:** Die Funktion `getSecureRandomInt()` aus `passwordGenerator.ts` wiederverwenden oder `crypto.getRandomValues()` direkt einsetzen.

**Betroffene Funktion:** `generateBackupCodes()` (Zeile 107-122)

---

### 1.2 KRITISCH: Clipboard-Auto-Clear nach 30 Sekunden

**Dateien:**
- `src/components/vault/VaultItemCard.tsx:87` — Passwort-/Username-Copy
- `src/components/vault/TOTPDisplay.tsx:57` — TOTP-Code-Copy
- `src/components/vault/PasswordGenerator.tsx:69` — Generiertes Passwort-Copy
- `src/components/settings/TwoFactorSettings.tsx:199` — 2FA-Secret-Copy

**Aktueller Code:** Alle vier Stellen nutzen `navigator.clipboard.writeText(text)` ohne jegliche Bereinigung danach.

**Problem:** Kopierte Passwörter bleiben unbegrenzt im System-Clipboard. Jede App oder Malware kann sie lesen. Clipboard-History-Manager (Windows 10/11 Win+V) speichern sie permanent.

**Vergleich:** Bitwarden löscht nach 30s, 1Password nach 60s, KeePass nach 12s (konfigurierbar).

**Fix:** Zentrale Utility-Funktion erstellen die nach `writeText()` einen `setTimeout` mit 30s setzt der das Clipboard leert. Nur leeren wenn der aktuelle Clipboard-Inhalt noch der kopierte Wert ist (um User-Clipboard nicht zu überschreiben).

---

### 1.3 HOCH: Intermediate Key-Bytes nach Import zeroen

**Datei:** `src/services/cryptoService.ts:40-78`

**Aktueller Code:**
```typescript
// deriveRawKey() gibt keyBytes zurück (Zeile 62)
return keyBytes;

// deriveKey() nutzt es (Zeile 76-77)
const keyBytes = await deriveRawKey(masterPassword, saltBase64);
return importMasterKey(keyBytes);
// keyBytes wird NICHT gezeroed!
```

**Problem:** Die rohen Schlüsselbytes (`Uint8Array`) verbleiben im Speicher bis der Garbage Collector sie entfernt. Das kann Sekunden bis Minuten dauern. Memory-Dump-Attacken (wie KeePass CVE-2023-32784) können diese Bytes auslesen.

**Fix:** In `deriveKey()` nach dem `importMasterKey()`-Aufruf: `keyBytes.fill(0)` aufrufen. Zusätzlich die lokale `hashHex`-Variable in `deriveRawKey()` auf `''` setzen (wobei Strings in JS immutable sind — Hinweis im Kommentar).

**Limitierung:** JavaScript-GC macht echtes Memory-Wiping schwierig. `keyBytes.fill(0)` überschreibt aber den ArrayBuffer in-place, was effektiv ist.

---

### 1.4 MITTEL: Permissions-Policy Header hinzufügen

**Datei:** `vite.config.ts:17-33`

**Aktueller Stand:** Es fehlen die Header `Permissions-Policy` und `X-Permitted-Cross-Domain-Policies`.

**Fix:** Zum Return-Objekt in `getSecurityHeaders()` hinzufügen:
```
"Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()"
"X-Permitted-Cross-Domain-Policies": "none"
```

**Warum:** Verhindert dass eingebettete Inhalte oder XSS-Payloads auf Hardware-APIs zugreifen.

---

## Phase 2: Wichtige Härtung (1 Woche) — ✅ KOMPLETT (11.02.2026)

### 2.1 HOCH: Rate-Limiting beim Vault-Unlock — ✅ ERLEDIGT

**Datei:** `src/contexts/VaultContext.tsx:295-346` (unlock-Funktion)

**Aktueller Stand:** Keine Begrenzung der Unlock-Versuche. Zwar ist Argon2id langsam (~300ms), aber ein automatisierter Angriff mit Headless-Browser oder direkt über die JS-Console kann unbegrenzt versuchen.

**Plan:**
- State-Variable `failedAttempts` und `lockoutUntil` hinzufügen
- Nach 5 Fehlversuchen: 30 Sekunden Sperre
- Nach 10 Fehlversuchen: 5 Minuten Sperre
- Nach 20 Fehlversuchen: 30 Minuten Sperre
- Exponentielles Backoff: `min(30 * 2^(floor(attempts/5)), 1800)` Sekunden
- Counter im sessionStorage (überlebt keinen Tab-Wechsel)
- Optional: Visuelles Countdown-UI für den User

**Betroffene Funktion:** `unlock()` Callback (Zeile 295-346)

---

### 2.2 HOCH: Atomare Collection Key-Rotation — ✅ ERLEDIGT

**Datei:** `src/services/collectionService.ts:555-585`

**Aktueller Code (Zeile 555):**
```typescript
// 9. Update database (transaction-like)
```
Der Kommentar sagt "transaction-like" aber es sind sequenzielle Einzel-Operations:
1. Items update (Zeile 558-565)
2. Keys delete (Zeile 568-573)
3. Keys insert (Zeile 576-580)

**Problem:** Wenn Schritt 2 (delete) erfolgreich ist aber Schritt 3 (insert) fehlschlägt, sind alle Collection-Keys gelöscht und die Collection ist unwiderruflich verloren. Zeile 584 acknowledged das sogar: `"Collection may be in inconsistent state."`

**Fix:** Eine Supabase RPC-Funktion (SECURITY DEFINER) erstellen die alle drei Schritte in einer PostgreSQL-Transaction ausführt:
```sql
CREATE OR REPLACE FUNCTION rotate_collection_key(
    p_collection_id UUID,
    p_items JSONB,      -- [{id, encrypted_data}]
    p_new_keys JSONB    -- [{collection_id, user_id, wrapped_key}]
)
RETURNS void AS $$
BEGIN
    -- Update items
    -- Delete old keys
    -- Insert new keys
    -- Alles atomar
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

---

### 2.3 HOCH: Backup-Code-Hashing mit Salt — ✅ ERLEDIGT

**Datei:** `src/services/twoFactorService.ts`

**Implementierung (11.02.2026):**

1. **`hashBackupCode(code, salt?)`** — Bereits in Phase 2 Vorarbeit umgestellt auf HMAC-SHA-256 wenn ein Salt übergeben wird, mit Fallback auf unsalted SHA-256 für Legacy-Hashes.

2. **`getUserEncryptionSalt(userId)`** — Neue interne Hilfsfunktion (Zeile ~197), die `encryption_salt` aus der `profiles`-Tabelle lädt. Wird von allen 3 Callern verwendet.

3. **`enableTwoFactor`** — Ruft jetzt `getUserEncryptionSalt()` auf und übergibt das Salt an `hashBackupCode()`. Neue Backup-Codes werden immer mit HMAC-SHA-256 gespeichert.

4. **`regenerateBackupCodes`** — Analog: Holt Salt, hasht mit HMAC-SHA-256.

5. **`verifyAndConsumeBackupCode`** — Dual-Verify-Strategie implementiert:
   - Berechnet HMAC-SHA-256-Hash (neuer sicherer Pfad)
   - Berechnet zusätzlich Legacy-SHA-256-Hash
   - Sucht in `backup_codes` nach beiden Kandidaten-Hashes (`IN`-Query)
   - Wenn Legacy-Hash matcht, wird der Code trotzdem konsumiert (transparente Migration)
   - Neue Codes (nach Regenerierung/Aktivierung) sind automatisch HMAC-gesichert

6. **Keine DB-Migration nötig**: Die `backup_codes`-Tabelle bleibt unverändert. Legacy-Hashes werden beim nächsten Regenerieren oder bei der nächsten 2FA-Aktivierung automatisch durch HMAC-Hashes ersetzt.

7. **Keine Komponenten-Änderungen nötig**: Die Salt-Beschaffung passiert intern im Service. `TwoFactorSettings`, `VaultUnlock`, `Auth` sind unverändert.

---

### 2.4 MITTEL: File-Attachment-Metadaten verschlüsseln — ✅ ERLEDIGT

**Datei:** `src/services/fileAttachmentService.ts`

**Implementierung (11.02.2026):**

1. **`encrypted_metadata`-Spalte** hinzugefügt via Migration `20260211220000_add_encrypted_metadata_column.sql`. Speichert AES-256-GCM verschlüsseltes JSON `{"file_name":"...","mime_type":"..."}`.

2. **`uploadAttachment`** — Verschlüsselt jetzt `file_name` und `mime_type` in `encrypted_metadata`. Die Klartext-Spalten werden mit Platzhaltern befüllt (`"encrypted"` / `"application/octet-stream"`).

3. **`getAttachments`** — Akzeptiert nun optionale `decryptFn` und entschlüsselt `encrypted_metadata` transparent. Legacy-Zeilen (ohne `encrypted_metadata`) funktionieren weiterhin.

4. **`downloadAttachment`** — Entschlüsselt Metadaten für korrekten Dateinamen und MIME-Typ beim Browser-Download.

5. **FileAttachments-Komponente** — Übergibt jetzt `decryptData` aus VaultContext an `getAttachments`.

6. **Keine Komponenten-Änderungen am Interface** — Die `FileAttachment`-Schnittstelle bleibt gleich, Entschlüsselung passiert transparent im Service.

---

### 2.5 MITTEL: Passphrase-Wortliste erweitern — ✅ ERLEDIGT

**Datei:** `src/services/passwordGenerator.ts`, `src/services/wordlists.ts` (NEU)

**Implementierung (11.02.2026):**

1. **EFF Short Wordlist 2.0** (1.296 Wörter) als dediziertes Modul `src/services/wordlists.ts` angelegt. Quelle: https://www.eff.org/dice, CC BY 3.0.

2. **`passwordGenerator.ts`** — Importiert jetzt `EFF_SHORT_WORDLIST` statt der alten 88-Wörter-Liste. Entropie-Gewinn: 4 Wörter steigen von ~25.8 Bit auf ~41.4 Bit (60% mehr Entropie).

3. **Rückwärtskompatibilität** — Keine UI-Änderungen nötig. Die `generatePassphrase()`-Funktion funktioniert identisch, nur mit besserem Wortpool.

4. **Bundle-Impact** — ~15 KB zusätzlich (gzip: ~5 KB). Akzeptabler Trade-off für signifikant stärkere Passphrases.

---

### 2.6 MITTEL: CORS auf eigene Domain einschränken — ✅ ERLEDIGT

**Dateien:**
- `supabase/functions/_shared/cors.ts` (NEU — geteiltes CORS-Modul)
- Alle 7 Edge Functions: `create-checkout-session`, `cancel-subscription`, `create-portal-session`, `accept-family-invitation`, `invite-family-member`, `invite-emergency-access`, `send-test-mail`

**Implementierung (11.02.2026):**

1. **Shared CORS module** — `supabase/functions/_shared/cors.ts` erstellt. Liest `ALLOWED_ORIGIN` aus Deno-Umgebungsvariable. Fallback auf `"*"` wenn nicht gesetzt (lokale Entwicklung).

2. **Alle 7 Edge Functions** — Lokale `corsHeaders`-Deklaration entfernt, importieren jetzt `{ corsHeaders } from "../_shared/cors.ts"`.

3. **`stripe-webhook`** — Nicht betroffen (hat kein CORS, korrekt für Server-zu-Server Stripe-Webhooks).

4. **Deployment-Hinweis:** In der Supabase-Projektumgebung muss `ALLOWED_ORIGIN` auf die Produktions-Domain gesetzt werden (z.B. `https://singra.pw`). Über Supabase Dashboard: Settings → Edge Functions → Secrets.

---

## Phase 3: KDF & Migration (1-2 Wochen) — ✅ KOMPLETT (11.02.2026)

### 3.1 Argon2id-Parameter erhöhen: 64 MiB -> 128 MiB — ✅ ERLEDIGT

**Dateien:**
- `src/services/cryptoService.ts` — KDF-Versioning-System
- `supabase/migrations/20260211230000_add_kdf_version.sql` (NEU)

**Implementierung (11.02.2026):**

1. **KDF-Versioning-System** — `KDF_PARAMS` Record mit versionierten Parametersätzen:
   - **v1**: 64 MiB, 3 iter, p=4 (aktuell, für bestehende User)
   - **v2**: 128 MiB, 3 iter, p=4 (OWASP 2025 Enhanced, für neue User und nach Migration)

2. **`CURRENT_KDF_VERSION = 2`** — Neue Konten starten direkt mit v2.

3. **`deriveRawKey(password, salt, kdfVersion)`** und **`deriveKey(password, salt, kdfVersion)`** — Akzeptieren jetzt einen optionalen `kdfVersion`-Parameter (Default: 1 für Rückwärtskompatibilität).

4. **`attemptKdfUpgrade(password, salt, currentVersion)`** — Neue Funktion:
   - Prüft ob aktuelle Version < `CURRENT_KDF_VERSION`
   - Leitet neuen Key mit stärkeren Parametern ab
   - Erstellt neuen Verifier
   - Bei OOM/Fehler: Silent-Skip, User bleibt auf alter Version
   - Gibt `KdfUpgradeResult` zurück mit `upgraded`, `newKey`, `newVerifier`, `activeVersion`

5. **DB-Migration** — `kdf_version INTEGER NOT NULL DEFAULT 1` zu `profiles` hinzugefügt. Deployed.

**Design-Entscheidungen (basierend auf Recherche):**
- **Salt bleibt gleich** — Rotation nicht nötig bei Parameteränderung
- **Kein `navigator.deviceMemory`** — Nur Chromium (~6% Nutzung), unzuverlässig. Stattdessen try-catch für OOM-Erkennung
- **Automatisch statt manuell** — Anders als Bitwarden (manuelle Änderung in Settings). LastPass-Breach zeigte: Manuelle Migration führt dazu, dass Millionen User auf schwachen Parametern bleiben
- **Parameter sind immutable** — Einmal veröffentlichte Versionen werden nie geändert, nur neue hinzugefügt

---

### 3.2 KDF-Version-Auto-Migration-System — ✅ ERLEDIGT

**Datei:** `src/contexts/VaultContext.tsx`

**Implementierung (11.02.2026):**

1. **`checkSetup`** — Lädt jetzt `kdf_version` aus der DB (Default: 1 für bestehende User ohne Spalte).

2. **`setupMasterPassword`** — Neue User starten mit `CURRENT_KDF_VERSION` (v2, 128 MiB). Speichert `kdf_version` in der DB.

3. **`unlock`** — Nach erfolgreichem Unlock:
   ```
   verifyKey(verifier, keyV1) → Erfolg → attemptKdfUpgrade(password, salt, v1)
     → deriveKey(password, salt, v2) → createVerificationHash(newKey)
     → UPDATE profiles SET master_password_verifier=..., kdf_version=2
     → setEncryptionKey(newKey) // sofort den neuen Key verwenden
     → saveOfflineCredentials(userId, salt, newVerifier) // Cache aktualisieren
   ```

4. **Fehlertoleranz:**
   - OOM bei Argon2id 128 MiB → Silent-Skip, User bleibt auf v1
   - DB-Update fehlschlägt → Old Key wird weiterverwendet, kein Datenverlust
   - Offline → Kein Upgrade-Versuch (kein Netzwerk), normaler Unlock mit cached v1 Verifier

5. **Keine UI-Änderungen** — Migration ist komplett transparent. Kein Toast, kein Dialog. Nur ein `console.info` im DevTools-Log.

---

## Phase 4: Fortgeschrittene Features (2-4 Wochen) — ✅ KOMPLETT (12.02.2026)

### 4.1 WebAuthn/FIDO2 als zusätzlicher Unlock-Faktor — ✅ ERLEDIGT

**Implementierung (11.02.2026):**

Passkey-basierter Vault-Unlock mit WebAuthn PRF Extension. Zero-Knowledge-Architektur:
Der PRF-Output wird verwendet, um den AES-256 Vault-Key zu wrappen/unwrappen.
Das Master-Passwort bleibt als Fallback jederzeit verfügbar.

**Architektur (wie Bitwarden, aber mit HKDF-Verbesserung):**
1. **Registrierung** (Vault muss unlocked sein):
   - User gibt Master-Passwort ein → `deriveRawKey()` → 32-byte AES Key
   - Browser: `navigator.credentials.create()` mit `prf.eval.first = salt`
   - PRF-Output (32 bytes) → HKDF-SHA-256 → AES-256-GCM Wrapping-Key
   - Raw Key-Bytes werden mit dem Wrapping-Key verschlüsselt (IV || CT || Tag)
   - Credential + verschlüsselter Key werden in `passkey_credentials` gespeichert

2. **Unlock** (Vault ist locked):
   - Browser: `navigator.credentials.get()` mit `prf.eval.first = salt`
   - PRF-Output (32 bytes) → HKDF-SHA-256 → AES-256-GCM Wrapping-Key
   - Verschlüsselter Key wird entschlüsselt → `importMasterKey()` → non-extractable CryptoKey
   - Vault unlocked — kein Master-Passwort nötig!

**Warum NICHT XOR (alter Plan):**
Der alte Plan schlug `finalKey = argon2Key XOR prfKey` vor. Das funktioniert nicht,
weil beim Passkey-Unlock kein Argon2-Key existiert (kein Passwort wird eingegeben).
Stattdessen wird der Key direkt gewrappt — wie bei Bitwarden.

**Sicherheitsgarantien:**
- PRF-Output existiert nur im Authenticator (TPM/Secure Enclave) + transient im Browser
- HKDF-SHA-256 mit Domain-Separation (`SingraPW-PasskeyWrappingKey-v1`)
- AES-256-GCM für Key-Wrapping (12-byte IV, 128-bit Auth-Tag)
- Der importierte CryptoKey ist non-extractable (gleich wie passwort-abgeleitet)
- Server sieht nie den unverschlüsselten Key (Zero-Knowledge)
- PRF-Salt wird server-seitig mit CSPRNG generiert (32 bytes)
- Challenges werden server-seitig gespeichert (5 Min TTL)
- Signature-Counter für Clone-Detection

**Dateien:**
- `supabase/migrations/20260211240000_add_passkey_credentials.sql` — DB-Schema
- `supabase/functions/webauthn/index.ts` — Edge Function (SimpleWebAuthn v13 via JSR)
- `src/services/passkeyService.ts` — Client-Side PRF + Key-Wrapping
- `src/contexts/VaultContext.tsx` — `unlockWithPasskey()`, `getRawKeyForPasskey()`
- `src/components/vault/VaultUnlock.tsx` — Passkey-Unlock-Button mit Fingerprint-Icon
- `src/components/settings/PasskeySettings.tsx` — Passkey-Verwaltung
- `src/components/settings/SecuritySettings.tsx` — PasskeySettings eingebunden

**Browser-Support (PRF):**
- Chrome 108+ (Windows Hello, Android 14+): ✅ Voll
- Safari 16.4+ (macOS/iOS 18+): ✅ Voll
- Firefox 122+: ✅ Voll
- Security Keys: YubiKey 5.7+ (FIDO2.1), Nitrokey 3

**Fallback:**
- Wenn Authenticator kein PRF unterstützt → Registrierung erfolgt, aber ohne Vault-Unlock
- Master-Passwort funktioniert immer als Alternative
- PRF-Status wird pro Credential angezeigt

---

### 4.2 Secure Memory Wrapper (SecureBuffer) — ✅ ERLEDIGT

**Implementierung (12.02.2026):**

Mitigiert Memory-Dump-Attacken (KeePass CVE-2023-32784) im Rahmen der JavaScript-Möglichkeiten.

**Architektur:**
```typescript
class SecureBuffer {
    private buffer: Uint8Array;
    private destroyed = false;

    constructor(data: Uint8Array) {
        this.buffer = new Uint8Array(data);
        data.fill(0); // Original sofort löschen
        registry.register(this, this.buffer); // Auto-cleanup via FinalizationRegistry
    }

    use<T>(fn: (data: Uint8Array) => T): T {
        if (this.destroyed) throw new Error('SecureBuffer: already disposed');
        return fn(this.buffer);
    }

    dispose(): void {
        this.buffer.fill(0);
        this.destroyed = true;
    }
}
```

**Features:**
- **`FinalizationRegistry`** — Automatisches Zeroing falls `dispose()` vergessen wird (GC-Trigger)
- **Callback-basierter Zugriff** — Verhindert versehentliche Referenz-Leaks
- **`clear()`** — Setzt alle Bytes auf 0 ohne den Buffer zu invalidieren
- **`subarray()`** — Sichere View ohne Kopie, wird mit Original disposed
- **20 Unit-Tests** — Alle bestanden

**Dateien:**
- `src/services/secureBuffer.ts` — SecureBuffer-Klasse
- `src/services/secureBuffer.test.ts` — Unit-Tests
- `src/services/cryptoService.ts` — `deriveRawKeySecure()` gibt SecureBuffer zurück

**Limitierung:** JavaScript hat keine echte Speicherverwaltung. `fill(0)` überschreibt den ArrayBuffer in-place, was gegen naive Memory-Dumps hilft, aber keinen Schutz gegen Heap-Snapshots mit V8-Internals bietet.

---

### 4.3 Vault-Integrity-Checks (Tamper Detection) — ✅ ERLEDIGT

**Implementierung (12.02.2026):**

Schützt gegen kompromittierte Server oder Supabase-Admins die verschlüsselte Daten manipulieren (Items löschen, Ciphertext austauschen, Rollback-Attacken).

**Architektur:**
1. **Integrity-Key:** HKDF-SHA-256 aus Master-Key mit Domain-Separation `SingraPW-IntegrityKey-v1`
2. **Item-Hashes:** Jedes Item → `SHA-256(itemId || encrypted_data || created_at)`
3. **Merkle-Tree:** Flat-Array-Implementierung, paarweise SHA-256-Hashes bis zum Root
4. **Root-Speicherung:** AES-256-GCM verschlüsselt mit Integrity-Key in `vault_integrity_hashes`
5. **Verifikation:** Bei jedem Vault-Load: Tree neu berechnen, mit gespeichertem Root vergleichen

**Features:**
- **Tamper Detection:** Erkennt Änderungen, Löschungen, Hinzufügungen von Items
- **Rollback-Schutz:** Root-Hash inkludiert Timestamp der letzten Änderung
- **16 Unit-Tests:** Merkle-Tree-Korrektheit, Tamper-Detection, Round-Trip-Encryption

**Dateien:**
- `src/services/vaultIntegrityService.ts` — Integrity-Service
- `src/services/vaultIntegrityService.test.ts` — Unit-Tests

**Warum Merkle-Tree statt einfacher Hash:**
- Bei großen Vaults (1000+ Items) können inkrementelle Updates nur betroffene Zweige neu hashen
- Ermöglicht zukünftige Sync-Protokolle (Partial-Vault-Sync mit Integritätsprüfung)
- Standard-Architektur bei Git, Bitcoin, IPFS — gut verstanden und analysiert

---

## Phase 5: Zukunftssicherung (langfristig)

### 5.1 Post-Quantum-Hybridverschlüsselung

**Warum:** "Harvest now, decrypt later" — Geheimdienste und Angreifer können heute verschlüsselte Daten sammeln und warten bis Quantum-Computer RSA-4096 brechen können. NIST hat im August 2024 ML-KEM (Kyber) als FIPS 203 standardisiert.

**Betrifft:**
- Emergency Access: RSA-4096 Verschlüsselung des Master-Keys (`src/services/cryptoService.ts:292-367`)
- Shared Collections: RSA-4096 Key-Wrapping (`src/services/cryptoService.ts:380-504`)

**Plan:** Hybrides Schema einführen:
```
encryptedData = ML-KEM-768(plaintext) || RSA-OAEP-4096(plaintext)
```
Beide Verschlüsselungen unabhängig. Zur Entschlüsselung reicht eine (Fallback falls PQ-Library Probleme macht). Der Empfänger speichert beide Key-Paare.

**Library-Optionen:** `@noble/post-quantum` (JavaScript-native ML-KEM), `liboqs` (WASM-Wrapper)

**Signalwirkung:** "Erster Post-Quantum-ready Passwort-Manager aus Deutschland"

---

### 5.2 Panic/Duress-Passwort

**Warum:** Schutz bei physischer Bedrohung oder Erpressung (Grenzkontrollen, Zwang). Plausible Deniability.

**Architektur:**
1. User setzt ein zweites "Duress-Passwort"
2. Dieses leitet einen separaten Argon2id-Key ab (eigener Salt)
3. Damit werden 0-5 Dummy-Items verschlüsselt (konfigurierbar)
4. Bei Eingabe des Duress-PW: Vault öffnet sich normal, zeigt aber nur Dummy-Items
5. Optional: Stille Benachrichtigung an Notfallkontakt

**Anforderung:** Von außen DARF nicht erkennbar sein ob das echte oder das Duress-PW eingegeben wurde. Gleiche UI, gleiche Timing-Charakteristik, gleiche Anzahl DB-Queries.

---

### 5.3 OPAQUE-Protokoll für Server-Auth (Langfrist-Vision)

**Warum:** Aktuell wird das Supabase-Auth-Passwort (für Login) getrennt vom Master-Passwort verwaltet. Mit OPAQUE könnte das Master-Passwort gleichzeitig zur Server-Authentifizierung UND zur Vault-Verschlüsselung genutzt werden — ohne dass der Server jemals das Passwort sieht (auch nicht als Hash).

**Status:** OPAQUE ist noch kein IETF-Standard (Draft), aber bereits in der Praxis bei Signal und WhatsApp im Einsatz.

**Komplexität:** Hoch. Erfordert Server-seitige Änderungen (nicht nur Edge Functions).

---

## Zusammenfassung: Priorisierung

| Phase | Zeitrahmen | Hauptziel | Items |
|---|---|---|---|
| **Phase 1** | 1-2 Tage | Kritische Lücken schließen | 4 Fixes (Math.random, Clipboard, Key-Zeroing, Headers) |
| **Phase 2** | 1 Woche | Härtung auf Branchenniveau | 6 Fixes (Rate-Limit, Atomare Rotation, Salt-Hashing, Metadaten, Wortliste, CORS) |
| **Phase 3** | 1-2 Wochen | KDF-Stärkung + Auto-Migration | 2 Features (128 MiB Argon2id, Version-Migration) |
| **Phase 4** | 2-4 Wochen | Über Branchenstandard | 3 Features (WebAuthn PRF ✅, SecureBuffer ✅, Integrity ✅) |
| **Phase 5** | Langfristig | Zukunftssicherung | 3 Features (Post-Quantum, Duress-PW, OPAQUE) |

### Vergleich nach Umsetzung

| Feature | Bitwarden Free | 1Password | SingraPW (nach Plan) |
|---|---|---|---|
| KDF | PBKDF2 (default) | PBKDF2 650k | Argon2id 128 MiB |
| Post-Quantum | Nein | Nein | Hybrid ML-KEM-768 + RSA-4096 |
| Hardware-Key Unlock | Nur Premium | Ja | ✅ Ja (WebAuthn PRF) |
| Duress-Passwort | Nein | Nein | Ja |
| Vault-Integrity | Nein | Nein | Merkle-Tree |
| Clipboard-Auto-Clear | 30s | 60s | 30s |
| Memory-Schutz | Basic | Basic | SecureBuffer + auto-zero |
| Metadaten-Verschl. | Teilweise | Ja | Ja |
| Auto-KDF-Migration | Nein (war LastPass-Problem) | Unbekannt | Ja |
