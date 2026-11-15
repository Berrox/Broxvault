import { el } from './dom.js';
import { lock } from '../core/keys/session.js';
import { saveSettings } from '../core/settings.js';
import { startAutoLock } from '../core/autolock.js';
import { deriveKek } from '../core/crypto/kdf.js';
import { randomBytes } from '../core/crypto/random.js';
import { DEFAULT_KDF } from '../core/keys/vault.js';
import { APP_VERSION, BUILD_ID, checkForUpdate, getSwVersion, applyUpdate, updateAvailable, onUpdateChange } from '../pwa/update.js';
import { isStandalone, isIOS, canPrompt, promptInstall, onInstallChange } from '../pwa/install.js';


// ---------- App & Updates ----------
export function appCard() {
  const rows = el('div', { class: 'stack' }), out = el('p', { class: 'hint', role: 'status' }), acts = el('div', { class: 'actions' });
  const row = (a, b) => el('div', { class: 'row2' }, el('span', { class: 'hint' }, a), el('b', {}, b));
  async function draw() {
    const sw = await getSwVersion(), online = typeof navigator === 'undefined' || navigator.onLine !== false;
    rows.replaceChildren(row('Version', APP_VERSION + ' (Build ' + BUILD_ID + ')'), row('Verbindung', online ? 'online' : 'offline'),
      row('Offline-Bereitschaft', sw ? 'ja (Dateien zwischengespeichert, Stand ' + sw + ')' : 'noch nicht aktiv'), row('Als App installiert', isStandalone() ? 'ja' : 'nein'),
      row('Update', updateAvailable() ? 'verfügbar' : 'keines bekannt'));
    const b = [el('button', { type: 'button', class: 'btn', onclick: async () => { out.textContent = 'Suche nach Updates …'; const r = await checkForUpdate();
      out.textContent = { available: 'Eine neue Version ist verfügbar.', current: 'Du hast die aktuelle Version.', offline: 'Keine Verbindung: Updates lassen sich nur online suchen.', unsupported: 'In diesem Browser (oder in der Entwicklungsversion) ist der Offline-Modus nicht aktiv.', error: 'Die Suche ist fehlgeschlagen.' }[r]; draw(); } }, 'Nach Updates suchen')];
    if (updateAvailable()) b.push(el('button', { type: 'button', class: 'btn primary', onclick: () => { const r = applyUpdate(); if (!r.ok) out.textContent = r.reason === 'busy' ? 'Es läuft gerade ein Vorgang. Bitte warte, bis er fertig ist.' : 'Kein Update bereit.'; } }, 'Sperren und aktualisieren'));
    if (canPrompt()) b.push(el('button', { type: 'button', class: 'btn', onclick: async () => { const r = await promptInstall(); out.textContent = r === 'accepted' ? 'Installation gestartet.' : 'Installation abgebrochen.'; draw(); } }, 'App installieren'));
    acts.replaceChildren(...b);
  }
  draw(); onUpdateChange(draw); onInstallChange(draw);
  const help = isStandalone() ? null : el('p', { class: 'hint' }, isIOS()
    ? 'Installieren auf dem iPhone: In Safari auf „Teilen“ tippen, dann „Zum Home-Bildschirm“. Lege den Tresor in der installierten App an: nach meinem Kenntnisstand sind die Daten von Safari und von der installierten App getrennt, und installierte Apps werden vom Browser weniger schnell aufgeräumt.'
    : 'Installieren am Computer: Im Browsermenü „App installieren“ bzw. „Zur Startseite hinzufügen“ wählen (Chrome/Edge: Symbol in der Adressleiste).');
  return el('div', { class: 'card field' }, el('b', {}, 'App und Updates'), rows, acts, out, help,
    el('p', { class: 'hint' }, 'Neue Versionen werden erst nach deiner Bestätigung aktiviert, und nur bei gesperrtem Tresor. Deine Daten bleiben bei Updates immer erhalten.'));
}

export function settingsView(ctx) {
  const s = ctx.settings, save = async (relock) => { await saveSettings(ctx.db, s); if (relock) startAutoLock(s); };
  const select = (id, label, opts, key, relock, fmt) => el('div', { class: 'field' }, el('label', { for: id }, label),
    el('select', { id, onchange: (e) => { s[key] = Number(e.target.value); save(relock); } }, ...opts.map((v) => el('option', { value: String(v), selected: v === s[key] }, fmt(v)))));
  const chk = (id, label, key, relock) => el('label', { class: 'check' }, el('input', { type: 'checkbox', id, checked: s[key], onchange: (e) => { s[key] = e.target.checked; save(relock); } }), el('span', {}, label));
  const out = el('p', { class: 'hint', role: 'status' });
  const bench = el('button', { type: 'button', class: 'btn', onclick: async () => {
    bench.disabled = true; out.textContent = 'Messung läuft …'; await new Promise((r) => setTimeout(r, 60)); const t0 = performance.now();
    try { await deriveKek('messung-ohne-geheimnis', randomBytes(16), DEFAULT_KDF); out.textContent = 'Dauer: ' + Math.round(performance.now() - t0) + ' ms (' + DEFAULT_KDF.m / 1024 + ' MiB, ' + DEFAULT_KDF.t + ' Durchläufe)'; }
    catch { out.textContent = 'Messung fehlgeschlagen: vermutlich zu wenig Arbeitsspeicher für diese Parameter.'; }
    bench.disabled = false; } }, 'Schlüsselableitung messen');
  return el('div', {}, el('h1', { id: 'view-title', tabindex: '-1' }, 'Einstellungen'), el('p', { class: 'lead' }, 'Sicherheit, Sperre und Backup-Erinnerung.'),
    el('div', { class: 'card field' }, select('lm', 'Automatisch sperren nach', [1, 5, 15, 30], 'lockMinutes', true, (m) => m + (m === 1 ? ' Minute' : ' Minuten')),
      chk('lh', 'Sperren, wenn ich die App verlasse', 'lockOnHide', true), chk('sp', 'Passwörter standardmäßig anzeigen', 'showPasswords', false),
      select('cb', 'Zwischenablage leeren nach', [0, 15, 30, 60], 'clipboardSeconds', false, (v) => (v ? v + ' Sekunden' : 'nicht automatisch')),
      select('br', 'Backup-Erinnerung nach', [7, 14, 30, 60, 90], 'backupReminderDays', false, (v) => v + ' Tagen')),
    el('div', { class: 'actions' }, el('button', { type: 'button', class: 'btn primary', onclick: lock }, 'Tresor sperren')),
    el('p', { class: 'hint' }, 'Die Zwischenablage lässt sich nur als Ganzes leeren; ein Browser erlaubt nicht, nur den kopierten Eintrag zu entfernen. Auf manchen Geräten klappt das Leeren im Hintergrund nicht.'),
    appCard(),
    el('div', { class: 'card field' }, el('b', {}, 'Technik'), el('span', { class: 'hint' }, 'Misst, wie lange das Entsperren auf diesem Gerät dauert.'), bench, out),
    el('p', { class: 'hint' }, 'Master-Passwort ändern: folgt in der Oberfläche später (die Funktion ist bereits getestet).'));
}
