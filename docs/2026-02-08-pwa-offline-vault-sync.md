# PWA Offline Vault Sync (2026-02-08)

## Ziel
- App als installierbare PWA nutzbar machen.
- Vault-Inhalte nach erfolgreichem Unlock lokal cachen, damit sie offline einsehbar sind.
- Offline-Aenderungen lokal puffern und bei Internet automatisch mit Supabase synchronisieren.
- Vault-UI fuer sehr schmale Screens (bis ca. 300px Breite) verbessern.

## Technische Umsetzung

### 1) PWA-Grundlage
- `public/manifest.webmanifest` hinzugefuegt.
- `public/sw.js` hinzugefuegt:
  - App-Shell Caching
  - Navigation-Fallback auf `index.html` bei Offline
  - Stale-while-revalidate fuer statische same-origin Ressourcen
- `index.html`:
  - Manifest-Link + Mobile Web App Meta-Tags + Theme Color + Apple Touch Icon
- `src/main.tsx`:
  - Service Worker Registrierung im Production-Build

### 2) Offline Vault Cache + Sync Queue
- Neue Service-Datei: `src/services/offlineVaultService.ts`
  - IndexedDB Snapshot pro User:
    - `vaultId`
    - `items` (verschluesselte Vault-Rows)
    - `categories`
  - IndexedDB Mutation-Queue pro User:
    - `upsert_item`, `delete_item`, `upsert_category`, `delete_category`
  - Remote-Snapshot laden und lokal speichern
  - Fallback auf Cache bei Offline/Netzfehler
  - Re-Sync-Funktion fuer queued Mutations

### 3) Vault-Komponenten integriert
- `src/components/vault/VaultItemList.tsx`
  - Laden via `loadVaultSnapshot(...)` (remote-first, cache-fallback)
  - Cache wird fuer Offline-Ansicht genutzt
- `src/components/vault/VaultItemDialog.tsx`
  - Create/Update/Delete online direkt, offline lokal + Queue
  - Laden von Item/Kategorien funktioniert mit Cache-Fallback
- `src/components/vault/CategoryDialog.tsx`
  - Category Create/Update/Delete online direkt, offline lokal + Queue
  - Category-Unlink in Items wird offline/online korrekt verarbeitet
- `src/components/vault/VaultSidebar.tsx`
  - Kategorien + Counts aus Snapshot (offline faehig)
  - optionaler `compactMode` fuer mobile Sidebar in Sheet

### 4) Auto-Sync + Mobile UX
- `src/pages/VaultPage.tsx`
  - Online/Offline Statusanzeige
  - Auto-Sync bei Reconnect (`syncOfflineMutations(...)`)
  - Mobile Sidebar als `Sheet` statt fester Desktop-Sidebar
  - Filterleiste horizontal scrollbar, Header-Layout fuer schmale Breiten optimiert

### 5) Datenschutz-Transparenz
- `src/i18n/locales/en.json` und `src/i18n/locales/de.json`
  - `privacy.cookies.content` erweitert um Hinweis auf LocalStorage + IndexedDB + verschluesselten Offline-Cache

## Erwartetes Laufzeitverhalten
1. User meldet sich online an und entsperrt den Vault mit Master-Passwort.
2. Vault-Daten werden lokal in IndexedDB gespiegelt.
3. Bei Offline:
   - Inhalte bleiben einsehbar.
   - Aenderungen werden lokal gespeichert und in Queue gelegt.
4. Bei Reconnect:
   - Queue wird automatisch synchronisiert.
   - Snapshot wird aus Remote-Stand aktualisiert.

## Hinweise / Grenzen
- Fuer Offline-Nutzung muss mindestens ein initialer Online-Snapshot vorhanden sein.
- Konfliktbehandlung folgt derzeit einem pragmatischen Replay-Ansatz (Queue-Reihenfolge, danach Remote-Refresh).
