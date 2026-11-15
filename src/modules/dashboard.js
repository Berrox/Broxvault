import { el } from '../ui/dom.js';
import * as data from './data.js';
import * as fdata from './filedata.js';
import { SPECS } from './specs.js';
import { storageStatus } from '../core/storage-status.js';
const fmt = (n) => (n == null ? 'unbekannt' : n < 1048576 ? Math.round(n / 1024) + ' KiB' : n < 1073741824 ? (n / 1048576).toFixed(1) + ' MiB' : (n / 1073741824).toFixed(2) + ' GiB');
const days = (t) => Math.floor((Date.now() - t) / 86400000);
export function dashboard(ctx) {
  const S = ctx.settings, n = (t) => String(data.all(t).length);
  const link = (i) => el('button', { type: 'button', class: 'card rowmain', onclick: () => data.openItem(i) }, el('b', {}, i.title || '(ohne Titel)'), el('span', { class: 'hint' }, SPECS[i.type].label));
  const recent = data.all().sort((a, b) => b.createdAt - a.createdAt).slice(0, 5), favs = data.all().filter((i) => i.favorite).sort((a, b) => (a.title || '').localeCompare(b.title || '', 'de'));
  const warn = [];
  if (!S.lastBackupAt) warn.push('Es wurde noch kein Backup erstellt. Erstelle jetzt eines unter „Speicher & Backups“: ohne Backup sind die Daten bei Browser-Reset oder Geräteverlust weg.');
  else if (days(S.lastBackupAt) > S.backupReminderDays) warn.push('Das letzte Backup ist ' + days(S.lastBackupAt) + ' Tage alt (Erinnerung nach ' + S.backupReminderDays + ' Tagen).');
  const bad = data.corrupt.length + fdata.corrupt.length;
  if (bad) warn.push(bad + ' Einträge konnten nicht gelesen werden. Starte unter „Speicher & Backups“ die Integritätsprüfung.');
  const storage = el('div', { class: 'card field' }, el('b', {}, 'Lokaler Speicher'), el('span', { class: 'hint' }, 'Wird geladen …'));
  storageStatus().then((s) => storage.replaceChildren(el('b', {}, 'Lokaler Speicher'),
    el('span', { class: 'hint' }, 'Belegt: ' + fmt(s.usage) + ' von ca. ' + fmt(s.quota)), el('span', { class: 'hint' }, 'Dauerhafter Speicher: ' + (s.persisted === true ? 'gewährt' : s.persisted === false ? 'nicht gewährt' : 'unbekannt')),
    ...(ctx.info.error ? [el('span', { class: 'msg' }, ctx.info.error)] : [])), () => {});
  const go = (route, intent) => () => { data.setIntent(intent); location.hash = '#/' + route; };
  const stat = (v, l) => el('div', { class: 'card stat' }, el('b', {}, v), el('span', {}, l));
  return el('div', {}, el('h1', { id: 'view-title', tabindex: '-1' }, 'Dashboard'),
    ...warn.map((w) => el('div', { class: 'notice', role: 'note' }, w)),
    el('div', { class: 'grid' }, stat(n('password'), 'Passwörter'), stat(String(fdata.docs().length), 'Dokumente'), stat(String(fdata.photos().length), 'Fotos'), stat(n('note'), 'Notizen'), stat(n('personal'), 'Persönliche Einträge')),
    el('div', { class: 'actions' }, el('button', { type: 'button', class: 'btn primary', onclick: go('passwoerter', { new: true }) }, 'Neues Passwort'), el('button', { type: 'button', class: 'btn', onclick: go('notizen', { new: true }) }, 'Neue Notiz'),
      el('button', { type: 'button', class: 'btn', onclick: go('dokumente') }, 'Dokument hinzufügen'), el('button', { type: 'button', class: 'btn', onclick: go('fotos') }, 'Foto hinzufügen'), el('button', { type: 'button', class: 'btn', onclick: go('speicher') }, 'Backup erstellen')),
    el('h2', {}, 'Zuletzt hinzugefügt'), el('div', { class: 'list' }, ...(recent.length ? recent.map(link) : [el('span', { class: 'hint' }, 'Noch nichts vorhanden.')])),
    el('h2', {}, 'Favoriten'), el('div', { class: 'list' }, ...(favs.length ? favs.map(link) : [el('span', { class: 'hint' }, 'Noch keine Favoriten.')])),
    el('h2', {}, 'Status'), storage,
    el('div', { class: 'card field' }, el('b', {}, 'Backup'), el('span', { class: 'hint' }, 'Letztes Backup: ' + (S.lastBackupAt ? new Date(S.lastBackupAt).toLocaleDateString('de-DE') + ' (vor ' + days(S.lastBackupAt) + ' Tagen)' : 'noch keines')),
      el('span', { class: 'hint' }, 'Letzte Probewiederherstellung: ' + (S.lastBackupTestAt ? new Date(S.lastBackupTestAt).toLocaleDateString('de-DE') : 'noch keiner'))));
}
