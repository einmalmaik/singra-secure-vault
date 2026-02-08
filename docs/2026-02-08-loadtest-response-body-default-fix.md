# 2026-02-08 - Loadtest Response-Body Default Fix

## Problem

Mehrere Lasttests meldeten 0% Erfolg trotz HTTP 200. Ursache war `discardResponseBodies=true` im k6-Default, wodurch JSON-Parsing fuer:

- `access_token` (Login),
- `id` (Auth User),
- `vault id` (Default Vault)

nicht mehr moeglich war.

## Umsetzung

In `loadtest/lib/config.js` wurde der Default angepasst:

- alt: Bodies verwerfen (`K6_KEEP_BODIES` default `false`)
- neu: Bodies behalten (`K6_KEEP_BODIES` default `true`)

Optional kann fuer reine Transport-Benchmarks weiterhin gesetzt werden:

`K6_KEEP_BODIES=false`

## Doku

`loadtest/README.md` um den Parameter `K6_KEEP_BODIES` erweitert.

## Ergebnis

Skripte koennen wieder korrekt auf Response-JSON zugreifen und Erfolgsmetriken sinnvoll auswerten.
