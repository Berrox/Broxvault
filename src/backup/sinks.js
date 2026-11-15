import { BackupError } from './format.js';
export const BLOB_LIMIT = 400 * 1024 * 1024; // ohne Streaming muss das ganze Backup im Arbeitsspeicher liegen (iOS!)
export class BlobSink {
  constructor(limit = BLOB_LIMIT) { this.parts = []; this.size = 0; this.limit = limit; }
  async write(u8) { this.size += u8.length; if (this.size > this.limit) throw new BackupError('Das Backup ist zu groß für den Download in diesem Browser. Nutze Chrome oder Edge am Desktop (Speichern direkt in eine Datei).', 'size'); this.parts.push(u8); }
  async close() { this.blob = new Blob(this.parts, { type: 'application/octet-stream' }); this.parts = []; return this.blob; }
  async abort() { this.parts = []; }
}
export class StreamSink {
  constructor(writable) { this.w = writable; this.size = 0; }
  write(u8) { this.size += u8.length; return this.w.write(u8); }
  close() { return this.w.close(); }
  async abort() { try { await this.w.abort(); } catch { /* ignorieren */ } }
}
