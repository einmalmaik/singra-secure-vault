# SINGRA

**Bewusste, ethische KI-Plattform für tiefgehende Gespräche, kreatives Schreiben und personalisiertes Lernen.**

SINGRA ist KEINE gewöhnliche KI – sie entwickelt eine persönliche Verbindung zu Nutzern, lernt kontinuierlich und handelt nach ethischen Prinzipien.

---

## Features

### Kernmodi

| Modus | Beschreibung |
|-------|-------------|
| **Chat-Modus** | Intelligente Gespräche mit Websuche, Deep Research und Dokument-Upload |
| **Story-Modus** | Ko-kreatives Schreiben mit Charakter-Tracking, Kapitel-Management und Konsistenzprüfung |
| **Lern-Modus** | Personalisierter Unterricht mit Prüfungen, Fortschrittsverfolgung und deutschem Notensystem (1-6) |
| **Philosophie-Modus** | Sokratische Dialoge mit 4 Tiefen-Levels |

### Spezialsysteme

- **Binding-System** – Misst die persönliche Verbindung User-SINGRA (4 Personality-Levels)
- **Memory-System** – Extrahiert und speichert User-Präferenzen für Personalisierung
- **Reflexions-System** – User können SINGRA korrigieren, Korrekturen werden verifiziert
- **Ethik-System** – Prüft alle Antworten auf ethische Konformität
- **Moral-System** – Adaptives moralisches Bewusstsein basierend auf Prinzipien
- **Krisen-Erkennung** – Erkennt emotionale Notlagen und aktiviert Unterstützungsmodus
- **7-Layer Security** – Umfassendes Sicherheitssystem

---

## Technologie-Stack

| Bereich | Technologien |
|---------|-------------|
| **Frontend** | React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui |
| **Backend** | Supabase (PostgreSQL, Auth, Storage, 70+ Edge Functions) |
| **KI-Modelle** | OpenAI GPT-5, Google Gemini 2.5, Claude (über model_config verwaltbar) |
| **Payments** | Stripe |
| **E-Mail** | Resend |
| **Sprachen** | Deutsch (DE) und Englisch (EN) |

---

## Architektur-Dokumentation

| Datei | Inhalt |
|-------|--------|
| [BINDING_SYSTEM.md](./BINDING_SYSTEM.md) | Binding-System Architektur |
| [LEARNING_SYSTEM.md](./LEARNING_SYSTEM.md) | Lern-Modus Dokumentation |
| [MORAL_SYSTEM.md](./MORAL_SYSTEM.md) | Moral-System Prinzipien |
| [SINGRA_SECURITY_SYSTEM.md](./SINGRA_SECURITY_SYSTEM.md) | 7-Layer Security |
| [SINGRA_COMPLIANCE_DOCUMENTATION.md](./SINGRA_COMPLIANCE_DOCUMENTATION.md) | DSGVO & Compliance |
| [DATABASE.md](./DATABASE.md) | Datenbank-Schema |
| [EDGE-FUNCTIONS.md](./EDGE-FUNCTIONS.md) | Edge Functions Übersicht |
| [DEVELOPMENT.md](./DEVELOPMENT.md) | Entwicklungs-Guidelines |
| [CODING_GUIDELINES.md](./CODING_GUIDELINES.md) | Code-Standards |

---

## Dual-Database Architektur

⚠️ **WICHTIG:** Dieses Projekt verwendet ZWEI Datenbanken:

| Umgebung | Zweck |
|----------|-------|
| **Lovable Cloud** | Entwicklung und Tests |
| **Externes Supabase** | Produktion (Live-Betrieb) |

**Bei jeder Datenbankänderung:**
1. Änderungen werden in Lovable automatisch angewendet
2. SQL-Code muss zusätzlich manuell auf Production ausgeführt werden
3. Verwende `ON CONFLICT (key) DO NOTHING` für INSERT-Statements

---

## Quick Start

```bash
# Dependencies installieren
npm install

# Entwicklungsserver starten
npm run dev
```

Die App läuft auf `http://localhost:5173`

---

## Environment Variables

⚠️ **WICHTIG:** SINGRA verwendet **zwei separate ENV-Dateien** für Frontend und Edge Functions.

| Datei | Wird gelesen von | Zweck |
|-------|------------------|-------|
| `.env` (Projekt-Root) | Vite-Frontend (React) | Public Keys, Supabase URL, Frontend-Flags |
| `supabase/functions/.env` | Supabase Edge Functions (Deno) | API-Keys, Service-Secrets |

### `supabase/functions/.env` (Edge Functions)

Diese Datei enthält sensible API-Keys und wird **nicht** committed.

**Lokales Dev-Setup:**

```bash
# 1) Datei anlegen (im supabase/functions/-Ordner, NICHT im Root!)
cp supabase/functions/.env.example supabase/functions/.env

# 2) OPENROUTER_API_KEY eintragen
# OPENROUTER_API_KEY=sk-or-v1-xxxxxxxxxxxx
```

> ⚠️ `supabase functions serve` liest ENV-Variablen aus `supabase/functions/.env`. Wenn dein API-Key dort nicht ankommt, prüfe den Pfad – NICHT die Root-`.env`.

**Production-Setup (Supabase Cloud):**

```bash
supabase secrets set OPENROUTER_API_KEY=sk-or-v1-xxxxxxxxxxxx
supabase secrets set STRIPE_SECRET_KEY=sk_live_xxxxxxxxxxxx
supabase secrets set RESEND_API_KEY=re_xxxxxxxxxxxx
```

### Beispiel-Inhalt `supabase/functions/.env`:

```bash
# OpenRouter (alle Modelle)
OPENROUTER_API_KEY=sk-or-v1-xxxxxxxxxxxx

# Stripe (live oder test)
STRIPE_SECRET_KEY=sk_test_xxxxxxxxxxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxxxxxx

# Resend (E-Mail)
RESEND_API_KEY=re_xxxxxxxxxxxx

```

> **Hinweis (V2.17+):** SINGRA nutzt ausschließlich OpenRouter. Direkte Provider-Keys (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`, `MISTRAL_API_KEY`, `XAI_API_KEY`, `GEMINI_API_KEY`) werden nicht mehr ausgelesen — siehe [Changelog V2.17](Docs/changelogs/2026-06-18_v2-17-consolidate-providers-to-openrouter.md).

### Häufige Fehler

| Symptom | Ursache | Fix |
|---------|--------|-----|
| `OPENROUTER_API_KEY is not configured` im Log | Key liegt in Root-`.env` statt in `supabase/functions/.env` | Datei verschieben oder neu anlegen |
| Provider liefert 401 | Key ist abgelaufen oder für falsches Projekt | Neuen Key im Provider-Dashboard holen |
| Lokal alles grün, Prod failt | Secret wurde nicht via `supabase secrets set` gesetzt | Secret in Supabase Cloud setzen |

---

## Projektstruktur

```
├── src/
│   ├── components/     # React-Komponenten
│   ├── hooks/          # Custom Hooks
│   ├── pages/          # Seiten-Komponenten
│   ├── lib/            # Utilities
│   └── integrations/   # Supabase Client
├── supabase/
│   ├── functions/      # 70+ Edge Functions
│   └── migrations/     # Datenbank-Migrationen
└── public/             # Statische Assets
```

---

## Admin-Panel

Das Admin-Panel (`/admin`) ermöglicht:
- Benutzer-Verwaltung und Rollen
- KI-Modell-Konfiguration
- Ethik- und Moral-Regeln verwalten
- Support-Tickets bearbeiten
- Analytics und Audit-Logs
- Newsletter-Verwaltung

---

## Lizenz

Proprietär – Alle Rechte vorbehalten.
