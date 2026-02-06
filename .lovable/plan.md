

# 🔐 Zingra PW - Sicherer Open-Source Passwortmanager

## Vision
Zingra PW wird ein moderner, Open-Source Passwortmanager mit **Zero-Knowledge Architektur** und **Ende-zu-Ende-Verschlüsselung** nach höchsten Industriestandards (AES-256-GCM + Argon2id), inspiriert von Bitwarden und 1Password.

---

## 🏗️ Architektur & Sicherheit

### Verschlüsselungs-Konzept (Industriestandard)
- **Master-Passwort** → wird niemals an den Server gesendet
- **Argon2id Key Derivation** → Ableitung des Verschlüsselungsschlüssels aus dem Master-Passwort
- **AES-256-GCM** → Authentifizierte Verschlüsselung aller sensiblen Daten
- **Client-Side Encryption** → Alle Daten werden VOR dem Senden an Supabase verschlüsselt
- **Zero-Knowledge** → Selbst bei einem Datenbank-Leak sind alle Passwörter sicher

### Datenbank-Struktur
- **profiles** → Benutzerprofile mit öffentlichen Daten
- **user_roles** → Rollenmanagement (Standard-User, Admin)
- **vaults** → Container für verschlüsselte Einträge
- **vault_items** → Verschlüsselte Passwörter, Notizen, TOTP-Secrets
- **categories** → Ordner/Kategorien für Organisation
- **tags** → Flexible Labels für Filterung

---

## 📱 Hauptfunktionen

### 1. Landing Page (Öffentlich)
- **Hero-Sektion** → "Deine Passwörter. Deine Kontrolle." mit Haupt-CTA
- **Sicherheits-Features** → End-to-End Verschlüsselung, Zero-Knowledge visuell erklärt
- **Feature-Übersicht** → Alle Funktionen mit Icons und kurzen Beschreibungen
- **Open Source Sektion** → GitHub-Link, Transparenz, Community-Einladung
- **Vergleichstabelle** → Zingra PW vs. LastPass vs. 1Password vs. Bitwarden
- **Footer** → Dokumentation-Links, Sprach-Umschalter (DE/EN)

### 2. Authentifizierung
- **E-Mail/Passwort** → Standard-Registrierung und Login
- **OAuth-Provider** → Google, Discord, GitHub
- **Master-Passwort Setup** → Separates, lokales Verschlüsselungs-Passwort
- **Sicherheitscheck** → Passwort-Stärke-Indikator bei Erstellung

### 3. Tresor (Vault Dashboard)
- **Übersicht** → Alle Einträge als Karten oder Liste
- **Schnellsuche** → Sofortige Filterung nach Name, URL, Tags
- **Kategorien-Sidebar** → Ordner wie "Arbeit", "Privat", "Finanzen"
- **Favoriten** → Schneller Zugriff auf wichtige Einträge
- **Tags** → Flexible Filterung

### 4. Passwort-Eintrag erstellen/bearbeiten
- **Titel** → Name des Dienstes (z.B. "Netflix")
- **Beschreibung** → Optional, wofür der Dienst ist
- **URL** → Website-Adresse
- **Benutzername/E-Mail** → Login-Daten
- **Passwort** → Mit Ein-Klick-Generator und Sichtbarkeits-Toggle
- **TOTP/2FA** → QR-Code scannen oder Secret manuell eingeben
- **Notizen** → Verschlüsselte Zusatzinfos
- **Kategorie & Tags** → Organisation

### 5. Passwort-Generator
- **Länge** → Slider (8-128 Zeichen)
- **Optionen** → Großbuchstaben, Kleinbuchstaben, Zahlen, Sonderzeichen
- **Passphrase-Modus** → Zufällige Wörter mit Trennzeichen
- **Stärke-Indikator** → Visuelle Bewertung der Passwortstärke

### 6. Sichere Notizen
- **Eigener Eintragstyp** → Für sensible Informationen ohne Login-Daten
- **Formatierung** → Einfacher Rich-Text Editor
- **Vollverschlüsselt** → Wie alle anderen Daten

### 7. Kontoeinstellungen
- **Profil** → Name, Avatar
- **Sicherheit** → Master-Passwort ändern, 2FA für Account
- **Verknüpfte Konten** → OAuth-Verbindungen verwalten
- **Export/Import** → CSV/JSON Export der verschlüsselten Daten
- **Sprache** → Deutsch/Englisch umschalten
- **Theme** → Hell/Dunkel/System

---

## 🎨 Design

### Stil
- **Modern & Clean** → Viel Weißraum, klare Typografie
- **Dark/Light Mode** → Beide Modi mit System-Erkennung
- **Responsive** → Mobile-First Design, funktioniert ab 320px Breite
- **Accessibility** → ARIA-Labels, Tastaturnavigation, ausreichend Kontrast

### Farbpalette
- **Primary** → Blau-Töne (Vertrauen, Sicherheit)
- **Accent** → Grün für Erfolg, Rot für Warnungen
- **Neutral** → Grautöne für Text und Hintergründe

---

## 🌍 Internationalisierung

### Struktur
- **i18n-System** → Zentrale Übersetzungsdateien (JSON)
- **Sprachen** → Deutsch (Standard) und Englisch
- **Erweiterbar** → Einfaches Hinzufügen neuer Sprachen durch JSON-Dateien
- **Dokumentiert** → Anleitung für Übersetzer in README

---

## 📚 Dokumentation (Open Source Ready)

### Für Nutzer
- **Erste Schritte** → Installation, Account-Erstellung
- **Sicherheits-Guide** → Wie die Verschlüsselung funktioniert
- **FAQ** → Häufige Fragen

### Für Entwickler
- **Architektur-Übersicht** → Diagramme, Datenfluss
- **Code-Kommentare** → JSDoc für alle Funktionen
- **Contribution Guide** → Wie man beitragen kann
- **Übersetzungs-Guide** → Neue Sprachen hinzufügen

---

## 🚀 Implementierungs-Reihenfolge

### Phase 1: Fundament
1. Datenbank-Schema mit RLS-Policies
2. i18n-System einrichten (DE/EN)
3. Authentifizierung (E-Mail + OAuth-Provider)
4. Master-Passwort & Verschlüsselungs-Logik

### Phase 2: Kernfunktionen
5. Tresor-Dashboard mit Sidebar-Navigation
6. Passwort-Einträge erstellen/bearbeiten/löschen
7. Passwort-Generator
8. Such- und Filterfunktionen

### Phase 3: Erweiterte Features
9. TOTP/2FA-Support
10. Sichere Notizen
11. Kategorien, Tags, Favoriten
12. Dark/Light Mode Toggle

### Phase 4: Landing & Polish
13. Öffentliche Landing Page
14. Kontoeinstellungen
15. Export/Import
16. Responsive Optimierung

### Phase 5: Dokumentation
17. README mit Sicherheits-Whitepaper
18. Code-Kommentare vervollständigen
19. Contribution Guidelines

