# Release Notes — Singra Vault v0.6.5

Wir freuen uns, das Release **v0.6.5** von Singra Vault zu veröffentlichen! Dieses Update konzentriert sich auf ein verbessertes Design, eine flexiblere Sprachsteuerung sowie eine tiefere Integration unserer MauntingStudios Design DNA.

## 🚀 Neue Funktionen & Verbesserungen

### 📊 Redesign der Tresor-Gesundheit (Vault Health)
* **Visualisierte Sicherheit**: Ein neuer kreisförmiger Indikator (`ScoreRing`) zeigt Ihnen auf einen Blick die Sicherheitsbewertung Ihres Tresors (0-100).
* **Sicherheitsverlauf**: Ein integrierter grafischer Verlauf zeigt Ihnen die Entwicklung der Tresorsicherheit über die letzten 30 Tage.
* **Kompakte Statistikkarten**: Fünf detaillierte Karten filtern und kategorisieren Ihre Passwörter nach *Schwachen*, *Geleakten*, *Doppelten*, *Alten* und *Starken* Einträgen.
* **Übersichtliche Problemliste**: Finden Sie Sicherheitsrisiken schneller mit interaktiven Filter-Tabs und einer klaren Problembeschreibung.
* **Interaktive Sicherheitstipps**: Erhalten Sie direkt auf Ihre Daten abgestimmte Sicherheitstipps. Die Tipps erkennen automatisch, ob Sie z. B. die Zwei-Faktor-Authentifizierung (2FA) inaktiv haben oder doppelte Passwörter nutzen, und führen Sie mit einem Klick zur Behebung.
* **Übersichtlicher Footer**: Zeigt die Gesamtzahl aller Einträge, den Prozentsatz einzigartiger Passwörter sowie die Anzahl betroffener Konten an.

### 💾 Zuverlässiger Bericht-Export
* Wir nutzen ab sofort die systemeigene Export-Abstraktion (`saveExportFile`). Auf Desktop-Geräten (Tauri) öffnet sich nun der native Systemdialog zum Speichern von CSV- und JSON-Berichten, während im Web-Client der direkte Browser-Download gestartet wird.

### 🌐 Globaler Sprachwechsler (Language Switcher)
* Der Sprachwechsler wurde auf allen wichtigen Oberflächen integriert, um einen schnellen Wechsel zwischen Deutsch und Englisch zu ermöglichen:
  * Im Header der **Tresor-Hauptseite** (neben dem Hinzufügen-Button).
  * In der Fußzeile der **Seitennavigation (Sidebar)**.
  * Oben rechts auf der **Anmeldeseite**.
  * Im Header der **Sicherheitsanalyse**.

---

## 🛡️ Sicherheit & Qualität
* **Keine Probleme gefunden**: Im Zuge der finalen Build-Prüfung und lokalen Validierung wurden keinerlei Kompilierungs- oder Verifikationsprobleme festgestellt.
* **Clientseitige Sicherheit**: Alle Berechnungen und Analysen der Tresor-Gesundheit finden ausschließlich lokal auf Ihrem Gerät statt.
