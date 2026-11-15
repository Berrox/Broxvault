import { importMaster, deriveAesKey } from '../crypto/hkdf.js';
// Schlüsselbund aus einem Tresorschlüssel (für Probewiederherstellung in einer Wegwerf-Datenbank).
export async function keyringFromVk(vk) {
  const master = await importMaster(vk), entries = await deriveAesKey(master, 'entries');
  return { master, entries, fileKey: (id) => deriveAesKey(master, 'file/' + id) };
}
