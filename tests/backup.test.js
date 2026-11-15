import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { openDb, idbRun, idbPut } from '../src/core/db/idb.js';
import { IdbBackend } from '../src/core/files/idb-backend.js';
import { createVault } from '../src/core/keys/vault.js';
import { lock, sessionKeys } from '../src/core/keys/session.js';
import { checkIntegrity } from '../src/core/integrity.js';
import * as data from '../src/modules/data.js';
import * as fd from '../src/modules/filedata.js';
import { importFile, readParts } from '../src/modules/fileops.js';
import { writeBackup } from '../src/backup/writer.js';
import { BlobSink } from '../src/backup/sinks.js';
import { inspectStructure, openBackup, verifyBackup, readHeader } from '../src/backup/reader.js';
import { applyBackup, verifyRestore, sessionTarget } from '../src/backup/restore.js';
import { BackupError, WrongBackupPasswordError } from '../src/backup/format.js';
import { memStore } from './memstore.js';

const FAST = { m: 1024, t: 1, p: 1 }, BPW = 'backup passwort 123', enc = (s) => new TextEncoder().encode(s);
const PDF = (n = 300, k = 0) => { const u = new Uint8Array(n); u.set(enc('%PDF-1.4\n')); for (let i = 9; i < n; i++) u[i] = 65 + ((i + k) % 26); return u; };
const JPG = (n = 300) => { const u = new Uint8Array(n); u.set([0xff, 0xd8, 0xff, 0xe0]); for (let i = 4; i < n; i++) u[i] = i % 251; return u; };
const rnd = (n, head) => { const u = new Uint8Array(n); for (let i = 0; i < n; i += 65536) crypto.getRandomValues(u.subarray(i, Math.min(n, i + 65536))); u.set(head); return u; };
const file = (name, bytes) => Object.assign(new Blob([bytes]), { name });
const wipe = () => new Promise((res) => { const r = indexedDB.deleteDatabase('brox-vault'); r.onsuccess = r.onerror = () => res(); });
const bytesOf = async (b) => new Uint8Array(await b.arrayBuffer());
const dbNames = async () => (await indexedDB.databases()).map((d) => d.name);
let db, ctx;
const newProfile = async (pw) => { lock(); await wipe(); db = await openDb(); await createVault(pw, memStore(), FAST); await data.loadAll(db); await fd.loadAll(db); ctx = { db, backend: new IdbBackend(db), thumbMaker: async () => ({ bytes: new Uint8Array([7, 7, 7]), width: 10, height: 20 }) }; };
const src = () => ({ db: ctx.db, backend: ctx.backend, keys: sessionKeys() });
const exportAll = async (pw = BPW) => { const sink = new BlobSink(); const r = await writeBackup(src(), pw, sink, { kdf: FAST }); return { blob: r.result, ...r }; };
async function fill(big = false) {
  await data.save({ type: 'password', title: 'Bank', username: 'anna', password: 'Sup3rGeheim!', pin: '4711', custom: [{ name: 'Token', value: 'tok-abc', secret: true }], favorite: true, category: 'Finanzen' });
  await data.save({ type: 'note', title: 'Geheime Notiz', content: 'Der Schatz liegt unter der Eiche', custom: [], favorite: false, category: '' });
  const folder = await fd.saveFolder({ kind: 'folder', name: 'Steuer-Ordner', parentId: null }), album = await fd.saveFolder({ kind: 'album', name: 'Urlaub-Album' });
  const d = await importFile(ctx, file('Steuerbescheid.pdf', PDF(500)), { kind: 'document', folderId: folder.id });
  const p = await importFile(ctx, file('Strand.jpg', JPG(400)), { kind: 'photo', albumId: album.id });
  let bigf = null; if (big) bigf = await importFile(ctx, file('gross.pdf', rnd(5 * 1024 * 1024 + 77, PDF(9))), { kind: 'document' });
  return { d, p, bigf, folder, album };
}
beforeEach(async () => { await newProfile('erstes master passwort'); });
afterEach(() => { db.close(); vi.restoreAllMocks(); });

describe('Export (.bvx)', () => {
  it('enthält keinerlei Klartext (Titel, Passwörter, Dateinamen, Dateiinhalte, Master-Passwort)', async () => {
    await fill(); const { blob } = await exportAll(); const hay = Buffer.from(await bytesOf(blob)).toString('latin1');
    for (const s of ['Bank', 'anna', 'Sup3rGeheim', '4711', 'tok-abc', 'Schatz', 'Eiche', 'Steuer', 'Strand', 'Urlaub', '%PDF', 'erstes master', 'backup passwort']) expect(hay, s).not.toContain(s);
    expect(hay.startsWith('BVX1')).toBe(true);
  });
  it('zwei Exporte unterscheiden sich vollständig (neuer Salt und neue Nonces)', async () => {
    await fill(); const a = await bytesOf((await exportAll()).blob), b = await bytesOf((await exportAll()).blob);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false); expect(a.length).toBe(b.length);
  });
  it('verweigert den Export bei beschädigten Daten und liefert keine Datei', async () => {
    const { d } = await fill(); const c = await ctx.backend.getChunk(d.id, 0); c[40] ^= 1; await idbPut(db, 'chunks', [d.id, 0], c);
    const sink = new BlobSink(), abort = vi.spyOn(sink, 'abort');
    await expect(writeBackup(src(), BPW, sink, { kdf: FAST })).rejects.toThrow(/beschädigt/); expect(abort).toHaveBeenCalled(); expect(sink.blob).toBeUndefined();
  });
  it('Download-Limit ohne Streaming wird mit klarer Meldung durchgesetzt', async () => {
    await fill(); await expect(writeBackup(src(), BPW, new BlobSink(500), { kdf: FAST })).rejects.toMatchObject({ code: 'size' });
  });
});

describe('Prüfung in Stufen', () => {
  it('Stufe 1 und 2 bestehen bei einem gesunden Backup', async () => {
    await fill(true); const { blob, frames } = await exportAll();
    expect(await inspectStructure(blob)).toMatchObject({ version: 1, frames, kdf: FAST });
    const v = await verifyBackup(await openBackup(blob, BPW));
    // 2 Einträge + 2 Ordner/Alben + 4 Datei-Metadaten (Dokument, Foto, Vorschau, große Datei) = 8; Chunks: 1+1+1+6 = 9
    expect(v).toMatchObject({ frames, records: 8, chunks: 9, stores: { entries: 2, categories: 2, files: 4 } }); expect(frames).toBe(1 + 8 + 9 + 1);
  });
  it('falsches Backup-Passwort wird erkannt, ohne etwas zu schreiben', async () => {
    await fill(); const { blob } = await exportAll(); const before = JSON.stringify(await idbRun(db, 'entries', 'readonly', (o) => o.getAllKeys()));
    await expect(verifyBackup(await openBackup(blob, 'falsches passwort!!!'))).rejects.toBeInstanceOf(WrongBackupPasswordError);
    await expect(applyBackup(sessionTarget(ctx), await openBackup(blob, 'falsches passwort!!!'), {})).rejects.toBeInstanceOf(WrongBackupPasswordError);
    expect(JSON.stringify(await idbRun(db, 'entries', 'readonly', (o) => o.getAllKeys()))).toBe(before);
  });
  const mutate = async (blob, fn) => { const u = await bytesOf(blob); return new Blob([fn(u) || u]); };
  it('erkennt Beschädigungen: Format, Version, Kopf, Abschneiden, geflippte Bytes, entfernte Frames', async () => {
    await fill(); const { blob } = await exportAll(), u = await bytesOf(blob), h = await readHeader(blob);
    await expect(inspectStructure(new Blob([enc('Hallo Welt, das ist kein Backup')]))).rejects.toMatchObject({ code: 'format' });
    await expect(inspectStructure(new Blob([]))).rejects.toMatchObject({ code: 'format' });
    await expect(inspectStructure(await mutate(blob, (x) => { x[5] = 9; }))).rejects.toMatchObject({ code: 'version' });
    await expect(inspectStructure(await mutate(blob, (x) => { x[6] = 0x7f; }))).rejects.toMatchObject({ code: 'header' });
    await expect(inspectStructure(new Blob([u.subarray(0, u.length - 7)]))).rejects.toMatchObject({ code: 'structure' });
    await expect(inspectStructure(new Blob([u, new Uint8Array(5)]))).rejects.toBeInstanceOf(BackupError);
    // Byte mitten in einem Frame kippen -> Struktur ok, Authentifizierung schlägt fehl
    const flipped = await mutate(blob, (x) => { x[Math.floor(x.length / 2)] ^= 1; }); await inspectStructure(flipped);
    await expect(verifyBackup(await openBackup(flipped, BPW))).rejects.toThrow(/Frame \d+ ist beschädigt|Falsches Backup/);
    // Header manipulieren (KDF-Parameter t) -> alle Frames ungültig (AAD enthält den Header-Hash)
    const hdr = new TextDecoder().decode(u.subarray(10, h.offset)), forged = enc(hdr.replace('"t":1', '"t":2')), nu = new Uint8Array(u.length); nu.set(u); nu.set(forged, 10);
    await expect(verifyBackup(await openBackup(new Blob([nu]), BPW))).rejects.toBeInstanceOf(BackupError);
    // Footer abschneiden: letzten Frame entfernen
    let off = h.offset, last = 0; const dv = new DataView(u.buffer); while (off < u.length) { last = off; off += 6 + dv.getUint32(off); }
    await expect(inspectStructure(new Blob([u.subarray(0, last)]))).rejects.toMatchObject({ code: 'structure' });
    // Mittleren Frame entfernen -> Nummerierung (AAD) bricht
    let o2 = h.offset; o2 += 6 + dv.getUint32(o2); const sec = o2; const len2 = 6 + dv.getUint32(o2); const removed = new Blob([u.subarray(0, sec), u.subarray(sec + len2)]);
    await inspectStructure(removed); await expect(verifyBackup(await openBackup(removed, BPW))).rejects.toThrow(/Frame \d+ ist beschädigt/);
  });
  it('weist absurde KDF-Parameter zurück, bevor Speicher reserviert wird', async () => {
    await fill(); const { blob } = await exportAll(), u = await bytesOf(blob), h = await readHeader(blob);
    const hdr = new TextDecoder().decode(u.subarray(10, h.offset)), forged = enc(hdr.replace('"m":1024', '"m":9999999')); const nu = new Uint8Array(u.length); nu.set(u); nu.set(forged, 10);
    await expect(readHeader(new Blob([nu]))).rejects.toMatchObject({ code: 'header' });
  });
});

describe('Wiederherstellung (zweites Browserprofil)', () => {
  it('stellt alles auf einem frischen Profil mit anderem Master-Passwort wieder her', async () => {
    const { d, p, bigf } = await fill(true); const { blob } = await exportAll(); const orig = Buffer.concat(await readParts(ctx, bigf));
    db.close(); await newProfile('ganz anderes master passwort'); // frischer Browser: leere Datenbank, anderer Tresorschlüssel
    expect(data.all()).toHaveLength(0);
    const res = await applyBackup(sessionTarget(ctx), await openBackup(blob, BPW), { policy: 'keep' });
    expect(res).toMatchObject({ added: 4, conflicts: 0, files: { added: 4, conflicts: 0 }, chunks: 9 }); await data.loadAll(db); await fd.loadAll(db);
    expect(data.all('password')[0]).toMatchObject({ title: 'Bank', password: 'Sup3rGeheim!', pin: '4711', favorite: true }); expect(data.all('note')[0].content).toContain('Eiche');
    expect(fd.listFolders('folder')[0].name).toBe('Steuer-Ordner'); expect(fd.listFolders('album')[0].name).toBe('Urlaub-Album');
    expect(fd.get(d.id)).toMatchObject({ name: 'Steuerbescheid.pdf', folderId: fd.listFolders('folder')[0].id }); expect(fd.get(p.id).thumbId).toBeTruthy();
    expect(Buffer.concat(await readParts(ctx, fd.get(d.id)))).toEqual(Buffer.from(PDF(500))); expect(Buffer.concat(await readParts(ctx, fd.get(bigf.id)))).toEqual(orig);
    expect(await checkIntegrity(db, ctx.backend)).toMatchObject({ ok: true, files: 4, chunks: 9 });
  });
  it('zweite Wiederherstellung derselben Datei ändert nichts (alles „unverändert“)', async () => {
    await fill(); const { blob } = await exportAll(); const res = await applyBackup(sessionTarget(ctx), await openBackup(blob, BPW), {});
    expect(res.added + res.files.added + res.conflicts + res.files.conflicts).toBe(0); expect(res.unchanged).toBeGreaterThan(0); expect(res.files.unchanged).toBe(3);
  });
  it('Konflikte: „behalten“ lässt Vorhandenes unberührt, „überschreiben“ nimmt die Backup-Version, Trockenlauf schreibt nichts', async () => {
    await fill(); const { blob } = await exportAll(); const pw = data.all('password')[0];
    await data.save({ ...pw, password: 'LOKAL-geändert' }); const target = sessionTarget(ctx);
    const dry = await applyBackup(target, await openBackup(blob, BPW), { policy: 'overwrite', commit: false }); expect(dry.conflicts).toBe(1); expect(dry.replaced).toBe(1);
    await data.loadAll(db); expect(data.all('password')[0].password).toBe('LOKAL-geändert');
    const keep = await applyBackup(target, await openBackup(blob, BPW), { policy: 'keep' }); expect(keep.conflicts).toBe(1); expect(keep.replaced).toBe(0);
    await data.loadAll(db); expect(data.all('password')[0].password).toBe('LOKAL-geändert');
    const ow = await applyBackup(target, await openBackup(blob, BPW), { policy: 'overwrite' }); expect(ow.replaced).toBe(1);
    await data.loadAll(db); expect(data.all('password')[0].password).toBe('Sup3rGeheim!');
  });
  it('lässt eine vorhandene, abweichende Datei bei „behalten“ samt Chunks unangetastet', async () => {
    const { d } = await fill(); const { blob } = await exportAll(); const local = fd.get(d.id); await fd.saveMeta({ ...local, name: 'lokal umbenannt.pdf' });
    const res = await applyBackup(sessionTarget(ctx), await openBackup(blob, BPW), { policy: 'keep' }); expect(res.files.conflicts).toBe(1);
    await fd.loadAll(db); expect(fd.get(d.id).name).toBe('lokal umbenannt.pdf'); expect(Buffer.concat(await readParts(ctx, fd.get(d.id)))).toEqual(Buffer.from(PDF(500)));
  });
  it('Abbruch mitten in einer Datei: kein Metadatensatz, keine Reste, bereits fertige Teile bleiben konsistent', async () => {
    await fill(true); const { blob } = await exportAll(); db.close(); await newProfile('noch ein master passwort');
    let n = 0; const real = ctx.backend.putChunk.bind(ctx.backend); ctx.backend.putChunk = async (...a) => { if (++n === 4) throw new Error('Speicher voll'); return real(...a); };
    await expect(applyBackup(sessionTarget(ctx), await openBackup(blob, BPW), {})).rejects.toThrow();
    ctx.backend.putChunk = real; const ig = await checkIntegrity(db, ctx.backend);
    expect(ig).toMatchObject({ ok: true, missingChunks: [], corruptChunks: [] }); expect(ig.orphanFiles).toEqual([]);
  });
});

describe('Stufe 3: Probewiederherstellung', () => {
  it('besteht, verändert den echten Tresor nicht und hinterlässt keine Wegwerf-Datenbank', async () => {
    await fill(true); const { blob } = await exportAll(); const before = JSON.stringify(await idbRun(db, 'files', 'readonly', (o) => o.getAllKeys()));
    const r = await verifyRestore(await openBackup(blob, BPW)); expect(r.checked).toEqual({ records: 8, files: 4, chunks: 9 });
    expect(JSON.stringify(await idbRun(db, 'files', 'readonly', (o) => o.getAllKeys()))).toBe(before); expect((await dbNames()).filter((n) => n.startsWith('brox-verify'))).toEqual([]);
  });
  it('schlägt bei beschädigtem Backup fehl und räumt trotzdem auf', async () => {
    await fill(); const { blob } = await exportAll(), u = await bytesOf(blob); u[Math.floor(u.length * 0.8)] ^= 1;
    await expect(verifyRestore(await openBackup(new Blob([u]), BPW))).rejects.toBeInstanceOf(BackupError); expect((await dbNames()).filter((n) => n.startsWith('brox-verify'))).toEqual([]);
  });
});
