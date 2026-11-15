export async function requestPersist() { try { return navigator.storage && navigator.storage.persist ? await navigator.storage.persist() : null; } catch { return null; } }
export async function storageStatus() {
  const s = navigator.storage || {};
  const persisted = s.persisted ? await s.persisted() : null;
  const est = s.estimate ? await s.estimate() : null;
  const usage = est && est.usage != null ? est.usage : null, quota = est && est.quota ? est.quota : null;
  const warnings = [];
  if (persisted === false) warnings.push('Dauerhafter Speicher ist nicht gewährt: der Browser darf Daten bei Speichermangel löschen.');
  if (persisted === null) warnings.push('Dieser Browser meldet nicht, ob der Speicher dauerhaft ist.');
  if (usage != null && quota && usage / quota > 0.8) warnings.push('Der verfügbare Speicher wird knapp (über 80 % belegt).');
  if (quota == null) warnings.push('Die Speicherkapazität lässt sich in diesem Browser nicht ermitteln.');
  return { persisted, usage, quota, available: usage != null && quota ? Math.max(0, quota - usage) : null, warnings };
}
