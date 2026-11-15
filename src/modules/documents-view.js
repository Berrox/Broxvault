import { el } from '../ui/dom.js';
import * as fd from './filedata.js';
import { importFile, readParts, makeUrl, revokeAll, updateMeta, deleteFileFully } from './fileops.js';
import { holdHideLock } from '../core/autolock.js';
import { takeIntent } from './data.js';
import { withBusy } from '../pwa/busy.js';

export const fmtSize = (n) => (n < 1024 ? n + ' B' : n < 1048576 ? Math.round(n / 1024) + ' KiB' : (n / 1048576).toFixed(1) + ' MiB');
const fmtDate = (t) => new Date(t).toLocaleDateString('de-DE');
const byName = (a, b) => (a.name || '').localeCompare(b.name || '', 'de');
export function inlineEdit(initial, label, onSave, onCancel) {
  const i = el('input', { value: initial, 'aria-label': label, autocomplete: 'off' });
  return el('div', { class: 'pw' }, i, el('button', { type: 'button', class: 'btn small primary', onclick: () => onSave(i.value.trim()) }, 'Speichern'), el('button', { type: 'button', class: 'btn small', onclick: onCancel }, 'Abbrechen'));
}

export function documentsView(ctx) {
  const root = el('div', {}), st = { folder: null, q: '', sort: 'name', fav: false }, flash = el('p', { class: 'hint', role: 'status' });
  let view = 0;
  const show = (...n) => { view++; revokeAll(); root.replaceChildren(...n.flat().filter((x) => x != null && x !== false)); };
  const say = (t) => { flash.textContent = t; };
  const pathOf = (id) => { const out = []; let f = id && fd.folder(id); while (f) { out.unshift(f); f = f.parentId && fd.folder(f.parentId); } return out; };
  const pathName = (id) => pathOf(id).map((f) => f.name).join(' / ');

  const doImport = (files) => withBusy(() => runImport(files));
  async function runImport(files) {
    let ok = 0; const errs = [];
    for (const [i, f] of files.entries()) {
      try { await importFile(ctx, f, { kind: 'document', folderId: st.folder, onProgress: (p) => say('Importiere ' + (i + 1) + '/' + files.length + ': ' + f.name + ' (' + Math.round(p * 100) + ' %)') }); ok++; }
      catch (e) { errs.push(f.name + ': ' + e.message); }
    }
    list(); say(ok + (ok === 1 ? ' Datei' : ' Dateien') + ' importiert.' + (errs.length ? ' Nicht importiert: ' + errs.join(' · ') : ''));
  }

  function list() {
    const q = st.q.trim().toLowerCase();
    const folders = q ? [] : fd.listFolders('folder').filter((f) => (f.parentId || null) === st.folder).sort(byName);
    const sorter = { name: byName, date: (a, b) => b.createdAt - a.createdAt, size: (a, b) => b.size - a.size }[st.sort];
    const files = fd.docs().filter((m) => (q ? fd.search(q).some((x) => x.id === m.id) : (m.folderId || null) === st.folder) && (!st.fav || m.favorite)).sort(sorter);
    const input = el('input', { type: 'file', multiple: true, accept: '.pdf,.jpg,.jpeg,.png,.webp,.txt', hidden: true, 'aria-label': 'Dokumente auswählen', onchange: (e) => { const f = [...e.target.files]; e.target.value = ''; if (f.length) doImport(f); } });
    const formSlot = el('div', {});
    const newFolder = () => formSlot.replaceChildren(inlineEdit('', 'Ordnername', async (name) => {
      if (!name) return; try { await fd.saveFolder({ kind: 'folder', name, parentId: st.folder }); list(); } catch { say('Ordner konnte nicht gespeichert werden.'); }
    }, () => formSlot.replaceChildren()));
    const crumbs = el('div', { class: 'crumbs' }, el('button', { type: 'button', class: 'btn small', onclick: () => { st.folder = null; list(); } }, 'Dokumente'),
      ...pathOf(st.folder).flatMap((f) => ['›', el('button', { type: 'button', class: 'btn small', onclick: () => { st.folder = f.id; list(); } }, f.name)]));
    const frow = (f) => {
      const row = el('div', { class: 'card row3' }); const normal = () => row.replaceChildren(el('button', { type: 'button', class: 'rowmain', onclick: () => { st.folder = f.id; list(); } }, el('b', {}, '📁 ' + f.name)),
        el('button', { type: 'button', class: 'btn small', onclick: () => row.replaceChildren(inlineEdit(f.name, 'Ordnername', async (n) => { if (n) { await fd.saveFolder({ ...f, name: n }); list(); } }, normal)) }, 'Umbenennen'),
        el('button', { type: 'button', class: 'btn small', onclick: () => row.replaceChildren(el('span', { class: 'msg' }, 'Ordner löschen?'), el('button', { type: 'button', class: 'btn small danger', onclick: async () => { try { await fd.removeFolder(f.id); list(); } catch (e) { say(e.message); normal(); } } }, 'Ja'), el('button', { type: 'button', class: 'btn small', onclick: normal }, 'Abbrechen')) }, 'Löschen'));
      normal(); return row;
    };
    const frow2 = (m) => el('div', { class: 'card row3' },
      el('button', { type: 'button', class: 'star', 'aria-pressed': String(!!m.favorite), 'aria-label': 'Favorit', onclick: async () => { await updateMeta(m, { favorite: !m.favorite }); list(); } }, m.favorite ? '★' : '☆'),
      el('button', { type: 'button', class: 'rowmain', onclick: () => detail(m.id) }, el('b', {}, m.name), el('span', { class: 'hint' }, fmtSize(m.size) + ' · ' + fmtDate(m.createdAt) + (q && m.folderId ? ' · ' + pathName(m.folderId) : '')), m.category ? el('span', { class: 'chip' }, m.category) : null));
    const sort = el('select', { 'aria-label': 'Sortierung', onchange: (e) => { st.sort = e.target.value; list(); } }, ...[['name', 'Name A–Z'], ['date', 'Zuletzt hinzugefügt'], ['size', 'Größe']].map(([v, l]) => el('option', { value: v, selected: v === st.sort }, l)));
    const search = el('input', { type: 'search', placeholder: 'Dokumente suchen', 'aria-label': 'Dokumente suchen', autocomplete: 'off', value: st.q, oninput: (e) => { st.q = e.target.value; clearTimeout(list.t); list.t = setTimeout(() => { list(); const s = document.querySelector('input[aria-label="Dokumente suchen"]'); if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); } }, 250); } });
    const fav = el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: st.fav, onchange: (e) => { st.fav = e.target.checked; list(); } }), el('span', {}, 'Nur Favoriten'));
    show(el('h1', { id: 'view-title', tabindex: '-1' }, 'Dokumente'), el('p', { class: 'lead' }, 'PDFs, Bilder und Textdateien, verschlüsselt abgelegt (bis ' + 100 + ' MiB je Datei).'),
      el('div', { class: 'actions' }, el('button', { type: 'button', class: 'btn primary', onclick: () => { holdHideLock(); input.click(); } }, 'Dokumente hinzufügen'), el('button', { type: 'button', class: 'btn', onclick: newFolder }, 'Neuer Ordner'), input),
      formSlot, flash, crumbs, el('div', { class: 'toolbar' }, search, sort, fav),
      el('div', { class: 'list' }, ...folders.map(frow), ...files.map(frow2), (!folders.length && !files.length) ? el('div', { class: 'card empty' }, el('b', {}, q ? 'Keine Treffer.' : 'Hier ist noch nichts.'), el('span', {}, q ? 'Passe die Suche an.' : 'Füge Dokumente hinzu oder lege einen Ordner an.')) : null));
  }

  function detail(id) {
    const m = fd.get(id); if (!m) { list(); return; }
    const box = el('div', { class: 'viewer' }, el('p', { class: 'hint' }, 'Wird entschlüsselt und geprüft …')), msg = el('p', { class: 'msg', role: 'alert' });
    const actions = el('div', { class: 'actions' }), editSlot = el('div', {});
    const moveSel = el('select', { 'aria-label': 'Verschieben nach', onchange: async (e) => { try { await updateMeta(m, { folderId: e.target.value || null }); detail(id); } catch { msg.textContent = 'Verschieben fehlgeschlagen.'; } } },
      el('option', { value: '' }, 'Hauptebene'), ...fd.listFolders('folder').map((f) => ({ id: f.id, n: pathName(f.id) })).sort((a, b) => a.n.localeCompare(b.n, 'de')).map((f) => el('option', { value: f.id, selected: f.id === m.folderId }, f.n)));
    const cat = el('input', { id: 'd-cat', value: m.category || '', autocomplete: 'off' }), desc = el('textarea', { id: 'd-desc', rows: '3' }, m.description || '');
    const fav = el('input', { type: 'checkbox', id: 'd-fav', checked: !!m.favorite });
    const normal = () => actions.replaceChildren(el('button', { type: 'button', class: 'btn', onclick: () => editSlot.replaceChildren(inlineEdit(m.name, 'Dateiname', async (n) => { if (!n) return; try { await updateMeta(m, { name: n }); detail(id); } catch { msg.textContent = 'Umbenennen fehlgeschlagen.'; } }, () => editSlot.replaceChildren())) }, 'Umbenennen'),
      el('button', { type: 'button', class: 'btn', onclick: ask }, 'Löschen'));
    const ask = () => actions.replaceChildren(el('span', { class: 'msg' }, 'Datei endgültig löschen?'), el('button', { type: 'button', class: 'btn danger', onclick: async () => {
      try { const r = await deleteFileFully(ctx, m); list(); if (r.leftover) say('Eintrag gelöscht; Reste der Daten bleiben als verwaiste Datei (siehe Integritätsprüfung).'); } catch { msg.textContent = 'Löschen fehlgeschlagen.'; normal(); } } }, 'Ja, löschen'), el('button', { type: 'button', class: 'btn', onclick: normal }, 'Abbrechen'));
    normal();
    show(el('button', { type: 'button', class: 'btn small', onclick: list }, '← Zurück'), el('h1', { id: 'view-title', tabindex: '-1' }, (m.favorite ? '★ ' : '') + m.name), box, msg,
      el('div', { class: 'card kvs' }, ...[['Typ', m.mime], ['Größe', fmtSize(m.size) + ' (' + m.chunkCount + (m.chunkCount === 1 ? ' Chunk' : ' Chunks') + ')'], ['Hinzugefügt', fmtDate(m.createdAt)], ['Ordner', m.folderId ? pathName(m.folderId) : 'Hauptebene']].map(([a, b]) => el('div', { class: 'kv' }, el('span', { class: 'hint' }, a), el('span', { class: 'val' }, b)))),
      el('div', { class: 'card field' }, el('label', { for: 'd-move' }, 'Verschieben nach'), moveSel, el('label', { for: 'd-cat' }, 'Kategorie'), cat, el('label', { for: 'd-desc' }, 'Beschreibung'), desc,
        el('label', { class: 'check' }, fav, el('span', {}, 'Favorit')), el('button', { type: 'button', class: 'btn primary', onclick: async () => { try { await updateMeta(m, { category: cat.value.trim(), description: desc.value, favorite: fav.checked }); detail(id); } catch { msg.textContent = 'Speichern fehlgeschlagen.'; } } }, 'Speichern')),
      editSlot, actions);
    const token = view;
    (async () => {
      try {
        if (m.mime === 'text/plain' && m.size > 2097152) { box.replaceChildren(el('p', { class: 'hint' }, 'Die Textdatei ist für die Vorschau zu groß (über 2 MiB).')); return; }
        const parts = await readParts(ctx, m); if (token !== view) return;
        if (m.mime === 'text/plain') { const all = new Uint8Array(m.size); let o = 0; for (const p of parts) { all.set(p, o); o += p.length; } box.replaceChildren(el('pre', { class: 'txt' }, new TextDecoder().decode(all))); return; }
        const url = makeUrl(new Blob(parts, { type: m.mime }));
        box.replaceChildren(m.mime === 'application/pdf' ? el('iframe', { src: url, title: m.name }) : el('img', { src: url, alt: m.name }));
      } catch { if (token === view) box.replaceChildren(el('p', { class: 'msg' }, 'Entschlüsselung fehlgeschlagen: Die Datei ist beschädigt oder wurde verändert. Nutze die Integritätsprüfung unter „Speicher & Backups“.')); }
    })();
  }

  const it = takeIntent();
  if (it && it.open && fd.get(it.open)) detail(it.open); else list();
  return root;
}
