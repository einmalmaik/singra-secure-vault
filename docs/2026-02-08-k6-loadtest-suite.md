# 2026-02-08 - k6 Lasttest Suite (10k-ready)

## Ziel

Ein reproduzierbares Lasttest-Setup bereitstellen, um Skalierungsrisiken bei hoher Parallelitaet (bis 10k gleichzeitige Nutzer) messbar zu machen.

## Umgesetzte Aenderungen

1. **Neue k6 Test-Suite unter `loadtest/`**
   - `loadtest/lib/config.js`
   - `loadtest/lib/supabase.js`
   - `loadtest/scenarios/login.js`
   - `loadtest/scenarios/vault-read.js`
   - `loadtest/scenarios/vault-mutate.js`
   - `loadtest/scenarios/offline-sync-replay.js`
   - `loadtest/README.md`

2. **Neue npm Scripts in `package.json`**
   - `loadtest:smoke`
   - `loadtest:login`
   - `loadtest:vault-read`
   - `loadtest:10k`
   - `loadtest:vault-mutate`
   - `loadtest:offline-sync`

## Sicherheits- und Betriebsaspekte

- Keine Secrets im Code; alles ueber Environment Variablen (`SUPABASE_*`, `K6_*`).
- Token-/Credential-Pools werden nur zur Laufzeit geladen.
- Schreiblast-Szenarien nutzen Cleanup per Default, um Datenmuell zu minimieren.
- Empfehlung: nur gegen Staging/Test-Projekt mit dedizierten Testusern laufen lassen.

## Abgedeckte Lastpfade

- Auth Passwort-Login (`/auth/v1/token?grant_type=password`)
- Vault Read Flow (Default Vault + Items + Kategorien)
- Vault Mutations (Upsert/Delete auf `vault_items`)
- Offline-Sync Replay (Batch-Upserts + Refresh + optionales Cleanup)

## Ergebnis

Die Plattform kann jetzt mit konsistenten Skripten von Smoke-Tests bis 10k-Read-Ramp getestet werden. Engpaesse (p95, 429, 5xx) sind dadurch objektiv messbar und vergleichbar zwischen Releases.
