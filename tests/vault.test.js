import { describe, it, expect, beforeEach } from 'vitest';
import { createVault, unlock, changePassword, WrongPasswordError, VaultExistsError, WeakPasswordError } from '../src/core/keys/vault.js';
import { key, fileKey, lock, isUnlocked } from '../src/core/keys/session.js';
import { encrypt, decrypt } from '../src/core/crypto/aead.js';
import { enc } from '../src/core/util.js';
import { memStore } from './memstore.js';

const FAST = { m: 1024, t: 1, p: 1 }, PW = 'ein sehr langes passwort', aad = enc.encode('BV1|t|1|1');
let store;
beforeEach(() => { lock(); store = memStore(); });

describe('Tresor', () => {
  it('erstellt einen Tresor und entsperrt ihn', async () => {
    await createVault(PW, store, FAST); expect(isUnlocked()).toBe(true);
    lock(); expect(isUnlocked()).toBe(false);
    await unlock(PW, store); expect(isUnlocked()).toBe(true);
  });
  it('lehnt falsches Master-Passwort ab', async () => {
    await createVault(PW, store, FAST); lock();
    await expect(unlock('falsches passwort!!', store)).rejects.toBeInstanceOf(WrongPasswordError);
    expect(isUnlocked()).toBe(false);
  });
  it('lehnt zu kurze Passwörter ab', async () => {
    await expect(createVault('kurz', store, FAST)).rejects.toBeInstanceOf(WeakPasswordError);
    expect(store._raw()).toBeNull();
  });
  it('überschreibt nie einen vorhandenen Tresor', async () => {
    await createVault(PW, store, FAST); const before = JSON.stringify(store._raw());
    await expect(createVault('anderes langes passwort', store, FAST)).rejects.toBeInstanceOf(VaultExistsError);
    expect(JSON.stringify(store._raw())).toBe(before);
  });
  it('speichert weder Passwort noch Klartext-Tresorschlüssel', async () => {
    await createVault(PW, store, FAST);
    const raw = JSON.stringify(store._raw());
    expect(raw).not.toContain(PW);
    expect(Object.keys(store._raw()).sort()).toEqual(['formatVersion', 'kdf', 'vaultId', 'wrappedVK']);
  });
  it('erkennt manipulierten verpackten Schlüssel', async () => {
    await createVault(PW, store, FAST); lock();
    const m = store._raw(), b = Buffer.from(m.wrappedVK, 'base64'); b[20] ^= 1; m.wrappedVK = b.toString('base64');
    await expect(unlock(PW, store)).rejects.toBeInstanceOf(WrongPasswordError);
  });
  it('bindet den verpackten Schlüssel an die Tresor-ID (AAD)', async () => {
    await createVault(PW, store, FAST); lock();
    store._raw().vaultId = crypto.randomUUID();
    await expect(unlock(PW, store)).rejects.toBeInstanceOf(WrongPasswordError);
  });
  it('weist manipulierte KDF-Parameter zurück', async () => {
    await createVault(PW, store, FAST); lock();
    store._raw().kdf.m = 4294967295;
    await expect(unlock(PW, store)).rejects.toThrow();
  });
  it('sperren entfernt die Schlüssel', async () => {
    await createVault(PW, store, FAST); lock();
    expect(() => key('entries')).toThrow(); expect(() => fileKey('a')).toThrow();
  });
  it('Teilschlüssel sind getrennt (entries ≠ index ≠ Datei-Schlüssel)', async () => {
    await createVault(PW, store, FAST);
    const env = await encrypt(key('entries'), enc.encode('x'), aad);
    await expect(decrypt(key('index'), env, aad)).rejects.toThrow();
    await expect(decrypt(await fileKey('f1'), env, aad)).rejects.toThrow();
    const f1 = await encrypt(await fileKey('f1'), enc.encode('x'), aad);
    await expect(decrypt(await fileKey('f2'), f1, aad)).rejects.toThrow();
  });
  it('Passwortwechsel: altes ungültig, neues gültig, Daten bleiben lesbar', async () => {
    await createVault(PW, store, FAST);
    const env = await encrypt(key('entries'), enc.encode('wichtig'), aad); lock();
    await changePassword(PW, 'neues langes passwort 2', store);
    await expect(unlock(PW, store)).rejects.toBeInstanceOf(WrongPasswordError);
    await unlock('neues langes passwort 2', store);
    expect(new TextDecoder().decode(await decrypt(key('entries'), env, aad))).toBe('wichtig');
  });
  it('Passwortwechsel mit falschem altem Passwort ändert nichts', async () => {
    await createVault(PW, store, FAST); const before = JSON.stringify(store._raw());
    await expect(changePassword('falsches passwort!!', 'neues langes passwort 2', store)).rejects.toBeInstanceOf(WrongPasswordError);
    expect(JSON.stringify(store._raw())).toBe(before);
  });
  it('meldet Fehler, wenn das Speichern nicht bestätigt werden kann', async () => {
    const bad = { ...memStore(), create: async () => {} }; // „schreibt“ nichts
    await expect(createVault(PW, bad, FAST)).rejects.toThrow();
    expect(isUnlocked()).toBe(false);
  });
});
