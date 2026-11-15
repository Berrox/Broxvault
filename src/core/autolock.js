import { lock } from './keys/session.js';
let timer = null, cfg = null, holdUntil = 0;
// Beim Öffnen des Dateidialogs kann iOS die App kurz „verlassen“: dann nicht sofort sperren (nur kurzzeitig, die Inaktivitäts-Sperre gilt weiter).
export const holdHideLock = (ms = 120000) => { holdUntil = Date.now() + ms; };
const EVENTS = ['pointerdown', 'keydown', 'touchstart'];
const arm = () => { clearTimeout(timer); timer = setTimeout(lock, cfg.lockMinutes * 60000); };
const onHide = () => { if (document.visibilityState === 'hidden' && cfg.lockOnHide && Date.now() > holdUntil) lock(); };
export function stopAutoLock() {
  clearTimeout(timer); timer = null;
  EVENTS.forEach((e) => removeEventListener(e, arm)); document.removeEventListener('visibilitychange', onHide);
}
export function startAutoLock(settings) {
  stopAutoLock(); cfg = settings; arm();
  EVENTS.forEach((e) => addEventListener(e, arm, { passive: true })); document.addEventListener('visibilitychange', onHide);
}
