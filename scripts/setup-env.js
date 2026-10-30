'use strict';
// Membuat .env dari .env.example dengan secret acak. Tidak menimpa .env yang sudah ada (kecuali --force).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');
const target = path.join(root, '.env');
if (fs.existsSync(target) && !process.argv.includes('--force')) {
  console.log('.env sudah ada, tidak diubah. Gunakan "node scripts/setup-env.js --force" untuk membuat ulang.');
  process.exit(0);
}
const example = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
const out = example.replace(/^([A-Z_]+)=CHANGE_ME\s*$/gm, (_, k) => `${k}=${crypto.randomBytes(32).toString('hex')}`);
fs.writeFileSync(target, out);
console.log('.env dibuat dengan secret acak. Jika database sudah pernah dibuat, jalankan "npm run db:reset".');
