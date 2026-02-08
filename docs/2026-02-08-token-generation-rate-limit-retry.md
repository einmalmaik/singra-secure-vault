# 2026-02-08 - Token-Generierung: Rate-Limit Retry

## Problem

Bei `npm run loadtest:gen-tokens` trat bei groesseren User-Mengen ein Supabase Auth Rate-Limit auf (`Request rate limit reached`), wodurch nur ein Teil der Tokens erzeugt wurde.

## Umsetzung

In `scripts/loadtest/generate-tokens.mjs` wurde ein Retry-Mechanismus mit exponentiellem Backoff und Jitter eingebaut:

- Rate-Limit Errors werden automatisch erneut versucht.
- Default-Werte:
  - `TOKEN_GEN_MAX_RETRIES=5`
  - `TOKEN_GEN_RETRY_BASE_MS=300`
- Parallelitaet weiterhin ueber `TOKEN_GEN_BATCH_SIZE` steuerbar (Default `20`).

## Doku

`loadtest/README.md` wurde um die neuen Env-Parameter und einen empfohlenen Re-Run-Command bei Rate-Limits erweitert.

## Ergebnis

Token-Generierung ist robuster gegen kurzfristige Auth-Rate-Limits und kann ohne manuelles Eingreifen durchlaufen.
