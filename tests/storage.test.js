import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { openDb, migrations, idbPut, idbGet, idbAdd, idbRun } from '../src/core/db/idb.js';
import { putRecord, getRecord, listIds } from '../src/core/db/records.js';
import { IdbBackend } from '../src/core/files/idb-backend.js';
import { openBackend } from '../src/core/files/choose.js';
import { writeChunks, openChunk, sealChunk } from '../src/core/files/chunks.js';
import { checkIntegrity } from '../src/core/integrity.js';
import { storageStatus } from '../src/core/storage-status.js';
import { createVault } from '../src/core/keys/vault.js';
import { lock, fileKey } from '../src/core/keys/session.js';
import { memStore } from './memstore.js';

const FAST = { m: 1024, t: 1, p: 1 }, PW = 'ein sehr langes passwort';
const wipe = () => new Promise((res) => { const r = indexedDB.deleteDatabase('brox-vault'); r.onsuccess = r.onerror = () => res(); });
let db;
beforeEach(async () => { lock(); await wipe(); db = await openDb(); await createVault(PW, memStore(), FAST); });
afterEach(() => { db.close(); });
const rnd = (n) => { const u = new Uint8Array(n); for (let i = 0; i < n; i += 65536) crypto.getRandomValues(u.subarray(i, Math.min(n, i + 65536))); return u; };

describe('Migrationen', () => {
  it('Upgrade v1 → v2 behält vorhandene Daten und legt neue Stores an', async () => {
    db.close(); await wipe();
    const v1 = await new Promise((res) => { const r = indexedDB.open('brox-vault', 1); r.onupgradeneeded = () => migrations[0](r.result); r.onsuccess = () => res(r.result); });
    await idbPut(v1, 'vault_meta', 'vault', { formatVersion: 1, wrappedVK: 'x' }); v1.close();
    db = await openDb();
    expect(await idbGet(db, 'vault_meta', 'vault')).toEqual({ formatVersion: 1, wrappedVK: 'x' });
    expect([...db.objectStoreNames].sort()).toEqual(['categories', 'chunks', 'entries', 'files', 'settings', 'vault_meta']);
  });
  it('fehlgeschlagene Migration lässt Datenbank und Daten unverändert', async () => {
    db.close(); await wipe();
    const v1 = await openDb('brox-vault', [migrations[0]]);
    await idbPut(v1, 'vault_meta', 'vault', { a: 1 }); v1.close();
    await expect(openDb('brox-vault', [migrations[0], () => { throw new Error('kaputt'); }])).rejects.toThrow();
    const again = await openDb('brox-vault', [migrations[0]]);
    expect(again.version).toBe(1); expect(await idbGet(again, 'vault_meta', 'vault')).toEqual({ a: 1 }); again.close();
    db = await openDb();
  });
  it('ältere App öffnet keine neuere Datenbank und verändert sie nicht', async () => {
    db.close(); await wipe();
    const newer = await openDb('brox-vault', [...migrations, () => {}]); await idbPut(newer, 'vault_meta', 'vault', { a: 1 }); newer.close();
    await expect(openDb()).rejects.toBeTruthy();
    const check = await openDb('brox-vault', [...migrations, () => {}]);
    expect(check.version).toBe(3); expect(await idbGet(check, 'vault_meta', 'vault')).toEqual({ a: 1 }); check.close();
    db = await openDb('brox-vault', [...migrations, () => {}]);
  });
  it('idbAdd überschreibt keinen vorhandenen Eintrag', async () => {
    await idbAdd(db, 'vault_meta', 'k', 1);
    await expect(idbAdd(db, 'vault_meta', 'k', 2)).rejects.toBeTruthy();
    expect(await idbGet(db, 'vault_meta', 'k')).toBe(1);
  });
});

describe('Verschlüsselte Datensätze (IndexedDB)', () => {
  it('speichert und liest Datensätze, ohne Klartext abzulegen', async () => {
    await putRecord(db, 'entries', 'p1', { title: 'Bank', password: 'S3cr3t!' });
    expect(await getRecord(db, 'entries', 'p1')).toEqual({ title: 'Bank', password: 'S3cr3t!' });
    const raw = await idbGet(db, 'entries', 'p1');
    expect(Buffer.from(raw.env).toString('latin1')).not.toContain('S3cr3t');
    expect(Object.keys(raw).sort()).toEqual(['env', 'rv', 'v']);
  });
  it('Aktualisierung erhöht die Revision', async () => {
    await putRecord(db, 'entries', 'p1', { a: 1 }); await putRecord(db, 'entries', 'p1', { a: 2 });
    expect((await idbGet(db, 'entries', 'p1')).rv).toBe(2);
    expect(await getRecord(db, 'entries', 'p1')).toEqual({ a: 2 });
  });
  it('erkennt Austausch zwischen Datensätzen, falsche Revision und Manipulation', async () => {
    await putRecord(db, 'entries', 'p1', { a: 1 }); await putRecord(db, 'entries', 'p2', { a: 2 });
    const r1 = await idbGet(db, 'entries', 'p1');
    await idbPut(db, 'entries', 'p2', r1); await expect(getRecord(db, 'entries', 'p2')).rejects.toThrow();
    await idbPut(db, 'entries', 'p1', { ...r1, rv: 9 }); await expect(getRecord(db, 'entries', 'p1')).rejects.toThrow();
    const bad = { ...r1, env: r1.env.slice() }; bad.env[20] ^= 1; await idbPut(db, 'entries', 'p1', bad);
    await expect(getRecord(db, 'entries', 'p1')).rejects.toThrow();
  });
});

describe('Dateispeicher (IndexedDB-Backend) und Chunks', () => {
  it('schreibt, liest, listet und löscht Chunks', async () => {
    const b = new IdbBackend(db);
    await b.putChunk('f1', 0, rnd(10)); await b.putChunk('f1', 1, rnd(10)); await b.putChunk('f2', 0, rnd(5));
    expect(await b.listChunks('f1')).toEqual([0, 1]); expect((await b.listFileIds()).sort()).toEqual(['f1', 'f2']);
    await b.deleteFile('f1'); expect(await b.listChunks('f1')).toEqual([]); expect(await b.listChunks('f2')).toEqual([0]);
  });
  it('große Datei (5 MiB, 1-MiB-Chunks) übersteht den Roundtrip', async () => {
    const b = new IdbBackend(db), data = rnd(5 * 1024 * 1024 + 123), n = await writeChunks(b, 'big', data);
    expect(n).toBe(6);
    const k = await fileKey('big'), out = [];
    for (let i = 0; i < n; i++) out.push(await openChunk(k, 'big', i, i === n - 1, await b.getChunk('big', i)));
    expect(Buffer.concat(out).equals(Buffer.from(data))).toBe(true);
  });
  it('erkennt Umsortieren, Austausch und falsche „letzter Chunk“-Markierung', async () => {
    const b = new IdbBackend(db); await writeChunks(b, 'f', rnd(35), 10); const k = await fileKey('f');
    await expect(openChunk(k, 'f', 1, false, await b.getChunk('f', 2))).rejects.toThrow();
    await expect(openChunk(k, 'f', 3, false, await b.getChunk('f', 3))).rejects.toThrow();
    await expect(openChunk(k, 'g', 0, false, await b.getChunk('f', 0))).rejects.toThrow();
  });
});

describe('Integritätscheck', () => {
  const addFile = async (b, id, size, cs = 10) => { const n = await writeChunks(b, id, rnd(size), cs); await putRecord(db, 'files', id, { id, chunkCount: n }); return n; };
  it('meldet einen gesunden Tresor als in Ordnung', async () => {
    const b = new IdbBackend(db); await putRecord(db, 'entries', 'p', { a: 1 }); await addFile(b, 'f', 35);
    const r = await checkIntegrity(db, b);
    expect(r).toMatchObject({ ok: true, records: 2, files: 1, chunks: 4 });
  });
  it('erkennt beschädigten Datensatz, fehlenden, beschädigten und abgeschnittenen Chunk', async () => {
    const b = new IdbBackend(db); await putRecord(db, 'entries', 'p', { a: 1 }); await addFile(b, 'f', 35); await addFile(b, 'g', 35); await addFile(b, 'h', 35);
    const rec = await idbGet(db, 'entries', 'p'); rec.env[20] ^= 1; await idbPut(db, 'entries', 'p', rec);
    await idbRun(db, 'chunks', 'readwrite', (o) => o.delete(['f', 1]));
    const c = await b.getChunk('g', 2); c[20] ^= 1; await idbRun(db, 'chunks', 'readwrite', (o) => o.put(c, ['g', 2]));
    await idbRun(db, 'chunks', 'readwrite', (o) => o.delete(['h', 3])); // abgeschnitten
    const r = await checkIntegrity(db, b);
    expect(r.ok).toBe(false);
    expect(r.corruptRecords).toEqual([{ store: 'entries', id: 'p' }]);
    expect(r.missingChunks).toEqual(expect.arrayContaining([{ id: 'f', index: 1 }, { id: 'h', index: 3 }]));
    expect(r.corruptChunks).toEqual([{ id: 'g', index: 2 }]);
  });
  it('meldet verwaiste Dateien, löscht aber nichts', async () => {
    const b = new IdbBackend(db); await writeChunks(b, 'waise', rnd(20), 10);
    const r = await checkIntegrity(db, b);
    expect(r.orphanFiles).toEqual(['waise']); expect(r.ok).toBe(true);
    expect(await b.listChunks('waise')).toEqual([0, 1]);
  });
  it('verändert den Tresor nicht', async () => {
    const b = new IdbBackend(db); await putRecord(db, 'entries', 'p', { a: 1 }); await addFile(b, 'f', 35);
    const snap = async () => JSON.stringify([await listIds(db, 'entries'), await b.listChunks('f'), await idbGet(db, 'entries', 'p').then((x) => [...x.env])]);
    const before = await snap(); await checkIntegrity(db, b); expect(await snap()).toBe(before);
  });
});

describe('Speicherort-Wahl (OPFS/Fallback)', () => {
  const ok = () => ({ kind: 'opfs', probe: async () => {} });
  it('wählt OPFS, wenn nutzbar, und merkt es sich', async () => {
    const r = await openBackend(db, { opfsFactory: async () => ok() });
    expect(r.info.kind).toBe('opfs'); expect(await idbGet(db, 'vault_meta', 'storage')).toEqual({ backend: 'opfs' });
  });
  it('nutzt sichtbar den IndexedDB-Fallback, wenn OPFS nicht existiert', async () => {
    const r = await openBackend(db, { opfsFactory: async () => { throw Object.assign(new Error('x'), { unsupported: true }); } });
    expect(r.info.kind).toBe('idb'); expect(r.info.reason).toBeTruthy(); expect((await idbGet(db, 'vault_meta', 'storage')).backend).toBe('idb');
  });
  it('wechselt nie still: festgelegtes OPFS, das ausfällt, meldet Fehler statt IndexedDB zu nutzen', async () => {
    await openBackend(db, { opfsFactory: async () => ok() });
    const r = await openBackend(db, { opfsFactory: async () => ({ probe: async () => { throw new Error('weg'); } }) });
    expect(r.info.kind).toBe('opfs'); expect(r.info.error).toBeTruthy();
    await expect(r.backend.putChunk('a', 0, new Uint8Array(1))).rejects.toThrow();
    expect((await idbGet(db, 'vault_meta', 'storage')).backend).toBe('opfs');
  });
  it('legt bei vorübergehendem OPFS-Fehler nichts dauerhaft fest', async () => {
    const r = await openBackend(db, { opfsFactory: async () => ({ probe: async () => { throw new Error('zufällig'); } }) });
    expect(r.info.error).toBeTruthy(); expect(await idbGet(db, 'vault_meta', 'storage')).toBeUndefined();
  });
  it('bleibt bei festgelegtem IndexedDB-Fallback dabei', async () => {
    await idbPut(db, 'vault_meta', 'storage', { backend: 'idb', reason: 'r' });
    expect((await openBackend(db, { opfsFactory: async () => ok() })).info.kind).toBe('idb');
  });
});

describe('Speicherstatus', () => {
  afterEach(() => vi.unstubAllGlobals());
  const stub = (nav) => vi.stubGlobal('navigator', nav);
  it('warnt bei fehlender Persistenz und knappem Speicher', async () => {
    stub({ storage: { persisted: async () => false, estimate: async () => ({ usage: 90, quota: 100 }) } });
    const s = await storageStatus(); expect(s.warnings).toHaveLength(2); expect(s.available).toBe(10);
  });
  it('meldet fehlende Browser-Unterstützung ehrlich', async () => {
    stub({ storage: {} }); const s = await storageStatus();
    expect(s).toMatchObject({ persisted: null, usage: null, quota: null }); expect(s.warnings).toHaveLength(2);
  });
  it('keine Warnung bei dauerhaftem, wenig belegtem Speicher', async () => {
    stub({ storage: { persisted: async () => true, estimate: async () => ({ usage: 10, quota: 100 }) } });
    expect((await storageStatus()).warnings).toEqual([]);
  });
});
