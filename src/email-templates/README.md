# E-Mail Templates

Die produktiv versionierten Supabase-Auth- und Security-Templates liegen
unter `supabase/templates/`. Die älteren Dateien in diesem Verzeichnis dienen
nur noch als Designreferenz für transaktionale Produkt-E-Mails.

## Verfügbare Templates

| Template | Verwendung | Supabase Variable |
|----------|------------|-------------------|
| `confirm-email.html` | E-Mail-Bestätigung nach Registrierung | `{{ .Token }}` |
| `reset-password.html` | Passwort zurücksetzen | `{{ .Token }}` |
| `invite.html` | Einladung | `{{ .ConfirmationURL }}` |
| `magic-link.html` | Magic Link / E-Mail-OTP | `{{ .Token }}` |
| `email-change.html` | Neue E-Mail-Adresse bestätigen | `{{ .ConfirmationURL }}` |
| `reauthentication.html` | Erneute Sicherheitsprüfung | `{{ .Token }}` |
| `password-changed-notification.html` | Passwortänderung | – |
| `email-changed-notification.html` | E-Mail-Änderung | `{{ .OldEmail }}`, `{{ .Email }}` |
| `phone-changed-notification.html` | Telefonnummer geändert | – |
| `identity-linked-notification.html` | Anmeldemethode verknüpft | `{{ .Provider }}` |
| `identity-unlinked-notification.html` | Anmeldemethode entfernt | `{{ .Provider }}` |
| `mfa-enrolled-notification.html` | MFA-Methode hinzugefügt | `{{ .FactorType }}` |
| `mfa-unenrolled-notification.html` | MFA-Methode entfernt | `{{ .FactorType }}` |
| `base.html` | Basis-Template für eigene Erweiterungen | `{{content}}` |

## Design-Elemente

- **Header:** Gradient von `#0a1628` zu `#0f1f38` (Dark Cosmic)
- **Akzentfarbe:** `#7ec8d9` (Singra Cyan)
- **Logo:** Gehostetes PNG (`singra-icon.png`) + "Singra Vault" Text
- **Code-Box:** Dunkler Hintergrund (`#0f1f38`) mit Cyan-Text
- **Dark Mode:** Automatische Anpassung via `prefers-color-scheme`
- **Responsive:** Funktioniert auf Desktop und Mobile

## Verwendung in Supabase

1. Gehe zu **Supabase Dashboard → Authentication → Email Templates**
2. Wähle den Template-Typ (Confirm signup, Reset password, etc.)
3. Kopiere den HTML-Inhalt des entsprechenden Templates
4. Füge ihn im "Message body" Feld ein
5. Speichere die Änderungen

Die Security Notifications müssen im gehosteten Projekt zusätzlich unter
**Authentication → Emails → Security Notifications** aktiviert werden. Die
Einträge in `supabase/config.toml` aktivieren und versionieren diese Vorlagen
für die lokale Supabase-Laufzeit; sie ändern das gehostete Projekt nicht
automatisch.

## Anpassung

### Neues Template erstellen

1. Kopiere `base.html` als Ausgangspunkt
2. Ersetze `{{content}}` mit deinem Inhalt
3. Verwende Supabase-Variablen:
   - `{{ .Token }}` - OTP-Code
   - `{{ .ConfirmationURL }}` - Bestätigungs-Link
   - `{{ .Email }}` - E-Mail-Adresse

### Farbschema

```css
/* Header Gradient */
background: linear-gradient(135deg, #0a1628 0%, #0f1f38 100%);

/* Akzentfarbe (Buttons, Code, Links) */
color: #7ec8d9;

/* Text Colors */
color: #1a2332;  /* Dark text */
color: #4a5568;  /* Muted text */
color: #718096;  /* Light text */

/* Dark Mode */
background: #0a1628;  /* Dark bg */
color: #e2e8f0;       /* Light text */
```

## SMTP-Konfiguration

Die Supabase-Auth-Templates werden über den unter
**Authentication → SMTP Settings** konfigurierten SMTP-Anbieter gesendet.

Für transaktionale Edge-Function-E-Mails werden dieselben Zugangsdaten
separat als Supabase-Function-Secrets hinterlegt:

- `SMTP_HOST`
- `SMTP_PORT=465`
- `SMTP_USER`
- `SMTP_PASSWORD`
- `SMTP_FROM`
- `SMTP_SENDER_NAME`

Die Zugangsdaten gehören niemals in `VITE_*`, Client-Code oder Git.
