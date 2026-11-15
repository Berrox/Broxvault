const ROOT = 'brox-chunks', pad = (i) => String(i).padStart(8, '0') + '.bin';
export class OpfsBackend {
  kind = 'opfs';
  static available() { return typeof Worker !== 'undefined' && !!navigator.storage && typeof navigator.storage.getDirectory === 'function'; }
  constructor() {
    this.w = new Worker(new URL('./opfs-worker.js', import.meta.url), { type: 'module' }); this.n = 0; this.p = new Map();
    this.w.onmessage = ({ data: { id, ok, result, error } }) => { const h = this.p.get(id); this.p.delete(id); ok ? h.res(result) : h.rej(new Error(error)); };
    this.w.onerror = () => { for (const h of this.p.values()) h.rej(new Error('OPFS-Worker Fehler')); this.p.clear(); };
  }
  call(op, dir, name, data) {
    return new Promise((res, rej) => { const id = ++this.n; this.p.set(id, { res, rej }); this.w.postMessage({ id, op, dir, name, data }, data ? [data.buffer] : []); });
  }
  async probe() {
    const d = new Uint8Array([1, 2, 3, 4]);
    await this.call('write', [ROOT, '__probe'], 'p.bin', d.slice());
    const back = await this.call('read', [ROOT, '__probe'], 'p.bin');
    await this.call('removeDir', [ROOT], '__probe');
    if (back.length !== 4 || back.some((v, i) => v !== d[i])) throw new Error('OPFS-Probe fehlgeschlagen');
  }
  putChunk(id, i, bytes) { return this.call('write', [ROOT, id], pad(i), bytes.slice()); }
  getChunk(id, i) { return this.call('read', [ROOT, id], pad(i)); }
  async listChunks(id) { return (await this.call('list', [ROOT, id])).map((n) => parseInt(n, 10)).sort((a, b) => a - b); }
  async listFileIds() { return (await this.call('listDirs', [ROOT])).filter((n) => n !== '__probe'); }
  deleteFile(id) { return this.call('removeDir', [ROOT], id); }
}
