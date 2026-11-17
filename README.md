# BROX VAULT

Persönlicher, lokal verschlüsselter digitaler Tresor als Offline-Web-App (PWA). Kein Server, kein Konto, keine Cloud, keine Übertragung deiner Daten.

**Inhalt:** Passwortmanager mit Generator · Notizen · persönliche Daten (WLAN, Lizenzen, Verträge …) · Dokumentenarchiv · Fotoarchiv · verschlüsselte Backups (.bvx) · Speicherverwaltung · Sicherheitseinstellungen.

**Stand: Version 0.9.0, Phase 9 (Qualitätskontrolle).** Alle automatischen Tests bestehen. Die App wurde **noch nicht auf echten Geräten abgenommen** (siehe `docs/DEVELOPMENT.md`, Abnahme-Checkliste) und **nicht unabhängig sicherheitsgeprüft**. Nutze sie nicht für Daten, die du nicht verlieren darfst, bevor du die Wiederherstellung aus einem Backup selbst erlebt hast.

## Das Wichtigste in Kürze
- Alles wird auf deinem Gerät mit **AES-256-GCM** verschlüsselt; der Schlüssel entsteht aus deinem Master-Passwort mit **Argon2id**.
- Es gibt **keine Passwort-Wiederherstellung**. Vergisst du das Master-Passwort und hast kein Backup, sind die Daten verloren.
- Der Browser kann Website-Daten löschen, und ein Gerät kann verloren gehen: Nur ein **Backup** außerhalb des Geräts schützt davor. Erstelle früh eines und prüfe es (Stufe 3: Probewiederherstellung).
- Auf dem iPhone: installiere die App zuerst („Teilen → Zum Home-Bildschirm“) und lege den Tresor in der installierten App an.

## Installation für die Entwicklung
Voraussetzung: [Node.js](https://nodejs.org) (LTS, Version 22 oder neuer) und Git.
```
npm install          # Abhängigkeiten (exakte Versionen, Lockfile)
npm run dev          # Entwicklungsserver (Offline-Modus ist hier bewusst aus)
npm test             # alle automatischen Tests (186)
npm run build        # Produktions-Build nach dist/
npm run preview      # Build lokal ansehen (mit Service Worker)
npm run check        # Tests und Build zusammen
```

## Veröffentlichung
Siehe `docs/DEPLOYMENT.md` (GitHub Pages, Updates, Sicherheit der Veröffentlichungskette).

## Dokumentation
| Datei | Inhalt |
|---|---|
| `docs/ARCHITECTURE.md` | Aufbau, Schlüssel-, Speicher- und Backup-Architektur |
| `docs/SECURITY.md` | Bedrohungsmodell, Schutzmaßnahmen, bekannte Risiken |
| `docs/BACKUP_FORMAT.md` | Das .bvx-Format und die Wiederherstellung |
| `docs/DEVELOPMENT.md` | Entwickeln, Tests, Abnahme-Checkliste für iPhone und Desktop |
| `docs/DEPLOYMENT.md` | GitHub Pages |
| `CHANGELOG.md` | Änderungen je Version |

## Bekannte Browserbeschränkungen (Kurzfassung)
- iOS Safari kann Website-Daten ungenutzter Seiten löschen; installierte Apps sind nach meinem Kenntnisstand besser geschützt (nicht geprüft).
- Ohne direktes Schreiben in eine Datei (iPhone, Firefox) liegt ein Backup beim Erstellen im Arbeitsspeicher: Grenze 400 MiB. Dateien im Tresor: bis 100 MiB je Datei.
- Die Zwischenablage lässt sich nur als Ganzes leeren, und das klappt im Hintergrund nicht überall.
- Weitere Details: `docs/SECURITY.md` und `docs/DEVELOPMENT.md`.
