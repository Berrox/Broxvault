import 'fake-indexeddb/auto';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { openDb, idbPut } from '../src/core/db/idb.js';
import { IdbBackend } from '../src/core/files/idb-backend.js';
import { openBackend } from '../src/core/files/choose.js';
import { createVault } from '../src/core/keys/vault.js';
import { lock, sessionKeys } from '../src/core/keys/session.js';
import { checkIntegrity } from '../src/core/integrity.js';
import * as data from '../src/modules/data.js';
import * as fd from '../src/modules/filedata.js';
import { importFile, readParts, deleteFileFully } from '../src/modules/fileops.js';
import { writeBackup } from '../src/backup/writer.js';
import { BlobSink } from '../src/backup/sinks.js';
import { openBackup as openBk } from '../src/backup/reader.js';
import { applyBackup, sessionTarget } from '../src/backup/restore.js';
import { memStore } from './memstore.js';

// ---- Nachbildung des Origin Private File System (inkl. exklusiver Sync-Handles wie im Browser) ----
class NotFound extends Error { constructor() { super('nicht gefunden'); this.name = 'NotFoundError'; } }
class FakeFile {
  kind = 'file'; data = new Uint8Array(0); locked = false; hooks = {};
  async createSyncAccessHandle() {
    if (this.locked) throw Object.assign(new Error('Datei ist gesperrt'), { name: 'NoModificationAllowedError' }); this.locked = true; const f = this;
    return { getSize: () => f.data.length, truncate: (n) => { const d = new Uint8Array(n); d.set(f.data.subarray(0, Math.min(n, f.data.length))); f.data = d; },
      write: (buf, { at = 0 } = {}) => { if (f.hooks.failWrite) throw new Error('Schreibfehler'); const src = f.hooks.shortWrite ? buf.subarray(0, buf.length >> 1) : buf; const n = at + src.length; if (n > f.data.length) { const d = new Uint8Array(n); d.set(f.data); f.data = d; } f.data.set(src, at); return src.length; },
      read: (buf, { at = 0 } = {}) => { const n = Math.min(buf.length, f.data.length - at); buf.set(f.data.subarray(at, at + n)); return n; }, flush() {}, close() { f.locked = false; } };
  }
}
class FakeDir {
  kind = 'directory'; children = new Map();
  async getDirectoryHandle(n, { create } = {}) { let c = this.children.get(n); if (!c) { if (!create) throw new NotFound(); c = new FakeDir(); this.children.set(n, c); } return c; }
  async getFileHandle(n, { create } = {}) { let c = this.children.get(n); if (!c) { if (!create) throw new NotFound(); c = new FakeFile(); this.children.set(n, c); } return c; }
  async removeEntry(n) { if (!this.children.has(n)) throw new NotFound(); this.children.delete(n); }
  async *entries() { for (const e of this.children) yield e; }
}
let root, workers;
class FakeWorker {
  constructor() {
    const self = { postMessage: (m, t) => { const c = structuredClone(m, { transfer: t }); queueMicrotask(() => this.onmessage && this.onmessage({ data: c })); } };
    vm.runInNewContext(readFileSync('src/core/files/opfs-worker.js', 'utf8'), { self, navigator: { storage: { getDirectory: async () => root } }, Uint8Array, Error, String, Promise });
    this.self = self; workers.push(this);
  }
  postMessage(m, t) { const c = structuredClone(m, { transfer: t }); Promise.resolve().then(() => this.self.onmessage({ data: c })); }
}
const chunkFile = (id, i = 0) => root.children.get('brox-chunks').children.get(id).children.get(String(i).padStart(8, '0') + '.bin');

const FAST = { m: 1024, t: 1, p: 1 }, enc = (s) => new TextEncoder().encode(s);
const PDF = (n = 300) => { const u = new Uint8Array(n); u.set(enc('%PDF-1.4\n')); for (let i = 9; i < n; i++) u[i] = 65 + (i % 26); return u; };
const JPG = (n = 300) => { const u = new Uint8Array(n); u.set([0xff, 0xd8, 0xff, 0xe0]); for (let i = 4; i < n; i++) u[i] = i % 251; return u; };
const file = (name, bytes) => Object.assign(new Blob([bytes]), { name });
const wipe = () => new Promise((res) => { const r = indexedDB.deleteDatabase('brox-vault'); r.onsuccess = r.onerror = () => res(); });
let db, ctx;
beforeEach(async () => {
  root = new FakeDir(); workers = []; vi.stubGlobal('Worker', FakeWorker); vi.stubGlobal('navigator', { storage: { getDirectory: async () => root } });
  lock(); await wipe(); db = await openDb(); await createVault('ein sehr langes passwort', memStore(), FAST); await data.loadAll(db); await fd.loadAll(db);
  const o = await openBackend(db); ctx = { db, backend: o.backend, info: o.info, thumbMaker: async () => ({ bytes: new Uint8Array([5, 5, 5]), width: 4, height: 3 }) };
});
afterEach(() => { db.close(); vi.unstubAllGlobals(); });

describe('OPFS-Backend (Logik gegen ein nachgebildetes Dateisystem)', () => {
  it('wird gewählt und gemerkt, wenn die Umgebung OPFS anbietet', async () => {
    expect(ctx.info).toEqual({ kind: 'opfs' }); expect(ctx.backend.kind).toBe('opfs');
    const again = await openBackend(db); expect(again.info.kind).toBe('opfs');
  });
  it('schreibt, liest, überschreibt kürzer, listet numerisch und löscht', async () => {
    const b = ctx.backend; await b.putChunk('f1', 0, new Uint8Array([1, 2, 3, 4, 5])); expect([...await b.getChunk('f1', 0)]).toEqual([1, 2, 3, 4, 5]);
    await b.putChunk('f1', 0, new Uint8Array([9, 9])); expect([...await b.getChunk('f1', 0)]).toEqual([9, 9]);   // kürzer überschreiben schneidet ab
    for (let i = 1; i <= 12; i++) await b.putChunk('f1', i, new Uint8Array([i]));
    expect(await b.listChunks('f1')).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]); await b.putChunk('f2', 0, new Uint8Array([1]));
    expect((await b.listFileIds()).sort()).toEqual(['f1', 'f2']); await b.deleteFile('f1'); expect(await b.listChunks('f1')).toEqual([]); expect(await b.listFileIds()).toEqual(['f2']);
    await b.deleteFile('gibt-es-nicht'); // idempotent
    await expect(b.getChunk('f1', 0)).rejects.toThrow();
  });
  it('gibt den exklusiven Schreib-Handle auch bei Fehlern frei', async () => {
    const b = ctx.backend; await b.putChunk('f', 0, new Uint8Array([1])); const fh = chunkFile('f'); fh.hooks.failWrite = true;
    await expect(b.putChunk('f', 0, new Uint8Array([2]))).rejects.toThrow(/Schreibfehler/); expect(fh.locked).toBe(false);
    fh.hooks.failWrite = false; await b.putChunk('f', 0, new Uint8Array([3])); expect([...await b.getChunk('f', 0)]).toEqual([3]);
  });
  it('erkennt unvollständiges Schreiben statt Erfolg zu melden', async () => {
    const b = ctx.backend; await b.putChunk('f', 0, new Uint8Array([1])); chunkFile('f').hooks.shortWrite = true;
    await expect(b.putChunk('f', 0, new Uint8Array([1, 2, 3, 4, 5, 6]))).rejects.toThrow(/unvollständig/); expect(chunkFile('f').locked).toBe(false);
  });
  it('Daten werden vor dem Senden kopiert (der Aufrufer behält seinen Puffer)', async () => {
    const buf = new Uint8Array([7, 7, 7]); await ctx.backend.putChunk('f', 0, buf); expect(buf.length).toBe(3); expect(buf.buffer.byteLength).toBe(3);
  });
  it('festgelegtes OPFS, das später ausfällt: Fehler statt stillem Umschalten', async () => {
    vi.stubGlobal('Worker', class { constructor() { throw new Error('kein Worker'); } });
    const r = await openBackend(db); expect(r.info.kind).toBe('opfs'); expect(r.info.error).toBeTruthy(); await expect(r.backend.putChunk('a', 0, new Uint8Array(1))).rejects.toThrow();
  });
});

describe('Gesamtablauf mit OPFS-Speicher', () => {
  it('Import, Anzeige, Integritätsprüfung, Manipulation und Löschen', async () => {
    const d = await importFile(ctx, file('Vertrag.pdf', PDF(3 * 1024 * 1024 + 5)), { kind: 'document' }), p = await importFile(ctx, file('a.jpg', JPG()), { kind: 'photo' });
    expect(d.chunkCount).toBe(4); expect(Buffer.concat(await readParts(ctx, d)).equals(Buffer.from(PDF(3 * 1024 * 1024 + 5)))).toBe(true);
    expect(await checkIntegrity(db, ctx.backend)).toMatchObject({ ok: true, files: 3, chunks: 6 });
    const f = chunkFile(d.id, 2); f.data[100] ^= 1; const bad = await checkIntegrity(db, ctx.backend); expect(bad.ok).toBe(false); expect(bad.corruptChunks).toEqual([{ id: d.id, index: 2 }]);
    f.data[100] ^= 1; expect((await deleteFileFully(ctx, p)).leftover).toBe(false); expect(await ctx.backend.listFileIds()).toEqual([d.id]);
  });
  it('Backup aus OPFS lässt sich in einen IndexedDB-Tresor wiederherstellen und umgekehrt', async () => {
    const d = await importFile(ctx, file('Vertrag.pdf', PDF(1500)), { kind: 'document' }); await data.save({ type: 'note', title: 'N', content: 'x', custom: [], favorite: false, category: '' });
    const sink = new BlobSink(); const out = await writeBackup({ db, backend: ctx.backend, keys: sessionKeys() }, 'backup passwort 123', sink, { kdf: FAST });
    db.close(); lock(); await wipe(); db = await openDb(); await createVault('anderes master passwort', memStore(), FAST); await data.loadAll(db); await fd.loadAll(db);
    const idbCtx = { db, backend: new IdbBackend(db) }; const res = await applyBackup(sessionTarget(idbCtx), await openBk(out.result, 'backup passwort 123'), {});
    expect(res.files.added).toBe(1); await fd.loadAll(db); expect(Buffer.concat(await readParts(idbCtx, fd.get(d.id))).equals(Buffer.from(PDF(1500)))).toBe(true);
    const sink2 = new BlobSink(); const out2 = await writeBackup({ db, backend: idbCtx.backend, keys: sessionKeys() }, 'backup passwort 123', sink2, { kdf: FAST });
    root = new FakeDir(); db.close(); lock(); await wipe(); db = await openDb(); await createVault('drittes master passwort', memStore(), FAST); await data.loadAll(db); await fd.loadAll(db);
    const o = await openBackend(db); const opfsCtx = { db, backend: o.backend }; expect(o.info.kind).toBe('opfs');
    await applyBackup(sessionTarget(opfsCtx), await openBk(out2.result, 'backup passwort 123'), {}); await fd.loadAll(db);
    expect(Buffer.concat(await readParts(opfsCtx, fd.get(d.id))).equals(Buffer.from(PDF(1500)))).toBe(true); expect(await checkIntegrity(db, opfsCtx.backend)).toMatchObject({ ok: true });
  });
});
