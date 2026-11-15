import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join, extname } from 'node:path';
import { tmpdir } from 'node:os';
import http from 'node:http';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
let out, server, port, files, html, sw;
const walk = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };

beforeAll(async () => {
  out = mkdtempSync(join(tmpdir(), 'brox-build-'));
  execSync('npx --no-install vite build --outDir ' + out + ' --emptyOutDir', { cwd: process.cwd(), stdio: 'pipe' });
  html = readFileSync(join(out, 'index.html'), 'utf8'); sw = readFileSync(join(out, 'sw.js'), 'utf8'); files = JSON.parse(sw.match(/const FILES = (.*);/)[1]);
  // Wie GitHub Pages in einem Repository-Unterpfad: alles unter /brox-vault/, nichts darüber hinaus
  server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x'); if (!u.pathname.startsWith('/brox-vault/')) { res.statusCode = 404; return res.end(); }
    const rel = decodeURIComponent(u.pathname.slice('/brox-vault/'.length)) || 'index.html', p = join(out, rel);
    if (!existsSync(p) || !statSync(p).isFile()) { res.statusCode = 404; return res.end(); } res.setHeader('content-type', MIME[extname(p)] || 'application/octet-stream'); res.end(readFileSync(p));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r)); port = server.address().port;
}, 120000);
afterAll(() => { server && server.close(); out && rmSync(out, { recursive: true, force: true }); });

describe('Build und Veröffentlichung (GitHub Pages)', () => {
  it('funktioniert unter einem Repository-Unterpfad: alle Verweise sind relativ und alle Dateien erreichbar', async () => {
    const base = 'http://127.0.0.1:' + port + '/brox-vault/';
    expect(html).not.toMatch(/(?:src|href)="\//); for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) expect(m[1], m[1]).toMatch(/^(\.\/|assets\/|#)/);
    for (const f of ['', ...files]) { const r = await fetch(new URL(f, base)); expect(r.status, f).toBe(200); }
    expect((await fetch('http://127.0.0.1:' + port + '/index.html')).status).toBe(404);   // Test-Server wirklich auf den Unterpfad beschränkt
    for (const f of files.filter((x) => x.endsWith('.js'))) { const js = readFileSync(join(out, f), 'utf8'); expect(js, f).not.toMatch(/["'`]\/assets\//); }
  });
  it('Manifest ist relativ, vollständig und verweist auf vorhandene Icons', () => {
    const m = JSON.parse(readFileSync(join(out, 'manifest.webmanifest'), 'utf8'));
    expect(m).toMatchObject({ start_url: './', scope: './', display: 'standalone', lang: 'de' }); expect(m.icons.length).toBeGreaterThanOrEqual(3); for (const i of m.icons) expect(existsSync(join(out, i.src)), i.src).toBe(true);
    expect(existsSync(join(out, 'apple-touch-icon.png'))).toBe(true);
  });
  it('strenge CSP ohne unsafe-inline, unsafe-eval und Fremdhosts; WebAssembly nur für Argon2id erlaubt', () => {
    const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1].replaceAll('&#39;', "'");
    for (const d of ["default-src 'self'", "script-src 'self' 'wasm-unsafe-eval'", "object-src 'none'", "connect-src 'self'", "frame-src blob:", "base-uri 'self'", "form-action 'none'"]) expect(csp, d).toContain(d);
    expect(csp).not.toContain("'unsafe-inline'"); expect(csp).not.toMatch(/'unsafe-eval'/); expect(csp).not.toMatch(/https?:\/\//); expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>[^<]/); // kein Inline-Skript
  });
  it('Bundles enthalten weder eval/new Function noch Fremdadressen (außer dem SVG-Namensraum)', () => {
    for (const f of walk(out).filter((p) => p.endsWith('.js') && !p.endsWith('sw.js'))) {
      const js = readFileSync(f, 'utf8'); expect(js).not.toMatch(/\beval\(|new Function\(/);
      const hosts = [...js.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map((m) => m[1]); expect([...new Set(hosts)].filter((h) => h !== 'www.w3.org'), f).toEqual([]);
    }
  });
  it('Service-Worker-Liste: relativ, vollständig, ohne versteckte Dateien, Version fest eingetragen', () => {
    expect(sw).not.toMatch(/__VERSION__|__FILES__/); expect(sw).toMatch(/const VERSION = '[0-9a-f]{12}'/);
    for (const f of ['index.html', 'offline.html', 'manifest.webmanifest']) expect(files).toContain(f);
    for (const f of files) { expect(f).not.toMatch(/^(\/|[a-z]+:)/); expect(f.split('/').some((s) => s.startsWith('.'))).toBe(false); expect(existsSync(join(out, f)), f).toBe(true); expect(f).not.toMatch(/\.bvx$/); }
    expect(files.reduce((s, f) => s + statSync(join(out, f)).size, 0)).toBeLessThan(2 * 1024 * 1024);
  });
  it('Version und Build-Kennung stehen im Bundle', () => {
    const js = files.filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(out, f), 'utf8')).join('\n'); expect(js).toContain(pkg.version); expect(js).not.toContain('"0.7.0"');
  });
  it('GitHub-Workflow: Aktionen auf Commit-Hashes fixiert, minimale Rechte, saubere Installation', () => {
    const y = readFileSync('.github/workflows/deploy.yml', 'utf8'); const uses = [...y.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]);
    expect(uses.length).toBe(4); for (const u of uses) expect(u, u).toMatch(/@[0-9a-f]{40}$/);
    expect(y).toContain('npm ci --ignore-scripts'); expect(y).toContain('npm test'); expect(y).toMatch(/permissions:\s*\n\s+contents: read/); expect(y).not.toMatch(/secrets\./);
  });
  it('Abhängigkeiten sind exakt fixiert und das Lockfile liegt bei', () => {
    for (const [n, v] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) expect(v, n).toMatch(/^\d+\.\d+\.\d+$/); expect(existsSync('package-lock.json')).toBe(true);
    expect(readFileSync('.gitignore', 'utf8')).toContain('*.bvx');
  });
});
