# BROX VAULT

Persönlicher, lokal verschlüsselter Tresor als Offline-PWA (ohne Server).

**Stand: Phase 8 (Offline-Betrieb, Updates, GitHub Pages).** Qualitätskontrolle und Dokumentation folgen. Veröffentlichung: siehe docs/DEPLOYMENT.md. Nicht für echte Daten verwenden.

## Entwicklung
```
npm install
npm run dev        # Entwicklungsserver (Service Worker ist hier aus)
npm run build      # Produktions-Build nach dist/
npm run preview    # Build lokal ansehen (Service Worker aktiv)
```
Voraussetzung: Node.js (LTS). Der Build ist mit `base: './'` für jeden GitHub-Pages-Unterpfad vorbereitet.

## Struktur
`src/ui` Oberfläche · `src/pwa` Service Worker und Update-Hinweis · `src/styles` Design · `docs/` Dokumentation (folgt aus dem Architekturbericht).
