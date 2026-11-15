import { defineConfig } from 'vite';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';

// Strenge CSP (nur per Meta-Tag möglich, GitHub Pages setzt keine Header).
// 'wasm-unsafe-eval' ist für die spätere Argon2id-WASM-Bibliothek vorgesehen (Phase 3, zu verifizieren).
const CSP = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' blob: data:; font-src 'self'; connect-src 'self'; worker-src 'self'; frame-src blob:; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'";

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
let commit = 'lokal'; try { commit = execSync('git rev-parse --short=8 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { /* kein Git */ }
const walk = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });

let outDir = 'dist';
const brox = () => ({
  name: 'brox-vault',
  apply: 'build',
  configResolved(c) { outDir = c.build.outDir; },
  transformIndexHtml: { order: 'post', handler: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' }] },
  closeBundle() {
    // Erzeugt sw.js mit Liste der statischen Dateien (nur App-Dateien, nie Tresordaten).
    const files = walk(outDir).map((p) => relative(outDir, p).split('\\').join('/')).filter((f) => f !== 'sw.js' && !f.split('/').some((s) => s.startsWith('.')));
    const hash = createHash('sha256');
    for (const f of files.sort()) hash.update(f).update(readFileSync(join(outDir, f)));
    const version = hash.digest('hex').slice(0, 12);
    const tpl = readFileSync('src/pwa/sw.template.js', 'utf8');
    writeFileSync(join(outDir, 'sw.js'), tpl.replace('__VERSION__', version).replace('__FILES__', JSON.stringify(files)));
  },
});

// base './' = funktioniert unter jedem Repository-Unterpfad (GitHub Pages).
export default defineConfig({ base: './', plugins: [brox()], build: { target: 'es2022' }, define: { __APP_VERSION__: JSON.stringify(pkg.version), __BUILD_ID__: JSON.stringify(commit) } });
