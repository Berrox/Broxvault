import { el } from '../ui/dom.js';
import * as data from './data.js';
import * as fdata from './filedata.js';
import { SPECS } from './specs.js';
const LABEL = { document: 'Dokument', photo: 'Foto' };
const label = (i) => (SPECS[i.type] ? SPECS[i.type].label + (SPECS[i.type].summary(i) ? ' · ' + SPECS[i.type].summary(i) : '') : LABEL[i.kind] + (i.category ? ' · ' + i.category : ''));
export function searchView() {
  const q = data.getQuery(), r = q.trim() ? [...data.search(q), ...fdata.search(q)].sort((a, b) => b.updatedAt - a.updatedAt) : [];
  const open = (i) => data.openItem({ id: i.id, type: i.type || i.kind });
  return el('div', {}, el('h1', { id: 'view-title', tabindex: '-1' }, 'Suche'),
    el('p', { class: 'lead' }, q.trim() ? r.length + (r.length === 1 ? ' Treffer' : ' Treffer') + ' für „' + q + '“. Geheime Felder werden nicht durchsucht.' : 'Tippe oben, um in Titeln, Benutzernamen, Webseiten, Notizen, Dateinamen und Kategorien zu suchen.'),
    el('div', { class: 'list' }, ...r.map((i) => el('button', { type: 'button', class: 'card rowmain', onclick: () => open(i) }, el('b', {}, i.title || i.name || '(ohne Titel)'), el('span', { class: 'hint' }, label(i))))));
}
