// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
const { initUpdates, applyUpdate, checkForUpdate, updateAvailable } = await import('../src/pwa/update.js');
const { withBusy } = await import('../src/pwa/busy.js');
const inst = await import('../src/pwa/install.js');
const { createVault } = await import('../src/core/keys/vault.js');
const { lock, isUnlocked } = await import('../src/core/keys/session.js');
const { openDb } = await import('../src/core/db/idb.js');
const { showSetup, showReload } = await import('../src/ui/gate.js');
const { appCard } = await import('../src/ui/settings-view.js');
const { memStore } = await import('./memstore.js');

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const text = () => document.body.textContent;
const btn = (t) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(t));
let slot, sw, reg, reload;
class FakeContainer extends EventTarget { constructor() { super(); this.controller = {}; } register() { reg = Object.assign(new EventTarget(), { waiting: null, installing: null, update: vi.fn(async () => {}) }); return Promise.resolve(reg); } }
const newWorker = () => Object.assign(new EventTarget(), { state: 'installing', postMessage: vi.fn() });
const deliver = (w) => { reg.installing = w; reg.dispatchEvent(new Event('updatefound')); w.state = 'installed'; reg.waiting = w; w.dispatchEvent(new Event('statechange')); };
beforeEach(async () => { lock(); document.body.replaceChildren(); slot = document.createElement('div'); slot.id = 'update-slot'; document.body.append(slot); sw = new FakeContainer(); reload = vi.fn(); initUpdates({ enabled: true, sw, reload, slot }); await tick(); });
afterEach(() => { lock(); vi.unstubAllGlobals(); });
const unlockVault = () => createVault('ein sehr langes passwort', memStore(), { m: 1024, t: 1, p: 1 });

describe('Kontrolliertes Update', () => {
  it('ist in der Entwicklungsversion und ohne Service-Worker-Unterstützung aus', () => {
    expect(initUpdates({ enabled: false, sw })).toBe(false); expect(initUpdates({ enabled: true, sw: null })).toBe(false);
  });
  it('zeigt eine neue Version erst an, wenn sie fertig installiert ist, und ändert nichts von selbst', async () => {
    expect(slot.textContent).toBe(''); const w = newWorker(); reg.installing = w; reg.dispatchEvent(new Event('updatefound')); expect(slot.textContent).toBe('');
    deliver(w); expect(slot.textContent).toContain('Neue Version verfügbar'); expect(updateAvailable()).toBe(true); expect(w.postMessage).not.toHaveBeenCalled(); expect(reload).not.toHaveBeenCalled();
  });
  it('bei entsperrtem Tresor: erst sperren, dann aktivieren, dann neu laden (nur nach eigener Aktion)', async () => {
    await unlockVault(); const w = newWorker(); deliver(w);
    expect(slot.textContent).toContain('Tresor gesperrt'); expect(btn('Sperren und aktualisieren')).toBeTruthy();
    sw.dispatchEvent(new Event('controllerchange')); expect(reload).not.toHaveBeenCalled();            // fremde Controller-Wechsel laden nicht neu
    btn('Sperren und aktualisieren').click(); expect(isUnlocked()).toBe(false); expect(w.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    sw.dispatchEvent(new Event('controllerchange')); expect(reload).toHaveBeenCalledTimes(1); sw.dispatchEvent(new Event('controllerchange')); expect(reload).toHaveBeenCalledTimes(1);
  });
  it('bei gesperrtem Tresor genügt ein Klick', async () => {
    const w = newWorker(); deliver(w); expect(btn('Jetzt aktualisieren')).toBeTruthy(); btn('Jetzt aktualisieren').click(); expect(w.postMessage).toHaveBeenCalledTimes(1);
  });
  it('während eines laufenden Vorgangs (Import, Backup, Wiederherstellung) wird nicht aktualisiert', async () => {
    await unlockVault(); const w = newWorker(); deliver(w); let done; const p = withBusy(() => new Promise((r) => { done = r; })); await tick();
    expect(slot.textContent).toContain('laufende Vorgang'); expect(btn('Sperren und aktualisieren').disabled).toBe(true);
    expect(applyUpdate()).toEqual({ ok: false, reason: 'busy' }); expect(isUnlocked()).toBe(true); expect(w.postMessage).not.toHaveBeenCalled();
    done(); await p; await tick(); expect(btn('Sperren und aktualisieren').disabled).toBe(false); expect(applyUpdate()).toEqual({ ok: true });
  });
  it('Update-Suche: offline, aktuell, verfügbar', async () => {
    vi.stubGlobal('navigator', { ...navigator, onLine: false }); expect(await checkForUpdate()).toBe('offline'); vi.unstubAllGlobals();
    expect(await checkForUpdate()).toBe('current'); expect(reg.update).toHaveBeenCalled();
    reg.update = vi.fn(async () => { const w = newWorker(); reg.installing = w; reg.dispatchEvent(new Event('updatefound')); setTimeout(() => { w.state = 'installed'; reg.waiting = w; reg.installing = null; w.dispatchEvent(new Event('statechange')); }, 5); });
    expect(await checkForUpdate()).toBe('available'); expect(slot.textContent).toContain('Neue Version');
  });
});

describe('Installation', () => {
  it('erkennt installierte App und iOS', () => {
    expect(inst.isStandalone({ matchMedia: () => ({ matches: true }), navigator: {} })).toBe(true); expect(inst.isStandalone({ matchMedia: () => ({ matches: false }), navigator: { standalone: true } })).toBe(true);
    expect(inst.isStandalone({ matchMedia: () => ({ matches: false }), navigator: {} })).toBe(false);
    expect(inst.isIOS({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', platform: 'iPhone' })).toBe(true); expect(inst.isIOS({ userAgent: 'Mozilla/5.0 (Windows NT 10.0)', platform: 'Win32', maxTouchPoints: 0 })).toBe(false);
    expect(inst.isIOS({ userAgent: 'Mozilla/5.0 (Macintosh)', platform: 'MacIntel', maxTouchPoints: 5 })).toBe(true);
  });
  it('Installationsanfrage von Chrome/Edge wird gemerkt und genau einmal ausgelöst', async () => {
    const win = new EventTarget(); inst.initInstall(win); expect(inst.canPrompt()).toBe(false); expect(await inst.promptInstall()).toBe('unavailable');
    const e = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt: vi.fn(), userChoice: Promise.resolve({ outcome: 'accepted' }) }); win.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true); expect(inst.canPrompt()).toBe(true); expect(await inst.promptInstall()).toBe('accepted'); expect(e.prompt).toHaveBeenCalledTimes(1); expect(inst.canPrompt()).toBe(false);
    win.dispatchEvent(Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt: vi.fn(), userChoice: Promise.resolve({}) })); win.dispatchEvent(new Event('appinstalled')); expect(inst.canPrompt()).toBe(false);
  });
  it('Einstellungen zeigen Version, Offline-Status und den iPhone-Installationshinweis', async () => {
    vi.stubGlobal('navigator', { ...navigator, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)', platform: 'iPhone', onLine: true });
    document.body.replaceChildren(appCard()); await tick(10);
    expect(text()).toContain('Version'); expect(text()).toContain('Offline-Bereitschaft'); expect(text()).toContain('Zum Home-Bildschirm'); expect(text()).toContain('nur bei gesperrtem Tresor'); expect(btn('Nach Updates suchen')).toBeTruthy();
  });
  it('Einrichtung warnt auf dem iPhone im Safari-Tab, nicht in der installierten App', () => {
    const run = () => { const root = document.createElement('div'); document.body.replaceChildren(root); showSetup(root, memStore(), () => {}, null); btn('Weiter').click(); btn('Weiter') && void 0; return text(); };
    vi.stubGlobal('navigator', { ...navigator, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)', platform: 'iPhone' }); expect(run()).toContain('iPhone-Tipp');
    vi.stubGlobal('navigator', { ...navigator, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)', platform: 'iPhone', standalone: true }); expect(run()).not.toContain('iPhone-Tipp');
    vi.stubGlobal('navigator', { ...navigator, userAgent: 'Mozilla/5.0 (Windows NT 10.0)', platform: 'Win32' }); expect(run()).not.toContain('iPhone-Tipp');
  });
});

describe('Datenbank-Update aus einem anderen Tab', () => {
  it('ältere Verbindung wird freigegeben und die App meldet „Seite neu laden“, nichts wird gelöscht', async () => {
    await new Promise((res) => { const r = indexedDB.deleteDatabase('brox-vault'); r.onsuccess = r.onerror = () => res(); });
    const db = await openDb(); const seen = vi.fn(); window.addEventListener('brox-db-versionchange', seen);
    const up = await new Promise((res, rej) => { const r = indexedDB.open('brox-vault', 99); r.onupgradeneeded = () => {}; r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    expect(seen).toHaveBeenCalledTimes(1); expect([...up.objectStoreNames].sort()).toEqual(['categories', 'chunks', 'entries', 'files', 'settings', 'vault_meta']); up.close(); db.close();
    const root = document.createElement('div'); document.body.replaceChildren(root); showReload(root); expect(text()).toContain('Bitte Seite neu laden'); expect(text()).toContain('Es wurde nichts gelöscht');
  });
});
