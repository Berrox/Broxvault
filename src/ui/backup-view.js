import { el } from './dom.js';
import * as data from '../modules/data.js';
import * as fdata from '../modules/filedata.js';
import { makeUrl, revokeAll } from '../modules/fileops.js';
import { saveSettings } from '../core/settings.js';
import { sessionKeys } from '../core/keys/session.js';
import { estimateBits, strengthText } from '../core/strength.js';
import { MIN_PASSWORD_LENGTH } from '../core/keys/vault.js';
import { writeBackup } from '../backup/writer.js';
import { BlobSink, StreamSink } from '../backup/sinks.js';
import { inspectStructure, openBackup, verifyBackup } from '../backup/reader.js';
import { applyBackup, verifyRestore, sessionTarget } from '../backup/restore.js';
import { WrongBackupPasswordError } from '../backup/format.js';
import { withBusy } from '../pwa/busy.js';

const fmt = (n) => (n < 1048576 ? Math.round(n / 1024) + ' KiB' : (n / 1048576).toFixed(1) + ' MiB');
const stamp = () => new Date().toISOString().slice(0, 10);
const paint = () => new Promise((r) => setTimeout(r, 60));
const pwBox = (id, label, ac = 'off') => { const i = el('input', { id, type: 'password', autocomplete: ac, autocapitalize: 'off', spellcheck: 'false' }); return { i, node: el('div', { class: 'field' }, el('label', { for: id }, label), i) }; };
const errText = (e) => (e && e.message) || 'Unbekannter Fehler';
export const lines = (...t) => t.filter(Boolean).map((x) => el('p', { class: 'hint' }, x));
const filePick = (label, onFile) => { const i = el('input', { type: 'file', accept: '.bvx,application/octet-stream', 'aria-label': label, onchange: (e) => { const f = e.target.files && e.target.files[0]; if (f) onFile(f); } }); return el('div', { class: 'field' }, el('label', {}, label), i); };

// ---------- Backup erstellen ----------
export function exportPanel(ctx, onDone = () => {}) {
  const pw = pwBox('bp1', 'Backup-Passwort', 'new-password'), pw2 = pwBox('bp2', 'Backup-Passwort wiederholen', 'new-password');
  const hint = el('p', { class: 'hint' }, 'Mindestens ' + MIN_PASSWORD_LENGTH + ' Zeichen. Nutze ein anderes Passwort als dein Master-Passwort. Ohne dieses Passwort ist das Backup wertlos, und es gibt keine Wiederherstellung.');
  pw.i.addEventListener('input', () => { hint.textContent = pw.i.value ? strengthText(estimateBits(pw.i.value)) : 'Mindestens ' + MIN_PASSWORD_LENGTH + ' Zeichen.'; });
  const msg = el('p', { class: 'msg', role: 'alert' }), out = el('div', { role: 'status' });
  const go = el('button', { type: 'button', class: 'btn primary' }, 'Backup erstellen');
  go.addEventListener('click', () => withBusy(async () => {
    msg.textContent = ''; out.replaceChildren();
    if ([...pw.i.value].length < MIN_PASSWORD_LENGTH) { msg.textContent = 'Das Backup-Passwort muss mindestens ' + MIN_PASSWORD_LENGTH + ' Zeichen lang sein.'; return; }
    if (pw.i.value !== pw2.i.value) { msg.textContent = 'Die beiden Passwörter stimmen nicht überein.'; return; }
    go.disabled = true; const name = 'BROX_VAULT_' + stamp() + '.bvx'; let handle = null;
    try {
      if (typeof window.showSaveFilePicker === 'function') { // muss direkt nach dem Klick passieren (Benutzeraktion)
        try { handle = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: 'BROX VAULT Backup', accept: { 'application/octet-stream': ['.bvx'] } }] }); }
        catch (e) { if (e && e.name === 'AbortError') { go.disabled = false; return; } handle = null; }
      }
      out.replaceChildren(...lines('Schlüssel wird abgeleitet … das kann einige Sekunden dauern.')); await paint();
      const sink = handle ? new StreamSink(await handle.createWritable()) : new BlobSink();
      const prog = el('p', { class: 'hint' }); out.replaceChildren(prog);
      const r = await writeBackup({ db: ctx.db, backend: ctx.backend, keys: sessionKeys() }, pw.i.value, sink, { onProgress: (p) => { prog.textContent = 'Verschlüssele … ' + Math.round(p * 100) + ' %'; } });
      prog.textContent = 'Prüfe die fertige Datei …'; await paint();
      const blob = handle ? await handle.getFile() : r.result; await verifyBackup(await openBackup(blob, pw.i.value)); // Stufe 2 direkt auf den geschriebenen Bytes
      ctx.settings.lastBackupAt = Date.now(); ctx.settings.lastBackupName = name; await saveSettings(ctx.db, ctx.settings);
      const acts = [];
      if (!handle) {
        const url = makeUrl(blob);
        acts.push(el('a', { class: 'btn primary', href: url, download: name }, 'Datei speichern'));
        const f = new File([blob], name, { type: 'application/octet-stream' });
        if (navigator.canShare && navigator.canShare({ files: [f] })) acts.push(el('button', { type: 'button', class: 'btn', onclick: () => navigator.share({ files: [f], title: name }).catch(() => {}) }, 'Teilen / In Dateien sichern'));
      }
      out.replaceChildren(el('div', { class: 'card field' }, el('b', {}, 'Backup erstellt und Integrität bestätigt'),
        ...lines(name + ' · ' + fmt(r.bytes) + ' · ' + r.counts.records + ' Datensätze, ' + r.counts.chunks + ' Datei-Chunks.', handle ? 'Die Datei wurde dort gespeichert, wo du sie gewählt hast.' : 'Speichere die Datei jetzt und bewahre sie außerhalb dieses Geräts auf.',
          'Das ist noch kein Wiederherstellungstest: Prüfe das Backup später unter „Backup überprüfen“ mit der Probewiederherstellung.'), acts.length ? el('div', { class: 'actions' }, ...acts) : null));
      pw.i.value = pw2.i.value = ''; onDone();
    } catch (e) { out.replaceChildren(); msg.textContent = 'Backup fehlgeschlagen: ' + errText(e) + ' Es wurde kein Backup als erfolgreich vermerkt.'; }
    go.disabled = false;
  }));
  return el('div', { class: 'card field' }, el('b', {}, 'Backup erstellen'), el('p', { class: 'hint' }, 'Vollständiger, verschlüsselter Export des Tresors (Passwörter, Notizen, persönliche Daten, Dokumente, Fotos, Ordner, Alben). Die Datei enthält keinen Klartext und ist unabhängig von diesem Browser.'), pw.node, pw2.node, hint, msg, go, out);
}

// ---------- Backup überprüfen (Stufe 1 bis 3) ----------
export function verifyPanel(ctx, onDone = () => {}) {
  const out = el('div', { role: 'status' }), pw = pwBox('vp', 'Backup-Passwort'); let file = null;
  const res = el('div', { class: 'stack' });
  const run = (label, fn) => () => withBusy(async () => {
    res.replaceChildren(...lines(label + ' …')); await paint();
    try { await fn(); } catch (e) { res.replaceChildren(el('p', { class: 'msg', role: 'alert' }, e instanceof WrongBackupPasswordError ? e.message : 'Prüfung fehlgeschlagen: ' + errText(e))); }
  });
  const s2 = el('button', { type: 'button', class: 'btn', onclick: run('Integrität wird geprüft', async () => {
    const v = await verifyBackup(await openBackup(file, pw.i.value));
    res.replaceChildren(el('div', { class: 'card field' }, el('b', {}, 'Integrität bestätigt'), ...lines('Alle ' + v.frames + ' Teile sind authentisch, vollständig und passen zum Manifest (' + v.records + ' Datensätze, ' + v.chunks + ' Datei-Chunks, erstellt ' + new Date(v.manifest.createdAt).toLocaleString('de-DE') + ').', 'Das beweist noch keine erfolgreiche Wiederherstellung: dafür die Probewiederherstellung (Stufe 3) ausführen.')));
  }) }, 'Integrität prüfen (Stufe 2)');
  const s3 = el('button', { type: 'button', class: 'btn primary', onclick: run('Probewiederherstellung läuft', async () => {
    const r = await verifyRestore(await openBackup(file, pw.i.value), (n) => { res.replaceChildren(...lines('Probewiederherstellung … Teil ' + n)); });
    ctx.settings.lastBackupTestAt = Date.now(); await saveSettings(ctx.db, ctx.settings);
    res.replaceChildren(el('div', { class: 'card field' }, el('b', {}, 'Wiederherstellung getestet'), ...lines('Das Backup wurde vollständig in eine temporäre Datenbank eingespielt und geprüft: ' + r.checked.records + ' Datensätze, ' + r.checked.files + ' Dateien, ' + r.checked.chunks + ' Chunks. Die temporären Daten wurden restlos gelöscht, dein Tresor blieb unverändert.')));
    onDone();
  }) }, 'Probewiederherstellung (Stufe 3)');
  const steps = el('div', { class: 'stack' }); steps.hidden = true;
  const pick = filePick('Backup-Datei (.bvx) wählen', async (f) => {
    file = f; steps.hidden = true; out.replaceChildren(...lines('Datei wird geprüft …'));
    try { const s = await inspectStructure(f); out.replaceChildren(el('div', { class: 'card field' }, el('b', {}, 'Dateistruktur geprüft'), ...lines('BROX-VAULT-Backup, Format ' + s.version + ', ' + s.frames + ' Teile, ' + fmt(s.size) + '. Verschlüsselung: Argon2id (' + Math.round(s.kdf.m / 1024) + ' MiB, ' + s.kdf.t + ' Durchläufe) + AES-256-GCM.', 'Der Inhalt ist damit noch nicht geprüft: dafür das Backup-Passwort eingeben.'))); steps.hidden = false; }
    catch (e) { out.replaceChildren(el('p', { class: 'msg', role: 'alert' }, errText(e))); }
  });
  steps.append(pw.node, el('div', { class: 'actions' }, s2, s3));
  return el('div', { class: 'card field' }, el('b', {}, 'Backup überprüfen'), el('p', { class: 'hint' }, 'Stufe 1: Dateistruktur · Stufe 2: Authentizität und Vollständigkeit · Stufe 3: echte Probewiederherstellung (braucht vorübergehend freien Speicher).'), pick, out, steps, res);
}

// ---------- Backup importieren (in den entsperrten Tresor) ----------
export function importPanel(ctx, onDone = () => {}) {
  const pw = pwBox('ip', 'Backup-Passwort'); let file = null, bk = null;
  const res = el('div', { class: 'stack' }), steps = el('div', { class: 'stack' }); steps.hidden = true; const info = el('div', { role: 'status' });
  const check = el('button', { type: 'button', class: 'btn primary' }, 'Backup prüfen');
  check.addEventListener('click', async () => {
    check.disabled = true; res.replaceChildren(...lines('Prüfe Backup (Schlüsselableitung und alle Teile) …')); await paint();
    try {
      bk = await openBackup(file, pw.i.value); const v = await verifyBackup(bk); bk = await openBackup(file, pw.i.value);
      const plan = await applyBackup(sessionTarget(ctx), bk, { policy: 'keep', commit: false }); bk = await openBackup(file, pw.i.value);
      const conflicts = plan.conflicts + plan.files.conflicts, add = plan.added + plan.files.added, same = plan.unchanged + plan.files.unchanged;
      const radios = el('div', { class: 'stack' }); let policy = 'keep'; const ok = el('input', { type: 'checkbox', id: 'ow' }), go = el('button', { type: 'button', class: 'btn primary' }, 'Wiederherstellen');
      const sync = () => { go.disabled = policy === 'overwrite' && !ok.checked; };
      if (conflicts) {
        const r = (v, l) => el('label', { class: 'check' }, el('input', { type: 'radio', name: 'pol', value: v, checked: v === 'keep', onchange: () => { policy = v; ow.hidden = v !== 'overwrite'; sync(); } }), el('span', {}, l));
        const ow = el('label', { class: 'check', hidden: true }, ok, el('span', {}, 'Ich bestätige: vorhandene Einträge werden durch die Backup-Version ersetzt.')); ok.addEventListener('change', sync);
        radios.append(r('keep', 'Vorhandene Einträge behalten (empfohlen)'), r('overwrite', 'Bei Konflikten die Backup-Version übernehmen'), ow);
      }
      go.addEventListener('click', () => withBusy(async () => {
        go.disabled = true; const prog = el('p', { class: 'hint' }); res.append(prog);
        try {
          const r = await applyBackup(sessionTarget(ctx), await openBackup(file, pw.i.value), { policy, onProgress: (n) => { prog.textContent = 'Stelle wieder her … Teil ' + n + ' von ' + v.frames; } });
          await data.loadAll(ctx.db); await fdata.loadAll(ctx.db);
          res.replaceChildren(el('div', { class: 'card field' }, el('b', {}, 'Wiederherstellung abgeschlossen'), ...lines((r.added + r.files.added) + ' Einträge neu hinzugefügt, ' + (r.unchanged + r.files.unchanged) + ' waren bereits vorhanden' + (policy === 'overwrite' ? ', ' + (r.replaced + r.files.replaced) + ' ersetzt' : '') + (r.conflicts + r.files.conflicts && policy === 'keep' ? ', ' + (r.conflicts + r.files.conflicts) + ' abweichende Einträge unverändert gelassen' : '') + '.', 'Tipp: Starte unter „Speicher & Backups“ die Integritätsprüfung.')));
          pw.i.value = ''; onDone();
        } catch (e) { res.replaceChildren(el('p', { class: 'msg', role: 'alert' }, 'Wiederherstellung abgebrochen: ' + errText(e) + ' Bereits vollständig wiederhergestellte Einträge bleiben konsistent; unfertige Dateien wurden entfernt.')); }
      }));
      res.replaceChildren(el('div', { class: 'card field' }, el('b', {}, 'Backup ist in Ordnung'), ...lines('Erstellt ' + new Date(v.manifest.createdAt).toLocaleString('de-DE') + ' · ' + v.records + ' Datensätze, ' + v.chunks + ' Datei-Chunks.',
        'Vorschau für deinen Tresor: ' + add + ' neu, ' + same + ' unverändert, ' + conflicts + ' abweichend (Konflikte).', 'Es wurde noch nichts verändert. Ein bestehender Tresor wird nie ungefragt überschrieben.'), radios, el('div', { class: 'actions' }, go)));
    } catch (e) { res.replaceChildren(el('p', { class: 'msg', role: 'alert' }, e instanceof WrongBackupPasswordError ? e.message : 'Prüfung fehlgeschlagen: ' + errText(e))); }
    check.disabled = false;
  });
  const pick = filePick('Backup-Datei (.bvx) wählen', async (f) => { file = f; res.replaceChildren(); try { const s = await inspectStructure(f); info.replaceChildren(...lines('Format ' + s.version + ', ' + s.frames + ' Teile, ' + fmt(s.size) + '.')); steps.hidden = false; } catch (e) { steps.hidden = true; info.replaceChildren(el('p', { class: 'msg', role: 'alert' }, errText(e))); } });
  steps.append(pw.node, el('div', { class: 'actions' }, check));
  return el('div', { class: 'card field' }, el('b', {}, 'Backup importieren'), el('p', { class: 'hint' }, 'Spielt ein Backup in den geöffneten Tresor ein, ohne Vorhandenes zu löschen. Für ein neues Gerät nutze beim ersten Start „Aus Backup wiederherstellen“.'), pick, info, steps, res);
}
export { revokeAll };
