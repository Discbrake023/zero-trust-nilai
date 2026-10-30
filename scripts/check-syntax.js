'use strict';
// Pemeriksaan sintaks seluruh file .js (node --check) + pastikan semua require() lokal dapat di-resolve.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const files = [];
(function walk(d) {
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    if (f.name === 'node_modules' || f.name.startsWith('.')) continue;
    const p = path.join(d, f.name);
    if (f.isDirectory()) walk(p); else if (f.name.endsWith('.js')) files.push(p);
  }
})(root);

let bad = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) { bad++; console.error(`SYNTAX ERROR ${path.relative(root, f)}\n${r.stderr}`); }
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(/require\('(\.[^']+)'\)/g)) {
    try { require.resolve(path.resolve(path.dirname(f), m[1])); } catch { bad++; console.error(`REQUIRE TIDAK DITEMUKAN di ${path.relative(root, f)}: ${m[1]}`); }
  }
}
console.log(`${files.length} file diperiksa, ${bad} masalah.`);
process.exit(bad ? 1 : 0);
