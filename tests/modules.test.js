import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { generatePassword, randomInt, entropyBits } from '../src/modules/generator.js';
import { copySecret } from '../src/modules/clipboard.js';
import * as data from '../src/modules/data.js';
import { estimateBits } from '../src/core/strength.js';
import { openDb, idbGet, idbPut } from '../src/core/db/idb.js';
import { createVault } from '../src/core/keys/vault.js';
import { lock } from '../src/core/keys/session.js';
import { memStore } from './memstore.js';

describe('Passwortgenerator', () => {
  it('randomInt ist gleichmäßig verteilt (Chi-Quadrat, n=7, 70.000 Züge)', () => {
    const c = new Array(7).fill(0); for (let i = 0; i < 70000; i++) c[randomInt(7)]++;
    expect(c.reduce((s, x) => s + (x - 10000) ** 2 / 10000, 0)).toBeLessThan(30); // 6 Freiheitsgrade; Zufallstest, kein Beweis
  });
  it('randomInt lehnt ungültige Bereiche ab', () => { expect(() => randomInt(0)).toThrow(); });
  it('liefert gewünschte Länge, nur erlaubte Zeichen und jede gewählte Gruppe', () => {
    for (const length of [8, 20, 64, 128]) {
      const p = generatePassword({ length, lower: true, upper: false, digits: true, symbols: false });
      expect(p).toHaveLength(length); expect(p).toMatch(/^[a-z0-9]+$/); expect(/[a-z]/.test(p) && /\d/.test(p)).toBe(true);
    }
    for (let i = 0; i < 200; i++) { const p = generatePassword({ length: 8 }); expect(/[a-z]/.test(p) && /[A-Z]/.test(p) && /\d/.test(p) && /[^A-Za-z0-9]/.test(p)).toBe(true); }
  });
  it('weist ungültige Einstellungen zurück', () => {
    expect(() => generatePassword({ lower: false, upper: false, digits: false, symbols: false })).toThrow();
    expect(() => generatePassword({ length: 129 })).toThrow(); expect(() => generatePassword({ length: 2 })).toThrow();
  });
  it('erzeugt keine Wiederholungen (500 Passwörter) und schätzt die Stärke plausibel', () => {
    expect(new Set(Array.from({ length: 500 }, () => generatePassword())).size).toBe(500);
    expect(entropyBits({ length: 20, lower: true, upper: true, digits: true, symbols: true })).toBeGreaterThan(110);
    expect(estimateBits('abc')).toBeLessThan(estimateBits('Abcdefgh1234!xyz'));
  });
});

describe('Zwischenablage', () => {
  let writes;
  beforeEach(() => { vi.useFakeTimers(); writes = []; vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn(async (t) => { writes.push(t); }) } }); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); lock(); });
  it('leert nach Ablauf der Zeit', async () => {
    await copySecret('geheim', 30); expect(writes).toEqual(['geheim']);
    await vi.advanceTimersByTimeAsync(29000); expect(writes).toEqual(['geheim']);
    await vi.advanceTimersByTimeAsync(2000); expect(writes).toEqual(['geheim', '']);
  });
  it('leert nicht automatisch, wenn deaktiviert (0 Sekunden)', async () => {
    await copySecret('x', 0); await vi.advanceTimersByTimeAsync(120000); expect(writes).toEqual(['x']);
  });
  it('leert sofort beim Sperren', async () => {
    await createVault('ein sehr langes passwort', memStore(), { m: 1024, t: 1, p: 1 });
    await copySecret('geheim', 60); lock(); expect(writes).toEqual(['geheim', '']);
  });
});

describe('Datenschicht (verschlüsselt, Suche nur über nicht geheime Felder)', () => {
  let db;
  const wipe = () => new Promise((res) => { const r = indexedDB.deleteDatabase('brox-vault'); r.onsuccess = r.onerror = () => res(); });
  beforeEach(async () => { lock(); await wipe(); db = await openDb(); await createVault('ein sehr langes passwort', memStore(), { m: 1024, t: 1, p: 1 }); await data.loadAll(db); });
  afterEach(() => { db.close(); });
  const pw = (o = {}) => ({ type: 'password', title: 'Bank', website: 'https://bank.example', username: 'anna', password: 'Sup3rGeheim!', pin: '4711', category: 'Finanzen', favorite: false, custom: [{ name: 'Kundennummer', value: '12345', secret: false }, { name: 'Token', value: 'tok-abc', secret: true }], ...o });

  it('speichert verschlüsselt und liest wieder', async () => {
    const s = await data.save(pw());
    expect(data.get(s.id)).toMatchObject({ title: 'Bank', password: 'Sup3rGeheim!' });
    const raw = await idbGet(db, 'entries', s.id);
    expect(Buffer.from(raw.env).toString('latin1')).not.toContain('Sup3rGeheim');
    await data.loadAll(db); expect(data.get(s.id).pin).toBe('4711');
  });
  it('Aktualisieren behält createdAt, Löschen entfernt den Eintrag', async () => {
    const s = await data.save(pw()), s2 = await data.save({ ...s, title: 'Bank neu' });
    expect(s2.createdAt).toBe(s.createdAt); expect(s2.updatedAt).toBeGreaterThanOrEqual(s.updatedAt); expect(data.all()).toHaveLength(1);
    await data.remove(s.id); expect(data.all()).toHaveLength(0); expect(await idbGet(db, 'entries', s.id)).toBeUndefined();
  });
  it('findet über Titel, Benutzername, Webseite, Kategorie und nicht geheime Zusatzfelder', async () => {
    await data.save(pw()); await data.save({ type: 'note', title: 'Einkauf', content: 'Milch und Brot', category: '', favorite: false });
    for (const q of ['bank', 'ANNA', 'bank.example', 'finanzen', 'kundennummer', '12345', 'bank anna']) expect(data.search(q), q).toHaveLength(1);
    expect(data.search('milch')[0].type).toBe('note');
  });
  it('durchsucht niemals Passwörter, PINs oder geheime Zusatzfelder', async () => {
    await data.save(pw());
    for (const q of ['Sup3rGeheim', '4711', 'tok-abc']) expect(data.search(q), q).toHaveLength(0);
    expect(data.searchText(data.all()[0])).not.toContain('sup3rgeheim');
  });
  it('Sperren verwirft alle entschlüsselten Einträge', async () => {
    await data.save(pw()); data.setQuery('bank'); lock();
    expect(data.all()).toHaveLength(0); expect(data.getQuery()).toBe('');
  });
  it('zählt beschädigte Datensätze und lädt den Rest weiter', async () => {
    const a = await data.save(pw()), b = await data.save(pw({ title: 'Zweiter' }));
    const raw = await idbGet(db, 'entries', a.id); raw.env[20] ^= 1; await idbPut(db, 'entries', a.id, raw);
    await data.loadAll(db);
    expect(data.corrupt).toEqual([a.id]); expect(data.get(b.id).title).toBe('Zweiter'); expect(data.get(a.id)).toBeUndefined();
  });
});
