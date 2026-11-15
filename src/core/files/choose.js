import { idbGet, idbAdd } from '../db/idb.js';
import { IdbBackend } from './idb-backend.js';
// Der Speicherort wird einmal festgelegt und in vault_meta/storage vermerkt. Es gibt KEIN stilles Umschalten:
// Ist OPFS festgelegt, aber gerade nicht nutzbar, melden alle Dateizugriffe einen Fehler (statt heimlich IndexedDB zu verwenden).
const failing = (error) => { const f = () => Promise.reject(new Error(error)); return { kind: 'opfs', putChunk: f, getChunk: f, listChunks: f, listFileIds: f, deleteFile: f }; };
async function defaultFactory() {
  const { OpfsBackend } = await import('./opfs-backend.js');
  if (!OpfsBackend.available()) throw Object.assign(new Error('OPFS nicht verfügbar'), { unsupported: true });
  return new OpfsBackend();
}
export async function openBackend(db, { opfsFactory = defaultFactory } = {}) {
  const saved = await idbGet(db, 'vault_meta', 'storage');
  const tryOpfs = async () => { const b = await opfsFactory(); await b.probe(); return b; };
  if (saved && saved.backend === 'idb') return { backend: new IdbBackend(db), info: { kind: 'idb', reason: saved.reason || null } };
  if (saved && saved.backend === 'opfs') {
    try { return { backend: await tryOpfs(), info: { kind: 'opfs' } }; }
    catch { const error = 'OPFS ist festgelegt, aber gerade nicht nutzbar. Es wurde nichts gelöscht und nichts umgeschaltet.'; return { backend: failing(error), info: { kind: 'opfs', error } }; }
  }
  try { const b = await tryOpfs(); await idbAdd(db, 'vault_meta', 'storage', { backend: 'opfs' }); return { backend: b, info: { kind: 'opfs' } }; }
  catch (e) {
    if (e && e.unsupported) { const reason = 'OPFS ist in diesem Browser nicht verfügbar'; await idbAdd(db, 'vault_meta', 'storage', { backend: 'idb', reason }); return { backend: new IdbBackend(db), info: { kind: 'idb', reason } }; }
    const error = 'OPFS konnte nicht geprüft werden. Bitte Seite neu laden; es wurde noch nichts festgelegt.'; return { backend: failing(error), info: { kind: 'opfs', error } };
  }
}
