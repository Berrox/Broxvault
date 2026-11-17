# Entwickeln, Testen, Abnehmen

## Einrichten und starten
```
npm install     # exakte Versionen laut package-lock.json
npm run dev     # http://localhost:5173 (Offline-Modus/Service Worker sind im Entwicklungsserver aus)
npm test        # alle automatischen Tests
npm run build && npm run preview    # Produktionsstand mit Service Worker lokal ansehen
npm run check   # Tests + Build
```
Argon2id braucht beim Entsperren einige Sekunden und 64 MiB Arbeitsspeicher. Die Tests nutzen für die meisten Fälle absichtlich schwache Parameter (1 MiB, 1 Durchlauf), damit sie schnell laufen; ausgewählte Tests (Gesamtablauf, Referenzwerte) nutzen die echten Parameter.

## Neues Modul ergänzen
1. Feldbeschreibung in `src/modules/specs.js` (oder eigene Ansicht in `src/modules/`).
2. Route in `src/ui/sections.js` und `src/ui/views.js`.
3. Daten verschlüsselt über `core/db/records.js` speichern; Datei-Inhalte über `core/files/chunks.js` und `modules/fileops.js`.
4. Wird ein neuer Datenbankspeicher nötig: **neue Migration am Ende** von `src/core/db/idb.js` (nur anlegen, nie löschen) und Test in `tests/storage.test.js`/`tests/dataloss.test.js` ergänzen.
5. Neue Felder müssen im Backup landen: `src/backup/writer.js` liest alle Stores; bei neuen Stores `STORES` in Writer, Reader und Restore ergänzen.

## Automatische Tests (186, `npm test`)
| Datei | Prüft |
|---|---|
| `crypto`, `vault` | AES-GCM, Argon2id gegen Referenz, Nonces, Tresor erstellen/entsperren, falsches Passwort, Passwortwechsel, Manipulation |
| `storage` | Migrationen, verschlüsselte Datensätze, Chunks, Integritätsprüfung, Speicherort-Wahl, Speicherstatus |
| `opfs` | OPFS-Backend und -Worker gegen ein nachgebildetes Dateisystem (mit exklusiven Handles), Ablauf mit OPFS, Backup zwischen OPFS und IndexedDB |
| `modules`, `ui` | Generator, Zwischenablage, Datenschicht, Suche; Oberfläche von Passwörtern, Notizen, persönlichen Daten, Dashboard |
| `files`, `files-ui` | Import (Streaming), Typ-Prüfung, Ordner/Alben, Galerie, Vollbild, Blob-URLs, große Dateien |
| `backup`, `backup-ui` | .bvx-Format, Export, Prüfstufen 1–3, beschädigte/falsche Backups, Konflikte, zweites Profil, Einspielen |
| `pwa`, `pwa-ui`, `build` | Service Worker im Sandkasten, kontrolliertes Update, Installation, Repository-Unterpfad, CSP, Workflow, Abhängigkeiten |
| `security`, `hostile-ui`, `dataloss`, `lifecycle` | Quelltext-Muster, Klartext-Suche über die ganze Datenbank, feindliche Eingaben, Löschbestätigungen, Datenverlust-Regeln, kompletter Lebenslauf |

**Was die Tests nicht abdecken:** echte Browser (Chrome, Edge, Firefox, Safari), echtes OPFS, das iPhone, Tastatur- und Touch-Bedienung, Aussehen, Barrierefreiheit, Leistung bei vielen tausend Einträgen, Netzwerkverhalten, echter GitHub-Workflow. Dafür ist die folgende Abnahme da.

## Abnahme-Checkliste (manuell, vor der ersten echten Nutzung)
Teste mit Testdaten. Notiere je Punkt „ok“ oder was passiert ist. Bei Abweichungen: Browser, Gerät, Uhrzeit und Meldung festhalten.

### A. Windows 11 (Chrome oder Edge, danach Firefox)
1. Tresor einrichten, Dauer des Entsperrens notieren (Einstellungen → Technik → „Schlüsselableitung messen“).
2. Passwort (mit Generator), Notiz, WLAN-Eintrag anlegen; Suche (oben) findet sie; Sperren und mit dem Master-Passwort entsperren; falsches Passwort wird abgelehnt.
3. Dokumente: PDF, TXT, JPG importieren; PDF und Bild werden angezeigt; Ordner anlegen, verschieben, umbenennen, löschen mit Rückfrage.
4. Fotos: mehrere importieren; Galerie lädt Vorschaubilder; Vollbild, Blättern, Album, Favorit, Löschen.
5. Speicher & Backups: „Speicher-Selbsttest“ und „Integritätsprüfung“ (Meldung notieren: OPFS oder IndexedDB?); „Dauerhaften Speicher anfragen“.
6. Backup erstellen (Chrome/Edge: Speichern direkt in eine Datei), dann „Backup überprüfen“ Stufe 1, 2 und 3.
7. Browserdaten der Seite löschen (Einstellungen des Browsers → Website-Daten), App neu öffnen, „Aus Backup wiederherstellen“: alles wieder da?
8. App installieren (Adressleiste); Verbindung trennen; App startet offline und lässt sich entsperren.
9. Update: zweite Version veröffentlichen; Hinweis „Neue Version verfügbar“ erscheint; „Sperren und aktualisieren“; Daten unverändert.
10. Auto-Sperre nach der eingestellten Zeit und beim Wechsel zu einem anderen Tab.

### B. iPhone (Safari, dann installierte App)
1. Seite in Safari öffnen, **vor** dem Einrichten über „Teilen → Zum Home-Bildschirm“ installieren und die installierte App öffnen. (Ein in Safari angelegter Tresor ist nach meinem Kenntnisstand in der installierten App nicht sichtbar: bitte bestätigen.)
2. Tresor einrichten; Entsperr-Dauer messen. Dauert es mehrere Sekunden oder bricht die App ab? Dann Speicherbedarf melden.
3. Passwort, Notiz, Foto aus der Mediathek, PDF aus „Dateien“, große Datei (z. B. 50 MB) importieren. Wird die App beim Auswählen gesperrt? (Das Sperren wird dabei 2 Minuten zurückgehalten.)
4. PDF und Foto anzeigen; Vollbild; Vorschaubilder; Suche.
5. Speicher-Selbsttest und Integritätsprüfung; Meldung notieren (OPFS oder IndexedDB, Dauerhafter Speicher gewährt?).
6. Backup erstellen → „Teilen / In Dateien sichern“; Datei in „Dateien“ sichtbar; Größenlimit bei vielen Fotos beachten.
7. Stufe 2 und 3 mit dieser Datei am iPhone ausführen.
8. Flugmodus: App starten, entsperren, Einträge öffnen.
9. App in den Hintergrund legen und zurückkehren: ist der Tresor gesperrt?
10. Zweitgeräte-Test: Backup am Windows-Rechner wiederherstellen (und umgekehrt).

### C. Erst danach
Echte Daten schrittweise übernehmen, unmittelbar danach Backup + Stufe 3, Backup an zwei getrennten Orten ablegen. Externe Sicherheitsprüfung beauftragen, bevor sehr sensible Daten (z. B. Ausweise, Zugangsdaten zu Finanzkonten) hineinkommen.

## Veröffentlichen
Siehe `DEPLOYMENT.md`. Versionsnummer in `package.json` und `CHANGELOG.md` erhöhen, `npm run check`, committen, pushen.
