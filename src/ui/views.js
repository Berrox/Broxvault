import { el, icon } from './dom.js';
import { sections } from './sections.js';
import { settingsView } from './settings-view.js';
import { storageView } from './storage-view.js';
import { dashboard } from '../modules/dashboard.js';
import { entityView } from '../modules/entity-view.js';
import { searchView } from '../modules/search-view.js';
import { documentsView } from '../modules/documents-view.js';
import { photosView } from '../modules/photos-view.js';
import { passwordSpec, noteSpec, personalSpec } from '../modules/specs.js';

const heading = (t, lead) => [el('h1', { id: 'view-title', tabindex: '-1' }, t), lead ? el('p', { class: 'lead' }, lead) : null];
function mehr() {
  return el('div', {}, ...heading('Mehr'),
    el('div', { class: 'list' }, ...sections.filter((s) => !['dashboard', 'passwoerter', 'dokumente', 'fotos'].includes(s.id))
      .map((s) => el('a', { class: 'card row', href: '#/' + s.id }, icon(s.icon), el('span', {}, s.title)))));
}
export function renderView(id, ctx) {
  if (id === 'dashboard') return dashboard(ctx);
  if (id === 'passwoerter') return entityView(passwordSpec, ctx);
  if (id === 'notizen') return entityView(noteSpec, ctx);
  if (id === 'persoenlich') return entityView(personalSpec, ctx);
  if (id === 'dokumente') return documentsView(ctx);
  if (id === 'fotos') return photosView(ctx);
  if (id === 'speicher') return storageView(ctx);
  if (id === 'einstellungen') return settingsView(ctx);
  if (id === 'suche') return searchView();
  if (id === 'mehr') return mehr();
  return dashboard(ctx);
}
