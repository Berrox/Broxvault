# BROX VAULT – Architektur (Version 0.9.0)

Vanilla JavaScript (ES-Module), Vite als Build-Werkzeug, Web Crypto, IndexedDB, OPFS, Service Worker. Einzige Laufzeit-Abhängigkeit: `hash-wasm` 4.12.0 (Argon2id als WebAssembly, eingebettet im Bundle). Keine CDNs, keine Webfonts, keine Bilder von außen.

## Schichten (`src/`)
| Ordner | Aufgabe |
|---|---|
| `core/crypto` | Primitive: AES-GCM-Umschlag (`aead.js`), Argon2id (`kdf.js`), HKDF (`hkdf.js`), Zufall |
| `core/keys` | Tresor anlegen/entsperren/Passwort ändern (`vault.js`), Sitzungsschlüssel (`session.js`), Schlüsselbund (`keyring.js`) |
| `core/db` | IndexedDB mit Migrationen (`idb.js`), verschlüsselte Datensätze (`records.js`) |
| `core/files` | Chunk-Verschlüsselung (`chunks.js`), Speicherorte OPFS/IndexedDB (`opfs-*.js`, `idb-backend.js`, `choose.js`) |
| `core` | Integritätsprüfung, Speicherstatus, Einstellungen, Auto-Sperre |
| `modules` | Passwörter, Notizen, persönliche Daten, Dokumente, Fotos, Dashboard, Suche (Oberfläche und Datenzugriff) |
| `backup` | .bvx-Format, Schreiben, Lesen/Prüfen, Wiederherstellung |
| `pwa` | Service Worker (Vorlage), Updates, Installation, Vorgangszähler |
| `ui` | Gerüst, Navigation, Einrichtung/Entsperren, Einstellungen, Speicher & Backups |

Die Oberfläche baut DOM nur mit `createElement`/`textContent` (`ui/dom.js`), nie mit HTML-Strings. Neue Bereiche melden sich über `ui/sections.js` und `modules/specs.js` an; Passwörter, Notizen und persönliche Daten teilen sich eine Oberfläche (`modules/entity-view.js`), gesteuert durch eine Feldbeschreibung.

## Schlüsselarchitektur
```
Master-Passwort (NFKC, UTF-8)
  └─ Argon2id(Salt 16 B; Standard m = 64 MiB, t = 3, p = 1) → 32 B → AES-GCM-Schlüssel „KEK“ (nicht exportierbar)
       └─ entschlüsselt den Tresorschlüssel VK (32 B, zufällig, AAD „BV1|vk-wrap|<Tresor-ID>“)
            └─ als nicht exportierbarer HKDF-Schlüssel importiert (VK-Bytes werden danach überschrieben)
                 ├─ HKDF-SHA-256 „brox-vault/v1/entries“ → Datensätze (Passwörter, Notizen, Metadaten, Ordner)
                 ├─ „…/index“ → reserviert
                 └─ „…/file/<Datei-ID>“ → je Datei ein eigener Schlüssel (Chunks, Vorschaubilder)
```
- Es gibt keinen Passwort-Hash: Ein falsches Passwort fällt am GCM-Tag auf.
- **Passwortwechsel** verpackt nur den Tresorschlüssel neu (neuer Salt); keine Datei wird neu verschlüsselt, Backups bleiben gültig.
- Schlüssel leben nur im Arbeitsspeicher (`session.js`) und werden beim Sperren verworfen. Entschlüsselte Einträge (`modules/data.js`, `filedata.js`) und Blob-URLs ebenfalls.
- Jede Verschlüsselung nutzt einen neuen zufälligen 96-Bit-Nonce; Umschlag = `Version(1) | Nonce(12) | Ciphertext | Tag(16)`.

## Datenformate im Speicher
- **Datensatz:** `{ v, rv, env }` mit AAD `BV1|<Store>|<ID>|<Revision>` (bindet an Store, ID, Revision).
- **Chunk (1 MiB):** AAD `BV1chunk|<Datei-ID>|<Index>|<letzter 0/1>`; Datei vollständig erst, wenn der Metadatensatz nach dem letzten Chunk geschrieben ist.
- **Klartext, der bleibt:** Format-/KDF-Parameter, Salt, Tresor-ID, Anzahl und Größe der Datensätze und Chunks, nicht vertrauliche Einstellungen (Sperrzeit, Erinnerungsintervall, Zeitpunkt des letzten Backups).

## Speicherarchitektur
- **IndexedDB `brox-vault`** (Version 2, nur additive Migrationen): `vault_meta`, `settings`, `entries`, `categories` (Ordner, Alben), `files` (Dateimetadaten und Vorschau-Einträge), `chunks` (nur im Ersatzspeicher).
- **OPFS** `brox-chunks/<Datei-ID>/<Index, 8-stellig>.bin`, Schreibzugriff in einem Worker (`createSyncAccessHandle`).
- **Speicherort-Wahl:** einmalig, gespeichert in `vault_meta/storage`. Ist OPFS festgelegt, aber nicht nutzbar, melden Dateizugriffe einen Fehler; es wird nie still auf IndexedDB umgeschaltet. Fehlt OPFS von Anfang an, wird der IndexedDB-Ersatz sichtbar angezeigt.
- Service-Worker-Cache, IndexedDB und OPFS sind getrennte Bereiche: App-Updates und Cache-Löschen berühren den Tresor nicht.
- **Persistenz:** `navigator.storage.persist()` wird nach einer Benutzeraktion angefragt, Status und `estimate()` werden angezeigt.
- Die Datenbank wird nie automatisch gelöscht oder neu angelegt; bei Fehlern erscheint eine Fehlermeldung.

## Backup
Siehe `BACKUP_FORMAT.md`. Kurz: eigene Argon2id-/AES-GCM-Verschlüsselung mit eigenem Passwort, alle Frames authentifiziert und an Position und Header gebunden; Wiederherstellung über Prüfung → Trockenlauf → Einspielen mit Konflikterkennung.

## PWA
Der Service Worker (`pwa/sw.template.js`, Build erzeugt `sw.js` mit der Dateiliste und einem Inhalts-Hash als Version) cached nur statische Dateien, ruft nie `skipWaiting` von selbst auf und enthält keinen Zugriff auf Tresordaten. Eine neue Version wartet; aktiviert wird sie nach Bestätigung, bei gesperrtem Tresor und ohne laufenden Vorgang (`pwa/busy.js`).

## Bewusste Vereinfachungen
Kategorien sind Freitext je Eintrag; kein HKDF-Zwischenschritt im Backup; keine mehrteiligen Backups; Argon2id läuft im Hauptthread.
