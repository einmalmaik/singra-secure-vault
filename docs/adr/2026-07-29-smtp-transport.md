# ADR: SMTP-Transport für Edge Functions

## Problem

Core- und Premium-Edge-Functions benötigen transaktionale E-Mails, sollen
aber nicht an eine proprietäre HTTP-Mail-API gekoppelt sein. Supabase Auth
verwendet Custom SMTP; Edge Functions benötigen für eigene Nachrichten einen
separaten, serverseitigen SMTP-Client.

## Entscheidung

`nodemailer@9.0.3` wird ausschließlich in
`supabase/functions/_shared/smtp.ts` gekapselt. Der Adapter erlaubt nur
implizites TLS über Port 465, verlangt Zertifikatsprüfung und mindestens
TLS 1.2 und deaktiviert Datei- und URL-Zugriffe beim Erstellen von Nachrichten.
Providerfehler werden nicht an Fachlogik, Logs oder Clients weitergereicht.

Die Konfiguration besteht aus `SMTP_HOST`, `SMTP_PORT=465`, `SMTP_USER`,
`SMTP_PASSWORD`, `SMTP_FROM` und `SMTP_SENDER_NAME`. Sie wird nur aus
serverseitigen Supabase-Function-Secrets gelesen.

## Alternativen

- HTTP-Mail-Anbieter-API: verworfen, weil sie die Implementierung wieder an
  einen einzelnen Anbieter koppelt.
- Eigener SMTP-Client: verworfen, weil ein selbst implementiertes SMTP-/TLS-
  Protokoll unnötige Security- und Wartungsrisiken erzeugt.
- Supabase Auth SMTP für beliebige Nachrichten: nicht möglich; diese
  Konfiguration versendet nur Supabase-Auth-Nachrichten.
- SMTP über Port 25 oder 587: auf der gehosteten Supabase-Edge-Runtime nicht
  erlaubt.

## Security-Bewertung

- Die Library verarbeitet Empfänger, Betreff und Nachrichteninhalt, jedoch
  keine Vault-Schlüssel, Masterpasswörter oder Auth-Tokens.
- npm Audit für `9.0.3` am 2026-07-29: keine bekannten Advisories. Ältere
  Major-Versionen wurden wegen offener SMTP-/Header-Injection-Advisories
  ausdrücklich verworfen.
- Paket: MIT-0, keine Runtime-Dependencies, circa 576 KiB ungepackt.
- Der Adapter validiert Absender, Empfänger, Betreff und Header gegen
  Zeilenumbrüche, begrenzt Größen und Empfängerzahl und gibt nur stabile
  Fehlerklassen zurück.
- Nodemailer wird nur serverseitig in Deno/Supabase Edge Functions geladen;
  Web- und Tauri-Client-Bundles importieren den Adapter nicht.

## Nutzung im Projekt

- Import nur über `_shared/smtp.ts`.
- Tests prüfen TLS/465, Zertifikatsprüfung, fehlende Konfiguration,
  Header-Injection, deaktivierte externe Inhalte und Fehlerredaktion.
- Eine reale Zustellung muss vor Produktion gegen den ausgewählten
  SMTP-Anbieter geprüft werden.

## Exit-Plan

Ein Anbieter- oder Librarywechsel ersetzt nur den gekapselten Adapter. Der
fachliche Vertrag `sendSmtpMail` bleibt stabil.
