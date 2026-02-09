# AuthContext — Authentifizierungs-Kontext

> **Datei:** `src/contexts/AuthContext.tsx`  
> **Zweck:** Verwaltet den Authentifizierungsstatus der Anwendung und stellt Login/Signup/OAuth-Methoden bereit.

---

## Context-Interface

```typescript
interface AuthContextType {
    user: User | null;              // Supabase User-Objekt
    session: Session | null;        // Supabase Session-Objekt
    loading: boolean;               // true während Initialisierung
    signUp: (email, password) => Promise<{ error }>;
    signIn: (email, password) => Promise<{ error }>;
    signInWithOAuth: (provider) => Promise<{ error }>;
    signOut: () => Promise<void>;
}
```

---

## `AuthProvider` — React Context Provider

### Initialisierung (useEffect)

**Ablauf:**
1. Registriert `supabase.auth.onAuthStateChange()` als Listener **zuerst**
2. Ruft danach `supabase.auth.getSession()` auf, um eine existierende Session zu prüfen
3. Setzt `user`, `session` und `loading` bei jedem Auth-Event

> **Reihenfolge:** Listener wird vor `getSession()` gesetzt, um Race-Conditions zu vermeiden.

**Cleanup:** Deregistriert den Listener via `subscription.unsubscribe()`.

---

### `getRedirectUrl(): string` (intern)

Berechnet die korrekte Redirect-URL für OAuth und Signup-Bestätigungen.

**Ablauf:**
1. Ermittelt den aktuellen Origin (`window.location.origin`)
2. Prüft ob aktueller Host `localhost` / `127.0.0.1` / `[::1]` ist
3. **Nicht-Localhost + Browser:** Verwendet `window.location.origin`
4. **Localhost:** Liest `VITE_SITE_URL` aus Environment
   - **Typo-Fix:** Erkennt automatisch `mauntingstudios,de` → `mauntingstudios.de`
5. **Sicherheit:** Verhindert, dass Produktions-Deployments auf `localhost` redirecten (ignoriert localhost `VITE_SITE_URL` auf Non-Localhost-Hosts)

---

### `signUp(email, password): Promise<{ error }>`

Registriert einen neuen Nutzer.

**Ablauf:**
1. Redirect-URL: `getRedirectUrl() + '/vault'`
2. `supabase.auth.signUp({ email, password, options: { emailRedirectTo } })`

---

### `signIn(email, password): Promise<{ error }>`

Meldet einen Nutzer mit E-Mail/Passwort an.

**Ablauf:** `supabase.auth.signInWithPassword({ email, password })`

---

### `signInWithOAuth(provider): Promise<{ error }>`

OAuth-Anmeldung mit Google, Discord oder GitHub.

**Parameter:** `provider: 'google' | 'discord' | 'github'`

**Ablauf:**
1. Redirect-URL: `getRedirectUrl() + '/vault'`
2. `supabase.auth.signInWithOAuth({ provider, options: { redirectTo } })`

---

### `signOut(): Promise<void>`

Meldet den aktuellen Nutzer ab.

**Ablauf:** `supabase.auth.signOut()`

---

## Hook: `useAuth()`

```typescript
export function useAuth(): AuthContextType
```

Zugriff auf den Auth-Kontext. Wirft `Error` wenn außerhalb des `AuthProvider` verwendet.
