// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
vi.setConfig({ testTimeout: 60000 });
const { exportPanel, verifyPanel, importPanel } = await import('../src/ui/backup-view.js');
const { showSetup } = await import('../src/ui/gate.js');
const data = await import('../src/modules/data.js');
const fd = await import('../src/modules/filedata.js');
const { importFile } = await import('../src/modules/fileops.js');
const { openDb, createMetaStore } = await import('../src/core/db/idb.js');
const { IdbBackend } = await import('../src/core/files/idb-backend.js');
const { createVault, DEFAULT_KDF } = await import('../src/core/keys/vault.js');
const { lock, isUnlocked } = await import('../src/core/keys/session.js');
const { memStore } = await import('./memstore.js');

const FAST = { m: 1024, t: 1, p: 1 }, BPW = 'backup passwort 123';
const enc = (s) => new TextEncoder().encode(s);
const PDF = () => { const u = new Uint8Array(300); u.set(enc('%PDF-1.4\n')); return u; };
const wipe = () => new Promise((res) => { const r = indexedDB.deleteDatabase('brox-vault'); r.onsuccess = r.onerror = () => res(); });
const wait = async (pred, ms = 30000) => { const t = Date.now(); while (Date.now() - t < ms) { let ok = false; try { ok = pred(); } catch { /* weiter */ } if (ok) return; await new Promise((r) => setTimeout(r, 20)); } throw new Error('Zeitüberschreitung: ' + document.body.textContent.slice(0, 400)); };
const btn = (t) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(t));
const click = (t) => { const b = btn(t); if (!b) throw new Error('Button fehlt: ' + t + ' | ' + document.body.textContent.slice(0, 300)); b.click(); };
const text = () => document.body.textContent;
const setVal = (sel, v) => { const n = document.querySelector(sel); n.value = v; n.dispatchEvent(new Event('input', { bubbles: true })); };
const pickFile = (sel, file) => { const i = document.querySelector(sel); Object.defineProperty(i, 'files', { value: [file], configurable: true }); i.dispatchEvent(new Event('change')); };

let db, ctx, blobs;
const profile = async (pw) => { lock(); await wipe(); db = await openDb(); await createVault(pw, memStore(), FAST); await data.loadAll(db); await fd.loadAll(db);
  ctx = { db, backend: new IdbBackend(db), settings: { lastBackupAt: null, lastBackupTestAt: null }, info: { kind: 'idb' } }; };
beforeEach(async () => { document.body.replaceChildren(); blobs = []; vi.stubGlobal('URL', Object.assign(URL, {}, { createObjectURL: (b) => { blobs.push(b); return 'blob:b' + blobs.length; }, revokeObjectURL: () => {} })); await profile('erstes master passwort'); });
afterEach(() => { db.close(); vi.unstubAllGlobals(); });
const seed = async () => { await data.save({ type: 'password', title: 'Bank', password: 'Sup3rGeheim!', custom: [], favorite: false, category: '' }); await importFile(ctx, Object.assign(new Blob([PDF()]), { name: 'a.pdf' }), { kind: 'document' }); };
const makeBackup = async () => { document.body.replaceChildren(exportPanel(ctx)); setVal('#bp1', BPW); setVal('#bp2', BPW); click('Backup erstellen'); await wait(() => text().includes('Integrität bestätigt')); return blobs[blobs.length - 1]; };

describe('Backup erstellen (UI)', () => {
  it('prüft Passwörter, erstellt, prüft die Datei und vermerkt das Backup erst danach', async () => {
    await seed(); document.body.replaceChildren(exportPanel(ctx));
    setVal('#bp1', 'kurz'); click('Backup erstellen'); expect(text()).toContain('mindestens 12 Zeichen'); expect(ctx.settings.lastBackupAt).toBeNull();
    setVal('#bp1', BPW); setVal('#bp2', 'anderes passwort 456'); click('Backup erstellen'); expect(text()).toContain('stimmen nicht überein');
    setVal('#bp2', BPW); click('Backup erstellen'); await wait(() => text().includes('Backup erstellt und Integrität bestätigt'));
    expect(ctx.settings.lastBackupAt).toBeGreaterThan(0); expect(text()).toContain('noch kein Wiederherstellungstest');
    const a = document.querySelector('a[download]'); expect(a.getAttribute('download')).toMatch(/^BROX_VAULT_\d{4}-\d{2}-\d{2}\.bvx$/); expect(a.getAttribute('href')).toMatch(/^blob:/);
    expect(document.querySelector('#bp1').value).toBe('');
  });
  it('bei beschädigten Daten: Fehlermeldung, kein Backup vermerkt', async () => {
    await seed(); const d = fd.docs()[0], c = await ctx.backend.getChunk(d.id, 0); c[40] ^= 1; const { idbPut } = await import('../src/core/db/idb.js'); await idbPut(db, 'chunks', [d.id, 0], c);
    document.body.replaceChildren(exportPanel(ctx)); setVal('#bp1', BPW); setVal('#bp2', BPW); click('Backup erstellen'); await wait(() => text().includes('Backup fehlgeschlagen'));
    expect(ctx.settings.lastBackupAt).toBeNull(); expect(document.querySelector('a[download]')).toBeNull();
  });
});

describe('Backup überprüfen (UI)', () => {
  it('Stufe 1, 2 (auch mit falschem Passwort) und 3; Datum erst nach der Probewiederherstellung', async () => {
    await seed(); const blob = await makeBackup(); document.body.replaceChildren(verifyPanel(ctx));
    pickFile('input[type=file]', new File([blob], 'x.bvx')); await wait(() => text().includes('Dateistruktur geprüft'));
    setVal('#vp', 'falsches passwort!!!'); click('Integrität prüfen'); await wait(() => text().includes('Falsches Backup-Passwort'));
    setVal('#vp', BPW); click('Integrität prüfen'); await wait(() => text().includes('Integrität bestätigt')); expect(ctx.settings.lastBackupTestAt).toBeNull(); expect(text()).toContain('beweist noch keine erfolgreiche Wiederherstellung');
    click('Probewiederherstellung'); await wait(() => text().includes('Wiederherstellung getestet')); expect(ctx.settings.lastBackupTestAt).toBeGreaterThan(0);
    expect((await indexedDB.databases()).filter((d) => d.name.startsWith('brox-verify'))).toEqual([]);
  });
  it('lehnt fremde Dateien ab', async () => {
    document.body.replaceChildren(verifyPanel(ctx)); pickFile('input[type=file]', new File([enc('das ist kein backup, nur text')], 'x.bvx'));
    await wait(() => text().includes('keine BROX-VAULT-Backupdatei')); expect(btn('Integrität prüfen').closest('div[hidden]')).not.toBeNull();
  });
});

describe('Backup importieren (UI)', () => {
  it('zeigt Vorschau mit Konflikten; „behalten“ ändert nichts, „überschreiben“ erst nach Bestätigung', async () => {
    await seed(); const blob = await makeBackup(); const e = data.all('password')[0]; await data.save({ ...e, password: 'LOKAL-neu' });
    document.body.replaceChildren(importPanel(ctx)); pickFile('input[type=file]', new File([blob], 'x.bvx')); await wait(() => text().includes('Format 1'));
    setVal('#ip', BPW); click('Backup prüfen'); await wait(() => text().includes('Backup ist in Ordnung')); expect(text()).toContain('1 abweichend'); expect(data.all('password')[0].password).toBe('LOKAL-neu');
    click('Wiederherstellen'); await wait(() => text().includes('Wiederherstellung abgeschlossen')); expect(text()).toContain('unverändert gelassen'); expect(data.all('password')[0].password).toBe('LOKAL-neu');
    setVal('#ip', BPW); click('Backup prüfen'); await wait(() => text().includes('Backup ist in Ordnung'));
    const ow = document.querySelector('input[value=overwrite]'); ow.checked = true; ow.dispatchEvent(new Event('change')); expect(btn('Wiederherstellen').disabled).toBe(true);
    const ok = document.querySelector('#ow'); ok.checked = true; ok.dispatchEvent(new Event('change')); expect(btn('Wiederherstellen').disabled).toBe(false);
    click('Wiederherstellen'); await wait(() => text().includes('Wiederherstellung abgeschlossen')); expect(text()).toContain('1 ersetzt'); expect(data.all('password')[0].password).toBe('Sup3rGeheim!');
  });
  it('falsches Passwort: klare Meldung, nichts verändert', async () => {
    await seed(); const blob = await makeBackup(); document.body.replaceChildren(importPanel(ctx)); pickFile('input[type=file]', new File([blob], 'x.bvx')); await wait(() => text().includes('Format 1'));
    setVal('#ip', 'falsches passwort!!!'); click('Backup prüfen'); await wait(() => text().includes('Falsches Backup-Passwort')); expect(btn('Wiederherstellen')).toBeUndefined();
  });
});

describe('Wiederherstellung auf einem neuen Gerät (Einrichtungsassistent)', () => {
  it('prüft zuerst, legt dann den Tresor an und spielt alles ein; falsches Passwort legt keinen Tresor an', async () => {
    await seed(); const blob = await makeBackup();
    db.close(); lock(); await wipe(); db = await openDb(); ctx = { db, backend: new IdbBackend(db), settings: {}, info: { kind: 'idb' } }; await data.loadAll(db).catch(() => {});
    const store = createMetaStore(db), root = document.createElement('div'); document.body.replaceChildren(root); let done = 0; showSetup(root, store, () => { done++; }, ctx);
    click('Aus Backup wiederherstellen'); pickFile('input[aria-label="Backup-Datei"]', new File([blob], 'x.bvx')); await wait(() => text().includes('Dateistruktur geprüft'));
    setVal('#rp0', 'falsches passwort!!!'); setVal('#rp1', 'neues langes master 1'); setVal('#rp2', 'neues langes master 1'); click('Wiederherstellen');
    await wait(() => text().includes('Falsches Backup-Passwort')); expect(await store.get()).toBeNull(); expect(isUnlocked()).toBe(false);
    setVal('#rp0', BPW); setVal('#rp2', 'anders'); click('Wiederherstellen'); expect(text()).toContain('stimmen nicht überein'); expect(await store.get()).toBeNull();
    setVal('#rp2', 'neues langes master 1'); click('Wiederherstellen'); await wait(() => text().includes('Wiederherstellung abgeschlossen'), 60000);
    expect(isUnlocked()).toBe(true); await data.loadAll(db); await fd.loadAll(db); expect(data.all('password')[0]).toMatchObject({ title: 'Bank', password: 'Sup3rGeheim!' }); expect(fd.docs()[0].name).toBe('a.pdf');
    click('Tresor öffnen'); expect(done).toBe(1); void DEFAULT_KDF;
  });
});
