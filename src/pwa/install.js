// Installationshilfe: Chrome/Edge bieten eine Installationsanfrage, iOS Safari nur „Zum Home-Bildschirm“.
let deferred = null; const ls = new Set(); const emit = () => ls.forEach((f) => f());
export const onInstallChange = (f) => { ls.add(f); return () => ls.delete(f); };
export function initInstall(win = window) {
  win.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; emit(); });
  win.addEventListener('appinstalled', () => { deferred = null; emit(); });
}
export const isStandalone = (win = window) => !!((win.matchMedia && win.matchMedia('(display-mode: standalone)').matches) || win.navigator.standalone === true);
export const isIOS = (nav = navigator) => /iPad|iPhone|iPod/.test(nav.userAgent) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
export const canPrompt = () => deferred !== null;
export async function promptInstall() {
  if (!deferred) return 'unavailable';
  const d = deferred; deferred = null; d.prompt(); const r = await d.userChoice; emit(); return r.outcome;
}
