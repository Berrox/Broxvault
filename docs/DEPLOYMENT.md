# BROX VAULT veröffentlichen (GitHub Pages)

Es werden nur Programmcode, Icons und Dokumentation veröffentlicht. Passwörter, Fotos, Dokumente, Backups und Schlüssel liegen ausschließlich auf deinem Gerät und gehören nie ins Repository (`*.bvx` ist per `.gitignore` ausgeschlossen).

## Einmalig einrichten
1. Auf github.com ein neues, leeres Repository anlegen (z. B. `brox-vault`). Öffentlich ist bei kostenlosem GitHub nötig; der Code ist dann für alle sichtbar, deine Daten nicht.
2. Im Projektordner: `git remote add origin https://github.com/DEIN-NAME/brox-vault.git` und `git push -u origin main`.
3. Im Repository: **Settings → Pages → Build and deployment → Source: „GitHub Actions“**.
4. Unter **Actions** startet der Workflow „Deploy“. Nach etwa zwei Minuten steht die Adresse `https://DEIN-NAME.github.io/brox-vault/` im Deploy-Schritt.

Die App nutzt `base: './'`, funktioniert also unter jedem Repository-Namen ohne Änderung.

## Neue Version veröffentlichen
1. Version in `package.json` erhöhen und in `CHANGELOG.md` eintragen.
2. `npm test` und `npm run build` lokal ausführen.
3. Committen, `git tag v0.8.0`, `git push --follow-tags`. Jeder Push auf `main` löst die Veröffentlichung aus (der Workflow führt die Tests selbst nochmals aus).
4. Die Version und Build-Kennung siehst du unter **Einstellungen → App und Updates**. Bei Nutzern erscheint „Neue Version verfügbar“; aktiviert wird sie nur nach Bestätigung und bei gesperrtem Tresor.

## Sicherheit der Veröffentlichungskette
- Der veröffentlichte Code ist öffentlich. Ein kompromittiertes Update könnte in einer entsperrten Sitzung Daten abgreifen. Deshalb: starke Anmeldung für dein GitHub-Konto (Zwei-Faktor), nur eigene Änderungen auf `main`, keine fremden Pull Requests ungeprüft übernehmen.
- Abhängigkeiten sind auf exakte Versionen festgelegt, das Lockfile liegt bei, der Workflow installiert mit `npm ci --ignore-scripts`.
- Die GitHub-Aktionen im Workflow sind auf Commit-Hashes fixiert (Stand 15.11.2026, jeweils mindestens 14 Tage alt). Beim Aktualisieren: neuen Hash aus dem Tag des Aktions-Repositories übernehmen und das Alter prüfen.
- Vor dem produktiven Einsatz mit wichtigen Daten wird eine unabhängige Sicherheitsprüfung empfohlen.

## Selbst hosten statt GitHub Pages
`npm run build` erzeugt den Ordner `dist/`; er lässt sich auf jedem statischen Webserver (HTTPS nötig) in einen beliebigen Unterpfad kopieren.

## Wenn etwas nicht klappt
- Workflow „Deploy“ rot: Auf **Actions** den fehlgeschlagenen Schritt öffnen. Dieser Workflow konnte hier nicht ausgeführt werden und ist ungetestet.
- Seite zeigt 404: Pages-Quelle auf „GitHub Actions“ gestellt? Erster Lauf abgeschlossen?
- App zeigt keine Offline-Bereitschaft: Seite einmal online komplett laden und neu laden; Entwicklungsserver (`npm run dev`) hat den Offline-Modus bewusst nicht.
