// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
vi.setConfig({ testTimeout: 30000 });
const { entityView } = await import('../src/modules/entity-view.js');
const { documentsView } = await import('../src/modules/documents-view.js');
const { photosView } = await import('../src/modules/photos-view.js');
const { dashboard } = await import('../src/modules/dashboard.js');
const { searchView } = await import('../src/modules/search-view.js');
const { passwordSpec, noteSpec, personalSpec } = await import('../src/modules/specs.js');
const { mountShell } = await import('../src/ui/shell.js');
const { showUnlock } = await import('../src/ui/gate.js');
const data = await import('../src/modules/data.js');
const fd = await import('../src/modules/filedata.js');
const { importFile } = await import('../src/modules/fileops.js');
const { openDb, createMetaStore } = await import('../src/core/db/idb.js');
const { IdbBackend } = await import('../src/core/files/idb-backend.js');
const { createVault } = await import('../src/core/keys/vault.js');
const { lock } = await import('../src/core/keys/session.js');

const X = '"><img src=x onerror="window.__pwn=1"><svg onload="window.__pwn=2"><script>window.__pwn=3</script>';
const DIRTY = 'img[src="x"],svg[onload],script,[onerror],[onload]';
const wipe = () => new Promise((res) => { const r = indexedDB.deleteDatabase('brox-vault'); r.onsuccess = r.onerror = () => res(); });
const wait = async (pred, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { let ok = false; try { ok = pred(); } catch { /* weiter */ } if (ok) return; await new Promise((r) => setTimeout(r, 10)); } throw new Error('Zeitüberschreitung: ' + document.body.textContent.slice(0, 300)); };
const btn = (t) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(t));
const click = (t) => { const b = btn(t); if (!b) throw new Error('Button fehlt: ' + t); b.click(); };
const text = () => document.body.textContent;
const mount = (n) => { document.body.replaceChildren(n); return n; };
const clean = (what) => { expect(document.querySelector(DIRTY), what).toBeNull(); expect(window.__pwn, what).toBeUndefined(); };
let db, ctx;
beforeEach(async () => {
  lock(); await wipe(); document.body.replaceChildren(); delete window.__pwn; db = await openDb(); let n = 0;
  vi.stubGlobal('URL', Object.assign(URL, {}, { createObjectURL: () => 'blob:t' + ++n, revokeObjectURL: () => {} }));
  await createVault('ein sehr langes passwort', createMetaStore(db), { m: 1024, t: 1, p: 1 }); await data.loadAll(db); await fd.loadAll(db);
  ctx = { db, backend: new IdbBackend(db), settings: { clipboardSeconds: 30, showPasswords: true, backupReminderDays: 30, lastBackupAt: null, lastBackupTestAt: null }, info: { kind: 'idb' }, thumbMaker: async () => ({ bytes: new Uint8Array([1, 2, 3]), width: 9, height: 9 }) };
});
afterEach(() => { db.close(); vi.unstubAllGlobals(); });
const base = { favorite: true, category: X, custom: [{ name: X, value: X, secret: false }, { name: X + '2', value: X, secret: true }] };
const seed = async () => {
  await data.save({ type: 'password', title: X, website: X, username: X, password: X, pin: X, email: X, description: X, ...base });
  await data.save({ type: 'note', title: X, content: X, ...base, custom: [] }); await data.save({ type: 'personal', title: X, description: X, ...base });
  const folder = await fd.saveFolder({ kind: 'folder', name: X, parentId: null }), album = await fd.saveFolder({ kind: 'album', name: X });
  const txt = new TextEncoder().encode(X); await importFile(ctx, Object.assign(new Blob([txt]), { name: X + '.txt' }), { kind: 'document', folderId: folder.id });
  const jpg = new Uint8Array(100); jpg.set([0xff, 0xd8, 0xff, 0xe0]); await importFile(ctx, Object.assign(new Blob([jpg]), { name: X + '.jpg' }), { kind: 'photo', albumId: album.id });
};

describe('Feindliche Eingaben werden überall nur als Text dargestellt', () => {
  it('Kontrolle: der Prüfmechanismus erkennt einen echten Angriff (sonst wäre er wertlos)', () => {
    const d = document.createElement('div'); d.innerHTML = X; document.body.replaceChildren(d); expect(document.querySelector(DIRTY)).not.toBeNull();
  });
  it('Passwörter, Notizen und persönliche Daten (Liste, Detail, Editor, geheime Felder angezeigt)', async () => {
    await seed();
    for (const spec of [passwordSpec, noteSpec, personalSpec]) {
      mount(entityView(spec, ctx)); clean(spec.type + ' Liste'); document.querySelector('.rowmain').click(); clean(spec.type + ' Detail');
      for (const b of [...document.querySelectorAll('.kvrow .btn')].filter((x) => x.textContent === 'Anzeigen')) b.click(); clean(spec.type + ' Detail mit geheimen Werten');
      expect(text()).toContain('<img src=x'); click('Bearbeiten'); clean(spec.type + ' Editor');
    }
  });
  it('Dateien, Ordner, Alben, Galerie, Vollbild, Dashboard und Suche', async () => {
    await seed();
    mount(documentsView(ctx)); clean('Dokumente Wurzel'); click('📁'); clean('Dokumente Ordner'); document.querySelector('.rowmain').click(); await wait(() => document.querySelector('pre.txt')); clean('Dokument Detail');
    expect(document.querySelector('pre.txt').textContent).toBe(X);
    mount(photosView(ctx)); clean('Galerie'); await wait(() => document.querySelector('.tile img').src.startsWith('blob:')); document.querySelector('.tile').click(); click('Info'); clean('Vollbild mit Info');
    mount(dashboard(ctx)); clean('Dashboard'); data.setQuery('img'); mount(searchView()); expect(text()).toContain('Treffer'); clean('Suche');
  });
  it('Suchfeld: der Suchtext landet nie in der Adresszeile', async () => {
    const root = document.createElement('div'); document.body.replaceChildren(root); mountShell(root, ctx);
    const i = document.querySelector('.search input'); i.value = 'streng-geheimer-suchbegriff'; i.dispatchEvent(new Event('input', { bubbles: true }));
    expect(location.hash).toBe('#/suche'); expect(location.href).not.toContain('geheimer'); expect(data.getQuery()).toBe('streng-geheimer-suchbegriff');
  });
  it('Der gesperrte Bildschirm zeigt keinerlei Tresorinhalt', async () => {
    await seed(); const meta = createMetaStore(db); lock(); const root = document.createElement('div'); document.body.replaceChildren(root); showUnlock(root, meta, () => {});
    expect(document.querySelector('input[type=password]')).toBeTruthy(); expect(text()).not.toContain('img'); expect(text()).not.toMatch(/Passwörter|Notizen|Dokumente|Fotos/); expect(data.all()).toHaveLength(0); expect(fd.docs()).toHaveLength(0);
  });
});

describe('Löschen nur nach ausdrücklicher Bestätigung', () => {
  it('Einträge: erster Klick löscht nichts, „Abbrechen“ lässt alles, erst „Ja, löschen“ entfernt', async () => {
    for (const [spec, type] of [[passwordSpec, 'password'], [noteSpec, 'note'], [personalSpec, 'personal']]) {
      const s = await data.save({ type, title: 'Ding-' + type, content: '', custom: [], favorite: false, category: '' }); data.openItem(s); mount(entityView(spec, ctx));
      click('Löschen'); expect(data.get(s.id)).toBeTruthy(); expect(text()).toContain('endgültig löschen'); click('Abbrechen'); expect(data.get(s.id)).toBeTruthy();
      click('Löschen'); click('Ja, löschen'); await wait(() => !data.get(s.id));
    }
  });
  it('Dokumente, Ordner, Fotos und Alben ebenso', async () => {
    const folder = await fd.saveFolder({ kind: 'folder', name: 'Ordner1', parentId: null }), album = await fd.saveFolder({ kind: 'album', name: 'Album1' });
    const pdf = new Uint8Array(100); pdf.set(new TextEncoder().encode('%PDF-1.4\n')); const d = await importFile(ctx, Object.assign(new Blob([pdf]), { name: 'a.pdf' }), { kind: 'document' });
    const jpg = new Uint8Array(100); jpg.set([0xff, 0xd8, 0xff, 0xe0]); await importFile(ctx, Object.assign(new Blob([jpg]), { name: 'a.jpg' }), { kind: 'photo' });
    data.openItem({ id: d.id, type: 'document' }); mount(documentsView(ctx)); click('Löschen'); expect(fd.get(d.id)).toBeTruthy(); click('Abbrechen'); expect(fd.get(d.id)).toBeTruthy();
    click('← Zurück'); const row = [...document.querySelectorAll('.card.row3')].find((r) => r.textContent.includes('Ordner1')); [...row.querySelectorAll('button')].find((b) => b.textContent === 'Löschen').click(); expect(fd.folder(folder.id)).toBeTruthy();
    [...row.querySelectorAll('button')].find((b) => b.textContent === 'Abbrechen').click(); expect(fd.folder(folder.id)).toBeTruthy();
    mount(photosView(ctx)); await wait(() => document.querySelector('.tile')); document.querySelector('.tile').click(); click('Info'); click('Löschen'); expect(fd.photos()).toHaveLength(1); click('Abbrechen'); expect(fd.photos()).toHaveLength(1);
    click('Schließen'); click('Album1'); click('Album löschen'); expect(fd.folder(album.id)).toBeTruthy(); click('Abbrechen'); expect(fd.folder(album.id)).toBeTruthy();
  });
});
