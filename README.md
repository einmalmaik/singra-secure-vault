# Singra Password Manager

Wilkommen bei **Singra PW**, deinem sicheren, Open-Source Passwort-Manager.

**Live-URL**: [singrapw.mauntingstudios.de](https://singrapw.mauntingstudios.de)

## Was ist Singra?

Singra (abgeleitet von "Singularity") ist ein moderner, webbasierter Passwort-Manager, der deine Datensicherheit in den Mittelpunkt stellt. Er ermöglicht es dir, deine Passwörter sicher zu speichern, zu verwalten und von überall darauf zuzugreifen, ohne die Kontrolle über deine Daten aufzugeben.

### Sicherheitsarchitektur

Singra verfolgt einen **Zero-Knowledge** Ansatz. Das bedeutet, dass deine Passwörter **ausschließlich auf deinem Gerät** ("Client-Side") verschlüsselt und entschlüsselt werden. Niemand – nicht einmal der Server-Administrator – kann deine Daten lesen.

Technische Details:
- **Verschlüsselung**: AES-GCM (Advanced Encryption Standard im Galois/Counter Mode) für die sichere Verschlüsselung deiner Daten.
- **Schlüsselableitung**: Argon2id Hash-Algorithmus, um dein Master-Passwort in einen kryptografisch sicheren Schlüssel zu verwandeln. Dies macht Brute-Force-Angriffe extrem schwierig.

## Installation & Lokale Entwicklung

Du kannst Singra ganz einfach auf deinem eigenen PC laufen lassen.

### Voraussetzungen
- [Node.js](https://nodejs.org/) & npm müssen installiert sein.

### Schritte

1. **Repository klonen**
   ```sh
   git clone https://github.com/einmalmaik/singra-secure-vault.git
   cd singra-secure-vault
   ```

2. **Abhängigkeiten installieren**
   ```sh
   npm install
   ```

3. **Umgebungsvariablen konfigurieren**
   Erstelle eine `.env` Datei im Hauptverzeichnis (basiert auf `.env.example`) und trage deine Supabase-Zugangsdaten ein.

4. **Anwendung starten**
   ```sh
   npm run dev
   ```
   Die Anwendung ist nun unter `http://localhost:8080` (oder einem ähnlichen Port) erreichbar.

## Technologien

Dieses Projekt basiert auf modernen Web-Technologien:
- **Frontend**: React, TypeScript, Vite
- **UI**: Tailwind CSS, shadcn/ui
- **Backend/Datenbank**: Supabase
- **Kryptografie**: Web Crypto API, Argon2id

## Lizenz

Dieses Projekt ist Open Source.
