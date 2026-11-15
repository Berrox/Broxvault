# BROX VAULT – Backup-Format .bvx (Version 1)

Dateiname: `BROX_VAULT_JJJJ-MM-TT.bvx`. Die Datei ist unabhängig von IndexedDB, OPFS, Cookies, Service-Worker-Daten und vom Originalgerät.

## Aufbau (alle Zahlen Big Endian)
```
Offset  Länge  Inhalt
0       4      Magic "BVX1"
4       2      Formatversion (1)
6       4      Länge des Headers (JSON), höchstens 64 KiB
10      n      Header (UTF-8 JSON, Klartext)
10+n    …      Frames bis zum Dateiende

Header: { "kdf": { "alg": "argon2id", "v": 19, "m": KiB, "t": Durchläufe, "p": 1, "salt": base64(16 B) }, "cipher": "AES-256-GCM" }

Frame:  [Länge u32][Typ u8][letzter u8][Umschlag]
        Umschlag = Version(1 B) | Nonce(12 B) | Ciphertext | GCM-Tag(16 B)
        Typ: 1 Manifest · 2 Datensatz · 3 Datei-Chunk · 4 Abschluss (Footer)
```

## Verschlüsselung
- Schlüssel: `Argon2id(Backup-Passwort NFKC/UTF-8, salt, m, t, p)` → 32 Byte → AES-256-GCM. Völlig unabhängig vom Master-Passwort und vom Tresorschlüssel.
- Jeder Frame hat einen neuen zufälligen 96-Bit-Nonce.
- AAD jedes Frames = `SHA-256(gesamter Header inkl. Magic)` ‖ Frame-Nummer (u64) ‖ Typ ‖ letzter-Flag. Dadurch fallen Header-Änderungen, Umsortieren, Auslassen, Duplizieren und Abschneiden auf.
- Abweichung vom ursprünglichen Entwurf: kein zusätzlicher HKDF-Schritt, weil es nur einen Schlüsselzweck gibt.

## Inhalt (Klartext der Frames, vor der Verschlüsselung)
1. **Manifest** (erster Frame): App-Version, Schema, Zeitpunkt, Anzahl Einträge/Kategorien/Dateien/Chunks.
2. **Datensätze**: `{ "s": Store, "id": …, "b": Datensatz }` für `entries`, `categories`, `files`.
3. **Chunks**: `u16 Länge der Datei-ID | Datei-ID | u32 Index | Daten (höchstens 1 MiB)`, je Datei lückenlos aufsteigend.
4. **Abschluss** (letzter Frame, `letzter=1`): Anzahl Frames, Datensätze, Chunks.

## Prüfstufen
| Stufe | Passwort | Prüft | Meldung |
|---|---|---|---|
| 1 | nein | Magic, Version, Header, Frame-Längen bis zum Dateiende, Abschluss vorhanden | Dateistruktur geprüft |
| 2 | ja | Jeder Frame authentisch, Reihenfolge, Chunk-Vollständigkeit je Datei, Abschluss- und Manifestzahlen | Integrität bestätigt |
| 3 | ja | Echte Probewiederherstellung in eine temporäre Datenbank mit Wegwerf-Schlüsseln, Integritätsprüfung, restloses Löschen | Wiederherstellung getestet |

Ein erfolgreicher Download zählt nie als Test. Das Datum „Letzte Probewiederherstellung“ wird nur nach Stufe 3 gesetzt.

## Wiederherstellung
1. Prüfen (Stufe 2) – erst danach wird irgendetwas geschrieben.
2. Trockenlauf: zählt neue, unveränderte und abweichende (Konflikt-)Einträge.
3. Einspielen in den geöffneten Tresor, neu verschlüsselt mit dem Schlüssel dieses Tresors. Standard „Vorhandenes behalten“; Überschreiben nur nach ausdrücklicher Bestätigung.
4. Dateien gelten erst als vollständig, wenn nach dem letzten Chunk der Metadatensatz geschrieben ist; bei Abbruch werden unfertige Dateien entfernt.
5. Neues Gerät: Der Einrichtungsassistent prüft das Backup, legt dann einen Tresor mit neuem Master-Passwort an und spielt alles ein.

## Grenzen
- Ohne Datei-Streaming (iOS Safari, Firefox) liegt das Backup beim Erstellen im Arbeitsspeicher: Limit 400 MiB, danach klare Fehlermeldung. Mehrteilige Backups gibt es noch nicht.
- Beim Überschreiben einer abweichenden Datei wird die alte Version vor dem Einspielen entfernt.
- Der Zeitpunkt „Letztes Backup“ wird gesetzt, sobald die Datei erstellt und geprüft ist; ob sie wirklich sicher abgelegt wurde, kann die App nicht wissen.
