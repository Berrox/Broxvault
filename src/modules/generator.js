const SETS = { lower: 'abcdefghijklmnopqrstuvwxyz', upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', digits: '0123456789', symbols: '!@#$%&*()-_=+[]{}:;,.?/~' };
// Gleichmäßige Zufallszahl 0..n-1 per Rejection Sampling (kein Modulo-Bias), nur crypto.getRandomValues.
export function randomInt(n) {
  if (!(n >= 1 && n <= 2 ** 32)) throw new Error('Ungültiger Bereich');
  const limit = Math.floor(2 ** 32 / n) * n, b = new Uint32Array(1);
  do { crypto.getRandomValues(b); } while (b[0] >= limit);
  return b[0] % n;
}
const pickSets = (o) => Object.keys(SETS).filter((k) => o[k]).map((k) => SETS[k]);
export function generatePassword({ length = 20, lower = true, upper = true, digits = true, symbols = true } = {}) {
  const sets = pickSets({ lower, upper, digits, symbols });
  if (!sets.length) throw new Error('Bitte mindestens eine Zeichengruppe wählen.');
  if (!Number.isInteger(length) || length < sets.length || length > 128) throw new Error('Die Länge muss zwischen 8 und 128 liegen.');
  const all = sets.join('');
  for (;;) { // enthält das Ergebnis nicht jede gewählte Gruppe, wird komplett neu gewürfelt (bleibt gleichmäßig)
    let out = ''; for (let i = 0; i < length; i++) out += all[randomInt(all.length)];
    if (sets.every((s) => [...s].some((c) => out.includes(c)))) return out;
  }
}
export const entropyBits = (o) => o.length * Math.log2(pickSets(o).join('').length || 1);
