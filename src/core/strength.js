// Grobe Schätzung (Länge × Zeichenvorrat), keine Garantie. Passphrasen aus Wörtern werden eher überschätzt.
export function estimateBits(p) {
  const pool = (/[a-zäöüß]/.test(p) ? 26 : 0) + (/[A-ZÄÖÜ]/.test(p) ? 26 : 0) + (/\d/.test(p) ? 10 : 0) + (/[^A-Za-zäöüßÄÖÜ\d]/.test(p) ? 33 : 0);
  return pool ? [...p].length * Math.log2(pool) : 0;
}
export const strengthText = (bits) => 'Schätzung: ' + (bits < 60 ? 'eher schwach' : bits < 80 ? 'ausreichend' : 'stark');
