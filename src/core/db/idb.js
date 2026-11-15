// Versionierte, ausschließlich additive Migrationen. Neue Migration = neuer Eintrag am Ende; bestehende nie ändern.
// Die Datenbank wird NIE automatisch gelöscht oder neu angelegt. Ein abgebrochenes Upgrade lässt den alten Stand unverändert
// (IndexedDB-Upgrades laufen in einer einzigen Transaktion).
export const migrations = [
  (db) => { db.createObjectStore('vault_meta'); db.createObjectStore('settings'); },                              // 1: Phase 3
  (db) => { for (const s of ['entries', 'categories', 'files', 'chunks']) db.createObjectStore(s); },            // 2: Phase 4
];
export const openDb = (name = 'brox-vault', migs = migrations) => new Promise((resolve, reject) => {
  const r = indexedDB.open(name, migs.length); // ältere App + neuere Datenbank => VersionError, es wird nichts verändert
  r.onupgradeneeded = (e) => {
    try { for (let v = e.oldVersion; v < migs.length; v++) migs[v](r.result, r.transaction); }
    catch (err) { try { r.transaction.abort(); } catch { /* bereits abgebrochen */ } reject(err); }
  };
  r.onsuccess = () => {
    const db = r.result;
    db.onversionchange = () => { db.close(); if (typeof window !== 'undefined') window.dispatchEvent(new Event('brox-db-versionchange')); }; // neuere Version in anderem Tab: Verbindung freigeben
    resolve(db);
  };
  r.onerror = () => reject(r.error);
  r.onblocked = () => reject(new Error('Datenbank ist blockiert'));
});
// Erfolg erst, wenn die Transaktion wirklich abgeschlossen ist.
export const idbRun = (db, store, mode, fn) => new Promise((resolve, reject) => {
  const tx = db.transaction(store, mode); let out;
  const req = fn(tx.objectStore(store));
  const fail = () => reject(req.error || tx.error || new Error('Datenbankvorgang fehlgeschlagen'));
  req.onsuccess = () => { out = req.result; };
  tx.oncomplete = () => resolve(out);
  tx.onerror = fail; tx.onabort = fail;
});
export const idbGet = (db, s, k) => idbRun(db, s, 'readonly', (o) => o.get(k));
export const idbPut = (db, s, k, v) => idbRun(db, s, 'readwrite', (o) => o.put(v, k));
export const idbAdd = (db, s, k, v) => idbRun(db, s, 'readwrite', (o) => o.add(v, k));
export const createMetaStore = (db) => ({
  get: async () => (await idbGet(db, 'vault_meta', 'vault')) ?? null,
  create: (v) => idbAdd(db, 'vault_meta', 'vault', v),   // schlägt fehl, wenn schon vorhanden
  replace: (v) => idbPut(db, 'vault_meta', 'vault', v),
});
