import { randomBytes } from '../crypto/random.js';
import { deriveKek } from '../crypto/kdf.js';
import { encrypt, decrypt } from '../crypto/aead.js';
import { importMaster, deriveAesKey } from '../crypto/hkdf.js';
import { setKeys } from './session.js';
import { enc, toB64, fromB64 } from '../util.js';

export const DEFAULT_KDF = { m: 65536, t: 3, p: 1 }; // KiB, Durchläufe, Parallelität – auf dem iPhone zu messen
export const MIN_PASSWORD_LENGTH = 12;
export class WrongPasswordError extends Error { constructor() { super('Falsches Passwort oder beschädigte Tresordaten'); } }
export class VaultExistsError extends Error { constructor() { super('Es existiert bereits ein Tresor'); } }
export class NoVaultError extends Error { constructor() { super('Kein Tresor vorhanden'); } }
export class WeakPasswordError extends Error { constructor() { super('Das Master-Passwort muss mindestens ' + MIN_PASSWORD_LENGTH + ' Zeichen lang sein'); } }

const aad = (vaultId) => enc.encode('BV1|vk-wrap|' + vaultId);
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const checkPw = (pw) => { if ([...pw.normalize('NFKC')].length < MIN_PASSWORD_LENGTH) throw new WeakPasswordError(); };
function readKdf(meta) {
  const k = meta && meta.kdf;
  if (!meta || meta.formatVersion !== 1 || !k || k.alg !== 'argon2id' || k.v !== 19) throw new Error('Unbekanntes Tresorformat');
  if (!(k.m >= 8 && k.m <= 1048576 && k.t >= 1 && k.t <= 20 && k.p >= 1 && k.p <= 4)) throw new Error('Ungültige Schlüsselparameter');
  return { m: k.m, t: k.t, p: k.p, salt: fromB64(k.salt) };
}
async function openVk(password, meta) {
  const { m, t, p, salt } = readKdf(meta);
  const kek = await deriveKek(password, salt, { m, t, p });
  try { return { vk: await decrypt(kek, fromB64(meta.wrappedVK), aad(meta.vaultId)), kek }; }
  catch { throw new WrongPasswordError(); }
}
async function activate(vk) {
  const master = await importMaster(vk);
  const [entries, index] = await Promise.all([deriveAesKey(master, 'entries'), deriveAesKey(master, 'index')]);
  setKeys({ master, entries, index });
  vk.fill(0);
}

export async function createVault(password, store, kdf = DEFAULT_KDF) {
  checkPw(password);
  if (await store.get()) throw new VaultExistsError();         // niemals einen vorhandenen Tresor überschreiben
  const vaultId = crypto.randomUUID(), salt = randomBytes(16), vk = randomBytes(32);
  const kek = await deriveKek(password, salt, kdf);
  const wrapped = await encrypt(kek, vk, aad(vaultId));
  if (!same(await decrypt(kek, wrapped, aad(vaultId)), vk)) throw new Error('Schlüsselprüfung fehlgeschlagen');
  const meta = { formatVersion: 1, vaultId, kdf: { alg: 'argon2id', v: 19, m: kdf.m, t: kdf.t, p: kdf.p, salt: toB64(salt) }, wrappedVK: toB64(wrapped) };
  await store.create(meta);
  if (JSON.stringify(await store.get()) !== JSON.stringify(meta)) throw new Error('Speichern konnte nicht bestätigt werden');
  await activate(vk);
  return meta.vaultId;
}

export async function unlock(password, store) {
  const meta = await store.get();
  if (!meta) throw new NoVaultError();
  const { vk } = await openVk(password, meta);
  await activate(vk);
}

// Alle Dateien bleiben unberührt: nur der Tresorschlüssel wird neu verpackt.
export async function changePassword(oldPassword, newPassword, store) {
  checkPw(newPassword);
  const meta = await store.get();
  if (!meta) throw new NoVaultError();
  const { vk } = await openVk(oldPassword, meta);
  const k = readKdf(meta), salt = randomBytes(16);
  const kek = await deriveKek(newPassword, salt, k);
  const wrapped = await encrypt(kek, vk, aad(meta.vaultId));
  if (!same(await decrypt(kek, wrapped, aad(meta.vaultId)), vk)) throw new Error('Schlüsselprüfung fehlgeschlagen');
  const next = { ...meta, kdf: { ...meta.kdf, salt: toB64(salt) }, wrappedVK: toB64(wrapped) };
  await store.replace(next);
  if (JSON.stringify(await store.get()) !== JSON.stringify(next)) throw new Error('Speichern konnte nicht bestätigt werden');
  vk.fill(0);
}
