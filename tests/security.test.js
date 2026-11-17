import 'fake-indexeddb/auto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openDb, idbRun, createMetaStore } from '../src/core/db/idb.js';
import { IdbBackend } from '../src/core/files/idb-backend.js';
import { createVault, DEFAULT_KDF, unlock } from '../src/core/keys/vault.js';
import { lock } from '../src/core/keys/session.js';
import * as data from '../src/modules/data.js';
import * as fd from '../src/modules/filedata.js';
import { importFile } from '../src/modules/fileops.js';
import { saveSettings } from '../src/core/settings.js';

const walk = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
const strip = (s) => s.split('\n').filter((l) => !l.trim().startsWith('//')).map((l) => l.replace(/\s\/\/ .*$/, '')).join('\n');
const SRC = walk('src').filter((p) => p.endsWith('.js')).map((p) => ({ p, code: strip(readFileSync(p, 'utf8')) }));
const scan = (re, allowed = []) => SRC.filter(({ p, code }) => re.test(code) && !allowed.some((a) => p.endsWith(a))).map(({ p }) => p);

describe('Quelltext-Prüfung: verbotene Muster (siehe SECURITY.md)', () => {
  it('keine Schlüssel/Geheimnisse in LocalStorage, SessionStorage oder Cookies', () => { expect(scan(/\blocalStorage\b|\bsessionStorage\b|document\.cookie/)).toEqual([]); });
  it('keine unsichere HTML-Einbindung und keine dynamische Codeausführung', () => {
    expect(scan(/\.innerHTML|\.outerHTML|insertAdjacentHTML|document\.write|\beval\s*\(|new Function\s*\(|setTimeout\s*\(\s*['"`]|setInterval\s*\(\s*['"`]/)).toEqual([]);
  });
  it('keine externen Übertragungen: kein fetch im App-Code (nur im Service Worker), kein XHR/WebSocket/Beacon, keine Fremdadressen', () => {
    expect(scan(/\bfetch\s*\(/, ['sw.template.js'])).toEqual([]); expect(scan(/XMLHttpRequest|WebSocket|sendBeacon|EventSource|importScripts/)).toEqual([]);
    expect(scan(/https?:\/\/(?!www\.w3\.org)/)).toEqual([]);
  });
  it('keine vertraulichen Daten in Logs: kein console-Aufruf', () => { expect(scan(/\bconsole\s*\./)).toEqual([]); });
  it('Zufall nur aus der kryptografisch sicheren Quelle', () => { expect(scan(/Math\.random/)).toEqual([]); expect(scan(/crypto\.getRandomValues|crypto\.randomUUID/).length).toBeGreaterThan(3); });
  it('gefährliche Speicher-Operationen sind auf ihre vorgesehenen Stellen beschränkt', () => {
    expect(scan(/deleteDatabase/, ['backup/restore.js'])).toEqual([]);                 // nur die eigene Wegwerf-Datenbank der Probewiederherstellung
    expect(scan(/\bcaches\.delete|\bcaches\.open/, ['sw.template.js'])).toEqual([]);   // Cache nur im Service Worker
    expect(scan(/indexedDB\.open/, ['core/db/idb.js'])).toEqual([]);
    expect(scan(/\.deleteObjectStore|\.clear\(\)\s*[;,)]\s*$/m, ['modules/filedata.js', 'modules/data.js', 'modules/fileops.js'])).toEqual([]);
    expect(scan(/navigator\.clipboard/, ['modules/clipboard.js'])).toEqual([]);
  });
  it('kein Schlüssel- oder Passwortmaterial im Quelltext fest eingetragen', () => { expect(scan(/(password|passwort|secret|apikey|api_key|token)\s*[:=]\s*['"][^'"\s]{12,}['"]/i)).toEqual([]); expect(scan(/['"][A-Za-z0-9+\/]{40,}={0,2}['"]/)).toEqual([]); });
});

describe('Kryptografie-Parameter', () => {
  it('Argon2id-Standardparameter liegen über den üblichen Mindestwerten (OWASP: 19 MiB, 2 Durchläufe)', () => {
    expect(DEFAULT_KDF.m).toBeGreaterThanOrEqual(19 * 1024); expect(DEFAULT_KDF.t).toBeGreaterThanOrEqual(2); expect(DEFAULT_KDF.p).toBe(1);
  });
});

// ---- Gesamte IndexedDB nach einer ausgiebigen Sitzung: nirgends Klartext, überall eindeutige Nonces ----
const wipe = () => new Promise((res) => { const r = indexedDB.deleteDatabase('brox-vault'); r.onsuccess = r.onerror = () => res(); });
const flat = (v) => (v instanceof Uint8Array ? Buffer.from(v).toString('latin1') : Array.isArray(v) ? v.map(flat).join('|') : v && typeof v === 'object' ? Object.entries(v).map(([k, x]) => k + '=' + flat(x)).join('|') : String(v));
async function dump(db) { const out = {}; for (const name of db.objectStoreNames) { const tx = db.transaction(name), os = tx.objectStore(name), k = os.getAllKeys(), v = os.getAll(); await new Promise((r) => { tx.oncomplete = r; }); out[name] = { keys: k.result, vals: v.result }; } return out; }
const enc = (s) => new TextEncoder().encode(s);
let db, ctx;
beforeEach(async () => { lock(); await wipe(); db = await openDb(); await createVault('Geheimes-Master-Passwort-42', createMetaStore(db), { m: 1024, t: 1, p: 1 }); await data.loadAll(db); await fd.loadAll(db); ctx = { db, backend: new IdbBackend(db), thumbMaker: async () => ({ bytes: enc('THUMB-INHALT-GEHEIM'), width: 5, height: 5 }) }; });
afterEach(() => { db.close(); });

describe('Daten im Ruhezustand', () => {
  it('Gesamte Datenbank enthält keinen Klartext, und alle Nonces sind verschieden', async () => {
    const secrets = ['Zugang-Bank', 'anna.mustermann', 'Passw0rt-Geheim!', '4711-PIN', 'bank.example', 'Notiztext-Schatz', 'Kategorie-Finanzen', 'Feldname-Kunde', 'Feldwert-12345', 'Token-Geheim', 'Ordner-Steuerunterlagen', 'Album-Urlaub-2026', 'Bescheid-2025.pdf', 'Foto-Strand.jpg', 'DOKUMENT-INHALT-GEHEIM', 'Geheimes-Master-Passwort', 'Backup-Passwort'];
    await data.save({ type: 'password', title: 'Zugang-Bank', website: 'https://bank.example', username: 'anna.mustermann', password: 'Passw0rt-Geheim!', pin: '4711-PIN', category: 'Kategorie-Finanzen', favorite: true, custom: [{ name: 'Feldname-Kunde', value: 'Feldwert-12345', secret: false }, { name: 'Token', value: 'Token-Geheim', secret: true }] });
    await data.save({ type: 'note', title: 'Notiz', content: 'Notiztext-Schatz', custom: [], favorite: false, category: '' });
    const folder = await fd.saveFolder({ kind: 'folder', name: 'Ordner-Steuerunterlagen', parentId: null }), album = await fd.saveFolder({ kind: 'album', name: 'Album-Urlaub-2026' });
    const pdf = new Uint8Array(400); pdf.set(enc('%PDF-1.4\n')); pdf.set(enc('DOKUMENT-INHALT-GEHEIM'), 20); const jpg = new Uint8Array(400); jpg.set([0xff, 0xd8, 0xff, 0xe0]); jpg.set(enc('FOTO-INHALT-GEHEIM'), 20);
    await importFile(ctx, Object.assign(new Blob([pdf]), { name: 'Bescheid-2025.pdf' }), { kind: 'document', folderId: folder.id }); await importFile(ctx, Object.assign(new Blob([jpg]), { name: 'Foto-Strand.jpg' }), { kind: 'photo', albumId: album.id });
    await saveSettings(db, { lockMinutes: 5, lockOnHide: true, clipboardSeconds: 30, showPasswords: false, backupReminderDays: 30, lastBackupAt: 1, lastBackupTestAt: null });
    const all = await dump(db), text = flat(all); for (const s of [...secrets, 'FOTO-INHALT-GEHEIM', 'THUMB-INHALT-GEHEIM', '%PDF']) expect(text, s).not.toContain(s);
    // Was Klartext sein darf: nur Format-, KDF- und Einstellungswerte
    expect(Object.keys(all.vault_meta.vals.find((v) => v.formatVersion))).toEqual(['formatVersion', 'vaultId', 'kdf', 'wrappedVK']);
    expect(Object.keys(all.settings.vals[0]).sort()).toEqual(['backupReminderDays', 'clipboardSeconds', 'lastBackupAt', 'lastBackupTestAt', 'lockMinutes', 'lockOnHide', 'showPasswords']);
    const nonces = []; for (const s of ['entries', 'categories', 'files']) for (const r of all[s].vals) nonces.push(Buffer.from(r.env.subarray(1, 13)).toString('hex')); for (const c of all.chunks.vals) nonces.push(Buffer.from(c.subarray(1, 13)).toString('hex'));
    expect(nonces.length).toBeGreaterThanOrEqual(10); expect(new Set(nonces).size).toBe(nonces.length);
    for (const c of all.chunks.vals) expect(c[0]).toBe(1); // Formatversion des Umschlags
  });
  it('nach dem Sperren lassen sich die Daten ohne Passwort nicht lesen; falsches Passwort scheitert', async () => {
    await data.save({ type: 'note', title: 'X', content: 'Y', custom: [], favorite: false, category: '' }); lock(); expect(data.all()).toHaveLength(0);
    const { WrongPasswordError } = await import('../src/core/keys/vault.js'); await expect(unlock('falsch falsch falsch', (await import('../src/core/db/idb.js')).createMetaStore(db))).rejects.toBeInstanceOf(WrongPasswordError);
    expect(await idbRun(db, 'entries', 'readonly', (o) => o.count())).toBe(1);
  });
});
