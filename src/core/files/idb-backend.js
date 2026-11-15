import { idbRun } from '../db/idb.js';
const range = (id) => IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]);
// Ersatzlösung, wenn OPFS nicht nutzbar ist. Speichert nur bereits verschlüsselte Chunks.
export class IdbBackend {
  kind = 'idb';
  constructor(db) { this.db = db; }
  async putChunk(id, i, bytes) {
    await idbRun(this.db, 'chunks', 'readwrite', (o) => o.put(bytes, [id, i]));
    if ((await this.getChunk(id, i)).length !== bytes.length) throw new Error('Schreiben konnte nicht bestätigt werden');
  }
  async getChunk(id, i) {
    const v = await idbRun(this.db, 'chunks', 'readonly', (o) => o.get([id, i]));
    if (!v) throw new Error('Chunk fehlt'); return v;
  }
  async listChunks(id) { return (await idbRun(this.db, 'chunks', 'readonly', (o) => o.getAllKeys(range(id)))).map((k) => k[1]); }
  async listFileIds() { return [...new Set((await idbRun(this.db, 'chunks', 'readonly', (o) => o.getAllKeys())).map((k) => k[0]))]; }
  async deleteFile(id) { await idbRun(this.db, 'chunks', 'readwrite', (o) => o.delete(range(id))); }
}
