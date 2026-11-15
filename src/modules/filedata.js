import { putRecord, getRecord, listIds, deleteRecord } from '../core/db/records.js';
import { onLockChange } from '../core/keys/session.js';
// Verschlüsselte Datei-Metadaten (Store „files“: Dokumente, Fotos, Vorschaubilder) und Ordner/Alben (Store „categories“).
// Im Arbeitsspeicher nur solange der Tresor entsperrt ist.
let db = null; const metas = new Map(), folders = new Map(); export const corrupt = [];
onLockChange((u) => { if (!u) { metas.clear(); folders.clear(); corrupt.length = 0; db = null; } });
export async function loadAll(d) {
  db = d; metas.clear(); folders.clear(); corrupt.length = 0;
  for (const id of await listIds(d, 'files')) { try { metas.set(id, { ...(await getRecord(d, 'files', id)), id }); } catch { corrupt.push(id); } }
  for (const id of await listIds(d, 'categories')) { try { folders.set(id, { ...(await getRecord(d, 'categories', id)), id }); } catch { corrupt.push(id); } }
}
export const docs = () => [...metas.values()].filter((m) => m.kind === 'document');
export const photos = () => [...metas.values()].filter((m) => m.kind === 'photo');
export const get = (id) => metas.get(id);
export async function saveMeta(m) {
  const now = Date.now(), body = { ...m, createdAt: m.createdAt || now, updatedAt: now };
  await putRecord(db, 'files', m.id, body); metas.set(m.id, body); return body;
}
export async function removeMeta(id) { await deleteRecord(db, 'files', id); metas.delete(id); }
export const listFolders = (kind) => [...folders.values()].filter((f) => f.kind === kind);
export const folder = (id) => folders.get(id);
export async function saveFolder(f) {
  const body = { ...f, id: f.id || crypto.randomUUID() };
  await putRecord(db, 'categories', body.id, body); folders.set(body.id, body); return body;
}
// Ordner nur löschen, wenn leer. Alben: Fotos bleiben erhalten und werden „ohne Album“.
export async function removeFolder(id) {
  const f = folders.get(id); if (!f) return;
  if (f.kind === 'folder') { if ([...metas.values()].some((m) => m.folderId === id) || [...folders.values()].some((x) => x.parentId === id)) throw new Error('Der Ordner ist nicht leer.'); }
  else for (const m of metas.values()) if (m.albumId === id) await saveMeta({ ...m, albumId: null });
  await deleteRecord(db, 'categories', id); folders.delete(id);
}
export const search = (q) => { const w = q.toLowerCase().split(/\s+/).filter(Boolean);
  return [...metas.values()].filter((m) => (m.kind === 'document' || m.kind === 'photo') && w.every((x) => [m.name, m.category, m.description].filter(Boolean).join(' ').toLowerCase().includes(x))).sort((a, b) => b.updatedAt - a.updatedAt); };
