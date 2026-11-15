import { el } from '../ui/dom.js';
import { lock, isUnlocked, onLockChange } from '../core/keys/session.js';
import { isBusy, onBusyChange } from './busy.js';

export { APP_VERSION, BUILD_ID } from '../version.js';

// Sichere Aktualisierung: Eine neue Version installiert sich im Hintergrund und WARTET. Aktiviert wird sie erst, wenn der Benutzer zustimmt,
// der Tresor gesperrt ist und kein Schreibvorgang läuft (kontrollierter Zustandswechsel). Daten in IndexedDB/OPFS bleiben immer unberührt.
const st = { reg: null, waiting: null, updating: false, last: 0, slot: null, sw: null, reload: () => location.reload() };
const listeners = new Set(); const emit = () => { render(); listeners.forEach((f) => f()); };
export const onUpdateChange = (f) => { listeners.add(f); return () => listeners.delete(f); };
export const updateAvailable = () => !!st.waiting;

function render() {
  if (!st.slot) return;
  if (!st.waiting) { st.slot.replaceChildren(); return; }
  const busy = isBusy(), unlocked = isUnlocked();
  st.slot.replaceChildren(el('div', { class: 'update', role: 'status' },
    el('span', {}, busy ? 'Neue Version verfügbar. Sobald der laufende Vorgang fertig ist, kannst du aktualisieren.'
      : unlocked ? 'Neue Version verfügbar. Zum Aktualisieren wird der Tresor gesperrt.' : 'Neue Version verfügbar.'),
    el('button', { type: 'button', class: 'btn primary', disabled: busy, onclick: () => applyUpdate() }, unlocked ? 'Sperren und aktualisieren' : 'Jetzt aktualisieren')));
}
export function applyUpdate() {
  if (!st.waiting) return { ok: false, reason: 'none' };
  if (isBusy()) return { ok: false, reason: 'busy' };
  if (isUnlocked()) lock();                       // Schlüssel verwerfen, bevor neuer Code läuft
  st.updating = true; st.waiting.postMessage({ type: 'SKIP_WAITING' });
  return { ok: true };
}
export async function checkForUpdate() {
  if (!st.reg) return 'unsupported';
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline';
  try {
    await st.reg.update(); st.last = Date.now();
    const w = st.reg.installing;
    if (w) await new Promise((res) => { const t = setTimeout(res, 20000); w.addEventListener('statechange', () => { if (w.state === 'installed' || w.state === 'redundant') { clearTimeout(t); res(); } }); });
    if (st.reg.waiting && st.sw.controller) { st.waiting = st.reg.waiting; emit(); }
    return st.waiting ? 'available' : 'current';
  } catch { return 'error'; }
}
export function getSwVersion() {
  const c = st.sw && st.sw.controller; if (!c || typeof MessageChannel === 'undefined') return Promise.resolve(null);
  return new Promise((res) => { const ch = new MessageChannel(); const t = setTimeout(() => res(null), 3000); ch.port1.onmessage = (e) => { clearTimeout(t); res(e.data && e.data.version); }; try { c.postMessage({ type: 'GET_VERSION' }, [ch.port2]); } catch { clearTimeout(t); res(null); } });
}
export function initUpdates({ enabled = import.meta.env.PROD, sw = typeof navigator !== 'undefined' ? navigator.serviceWorker : null, reload, slot = typeof document !== 'undefined' ? document.getElementById('update-slot') : null } = {}) {
  if (!enabled || !sw) return false;
  st.sw = sw; st.slot = slot; st.waiting = null; st.updating = false; if (reload) st.reload = reload;
  onLockChange(render); onBusyChange(render);
  sw.register('./sw.js', { scope: './', updateViaCache: 'none' }).then((reg) => {
    st.reg = reg;
    const offer = (w) => { st.waiting = w; emit(); };
    if (reg.waiting && sw.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => { const w = reg.installing; if (w) w.addEventListener('statechange', () => { if (w.state === 'installed' && sw.controller) offer(w); }); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && Date.now() - st.last > 3600000) checkForUpdate(); });
  }).catch(() => {});
  // Nur neu laden, wenn WIR die Aktivierung angestoßen haben (keine Überraschungs-Neuladungen).
  sw.addEventListener('controllerchange', () => { if (st.updating) { st.updating = false; st.reload(); } });
  return true;
}
