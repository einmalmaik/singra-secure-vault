# 2026-02-08 - OAuth Redirect localhost/Cloudflare Fix

## Problem

Bei Deployments auf Cloudflare wurde nach OAuth-Login teilweise auf `localhost` weitergeleitet.

## Ursache

`VITE_SITE_URL` war gesetzt und wurde direkt als Redirect-Basis verwendet, auch wenn der Wert lokal war (`localhost`) und die App auf einer echten Domain lief.

## Umsetzung

Datei: `src/contexts/AuthContext.tsx`

- `getRedirectUrl()` nutzt weiterhin `VITE_SITE_URL`, aber mit Validierung.
- Wenn aktuelle Seite **nicht lokal** ist und `VITE_SITE_URL` auf `localhost` zeigt, wird der Wert ignoriert.
- In diesem Fall wird auf `window.location.origin` zurueckgefallen.
- Ungueltige `VITE_SITE_URL` Werte werden ebenfalls abgefangen und auf `window.location.origin` zurueckgesetzt.

## Ergebnis

Auf Cloudflare/Produktivdomains wird kein OAuth-Redirect mehr auf `localhost` gebaut, selbst wenn `VITE_SITE_URL` falsch konfiguriert ist.
