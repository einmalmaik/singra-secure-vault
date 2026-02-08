# 2026-02-08 - Loadtest User-Seeding und Token-Generierung

## Ziel

Test-User und Access-Tokens fuer Lasttests automatisiert erzeugen, damit keine manuelle Account-Erstellung noetig ist.

## Umgesetzte Aenderungen

1. Neue Skripte:
   - `scripts/loadtest/create-test-users.mjs`
   - `scripts/loadtest/generate-tokens.mjs`

2. Erweiterte npm Scripts in `package.json`:
   - `loadtest:seed-users`
   - `loadtest:gen-tokens`
   - `loadtest:prepare`

3. Doku erweitert:
   - `loadtest/README.md` um Auto-Setup und notwendige Env-Variablen.

4. Sicherheitsmassnahme:
   - `loadtest/users.txt` und `loadtest/tokens.txt` in `.gitignore` aufgenommen.

## Sicherheitsaspekte

- User-Erstellung verwendet ausschliesslich `SUPABASE_SERVICE_ROLE_KEY` (nur fuer geschuetzte Testumgebung).
- Token-Dateien werden lokal erzeugt und nicht versioniert.
- Es werden dedizierte Loadtest-User erzeugt, keine Produktivkonten.

## Ergebnis

Der komplette Vorbereitungsablauf fuer Lasttests ist jetzt ein Kommando:

`npm run loadtest:prepare`
