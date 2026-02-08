# DE Locale Umlaut Fix (2026-02-08)

## Ziel
- Korrekte Anzeige deutscher Umlaute statt Transliterationen (`ae/oe/ue`) in den neuen Privacy-Texten.

## Aenderungen
- `src/i18n/locales/de.json`
  - `privacy.zeroKnowledge.details` auf korrekte Umlaute/ß angepasst.
  - `privacy.collection.content` auf korrekte Umlaute/ß angepasst.
  - `privacy.security.title` und `privacy.security.content` auf korrekte Umlaute/ß angepasst.
  - UTF-8 BOM entfernt, damit JSON parser-sicher bleibt.

## Verifikation
- JSON erfolgreich per Node geparst.
- Geprueft, dass die betroffenen Privacy-Texte keine `ae/oe/ue`-Transliterationen mehr enthalten.
