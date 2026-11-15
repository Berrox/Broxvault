import { randomBytes } from '../core/crypto/random.js';
import { deriveKek } from '../core/crypto/kdf.js';
import { listIds, getRecordWith } from '../core/db/records.js';
import { openChunk } from '../core/files/chunks.js';
import { DEFAULT_KDF } from '../core/keys/vault.js';
import { toB64, enc } from '../core/util.js';
import { T, BackupError, buildHeader, sha256, encodeFrame, chunkPayload } from './format.js';
import { APP_VERSION } from '../version.js';
export { APP_VERSION };
const STORES = ['entries', 'categories', 'files'];

// src = { db, backend, keys: { entries, fileKey(id) } } – nur lesend. Jeder Datensatz und jeder Chunk wird entschlüsselt (und dabei geprüft)
// und sofort mit dem Backup-Schlüssel neu verschlüsselt. Bei beschädigten Daten gibt es KEIN (teilweises) Backup.
export async function writeBackup(src, password, sink, { onProgress = () => {}, kdf = DEFAULT_KDF } = {}) {
  const { db, backend, keys } = src;
  try {
    const ids = {}; for (const s of STORES) ids[s] = await listIds(db, s);
    const bodies = new Map(); // nur Datei-Metadaten werden vorab gelesen (für Zählung und Chunk-Reihenfolge)
    for (const id of ids.files) { try { bodies.set(id, await getRecordWith(db, 'files', id, keys.entries)); } catch { throw new BackupError('Ein Datei-Eintrag ist beschädigt. Bitte zuerst die Integritätsprüfung ausführen.', 'source'); } }
    const metas = [...bodies.values()], chunkTotal = metas.reduce((s, m) => s + m.chunkCount, 0), total = ids.entries.length + ids.categories.length + ids.files.length + chunkTotal + 2;
    const salt = randomBytes(16), header = buildHeader(kdf, salt, toB64), hash = await sha256(header), key = await deriveKek(password, salt, kdf);
    let index = 0, records = 0, chunks = 0, bytes = header.length;
    const put = async (type, last, payload) => { const f = await encodeFrame(key, hash, index++, type, last, payload); bytes += f.length; await sink.write(f); onProgress(Math.min(1, index / total)); };
    await sink.write(header);
    await put(T.MANIFEST, false, enc.encode(JSON.stringify({ app: 'brox-vault', appVersion: APP_VERSION, schema: 2, createdAt: new Date().toISOString(), counts: { entries: ids.entries.length, categories: ids.categories.length, files: ids.files.length, chunks: chunkTotal } })));
    for (const s of STORES) for (const id of ids[s]) {
      let b; try { b = s === 'files' ? bodies.get(id) : await getRecordWith(db, s, id, keys.entries); } catch { throw new BackupError('Ein Eintrag ist beschädigt. Bitte zuerst die Integritätsprüfung ausführen.', 'source'); }
      await put(T.RECORD, false, enc.encode(JSON.stringify({ s, id, b }))); records++;
    }
    for (const m of metas) {
      const fk = await keys.fileKey(m.id);
      for (let i = 0; i < m.chunkCount; i++) {
        let plain; try { plain = await openChunk(fk, m.id, i, i === m.chunkCount - 1, await backend.getChunk(m.id, i)); }
        catch { throw new BackupError('Die Datei „' + (m.name || 'Vorschaubild') + '“ ist beschädigt oder unvollständig. Bitte zuerst die Integritätsprüfung ausführen.', 'source'); }
        await put(T.CHUNK, false, chunkPayload(m.id, i, plain)); chunks++;
      }
    }
    await put(T.FOOTER, true, enc.encode(JSON.stringify({ frames: index + 1, records, chunks })));
    const result = await sink.close();
    return { frames: index, bytes, counts: { records, chunks }, result };
  } catch (e) { if (sink.abort) await sink.abort(); throw e; }
}
