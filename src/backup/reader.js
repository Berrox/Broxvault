import { deriveKek } from '../core/crypto/kdf.js';
import { decrypt } from '../core/crypto/aead.js';
import { readSlice, CHUNK_SIZE } from '../core/files/chunks.js';
import { fromB64 } from '../core/util.js';
import { MAGIC, FORMAT_VERSION, T, MAX_HEADER, MAX_FRAME, FRAME_PREFIX, BackupError, WrongBackupPasswordError, sha256, frameAad, parseChunkPayload } from './format.js';

const dec = new TextDecoder();
// Stufe 1 (ohne Passwort): Format, Header und Frame-Struktur bis zum Dateiende.
export async function readHeader(blob) {
  if (blob.size < 10) throw new BackupError('Die Datei ist zu klein: das ist kein BROX-VAULT-Backup.', 'format');
  const top = await readSlice(blob, 0, 10), dv = new DataView(top.buffer, top.byteOffset, 10);
  if (!MAGIC.every((v, i) => top[i] === v)) throw new BackupError('Das ist keine BROX-VAULT-Backupdatei (.bvx).', 'format');
  const version = dv.getUint16(4), hlen = dv.getUint32(6);
  if (version > FORMAT_VERSION) throw new BackupError('Das Backup stammt aus einer neueren App-Version (Format ' + version + '). Bitte die App aktualisieren.', 'version');
  if (version < 1) throw new BackupError('Unbekannte Formatversion.', 'version');
  if (hlen < 2 || hlen > MAX_HEADER || 10 + hlen > blob.size) throw new BackupError('Der Dateikopf ist beschädigt.', 'header');
  const bytes = await readSlice(blob, 0, 10 + hlen); let h;
  try { h = JSON.parse(dec.decode(bytes.subarray(10))); } catch { throw new BackupError('Der Dateikopf ist beschädigt.', 'header'); }
  const k = h && h.kdf;
  if (h.cipher !== 'AES-256-GCM' || !k || k.alg !== 'argon2id' || k.v !== 19 || typeof k.salt !== 'string') throw new BackupError('Verschlüsselungsverfahren wird nicht unterstützt.', 'header');
  if (!(k.m >= 8 && k.m <= 1048576 && k.t >= 1 && k.t <= 20 && k.p >= 1 && k.p <= 4)) throw new BackupError('Ungültige Schlüsselparameter im Dateikopf.', 'header');
  let salt; try { salt = fromB64(k.salt); } catch { salt = null; } if (!salt || salt.length < 8) throw new BackupError('Ungültiger Salt im Dateikopf.', 'header');
  return { version, kdf: { m: k.m, t: k.t, p: k.p }, salt, headerBytes: bytes, offset: 10 + hlen };
}
export async function inspectStructure(blob) {
  const h = await readHeader(blob); let off = h.offset, frames = 0, lastSeen = false, lastType = 0;
  while (off < blob.size) {
    if (lastSeen) throw new BackupError('Nach dem letzten Frame folgen unerwartete Daten.', 'structure');
    if (off + FRAME_PREFIX > blob.size) throw new BackupError('Die Datei ist abgeschnitten.', 'structure');
    const p = await readSlice(blob, off, off + FRAME_PREFIX), len = new DataView(p.buffer, p.byteOffset).getUint32(0);
    if (len < 29 || len > MAX_FRAME || off + FRAME_PREFIX + len > blob.size) throw new BackupError('Die Datei ist abgeschnitten oder beschädigt (Frame ' + (frames + 1) + ').', 'structure');
    if (p[5] === 1) { lastSeen = true; lastType = p[4]; } off += FRAME_PREFIX + len; frames++;
  }
  if (!frames || !lastSeen || lastType !== T.FOOTER) throw new BackupError('Der Abschluss der Datei fehlt: das Backup ist unvollständig.', 'structure');
  return { version: h.version, kdf: h.kdf, frames, size: blob.size };
}
// Stufe 2: Schlüssel ableiten, dann jeden Frame authentifizieren (nacheinander, ohne alles im Speicher zu halten).
export async function openBackup(blob, password) {
  const h = await readHeader(blob), hash = await sha256(h.headerBytes), key = await deriveKek(password, h.salt, h.kdf);
  async function* frames() {
    let off = h.offset, index = 0;
    while (off < blob.size) {
      if (off + FRAME_PREFIX > blob.size) throw new BackupError('Die Datei ist abgeschnitten.', 'structure');
      const p = await readSlice(blob, off, off + FRAME_PREFIX), len = new DataView(p.buffer, p.byteOffset).getUint32(0), type = p[4], last = p[5] === 1;
      if (len < 29 || len > MAX_FRAME || off + FRAME_PREFIX + len > blob.size) throw new BackupError('Die Datei ist abgeschnitten oder beschädigt (Frame ' + (index + 1) + ').', 'structure');
      let payload; try { payload = await decrypt(key, await readSlice(blob, off + FRAME_PREFIX, off + FRAME_PREFIX + len), frameAad(hash, index, type, last)); }
      catch { throw index === 0 ? new WrongBackupPasswordError() : new BackupError('Frame ' + (index + 1) + ' ist beschädigt oder wurde verändert.', 'auth'); }
      yield { index, type, last, payload }; off += FRAME_PREFIX + len; index++;
      if (last) { if (off !== blob.size) throw new BackupError('Nach dem letzten Frame folgen unerwartete Daten.', 'structure'); return; }
    }
    throw new BackupError('Der Abschluss der Datei fehlt: das Backup ist unvollständig.', 'structure');
  }
  return { header: h, frames };
}
// Stufe 2 komplett: alles authentifizieren und auf Vollständigkeit prüfen (schreibt nichts).
export async function verifyBackup(bk, onProgress = () => {}) {
  let manifest = null, footer = null, frames = 0, records = 0, chunks = 0; const files = new Map(), seen = new Map(), stores = { entries: 0, categories: 0, files: 0 };
  for await (const f of bk.frames()) {
    frames++; onProgress(frames);
    if (f.index === 0) { if (f.type !== T.MANIFEST) throw new BackupError('Der erste Frame ist kein Manifest.', 'structure'); manifest = JSON.parse(dec.decode(f.payload)); continue; }
    if (f.type === T.RECORD) {
      let r; try { r = JSON.parse(dec.decode(f.payload)); } catch { throw new BackupError('Ein Datensatz im Backup ist nicht lesbar.', 'content'); }
      if (!(r.s in stores) || typeof r.id !== 'string' || !r.b) throw new BackupError('Ein Datensatz im Backup ist ungültig.', 'content');
      stores[r.s]++; records++; if (r.s === 'files') { if (!Number.isInteger(r.b.chunkCount) || r.b.chunkCount < 1) throw new BackupError('Ein Dateieintrag im Backup ist ungültig.', 'content'); files.set(r.id, r.b.chunkCount); seen.set(r.id, 0); }
    } else if (f.type === T.CHUNK) {
      const c = parseChunkPayload(f.payload); if (!files.has(c.fileId)) throw new BackupError('Ein Datei-Chunk gehört zu keiner Datei im Backup.', 'content');
      if (c.index !== seen.get(c.fileId) || c.data.length > CHUNK_SIZE) throw new BackupError('Datei-Chunks sind in falscher Reihenfolge oder zu groß.', 'content'); seen.set(c.fileId, c.index + 1); chunks++;
    } else if (f.type === T.FOOTER && f.last) footer = JSON.parse(dec.decode(f.payload));
    else throw new BackupError('Unerwarteter Frame-Typ.', 'structure');
  }
  if (!footer || footer.frames !== frames || footer.records !== records || footer.chunks !== chunks) throw new BackupError('Die Prüfsummen im Abschluss stimmen nicht mit dem Inhalt überein.', 'content');
  for (const [id, n] of files) if (seen.get(id) !== n) throw new BackupError('Dem Backup fehlen Teile einer Datei.', 'content');
  const mc = manifest.counts; if (mc.entries !== stores.entries || mc.categories !== stores.categories || mc.files !== stores.files || mc.chunks !== chunks) throw new BackupError('Das Manifest stimmt nicht mit dem Inhalt überein.', 'content');
  return { manifest, frames, records, chunks, stores };
}
