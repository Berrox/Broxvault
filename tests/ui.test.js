// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
const { entityView } = await import('../src/modules/entity-view.js');
const { dashboard } = await import('../src/modules/dashboard.js');
const { searchView } = await import('../src/modules/search-view.js');
const { passwordSpec, noteSpec, personalSpec } = await import('../src/modules/specs.js');
const data = await import('../src/modules/data.js');
const { openDb } = await import('../src/core/db/idb.js');
const { createVault } = await import('../src/core/keys/vault.js');
const { lock } = await import('../src/core/keys/session.js');
const { memStore } = await import('./memstore.js');

let db, ctx;
const wipe = () => new Promise((res) => { const r = indexedDB.deleteDatabase('brox-vault'); r.onsuccess = r.onerror = () => res(); });
const wait = async (pred, ms = 3000) => { const t = Date.now(); while (Date.now() - t < ms) { if (pred()) return; await new Promise((r) => setTimeout(r, 10)); } throw new Error('Zeitüberschreitung: ' + document.body.textContent.slice(0, 200)); };
const btn = (txt) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(txt));
const click = (txt) => { const b = btn(txt); if (!b) throw new Error('Button fehlt: ' + txt); b.click(); };
const set = (sel, v) => { const n = document.querySelector(sel); n.value = v; n.dispatchEvent(new Event('input', { bubbles: true })); n.dispatchEvent(new Event('change', { bubbles: true })); };
const mount = (node) => { document.body.replaceChildren(node); return node; };
const text = () => document.body.textContent;

beforeEach(async () => {
  lock(); await wipe(); document.body.replaceChildren(); db = await openDb();
  await createVault('ein sehr langes passwort', memStore(), { m: 1024, t: 1, p: 1 }); await data.loadAll(db);
  ctx = { db, settings: { clipboardSeconds: 30, showPasswords: false, backupReminderDays: 30, lastBackupAt: null, lastBackupTestAt: null }, info: { kind: 'idb' } };
});
afterEach(() => { db.close(); });

describe('Passwortmanager (UI)', () => {
  it('Eintrag anlegen, anzeigen (verborgen/sichtbar), bearbeiten und löschen', async () => {
    mount(entityView(passwordSpec, ctx)); expect(text()).toContain('Noch nichts gespeichert');
    click('Neues Passwort'); set('#f-title', 'Bank'); set('#f-username', 'anna'); set('#f-password', 'Sup3rGeheim!'); set('#f-cat', 'Finanzen'); click('Speichern');
    await wait(() => text().includes('Zuletzt geändert'));
    expect(text()).toContain('Benutzername'); expect(text()).toContain('••••••••'); expect(text()).not.toContain('Sup3rGeheim');
    click('Anzeigen'); expect(text()).toContain('Sup3rGeheim!');
    click('Bearbeiten'); set('#f-title', 'Bank 2'); click('Speichern'); await wait(() => text().includes('Bank 2'));
    click('← Zurück'); expect(text()).toContain('Bank 2'); expect(text()).toContain('Finanzen');
    document.querySelector('.rowmain').click(); click('Löschen'); expect(text()).toContain('endgültig löschen'); click('Ja, löschen');
    await wait(() => text().includes('Noch nichts gespeichert')); expect(data.all()).toHaveLength(0);
  });
  it('verlangt einen Titel und speichert dann nichts', async () => {
    mount(entityView(passwordSpec, ctx)); click('Neues Passwort'); click('Speichern');
    expect(text()).toContain('Bitte gib einen Titel ein'); expect(data.all()).toHaveLength(0);
  });
  it('Abbrechen beim Löschen lässt den Eintrag bestehen', async () => {
    const s = await data.save({ type: 'password', title: 'Mail', custom: [], favorite: false, category: '' });
    data.openItem(s); mount(entityView(passwordSpec, ctx)); click('Löschen'); click('Abbrechen');
    expect(btn('Löschen')).toBeTruthy(); expect(data.get(s.id)).toBeTruthy();
  });
  it('Favorit lässt sich umschalten und wird gespeichert', async () => {
    const s = await data.save({ type: 'password', title: 'Mail', custom: [], favorite: false, category: '' });
    mount(entityView(passwordSpec, ctx)); document.querySelector('.star').click(); await wait(() => data.get(s.id).favorite === true);
    expect(document.querySelector('.star').textContent).toBe('★');
  });
  it('Eigene Felder inklusive „geheim“ werden gespeichert und verborgen', async () => {
    mount(entityView(passwordSpec, ctx)); click('Neues Passwort'); set('#f-title', 'Server'); click('Feld hinzufügen');
    set('input[aria-label="Feldname"]', 'API-Key'); set('input[aria-label="Wert"]', 'key-123');
    const secret = document.querySelector('.card.field input[type=checkbox]'); secret.checked = true; secret.dispatchEvent(new Event('change', { bubbles: true }));
    click('Speichern'); await wait(() => text().includes('API-Key'));
    expect(text()).not.toContain('key-123'); expect(data.all()[0].custom).toEqual([{ name: 'API-Key', value: 'key-123', secret: true }]);
  });
  it('Generator übernimmt ein Passwort ins Feld', async () => {
    mount(entityView(passwordSpec, ctx)); click('Neues Passwort'); click('Passwort generieren');
    expect(document.querySelector('.gen-out').textContent).toHaveLength(20); const p = document.querySelector('.gen-out').textContent; click('Übernehmen');
    expect(document.querySelector('#f-password').value).toBe(p);
  });
});

describe('Sicherheit der Darstellung', () => {
  it('rendert HTML in Titeln und Notizen als Text (kein XSS)', async () => {
    await data.save({ type: 'note', title: '<img src=x onerror="window.pwn=1">', content: '<script>window.pwn=2</script>', custom: [], favorite: false, category: '' });
    mount(entityView(noteSpec, ctx)); expect(document.querySelector('img')).toBeNull(); document.querySelector('.rowmain').click();
    expect(document.querySelector('script')).toBeNull(); expect(text()).toContain('<script>window.pwn=2</script>'); expect(window.pwn).toBeUndefined();
  });
  it('macht nur http(s)-Adressen zu Links', async () => {
    const a = await data.save({ type: 'password', title: 'A', website: 'javascript:alert(1)', custom: [], favorite: false, category: '' });
    const b = await data.save({ type: 'password', title: 'B', website: 'https://example.org', custom: [], favorite: false, category: '' });
    data.openItem(a); mount(entityView(passwordSpec, ctx)); expect(document.querySelector('.kvs a')).toBeNull();
    data.openItem(b); mount(entityView(passwordSpec, ctx)); const l = document.querySelector('.kvs a'); expect(l.rel).toContain('noopener'); expect(l.href).toBe('https://example.org/');
  });
});

describe('Notizen und persönliche Daten (UI)', () => {
  it('Notiz anlegen', async () => {
    mount(entityView(noteSpec, ctx)); click('Neue Notiz'); set('#f-title', 'Idee'); set('#f-content', 'Zeile 1\nZeile 2'); click('Speichern');
    await wait(() => text().includes('Zeile 1')); expect(data.all('note')[0].content).toBe('Zeile 1\nZeile 2');
  });
  it('Vorlage „WLAN“ legt Felder an, Passwortfeld ist geheim', async () => {
    mount(entityView(personalSpec, ctx)); click('Neuer Eintrag'); set('#f-title', 'Zuhause'); set('#f-tpl', 'WLAN');
    const names = [...document.querySelectorAll('input[aria-label="Feldname"]')].map((i) => i.value); expect(names).toContain('Netzwerkname'); expect(names).toContain('Passwort');
    const vals = document.querySelectorAll('input[aria-label="Wert"]'); vals[0].value = 'FritzBox'; vals[0].dispatchEvent(new Event('input')); vals[1].value = 'wlan-geheim'; vals[1].dispatchEvent(new Event('input'));
    click('Speichern'); await wait(() => text().includes('FritzBox'));
    expect(text()).not.toContain('wlan-geheim'); expect(data.all('personal')[0]).toMatchObject({ category: 'WLAN' });
  });
});

describe('Dashboard und Suche', () => {
  it('zeigt Zähler, Favoriten, Backup-Warnung und führt zum Eintrag', async () => {
    const s = await data.save({ type: 'password', title: 'Bank', custom: [], favorite: true, category: '' }); await data.save({ type: 'note', title: 'N', content: '', custom: [], favorite: false, category: '' });
    mount(dashboard(ctx)); const stats = [...document.querySelectorAll('.stat')].map((n) => n.textContent);
    expect(stats.some((t) => t.startsWith('1Passwörter'))).toBe(true); expect(stats.some((t) => t.startsWith('1Notizen'))).toBe(true);
    expect(text()).toContain('noch kein Backup'); expect(document.querySelectorAll('.rowmain').length).toBeGreaterThanOrEqual(2);
    document.querySelector('.rowmain').click(); expect(location.hash).toMatch(/#\/(passwoerter|notizen)/); expect(data.takeIntent().open).toBeTruthy(); void s;
  });
  it('meldet beschädigte Einträge auf dem Dashboard', async () => {
    data.corrupt.push('x'); mount(dashboard(ctx)); expect(text()).toContain('konnten nicht gelesen werden');
  });
  it('Suche findet Treffer, aber keine geheimen Werte', async () => {
    await data.save({ type: 'password', title: 'Bank', username: 'anna', password: 'Sup3rGeheim!', custom: [], favorite: false, category: '' });
    data.setQuery('anna'); mount(searchView()); expect(text()).toContain('1 Treffer'); expect(text()).toContain('Bank');
    data.setQuery('Sup3rGeheim'); mount(searchView()); expect(text()).toContain('0 Treffer');
  });
});
