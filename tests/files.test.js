import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { openDb, idbRun, idbPut } from '../src/core/db/idb.js';
import { IdbBackend } from '../src/core/files/idb-backend.js';
import { CHUNK_SIZE } from '../src/core/files/chunks.js';
import { checkIntegrity } from '../src/core/integrity.js';
import { createVault } from '../src/core/keys/vault.js';
import { lock } from '../src/core/keys/session.js';
import * as fd from '../src/modules/filedata.js';
import { sniff, importFile, readParts, openBlob, deleteFileFully, updateMeta, makeUrl, revokeAll, MAX_FILE_BYTES, ImportError } from '../src/modules/fileops.js';
import { memStore } from './memstore.js';

const enc = (s) => new TextEncoder().encode(s);
const PDF = (n = 100) => { const u = new Uint8Array(n); u.set(enc('%PDF-1.4\n')); for (let i = 9; i < n; i++) u[i] = 65 + (i % 26); return u; };
const JPG = (n = 100) => { const u = new Uint8Array(n); u.set([0xff, 0xd8, 0xff, 0xe0]); for (let i = 4; i < n; i++) u[i] = i % 251; return u; };
const file = (name, bytes) => Object.assign(new Blob([bytes]), { name });
const rnd = (n, head) => { const u = new Uint8Array(n); for (let i = 0; i < n; i += 65536) crypto.getRandomValues(u.subarray(i, Math.min(n, i + 65536))); u.set(head); return u; };
const wipe = () => new Promise((res) => { const r = indexedDB.deleteDatabase('brox-vault'); r.onsuccess = r.onerror = () => res(); });
const thumbMaker = async () => ({ bytes: new Uint8Array([1, 2, 3, 4]), width: 640, height: 480 });
let db, ctx;
beforeEach(async () => { lock(); await wipe(); db = await openDb(); await createVault('ein sehr langes passwort', memStore(), { m: 1024, t: 1, p: 1 }); await fd.loadAll(db); ctx = { db, backend: new IdbBackend(db), thumbMaker }; });
afterEach(() => { db.close(); vi.restoreAllMocks(); });

describe('Dateityp-Prüfung (Inhalt statt Endung)', () => {
  it('erkennt erlaubte Formate', () => {
    expect(sniff(PDF(), 'a.pdf')).toBe('application/pdf'); expect(sniff(JPG(), 'a.JPG')).toBe('image/jpeg'); expect(sniff(JPG(), 'a.jpeg')).toBe('image/jpeg');
    expect(sniff(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]), 'a.png')).toBe('image/png');
    expect(sniff(new Uint8Array([...enc('RIFF'), 1, 2, 3, 4, ...enc('WEBP')]), 'a.webp')).toBe('image/webp');
    expect(sniff(enc('Hallo Welt äöü'), 'a.txt')).toBe('text/plain'); expect(sniff(new Uint8Array(0), 'leer.txt')).toBe('text/plain');
  });
  it('lehnt Tarnung, Binärdaten als Text und fremde Endungen ab', () => {
    expect(sniff(enc('MZ\x90\x00 programm'), 'rechnung.pdf')).toBeNull(); expect(sniff(JPG(), 'bild.pdf')).toBeNull();
    expect(sniff(new Uint8Array([65, 0, 66]), 'a.txt')).toBeNull(); expect(sniff(PDF(), 'a.exe')).toBeNull(); expect(sniff(enc('<svg/>'), 'a.svg')).toBeNull();
    expect(sniff(new Uint8Array([0xff, 0xfe, 0xfd]), 'a.txt')).toBeNull(); expect(sniff(new Uint8Array(0), 'leer.pdf')).toBeNull();
  });
});

describe('Import, Speicherung und Lesen', () => {
  it('speichert verschlüsselt: weder Dateiname noch Inhalt liegen im Klartext in IndexedDB', async () => {
    const m = await importFile(ctx, file('Steuer-2024-geheim.pdf', PDF(500)), { kind: 'document' });
    expect(m).toMatchObject({ kind: 'document', mime: 'application/pdf', size: 500, chunkCount: 1 });
    const dump = async (s) => Buffer.concat((await idbRun(db, s, 'readonly', (o) => o.getAll())).map((r) => Buffer.from(r.env || r)));
    for (const s of ['files', 'chunks']) { const d = (await dump(s)).toString('latin1'); expect(d).not.toContain('Steuer'); expect(d).not.toContain('%PDF'); }
    expect(Buffer.concat(await readParts(ctx, m)).equals(Buffer.from(PDF(500)))).toBe(true);
  });
  it('große Datei (5 MiB): Chunks á höchstens 1 MiB, Roundtrip stimmt, Integritätsprüfung ok', async () => {
    const data = rnd(5 * 1024 * 1024 + 321, PDF(9)), spy = vi.spyOn(ctx.backend, 'putChunk');
    const m = await importFile(ctx, file('gross.pdf', data), { kind: 'document' });
    expect(m.chunkCount).toBe(6); expect(spy).toHaveBeenCalledTimes(6);
    for (const [, , bytes] of spy.mock.calls) expect(bytes.length).toBeLessThanOrEqual(CHUNK_SIZE + 29);
    expect(Buffer.concat(await readParts(ctx, m)).equals(Buffer.from(data))).toBe(true);
    expect(await checkIntegrity(db, ctx.backend)).toMatchObject({ ok: true, files: 1, chunks: 6 });
  });
  it('Foto: legt verschlüsseltes Vorschaubild an, Metadaten enthalten Maße', async () => {
    const m = await importFile(ctx, file('urlaub.jpg', JPG(300)), { kind: 'photo' });
    expect(m).toMatchObject({ width: 640, height: 480 }); const t = fd.get(m.thumbId);
    expect(t).toMatchObject({ kind: 'thumb', parent: m.id, chunkCount: 1 }); expect(Buffer.concat(await readParts(ctx, t))).toEqual(Buffer.from([1, 2, 3, 4]));
    expect(fd.photos()).toHaveLength(1); expect(fd.docs()).toHaveLength(0);
  });
  it('weist falsche Typen, Tarnung und zu große Dateien ab, bevor etwas geschrieben wird', async () => {
    const spy = vi.spyOn(ctx.backend, 'putChunk');
    await expect(importFile(ctx, file('x.pdf', enc('MZ\x90\x00')), { kind: 'document' })).rejects.toBeInstanceOf(ImportError);
    await expect(importFile(ctx, file('x.pdf', PDF()), { kind: 'photo' })).rejects.toThrow(/JPG, PNG oder WEBP/);
    await expect(importFile(ctx, { name: 'riesig.pdf', size: MAX_FILE_BYTES + 1, slice: () => new Blob([]) }, { kind: 'document' })).rejects.toThrow(/größer/);
    expect(spy).not.toHaveBeenCalled(); expect(await ctx.backend.listFileIds()).toEqual([]);
  });
  it('Fehler mitten im Import: nichts bleibt zurück und es gibt keine Erfolgsmeldung', async () => {
    let n = 0; const real = ctx.backend.putChunk.bind(ctx.backend); ctx.backend.putChunk = async (...a) => { if (++n === 2) throw new Error('Schreibfehler'); return real(...a); };
    await expect(importFile(ctx, file('gross.pdf', rnd(3 * 1024 * 1024, PDF(9))), { kind: 'document' })).rejects.toBeInstanceOf(ImportError);
    expect(fd.docs()).toHaveLength(0); expect(await ctx.backend.listFileIds()).toEqual([]); expect(await idbRun(db, 'files', 'readonly', (o) => o.getAllKeys())).toEqual([]);
  });
  it('Fehler bei der Vorschau räumt auch die Originaldatei weg', async () => {
    ctx.thumbMaker = async () => { throw new Error('kein Bild'); };
    await expect(importFile(ctx, file('kaputt.jpg', JPG()), { kind: 'photo' })).rejects.toBeInstanceOf(ImportError);
    expect(await ctx.backend.listFileIds()).toEqual([]); expect(fd.photos()).toHaveLength(0);
  });
  it('manipulierter Chunk wird beim Öffnen abgelehnt und von der Integritätsprüfung gemeldet', async () => {
    const m = await importFile(ctx, file('a.pdf', PDF(500)), { kind: 'document' });
    const c = await ctx.backend.getChunk(m.id, 0); c[40] ^= 1; await idbPut(db, 'chunks', [m.id, 0], c);
    await expect(openBlob(ctx, m)).rejects.toThrow();
    expect((await checkIntegrity(db, ctx.backend)).corruptChunks).toEqual([{ id: m.id, index: 0 }]);
  });
  it('Umbenennen/Verschieben ändert die Daten nicht, Löschen entfernt Einträge und Chunks', async () => {
    const m = await importFile(ctx, file('a.jpg', JPG(300)), { kind: 'photo' });
    const m2 = await updateMeta(m, { name: 'neu.jpg', category: 'Reise' }); expect(fd.get(m.id).name).toBe('neu.jpg');
    await fd.loadAll(db); expect(fd.get(m.id)).toMatchObject({ name: 'neu.jpg', category: 'Reise' }); expect(Buffer.concat(await readParts(ctx, m2))).toHaveLength(300);
    expect((await deleteFileFully(ctx, m2)).leftover).toBe(false);
    expect(fd.photos()).toHaveLength(0); expect(await ctx.backend.listFileIds()).toEqual([]); expect(await idbRun(db, 'files', 'readonly', (o) => o.getAllKeys())).toEqual([]);
  });
  it('Suche findet Dateien über Name, Kategorie und Beschreibung', async () => {
    const m = await importFile(ctx, file('Mietvertrag.pdf', PDF()), { kind: 'document' }); await updateMeta(m, { category: 'Wohnen', description: 'Hauptwohnung' });
    for (const q of ['miet', 'wohnen', 'hauptwohnung', 'miet wohnen']) expect(fd.search(q), q).toHaveLength(1); expect(fd.search('zzz')).toHaveLength(0);
  });
});

describe('Ordner und Alben', () => {
  it('Ordner nur löschen, wenn leer; Album löschen behält die Fotos', async () => {
    const f = await fd.saveFolder({ kind: 'folder', name: 'Steuer', parentId: null }), sub = await fd.saveFolder({ kind: 'folder', name: '2024', parentId: f.id });
    await expect(fd.removeFolder(f.id)).rejects.toThrow(/nicht leer/);
    const d = await importFile(ctx, file('a.pdf', PDF()), { kind: 'document', folderId: sub.id }); await expect(fd.removeFolder(sub.id)).rejects.toThrow();
    await updateMeta(d, { folderId: null }); await fd.removeFolder(sub.id); await fd.removeFolder(f.id); expect(fd.listFolders('folder')).toEqual([]);
    const al = await fd.saveFolder({ kind: 'album', name: 'Urlaub' }), p = await importFile(ctx, file('a.jpg', JPG()), { kind: 'photo', albumId: al.id });
    await fd.removeFolder(al.id); expect(fd.get(p.id).albumId).toBeNull(); expect(fd.photos()).toHaveLength(1);
  });
  it('Ordner und Alben sind verschlüsselt gespeichert und überstehen das Neuladen', async () => {
    const f = await fd.saveFolder({ kind: 'folder', name: 'Geheimer Ordner', parentId: null });
    const raw = Buffer.from((await idbRun(db, 'categories', 'readonly', (o) => o.get(f.id))).env).toString('latin1'); expect(raw).not.toContain('Geheimer');
    await fd.loadAll(db); expect(fd.folder(f.id).name).toBe('Geheimer Ordner');
  });
  it('Sperren verwirft alle entschlüsselten Datei-Metadaten', async () => {
    await importFile(ctx, file('a.pdf', PDF()), { kind: 'document' }); lock(); expect(fd.docs()).toHaveLength(0); expect(fd.listFolders('folder')).toHaveLength(0);
  });
});

describe('Blob-URLs', () => {
  it('werden widerrufen: beim Aufräumen und beim Sperren', async () => {
    let n = 0; const rev = vi.fn(); vi.stubGlobal('URL', Object.assign(function URL() {}, { createObjectURL: () => 'blob:t' + ++n, revokeObjectURL: rev }));
    makeUrl(new Blob(['a'])); makeUrl(new Blob(['b'])); revokeAll(); expect(rev).toHaveBeenCalledTimes(2);
    makeUrl(new Blob(['c'])); lock(); await createVault('ein sehr langes passwort', memStore(), { m: 1024, t: 1, p: 1 }); makeUrl(new Blob(['d'])); lock(); expect(rev.mock.calls.length).toBeGreaterThanOrEqual(3);
    vi.unstubAllGlobals();
  });
});
