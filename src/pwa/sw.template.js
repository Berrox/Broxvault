// BROX VAULT Service Worker – cached AUSSCHLIESSLICH statische App-Dateien aus der Build-Liste.
// Er greift nie auf Tresordaten zu (kein IndexedDB, kein OPFS, kein Storage) und cached nie Antworten, die nicht in der Liste stehen.
const VERSION = '__VERSION__';
const CACHE = 'brox-static-' + VERSION;
const FILES = __FILES__;
const url = (f) => new URL(f, self.registration.scope).href;

self.addEventListener('install', (e) => {
  // Kein skipWaiting: Eine neue Version wartet, bis der Benutzer das Update bestätigt. Schlägt ein Download fehl, bleibt die alte Version aktiv.
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', ...FILES].map(url))));
});
self.addEventListener('activate', (e) => {
  // Entfernt nur ältere Caches dieser App. Tresordaten liegen in IndexedDB/OPFS und werden hier nie berührt.
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('brox-static-') && k !== CACHE).map((k) => caches.delete(k)))));
});
self.addEventListener('message', (e) => {
  const m = e.data || {};
  if (m.type === 'SKIP_WAITING') self.skipWaiting();
  else if (m.type === 'GET_VERSION' && e.ports && e.ports[0]) e.ports[0].postMessage({ version: VERSION });
});
self.addEventListener('fetch', (e) => {
  const r = e.request;
  if (r.method !== 'GET' || new URL(r.url).origin !== location.origin) return;
  e.respondWith(caches.open(CACHE).then(async (c) => {
    const hit = (await c.match(r, { ignoreSearch: true })) || (r.mode === 'navigate' ? await c.match(url('./index.html')) : null);
    if (hit) return hit;
    try { return await fetch(r); }                                   // nicht in der Liste: direkt vom Netz, nie speichern
    catch { return r.mode === 'navigate' ? (await c.match(url('./offline.html'))) || Response.error() : Response.error(); }
  }));
});
