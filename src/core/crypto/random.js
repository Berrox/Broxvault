// Ausschließlich kryptografisch sichere Zufallszahlen des Browsers.
export const randomBytes = (n) => crypto.getRandomValues(new Uint8Array(n));
