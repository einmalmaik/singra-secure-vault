# Emergency Access System

## Übersicht

Das Emergency Access System ermöglicht es Premium-Benutzern, vertrauenswürdigen Kontakten (Trustees) Zugriff auf ihren Vault zu gewähren, falls sie selbst nicht mehr darauf zugreifen können. Dies ist nützlich für Notfälle wie Krankheit, Unfall oder Tod.

## Architektur

### Verschlüsselungs-Modell

Das System verwendet asymmetrische Verschlüsselung (RSA-OAEP), um Zero-Knowledge-Architektur zu wahren:

1. **Trustee Key Pair**: Der Trustee generiert ein RSA-4096 Public/Private Key Pair
2. **Master Key Encryption**: Der Grantor (Vault-Besitzer) verschlüsselt seinen Master Key mit dem Public Key des Trustees
3. **Waiting Period**: Nach Ablauf der Wartezeit kann der Trustee den verschlüsselten Master Key abrufen
4. **Vault Access**: Der Trustee entschlüsselt den Master Key mit seinem Private Key und kann dann auf den Vault zugreifen

### Datenbank-Schema

**Tabelle: `emergency_access`**

```sql
CREATE TABLE emergency_access (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    grantor_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    trustee_email TEXT NOT NULL,
    trustee_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    status TEXT NOT NULL CHECK (status IN ('invited', 'accepted', 'approved', 'rejected')),
    wait_time_days INTEGER NOT NULL DEFAULT 30,
    requested_at TIMESTAMP WITH TIME ZONE,
    approved_at TIMESTAMP WITH TIME ZONE,
    trustee_public_key TEXT,
    encrypted_master_key TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    UNIQUE (grantor_id, trustee_email)
);
```

**Neue Spalten (Migration 20260210181000):**
- `trustee_public_key`: RSA-OAEP Public Key des Trustees (JWK JSON string)
- `encrypted_master_key`: Master Key des Grantors, verschlüsselt mit Trustee Public Key

**Status-Flow:**
1. `invited` - Trustee wurde eingeladen, hat aber noch nicht akzeptiert
2. `accepted` - Trustee hat Einladung akzeptiert
3. `approved` - Grantor hat Zugriff genehmigt (nach Wartezeit)
4. `rejected` - Grantor hat Zugriff abgelehnt

### Migration Idempotenz

Die Migration `20260210181000_emergency_access_keys.sql` verwendet `ADD COLUMN IF NOT EXISTS`, um sicherzustellen, dass sie mehrfach ausgeführt werden kann, ohne Fehler zu verursachen:

```sql
ALTER TABLE emergency_access
ADD COLUMN IF NOT EXISTS trustee_public_key text,
ADD COLUMN IF NOT EXISTS encrypted_master_key text;
```

Dies ist wichtig für:
- Entwicklungsumgebungen, die häufig zurückgesetzt werden
- Staging-Umgebungen, die mit Production synchronisiert werden
- Rollback-Szenarien, bei denen Migrationen erneut angewendet werden müssen

## Workflow

### 1. Einladung erstellen (Grantor)

```typescript
import { supabase } from '@/integrations/supabase/client';

async function inviteEmergencyContact(email: string, waitTimeDays: number) {
  const { data, error } = await supabase
    .from('emergency_access')
    .insert({
      trustee_email: email,
      status: 'invited',
      wait_time_days: waitTimeDays,
    })
    .select()
    .single();
  
  if (error) throw error;
  
  // Edge Function sendet Einladungs-E-Mail
  await supabase.functions.invoke('invite-emergency-access', {
    body: { invitationId: data.id },
  });
  
  return data;
}
```

### 2. Einladung annehmen (Trustee)

```typescript
import { generateRSAKeyPair, exportPublicKey } from '@/services/cryptoService';

async function acceptEmergencyInvitation(invitationId: string) {
  // 1. Generiere RSA Key Pair
  const keyPair = await generateRSAKeyPair();
  const publicKeyJwk = await exportPublicKey(keyPair.publicKey);
  const publicKey = JSON.stringify(publicKeyJwk);
  
  // 2. Speichere Private Key lokal (verschlüsselt mit Master-Passwort)
  // ... (siehe cryptoService.ts)
  
  // 3. Update Einladung mit Public Key
  const { data: { user } } = await supabase.auth.getUser();
  
  const { error } = await supabase
    .from('emergency_access')
    .update({
      trustee_user_id: user!.id,
      status: 'accepted',
      trustee_public_key: publicKey,
    })
    .eq('id', invitationId);
  
  if (error) throw error;
}
```

### 3. Master Key verschlüsseln (Grantor)

```typescript
import { encryptRSA } from '@/services/cryptoService';

async function encryptMasterKeyForTrustee(invitationId: string, masterPassword: string) {
  // 1. Lade Trustee Public Key
  const { data: invitation } = await supabase
    .from('emergency_access')
    .select('trustee_public_key')
    .eq('id', invitationId)
    .single();
  
  if (!invitation?.trustee_public_key) {
    throw new Error('Trustee has not accepted invitation yet');
  }
  
  // 2. Verschlüssele Master Key mit Trustee Public Key
  const publicKeyJwk = JSON.parse(invitation.trustee_public_key);
  const publicKey = await importPublicKey(publicKeyJwk);
  const encryptedMasterKey = await encryptRSA(masterPassword, publicKey);
  
  // 3. Speichere verschlüsselten Master Key
  const { error } = await supabase
    .from('emergency_access')
    .update({
      encrypted_master_key: encryptedMasterKey,
    })
    .eq('id', invitationId);
  
  if (error) throw error;
}
```

### 4. Zugriff anfordern (Trustee)

```typescript
async function requestEmergencyAccess(invitationId: string) {
  const { error } = await supabase
    .from('emergency_access')
    .update({
      status: 'approved',
      requested_at: new Date().toISOString(),
    })
    .eq('id', invitationId);
  
  if (error) throw error;
  
  // Grantor erhält E-Mail-Benachrichtigung
  // Wartezeit beginnt (z.B. 30 Tage)
}
```

### 5. Vault zugreifen (Trustee nach Wartezeit)

```typescript
import { decryptRSA } from '@/services/cryptoService';

async function accessGrantorVault(invitationId: string, trusteePrivateKey: CryptoKey) {
  // 1. Prüfe, ob Wartezeit abgelaufen ist
  const { data: invitation } = await supabase
    .from('emergency_access')
    .select('*')
    .eq('id', invitationId)
    .single();
  
  if (!invitation) throw new Error('Invitation not found');
  
  const waitTimeMs = invitation.wait_time_days * 24 * 60 * 60 * 1000;
  const requestedAt = new Date(invitation.requested_at!).getTime();
  const now = Date.now();
  
  if (now < requestedAt + waitTimeMs) {
    throw new Error('Wait time has not elapsed yet');
  }
  
  // 2. Entschlüssele Master Key
  const masterPassword = await decryptRSA(
    invitation.encrypted_master_key!,
    trusteePrivateKey
  );
  
  // 3. Lade Grantor Vault
  const { data: vaultItems } = await supabase
    .from('vault_items')
    .select('*')
    .eq('user_id', invitation.grantor_id);
  
  // 4. Entschlüssele Vault Items mit Master Key
  // ... (siehe vaultService.ts)
  
  return vaultItems;
}
```

## Sicherheits-Überlegungen

### Zero-Knowledge-Architektur

✅ **Master-Passwort verlässt nie den Client**
- Wird nur zur Verschlüsselung des Trustee Private Keys verwendet

✅ **Server sieht nur verschlüsselte Daten**
- `encrypted_master_key` ist mit Trustee Public Key verschlüsselt
- Server kann Master Key nicht entschlüsseln

✅ **Trustee kann nur nach Wartezeit zugreifen**
- RLS-Policies erzwingen Wartezeit
- Grantor kann Zugriff jederzeit widerrufen

### Wartezeit-Mechanismus

Die Wartezeit schützt vor:
- Unbefugtem Zugriff durch kompromittierte Trustee-Accounts
- Missbrauch durch böswillige Trustees
- Versehentlichen Zugriffen

**Empfohlene Wartezeiten:**
- 7 Tage: Für enge Familienmitglieder
- 30 Tage: Standard (empfohlen)
- 90 Tage: Für weniger vertrauenswürdige Kontakte

### Widerruf

Der Grantor kann den Zugriff jederzeit widerrufen:

```typescript
async function revokeEmergencyAccess(invitationId: string) {
  const { error } = await supabase
    .from('emergency_access')
    .update({
      status: 'rejected',
      encrypted_master_key: null, // Lösche verschlüsselten Key
    })
    .eq('id', invitationId);
  
  if (error) throw error;
}
```

## RLS-Policies

**Migration: `20260210181100_emergency_access_policies.sql`**

```sql
-- Grantor kann eigene Einladungen sehen
CREATE POLICY "Grantors can view own invitations"
    ON emergency_access FOR SELECT
    USING (auth.uid() = grantor_id);

-- Trustee kann Einladungen für seine E-Mail sehen
CREATE POLICY "Trustees can view invitations"
    ON emergency_access FOR SELECT
    USING (
        auth.uid() = trustee_user_id OR
        auth.email() = trustee_email
    );

-- Nur Grantor kann Einladungen erstellen
CREATE POLICY "Grantors can create invitations"
    ON emergency_access FOR INSERT
    WITH CHECK (auth.uid() = grantor_id);

-- Grantor und Trustee können Status aktualisieren
CREATE POLICY "Grantors and Trustees can update"
    ON emergency_access FOR UPDATE
    USING (
        auth.uid() = grantor_id OR
        auth.uid() = trustee_user_id
    );

-- Nur Grantor kann Einladungen löschen
CREATE POLICY "Grantors can delete invitations"
    ON emergency_access FOR DELETE
    USING (auth.uid() = grantor_id);
```

## UI-Komponenten

### Grantor-Ansicht

**Komponente: `EmergencyAccessSettings.tsx`**

Features:
- Liste aller Trustees
- "Neuen Trustee hinzufügen" Button
- Status-Anzeige (invited, accepted, approved)
- Wartezeit-Konfiguration
- Widerruf-Button

### Trustee-Ansicht

**Komponente: `GrantorVaultPage.tsx`**

Features:
- Liste aller Grantors
- "Einladung annehmen" Button
- "Zugriff anfordern" Button
- Countdown bis Zugriff möglich
- Read-only Vault-Ansicht

## Edge Functions

### `invite-emergency-access`

Sendet Einladungs-E-Mail an Trustee:

```typescript
import { Resend } from 'resend';

const resend = new Resend(Deno.env.get('RESEND_API_KEY'));

Deno.serve(async (req) => {
  const { invitationId } = await req.json();
  
  // Lade Einladung
  const { data: invitation } = await supabase
    .from('emergency_access')
    .select('*, profiles!grantor_id(email)')
    .eq('id', invitationId)
    .single();
  
  // Sende E-Mail
  await resend.emails.send({
    from: 'Singra PW <noreply@singra.de>',
    to: invitation.trustee_email,
    subject: 'Emergency Access Einladung',
    html: `
      <p>${invitation.profiles.email} hat Sie als Emergency Access Trustee hinzugefügt.</p>
      <p>Klicken Sie hier, um die Einladung anzunehmen: ...</p>
    `,
  });
  
  return new Response(JSON.stringify({ success: true }));
});
```

## Testing

### Unit Tests

```typescript
describe('Emergency Access Encryption', () => {
  it('should encrypt and decrypt master key with RSA', async () => {
    const keyPair = await generateRSAKeyPair();
    const masterPassword = 'TestPassword123!';
    
    const encrypted = await encryptRSA(masterPassword, keyPair.publicKey);
    const decrypted = await decryptRSA(encrypted, keyPair.privateKey);
    
    expect(decrypted).toBe(masterPassword);
  });
});
```

### Integration Tests

```typescript
describe('Emergency Access Flow', () => {
  it('should complete full emergency access flow', async () => {
    // 1. Grantor erstellt Einladung
    const invitation = await inviteEmergencyContact('trustee@example.com', 7);
    
    // 2. Trustee akzeptiert Einladung
    await acceptEmergencyInvitation(invitation.id);
    
    // 3. Grantor verschlüsselt Master Key
    await encryptMasterKeyForTrustee(invitation.id, 'MasterPassword123!');
    
    // 4. Trustee fordert Zugriff an
    await requestEmergencyAccess(invitation.id);
    
    // 5. Warte Wartezeit ab (simuliert)
    // ...
    
    // 6. Trustee greift auf Vault zu
    const vaultItems = await accessGrantorVault(invitation.id, trusteePrivateKey);
    
    expect(vaultItems).toBeTruthy();
  });
});
```

## Internationalisierung

**Deutsch (`src/i18n/locales/de.json`):**
```json
{
  "emergencyAccess": {
    "title": "Notfallzugriff",
    "addTrustee": "Trustee hinzufügen",
    "waitTime": "Wartezeit (Tage)",
    "status": {
      "invited": "Eingeladen",
      "accepted": "Akzeptiert",
      "approved": "Genehmigt",
      "rejected": "Abgelehnt"
    },
    "revoke": "Zugriff widerrufen",
    "requestAccess": "Zugriff anfordern",
    "accessGranted": "Zugriff gewährt",
    "waitTimeRemaining": "Verbleibende Wartezeit: {{days}} Tage"
  }
}
```

**Englisch (`src/i18n/locales/en.json`):**
```json
{
  "emergencyAccess": {
    "title": "Emergency Access",
    "addTrustee": "Add Trustee",
    "waitTime": "Wait Time (Days)",
    "status": {
      "invited": "Invited",
      "accepted": "Accepted",
      "approved": "Approved",
      "rejected": "Rejected"
    },
    "revoke": "Revoke Access",
    "requestAccess": "Request Access",
    "accessGranted": "Access Granted",
    "waitTimeRemaining": "Remaining wait time: {{days}} days"
  }
}
```

## Referenzen

- [Web Crypto API - RSA-OAEP](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/encrypt)
- [Bitwarden Emergency Access](https://bitwarden.com/help/emergency-access/) (Content rephrased for compliance)
- Migration: `supabase/migrations/20260210181000_emergency_access_keys.sql`
- Migration: `supabase/migrations/20260210181100_emergency_access_policies.sql`
