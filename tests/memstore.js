// Speicher im RAM, gleiche Schnittstelle wie der IndexedDB-Meta-Store (IndexedDB selbst wird erst in Phase 4 getestet).
export const memStore = () => { let v = null; return {
  get: async () => (v ? structuredClone(v) : null),
  create: async (x) => { if (v) throw new Error('exists'); v = structuredClone(x); },
  replace: async (x) => { v = structuredClone(x); },
  _raw: () => v, _set: (x) => { v = x; },
}; };
