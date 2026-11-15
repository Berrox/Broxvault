import { el } from '../ui/dom.js';
import * as data from './data.js';
import { copySecret } from './clipboard.js';
import { generatorPanel } from './generator-ui.js';

const MASK = '••••••••';
const fmtDate = (t) => new Date(t).toLocaleDateString('de-DE');
function safeLink(v) { try { const u = new URL(v); if (u.protocol === 'https:' || u.protocol === 'http:') return el('a', { href: u.href, target: '_blank', rel: 'noopener noreferrer' }, v); } catch { /* kein gültiger Link */ } return v; }

// Eine gemeinsame Oberfläche für Passwörter, Notizen und persönliche Daten (gesteuert über specs.js).
export function entityView(spec, ctx) {
  const S = ctx.settings, root = el('div', {}), st = { q: '', cat: '', fav: false, sort: 'updated' };
  const show = (...n) => root.replaceChildren(...n.flat());
  const head = (t, lead) => [el('h1', { id: 'view-title', tabindex: '-1' }, t), lead ? el('p', { class: 'lead' }, lead) : null];
  const newItem = () => ({ type: spec.type, category: '', favorite: false, custom: [] });
  const flash = el('p', { class: 'hint', role: 'status' });

  function list() {
    const items = data.all(spec.type), cats = [...new Set(items.map((i) => i.category).filter(Boolean))].sort(), box = el('div', { class: 'list' });
    const draw = () => {
      const by = { updated: (a, b) => b.updatedAt - a.updatedAt, created: (a, b) => b.createdAt - a.createdAt, title: (a, b) => (a.title || '').localeCompare(b.title || '', 'de') }[st.sort];
      const r = items.filter((i) => (!st.cat || i.category === st.cat) && (!st.fav || i.favorite) && data.matches(i, st.q)).sort(by);
      box.replaceChildren(...(r.length ? r.map(row) : [el('div', { class: 'card empty' }, el('b', {}, items.length ? 'Keine Treffer.' : 'Noch nichts gespeichert.'), el('span', {}, items.length ? 'Passe Suche oder Filter an.' : 'Lege oben deinen ersten Eintrag an.'))]));
    };
    const row = (i) => el('div', { class: 'card row3' },
      el('button', { type: 'button', class: 'star', 'aria-pressed': String(!!i.favorite), 'aria-label': 'Favorit', onclick: async () => { await data.save({ ...i, favorite: !i.favorite }); list(); } }, i.favorite ? '★' : '☆'),
      el('button', { type: 'button', class: 'rowmain', onclick: () => detail(i.id) }, el('b', {}, i.title || '(ohne Titel)'), el('span', { class: 'hint' }, spec.summary(i)), i.category ? el('span', { class: 'chip' }, i.category) : null));
    const search = el('input', { type: 'search', placeholder: 'In dieser Liste suchen', 'aria-label': 'Suchen', autocomplete: 'off', value: st.q, oninput: (e) => { st.q = e.target.value; draw(); } });
    const sort = el('select', { 'aria-label': 'Sortierung', onchange: (e) => { st.sort = e.target.value; draw(); } },
      ...[['updated', 'Zuletzt geändert'], ['created', 'Zuletzt hinzugefügt'], ['title', 'Titel A–Z']].map(([v, l]) => el('option', { value: v, selected: v === st.sort }, l)));
    const cat = el('select', { 'aria-label': 'Kategorie', onchange: (e) => { st.cat = e.target.value; draw(); } }, el('option', { value: '' }, 'Alle Kategorien'), ...cats.map((c) => el('option', { value: c, selected: c === st.cat }, c)));
    const fav = el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: st.fav, onchange: (e) => { st.fav = e.target.checked; draw(); } }), el('span', {}, 'Nur Favoriten'));
    let gen = null; const genSlot = el('div', {});
    const genBtn = spec.generator ? el('button', { type: 'button', class: 'btn', onclick: () => {
      if (gen) { gen = null; genSlot.replaceChildren(); return; }
      gen = generatorPanel({ useLabel: 'Kopieren', onUse: async (v) => { try { await copySecret(v, S.clipboardSeconds); flash.textContent = 'Kopiert.' + (S.clipboardSeconds ? ' Die Zwischenablage wird in ' + S.clipboardSeconds + ' s geleert.' : ''); } catch { flash.textContent = 'Kopieren wurde vom Browser blockiert.'; } } });
      genSlot.replaceChildren(gen); } }, 'Passwortgenerator') : null;
    show(head(spec.title, spec.lead), el('div', { class: 'actions' }, el('button', { type: 'button', class: 'btn primary', onclick: () => editor(newItem()) }, spec.newLabel), genBtn), genSlot, flash,
      el('div', { class: 'toolbar' }, search, sort, cat, fav), box);
    draw();
  }

  function secretRow(label, value) {
    let vis = !!S.showPasswords; const val = el('span', { class: 'val' }, vis ? value : MASK);
    const t = el('button', { type: 'button', class: 'btn small', onclick: () => { vis = !vis; val.textContent = vis ? value : MASK; t.textContent = vis ? 'Verbergen' : 'Anzeigen'; } }, vis ? 'Verbergen' : 'Anzeigen');
    const c = el('button', { type: 'button', class: 'btn small', onclick: async () => { try { await copySecret(value, S.clipboardSeconds); flash.textContent = label + ' kopiert.' + (S.clipboardSeconds ? ' Die Zwischenablage wird in ' + S.clipboardSeconds + ' s geleert.' : ''); } catch { flash.textContent = 'Kopieren wurde vom Browser blockiert.'; } } }, 'Kopieren');
    return el('div', { class: 'kv' }, el('span', { class: 'hint' }, label), el('div', { class: 'kvrow' }, val, t, c));
  }
  const plainRow = (label, node) => el('div', { class: 'kv' }, el('span', { class: 'hint' }, label), el('span', { class: 'val' }, node));

  function detail(id) {
    const i = data.get(id); if (!i) { list(); return; }
    const rows = [];
    for (const fd of spec.fields) { if (fd.key === 'title' || !i[fd.key]) continue; rows.push(fd.kind === 'secret' ? secretRow(fd.label, i[fd.key]) : plainRow(fd.label, fd.kind === 'url' ? safeLink(i[fd.key]) : i[fd.key])); }
    for (const c of i.custom || []) rows.push(c.secret ? secretRow(c.name, c.value) : plainRow(c.name, c.value));
    if (i.category) rows.push(plainRow('Kategorie', i.category));
    rows.push(plainRow('Zuletzt geändert', fmtDate(i.updatedAt)));
    const actions = el('div', { class: 'actions' });
    const normal = () => actions.replaceChildren(el('button', { type: 'button', class: 'btn primary', onclick: () => editor(i) }, 'Bearbeiten'),
      el('button', { type: 'button', class: 'btn', onclick: () => ask() }, 'Löschen'));
    const ask = () => actions.replaceChildren(el('span', { class: 'msg' }, 'Diesen Eintrag endgültig löschen?'),
      el('button', { type: 'button', class: 'btn danger', onclick: async () => { try { await data.remove(id); list(); } catch { flash.textContent = 'Löschen fehlgeschlagen. Der Eintrag ist unverändert.'; normal(); } } }, 'Ja, löschen'),
      el('button', { type: 'button', class: 'btn', onclick: normal }, 'Abbrechen'));
    normal(); flash.textContent = '';
    show(el('button', { type: 'button', class: 'btn small', onclick: list }, '← Zurück'), head((i.favorite ? '★ ' : '') + (i.title || '(ohne Titel)')), flash, el('div', { class: 'card kvs' }, ...rows), actions);
  }

  function editor(item) {
    const isNew = !item.id, draft = { ...item, custom: (item.custom || []).map((c) => ({ ...c })) }, inputs = {}, msg = el('p', { class: 'msg', role: 'alert' });
    const cats = [...new Set(data.all(spec.type).map((i) => i.category).filter(Boolean))].sort();
    const nodes = spec.fields.map((fd) => {
      const id = 'f-' + fd.key;
      if (fd.kind === 'textarea') { const t = el('textarea', { id, rows: fd.key === 'content' ? '12' : '4', autocomplete: 'off' }, item[fd.key] || ''); inputs[fd.key] = t; return el('div', { class: 'field' }, el('label', { for: id }, fd.label), t); }
      const inp = el('input', { id, type: fd.kind === 'secret' && !S.showPasswords ? 'password' : 'text', value: item[fd.key] || '', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' }); inputs[fd.key] = inp;
      const wrap = el('div', { class: 'pw' }, inp);
      if (fd.kind === 'secret') wrap.append(el('button', { type: 'button', class: 'btn small', onclick: (e) => { inp.type = inp.type === 'password' ? 'text' : 'password'; e.target.textContent = inp.type === 'password' ? 'Anzeigen' : 'Verbergen'; } }, S.showPasswords ? 'Verbergen' : 'Anzeigen'));
      const f = el('div', { class: 'field' }, el('label', { for: id }, fd.label), wrap);
      if (spec.generator && fd.key === 'password') {
        const slot = el('div', {}); let open = false;
        f.append(el('button', { type: 'button', class: 'btn small', onclick: () => { open = !open; slot.replaceChildren(...(open ? [generatorPanel({ useLabel: 'Übernehmen', onUse: (v) => { inp.value = v; inp.type = 'text'; open = false; slot.replaceChildren(); } })] : [])); } }, 'Passwort generieren'), slot);
      }
      return f;
    });
    const customBox = el('div', { class: 'stack' });
    const renderCustom = () => customBox.replaceChildren(...draft.custom.map((c, n) => el('div', { class: 'card field' },
      el('input', { value: c.name, placeholder: 'Feldname', 'aria-label': 'Feldname', autocomplete: 'off', oninput: (e) => { c.name = e.target.value; } }),
      el('input', { type: c.secret ? 'password' : 'text', value: c.value, placeholder: 'Wert', 'aria-label': 'Wert', autocomplete: 'off', oninput: (e) => { c.value = e.target.value; } }),
      el('div', { class: 'actions' }, el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: c.secret, onchange: (e) => { c.secret = e.target.checked; renderCustom(); } }), el('span', {}, 'Geheim')),
        el('button', { type: 'button', class: 'btn small', onclick: () => { draft.custom.splice(n, 1); renderCustom(); } }, 'Entfernen')))));
    renderCustom();
    const catIn = el('input', { id: 'f-cat', value: item.category || '', list: 'cats', autocomplete: 'off' });
    const tpl = isNew && spec.templates ? el('div', { class: 'field' }, el('label', { for: 'f-tpl' }, 'Vorlage'), el('select', { id: 'f-tpl', onchange: (e) => {
      const t = spec.templates[e.target.value]; if (!t) return; catIn.value = e.target.value; draft.custom = t.map((x) => ({ name: Array.isArray(x) ? x[0] : x, value: '', secret: Array.isArray(x) })); renderCustom(); } },
      el('option', { value: '' }, 'Ohne Vorlage'), ...Object.keys(spec.templates).map((k) => el('option', { value: k }, k)))) : null;
    const fav = el('input', { type: 'checkbox', id: 'f-fav', checked: !!item.favorite });
    const save = el('button', { type: 'button', class: 'btn primary', onclick: async () => {
      msg.textContent = ''; const vals = {}; for (const fd of spec.fields) vals[fd.key] = inputs[fd.key].value;
      if (!vals.title.trim()) { msg.textContent = 'Bitte gib einen Titel ein.'; return; }
      save.disabled = true;
      try { const s = await data.save({ ...item, ...vals, title: vals.title.trim(), category: catIn.value.trim(), favorite: fav.checked, custom: draft.custom.filter((c) => c.name.trim()).map((c) => ({ name: c.name.trim(), value: c.value, secret: !!c.secret })) }); detail(s.id); }
      catch { msg.textContent = 'Speichern fehlgeschlagen. Es wurde nichts gespeichert; bitte erneut versuchen.'; save.disabled = false; }
    } }, 'Speichern');
    show(head(isNew ? spec.newLabel : 'Bearbeiten'), tpl, nodes, spec.custom ? [el('b', {}, 'Eigene Felder'), customBox, el('div', { class: 'actions' }, el('button', { type: 'button', class: 'btn small', onclick: () => { draft.custom.push({ name: '', value: '', secret: false }); renderCustom(); } }, 'Feld hinzufügen'))] : null,
      el('div', { class: 'field' }, el('label', { for: 'f-cat' }, 'Kategorie'), catIn, el('datalist', { id: 'cats' }, ...cats.map((c) => el('option', { value: c })))),
      el('label', { class: 'check' }, fav, el('span', {}, 'Favorit')), msg,
      el('div', { class: 'actions' }, save, el('button', { type: 'button', class: 'btn', onclick: () => (isNew ? list() : detail(item.id)) }, 'Abbrechen')));
  }

  const it = data.takeIntent();
  if (it && it.open && data.get(it.open)) detail(it.open); else if (it && it.new) editor(newItem()); else list();
  return root;
}
