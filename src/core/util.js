export const enc = new TextEncoder();
export const toB64 = (u8) => { let s = ''; for (const b of u8) s += String.fromCharCode(b); return btoa(s); };
export const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
