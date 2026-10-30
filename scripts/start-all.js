'use strict';
// Menjalankan gateway + 2 service sekaligus (Windows/Linux/macOS). Ctrl+C menghentikan semuanya.
const { spawn, spawnSync } = require('child_process');
const path = require('path');

const root = path.resolve(__dirname, '..');
const init = spawnSync(process.execPath, [path.join(root, 'scripts', 'db-init.js')], { stdio: 'inherit' });
if (init.status !== 0) process.exit(init.status || 1);

const apps = [
  ['nilai', 'src/service-nilai/index.js'],
  ['transkrip', 'src/service-transkrip/index.js'],
  ['gateway', 'src/gateway/index.js'],
];
const children = apps.map(([name, file]) => {
  const c = spawn(process.execPath, [path.join(root, file)], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  const pipe = (stream, out) => stream.on('data', (d) => String(d).split(/\r?\n/).filter(Boolean).forEach((l) => out.write(`[${name}] ${l}\n`)));
  pipe(c.stdout, process.stdout); pipe(c.stderr, process.stderr);
  c.on('exit', (code) => { console.log(`[${name}] berhenti (kode ${code})`); shutdown(code || 0); });
  return c;
});
let closing = false;
function shutdown(code) {
  if (closing) return; closing = true;
  children.forEach((c) => { try { c.kill(); } catch { /* sudah mati */ } });
  setTimeout(() => process.exit(code), 300);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
