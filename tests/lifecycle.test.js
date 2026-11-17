// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { describe, it, expect, vi } from 'vitest';
Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
vi.setConfig({ testTimeout: 120000 });
const { showSetup, showUnlock } = await import('../src/ui/gate.js');
const { entityView } = await import('../src/modules/entity-view.js');
const { documentsView } = await import('../src/modules/documents-view.js');
const { exportPanel } = await import('../src/ui/backup-view.js');
const { passwordCard } = await import('../src/ui/settings-view.js');
const { passwordSpec, noteSpec } = await import('../src/modules/specs.js');
const data = await import('../src/modules/data.js');
const fd = await import('../src/modules/filedata.js');
const { checkIntegrity } = await import('../src/core/integrity.js');
const { openDb, createMetaStore } = await import('../src/core/db/idb.js');
const { IdbBackend } = await import('../src/core/files/idb-backend.js');
const { lock, isUnlocked } = await import('../src/core/keys/session.js');

const M1 = 'Erstes-Master-Passwort!', M2 = 'Zweites-Master-Passwort!', BPW = 'Backup-Passwort-123';
const wipe = () => new Promise((res) => { const r = indexedDB.deleteDatabase('brox-vault'); r.onsuccess = r.onerror = () => res(); });
const wait = async (pred, ms = 90000) => { const t = Date.now(); while (Date.now() - t < ms) { let ok = false; try { ok = pred(); } catch { /* weiter */ } if (ok) return; await new Promise((r) => setTimeout(r, 20)); } throw new Error('Zeitüberschreitung: ' + document.body.textContent.slice(0, 300)); };
const btn = (t) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(t));
const click = (t) => { const b = btn(t); if (!b) throw new Error('Button fehlt: ' + t + ' | ' + document.body.textContent.slice(0, 200)); b.click(); };
const text = () => document.body.textContent;
const setVal = (sel, v) => { const n = document.querySelector(sel); n.value = v; n.dispatchEvent(new Event('input', { bubbles: true })); n.dispatchEvent(new Event('change', { bubbles: true })); };
const mount = (n) => { document.body.replaceChildren(n); return n; };
const upload = (files) => { const i = document.querySelector('input[type=file]'); Object.defineProperty(i, 'files', { value: files, configurable: true }); i.dispatchEvent(new Event('change')); };
const enc = (s) => new TextEncoder().encode(s);

describe('Gesamtablauf wie im echten Gebrauch (Standard-Argon2-Parameter)', () => {
  it('Einrichtung → Nutzung → Backup → Passwortwechsel → Sperre → Browser-Reset → Wiederherstellung', async () => {
    let blob; vi.stubGlobal('URL', Object.assign(URL, {}, { createObjectURL: (b) => { blob = b; return 'blob:x'; }, revokeObjectURL: () => {} }));
    // --- 1. Einrichtungsassistent
    lock(); await wipe(); let db = await openDb(); let ctx = { db, backend: new IdbBackend(db), settings: { clipboardSeconds: 30, showPasswords: false, backupReminderDays: 30, lastBackupAt: null, lastBackupTestAt: null }, info: { kind: 'idb' } };
    let root = document.createElement('div'); document.body.replaceChildren(root); let opened = 0; showSetup(root, createMetaStore(db), () => { opened++; }, ctx);
    click('Weiter'); click('Weiter'); setVal('#pw1', M1); setVal('#pw2', M1); click('Tresor erstellen'); await wait(() => text().includes('Dein Tresor ist erstellt'));
    expect(text()).toContain('Backup'); expect(btn('Tresor öffnen').disabled).toBe(true); const ok = document.querySelector('#ok'); ok.checked = true; ok.dispatchEvent(new Event('change')); click('Tresor öffnen'); expect(opened).toBe(1); expect(isUnlocked()).toBe(true);
    await data.loadAll(db); await fd.loadAll(db);
    // --- 2. Nutzung: Passwort, Notiz, Dokument
    mount(entityView(passwordSpec, ctx)); click('Neues Passwort'); setVal('#f-title', 'Bank'); setVal('#f-password', 'Sup3rGeheim!'); click('Speichern'); await wait(() => text().includes('Zuletzt geändert'));
    mount(entityView(noteSpec, ctx)); click('Neue Notiz'); setVal('#f-title', 'Idee'); setVal('#f-content', 'Der Schatz liegt unter der Eiche'); click('Speichern'); await wait(() => text().includes('Eiche'));
    mount(documentsView(ctx)); const pdf = new Uint8Array(2000); pdf.set(enc('%PDF-1.4\n')); upload([new File([pdf], 'Vertrag.pdf')]); await wait(() => text().includes('1 Datei importiert'));
    // --- 3. Backup erstellen
    mount(exportPanel(ctx)); setVal('#bp1', BPW); setVal('#bp2', BPW); click('Backup erstellen'); await wait(() => text().includes('Integrität bestätigt')); expect(ctx.settings.lastBackupAt).toBeGreaterThan(0); const backup = blob; expect(backup.size).toBeGreaterThan(2000);
    // --- 4. Master-Passwort ändern
    mount(passwordCard(ctx)); setVal('#mp0', 'falsches-Passwort-123'); setVal('#mp1', M2); setVal('#mp2', M2); click('Master-Passwort ändern'); await wait(() => text().includes('aktuelle Master-Passwort ist falsch'));
    setVal('#mp0', M1); setVal('#mp2', 'abweichend'); click('Master-Passwort ändern'); expect(text()).toContain('stimmen nicht überein'); setVal('#mp1', 'kurz'); setVal('#mp2', 'kurz'); click('Master-Passwort ändern'); expect(text()).toContain('mindestens 12');
    setVal('#mp1', M2); setVal('#mp2', M2); click('Master-Passwort ändern'); await wait(() => text().includes('wurde geändert'));
    // --- 5. Sperren und mit altem/neuem Passwort entsperren
    lock(); expect(data.all()).toHaveLength(0); root = document.createElement('div'); document.body.replaceChildren(root); let again = 0; showUnlock(root, createMetaStore(db), () => { again++; });
    setVal('#pw', M1); click('Entsperren'); await wait(() => text().includes('Falsches Passwort')); expect(again).toBe(0); setVal('#pw', M2); click('Entsperren'); await wait(() => again === 1); expect(isUnlocked()).toBe(true);
    await data.loadAll(db); await fd.loadAll(db); expect(data.all('password')[0]).toMatchObject({ title: 'Bank', password: 'Sup3rGeheim!' }); expect(data.all('note')).toHaveLength(1);
    expect(await checkIntegrity(db, ctx.backend)).toMatchObject({ ok: true, files: 1, chunks: 1 });
    // --- 6. „Browser-Reset“: alles weg, neues Gerät, Wiederherstellung aus dem Backup
    db.close(); lock(); await wipe(); db = await openDb(); ctx = { db, backend: new IdbBackend(db), settings: {}, info: { kind: 'idb' } }; expect(await createMetaStore(db).get()).toBeNull();
    root = document.createElement('div'); document.body.replaceChildren(root); let done = 0; showSetup(root, createMetaStore(db), () => { done++; }, ctx);
    click('Aus Backup wiederherstellen'); const f = document.querySelector('input[aria-label="Backup-Datei"]'); Object.defineProperty(f, 'files', { value: [new File([backup], 'BROX_VAULT.bvx')], configurable: true }); f.dispatchEvent(new Event('change'));
    await wait(() => text().includes('Dateistruktur geprüft')); setVal('#rp0', BPW); setVal('#rp1', 'Drittes-Master-Passwort!'); setVal('#rp2', 'Drittes-Master-Passwort!'); click('Wiederherstellen'); await wait(() => text().includes('Wiederherstellung abgeschlossen'));
    click('Tresor öffnen'); expect(done).toBe(1); await data.loadAll(db); await fd.loadAll(db);
    expect(data.all('password')[0]).toMatchObject({ title: 'Bank', password: 'Sup3rGeheim!' }); expect(data.all('note')[0].content).toContain('Eiche'); expect(fd.docs()[0].name).toBe('Vertrag.pdf');
    expect(await checkIntegrity(db, ctx.backend)).toMatchObject({ ok: true, files: 1 }); db.close(); vi.unstubAllGlobals();
  });
});
