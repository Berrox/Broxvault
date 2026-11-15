import { argon2id } from 'hash-wasm';
import { enc } from '../util.js';
// Master-Passwort (NFKC, UTF-8) -> Argon2id -> 32 Byte -> nicht exportierbarer AES-GCM-Schlüssel (KEK).
export async function deriveKek(password, salt, { m, t, p }) {
  const pw = enc.encode(password.normalize('NFKC'));
  const raw = await argon2id({ password: pw, salt, parallelism: p, iterations: t, memorySize: m, hashLength: 32, outputType: 'binary' });
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
  raw.fill(0); pw.fill(0);
  return key;
}
