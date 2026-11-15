import { deriveAesKey } from '../crypto/hkdf.js';
// Schlüssel leben nur im Arbeitsspeicher dieser Sitzung (nie in LocalStorage/SessionStorage/IndexedDB).
let keys = null;
const listeners = new Set();
const emit = () => listeners.forEach((f) => f(keys !== null));
export const isUnlocked = () => keys !== null;
export const setKeys = (k) => { keys = k; emit(); };
export const lock = () => { if (keys) { keys = null; emit(); } };
export const onLockChange = (f) => { listeners.add(f); return () => listeners.delete(f); };
function need() { if (!keys) throw new Error('Tresor ist gesperrt'); return keys; }
export const key = (name) => need()[name];                       // 'entries' | 'index'
export const fileKey = (fileId) => deriveAesKey(need().master, 'file/' + fileId); // pro Datei eigener Schlüssel
export const sessionKeys = () => { const k = need(); return { master: k.master, entries: k.entries, fileKey: (id) => deriveAesKey(k.master, 'file/' + id) }; };
