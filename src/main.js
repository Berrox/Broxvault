import './styles/main.css';
import { mountShell } from './ui/shell.js';
import { initUpdates } from './pwa/update.js';
import { openDb, createMetaStore } from './core/db/idb.js';
import { showSetup, showUnlock, showFatal, showReload } from './ui/gate.js';
import { initInstall } from './pwa/install.js';
import { onLockChange, lock } from './core/keys/session.js';
import { loadSettings } from './core/settings.js';
import { startAutoLock, stopAutoLock } from './core/autolock.js';
import * as data from './modules/data.js';
import * as fdata from './modules/filedata.js';
import { openBackend } from './core/files/choose.js';
import { requestPersist } from './core/storage-status.js';

async function boot() {
  const root = document.getElementById('app');
  initInstall(); // früh registrieren, damit die Installationsanfrage des Browsers nicht verpasst wird
  let db, store, ctx;
  try { db = await openDb(); store = createMetaStore(db); await store.get(); ctx = { db, ...(await openBackend(db)) }; }
  catch { showFatal(root); return; } // Bei Fehlern wird nie etwas gelöscht oder neu angelegt.
  let teardown = null;
  const enter = async () => { requestPersist(); ctx.settings = await loadSettings(db); await data.loadAll(db); await fdata.loadAll(db); root.replaceChildren(); teardown = mountShell(root, ctx); startAutoLock(ctx.settings); };
  const gate = async () => { root.replaceChildren(); (await store.get()) ? showUnlock(root, store, enter) : showSetup(root, store, enter, ctx); };
  let stale = false; // anderer Tab hat die Datenbank aktualisiert: nichts mehr öffnen, nur neu laden
  addEventListener('brox-db-versionchange', () => { stale = true; lock(); showReload(root); });
  onLockChange((unlocked) => { if (!unlocked && !stale) { teardown && teardown(); teardown = null; stopAutoLock(); history.replaceState(null, '', location.pathname); gate(); } });
  await gate();
  initUpdates();
}
// Schutz gegen Einbettung in fremde Seiten (Ersatz für frame-ancestors, das per Meta-Tag nicht geht).
if (window.top !== window.self) document.documentElement.textContent = ''; else boot();
