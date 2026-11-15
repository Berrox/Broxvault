// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
const { documentsView } = await import('../src/modules/documents-view.js');
const { photosView } = await import('../src/modules/photos-view.js');
const { searchView } = await import('../src/modules/search-view.js');
const { dashboard } = await import('../src/modules/dashboard.js');
const data = await import('../src/modules/data.js');
const fd = await import('../src/modules/filedata.js');
const { importFile } = await import('../src/modules/fileops.js');
const { openDb, idbPut } = await import('../src/core/db/idb.js');
const { IdbBackend } = await import('../src/core/files/idb-backend.js');
const { createVault } = await import('../src/core/keys/vault.js');
const { lock, onLockChange } = await import('../src/core/keys/session.js');
const { startAutoLock, stopAutoLock, holdHideLock } = await import('../src/core/autolock.js');
const { memStore } = await import('./memstore.js');

const enc = (s) => new TextEncoder().encode(s);
const PDF = () => { const u = new Uint8Array(200); u.set(enc('%PDF-1.4\n')); return u; };
const JPG = (k = 0) => { const u = new Uint8Array(200); u.set([0xff, 0xd8, 0xff, 0xe0]); u[10] = k; return u; };
const F = (name, bytes) => new File([bytes], name);
const wipe = () => new Promise((res) => { const r = indexedDB.deleteDatabase('brox-vault'); r.onsuccess = r.onerror = () => res(); });
const wait = async (pred, ms = 4000) => { const t = Date.now(); while (Date.now() - t < ms) { let ok = false; try { ok = pred(); } catch { /* weiter warten */ } if (ok) return; await new Promise((r) => setTimeout(r, 10)); } throw new Error('Zeitüberschreitung: ' + document.body.textContent.slice(0, 300)); };
const btn = (t) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(t));
const click = (t) => { const b = btn(t); if (!b) throw new Error('Button fehlt: ' + t + ' | ' + document.body.textContent.slice(0, 200)); b.click(); };
const text = () => document.body.textContent;
const mount = (n) => { document.body.replaceChildren(n); return n; };
const upload = (files) => { const i = document.querySelector('input[type=file]'); Object.defineProperty(i, 'files', { value: files, configurable: true }); i.dispatchEvent(new Event('change')); };
const setVal = (sel, v, ev = 'input') => { const n = document.querySelector(sel); n.value = v; n.dispatchEvent(new Event(ev, { bubbles: true })); };

let db, ctx, n, rev;
beforeEach(async () => {
  lock(); await wipe(); document.body.replaceChildren(); db = await openDb(); n = 0; rev = vi.fn();
  vi.stubGlobal('URL', Object.assign(URL, {}, { createObjectURL: () => 'blob:test-' + ++n, revokeObjectURL: rev }));
  await createVault('ein sehr langes passwort', memStore(), { m: 1024, t: 1, p: 1 }); await data.loadAll(db); await fd.loadAll(db);
  ctx = { db, backend: new IdbBackend(db), thumbMaker: async () => ({ bytes: new Uint8Array([9, 9, 9]), width: 800, height: 600 }), settings: { clipboardSeconds: 30, showPasswords: false, backupReminderDays: 30, lastBackupAt: null }, info: { kind: 'idb' } };
});
afterEach(() => { db.close(); vi.unstubAllGlobals(); stopAutoLock(); });

describe('Dokumentenarchiv (UI)', () => {
  it('importiert, zeigt Ansichten (PDF, Text, Bild), benennt um, verschiebt und löscht', async () => {
    mount(documentsView(ctx)); expect(text()).toContain('Hier ist noch nichts');
    upload([F('Vertrag.pdf', PDF()), F('Notiz.txt', enc('Hallo Archiv')), F('Scan.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]))]);
    await wait(() => text().includes('3 Dateien importiert'));
    for (const nme of ['Vertrag.pdf', 'Notiz.txt', 'Scan.png']) expect(text()).toContain(nme);
    [...document.querySelectorAll('.rowmain')].find((b) => b.textContent.includes('Vertrag.pdf')).click();
    await wait(() => document.querySelector('.viewer iframe')); expect(document.querySelector('iframe').src).toContain('blob:test-');
    click('← Zurück'); expect(rev).toHaveBeenCalled(); // Blob-URL wurde widerrufen
    [...document.querySelectorAll('.rowmain')].find((b) => b.textContent.includes('Notiz.txt')).click(); await wait(() => document.querySelector('pre.txt')); expect(document.querySelector('pre.txt').textContent).toBe('Hallo Archiv');
    click('← Zurück'); [...document.querySelectorAll('.rowmain')].find((b) => b.textContent.includes('Scan.png')).click(); await wait(() => document.querySelector('.viewer img'));
    click('Umbenennen'); setVal('input[aria-label="Dateiname"]', 'Scan neu.png'); document.querySelector('.pw .btn.primary').click(); await wait(() => text().includes('Scan neu.png'));
    click('Löschen'); expect(text()).toContain('endgültig löschen'); click('Abbrechen'); expect(fd.docs()).toHaveLength(3);
    click('Löschen'); click('Ja, löschen'); await wait(() => fd.docs().length === 2); expect(text()).not.toContain('Scan neu.png');
  });
  it('legt Ordner an, navigiert, verschiebt Dateien und verweigert das Löschen nichtleerer Ordner', async () => {
    mount(documentsView(ctx)); click('Neuer Ordner'); setVal('input[aria-label="Ordnername"]', 'Steuer'); click('Speichern'); await wait(() => text().includes('📁 Steuer'));
    upload([F('a.pdf', PDF())]); await wait(() => text().includes('1 Datei importiert'));
    [...document.querySelectorAll('.rowmain')].find((b) => b.textContent.includes('a.pdf')).click();
    await wait(() => document.querySelector('select[aria-label="Verschieben nach"]'));
    const sel = document.querySelector('select[aria-label="Verschieben nach"]'); sel.value = fd.listFolders('folder')[0].id; sel.dispatchEvent(new Event('change'));
    await wait(() => fd.docs()[0].folderId); click('← Zurück'); expect(text()).not.toContain('a.pdf');
    click('Löschen'); click('Ja'); await wait(() => text().includes('nicht leer')); expect(fd.listFolders('folder')).toHaveLength(1);
    click('Umbenennen'); setVal('input[aria-label="Ordnername"]', 'Steuer 2024'); click('Speichern'); await wait(() => text().includes('Steuer 2024'));
    [...document.querySelectorAll('.rowmain')].find((b) => b.textContent.includes('Steuer 2024')).click(); await wait(() => text().includes('a.pdf'));
  });
  it('meldet abgelehnte Dateien und importiert die übrigen', async () => {
    mount(documentsView(ctx)); upload([F('ok.pdf', PDF()), F('virus.pdf', enc('MZ\x90\x00')), F('x.exe', enc('abc'))]);
    await wait(() => text().includes('1 Datei importiert')); expect(text()).toContain('virus.pdf: Dateityp nicht unterstützt'); expect(text()).toContain('x.exe'); expect(fd.docs()).toHaveLength(1);
  });
  it('zeigt bei manipulierten Daten eine Fehlermeldung statt Inhalt', async () => {
    const m = await importFile(ctx, F('a.pdf', PDF()), { kind: 'document' }); const c = await ctx.backend.getChunk(m.id, 0); c[40] ^= 1; await idbPut(db, 'chunks', [m.id, 0], c);
    data.openItem({ id: m.id, type: 'document' }); mount(documentsView(ctx)); await wait(() => text().includes('Entschlüsselung fehlgeschlagen')); expect(document.querySelector('iframe')).toBeNull();
  });
  it('Dateinamen mit HTML werden nur als Text dargestellt', async () => {
    await importFile(ctx, F('<img src=x onerror="window.pwn=1">.txt', enc('x')), { kind: 'document' }); mount(documentsView(ctx));
    expect(document.querySelector('img')).toBeNull(); expect(window.pwn).toBeUndefined(); expect(text()).toContain('<img src=x');
  });
});

describe('Fotoarchiv (UI)', () => {
  it('Galerie, Vollbild mit Blättern, Info, Album, Favorit und Löschen', async () => {
    mount(photosView(ctx)); expect(text()).toContain('Noch keine Fotos');
    upload([F('eins.jpg', JPG(1)), F('zwei.jpg', JPG(2))]); await wait(() => text().includes('2 Fotos importiert'));
    expect(document.querySelectorAll('.tile')).toHaveLength(2); await wait(() => [...document.querySelectorAll('.tile img')].every((i) => i.src.startsWith('blob:')));
    document.querySelector('.tile').click(); await wait(() => document.querySelector('.overlay img').src.startsWith('blob:'));
    const first = document.querySelector('.ovbar b').textContent; click('›'); await wait(() => document.querySelector('.ovbar b').textContent !== first);
    click('Info'); expect(text()).toContain('800 × 600 px');
    click('☆ Als Favorit'); await wait(() => fd.photos().some((p) => p.favorite)); expect(text()).toContain('★ Favorit entfernen');
    click('Schließen'); expect(document.querySelector('.overlay')).toBeNull(); expect(document.querySelectorAll('.tilestar')).toHaveLength(1);
    click('Neues Album'); setVal('input[aria-label="Albumname"]', 'Urlaub'); click('Speichern'); await wait(() => fd.listFolders('album').length === 1);
    click('Alle'); document.querySelector('.tile').click(); await wait(() => document.querySelector('.overlay')); click('Info');
    const sel = document.querySelector('select[aria-label="Album"]'); sel.value = fd.listFolders('album')[0].id; sel.dispatchEvent(new Event('change')); await wait(() => fd.photos().some((p) => p.albumId));
    click('Schließen'); click('Ohne Album'); expect(document.querySelectorAll('.tile')).toHaveLength(1); click('Urlaub'); expect(document.querySelectorAll('.tile')).toHaveLength(1);
    document.querySelector('.tile').click(); await wait(() => document.querySelector('.overlay')); click('Info'); click('Löschen'); expect(text()).toContain('endgültig löschen'); click('Ja, löschen');
    await wait(() => fd.photos().length === 1); expect(document.querySelector('.overlay')).toBeNull();
    click('Album löschen'); click('Ja, Album löschen'); await wait(() => fd.listFolders('album').length === 0); expect(fd.photos()).toHaveLength(1);
  });
  it('Escape schließt das Vollbild und widerruft das Bild', async () => {
    await importFile(ctx, F('a.jpg', JPG()), { kind: 'photo' }); mount(photosView(ctx)); document.querySelector('.tile').click(); await wait(() => document.querySelector('.overlay img').src.startsWith('blob:'));
    rev.mockClear(); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); expect(document.querySelector('.overlay')).toBeNull(); expect(rev).toHaveBeenCalled();
  });
  it('beschädigte Fotos werden markiert, ohne die Galerie zu stören', async () => {
    const m = await importFile(ctx, F('a.jpg', JPG()), { kind: 'photo' }); await importFile(ctx, F('b.jpg', JPG(5)), { kind: 'photo' });
    const t = fd.get(m.thumbId), c = await ctx.backend.getChunk(t.id, 0); c[30] ^= 1; await idbPut(db, 'chunks', [t.id, 0], c);
    mount(photosView(ctx)); await wait(() => document.querySelectorAll('.tile.broken').length === 1); expect(document.querySelectorAll('.tile')).toHaveLength(2);
  });
  it('lehnt Nicht-Fotos in der Galerie ab', async () => {
    mount(photosView(ctx)); upload([F('a.pdf', PDF())]); await wait(() => text().includes('0 Fotos importiert')); expect(text()).toContain('JPG, PNG oder WEBP');
  });
});

describe('Suche, Dashboard und Sperre', () => {
  it('globale Suche findet Dateien, Dashboard zählt sie, Suche führt zur Datei', async () => {
    const d = await importFile(ctx, F('Mietvertrag.pdf', PDF()), { kind: 'document' }); await importFile(ctx, F('a.jpg', JPG()), { kind: 'photo' });
    data.setQuery('miet'); mount(searchView()); expect(text()).toContain('1 Treffer'); expect(text()).toContain('Dokument');
    document.querySelector('.rowmain').click(); expect(location.hash).toBe('#/dokumente'); mount(documentsView(ctx)); await wait(() => text().includes('Typ') && text().includes('application/pdf')); void d;
    mount(dashboard(ctx)); const s = [...document.querySelectorAll('.stat')].map((x) => x.textContent); expect(s.some((t) => t.startsWith('1Dokumente'))).toBe(true); expect(s.some((t) => t.startsWith('1Fotos'))).toBe(true);
  });
  it('Sperren beim Verlassen: normal sofort, beim Dateidialog kurz zurückgehalten', async () => {
    const hidden = () => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); };
    const states = []; const off = onLockChange((u) => states.push(u));
    startAutoLock({ lockMinutes: 5, lockOnHide: true }); holdHideLock(60000); hidden(); expect(states).toEqual([]);
    holdHideLock(-1); hidden(); expect(states).toEqual([false]); off();
  });
  it('Sperren entfernt entschlüsselte Blob-URLs', async () => {
    await importFile(ctx, F('a.jpg', JPG()), { kind: 'photo' }); mount(photosView(ctx)); await wait(() => [...document.querySelectorAll('.tile img')].every((i) => i.src.startsWith('blob:')));
    rev.mockClear(); lock(); expect(rev).toHaveBeenCalled();
  });
});
