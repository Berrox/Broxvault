import { putRecord, getRecord, listIds, deleteRecord } from '../core/db/records.js';
import { onLockChange } from '../core/keys/session.js';
import { SPECS } from './specs.js';
// Entschlüsselte Einträge leben nur im Arbeitsspeicher und werden beim Sperren verworfen.
const items = new Map();
let db = null, query = '', intent = null;
export const corrupt = [];
onLockChange((unlocked) => { if (!unlocked) { items.clear(); corrupt.length = 0; query = ''; intent = null; db = null; } });
export async function loadAll(d) {
  db = d; items.clear(); corrupt.length = 0;
  for (const id of await listIds(d, 'entries')) { try { items.set(id, { id, ...(await getRecord(d, 'entries', id)) }); } catch { corrupt.push(id); } }
}
export const all = (type) => [...items.values()].filter((i) => !type || i.type === type);
export const get = (id) => items.get(id);
export async function save(item) {
  const now = Date.now(), id = item.id || crypto.randomUUID(), { id: _drop, ...rest } = item;
  const body = { ...rest, createdAt: item.createdAt || now, updatedAt: now };
  await putRecord(db, 'entries', id, body);       // wirft, wenn das Speichern nicht bestätigt werden kann
  items.set(id, { id, ...body }); return items.get(id);
}
export async function remove(id) { await deleteRecord(db, 'entries', id); items.delete(id); }
// Durchsucht nur NICHT geheime Felder (Passwörter, PINs und geheime Zusatzfelder sind nie im Suchtext).
export function searchText(i) {
  const spec = SPECS[i.type]; if (!spec) return '';
  const parts = spec.fields.filter((fd) => fd.kind !== 'secret').map((fd) => i[fd.key]);
  parts.push(i.category); for (const c of i.custom || []) { parts.push(c.name); if (!c.secret) parts.push(c.value); }
  return parts.filter(Boolean).join(' ').toLowerCase();
}
export const matches = (i, q) => { const t = searchText(i); return q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => t.includes(w)); };
export const search = (q) => (q.trim() ? all().filter((i) => matches(i, q)).sort((a, b) => b.updatedAt - a.updatedAt) : []);
export const getQuery = () => query; export const setQuery = (q) => { query = q; };
export const setIntent = (x) => { intent = x; }; export const takeIntent = () => { const x = intent; intent = null; return x; };
export const ROUTE = { password: 'passwoerter', note: 'notizen', personal: 'persoenlich', document: 'dokumente', photo: 'fotos' };
export const openItem = (i) => { intent = { open: i.id }; location.hash = '#/' + ROUTE[i.type]; };
