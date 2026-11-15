import { encrypt, decrypt } from '../crypto/aead.js';
import { fileKey } from '../keys/session.js';
import { enc } from '../util.js';
export const CHUNK_SIZE = 1024 * 1024; // 1 MiB: schont den Arbeitsspeicher, auf dem iPhone zu messen
// AAD bindet jeden Chunk an Datei-ID, Position und „letzter Chunk“ (gegen Umsortieren, Austausch und Abschneiden).
const aad = (fileId, i, last) => enc.encode(`BV1chunk|${fileId}|${i}|${last ? 1 : 0}`);
export const sealChunk = (k, fileId, i, last, bytes) => encrypt(k, bytes, aad(fileId, i, last));
export const openChunk = (k, fileId, i, last, env) => decrypt(k, env, aad(fileId, i, last));
// Schreibt die Chunks einzeln; die Datei gilt erst als vollständig, wenn der Aufrufer danach den Metadatensatz speichert.
export async function writeChunks(backend, fileId, bytes, size = CHUNK_SIZE) {
  const n = Math.max(1, Math.ceil(bytes.length / size)), k = await fileKey(fileId);
  for (let i = 0; i < n; i++) await backend.putChunk(fileId, i, await sealChunk(k, fileId, i, i === n - 1, bytes.subarray(i * size, (i + 1) * size)));
  return n;
}

// ---- Phase 6: Streaming-Import und -Lesen ----
// Liest immer nur ein Stück (1 MiB) der Datei in den Arbeitsspeicher.
export const readBytes = async (b) => (b.arrayBuffer ? new Uint8Array(await b.arrayBuffer())
  : new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(new Uint8Array(r.result)); r.onerror = () => rej(r.error); r.readAsArrayBuffer(b); }));
export const readSlice = (blob, a, b) => readBytes(blob.slice(a, b));
export async function writeBlobChunks(backend, fileId, blob, size = CHUNK_SIZE, onProgress = () => {}) {
  const n = Math.max(1, Math.ceil(blob.size / size)), k = await fileKey(fileId);
  for (let i = 0; i < n; i++) { await backend.putChunk(fileId, i, await sealChunk(k, fileId, i, i === n - 1, await readSlice(blob, i * size, (i + 1) * size))); onProgress((i + 1) / n); }
  return n;
}
// Entschlüsselt ALLE Chunks (jeder wird geprüft); bei der kleinsten Abweichung wird nichts ausgegeben.
export async function readAllChunks(backend, fileId, n) {
  const k = await fileKey(fileId), parts = [];
  for (let i = 0; i < n; i++) parts.push(await openChunk(k, fileId, i, i === n - 1, await backend.getChunk(fileId, i)));
  return parts;
}
