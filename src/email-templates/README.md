# E-Mail Templates

Diese Templates werden für Supabase Auth E-Mails verwendet und sind mit dem Singra Vault Branding gestaltet.

## Verfügbare Templates

| Template | Verwendung | Supabase Variable |
|----------|------------|-------------------|
| `confirm-email.html` | E-Mail-Bestätigung nach Registrierung | `{{ .ConfirmationURL }}` |
| `reset-password.html` | Passwort zurücksetzen | `{{ .ConfirmationURL }}` |
| `base.html` | Basis-Template für eigene Erweiterungen | `{{content}}` |

## Design-Elemente

- **Header:** Gradient von `#6366f1` zu `#8b5cf6` (Singra Purple)
- **Logo:** Shield-Icon + "Singra Vault" Text
- **Button:** Gradient-Button mit hover-Effekt
- **Dark Mode:** Automatische Anpassung via `prefers-color-scheme`
- **Responsive:** Funktioniert auf Desktop und Mobile

## Verwendung in Supabase

1. Gehe zu **Supabase Dashboard → Authentication → Email Templates**
2. Wähle den Template-Typ (Confirm signup, Reset password, etc.)
3. Kopiere den HTML-Inhalt des entsprechenden Templates
4. Füge ihn im "Message body" Feld ein
5. Speichere die Änderungen

## Anpassung

### Neues Template erstellen

1. Kopiere `base.html` als Ausgangspunkt
2. Ersetze `{{content}}` mit deinem Inhalt
3. Verwende Supabase-Variablen:
   - `{{ .ConfirmationURL }}` - Bestätigungs-Link
   - `{{ .Token }}` - Magic Link Token
   - `{{ .Email }}` - E-Mail-Adresse

### Farben anpassen

Die Hauptfarben in den Templates:
```css
/* Primary Gradient */
background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);

/* Text Colors */
color: #1a1a2e;  /* Dark text */
color: #4a4a68;  /* Muted text */
color: #6b6b80;  /* Light text */

/* Dark Mode */
background: #0f0f1a;  /* Dark bg */
color: #e4e4e7;       /* Light text */
```

## SMTP-Konfiguration

Die Templates werden über Resend SMTP gesendet:
- **Host:** `smtp.resend.com`
- **Port:** `465`
- **Username:** `resend`
- **Sender:** `noreply@mauntingstudios.de`
