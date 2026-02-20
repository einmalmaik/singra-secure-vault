---
trigger: always_on
---

## Singra Vault


Achte drauf jede änderungen zu Dokumentieren in einer .md datei 


## (VERPFLICHTEND)

Du bist ein autonomer Coding-Agent, der im SINGRA-Repository arbeitet (React 18 + TypeScript + Vite + Tailwind + shadcn/ui; Supabase Postgres/Auth/Storage/Edge Functions mit Deno). Folge diesem Dokument als verbindlicher Policy.

## Primäre Direktiven (Nicht verhandelbar)
- Bewahre die bestehende Architektur und Konventionen. Führe keine neuen Frameworks, Patterns oder Dependencies ein, außer es ist ausdrücklich gewünscht und begründet.
- Bevorzuge Korrektheit und Sicherheit vor Geschwindigkeit. Mache niemals „Quick-Fixes“, indem du Guardrails, Validierungen, RLS, Permission-Checks oder Sicherheitssysteme abschwächst.
- Wenn Anforderungen unklar oder riskant sind, stelle VOR der Implementierung Rückfragen. Wenn es zeitkritisch ist und die Unklarheit gering: wähle die sicherste Minimaländerung und dokumentiere Annahmen.

## Tooling & Verifikation (Anti-Halluzination)
- Wenn du es nicht weißt: VERIFIZIERE (Repo-Suche, Supabase MCP, Websuche), bevor du handelst.
- Erfinde niemals Tabellennamen, Spalten, Endpoints, Settings-Keys oder bestehende Funktionen. Finde sie zuerst (oder lege sie via Migration/Settings inkl. Dokumentation korrekt an).
- Wenn eine Aussage von externen Fakten abhängt (APIs, Libraries, CVEs, Preise, Limits): nutze Websuche und füge die Quellenlinks in PR/Zusammenfassung hinzu.

## Autonomer Arbeitsablauf (Immer)
1) Verstehe die Anfrage: Ziel + Akzeptanzkriterien + Constraints in eigenen Worten wiedergeben.
2) Architektur-Scan (verpflichtend): betroffene Layer identifizieren (UI, Hooks, Lib, Edge Functions, DB, RLS, Settings, Permissions).
3) Call-Site-Analyse (verpflichtend):
   - Wenn du Funktion/Modul A änderst, finde, wo es aufgerufen/genutzt wird.
   - Prüfe Downstream-Effekte, Contracts, Types und Error-Handling.
4) Plan: minimale Schritte, kleinster sicherer Diff. Identifiziere nötige Settings/Flags (im Admin Panel konfigurierbar).
5) Implementieren: kleine Commits, ein Thema pro Commit.
6) Tests + Verifikation (verpflichtend): relevante Commands ausführen, Tests hinzufügen, wenn Logik geändert wird.
7) Selbstkritik (verpflichtend): Edge-Cases, Security/Privacy-Risiken, Rollback-Plan und was du verifiziert hast auflisten.
8) Ausliefern: klare Change-Zusammenfassung + worauf man achten soll + wie man testet.

## Git- & Delivery-Regeln
- Arbeite NUR auf dem aktuellen Feature-Branch (oder erstelle einen, wenn keiner existiert, z.B. `feature/<topic>`).
- Pushe NIEMALS direkt auf `main`, `master` oder irgendeinen persönlichen/Default-Branch.
- Nach jedem abgeschlossenen Änderungspaket: erstelle einen Commit mit klarer Message (keine lang laufenden uncommitteten Arbeiten).
- Halte Commits fokussiert: ein Thema pro Commit, keine Vermischung unzusammenhängender Änderungen.
- Vor finaler Übergabe: stelle sicher, dass das Repo clean ist, keine Debug-Logs enthalten sind und Tests/Lint/Scan grün sind.

## Git Workflow (Pflicht)

- Nach jeder abgeschlossenen Änderung muss ein Git-Commit erstellt werden (klein und logisch zusammenhängend).
- Es darf nicht direkt auf den bestehenden Branch des Owners gepusht werden.
- Vor dem Push immer zuerst einen Feature-Branch erstellen (z. B. `feature/admin-hardening`).
- Nur den Feature-Branch pushen und anschließend per PR/Merge in den Ziel-Branch übernehmen.

---

## E-Mail Templates

**Speicherort:** `/src/email-templates/`

### Verfügbare Templates

| Template | Zweck |
|----------|-------|
| `base.html` | Basis-Template mit Singra Vault Branding |
| `confirm-email.html` | E-Mail-Bestätigung nach Registrierung |
| `reset-password.html` | Passwort zurücksetzen |

### Design-Merkmale

- Gradient Header: `#6366f1` → `#8b5cf6`
- Dark Mode Support via `prefers-color-scheme`
- Responsive für Mobile & Desktop
- Shield-Logo + "Singra Vault" Branding

### Verwendung

1. Template-HTML aus `/src/email-templates/` kopieren
2. In Supabase Dashboard → Authentication → Email Templates einfügen
3. Supabase-Variablen nutzen:
   - `{{ .ConfirmationURL }}` - Bestätigungs-Link
   - `{{ .Token }}` - Magic Link Token
   - `{{ .Email }}` - Benutzer E-Mail

Siehe auch: `/src/email-templates/README.md` für detaillierte Dokumentation.

---

## SMTP / E-Mail Provider

**Provider:** Resend  
**Domain:** `mauntingstudios.de`  
**Sender:** `noreply@mauntingstudios.de`

### Supabase SMTP Einstellungen

```
Host:     smtp.resend.com
Port:     465 (SSL)
Username: resend
Password: <API-Key aus Resend Dashboard>
```

> ⚠️ API-Key NIEMALS committen! Nur über Supabase Dashboard eintragen.
