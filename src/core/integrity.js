import { getRecordWith, listIds } from './db/records.js';
import { openChunk } from './files/chunks.js';
import { sessionKeys } from './keys/session.js';
// Tresor-Integritätscheck: liest und prüft alles, verändert und löscht NICHTS.
export async function checkIntegrity(db, backend, onProgress = () => {}, keys = null) {
  keys = keys || sessionKeys();
  const r = { records: 0, files: 0, chunks: 0, corruptRecords: [], missingChunks: [], corruptChunks: [], extraChunks: [], orphanFiles: [], ok: true };
  const fileIds = new Set();
  for (const store of ['entries', 'categories', 'files']) {
    for (const id of await listIds(db, store)) {
      onProgress(store, id);
      let obj;
      try { obj = await getRecordWith(db, store, id, keys.entries); r.records++; } catch { r.corruptRecords.push({ store, id }); continue; }
      if (store !== 'files') continue;
      fileIds.add(id); r.files++;
      const n = obj.chunkCount, have = new Set(await backend.listChunks(id)), k = await keys.fileKey(id);
      for (let i = 0; i < n; i++) {
        if (!have.has(i)) { r.missingChunks.push({ id, index: i }); continue; }
        try { await openChunk(k, id, i, i === n - 1, await backend.getChunk(id, i)); r.chunks++; } catch { r.corruptChunks.push({ id, index: i }); }
      }
      for (const i of have) if (i >= n) r.extraChunks.push({ id, index: i });
    }
  }
  for (const id of await backend.listFileIds()) if (!fileIds.has(id)) r.orphanFiles.push(id); // nur melden, nie automatisch löschen
  r.ok = !r.corruptRecords.length && !r.missingChunks.length && !r.corruptChunks.length && !r.extraChunks.length;
  return r;
}
