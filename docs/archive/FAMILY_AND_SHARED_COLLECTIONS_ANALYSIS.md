# Familien-Organisation & Geteilte Sammlungen - Analyse

## Übersicht

Diese Analyse prüft die Logik und Implementierung der Familien-Organisation und geteilten Sammlungen in Singra Vault.

## Datenbank-Struktur

### Tabellen

1. **`family_members`**
   - `family_owner_id`: Der Besitzer der Familie
   - `member_email`: E-Mail des eingeladenen Mitglieds
   - `member_user_id`: User-ID (NULL bis Einladung angenommen)
   - `role`: 'owner' oder 'member'
   - `status`: 'invited', 'active', 'removed'
   - UNIQUE Constraint: `(family_owner_id, member_email)`

2. **`shared_collections`**
   - `owner_id`: Besitzer der Sammlung
   - `name`: Name der Sammlung
   - `description`: Optionale Beschreibung

3. **`shared_collection_members`**
   - `collection_id`: Referenz zur Sammlung
   - `user_id`: Mitglied der Sammlung
   - `permission`: 'view' oder 'edit'
   - UNIQUE Constraint: `(collection_id, user_id)`

4. **`shared_collection_items`**
   - `collection_id`: Referenz zur Sammlung
   - `vault_item_id`: Referenz zum Vault-Item
   - `added_by`: Wer das Item hinzugefügt hat
   - UNIQUE Constraint: `(collection_id, vault_item_id)`

## ✅ Was funktioniert

### 1. Familien-Einladungen
- ✅ Edge Function `invite-family-member` erstellt Einladung
- ✅ E-Mail wird über den konfigurierten Mail-Transport versendet
- ✅ UNIQUE Constraint verhindert doppelte Einladungen
- ✅ Status-Tracking (invited → active)

### 2. Shared Collections
- ✅ Erstellen von Sammlungen
- ✅ Löschen von Sammlungen (CASCADE löscht Members und Items)
- ✅ RLS-Policies für Zugriffskontrolle

### 3. RLS-Policies
- ✅ Benutzer sehen nur eigene oder geteilte Sammlungen
- ✅ Nur Besitzer können Sammlungen bearbeiten/löschen
- ✅ Mitglieder können Items sehen (je nach Permission)

## ⚠️ Gefundene Probleme

### 1. **KRITISCH: Fehlende Logik zum Annehmen von Einladungen**

**Problem:**
- Es gibt KEINE Funktion, um Familien-Einladungen anzunehmen
- `member_user_id` bleibt NULL
- Status bleibt auf 'invited'
- Eingeladene Benutzer können nicht auf geteilte Sammlungen zugreifen

**Fehlende Komponenten:**
```typescript
// FEHLT: Funktion zum Annehmen von Einladungen
export async function acceptFamilyInvitation(invitationId: string): Promise<void> {
    // Sollte:
    // 1. member_user_id auf auth.uid() setzen
    // 2. status auf 'active' setzen
    // 3. joined_at auf NOW() setzen
}
```

**Fehlende UI:**
- Keine Anzeige von ausstehenden Einladungen
- Kein "Annehmen/Ablehnen"-Button
- Keine Benachrichtigung für eingeladene Benutzer

### 2. **KRITISCH: Fehlende Logik zum Hinzufügen von Items zu Sammlungen**

**Problem:**
- `shared_collection_items` Tabelle existiert
- ABER: Keine Funktionen zum Hinzufügen/Entfernen von Items
- Keine UI zum Verwalten von Items in Sammlungen

**Fehlende Komponenten:**
```typescript
// FEHLT: Funktionen für Collection Items
export async function addItemToCollection(collectionId: string, vaultItemId: string): Promise<void> {}
export async function removeItemFromCollection(collectionId: string, vaultItemId: string): Promise<void> {}
export async function getCollectionItems(collectionId: string): Promise<VaultItem[]> {}
```

**Fehlende UI:**
- Keine Möglichkeit, Vault-Items zu Sammlungen hinzuzufügen
- Keine Anzeige von Items in einer Sammlung
- Keine Möglichkeit, Items aus Sammlungen zu entfernen

### 3. **KRITISCH: Fehlende Logik zum Hinzufügen von Mitgliedern zu Sammlungen**

**Problem:**
- `shared_collection_members` Tabelle existiert
- ABER: Keine Funktionen zum Hinzufügen/Entfernen von Mitgliedern
- Keine UI zum Verwalten von Mitgliedern in Sammlungen

**Fehlende Komponenten:**
```typescript
// FEHLT: Funktionen für Collection Members
export async function addMemberToCollection(collectionId: string, userId: string, permission: 'view' | 'edit'): Promise<void> {}
export async function removeMemberFromCollection(collectionId: string, userId: string): Promise<void> {}
export async function getCollectionMembers(collectionId: string): Promise<CollectionMember[]> {}
export async function updateMemberPermission(collectionId: string, userId: string, permission: 'view' | 'edit'): Promise<void> {}
```

**Fehlende UI:**
- Keine Möglichkeit, Familienmitglieder zu Sammlungen hinzuzufügen
- Keine Anzeige von Mitgliedern einer Sammlung
- Keine Möglichkeit, Permissions zu ändern

### 4. **PROBLEM: Fehlende Verschlüsselungs-Logik für geteilte Items**

**Problem:**
- Vault-Items sind mit dem Master-Passwort des Besitzers verschlüsselt
- Wie sollen Familienmitglieder auf verschlüsselte Items zugreifen?
- Keine Logik für Schlüssel-Sharing oder Re-Encryption

**Mögliche Lösungen:**
1. **Shared Encryption Key**: Sammlung hat eigenen Schlüssel, der mit allen Mitgliedern geteilt wird
2. **Re-Encryption**: Items werden für jedes Mitglied separat verschlüsselt
3. **Asymmetric Encryption**: Public/Private Key Pairs für Mitglieder

**Aktueller Stand:**
- ❌ Keine Implementierung vorhanden
- ❌ Verschlüsselungs-Architektur nicht definiert

### 5. **PROBLEM: Fehlende Validierung der Familiengröße**

**Problem:**
- Families-Plan erlaubt "bis zu 6 Mitglieder"
- KEINE Validierung in der Datenbank oder Edge Function
- Benutzer könnten unbegrenzt Mitglieder einladen

**Fehlende Validierung:**
```typescript
// FEHLT: Prüfung der Familiengröße
const { count } = await supabase
    .from('family_members')
    .select('id', { count: 'exact', head: true })
    .eq('family_owner_id', user.id)
    .eq('status', 'active');

if (count >= 6) {
    throw new Error('Maximum family size reached (6 members)');
}
```

### 6. **PROBLEM: Fehlende Subscription-Tier-Prüfung**

**Problem:**
- Edge Function prüft NICHT, ob Benutzer Families-Tier hat
- Free/Premium-Benutzer könnten theoretisch Familienmitglieder einladen

**Fehlende Prüfung:**
```typescript
// FEHLT: Subscription-Tier-Prüfung
const { data: subscription } = await admin
    .from('subscriptions')
    .select('tier')
    .eq('user_id', user.id)
    .single();

if (subscription?.tier !== 'families') {
    throw new Error('Families subscription required');
}
```

### 7. **PROBLEM: Keine Anzeige von geteilten Sammlungen für Mitglieder**

**Problem:**
- `getSharedCollections()` lädt nur Sammlungen, die der Benutzer BESITZT
- Sammlungen, bei denen der Benutzer MITGLIED ist, werden nicht geladen

**Aktueller Code:**
```typescript
// NUR eigene Sammlungen
export async function getSharedCollections(ownerId: string): Promise<SharedCollection[]> {
  const { data, error } = await supabase
    .from('shared_collections')
    .select('*')
    .eq('owner_id', ownerId)  // ❌ Nur eigene!
    .order('created_at', { ascending: false });
  // ...
}
```

**Sollte sein:**
```typescript
// Eigene UND geteilte Sammlungen
export async function getSharedCollections(userId: string): Promise<SharedCollection[]> {
  const { data, error } = await supabase
    .from('shared_collections')
    .select('*')
    // RLS-Policy filtert automatisch (owner_id = userId OR member)
    .order('created_at', { ascending: false });
  // ...
}
```

## 🔧 Empfohlene Fixes

### Priorität 1: Kritische Funktionalität

1. **Einladungen annehmen**
   - Edge Function `accept-family-invitation`
   - UI-Komponente für ausstehende Einladungen
   - Benachrichtigungen

2. **Collection Items verwalten**
   - Service-Funktionen für Items
   - UI zum Hinzufügen/Entfernen von Items
   - Anzeige von Items in Sammlungen

3. **Collection Members verwalten**
   - Service-Funktionen für Members
   - UI zum Hinzufügen/Entfernen von Mitgliedern
   - Permission-Management

4. **Verschlüsselungs-Architektur**
   - Design-Entscheidung treffen
   - Implementierung der gewählten Lösung
   - Tests für Schlüssel-Sharing

### Priorität 2: Sicherheit & Validierung

5. **Familiengröße validieren**
   - Prüfung in Edge Function
   - UI-Feedback bei Limit

6. **Subscription-Tier prüfen**
   - Prüfung in Edge Function
   - Fehlerbehandlung

7. **Geteilte Sammlungen anzeigen**
   - `getSharedCollections()` anpassen
   - UI für "Meine Sammlungen" vs "Geteilte Sammlungen"

### Priorität 3: UX-Verbesserungen

8. **Einladungs-Status**
   - Anzeige von ausstehenden Einladungen
   - Ablehnen von Einladungen
   - Erneutes Senden von Einladungen

9. **Collection-Details-Seite**
   - Detailansicht für Sammlungen
   - Liste von Items
   - Liste von Mitgliedern
   - Aktivitäts-Log

10. **Benachrichtigungen**
    - E-Mail bei Einladung
    - E-Mail bei Annahme/Ablehnung
    - In-App-Benachrichtigungen

## 🎯 Nächste Schritte

1. **Design-Entscheidung**: Verschlüsselungs-Architektur für geteilte Items
2. **Spec erstellen**: Vollständige Implementierung der fehlenden Funktionalität
3. **Priorisierung**: Mit Stakeholder abstimmen, welche Features zuerst
4. **Implementierung**: Schrittweise Umsetzung nach Priorität

## 📊 Zusammenfassung

**Status: 🔄 IN ENTWICKLUNG**

### ✅ Implementiert (Migration 20260211100000)

**Datenbank-Schema:**
- ✅ `user_keys` Tabelle für RSA-4096 Key Pairs
- ✅ `collection_keys` Tabelle für wrapped Shared Keys
- ✅ `collection_audit_log` Tabelle für Aktivitäts-Logging
- ✅ `encrypted_data` Spalte in `shared_collection_items`
- ✅ `member_count` und `item_count` in `shared_collections`

**RLS-Policies:**
- ✅ Policies für `user_keys` (nur eigene Keys)
- ✅ Policies für `collection_keys` (Owner + Members)
- ✅ Policies für `collection_audit_log` (Owner + Members)

**Trigger & Funktionen:**
- ✅ Audit-Logging für Member/Item-Änderungen
- ✅ Automatische Count-Updates (member_count, item_count)
- ✅ `check_family_size()` - Validierung der Familiengröße
- ✅ `check_subscription_tier()` - Subscription-Tier-Prüfung

**Performance:**
- ✅ Indizes auf collection_keys (collection_id, user_id)
- ✅ Index auf audit_log (collection_id, created_at)

### ⚠️ Noch zu implementieren

**Crypto Service:**
- ❌ `generateUserKeyPair()` - RSA Key Pair Generation
- ❌ `generateSharedKey()` - AES-256 Key Generation
- ❌ `wrapKey()` / `unwrapKey()` - Key Wrapping mit RSA-OAEP
- ❌ `encryptWithSharedKey()` / `decryptWithSharedKey()` - Item Encryption

**Collection Service:**
- ❌ `createCollectionWithKey()` - Collection mit Shared Key erstellen
- ❌ `addMemberToCollection()` - Mitglied hinzufügen + Key Wrapping
- ❌ `addItemToCollection()` - Item verschlüsseln und hinzufügen
- ❌ `getCollectionItems()` - Items laden und entschlüsseln
- ❌ `rotateCollectionKey()` - Key Rotation

**Family Service:**
- ❌ `acceptFamilyInvitation()` - Einladung annehmen
- ❌ `declineFamilyInvitation()` - Einladung ablehnen
- ❌ `getPendingInvitations()` - Ausstehende Einladungen laden

**UI Components:**
- ❌ Key Pair Generation beim ersten Login
- ❌ PendingInvitationsAlert - Banner für Einladungen
- ❌ CollectionDetailsPage - Detailansicht
- ❌ AddMemberDialog - Mitglieder hinzufügen
- ❌ AddItemDialog - Items hinzufügen
- ❌ SharedItemBadge - Badge für geteilte Items

**Edge Functions:**
- ❌ `accept-family-invitation` - Einladung annehmen
- ❌ `add-collection-member` - Mitglied hinzufügen
- ❌ `remove-collection-member` - Mitglied entfernen

### 📋 Nächste Schritte

1. **Phase 1: Crypto Service** (Priorität: HOCH)
   - Implementierung der Verschlüsselungs-Funktionen
   - Unit Tests für alle Crypto-Operationen

2. **Phase 2: Collection Service** (Priorität: HOCH)
   - Implementierung der Collection-Management-Funktionen
   - Integration mit Crypto Service

3. **Phase 3: UI Components** (Priorität: MITTEL)
   - Key Pair Generation Flow
   - Collection Management UI

4. **Phase 4: Testing** (Priorität: HOCH)
   - Integration Tests für End-to-End Flow
   - Security Tests für Access Control

**Dokumentation:**
- ✅ Verschlüsselungs-Architektur dokumentiert in `docs/SHARED_COLLECTIONS_ENCRYPTION.md`
- ✅ Migration angewendet und getestet
- ✅ Design und Requirements in `.kiro/specs/family-shared-collections-complete/`

**Empfehlung:** Datenbank-Grundlage ist solide. Fokus auf Crypto Service und Collection Service für MVP.
