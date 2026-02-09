# Auth-Komponenten — Authentifizierung & Vault Setup

> **Dateien:**  
> `src/pages/Auth.tsx`  
> `src/components/vault/VaultUnlock.tsx`  
> `src/components/vault/MasterPasswordSetup.tsx`  
> `src/components/auth/TwoFactorVerificationModal.tsx`

---

## Auth — Login & Signup Seite

> **Datei:** `src/pages/Auth.tsx`

Hauptseite für Authentifizierung mit Login, Signup und OAuth.

### State
| State | Typ | Zweck |
|---|---|---|
| `mode` | `'login' \| 'signup'` | Aktiver Modus |
| `showPassword` | `boolean` | Passwort sichtbar? |
| `loading` | `boolean` | Lädt gerade? |
| `show2FAModal` | `boolean` | 2FA-Modal aktiv? |
| `pending2FAUserId` | `string \| null` | User-ID für 2FA-Check |
| `loginFormData` | `LoginFormData` | Formular-Daten |
| `signupFormData` | `SignupFormData` | Formular-Daten |

### Formular-Validierung (Zod)

**Login:**
```typescript
z.object({
    email: z.string().email('Ungültige E-Mail'),
    password: z.string().min(1, 'Passwort erforderlich'),
})
```

**Signup:**
```typescript
z.object({
    email: z.string().email('Ungültige E-Mail'),
    password: z.string().min(8, 'Mindestens 8 Zeichen'),
    confirmPassword: z.string(),
}).refine(data => data.password === data.confirmPassword)
```

### Redirect (useEffect)
Bereits angemeldeter User → automatischer Redirect zu `/vault`.

### `handleLogin(data)`

**Ablauf:**
1. `signIn(email, password)` via `AuthContext`
2. Bei Erfolg: Prüft 2FA-Status via `get2FAStatus(userId)`
3. **2FA aktiviert:**
   - Speichert `pending2FAUserId`
   - Zeigt `TwoFactorVerificationModal`
   - **Meldet den User ab** (`signOut()`) — Login vollendet erst nach 2FA
4. **Kein 2FA:** Login abgeschlossen, Redirect via Auth-Listener

> **Sicherheit:** Bei 2FA wird der User nach dem Password-Check sofort abgemeldet. Erst nach erfolgreicher 2FA-Verifizierung wird er erneut angemeldet. Dies verhindert, dass ein partiell authentifizierter User Zugriff erhält.

### `handleSignup(data)`

**Ablauf:** `signUp(email, password)` → Toast mit Bestätigungshinweis

### `handleOAuth(provider)`

**Ablauf:** `signInWithOAuth(provider)` für `'google' | 'discord' | 'github'`

### `handle2FAVerify(code, isBackupCode)`

**Ablauf:**
1. Verifiziert via `verifyTwoFactorForLogin(userId, code, isBackupCode)`
2. Bei Erfolg:
   - Schließt Modal
   - Meldet User **erneut** via `signIn()` mit den gespeicherten Credentials an
3. Bei Fehler: `false` zurück (Modal bleibt offen)

---

## VaultUnlock — Vault-Entsperrung

> **Datei:** `src/components/vault/VaultUnlock.tsx`

Wird gezeigt wenn der Vault gesperrt ist. Unterstützt optionale 2FA.

### State
| State | Typ | Zweck |
|---|---|---|
| `password` | `string` | Eingegebenes Master-Passwort |
| `showPassword` | `boolean` | Passwort sichtbar? |
| `loading` | `boolean` | Lädt gerade? |
| `show2FAModal` | `boolean` | 2FA-Modal aktiv? |
| `pendingPassword` | `string` | Zwischengespeichertes Passwort für 2FA-Flow |

### `handleSubmit(e)`

**Ablauf:**
1. Prüft ob Vault-2FA aktiviert ist via `get2FAStatus(userId)`
2. **Vault-2FA aktiv:**
   - Speichert Passwort in `pendingPassword`
   - Zeigt 2FA-Modal an
   - Unlock wird pausiert
3. **Kein Vault-2FA:** Direkt `performUnlock(password)`
4. **2FA-Prüfung fehlgeschlagen:** Fährt ohne 2FA fort (Fail-Open für Fehlertoleranz)

### `performUnlock(masterPassword)`

**Ablauf:**
1. `unlock(masterPassword)` via `VaultContext`
2. Bei Fehler: Toast mit Fehlermeldung, leert Passwort-Felder

### `handle2FAVerify(code, isBackupCode)`

**Ablauf:**
1. Verifiziert via `verifyTwoFactorForLogin(userId, code, isBackupCode)`
2. Bei Erfolg:
   - Schließt 2FA-Modal
   - Ruft `performUnlock(pendingPassword)` mit dem gespeicherten Passwort auf
   - Löscht `pendingPassword`
3. Bei Fehler: `false` zurück

### `handle2FACancel()`
Schließt Modal, löscht `pendingPassword` und `password`.

### `handleLogout()`
`signOut()` via `AuthContext`.

### UI-Features
- Session-Restore-Hinweis (blauer Banner wenn `pendingSessionRestore: true`)
- Passwort-Toggle (Auge/Auge-zu Icon)
- Logout-Button

---

## MasterPasswordSetup — Ersteinrichtung

> **Datei:** `src/components/vault/MasterPasswordSetup.tsx`

Wird nach dem ersten Login angezeigt wenn kein Encryption-Salt existiert.

### Schwache-Passwort-Erkennung

#### `hasWeakMasterPasswordPattern(password): boolean`

Prüft gegen bekannte schwache Muster:

| Muster | RegEx/Check |
|---|---|
| Nur Buchstaben | `/^[A-Za-z]+$/` |
| Nur Zahlen | `/^\d+$/` |
| Nur Wiederholungen | `/^(.)\1+$/` |
| Häufige Wörter | `password`, `passwort`, `singra`, `qwerty`, etc. |
| Sequentielle Zahlen | `01234`, `12345`, ..., `54321` |
| Name + Zahl | `/^[A-Za-z]{3,}\d{3,}[^A-Za-z0-9]*$/` |

**Rückgabe:** `true` wenn ein schwaches Muster erkannt wird

### State
| State | Typ | Zweck |
|---|---|---|
| `password` | `string` | Eingegebenes Passwort |
| `confirmPassword` | `string` | Bestätigungspasswort |
| `strength` | `PasswordStrength \| null` | Berechnete Stärke |
| `showPassword` / `showConfirm` | `boolean` | Passwort-Sichtbarkeit |
| `loading` | `boolean` | Verarbeitung aktiv? |

### `handlePasswordChange(value)`

**Ablauf:**
1. Setzt `password` State
2. Berechnet Stärke via `calculateStrength(value)` (nur wenn Länge > 0)

### `handleSubmit(e)`

**Ablauf — validiert in mehreren Stufen:**
1. **Leer-Check:** Passwort und Bestätigung vorhanden?
2. **Übereinstimmungs-Check:** Passwort === Bestätigung?
3. **Mindestlänge:** ≥ 12 Zeichen
4. **Stärke-Check:** Score ≥ 2 (`good` oder besser)
5. **Schwache-Muster-Check:** `hasWeakMasterPasswordPattern()` darf nicht `true` sein
6. **Erfolg:** `setupMasterPassword(password)` via `VaultContext`
7. Bei Fehler: Toast mit passender Fehlermeldung

### `handleGenerateStrongPassword()`

**Ablauf:**
1. Generiert Passwort via `generatePassword({ length: 24, uppercase: true, lowercase: true, numbers: true, symbols: true })`
2. Setzt `password` und `confirmPassword` auf denselben Wert
3. Berechnet Stärke
4. Zeigt Info-Toast mit Hinweis zum Notieren

### UI-Features
- Stärke-Indikator (farbiger Progress-Bar)
- Label wird dynamisch: `Schwach / Fair / Gut / Stark / Sehr Stark`
- „Sicheres Passwort generieren"-Button
- Hinweis-Karten:
  - ⚠️ „Passwort kann nicht wiederhergestellt werden"
  - 🔒 „Mindestens 12 Zeichen, keine häufigen Muster"
