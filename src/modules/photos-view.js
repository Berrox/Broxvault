import { el } from '../ui/dom.js';
import * as fd from './filedata.js';
import { importFile, openBlob, makeUrl, releaseUrl, revokeAll, updateMeta, deleteFileFully } from './fileops.js';
import { holdHideLock } from '../core/autolock.js';
import { takeIntent } from './data.js';
import { withBusy } from '../pwa/busy.js';
import { fmtSize, inlineEdit } from './documents-view.js';

const NONE = '__none';
let active = 0; const queue = [];
const pump = () => { while (active < 3 && queue.length) { const job = queue.shift(); active++; job().finally(() => { active--; pump(); }); } }; // höchstens 3 Vorschaubilder gleichzeitig entschlüsseln

export function photosView(ctx) {
  const root = el('div', {}), st = { album: '', q: '', fav: false }, flash = el('p', { class: 'hint', role: 'status' });
  let view = 0, io = null;
  // reset() VOR dem Aufbau der Kacheln: sie merken sich die Ansicht, und der Beobachter darf nicht danach geschlossen werden.
  const reset = () => { view++; if (io) { io.disconnect(); io = null; } queue.length = 0; revokeAll(); };
  const put = (...n) => root.replaceChildren(...n.flat().filter((x) => x != null && x !== false));
  const say = (t) => { flash.textContent = t; };
  const visible = () => {
    const q = st.q.trim().toLowerCase(), hit = q ? new Set(fd.search(q).map((m) => m.id)) : null;
    return fd.photos().filter((m) => (st.album === '' || (st.album === NONE ? !m.albumId : m.albumId === st.album)) && (!st.fav || m.favorite) && (!hit || hit.has(m.id))).sort((a, b) => b.createdAt - a.createdAt);
  };

  const doImport = (files) => withBusy(() => runImport(files));
  async function runImport(files) {
    let ok = 0; const errs = [];
    for (const [i, f] of files.entries()) {
      try { await importFile(ctx, f, { kind: 'photo', albumId: st.album && st.album !== NONE ? st.album : null, onProgress: (p) => say('Importiere ' + (i + 1) + '/' + files.length + ': ' + f.name + ' (' + Math.round(p * 100) + ' %)') }); ok++; }
      catch (e) { errs.push(f.name + ': ' + e.message); }
    }
    list(); say(ok + (ok === 1 ? ' Foto' : ' Fotos') + ' importiert.' + (errs.length ? ' Nicht importiert: ' + errs.join(' · ') : ''));
  }

  function tile(m, idx, items) {
    const img = el('img', { alt: m.name, loading: 'lazy' }), token = view;
    const b = el('button', { type: 'button', class: 'tile', 'aria-label': m.name, onclick: () => full(items, idx) }, img, m.favorite ? el('span', { class: 'tilestar', 'aria-hidden': 'true' }, '★') : null);
    const load = () => queue.push(async () => {
      try { const t = fd.get(m.thumbId); if (!t || token !== view) return; const blob = await openBlob(ctx, t); if (token !== view) return; img.src = makeUrl(blob); }
      catch { img.alt = 'Vorschau nicht lesbar'; b.classList.add('broken'); }
    }) && pump();
    if (io) { b._load = load; io.observe(b); } else load();
    return b;
  }

  function list() {
    reset();
    const albums = fd.listFolders('album').sort((a, b) => a.name.localeCompare(b.name, 'de')), items = visible();
    if (typeof IntersectionObserver === 'function') io = new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) { io.unobserve(e.target); e.target._load && e.target._load(); } }, { rootMargin: '300px' });
    const input = el('input', { type: 'file', multiple: true, accept: 'image/jpeg,image/png,image/webp', hidden: true, 'aria-label': 'Fotos auswählen', onchange: (e) => { const f = [...e.target.files]; e.target.value = ''; if (f.length) doImport(f); } });
    const slot = el('div', {});
    const chip = (label, v) => el('button', { type: 'button', class: 'btn small' + (st.album === v ? ' primary' : ''), 'aria-pressed': String(st.album === v), onclick: () => { st.album = v; list(); } }, label);
    const cur = albums.find((a) => a.id === st.album);
    const clear = () => slot.replaceChildren();
    const askDelete = () => slot.replaceChildren(el('span', { class: 'msg' }, 'Album löschen? Die Fotos bleiben erhalten.'),
      el('button', { type: 'button', class: 'btn small danger', onclick: async () => { try { await fd.removeFolder(cur.id); st.album = ''; list(); } catch { say('Album konnte nicht gelöscht werden.'); } } }, 'Ja, Album löschen'),
      el('button', { type: 'button', class: 'btn small', onclick: clear }, 'Abbrechen'));
    const rename = () => slot.replaceChildren(inlineEdit(cur.name, 'Albumname', async (n) => { if (n) { await fd.saveFolder({ ...cur, name: n }); list(); } }, clear));
    const albumTools = cur ? el('div', { class: 'actions' }, el('button', { type: 'button', class: 'btn small', onclick: rename }, 'Album umbenennen'), el('button', { type: 'button', class: 'btn small', onclick: askDelete }, 'Album löschen')) : null;
    const search = el('input', { type: 'search', placeholder: 'Fotos suchen (Name, Kategorie, Beschreibung)', 'aria-label': 'Fotos suchen', autocomplete: 'off', value: st.q, oninput: (e) => { st.q = e.target.value; clearTimeout(list.t); list.t = setTimeout(() => { list(); const s = document.querySelector('input[aria-label="Fotos suchen"]'); if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); } }, 250); } });
    const fav = el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: st.fav, onchange: (e) => { st.fav = e.target.checked; list(); } }), el('span', {}, 'Nur Favoriten'));
    put(el('h1', { id: 'view-title', tabindex: '-1' }, 'Fotos'), el('p', { class: 'lead' }, 'Fotos und verschlüsselte Vorschaubilder. Die Originale bleiben unverändert.'),
      el('div', { class: 'actions' }, el('button', { type: 'button', class: 'btn primary', onclick: () => { holdHideLock(); input.click(); } }, 'Fotos hinzufügen'),
        el('button', { type: 'button', class: 'btn', onclick: () => slot.replaceChildren(inlineEdit('', 'Albumname', async (n) => { if (!n) return; try { const a = await fd.saveFolder({ kind: 'album', name: n }); st.album = a.id; list(); } catch { say('Album konnte nicht gespeichert werden.'); } }, () => slot.replaceChildren())) }, 'Neues Album'), input),
      slot, flash, el('div', { class: 'chips' }, chip('Alle', ''), ...albums.map((a) => chip(a.name, a.id)), chip('Ohne Album', NONE)), albumTools,
      el('div', { class: 'toolbar' }, search, fav),
      items.length ? el('div', { class: 'photo-grid' }, ...items.map((m, i) => tile(m, i, items))) : el('div', { class: 'card empty' }, el('b', {}, st.q || st.album || st.fav ? 'Keine Treffer.' : 'Noch keine Fotos.'), el('span', {}, 'Füge Fotos hinzu (JPG, PNG, WEBP).')));
  }

  function full(items, start) {
    let list2 = items.slice(), i = start, cur = null, url = null, infoOpen = false;
    const overlay = el('div', { class: 'overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Foto', tabindex: '-1' }), img = el('img', { alt: '' }), msg = el('p', { class: 'msg', role: 'alert' }), info = el('div', { class: 'card field info' }), title = el('b', {});
    const close = () => { document.removeEventListener('keydown', onKey); if (url) releaseUrl(url); overlay.remove(); list(); };
    const onKey = (e) => { if (e.key === 'Escape') close(); else if (e.key === 'ArrowRight') go(1); else if (e.key === 'ArrowLeft') go(-1); };
    const go = (d) => { if (list2.length > 1) at((i + d + list2.length) % list2.length); };
    async function at(n) {
      i = n; const m = cur = list2[i]; if (url) { releaseUrl(url); url = null; } img.removeAttribute('src'); msg.textContent = ''; title.textContent = m.name; renderInfo(m);
      try { const blob = await openBlob(ctx, m); if (cur !== m) return; url = makeUrl(blob); img.src = url; } catch { if (cur === m) msg.textContent = 'Entschlüsselung fehlgeschlagen: Das Foto ist beschädigt oder wurde verändert.'; }
    }
    function renderInfo(m) {
      info.hidden = !infoOpen; if (!infoOpen) return;
      const albums = fd.listFolders('album'), alb = el('select', { 'aria-label': 'Album', onchange: async (e) => { try { list2[i] = await updateMeta(m, { albumId: e.target.value || null }); cur = list2[i]; renderInfo(cur); } catch { msg.textContent = 'Verschieben fehlgeschlagen.'; } } },
        el('option', { value: '' }, 'Ohne Album'), ...albums.map((a) => el('option', { value: a.id, selected: a.id === m.albumId }, a.name)));
      const cat = el('input', { 'aria-label': 'Kategorie', value: m.category || '', autocomplete: 'off', onchange: async (e) => { try { list2[i] = await updateMeta(m, { category: e.target.value.trim() }); cur = list2[i]; } catch { msg.textContent = 'Speichern fehlgeschlagen.'; } } });
      const acts = el('div', { class: 'actions' });
      const upd = async (ch, fail, after) => { try { list2[i] = await updateMeta(m, ch); cur = list2[i]; if (after) after(); renderInfo(cur); } catch { msg.textContent = fail; } };
      const nrm = () => acts.replaceChildren(
        el('button', { type: 'button', class: 'btn small', onclick: () => upd({ favorite: !m.favorite }, 'Speichern fehlgeschlagen.') }, m.favorite ? '★ Favorit entfernen' : '☆ Als Favorit'),
        el('button', { type: 'button', class: 'btn small', onclick: renameAsk }, 'Umbenennen'),
        el('button', { type: 'button', class: 'btn small', onclick: deleteAsk }, 'Löschen'));
      const renameAsk = () => acts.replaceChildren(inlineEdit(m.name, 'Dateiname', (n) => { if (n) upd({ name: n }, 'Umbenennen fehlgeschlagen.', () => { title.textContent = n; }); }, nrm));
      const doDelete = async () => { try { await deleteFileFully(ctx, m); list2.splice(i, 1); if (!list2.length) close(); else at(Math.min(i, list2.length - 1)); } catch { msg.textContent = 'Löschen fehlgeschlagen.'; nrm(); } };
      const deleteAsk = () => acts.replaceChildren(el('span', { class: 'msg' }, 'Foto endgültig löschen?'), el('button', { type: 'button', class: 'btn small danger', onclick: doDelete }, 'Ja, löschen'), el('button', { type: 'button', class: 'btn small', onclick: nrm }, 'Abbrechen'));
      nrm();
      info.replaceChildren(...[['Name', m.name], ['Typ', m.mime], ['Größe', fmtSize(m.size)], ['Maße', m.width && m.height ? m.width + ' × ' + m.height + ' px' : 'unbekannt'], ['Hinzugefügt', new Date(m.createdAt).toLocaleDateString('de-DE')]].map(([a, b]) => el('div', { class: 'row2' }, el('span', { class: 'hint' }, a), el('span', { class: 'val' }, b))),
        el('label', {}, 'Album'), alb, el('label', {}, 'Kategorie'), cat, acts);
    }
    overlay.append(el('div', { class: 'ovbar' }, el('button', { type: 'button', class: 'btn small', onclick: close }, 'Schließen'), title, el('button', { type: 'button', class: 'btn small', 'aria-pressed': 'false', onclick: () => { infoOpen = !infoOpen; renderInfo(cur); } }, 'Info')),
      el('div', { class: 'ovbody' }, el('button', { type: 'button', class: 'btn nav-l', 'aria-label': 'Vorheriges Foto', onclick: () => go(-1) }, '‹'), img, el('button', { type: 'button', class: 'btn nav-r', 'aria-label': 'Nächstes Foto', onclick: () => go(1) }, '›')), msg, info);
    root.append(overlay); document.addEventListener('keydown', onKey); overlay.focus(); at(i);
  }

  const it = takeIntent();
  list(); if (it && it.open && fd.get(it.open)) { const m = fd.get(it.open), items = visible(); const k = items.findIndex((x) => x.id === m.id); full(k >= 0 ? items : [m], Math.max(0, k)); }
  return root;
}
