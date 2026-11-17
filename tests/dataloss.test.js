import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { openDb, migrations, idbGet, idbPut, idbRun, createMetaStore } from '../src/core/db/idb.js';
import { IdbBackend } from '../src/core/files/idb-backend.js';
import { createVault, unlock, WrongPasswordError } from '../src/core/keys/vault.js';
import { lock, sessionKeys } from '../src/core/keys/session.js';
import { checkIntegrity } from '../src/core/integrity.js';
import * as data from '../src/modules/data.js';
import * as fd from '../src/modules/filedata.js';
import { importFile, deleteFileFully } from '../src/modules/fileops.js';
import { writeBackup } from '../src/backup/writer.js';
import { BlobSink } from '../src/backup/sinks.js';
import { openBackup } from '../src/backup/reader.js';
import { applyBackup, sessionTarget } from '../src/backup/restore.js';

const FAST = { m: 1024, t: 1, p: 1 }, PW = 'ein sehr langes passwort';
const wipe = () => new Promise((res) => { const r = indexedDB.deleteDatabase('brox-vault'); r.onsuccess = r.onerror = () => res(); });
let db, store, ctx;
beforeEach(async () => { lock(); await wipe(); db = await openDb(); store = createMetaStore(db); await createVault(PW, store, FAST); await data.loadAll(db); await fd.loadAll(db); ctx = { db, backend: new IdbBackend(db), thumbMaker: async () => ({ bytes: new Uint8Array([1, 2]), width: 1, height: 1 }) }; });
afterEach(() => { db.close(); vi.restoreAllMocks(); });
const note = (t) => ({ type: 'note', title: t, content: 'inhalt ' + t, custom: [], favorite: false, category: '' });
const pdf = (n = 100) => { const u = new Uint8Array(n); u.set(new TextEncoder().encode('%PDF-1.4\n')); return u; };
const blob = (name, b) => Object.assign(new Blob([b]), { name });

describe('Migrationen zerstören nie Daten', () => {
  it('jede Migration legt nur an: kein Löschen von Stores, Indizes oder Einträgen', () => {
    for (const [i, m] of migrations.entries()) expect(m.toString(), 'Migration ' + (i + 1)).not.toMatch(/deleteObjectStore|deleteIndex|\.clear\(|\.delete\(|\.put\(|\.add\(/);
    expect(migrations.length).toBeGreaterThanOrEqual(2);
  });
  it('bei Fehlern wird nie eine Datenbank gelöscht oder neu angelegt', async () => {
    await data.save(note('bleibt')); const del = vi.spyOn(indexedDB, 'deleteDatabase'); db.close();
    await expect(openDb('brox-vault', [...migrations, () => { throw new Error('kaputt'); }])).rejects.toThrow(); await expect(openDb('brox-vault', migrations.slice(0, 1))).rejects.toBeTruthy(); // ältere App
    expect(del).not.toHaveBeenCalled(); db = await openDb(); expect((await idbRun(db, 'entries', 'readonly', (o) => o.count()))).toBe(1); expect(db.version).toBe(migrations.length);
  });
});

describe('Unlesbare oder beschädigte Daten', () => {
  it('beschädigte Tresor-Metadaten: Fehlermeldung, nichts wird verändert oder neu angelegt', async () => {
    lock(); const good = await idbGet(db, 'vault_meta', 'vault'); await idbPut(db, 'vault_meta', 'vault', { formatVersion: 7, mist: true });
    await expect(unlock(PW, store)).rejects.toThrow(/Unbekanntes Tresorformat/); expect(await idbGet(db, 'vault_meta', 'vault')).toEqual({ formatVersion: 7, mist: true });
    await idbPut(db, 'vault_meta', 'vault', good); await unlock(PW, store); // Original zurück: alles funktioniert wieder
  });
  it('beschädigter Datensatz wird gemeldet, bleibt aber unangetastet; andere Daten laden weiter', async () => {
    const a = await data.save(note('A')), b = await data.save(note('B')); const raw = await idbGet(db, 'entries', a.id); raw.env[20] ^= 1; await idbPut(db, 'entries', a.id, raw);
    await data.loadAll(db); expect(data.corrupt).toEqual([a.id]); expect(data.get(b.id).title).toBe('B'); expect(await idbGet(db, 'entries', a.id)).toBeTruthy();
    expect((await checkIntegrity(db, ctx.backend)).corruptRecords).toEqual([{ store: 'entries', id: a.id }]);
  });
  it('Passwort-Fehleingabe verändert keine Daten', async () => {
    await data.save(note('A')); lock(); const before = JSON.stringify(await idbGet(db, 'vault_meta', 'vault'));
    for (let i = 0; i < 3; i++) await expect(unlock('falsches passwort!!', store)).rejects.toBeInstanceOf(WrongPasswordError);
    expect(JSON.stringify(await idbGet(db, 'vault_meta', 'vault'))).toBe(before); expect(await idbRun(db, 'entries', 'readonly', (o) => o.count())).toBe(1);
  });
});

describe('Fehlgeschlagene Schreibvorgänge melden keinen Erfolg', () => {
  it('Speichern eines Eintrags schlägt sichtbar fehl und der Zwischenspeicher bleibt unverändert', async () => {
    const s = await data.save(note('alt')); const real = db.transaction.bind(db);
    db.transaction = (st, mode) => { if (mode === 'readwrite') throw Object.assign(new Error('Speicher voll'), { name: 'QuotaExceededError' }); return real(st, mode); };
    await expect(data.save({ ...s, title: 'neu' })).rejects.toThrow(/Speicher voll/); expect(data.get(s.id).title).toBe('alt');
    await expect(data.save(note('zweiter'))).rejects.toThrow(); expect(data.all()).toHaveLength(1); db.transaction = real;
    await data.loadAll(db); expect(data.get(s.id).title).toBe('alt'); expect(data.all()).toHaveLength(1);
  });
  it('Löschen einer Datei: scheitert das Entfernen der Daten, wird es gemeldet statt verschwiegen', async () => {
    const m = await importFile(ctx, blob('a.pdf', pdf()), { kind: 'document' }); ctx.backend.deleteFile = async () => { throw new Error('weg'); };
    const r = await deleteFileFully(ctx, m); expect(r.leftover).toBe(true); expect(fd.docs()).toHaveLength(0);
    ctx.backend = new IdbBackend(db); expect((await checkIntegrity(db, ctx.backend)).orphanFiles).toEqual([m.id]); // Reste werden gemeldet, nicht still gelöscht
  });
});

describe('Wiederherstellung löscht nichts', () => {
  it('Einträge, die nur lokal existieren, bleiben bei „Vorhandenes behalten“ erhalten', async () => {
    await data.save(note('im Backup')); await importFile(ctx, blob('im-backup.pdf', pdf()), { kind: 'document' });
    const sink = new BlobSink(); const out = await writeBackup({ db, backend: ctx.backend, keys: sessionKeys() }, 'backup passwort 123', sink, { kdf: FAST });
    await data.save(note('nur lokal')); await importFile(ctx, blob('nur-lokal.pdf', pdf(150)), { kind: 'document' });
    const res = await applyBackup(sessionTarget(ctx), await openBackup(out.result, 'backup passwort 123'), { policy: 'overwrite' });  // sogar mit „überschreiben“
    expect(res.added + res.files.added).toBe(0); await data.loadAll(db); await fd.loadAll(db);
    expect(data.all().map((i) => i.title).sort()).toEqual(['im Backup', 'nur lokal']); expect(fd.docs().map((m) => m.name).sort()).toEqual(['im-backup.pdf', 'nur-lokal.pdf']);
    expect(await checkIntegrity(db, ctx.backend)).toMatchObject({ ok: true });
  });
});
