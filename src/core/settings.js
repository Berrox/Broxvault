import { idbGet, idbPut } from './db/idb.js';
// Nicht vertrauliche Einstellungen (Klartext erlaubt: keine Geheimnisse).
const DEFAULTS = { lockMinutes: 5, lockOnHide: true, clipboardSeconds: 30, showPasswords: false, backupReminderDays: 30, lastBackupAt: null, lastBackupTestAt: null };
export const loadSettings = async (db) => ({ ...DEFAULTS, ...((await idbGet(db, 'settings', 'security')) || {}) });
export const saveSettings = (db, s) => idbPut(db, 'settings', 'security', s);
