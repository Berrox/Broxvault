import { writeBlobChunks, writeChunks, readAllChunks, readSlice, CHUNK_SIZE } from '../core/files/chunks.js';
import { storageStatus } from '../core/storage-status.js';
import { onLockChange } from '../core/keys/session.js';
import * as fd from './filedata.js';

export const MAX_FILE_BYTES = 100 * 1024 * 1024; // Startlimit; auf dem iPhone zu messen (Anzeige braucht die ganze Datei im Arbeitsspeicher)
export class ImportError extends Error {}
const DOC_TYPES = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', txt: 'text/plain' };
export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// Der Inhalt entscheidet, nicht die Endung: Endung und Dateikopf müssen zusammenpassen.
export function sniff(head, name) {
  const want = DOC_TYPES[(name.split('.').pop() || '').toLowerCase()]; if (!want) return null;
  const at = (a, o = 0) => a.every((v, i) => head[o + i] === v); let got = null;
  if (at([0x25, 0x50, 0x44, 0x46])) got = 'application/pdf';
  else if (at([0xff, 0xd8, 0xff])) got = 'image/jpeg';
  else if (at([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) got = 'image/png';
  else if (at([0x52, 0x49, 0x46, 0x46]) && at([0x57, 0x45, 0x42, 0x50], 8)) got = 'image/webp';
  else if (!head.includes(0)) { try { new TextDecoder('utf-8', { fatal: true }).decode(head, { stream: true }); got = 'text/plain'; } catch { /* kein Text */ } }
  return got === want ? got : null;
}

// Blob-URLs gibt es nur kurz und werden beim Verlassen der Ansicht und beim Sperren widerrufen.
const urls = new Set();
export const makeUrl = (blob) => { const u = URL.createObjectURL(blob); urls.add(u); return u; };
export const releaseUrl = (u) => { if (urls.delete(u)) URL.revokeObjectURL(u); };
export const revokeAll = () => { for (const u of urls) URL.revokeObjectURL(u); urls.clear(); };
onLockChange((unlocked) => { if (!unlocked) revokeAll(); });

export async function browserThumb(blob) {
  const bmp = await createImageBitmap(blob), s = Math.min(1, 320 / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * s)), h = Math.max(1, Math.round(bmp.height * s));
  const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(bmp, 0, 0, w, h);
  const out = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.8)); if (!out) throw new Error('Vorschaubild konnte nicht erzeugt werden');
  const res = { bytes: new Uint8Array(await out.arrayBuffer()), width: bmp.width, height: bmp.height }; bmp.close && bmp.close(); return res; // Canvas entfernt EXIF aus der Vorschau
}

export async function importFile(ctx, file, { kind = 'document', folderId = null, albumId = null, onProgress } = {}) {
  if (file.size > MAX_FILE_BYTES) throw new ImportError('Die Datei ist größer als ' + MAX_FILE_BYTES / 1048576 + ' MiB.');
  const mime = sniff(await readSlice(file, 0, 8192), file.name || '');
  if (!mime) throw new ImportError('Dateityp nicht unterstützt oder Inhalt passt nicht zur Endung (erlaubt: PDF, JPG, PNG, WEBP, TXT).');
  if (kind === 'photo' && !PHOTO_TYPES.includes(mime)) throw new ImportError('Fotos müssen JPG, PNG oder WEBP sein.');
  const st = await storageStatus(); if (st.available != null && file.size * 1.1 > st.available) throw new ImportError('Nicht genug freier Speicher.');
  const id = crypto.randomUUID(), chunked = [], metaIds = [];
  try {
    chunked.push(id); const chunkCount = await writeBlobChunks(ctx.backend, id, file, CHUNK_SIZE, onProgress);
    let width = null, height = null, thumbId = null;
    if (kind === 'photo') {
      const t = await (ctx.thumbMaker || browserThumb)(file); width = t.width; height = t.height; thumbId = crypto.randomUUID();
      chunked.push(thumbId); const n = await writeChunks(ctx.backend, thumbId, t.bytes);
      await fd.saveMeta({ id: thumbId, kind: 'thumb', parent: id, mime: 'image/jpeg', size: t.bytes.length, chunkCount: n }); metaIds.push(thumbId);
    }
    // Der Metadatensatz kommt zuletzt: erst damit gilt die Datei als vollständig.
    return await fd.saveMeta({ id, kind, name: String(file.name).replace(/[\\/]/g, '_'), mime, size: file.size, chunkCount, folderId, albumId, category: '', description: '', favorite: false, width, height, thumbId });
  } catch (e) {
    for (const m of metaIds) { try { await fd.removeMeta(m); } catch { /* wird von der Integritätsprüfung gemeldet */ } }
    for (const c of chunked) { try { await ctx.backend.deleteFile(c); } catch { /* eigene Entwurfsdaten */ } }
    throw e instanceof ImportError ? e : new ImportError(e && e.name === 'QuotaExceededError' ? 'Der Speicher ist voll.' : 'Import fehlgeschlagen: nichts wurde gespeichert.');
  }
}
export const readParts = (ctx, meta) => readAllChunks(ctx.backend, meta.id, meta.chunkCount);
export const openBlob = async (ctx, meta) => new Blob(await readParts(ctx, meta), { type: meta.mime });
export const updateMeta = (meta, changes) => fd.saveMeta({ ...meta, ...changes });
export async function deleteFileFully(ctx, meta) {
  const ids = [meta.id, meta.thumbId].filter(Boolean);
  for (const id of ids.slice().reverse()) await fd.removeMeta(id);   // erst die Einträge, dann die Daten
  let leftover = false; for (const id of ids) { try { await ctx.backend.deleteFile(id); } catch { leftover = true; } }
  return { leftover };
}
