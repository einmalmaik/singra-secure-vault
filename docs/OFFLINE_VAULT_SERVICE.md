# OfflineVaultService — Offline-Vault-Cache & Sync

> **Datei:** `src/services/offlineVaultService.ts`  
> **Zweck:** Offline-First-Architektur mit IndexedDB-Cache und Mutation-Queue für lokale Änderungen, die bei Wiederverbindung synchronisiert werden.

---

## Architektur-Überblick

```
Online:   Supabase ──► fetchRemoteOfflineSnapshot() ──► IndexedDB (Snapshot)
                                                              ▲
Offline:  Lokale Änderungen ──► enqueueOfflineMutation()     │
                                       │                      │
                                       ▼                      │
                               IndexedDB (Mutations)          │
                                       │                      │
Online:   syncOfflineMutations() ──────┴───── Replay → Supabase
```

**IndexedDB-Datenbank:** `singra-offline-vault` (Version 1)

| Object Store | Key | Zweck |
|---|---|---|
| `snapshots` | `userId` | Vault-Snapshots pro Nutzer |
| `mutations` | `id` (UUID) | Warteschlange ausstehender Änderungen |

---

## Types

### `OfflineVaultSnapshot`
```typescript
interface OfflineVaultSnapshot {
    userId: string;
    vaultId: string | null;
    items: VaultItemRow[];
    categories: CategoryRow[];
    lastSyncedAt: string | null;
    updatedAt: string;
    encryptionSalt?: string | null;       // für Offline-Unlock
    masterPasswordVerifier?: string | null; // für Offline-Unlock
}
```

### `OfflineMutation` (Union-Typ)
Vier Varianten: `upsert_item`, `delete_item`, `upsert_category`, `delete_category`  
Jede enthält: `id` (UUID), `userId`, `createdAt`, `type`, `payload`

---

## Funktionen

### Netzwerk-Erkennung

#### `isAppOnline(): boolean`
Prüft `navigator.onLine`. Gibt `true` zurück wenn `navigator` nicht verfügbar (SSR).

#### `isLikelyOfflineError(error): boolean`
Erkennt Netzwerk-Fehler anhand der Fehlermeldung.

**Geprüfte Muster:** `'failed to fetch'`, `'network'`, `'fetch'`, `'load failed'`, `'xhr'`

---

### Snapshot-Verwaltung

#### `getOfflineSnapshot(userId): Promise<OfflineVaultSnapshot | null>`
Liest den Snapshot aus IndexedDB für den gegebenen User.

#### `saveOfflineSnapshot(snapshot): Promise<void>`
Speichert/überschreibt einen Snapshot in IndexedDB.

#### `saveOfflineCredentials(userId, encryptionSalt, masterPasswordVerifier): Promise<void>`
Speichert Verschlüsselungs-Credentials für den Offline-Unlock.

**Ablauf:**
1. Lädt oder erstellt den Snapshot für den User
2. Setzt `encryptionSalt` und `masterPasswordVerifier`
3. Speichert den aktualisierten Snapshot

#### `getOfflineCredentials(userId): Promise<{ salt, verifier } | null>`
Liest gecachete Credentials für den Offline-Unlock.

---

### Item- und Kategorie-Verwaltung (lokal)

#### `upsertOfflineItemRow(userId, row, vaultIdOverride?): Promise<void>`
Fügt ein Item zum lokalen Snapshot hinzu oder aktualisiert es.

**Merge-Logik:** Existierendes Item wird mit dem neuen zusammengeführt, wobei `created_at` beibehalten wird.

#### `removeOfflineItemRow(userId, itemId): Promise<void>`
Entfernt ein Item aus dem lokalen Snapshot.

#### `upsertOfflineCategoryRow(userId, row): Promise<void>`
Fügt eine Kategorie zum lokalen Snapshot hinzu/aktualisiert sie.

#### `removeOfflineCategoryRow(userId, categoryId): Promise<void>`
Entfernt eine Kategorie aus dem lokalen Snapshot.

---

### Row-Builder

#### `buildVaultItemRowFromInsert(insert): VaultItemRow`
Konvertiert ein Insert-Objekt in eine vollständige Row mit Standardwerten und Zeitstempeln.

#### `buildCategoryRowFromInsert(insert): CategoryRow`
Konvertiert ein Kategorie-Insert in eine vollständige Row.

---

### Mutation-Queue

#### `enqueueOfflineMutation(mutation): Promise<string>`
Reiht eine Offline-Mutation in die Warteschlange ein.

**Ablauf:**
1. Generiert eine UUID via `crypto.randomUUID()`
2. Setzt `createdAt: now()`
3. Speichert in `mutations` Object Store

**Rückgabe:** ID der erstellten Mutation

#### `getOfflineMutations(userId): Promise<OfflineMutation[]>`
Liest alle ausstehenden Mutationen für einen User, **sortiert nach `createdAt`** (älteste zuerst).

#### `removeOfflineMutations(mutationIds): Promise<void>`
Löscht erfolgreich verarbeitete Mutationen aus der Queue.

---

### Vault-ID-Auflösung

#### `resolveDefaultVaultId(userId): Promise<string | null>`
Ermittelt die ID des Standard-Vaults.

**Ablauf:**
1. **Online:** Fragt Supabase nach `vaults` mit `is_default: true`
   - Speichert die gelesene ID im lokalen Snapshot
2. **Offline/Fehler:** Liest die gecachete `vaultId` aus dem Snapshot

---

### Remote-Sync

#### `fetchRemoteOfflineSnapshot(userId): Promise<OfflineVaultSnapshot>`
Lädt den kompletten Vault vom Server und speichert ihn als lokalen Snapshot.

**Ablauf:**
1. Liest den Standard-Vault (`vaults` mit `is_default: true`)
2. Liest alle Kategorien (`categories`) sortiert nach `sort_order`
3. Liest alle Items (`vault_items`) sortiert nach `updated_at DESC`
4. Erstellt einen Snapshot mit `lastSyncedAt: now()`
5. Speichert den Snapshot in IndexedDB

---

#### `loadVaultSnapshot(userId): Promise<{ snapshot, source }>`
Intelligentes Laden des Vault-Snapshots.

**Ablauf:**
1. **Online:** Versucht `fetchRemoteOfflineSnapshot()`
   - Fehler → prüft ob Netzwerk-Fehler → Fallback auf Cache
2. **Offline:** Liest aus IndexedDB-Cache
3. **Kein Cache:** Gibt leeren Snapshot zurück

**Rückgabe:**
| `source` | Bedeutung |
|---|---|
| `'remote'` | Frisch vom Server geladen |
| `'cache'` | Aus IndexedDB-Cache |
| `'empty'` | Kein Daten verfügbar |

---

#### `syncOfflineMutations(userId): Promise<{ processed, remaining, errors }>`
Spielt die Mutation-Queue gegen den Server ab.

**Ablauf:**
1. Liest alle ausstehenden Mutationen
2. Wenn keine vorhanden oder offline → gibt sofort `{ 0, 0, 0 }` zurück
3. Iteriert sequentiell durch die Queue:
   - `upsert_item` → `supabase.from('vault_items').upsert()`
   - `delete_item` → `supabase.from('vault_items').delete()`
   - `upsert_category` → `supabase.from('categories').upsert()`
   - `delete_category` → `supabase.from('categories').delete()`
4. **Bei Offline-Fehler:** Bricht die Schleife ab (Retry bei nächster Verbindung)
5. **Bei anderem Fehler:** Bricht ab, zählt `errors + 1`
6. Löscht erfolgreich verarbeitete Mutationen
7. Lädt frischen Remote-Snapshot nach erfolgreicher Sync

**Rückgabe:** `{ processed: Anzahl verarbeitet, remaining: verbleibend, errors: Fehleranzahl }`

---

## Interne Hilfsfunktionen

### `openDb(): Promise<IDBDatabase>`
Öffnet die IndexedDB-Datenbank (Singleton-Promise). Erstellt Object Stores beim Upgrade.

### `withStore<T>(storeName, mode, handler): Promise<T>`
Transaktions-Wrapper für IndexedDB-Operationen.

### `nowIso(): string`
Gibt `new Date().toISOString()` zurück.

### `createEmptySnapshot(userId): OfflineVaultSnapshot`
Erzeugt einen leeren Snapshot mit leeren Arrays und `null`-Werten.

### `ensureSnapshot(userId): Promise<OfflineVaultSnapshot>`
Liest den existierenden Snapshot oder erstellt einen leeren.
