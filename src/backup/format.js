import { encrypt } from '../core/crypto/aead.js';
import { enc } from '../core/util.js';
// .bvx Format 1 (siehe docs/BACKUP_FORMAT.md)
export const MAGIC = [0x42, 0x56, 0x58, 0x31]; // "BVX1"
export const FORMAT_VERSION = 1;
export const T = { MANIFEST: 1, RECORD: 2, CHUNK: 3, FOOTER: 4 };
export const MAX_HEADER = 65536, MAX_FRAME = 64 * 1024 * 1024, FRAME_PREFIX = 6;
export class BackupError extends Error { constructor(msg, code = 'invalid') { super(msg); this.code = code; } }
export class WrongBackupPasswordError extends BackupError { constructor() { super('Falsches Backup-Passwort oder beschädigte Datei', 'password'); } }

export const sha256 = async (u8) => new Uint8Array(await crypto.subtle.digest('SHA-256', u8));
export function buildHeader({ m, t, p }, salt, toB64) {
  const json = enc.encode(JSON.stringify({ kdf: { alg: 'argon2id', v: 19, m, t, p, salt: toB64(salt) }, cipher: 'AES-256-GCM' }));
  const out = new Uint8Array(10 + json.length), dv = new DataView(out.buffer);
  out.set(MAGIC, 0); dv.setUint16(4, FORMAT_VERSION); dv.setUint32(6, json.length); out.set(json, 10);
  return out;
}
// AAD = SHA-256(Header) | Frame-Nummer (u64) | Typ | letzter Frame. Bindet jeden Frame an Datei, Position und Rolle.
export function frameAad(headerHash, index, type, last) {
  const a = new Uint8Array(42); a.set(headerHash, 0); new DataView(a.buffer).setBigUint64(32, BigInt(index)); a[40] = type; a[41] = last ? 1 : 0; return a;
}
export async function encodeFrame(key, headerHash, index, type, last, payload) {
  const env = await encrypt(key, payload, frameAad(headerHash, index, type, last));
  const out = new Uint8Array(FRAME_PREFIX + env.length), dv = new DataView(out.buffer);
  dv.setUint32(0, env.length); out[4] = type; out[5] = last ? 1 : 0; out.set(env, FRAME_PREFIX); return out;
}
export const chunkPayload = (fileId, index, data) => {
  const id = enc.encode(fileId), out = new Uint8Array(2 + id.length + 4 + data.length), dv = new DataView(out.buffer);
  dv.setUint16(0, id.length); out.set(id, 2); dv.setUint32(2 + id.length, index); out.set(data, 6 + id.length); return out;
};
export function parseChunkPayload(p) {
  const dv = new DataView(p.buffer, p.byteOffset, p.byteLength), n = dv.getUint16(0);
  if (n < 1 || n > 200 || p.length < 6 + n) throw new BackupError('Ungültiger Chunk im Backup');
  return { fileId: new TextDecoder().decode(p.subarray(2, 2 + n)), index: dv.getUint32(2 + n), data: p.subarray(6 + n) };
}
