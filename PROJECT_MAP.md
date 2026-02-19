# PROJECT MAP: Zingra Secure Vault 🗺️

## 1. WAS MACHT DIESE APP?
**Zingra Secure Vault** ist ein digitaler Hochsicherheits-Tresor für Passwörter und sensible Daten.
Das Besondere: Es ist ein **Zero-Knowledge** System. Das bedeutet, der Server (die Cloud) speichert nur Datensalat. Nur der Nutzer hat den Schlüssel (sein Master-Passwort), um diesen Salat wieder lesbar zu machen. Selbst die Entwickler der App können NICHT in die Daten schauen. Zusätzlich nutzt die App **Post-Quantum Kryptographie**, ist also schon jetzt gegen Super-Computer der Zukunft geschützt.

---

## 2. DATEI-ÜBERSICHT 📂

Hier sind die wichtigsten Bausteine der App, einfach erklärt:

### Der Kern (Frontend / Was der Nutzer sieht)

- **`src/App.tsx`**
  - **Was macht sie?**: Der "Verkehrspolizist". Sie entscheidet, welche Seite angezeigt wird (z.B. Login oder Tresor), wenn der Nutzer eine URL aufruft.
  - **Arbeitet zusammen mit**: Allen Seiten (`pages/*`).
  - **Wenn hier ein Bug ist**: Die App zeigt weiße Seiten oder falsche Inhalte an.

- **`src/main.tsx`**
  - **Was macht sie?**: Der "Startknopf". Startet die React-App und lädt die wichtigsten Grundeinstellungen.

### Die Gehirne (Services / Logik)

- **`src/services/cryptoService.ts`** 🔐 **(SEHR WICHTIG)**
  - **Was macht sie?**: Der "Mathematiker". Er nimmt das Passwort des Nutzers und verschlüsselt damit alles. Er sorgt dafür, dass aus "123456" ein unlesbarer Code wird.
  - **Arbeitet zusammen mit**: Fast allem, besonders beim Speichern/Laden.
  - **Vorsicht**: Wenn hier ein Fehler ist, sind **alle Daten für immer verloren**, weil man sie nicht mehr entschlüsseln kann.

- **`src/services/pqCryptoService.ts`** ⚛️
  - **Was macht sie?**: Der "Zukunfts-Wächter". Benutzt extrem komplexe Mathematik (Post-Quantum), damit auch Computer in 20 Jahren die Daten nicht knacken können.
  - **Arbeitet zusammen mit**: `cryptoService.ts`.

- **`src/services/offlineVaultService.ts`**
  - **Was macht sie?**: Das "Gedächtnis". Speichert den Tresor auf dem Gerät, damit man auch ohne Internet an seine Passwörter kommt.

- **`src/services/authService.ts`**
  - **Was macht sie?**: Der "Türsteher". Prüft, ob jemand eingeloggt ist, und regelt die Anmeldung beim Server (Supabase).

### Die Ansichten (Pages)

- **`src/pages/VaultPage.tsx`**
  - **Was macht sie?**: Das "Wohnzimmer". Die Hauptansicht, wo der Nutzer seine Passwörter sieht, sucht und kopiert.

- **`src/pages/Auth.tsx`**
  - **Was macht sie?**: Der "Eingang". Hier gibt man E-Mail und Master-Passwort ein.

- **`src/pages/SettingsPage.tsx`**
  - **Was macht sie?**: Der "Maschinenraum". Hier ändert man Einstellungen, Design oder das Passwort.

### Der Server & Datenbank (Backend / Supabase)

- **`supabase/functions/stripe-webhook/index.ts`** 💳
  - **Was macht sie?**: Die "Kasse". Wenn jemand ein Abo bezahlt (über Stripe), sagt diese Datei der Datenbank: "Ok, schalte Premium frei".
  - **Wenn hier ein Bug ist**: Nutzer zahlen, bekommen aber kein Premium.

- **`supabase/functions/send-test-mail/index.ts`** (und ähnliche)
  - **Was macht sie?**: Der "Postbote". Sendet E-Mails (z.B. Einladungen) an Nutzer.

---

## 3. FEATURES UND IHRE REISE DURCH DEN CODE 🚀

Hier siehst du, welche Dateien zusammenspielen, wenn der Nutzer etwas tut.

### Feature: **Ein neues Passwort speichern**
1. **Benutzer** tippt Passwort in `VaultPage.tsx` ein.
2. **`VaultContext`** nimmt die Daten entgegen.
3. **`cryptoService.ts`** verschlüsselt die Daten (macht sie unlesbar).
4. **`Supabase`** (Datenbank) speichert den verschlüsselten Text.
5. **`offlineVaultService.ts`** speichert eine Kopie lokal auf dem Gerät.

### Feature: **Notfall-Zugriff (Wenn mir was passiert)**
1. **Benutzer** definiert einen Vertrauten in `SettingsPage.tsx`.
2. **`emergencyAccessService.ts`** bereitet spezielle Schlüssel vor.
3. Im Ernstfall: Vertrauter geht auf `GrantorVaultPage.tsx`.
4. Nach Wartezeit: **`cryptoService.ts`** und **`pqCryptoService.ts`** tauschen Schlüssel aus, damit der Vertraute den Tresor öffnen kann.

### Feature: **Premium-Abo kaufen**
1. **Benutzer** klickt "Kaufen" auf `PricingPage.tsx`.
2. **`subscriptionService.ts`** leitet zu Stripe (Zahlungsdienstleister) weiter.
3. Stripe meldet Erfolg an **`supabase/functions/stripe-webhook`**.
4. Die Datenbank wird aktualisiert -> Nutzer hat Premium.

---

## 4. GEFÄHRLICHE ZONEN ⚠️☠️

Hier musst du extrem vorsichtig sein. "Don't touch unless you know exactly what you are doing."

| Datei / Bereich | Warum gefährlich? | Risiko-Level |
|-----------------|-------------------|--------------|
| **`src/services/cryptoService.ts`** | Das Herz der Sicherheit. Ein Fehler hier = Datenmüll. | 🟥 EXTREM |
| **`src/services/pqCryptoService.ts`** | Hochkomplexe Mathematik. Ein kleiner Tippfehler macht die Verschlüsselung unsicher oder kaputt. | 🟥 EXTREM |
| **`src/services/keyMaterialService.ts`** | Verwaltet die "Schlüsselbunde". Falsche Handhabung = Schlüssel weg = Tresor zu. | 🟧 HOCH |
| **`supabase/migrations/*`** | Die Struktur der Datenbank. Änderungen hier können existierende Daten löschen oder Inkompatibel machen. | 🟧 HOCH |

---

## 5. WENN ICH FEATURE X BAUEN WILL... 🛠️

Eine Spickzettel für typische Aufgaben:

| Ich will... | Diese Dateien muss ich anfassen |
|-------------|-------------------------------|
| **Neues Feld im Tresor hinzufügen** (z.B. "Geburtsdatum") | 1. `src/types/index.ts` (Datentyp ändern)<br>2. `src/components/VaultItemForm.tsx` (Eingabefeld)<br>3. `src/components/VaultItemDetail.tsx` (Anzeige) |
| **Design / Farben ändern** | 1. `src/index.css` (Globale Stile)<br>2. `tailwind.config.ts` (Farbpalette) |
| **Neue Seite erstellen** | 1. Neue Datei in `src/pages/`<br>2. `src/App.tsx` (Route hinzufügen)<br>3. `src/components/Layout/Sidebar.tsx` (Link im Menü) |
| **E-Mail Text ändern** | `supabase/functions/_shared/email-templates/` |
| **Support-Formular ändern** | `src/services/supportService.ts` und `src/components/SupportWidget.tsx` |

---

## ZUSAMMENFASSUNG
Zingra Secure Vault ist im Kern eine **React-App**, die extrem viel Wert auf **Kryptographie im Browser** legt. Der Server (Supabase) ist ziemlich "dumm" und speichert nur verschlüsselte Blobs. Die ganze Magie passiert in `src/services/`, besonders im `cryptoService.ts`. Wer an der App arbeitet, baut meistens an der UI (`pages`, `components`) oder an der Logik, wie Daten verschlüsselt und synchronisiert werden (`contexts`, `services`).
