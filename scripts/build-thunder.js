'use strict';
// Membuat koleksi Thunder Client (thunder-client/thunder-collection_zero-trust.json).
// Asumsi data: database baru hasil seed (id nilai/kelas mengikuti urutan seed).
const fs = require('fs');
const path = require('path');

const GW = 'http://127.0.0.1:3000';
const NOW = new Date().toISOString();
const colId = 'zt-collection';
const folders = [];
const requests = [];
let fSort = 0, rSort = 0, cur = null;

const folder = (name) => { cur = `zt-f${++fSort}`; folders.push({ _id: cur, name, containerId: '', created: NOW, sortNum: fSort * 10000 }); };
function req(name, method, url, { device, token, body, expect, save } = {}) {
  const headers = [];
  if (device) headers.push({ name: 'X-Device-ID', value: device });
  if (token) headers.push({ name: 'Authorization', value: `Bearer {{${token}}}` });
  const tests = [];
  if (expect) tests.push({ type: 'res-code', custom: '', action: 'equal', value: String(expect) });
  if (save) tests.push({ type: 'set-env-var', custom: save.path, action: 'setto', value: `{{${save.name}}}` });
  requests.push({
    _id: `zt-r${++rSort}`, colId, containerId: cur, name, url: `${GW}${url}`, method, sortNum: rSort * 10000,
    created: NOW, modified: NOW, headers, params: [],
    body: body ? { type: 'json', raw: JSON.stringify(body, null, 2), form: [] } : { type: 'none', raw: '', form: [] },
    tests,
  });
}
const A = { andi: ['mhs.andi', 'Mhs#12345', 'DEV-MHS-ANDI'], budi: ['dosen.budi', 'Dosen#123', 'DEV-DOSEN-BUDI'],
  sari: ['dosen.sari', 'Dosen#123', 'DEV-DOSEN-SARI'], admin: ['admin', 'Admin#123', 'DEV-ADMIN-01'] };
const login = (k) => req(`Login ${A[k][0]}`, 'POST', '/auth/login', { device: A[k][2], body: { username: A[k][0], password: A[k][1] }, expect: 200,
  save: { path: 'json.data.access_token', name: `token_${k}` } });

folder('1. Auth');
for (const k of Object.keys(A)) login(k);
req('Login andi - password salah (401)', 'POST', '/auth/login', { device: 'DEV-MHS-ANDI', body: { username: 'mhs.andi', password: 'salah' }, expect: 401 });
req('Login andi - device tidak terdaftar (403)', 'POST', '/auth/login', { device: 'HP-ORANG-LAIN', body: { username: 'mhs.andi', password: 'Mhs#12345' }, expect: 403 });
requests.push({ ...JSON.parse(JSON.stringify(requests[0])), _id: `zt-r${++rSort}`, name: 'Login andi (simpan refresh token)', sortNum: rSort * 10000,
  tests: [{ type: 'res-code', custom: '', action: 'equal', value: '200' },
    { type: 'set-env-var', custom: 'json.data.refresh_token', action: 'setto', value: '{{refresh_andi}}' },
    { type: 'set-env-var', custom: 'json.data.access_token', action: 'setto', value: '{{token_andi}}' }] });
req('Refresh (refresh_andi)', 'POST', '/auth/refresh', { body: { refresh_token: '{{refresh_andi}}' }, expect: 200 });
req('Logout (cabut refresh_andi)', 'POST', '/auth/logout', { body: { refresh_token: '{{refresh_andi}}' }, expect: 200 });
req('Refresh setelah logout (401)', 'POST', '/auth/refresh', { body: { refresh_token: '{{refresh_andi}}' }, expect: 401 });
req('Token service (client id + secret)', 'POST', '/auth/service', { body: { client_id: 'service-nilai', client_secret: '<ISI SERVICE_NILAI_CLIENT_SECRET dari .env>' }, expect: 200,
  save: { path: 'json.data.access_token', name: 'token_service' } });

folder('2. Nilai');
req('Andi - lihat nilai sendiri (200)', 'GET', '/nilai', { device: A.andi[2], token: 'token_andi', expect: 200 });
req('Andi - nilai milik Citra (403)', 'GET', '/nilai?nim=247006111002', { device: A.andi[2], token: 'token_andi', expect: 403 });
req('Andi - device tidak terdaftar (403)', 'GET', '/nilai', { device: 'HP-ORANG-LAIN', token: 'token_andi', expect: 403 });
req('Andi - tanpa X-Device-ID (403)', 'GET', '/nilai', { token: 'token_andi', expect: 403 });
req('Tanpa token (401)', 'GET', '/nilai', { device: A.andi[2], expect: 401 });
req('Budi - nilai kelas yang diampu (200)', 'GET', '/nilai', { device: A.budi[2], token: 'token_budi', expect: 200 });
req('Budi - ubah nilai id 4 (IF301, kelasnya) (200)', 'PUT', '/nilai/4', { device: A.budi[2], token: 'token_budi', body: { nilai: 91 }, expect: 200 });
req('Budi - ubah nilai id 7 (kelas Sari) (403)', 'PUT', '/nilai/7', { device: A.budi[2], token: 'token_budi', body: { nilai: 99 }, expect: 403 });
req('Andi - ubah nilai (403)', 'PUT', '/nilai/4', { device: A.andi[2], token: 'token_andi', body: { nilai: 100 }, expect: 403 });

folder('3. Finalisasi');
req('Budi - finalisasi kelas 2 / IF301 (200)', 'POST', '/kelas/2/finalisasi', { device: A.budi[2], token: 'token_budi', expect: 200 });
req('Budi - ubah nilai id 4 yang sudah final (409)', 'PUT', '/nilai/4', { device: A.budi[2], token: 'token_budi', body: { nilai: 50 }, expect: 409 });
req('Budi - finalisasi kelas 3 / IF302 milik Sari (403)', 'POST', '/kelas/3/finalisasi', { device: A.budi[2], token: 'token_budi', expect: 403 });

folder('4. Transkrip');
req('Andi - transkrip sendiri (200)', 'GET', '/transkrip/247006111001', { device: A.andi[2], token: 'token_andi', expect: 200 });
req('Andi - transkrip Citra (403)', 'GET', '/transkrip/247006111002', { device: A.andi[2], token: 'token_andi', expect: 403 });
req('Admin - transkrip Andi (200)', 'GET', '/transkrip/247006111001', { device: A.admin[2], token: 'token_admin', expect: 200 });
req('Admin - transkrip Citra (200)', 'GET', '/transkrip/247006111002', { device: A.admin[2], token: 'token_admin', expect: 200 });
req('Admin - transkrip Dewi (200)', 'GET', '/transkrip/247006111003', { device: A.admin[2], token: 'token_admin', expect: 200 });
req('Budi - transkrip (403)', 'GET', '/transkrip/247006111001', { device: A.budi[2], token: 'token_budi', expect: 403 });

folder('5. Sinkron (service-only)');
const sync = { kelas_id: 1, entries: [{ nim: '247006111001', nilai: 88 }, { nim: '247006111002', nilai: 76 }, { nim: '247006111003', nilai: 92 }] };
req('Token user (budi) sinkron (403)', 'POST', '/transkrip/sinkron', { device: A.budi[2], token: 'token_budi', body: sync, expect: 403 });
req('Token user (admin) sinkron (403)', 'POST', '/transkrip/sinkron', { device: A.admin[2], token: 'token_admin', body: sync, expect: 403 });
req('Token service sinkron IF201 (200)', 'POST', '/transkrip/sinkron', { token: 'token_service', body: sync, expect: 200 });

folder('6. Bypass gateway (langsung ke service)');
for (const [n, port, p] of [['Service Nilai', 3001, '/nilai'], ['Service Transkrip', 3002, '/transkrip/247006111001']]) {
  requests.push({ _id: `zt-r${++rSort}`, colId, containerId: cur, name: `${n} langsung, tanpa gateway secret (403)`, url: `http://127.0.0.1:${port}${p}`, method: 'GET',
    sortNum: rSort * 10000, created: NOW, modified: NOW, headers: [{ name: 'Authorization', value: 'Bearer {{token_admin}}' }], params: [],
    body: { type: 'none', raw: '', form: [] }, tests: [{ type: 'res-code', custom: '', action: 'equal', value: '403' }] });
}
requests.push({ _id: `zt-r${++rSort}`, colId, containerId: cur, name: 'Service Transkrip langsung, secret ada tapi tanpa token (401)', url: 'http://127.0.0.1:3002/transkrip/247006111001',
  method: 'GET', sortNum: rSort * 10000, created: NOW, modified: NOW, headers: [{ name: 'X-Gateway-Secret', value: '<ISI GATEWAY_SECRET dari .env>' }], params: [],
  body: { type: 'none', raw: '', form: [] }, tests: [{ type: 'res-code', custom: '', action: 'equal', value: '401' }] });

const out = { client: 'Thunder Client', collectionName: 'Zero Trust - Sistem Nilai', dateExported: NOW, version: '1.2', _id: colId, folders, requests };
const file = path.join(__dirname, '..', 'thunder-client', 'thunder-collection_zero-trust.json');
fs.writeFileSync(file, JSON.stringify(out, null, 2));
console.log(`Dibuat: ${path.relative(process.cwd(), file)} (${requests.length} request)`);
