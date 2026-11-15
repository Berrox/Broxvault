// Zählt laufende Schreib-Vorgänge (Import, Backup, Wiederherstellung). Ein App-Update wartet, bis nichts mehr läuft.
let n = 0; const ls = new Set();
export const isBusy = () => n > 0;
export const onBusyChange = (f) => { ls.add(f); return () => ls.delete(f); };
export async function withBusy(fn) { n++; ls.forEach((f) => f(true)); try { return await fn(); } finally { n--; ls.forEach((f) => f(n > 0)); } }
