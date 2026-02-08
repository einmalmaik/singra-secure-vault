# Zero-Knowledge Transparency Note (2026-02-08)

## Ziel
Klare und ehrliche Kommunikation zur Zero-Knowledge-Architektur inkl. technischer Grenzen.

## Anpassungen
- `src/i18n/locales/en.json`
  - `privacy.zeroKnowledge.details` erweitert um Transparenz-Hinweis:
    - warum 100% absolute Zero-Knowledge in aktueller Web-Architektur nicht vollstaendig moeglich ist
    - welche Metadaten technisch serverseitig verarbeitbar bleiben (IDs, Zeitstempel, Ownership, Session/Auth-Status)
    - dass sensible Inhalte und zentrale Vault-Metadaten weiterhin verschluesselt gespeichert werden
- `src/i18n/locales/de.json`
  - gleicher Transparenz-Hinweis auf Deutsch in `privacy.zeroKnowledge.details`

## Ergebnis
- Privacy Policy ist explizit transparent und reduziert das Risiko irrefuehrender Erwartungen.
