// OPFS-Schreibzugriff läuft im Worker (createSyncAccessHandle ist auch in Safari nur dort verfügbar – auf dem iPhone zu verifizieren).
let root;
const dirOf = async (path, create) => { let d = root; for (const p of path) d = await d.getDirectoryHandle(p, { create }); return d; };
self.onmessage = async ({ data: { id, op, dir, name, data } }) => {
  try {
    root ??= await navigator.storage.getDirectory();
    let result = null; const transfer = [];
    if (op === 'write') {
      const fh = await (await dirOf(dir, true)).getFileHandle(name, { create: true }), h = await fh.createSyncAccessHandle();
      try { h.truncate(0); h.write(data, { at: 0 }); h.flush(); if (h.getSize() !== data.length) throw new Error('Schreiben unvollständig'); } finally { h.close(); }
    } else if (op === 'read') {
      const h = await (await (await dirOf(dir, false)).getFileHandle(name)).createSyncAccessHandle();
      try { result = new Uint8Array(h.getSize()); h.read(result, { at: 0 }); transfer.push(result.buffer); } finally { h.close(); }
    } else if (op === 'list' || op === 'listDirs') {
      result = [];
      try { for await (const [n, e] of (await dirOf(dir, false)).entries()) if ((op === 'list') === (e.kind === 'file')) result.push(n); } catch (e) { if (e.name !== 'NotFoundError') throw e; }
    } else if (op === 'removeDir') {
      try { await (await dirOf(dir, false)).removeEntry(name, { recursive: true }); } catch (e) { if (e.name !== 'NotFoundError') throw e; }
    }
    self.postMessage({ id, ok: true, result }, transfer);
  } catch (e) { self.postMessage({ id, ok: false, error: String((e && e.message) || e) }); }
};
