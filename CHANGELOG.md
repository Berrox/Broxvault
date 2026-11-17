# Änderungen

## 0.9.0 – Phase 9: Qualitätskontrolle
- Master-Passwort ändern in den Einstellungen (Funktion war seit 0.3.0 vorhanden, jetzt mit Oberfläche)
- Einrichtungsassistent: Backup-Hinweis aktualisiert (Backups gibt es seit 0.7.0)
- Foto-Vollbild: Tastatur-Handler und Blob-URL werden beim Verlassen der Ansicht freigegeben
- Toter Code entfernt (Platzhalteransicht)
- Neue Tests: OPFS-Logik gegen nachgebildetes Dateisystem, Quelltext-Sicherheitsprüfung, Klartext-Suche über die gesamte Datenbank, feindliche Eingaben, Löschbestätigungen, Datenverlust-Regeln, kompletter Lebenslauf (186 Tests)
- Dokumentation: README, ARCHITECTURE, SECURITY, DEVELOPMENT (inkl. Abnahme-Checkliste), DEPLOYMENT, BACKUP_FORMAT

## 0.8.0 – Phase 8: Offline-Betrieb und Veröffentlichung
- Service Worker: nur statische App-Dateien, kein Zugriff auf Tresordaten, Offline-Seite, Version abfragbar
- Kontrolliertes Update: neue Version wartet, Aktivierung nur nach Bestätigung, bei gesperrtem Tresor und ohne laufenden Vorgang
- Installationshilfe (Chrome/Edge-Anfrage, iPhone-Anleitung), Versions- und Build-Anzeige, Update-Suche
- Datenbank-Update aus anderem Tab wird sauber behandelt
- GitHub-Pages-Workflow mit fixierten Aktionen, Veröffentlichungsanleitung

## 0.7.0 – Phase 7: Backup
- .bvx-Format, Export, Import, Prüfung in drei Stufen, Wiederherstellung (auch auf neuem Gerät)

## 0.6.0 – Phase 6: Dateien
- Dokumentenarchiv, Fotoarchiv, Streaming-Import mit Chunk-Verschlüsselung, verschlüsselte Vorschaubilder

## 0.5.0 – Phase 5: Inhalte
- Dashboard, Passwortmanager mit Generator, Notizen, persönliche Daten, globale Suche

## 0.4.0 – Phase 4: Speicher
- IndexedDB mit Migrationen, OPFS mit Fallback, Persistenz, Speicheranzeige, Integritätsprüfung

## 0.3.0 – Phase 3: Sicherheitskern
- Argon2id, AES-256-GCM, Tresorschlüssel, Sperre, Master-Passwort-Wechsel (Funktion)

## 0.2.0 – Phase 2: Grundgerüst
- Vite, Layout, Navigation, PWA-Grundstruktur
