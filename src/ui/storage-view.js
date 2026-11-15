import { el } from './dom.js';
import { storageStatus, requestPersist } from '../core/storage-status.js';
import { listIds } from '../core/db/records.js';
import { checkIntegrity } from '../core/integrity.js';
import { writeChunks, openChunk } from '../core/files/chunks.js';
import { fileKey } from '../core/keys/session.js';
import { exportPanel, verifyPanel, importPanel } from './backup-view.js';

const fmt = (n) => (n == null ? 'unbekannt' : n < 1048576 ? Math.round(n / 1024) + ' KiB' : n < 1073741824 ? (n / 1048576).toFixed(1) + ' MiB' : (n / 1073741824).toFixed(2) + ' GiB');
const row = (a, b) => el('div', { class: 'row2' }, el('span', { class: 'hint' }, a), el('b', {}, b));

export function storageView(ctx) {
  const status = el('div', { class: 'card field' }), out = el('div', { class: 'card field', role: 'status' }), btns = [];
  const say = (...lines) => out.replaceChildren(...lines.map((l) => el('p', { class: 'hint' }, l)));
  async function refresh() {
    const s = await storageStatus(), counts = {};
    for (const st of ['entries', 'categories', 'files']) counts[st] = (await listIds(ctx.db, st)).length;
    status.replaceChildren(
      row('Speicherort für Dateien', ctx.info.kind === 'opfs' ? 'OPFS (Origin Private File System)' : 'IndexedDB (Ersatzlösung)'),
      ctx.info.reason ? el('p', { class: 'hint' }, ctx.info.reason + '. Der Tresor nutzt stattdessen IndexedDB. Es wird nichts unverschlüsselt gespeichert.') : null,
      ctx.info.error ? el('p', { class: 'msg', role: 'alert' }, ctx.info.error) : null,
      row('Dauerhafter Speicher', s.persisted === true ? 'gewährt' : s.persisted === false ? 'nicht gewährt' : 'nicht unterstützt'),
      row('Belegt', fmt(s.usage) + ' von ca. ' + fmt(s.quota)), row('Noch frei (Schätzung)', fmt(s.available)),
      row('Einträge / Kategorien / Dateien', counts.entries + ' / ' + counts.categories + ' / ' + counts.files),
      row('Letztes Backup', ctx.settings.lastBackupAt ? new Date(ctx.settings.lastBackupAt).toLocaleString('de-DE') : 'noch keines'),
      row('Letzte Probewiederherstellung', ctx.settings.lastBackupTestAt ? new Date(ctx.settings.lastBackupTestAt).toLocaleString('de-DE') : 'noch keine'),
      ...s.warnings.map((w) => el('p', { class: 'msg' }, w)),
      el('p', { class: 'hint' }, 'Dauerhafter Speicher schützt nicht vor manuellem Löschen, Browser-Reset oder Geräteverlust. Nur ein Backup schützt davor.'));
  }
  const btn = (label, fn, extra = {}) => { const b = el('button', { type: 'button', class: 'btn', ...extra, onclick: async () => { b.disabled = true; try { await fn(); } catch (e) { say('Fehler: ' + e.message); } b.disabled = false; } }, label); btns.push(b); return b; };

  const selftest = async () => {
    say('Selbsttest läuft …'); const id = 'selftest-' + crypto.randomUUID(), data = crypto.getRandomValues(new Uint8Array(100000)), t0 = performance.now();
    const b = ctx.backend; let n;
    try {
      n = await writeChunks(b, id, data, 65536); const k = await fileKey(id), got = [];
      for (let i = 0; i < n; i++) got.push(await openChunk(k, id, i, i === n - 1, await b.getChunk(id, i)));
      const all = new Uint8Array(100000); let o = 0; for (const g of got) { all.set(g, o); o += g.length; }
      if (o !== data.length || all.some((v, i) => v !== data[i])) throw new Error('Gelesene Daten stimmen nicht mit den geschriebenen überein.');
    } finally { await b.deleteFile(id); }
    say('Selbsttest bestanden: ' + n + ' verschlüsselte Chunks über ' + (ctx.info.kind === 'opfs' ? 'OPFS' : 'IndexedDB') + ' geschrieben, gelesen, geprüft und wieder gelöscht (' + Math.round(performance.now() - t0) + ' ms).');
  };
  const integrity = async () => {
    say('Integritätsprüfung läuft …'); const r = await checkIntegrity(ctx.db, ctx.backend);
    const L = [r.ok ? 'Keine Probleme gefunden.' : 'Probleme gefunden. Es wurde nichts verändert oder gelöscht.', 'Geprüft: ' + r.records + ' Datensätze, ' + r.files + ' Dateien, ' + r.chunks + ' Chunks.'];
    if (r.corruptRecords.length) L.push('Beschädigte Datensätze: ' + r.corruptRecords.length);
    if (r.missingChunks.length) L.push('Fehlende Chunks: ' + r.missingChunks.length);
    if (r.corruptChunks.length) L.push('Beschädigte Chunks: ' + r.corruptChunks.length);
    if (r.extraChunks.length) L.push('Überzählige Chunks: ' + r.extraChunks.length);
    if (r.orphanFiles.length) L.push('Verwaiste Dateien (ohne Eintrag): ' + r.orphanFiles.length + ' – bleiben unangetastet.');
    say(...L);
  };
  const persist = async () => { const ok = await requestPersist(); say(ok === true ? 'Dauerhafter Speicher wurde gewährt.' : ok === false ? 'Der Browser hat dauerhaften Speicher nicht gewährt. Das kann sich später ändern; bis dahin sind regelmäßige Backups besonders wichtig.' : 'Dieser Browser unterstützt die Anfrage nicht.'); await refresh(); };

  const panel = el('div', {});
  refresh().catch(() => say('Speicherstatus konnte nicht gelesen werden.'));
  return el('div', {}, el('h1', { id: 'view-title', tabindex: '-1' }, 'Speicher & Backups'),
    el('p', { class: 'lead' }, 'Wo deine verschlüsselten Daten liegen und wie es ihnen geht.'), status,
    el('div', { class: 'actions' }, btn('Speicherstatus aktualisieren', refresh), btn('Dauerhaften Speicher anfragen', persist), btn('Speicher-Selbsttest', selftest), btn('Integritätsprüfung', integrity)),
    out,
    el('h2', {}, 'Backups'),
    el('div', { class: 'actions' }, ...[['Backup erstellen', exportPanel], ['Backup überprüfen', verifyPanel], ['Backup importieren', importPanel], ['Tresor exportieren', exportPanel]].map(([l, make], i) =>
      el('button', { type: 'button', class: 'btn' + (i === 0 ? ' primary' : ''), onclick: () => { panel.replaceChildren(make(ctx, refresh)); } }, l))),
    panel);
}
