import { enc } from '../util.js';
const SALT = new Uint8Array(32);
// Tresorschlüssel als nicht exportierbarer HKDF-Basisschlüssel; daraus getrennte Teilschlüssel.
export const importMaster = (vk) => crypto.subtle.importKey('raw', vk, 'HKDF', false, ['deriveKey']);
export const deriveAesKey = (master, label) => crypto.subtle.deriveKey(
  { name: 'HKDF', hash: 'SHA-256', salt: SALT, info: enc.encode('brox-vault/v1/' + label) },
  master, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
