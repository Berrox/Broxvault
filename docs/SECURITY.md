# BROX VAULT – Sicherheit (Version 0.9.0)

**Status:** Nicht unabhängig geprüft. Vor produktiver Nutzung mit wichtigen Daten wird eine externe Sicherheitsprüfung dringend empfohlen. Diese Datei beschreibt, was die Software tut und was nicht; sie ist keine Garantie.

## Schutzziele und Bedrohungsmodell
| Bedrohung | Schutz | Restrisiko |
|---|---|---|
| Gerät oder Browserprofil geht verloren / wird kopiert (App gesperrt) | Alles verschlüsselt (AES-256-GCM), Schlüssel nur aus Master-Passwort (Argon2id) | Schwaches Master-Passwort lässt sich offline erraten. Anzahl und Größe der Einträge sind sichtbar |
| Manipulation von Datensätzen, Dateien, Backups | GCM-Tag + AAD (Store, ID, Revision, Chunk-Position, Frame-Nummer, Header-Hash) | **Rollback** (komplett älteren Datensatz zurückspielen) und Löschen ganzer Datensätze werden nicht erkannt |
| Fremder Code in der App (XSS) | Kein `innerHTML`, strenge CSP, nur http(s)-Links mit `noopener`; Test mit feindlichen Eingaben in allen Ansichten | Die CSP gilt per Meta-Tag (GitHub Pages setzt keine Header); `frame-ancestors` geht so nicht (Ersatz: Skript-Prüfung gegen Einbettung) |
| Kompromittiertes App-Update (Code ist öffentlich) | Feste Abhängigkeitsversionen, Lockfile, Aktionen auf Commit-Hashes, Update nur nach Bestätigung bei gesperrtem Tresor, sichtbare Version/Build | **Größtes Restrisiko:** ein bösartiges Update könnte in einer entsperrten Sitzung Daten abgreifen |
| Neugierige Person am entsperrten Gerät | Auto-Sperre, Sperren beim Verlassen, Passwörter standardmäßig verborgen, Zwischenablage wird geleert | Nicht vollständig vermeidbar |
| Datenverlust (Browser räumt auf, Gerät weg) | Persistenzanfrage, Backups mit Erinnerung, Probewiederherstellung | Persistenz ist nie garantiert; nur ein Backup außerhalb des Geräts schützt |

**Nicht abgedeckt:** Schadsoftware oder Tastaturspion auf dem Gerät, kompromittiertes Betriebssystem oder Browser, bösartige Browser-Erweiterungen, erzwungene Herausgabe des Passworts, Seitenkanal-Angriffe auf JavaScript.

## Was umgesetzt ist
- Argon2id (hash-wasm 4.12.0, gegen die Referenzimplementierung `argon2-cffi` geprüft), Standard 64 MiB / 3 Durchläufe / Parallelität 1 (über den üblichen Mindestwerten); Parameter stehen im Tresor und im Backup-Kopf, mit Obergrenzen gegen manipulierte Werte.
- AES-256-GCM, pro Operation ein neuer Zufalls-Nonce; im Test keine Wiederholung über die gesamte Datenbank.
- Getrennte Schlüssel (Datensätze, Datei-Schlüssel je Datei), nicht exportierbare Web-Crypto-Schlüssel.
- Keine Schlüssel oder Geheimnisse in LocalStorage, SessionStorage, URL oder Logs (automatische Quelltext-Prüfung); die Suche steht nie in der Adresszeile.
- Keine externen Übertragungen: kein `fetch` im App-Code, keine Fremdadressen im Quelltext oder Bundle, CSP `connect-src 'self'`.
- Dateinamen, Metadaten, Vorschaubilder und Ordner sind verschlüsselt; Dateityp wird am Inhalt geprüft; Blob-URLs werden nach Gebrauch widerrufen.
- Löschen nur nach ausdrücklicher Bestätigung; fehlgeschlagene Schreibvorgänge melden keinen Erfolg; beschädigte Daten werden gemeldet, nie automatisch gelöscht oder „repariert“.

## Bekannte Risiken und Grenzen
1. **Update-Kanal** (siehe oben). Gegenmaßnahmen helfen, ersetzen aber keine Prüfung. Wer ganz sicher gehen will, hostet die App selbst und prüft jede Version.
2. **Arbeitsspeicher:** JavaScript kann Speicher nicht zuverlässig löschen. Tresorschlüssel-Bytes werden nach dem Ableiten überschrieben, Passwort-Zeichenketten und entschlüsselte Texte bleiben bis zur Speicherbereinigung im Speicher.
3. **Entschlüsselte Bilder:** Der Browser kann dekodierte Bilder intern zwischenspeichern; das ist nicht vollständig kontrollierbar.
4. **Rollback/Löschen** werden nicht erkannt (siehe Tabelle).
5. **Zwischenablage:** Der Browser erlaubt kein Löschen nur des kopierten Eintrags; das Leeren überschreibt die ganze Zwischenablage und klappt im Hintergrund nicht überall.
6. **Keine Begrenzung von Fehlversuchen:** Gegen einen Angreifer mit Kopie der Daten würde sie ohnehin nichts bringen; entscheidend sind Passwortstärke und Argon2id.
7. **Passwortstärke-Anzeige** ist eine grobe Schätzung (überschätzt Wörter-Passphrasen).
8. **Metadaten sichtbar:** Anzahl und Größe von Einträgen/Chunks, Dateigrößen, Zeitpunkt des letzten Backups.
9. **Argon2id läuft im Hauptthread:** die Oberfläche steht beim Entsperren kurz. Auf dem iPhone kann der Speicherbedarf (64 MiB) zu hoch sein: unter Einstellungen → Technik messen.
10. **Backup-Passwort ≠ Master-Passwort empfohlen:** Beide Passwörter sind unabhängig; verlierst du das Backup-Passwort, ist das Backup wertlos.
11. **Browser-Funktionen, die ich nicht verifizieren konnte:** OPFS-Schreibweg in Safari, Löschverhalten von iOS für Website-Daten, PDF-Anzeige per Blob-URL im Frame, `wasm-unsafe-eval` in Safari.

## Sicherheitsprüfung
Automatisch (Auszug aus `tests/`): Quelltext-Muster-Prüfung, Klartext-Suche in der gesamten Datenbank nach einer ausgiebigen Sitzung, Nonce-Eindeutigkeit, manipulierte/abgeschnittene/vertauschte Daten und Backups, feindliche Eingaben in allen Ansichten, CSP und Build-Prüfung, Service Worker ohne Tresorzugriff. **Nicht** geprüft: echte Browser und Geräte, Angriffe durch Dritte, Seitenkanäle, die Lieferkette von npm über das Lockfile hinaus (`npm audit` meldete zuletzt keine bekannten Schwachstellen).

## Melden
Fehler und Sicherheitsprobleme bitte privat an die Betreiberin oder den Betreiber des Repositories melden, nicht öffentlich.
