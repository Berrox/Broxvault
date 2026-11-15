import { describe, it, expect } from 'vitest';
import { encrypt, decrypt } from '../src/core/crypto/aead.js';
import { deriveKek } from '../src/core/crypto/kdf.js';
import { randomBytes } from '../src/core/crypto/random.js';
import { enc } from '../src/core/util.js';

const aesKey = () => crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
const aad = enc.encode('BV1|test|id1|1');
const hex = (u8) => Buffer.from(u8).toString('hex');

describe('AES-256-GCM', () => {
  it('verschlüsselt und entschlüsselt korrekt', async () => {
    const k = await aesKey(), p = enc.encode('geheim');
    expect(await decrypt(k, await encrypt(k, p, aad), aad)).toEqual(p);
  });
  it('lehnt falschen Schlüssel ab', async () => {
    const env = await encrypt(await aesKey(), enc.encode('x'), aad);
    await expect(decrypt(await aesKey(), env, aad)).rejects.toThrow();
  });
  it('erkennt manipulierten Ciphertext, Tag, Nonce und Version', async () => {
    const k = await aesKey(), env = await encrypt(k, enc.encode('hallo welt'), aad);
    for (const i of [0, 5, 14, env.length - 1]) { const bad = env.slice(); bad[i] ^= 1; await expect(decrypt(k, bad, aad)).rejects.toThrow(); }
  });
  it('erkennt abgeschnittene Daten', async () => {
    const k = await aesKey(), env = await encrypt(k, enc.encode('hallo welt'), aad);
    await expect(decrypt(k, env.slice(0, env.length - 3), aad)).rejects.toThrow();
  });
  it('bindet Daten an die AAD (Datensatz-ID/Version)', async () => {
    const k = await aesKey(), env = await encrypt(k, enc.encode('x'), aad);
    await expect(decrypt(k, env, enc.encode('BV1|test|id2|1'))).rejects.toThrow();
  });
  it('verwendet pro Operation einen neuen Nonce (20.000 Stichproben, keine Kollision)', async () => {
    const k = await aesKey(), seen = new Set();
    for (let i = 0; i < 20000; i++) seen.add(hex((await encrypt(k, new Uint8Array(1), aad)).subarray(1, 13)));
    expect(seen.size).toBe(20000);
  });
  it('Zufallszahlen haben die richtige Länge und wiederholen sich nicht', () => {
    expect(randomBytes(32)).toHaveLength(32);
    expect(hex(randomBytes(32))).not.toBe(hex(randomBytes(32)));
  });
});

describe('Argon2id (hash-wasm 4.12.0)', () => {
  // Erwartete Werte stammen aus argon2-cffi (Referenz-Implementierung in C), nicht aus hash-wasm selbst.
  const salt = enc.encode('0123456789abcdef');
  const cases = [
    { m: 1024, t: 1, hex: '87e268f26133ac3646fc872f25bc8558b64e19088887261e9b719ff902df6ff9' },
    { m: 4096, t: 2, hex: '8edf8e6da7e9869279730ec831bbb29f6a6d9a9c653f348c2ad963e2a26e9ecc' },
    { m: 65536, t: 3, hex: '00bac562b407875296682e0b8043688e09be94fcea326e99aa62d0edb44404fc' },
  ];
  for (const c of cases) it(`stimmt mit der Referenz überein (m=${c.m} KiB, t=${c.t})`, async () => {
    const { argon2id } = await import('hash-wasm');
    const out = await argon2id({ password: enc.encode('correct horse battery'), salt, parallelism: 1, iterations: c.t, memorySize: c.m, hashLength: 32, outputType: 'hex' });
    expect(out).toBe(c.hex);
  });
  it('deriveKek liefert einen nicht exportierbaren Schlüssel', async () => {
    const k = await deriveKek('correct horse battery', salt, { m: 1024, t: 1, p: 1 });
    expect(k.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('raw', k)).rejects.toThrow();
  });
});
