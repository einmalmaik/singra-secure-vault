# 2026-02-08 - k6 .env Loader Fix

## Problem

`k6` liest `.env` nicht automatisch. Dadurch schlugen Lasttests mit `Missing required env var SUPABASE_URL` fehl, obwohl die Werte in `.env` vorhanden waren.

## Umsetzung

1. Neues Script: `scripts/loadtest/run-k6-with-env.mjs`
   - startet `k6`
   - mappt automatisch:
     - `SUPABASE_URL <- SUPABASE_URL || VITE_SUPABASE_URL`
     - `SUPABASE_ANON_KEY <- SUPABASE_ANON_KEY || VITE_SUPABASE_PUBLISHABLE_KEY`

2. `package.json` Loadtest-Scripts auf den Runner umgestellt:
   - `loadtest:smoke`
   - `loadtest:login`
   - `loadtest:vault-read`
   - `loadtest:10k`
   - `loadtest:vault-mutate`
   - `loadtest:offline-sync`

## Ergebnis

Loadtests funktionieren direkt mit `.env`, ohne manuelles Setzen von `SUPABASE_URL` in der Shell.
