import { randomBytes } from './random.js';
// Umschlag: Version(1 B) | Nonce(12 B) | Ciphertext + GCM-Tag(16 B). Pro Operation ein neuer Zufalls-Nonce.
const VERSION = 1;
export async function encrypt(key, plain, aad) {
  const nonce = randomBytes(12);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: aad, tagLength: 128 }, key, plain));
  const out = new Uint8Array(13 + ct.length);
  out[0] = VERSION; out.set(nonce, 1); out.set(ct, 13);
  return out;
}
export async function decrypt(key, env, aad) {
  if (env.length < 29 || env[0] !== VERSION) throw new Error('Ungültiges Datenformat');
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: env.subarray(1, 13), additionalData: aad, tagLength: 128 }, key, env.subarray(13)));
}
