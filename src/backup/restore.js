import { getRecordWith, putRecordWith } from '../core/db/records.js';
import { sealChunk } from '../core/files/chunks.js';
import { IdbBackend } from '../core/files/idb-backend.js';
import { openDb } from '../core/db/idb.js';
import { randomBytes } from '../core/crypto/random.js';
import { keyringFromVk } from '../core/keys/keyring.js';
import { sessionKeys } from '../core/keys/session.js';
import { checkIntegrity } from '../core/integrity.js';
import { T, BackupError, parseChunkPayload } from './format.js';
import { verifyBackup } from './reader.js';

const dec = new TextDecoder(), STORES = ['entries', 'categories', 'files'];
export const sessionTarget = (ctx) => { const k = sessionKeys(); return { db: ctx.db, backend: ctx.backend, master: k.master, entries: k.entries, fileKey: k.fileKey }; };

// Spielt ein bereits geprüftes Backup in ein Ziel ein. Nichts Vorhandenes wird ohne policy 'overwrite' angetastet.
// commit:false = Trockenlauf (zählt nur). Dateien gelten erst als vollständig, wenn der Metadatensatz nach dem letzten Chunk geschrieben ist.
export async function applyBackup(target, bk, { policy = 'keep', commit = true, onProgress = () => {} } = {}) {
  const { db, backend, entries, fileKey } = target;
  const r = { added: 0, unchanged: 0, conflicts: 0, replaced: 0, files: { added: 0, unchanged: 0, conflicts: 0, replaced: 0 }, chunks: 0 };
  const pending = new Map(), skip = new Set(), touched = new Set(); let frames = 0;
  try {
    for await (const f of bk.frames()) {
      onProgress(++frames);
      if (f.type === T.RECORD) {
        const { s, id, b } = JSON.parse(dec.decode(f.payload)); if (!STORES.includes(s)) throw new BackupError('Ungültiger Datensatz im Backup.');
        let existing = null, broken = false; try { existing = await getRecordWith(db, s, id, entries); } catch { broken = true; }
        const same = !!existing && JSON.stringify(existing) === JSON.stringify(b), isNew = !existing && !broken, c = s === 'files' ? r.files : r;
        if (isNew) { c.added++; } else if (same) { c.unchanged++; } else { c.conflicts++; if (policy === 'overwrite') c.replaced++; }
        const write = isNew || (!same && policy === 'overwrite');
        if (s === 'files') { if (write) pending.set(id, { b, next: 0, replace: !isNew }); else skip.add(id); }
        else if (write && commit) await putRecordWith(db, s, id, b, entries);
      } else if (f.type === T.CHUNK) {
        const c = parseChunkPayload(f.payload); if (skip.has(c.fileId)) continue;
        const p = pending.get(c.fileId); if (!p || c.index !== p.next) throw new BackupError('Datei-Chunks sind in falscher Reihenfolge.');
        if (commit) {
          if (p.next === 0 && p.replace) await backend.deleteFile(c.fileId); // erst nach ausdrücklicher Überschreib-Entscheidung
          touched.add(c.fileId); await backend.putChunk(c.fileId, c.index, await sealChunk(await fileKey(c.fileId), c.fileId, c.index, c.index === p.b.chunkCount - 1, c.data));
        }
        r.chunks++; p.next++;
        if (p.next === p.b.chunkCount) { if (commit) await putRecordWith(db, 'files', c.fileId, p.b, entries); pending.delete(c.fileId); }
      }
    }
    if (pending.size) throw new BackupError('Dem Backup fehlen Teile von Dateien.');
    return r;
  } catch (e) {
    if (commit) for (const id of pending.keys()) { if (touched.has(id)) { try { await backend.deleteFile(id); } catch { /* wird von der Integritätsprüfung gemeldet */ } } } // nur unvollständige Dateien aufräumen
    throw e;
  }
}

// Stufe 3: echte Probewiederherstellung in eine Wegwerf-Datenbank mit Wegwerf-Schlüsseln, danach Integritätsprüfung und restloses Aufräumen.
export async function verifyRestore(bk, onProgress = () => {}) {
  const name = 'brox-verify-' + crypto.randomUUID(), db = await openDb(name);
  try {
    const keys = await keyringFromVk(randomBytes(32)), backend = new IdbBackend(db), target = { db, backend, master: keys.master, entries: keys.entries, fileKey: keys.fileKey };
    const summary = await verifyBackup(bk); // Stufe 2 zuerst
    const res = await applyBackup(target, bk, { policy: 'overwrite', onProgress });
    const ig = await checkIntegrity(db, backend, () => {}, keys), mc = summary.manifest.counts;
    if (!ig.ok || ig.records !== mc.entries + mc.categories + mc.files || ig.chunks !== mc.chunks) throw new BackupError('Die Probewiederherstellung ist nicht vollständig gelungen.', 'restore');
    return { summary, applied: res, checked: { records: ig.records, files: ig.files, chunks: ig.chunks } };
  } finally { db.close(); await new Promise((res) => { const q = indexedDB.deleteDatabase(name); q.onsuccess = q.onerror = q.onblocked = () => res(); }); }
}
