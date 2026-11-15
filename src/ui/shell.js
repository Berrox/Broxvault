import { el, icon } from './dom.js';
import { sections, primary, more, logo, searchIcon } from './sections.js';
import { renderView } from './views.js';
import { setQuery, getQuery } from '../modules/data.js';
import { revokeAll } from '../modules/fileops.js';

const known = new Set([...sections.map((s) => s.id), 'mehr', 'suche']);
const current = () => { const r = location.hash.replace(/^#\//, ''); return known.has(r) ? r : 'dashboard'; };
const link = (s) => el('a', { href: '#/' + s.id, 'data-id': s.id }, icon(s.icon), el('span', {}, s.title));
const brand = (cls) => el('div', { class: 'brand ' + cls }, icon(logo), el('span', {}, 'BROX VAULT'));

export function mountShell(root, ctx) {
  const main = el('main', { id: 'main', tabindex: '-1' });
  const side = el('nav', { class: 'sidebar nav', 'aria-label': 'Hauptnavigation' }, brand('in-side'), ...sections.map(link));
  const bottom = el('nav', { class: 'bottom-nav nav', 'aria-label': 'Hauptnavigation' }, ...primary.map((id) => link(sections.find((s) => s.id === id))), link(more));
  const search = el('div', { class: 'search' }, icon(searchIcon),
    el('input', { type: 'search', placeholder: 'Im Tresor suchen', 'aria-label': 'Im Tresor suchen', autocomplete: 'off', value: getQuery(),
      oninput: (e) => { setQuery(e.target.value); if (current() !== 'suche') location.hash = '#/suche'; else render({ keep: true }); } })); // Suchtext steht nie in der URL
  root.append(side, el('header', { class: 'topbar' }, brand('in-top'), search), main, bottom);

  function render(opts = {}) {
    const id = current();
    const s = sections.find((x) => x.id === id) || { ...more, title: id === 'suche' ? 'Suche' : more.title };
    if (!opts.keep) revokeAll(); // entschlüsselte Blob-URLs nie länger als nötig behalten
    main.replaceChildren(renderView(id, ctx));
    document.title = s.title + ' – BROX VAULT';
    const moreIds = sections.filter((x) => !primary.includes(x.id)).map((x) => x.id);
    for (const a of document.querySelectorAll('.nav a')) {
      const d = a.dataset.id, active = d === id || (d === 'mehr' && moreIds.includes(id));
      if (active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    }
    if (!opts.keep) { main.focus({ preventScroll: true }); window.scrollTo(0, 0); }
  }
  const onHash = () => render();
  addEventListener('hashchange', onHash);
  render();
  return () => removeEventListener('hashchange', onHash);
}
