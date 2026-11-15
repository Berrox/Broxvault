import 'fake-indexeddb/auto';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { openDb, createMetaStore, idbGet } from '../src/core/db/idb.js';
import { IdbBackend } from '../src/core/files/idb-backend.js';
import { createVault, unlock } from '../src/core/keys/vault.js';
import { lock } from '../src/core/keys/session.js';
import * as data from '../src/modules/data.js';

const SRC = readFileSync('src/pwa/sw.template.js', 'utf8'), SCOPE = 'https://user.github.io/brox-vault/';
const FILES = ['index.html', 'assets/app.js', 'assets/app.css', 'manifest.webmanifest', 'offline.html', 'icon-192.png'];
function makeSw({ version = 'v1', files = FILES, store = new Map(), net = async (u) => new Response('netz:' + u) } = {}) {
  const handlers = {}, fetchLog = [];
  const cachesApi = {
    open: async (n) => { if (!store.has(n)) store.set(n, new Map()); const m = store.get(n); return {
      addAll: async (urls) => { for (const u of urls) { fetchLog.push(u); const r = await net(u); if (!r.ok) throw new Error('Download fehlgeschlagen ' + u); m.set(u, r); } },
      match: async (req, o) => { const u = typeof req === 'string' ? req : req.url; return m.get(o && o.ignoreSearch ? u.split('?')[0] : u); }, keys: async () => [...m.keys()] }; },
    keys: async () => [...store.keys()], delete: async (n) => store.delete(n) };
  const self = { addEventListener: (t, f) => { handlers[t] = f; }, registration: { scope: SCOPE }, skipWaiting: vi.fn() };
  const fetchFn = vi.fn(async (r) => net(r.url));
  // Sandbox OHNE indexedDB/localStorage/navigator: jeder Zugriff auf Tresor-Speicher würde sofort mit ReferenceError scheitern.
  vm.runInNewContext(SRC.replace('__VERSION__', version).replace('__FILES__', JSON.stringify(files)), { self, caches: cachesApi, fetch: fetchFn, URL, Response, location: { origin: new URL(SCOPE).origin } });
  return { handlers, store, self, fetchFn, fetchLog };
}
const install = async (sw) => { const ps = []; sw.handlers.install({ waitUntil: (p) => ps.push(p) }); await Promise.all(ps); };
const activate = async (sw) => { const ps = []; sw.handlers.activate({ waitUntil: (p) => ps.push(p) }); await Promise.all(ps); };
const doFetch = async (sw, req) => { let p; sw.handlers.fetch({ request: req, respondWith: (x) => { p = x; } }); return p ? p : undefined; };
const req = (path, o = {}) => ({ url: SCOPE + path, method: 'GET', mode: 'cors', ...o });

describe('Service Worker: Installation und Aktivierung', () => {
  it('lädt nur die Build-Liste unter dem Repository-Unterpfad und ruft nie skipWaiting auf', async () => {
    const sw = makeSw(); await install(sw);
    expect(sw.fetchLog.sort()).toEqual([SCOPE, ...FILES.map((f) => SCOPE + f)].sort()); expect(sw.fetchLog.every((u) => u.startsWith(SCOPE))).toBe(true);
    expect([...sw.store.keys()]).toEqual(['brox-static-v1']); expect(sw.self.skipWaiting).not.toHaveBeenCalled();
  });
  it('schlägt die Installation fehl, wenn eine Datei fehlt (alte Version bleibt aktiv)', async () => {
    await expect(install(makeSw({ net: async (u) => (u.endsWith('app.js') ? new Response('x', { status: 404 }) : new Response('ok')) }))).rejects.toThrow(/fehlgeschlagen/);
  });
  it('Aktivierung entfernt nur ältere Caches dieser App', async () => {
    const store = new Map([['brox-static-alt', new Map()], ['brox-static-v2', new Map()], ['fremde-app', new Map()], ['workbox-x', new Map()]]);
    const sw = makeSw({ version: 'v2', store }); await activate(sw);
    expect([...store.keys()].sort()).toEqual(['brox-static-v2', 'fremde-app', 'workbox-x']);
  });
  it('skipWaiting nur auf ausdrückliche Nachricht; Version auf Anfrage', async () => {
    const sw = makeSw(); sw.handlers.message({ data: { type: 'IRGENDWAS' } }); sw.handlers.message({ data: null }); expect(sw.self.skipWaiting).not.toHaveBeenCalled();
    sw.handlers.message({ data: { type: 'SKIP_WAITING' } }); expect(sw.self.skipWaiting).toHaveBeenCalledTimes(1);
    const port = { postMessage: vi.fn() }; sw.handlers.message({ data: { type: 'GET_VERSION' }, ports: [port] }); expect(port.postMessage).toHaveBeenCalledWith({ version: 'v1' });
  });
});

describe('Service Worker: Anfragen', () => {
  let sw; beforeEach(async () => { sw = makeSw(); await install(sw); sw.fetchFn.mockClear(); });
  it('bedient App-Dateien offline aus dem Cache, ohne das Netz zu fragen', async () => {
    const res = await doFetch(sw, req('assets/app.js?v=3')); expect(await res.text()).toBe('netz:' + SCOPE + 'assets/app.js'); expect(sw.fetchFn).not.toHaveBeenCalled();
  });
  it('Navigation auf unbekannte Adressen liefert die App (index.html)', async () => {
    const res = await doFetch(sw, req('irgendwas/tiefer', { mode: 'navigate' })); expect(await res.text()).toBe('netz:' + SCOPE + 'index.html'); expect(sw.fetchFn).not.toHaveBeenCalled();
  });
  it('fremde Herkunft und Nicht-GET werden gar nicht angefasst', async () => {
    expect(await doFetch(sw, { url: 'https://evil.example/x.js', method: 'GET', mode: 'cors' })).toBeUndefined();
    expect(await doFetch(sw, req('index.html', { method: 'POST' }))).toBeUndefined(); expect(await doFetch(sw, req('index.html', { method: 'PUT' }))).toBeUndefined();
  });
  it('Unbekanntes kommt vom Netz und wird NIE gespeichert', async () => {
    const before = [...sw.store.get('brox-static-v1').keys()].sort(); const res = await doFetch(sw, req('daten/geheim.json')); expect(await res.text()).toBe('netz:' + SCOPE + 'daten/geheim.json');
    expect([...sw.store.get('brox-static-v1').keys()].sort()).toEqual(before); expect([...sw.store.keys()]).toEqual(['brox-static-v1']);
  });
  it('ohne Netz: Navigation zeigt die Offline-Seite, sonstige Anfragen schlagen sauber fehl', async () => {
    const off = makeSw({ net: async (u) => { if (!FILES.some((f) => u.endsWith(f)) && u !== SCOPE) throw new TypeError('offline'); return new Response('netz:' + u); } }); await install(off);
    const nav = await doFetch(off, req('weg', { mode: 'navigate' })); expect(await nav.text()).toBe('netz:' + SCOPE + 'index.html'); // App-Shell hat Vorrang
    const only = makeSw({ files: ['offline.html'], net: async (u) => { if (u.endsWith('offline.html') || u === SCOPE) return new Response('offline-seite'); throw new TypeError('offline'); } }); await install(only);
    expect(await (await doFetch(only, req('weg', { mode: 'navigate' }))).text()).toBe('offline-seite');
    expect((await doFetch(only, req('data.json'))).type).toBe('error');
  });
});

describe('Service Worker greift nie auf Tresordaten zu', () => {
  it('Quelltext enthält keinen Zugriff auf Speicher-APIs', () => {
    const code = SRC.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    for (const w of ['indexedDB', 'localStorage', 'sessionStorage', 'getDirectory', 'navigator.storage', 'clients.claim', 'cache.put', '.put(']) expect(code, w).not.toContain(w);
  });
  it('App-Update und gelöschter Service-Worker-Cache lassen Tresor und Daten unberührt (Update v1 → v2)', async () => {
    lock(); await new Promise((res) => { const r = indexedDB.deleteDatabase('brox-vault'); r.onsuccess = r.onerror = () => res(); });
    const db = await openDb(), store = createMetaStore(db); await createVault('ein sehr langes passwort', store, { m: 1024, t: 1, p: 1 }); await data.loadAll(db);
    await data.save({ type: 'note', title: 'Wichtig', content: 'bleibt erhalten', custom: [], favorite: false, category: '' }); const keysBefore = JSON.stringify(await idbGet(db, 'vault_meta', 'vault'));
    const caches = new Map(); const v1 = makeSw({ version: 'v1', store: caches }); await install(v1); await activate(v1);
    const v2 = makeSw({ version: 'v2', store: caches }); await install(v2); expect([...caches.keys()].sort()).toEqual(['brox-static-v1', 'brox-static-v2']); await activate(v2); expect([...caches.keys()]).toEqual(['brox-static-v2']);
    caches.clear(); // „Website-Cache leeren“
    lock(); expect(JSON.stringify(await idbGet(db, 'vault_meta', 'vault'))).toBe(keysBefore);
    await unlock('ein sehr langes passwort', store); await data.loadAll(db); expect(data.all('note')[0]).toMatchObject({ title: 'Wichtig', content: 'bleibt erhalten' });
    db.close();
  });
});
