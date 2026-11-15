import { idbGet, idbPut, idbRun } from './idb.js';
import { encrypt, decrypt } from '../crypto/aead.js';
import { key } from '../keys/session.js';
import { enc } from '../util.js';
// Verschlüsselte Datensätze. In IndexedDB liegen nur: ID, Schema-Version, Revision und der Umschlag.
// AAD bindet Store, ID und Revision. Hinweis: das Zurückspielen eines kompletten älteren Datensatzes (Rollback) wird dadurch nicht erkannt.
const dec = new TextDecoder();
const aad = (store, id, rv) => enc.encode(`BV1|${store}|${id}|${rv}`);
export async function getRecordWith(db, store, id, entriesKey) {
  const r = await idbGet(db, store, id);
  return r ? JSON.parse(dec.decode(await decrypt(entriesKey, r.env, aad(store, id, r.rv)))) : null;
}
export async function putRecordWith(db, store, id, obj, entriesKey) {
  const old = await idbGet(db, store, id), rv = old ? old.rv + 1 : 1;
  const env = await encrypt(entriesKey, enc.encode(JSON.stringify(obj)), aad(store, id, rv));
  await idbPut(db, store, id, { v: 1, rv, env });
  if (JSON.stringify(await getRecordWith(db, store, id, entriesKey)) !== JSON.stringify(obj)) throw new Error('Speichern konnte nicht bestätigt werden');
}
export const getRecord = (db, store, id) => getRecordWith(db, store, id, key('entries'));
export const putRecord = (db, store, id, obj) => putRecordWith(db, store, id, obj, key('entries'));
export const listIds = (db, store) => idbRun(db, store, 'readonly', (o) => o.getAllKeys());
// Löschen nur nach ausdrücklicher Bestätigung durch die Oberfläche (Phase 5+).
export const deleteRecord = (db, store, id) => idbRun(db, store, 'readwrite', (o) => o.delete(id));
