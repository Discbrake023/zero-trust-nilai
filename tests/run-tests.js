'use strict';
// Pengujian integrasi end-to-end: menyalakan gateway + 2 service sungguhan (port 4000-4002, DB data/test.db),
// lalu menembak HTTP seperti Thunder Client/curl. Tidak ada mock.
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
if (!fs.existsSync(path.join(root, '.env'))) spawnSync(process.execPath, [path.join(root, 'scripts', 'setup-env.js')], { stdio: 'inherit' });

const PORTS = { gateway: 4000, nilai: 4001, transkrip: 4002 };
Object.assign(process.env, {
  PORT_GATEWAY: PORTS.gateway, PORT_NILAI: PORTS.nilai, PORT_TRANSKRIP: PORTS.transkrip,
  GATEWAY_URL: `http://127.0.0.1:${PORTS.gateway}`, NILAI_URL: `http://127.0.0.1:${PORTS.nilai}`,
  TRANSKRIP_URL: `http://127.0.0.1:${PORTS.transkrip}`, DB_PATH: './data/test.db',
  ACCESS_START: '00:00', ACCESS_END: '24:00', // fase A: jam akses terbuka sepanjang hari
});
const config = require('../src/config');
const jwt = require('jsonwebtoken');
const Database = require('better-sqlite3');
const { nowInZone, isWithinWindow, parseHM } = require('../src/utils/time');

for (const ext of ['', '-wal', '-shm']) { try { fs.unlinkSync(config.db.path + ext); } catch { /* belum ada */ } }

const GW = process.env.GATEWAY_URL, NIL = process.env.NILAI_URL, TRK = process.env.TRANSKRIP_URL;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const procs = {};
const FILES = { nilai: 'src/service-nilai/index.js', transkrip: 'src/service-transkrip/index.js', gateway: 'src/gateway/index.js' };

function start(name, extraEnv = {}) {
  const c = spawn(process.execPath, [path.join(root, FILES[name])], { cwd: root, env: { ...process.env, ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe'] });
  c.logs = '';
  c.stdout.on('data', (d) => { c.logs += d; }); c.stderr.on('data', (d) => { c.logs += d; });
  procs[name] = c;
}
async function stop(name) {
  const c = procs[name]; if (!c) return;
  await new Promise((r) => { c.once('exit', r); c.kill(); });
  delete procs[name];
}
async function waitHealthy(url) {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`${url}/health`)).ok) return; } catch { /* belum siap */ } await sleep(200); }
  throw new Error(`server ${url} tidak siap`);
}

async function call(method, base, p, { token, device, headers = {}, body } = {}) {
  const h = { ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  if (device) h['X-Device-ID'] = device;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const r = await fetch(base + p, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
  let json = null; try { json = await r.json(); } catch { /* bukan JSON */ }
  return { status: r.status, json, code: json && json.error ? json.error.code : null };
}

const ACC = {
  andi:  { u: 'mhs.andi',   p: 'Mhs#12345', d: 'DEV-MHS-ANDI',   nim: '247006111001' },
  citra: { u: 'mhs.citra',  p: 'Mhs#12345', d: 'DEV-MHS-CITRA',  nim: '247006111002' },
  dewi:  { u: 'mhs.dewi',   p: 'Mhs#12345', d: 'DEV-MHS-DEWI',   nim: '247006111003' },
  budi:  { u: 'dosen.budi', p: 'Dosen#123', d: 'DEV-DOSEN-BUDI' },
  sari:  { u: 'dosen.sari', p: 'Dosen#123', d: 'DEV-DOSEN-SARI' },
  admin: { u: 'admin',      p: 'Admin#123', d: 'DEV-ADMIN-01' },
};
const S = {}; // sesi login per akun
async function login(key) {
  const a = ACC[key];
  const r = await call('POST', GW, '/auth/login', { device: a.d, body: { username: a.u, password: a.p } });
  if (r.status !== 200) throw new Error(`login ${key} gagal: ${JSON.stringify(r.json)}`);
  S[key] = { token: r.json.data.access_token, refresh: r.json.data.refresh_token, id: r.json.data.user.id, device: a.d };
  return r;
}
const withSecret = { 'X-Gateway-Secret': config.gatewaySecret };

let db;
const maxAudit = () => db.prepare('SELECT COALESCE(MAX(id),0) AS m FROM audit_log').get().m;
function expectAudit(before, { decision, source = 'gateway', subject, endpoint, reason, device }) {
  const rows = db.prepare('SELECT * FROM audit_log WHERE id>?').all(before);
  const hit = rows.find((r) => r.decision === decision && r.source === source
    && (!subject || r.subject === subject) && (!endpoint || r.endpoint === endpoint)
    && (!reason || r.reason.toLowerCase().includes(reason.toLowerCase())) && (device === undefined || r.device_id === device));
  if (!hit) throw new Error(`audit log tidak cocok ${JSON.stringify({ decision, source, subject, endpoint, reason, device })}; baris baru: ${JSON.stringify(rows.slice(-3))}`);
}
const ok = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: diharapkan ${JSON.stringify(b)}, diterima ${JSON.stringify(a)}`); };
const kelasId = (kode) => db.prepare('SELECT id FROM kelas WHERE kode=?').get(kode).id;
const nilaiRow = (kode, nim) => db.prepare(
  `SELECT n.* FROM nilai n JOIN users u ON u.id=n.mahasiswa_id JOIN kelas k ON k.id=n.kelas_id WHERE k.kode=? AND u.nim=?`).get(kode, nim);

const results = [];
async function t(id, name, fn) {
  const before = maxAudit();
  try { await fn(before); results.push({ id, name, pass: true }); console.log(`  PASS  ${id}  ${name}`); }
  catch (e) { results.push({ id, name, pass: false, err: e.message }); console.log(`  FAIL  ${id}  ${name}\n        -> ${e.message}`); }
}

function forge(sub, claims, { secret = config.jwt.accessSecret, expOffset = 600 } = {}) {
  return jwt.sign({ ...claims, exp: Math.floor(Date.now() / 1000) + expOffset }, secret, { subject: String(sub), issuer: config.jwt.issuer, algorithm: 'HS256' });
}

(async () => {
  console.log(`\nZero Trust - pengujian integrasi (DB: ${path.relative(root, config.db.path)})\n`);
  spawnSync(process.execPath, [path.join(root, 'scripts', 'db-init.js')], { env: process.env, stdio: 'inherit' });
  db = new Database(config.db.path);
  start('nilai'); start('transkrip'); start('gateway');
  await Promise.all([waitHealthy(NIL), waitHealthy(TRK), waitHealthy(GW)]);
  for (const k of Object.keys(ACC)) await login(k);
  console.log('\nFase A - jam akses terbuka (00:00-24:00)\n');

  await t('01', 'Login berhasil (token + refresh token, tercatat allow)', async (b) => {
    const r = await login('andi');
    eq(r.status, 200, 'status'); ok(r.json.data.access_token && r.json.data.refresh_token, 'token kosong');
    eq(r.json.data.expires_in, 600, 'access token harus 10 menit');
    const p = jwt.decode(r.json.data.access_token); eq(p.role, 'mahasiswa', 'role'); ok(p.sub, 'sub');
    const rt = db.prepare('SELECT * FROM refresh_tokens WHERE jti=?').get(jwt.decode(r.json.data.refresh_token).jti);
    ok(rt && !rt.revoked_at, 'refresh token harus tersimpan di DB');
    eq(jwt.decode(r.json.data.refresh_token).exp - jwt.decode(r.json.data.refresh_token).iat, 86400, 'refresh harus 1 hari');
    expectAudit(b, { decision: 'allow', subject: 'mhs.andi', endpoint: '/auth/login', device: 'DEV-MHS-ANDI' });
  });

  await t('02', 'Login password salah ditolak (401)', async (b) => {
    const r = await call('POST', GW, '/auth/login', { device: ACC.andi.d, body: { username: 'mhs.andi', password: 'salah' } });
    eq(r.status, 401, 'status'); eq(r.code, 'INVALID_CREDENTIALS', 'code');
    expectAudit(b, { decision: 'deny', subject: 'mhs.andi', reason: 'Kredensial' });
    const r2 = await call('POST', GW, '/auth/login', { device: ACC.andi.d, body: { username: 'tidak.ada', password: 'x' } });
    eq(r2.status, 401, 'user tidak ada harus pesan sama'); eq(r2.json.error.message, r.json.error.message, 'pesan harus identik');
  });

  await t('03', 'Mahasiswa melihat nilai sendiri', async (b) => {
    const r = await call('GET', GW, '/nilai', { token: S.andi.token, device: S.andi.device });
    eq(r.status, 200, 'status'); eq(r.json.data.length, 3, 'jumlah nilai');
    ok(r.json.data.every((x) => x.nim === ACC.andi.nim), 'semua nilai harus milik Andi');
    expectAudit(b, { decision: 'allow', subject: 'mhs.andi', endpoint: '/nilai', device: 'DEV-MHS-ANDI' });
  });

  await t('04', 'Mahasiswa melihat nilai mahasiswa lain ditolak (gateway + service)', async (b) => {
    const r = await call('GET', GW, `/nilai?nim=${ACC.citra.nim}`, { token: S.andi.token, device: S.andi.device });
    eq(r.status, 403, 'status gateway');
    expectAudit(b, { decision: 'deny', subject: 'mhs.andi', endpoint: '/nilai', reason: 'miliknya sendiri' });
    const d = await call('GET', NIL, `/nilai?nim=${ACC.citra.nim}`, { token: S.andi.token, headers: withSecret });
    eq(d.status, 403, 'service juga harus menolak jika gateway di-bypass'); eq(d.code, 'FORBIDDEN', 'code service');
  });

  const row301 = nilaiRow('IF301', ACC.andi.nim), row302 = nilaiRow('IF302', ACC.andi.nim);
  await t('05', 'Dosen mengubah nilai kelas yang diampu', async (b) => {
    const r = await call('PUT', GW, `/nilai/${row301.id}`, { token: S.budi.token, device: S.budi.device, body: { nilai: 91 } });
    eq(r.status, 200, 'status'); eq(r.json.data.nilai, 91, 'nilai'); eq(r.json.data.huruf, 'A', 'huruf');
    eq(nilaiRow('IF301', ACC.andi.nim).nilai, 91, 'DB harus berubah');
    expectAudit(b, { decision: 'allow', subject: 'dosen.budi', endpoint: `/nilai/${row301.id}`, reason: 'pengampu' });
    const bad = await call('PUT', GW, `/nilai/${row301.id}`, { token: S.budi.token, device: S.budi.device, body: { nilai: 150 } });
    eq(bad.status, 400, 'validasi nilai di luar 0-100');
  });

  await t('06', 'Dosen mengubah nilai kelas dosen lain ditolak', async (b) => {
    const r = await call('PUT', GW, `/nilai/${row302.id}`, { token: S.budi.token, device: S.budi.device, body: { nilai: 100 } });
    eq(r.status, 403, 'status');
    expectAudit(b, { decision: 'deny', subject: 'dosen.budi', reason: 'bukan pengampu' });
    eq(nilaiRow('IF302', ACC.andi.nim).nilai, row302.nilai, 'nilai di DB tidak boleh berubah');
    const g = await call('GET', GW, `/nilai?kelas_id=${kelasId('IF302')}`, { token: S.budi.token, device: S.budi.device });
    eq(g.status, 403, 'Budi tidak boleh melihat nilai kelas Sari');
    const d = await call('PUT', NIL, `/nilai/${row302.id}`, { token: S.budi.token, headers: withSecret, body: { nilai: 100 } });
    eq(d.status, 403, 'service juga menolak jika gateway di-bypass');
  });

  await t('07', 'Finalisasi + sinkron transkrip; nilai final tidak bisa diubah', async (b) => {
    const r = await call('POST', GW, `/kelas/${kelasId('IF301')}/finalisasi`, { token: S.budi.token, device: S.budi.device });
    eq(r.status, 200, `status finalisasi (${JSON.stringify(r.json)})`); eq(r.json.data.jumlah_nilai_final, 3, 'jumlah final');
    eq(r.json.data.sinkron_transkrip.jumlah_disinkronkan, 3, 'jumlah sinkron');
    expectAudit(b, { decision: 'allow', subject: 'dosen.budi', endpoint: `/kelas/${kelasId('IF301')}/finalisasi` });
    expectAudit(b, { decision: 'allow', subject: 'service-nilai', endpoint: '/auth/service' });
    expectAudit(b, { decision: 'allow', subject: 'service-nilai', endpoint: '/transkrip/sinkron' }); // panggilan antar-service lewat gateway
    const e = await call('PUT', GW, `/nilai/${row301.id}`, { token: S.budi.token, device: S.budi.device, body: { nilai: 50 } });
    eq(e.status, 409, 'edit nilai final'); eq(e.code, 'NILAI_FINAL', 'code');
    expectAudit(b, { decision: 'deny', subject: 'dosen.budi', reason: 'sudah final' });
    eq(nilaiRow('IF301', ACC.andi.nim).nilai, 91, 'nilai final tidak boleh berubah');
    const again = await call('POST', GW, `/kelas/${kelasId('IF301')}/finalisasi`, { token: S.budi.token, device: S.budi.device });
    eq(again.status, 409, 'finalisasi ulang');
    const tr = await call('GET', GW, `/transkrip/${ACC.andi.nim}`, { token: S.admin.token, device: S.admin.device });
    const mk = tr.json.data.mata_kuliah.find((m) => m.kode === 'IF301');
    ok(mk && mk.nilai === 91 && mk.huruf === 'A', 'transkrip Andi harus memuat IF301 = 91 (A)');
  });

  await t('08a', 'Edit nilai kelas sendiri tetap ditolak untuk role lain (mahasiswa/admin)', async () => {
    eq((await call('PUT', GW, `/nilai/${row302.id}`, { token: S.andi.token, device: S.andi.device, body: { nilai: 100 } })).status, 403, 'mahasiswa');
    eq((await call('PUT', GW, `/nilai/${row302.id}`, { token: S.admin.token, device: S.admin.device, body: { nilai: 100 } })).status, 403, 'admin');
  });

  await t('09', 'Device tidak terdaftar / kosong / milik user lain ditolak', async (b) => {
    const r = await call('GET', GW, '/nilai', { token: S.andi.token, device: 'DEV-TIDAK-TERDAFTAR' });
    eq(r.status, 403, 'device asing'); eq(r.code, 'DEVICE_NOT_REGISTERED', 'code');
    expectAudit(b, { decision: 'deny', subject: 'mhs.andi', reason: 'Device tidak terdaftar', device: 'DEV-TIDAK-TERDAFTAR' });
    const n = await call('GET', GW, '/nilai', { token: S.andi.token });
    eq(n.status, 403, 'tanpa header'); eq(n.code, 'DEVICE_MISSING', 'code');
    const o = await call('GET', GW, '/nilai', { token: S.andi.token, device: ACC.citra.d });
    eq(o.status, 403, 'device milik Citra dipakai Andi');
    const l = await call('POST', GW, '/auth/login', { device: 'DEV-ASING', body: { username: 'mhs.andi', password: 'Mhs#12345' } });
    eq(l.status, 403, 'login dari device asing'); eq(l.code, 'DEVICE_NOT_REGISTERED', 'code login');
  });

  await t('10', 'Token kedaluwarsa / signature salah / role dipalsukan ditolak', async (b) => {
    const expired = forge(S.andi.id, { role: 'mahasiswa', username: 'mhs.andi', token_use: 'access', sid: 'x' }, { expOffset: -60 });
    const r = await call('GET', GW, '/nilai', { token: expired, device: S.andi.device });
    eq(r.status, 401, 'gateway'); eq(r.code, 'TOKEN_EXPIRED', 'code');
    expectAudit(b, { decision: 'deny', reason: 'kedaluwarsa', endpoint: '/nilai' });
    const d = await call('GET', NIL, '/nilai', { token: expired, headers: withSecret });
    eq(d.status, 401, 'service harus memverifikasi exp sendiri'); eq(d.code, 'TOKEN_EXPIRED', 'code service');
    const wrongSig = forge(S.andi.id, { role: 'mahasiswa', token_use: 'access', sid: 'x' }, { secret: 'secret-palsu-secret-palsu' });
    eq((await call('GET', GW, '/nilai', { token: wrongSig, device: S.andi.device })).code, 'TOKEN_INVALID', 'signature salah');
    const noneAlg = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: '1', role: 'admin', token_use: 'access' })).toString('base64url')}.`;
    eq((await call('GET', GW, '/nilai', { token: noneAlg, device: S.andi.device })).status, 401, 'alg none');
    const lying = forge(S.andi.id, { role: 'admin', username: 'mhs.andi', token_use: 'access', sid: 'x' }); // signature sah, role bohong
    const l = await call('GET', GW, `/transkrip/${ACC.citra.nim}`, { token: lying, device: S.andi.device });
    eq(l.status, 403, 'role di token tidak dipercaya'); eq(l.code, 'ROLE_MISMATCH', 'code');
    const ld = await call('GET', TRK, `/transkrip/${ACC.citra.nim}`, { token: lying, headers: withSecret });
    eq(ld.code, 'ROLE_MISMATCH', 'service juga mencocokkan role dengan DB');
  });

  await t('11', 'Refresh token valid -> access baru; setelah logout dicabut & ditolak', async (b) => {
    await login('citra'); const s = S.citra;
    const ok1 = await call('POST', GW, '/auth/refresh', { body: { refresh_token: s.refresh } });
    eq(ok1.status, 200, 'refresh valid'); ok(ok1.json.data.access_token, 'access baru');
    expectAudit(b, { decision: 'allow', subject: 'mhs.citra', endpoint: '/auth/refresh' });
    const lo = await call('POST', GW, '/auth/logout', { body: { refresh_token: s.refresh } });
    eq(lo.status, 200, 'logout');
    ok(db.prepare('SELECT revoked_at FROM refresh_tokens WHERE jti=?').get(jwt.decode(s.refresh).jti).revoked_at, 'revoked_at harus terisi di DB');
    const re = await call('POST', GW, '/auth/refresh', { body: { refresh_token: s.refresh } });
    eq(re.status, 401, 'refresh setelah logout'); eq(re.code, 'REFRESH_REVOKED', 'code');
    expectAudit(b, { decision: 'deny', subject: 'mhs.citra', endpoint: '/auth/refresh', reason: 'dicabut' });
    const acc = await call('GET', GW, '/nilai', { token: s.token, device: s.device });
    eq(acc.status, 401, 'access token milik sesi yang sudah logout'); eq(acc.code, 'SESSION_REVOKED', 'code');
    eq((await call('POST', GW, '/auth/logout', { body: { refresh_token: s.refresh } })).status, 401, 'logout ganda');
    eq((await call('POST', GW, '/auth/refresh', { body: { refresh_token: S.andi.token } })).status, 401, 'access token bukan refresh token');
    await login('citra');
  });

  await t('12', 'Admin melihat transkrip seluruh mahasiswa', async (b) => {
    for (const k of ['andi', 'citra', 'dewi']) {
      const r = await call('GET', GW, `/transkrip/${ACC[k].nim}`, { token: S.admin.token, device: S.admin.device });
      eq(r.status, 200, `transkrip ${k}`); eq(r.json.data.nim, ACC[k].nim, 'nim'); ok(r.json.data.mata_kuliah.length >= 2, 'isi transkrip'); ok(typeof r.json.data.ipk === 'number', 'ipk');
    }
    expectAudit(b, { decision: 'allow', subject: 'admin', reason: 'Admin melihat transkrip' });
  });

  await t('13', 'Mahasiswa hanya melihat transkrip sendiri; dosen tidak bisa', async (b) => {
    eq((await call('GET', GW, `/transkrip/${ACC.andi.nim}`, { token: S.andi.token, device: S.andi.device })).status, 200, 'milik sendiri');
    const o = await call('GET', GW, `/transkrip/${ACC.citra.nim}`, { token: S.andi.token, device: S.andi.device });
    eq(o.status, 403, 'milik orang lain');
    expectAudit(b, { decision: 'deny', subject: 'mhs.andi', reason: 'NIM sendiri' });
    eq((await call('GET', GW, `/transkrip/${ACC.andi.nim}`, { token: S.budi.token, device: S.budi.device })).status, 403, 'dosen');
    eq((await call('GET', TRK, `/transkrip/${ACC.citra.nim}`, { token: S.andi.token, headers: withSecret })).status, 403, 'service juga menolak');
  });

  await t('14', 'Token user tidak dapat dipakai untuk sinkronisasi transkrip', async (b) => {
    const body = { kelas_id: kelasId('IF201'), entries: [{ nim: ACC.andi.nim, nilai: 88 }] };
    for (const k of ['andi', 'budi', 'admin']) {
      const r = await call('POST', GW, '/transkrip/sinkron', { token: S[k].token, device: S[k].device, body });
      eq(r.status, 403, `gateway menolak token ${k}`);
    }
    expectAudit(b, { decision: 'deny', subject: 'dosen.budi', endpoint: '/transkrip/sinkron', reason: 'Token user' });
    const d = await call('POST', TRK, '/transkrip/sinkron', { token: S.budi.token, headers: withSecret, body });
    eq(d.status, 403, 'service transkrip menolak token user'); eq(d.code, 'ROLE_FORBIDDEN', 'code');
    expectAudit(b, { decision: 'deny', source: 'service-transkrip', subject: 'dosen.budi' });
  });

  await t('15', 'Service menolak request tanpa/ dengan gateway secret salah', async (b) => {
    for (const [name, base, p] of [['transkrip', TRK, `/transkrip/${ACC.andi.nim}`], ['nilai', NIL, '/nilai']]) {
      const a = await call('GET', base, p, { token: S.admin.token });
      eq(a.status, 403, `${name} tanpa secret`); eq(a.code, 'GATEWAY_SECRET_INVALID', 'code');
      const w = await call('GET', base, p, { token: S.admin.token, headers: { 'X-Gateway-Secret': 'salah-salah-salah-salah' } });
      eq(w.status, 403, `${name} secret salah`);
    }
    expectAudit(b, { decision: 'deny', source: 'service-transkrip', reason: 'X-Gateway-Secret' });
    expectAudit(b, { decision: 'deny', source: 'service-nilai', reason: 'X-Gateway-Secret' });
    const spoof = await call('GET', GW, `/transkrip/${ACC.citra.nim}`, { token: S.andi.token, device: S.andi.device, headers: withSecret });
    eq(spoof.status, 403, 'secret kiriman client tidak memberi hak apa pun di gateway');
  });

  await t('16', 'Gateway secret valid tetapi tanpa token valid tetap ditolak', async (b) => {
    const none = await call('GET', TRK, `/transkrip/${ACC.andi.nim}`, { headers: withSecret });
    eq(none.status, 401, 'tanpa token'); eq(none.code, 'TOKEN_MISSING', 'code');
    const junk = await call('GET', TRK, `/transkrip/${ACC.andi.nim}`, { token: 'bukan.token.jwt', headers: withSecret });
    eq(junk.status, 401, 'token sampah'); eq(junk.code, 'TOKEN_INVALID', 'code');
    const refreshAsAccess = await call('GET', NIL, '/nilai', { token: S.andi.refresh, headers: withSecret });
    eq(refreshAsAccess.status, 401, 'refresh token dipakai sebagai access token');
    const svcNoToken = await call('POST', TRK, '/transkrip/sinkron', { headers: withSecret, body: {} });
    eq(svcNoToken.status, 401, 'sinkron tanpa token');
    expectAudit(b, { decision: 'deny', source: 'service-transkrip', reason: 'Bearer' });
  });

  await t('17', 'Sinkronisasi dengan token service berhasil; client salah ditolak', async (b) => {
    const bad = await call('POST', GW, '/auth/service', { body: { client_id: 'service-nilai', client_secret: 'salah-salah-salah' } });
    eq(bad.status, 401, 'secret client salah'); eq(bad.code, 'INVALID_CLIENT', 'code');
    expectAudit(b, { decision: 'deny', subject: 'service-nilai', endpoint: '/auth/service' });
    const r = await call('POST', GW, '/auth/service', { body: { client_id: config.serviceNilai.clientId, client_secret: config.serviceNilai.clientSecret } });
    eq(r.status, 200, 'token service'); eq(r.json.data.role, 'service', 'role'); eq(r.json.data.expires_in, 300, 'harus 5 menit');
    eq(jwt.decode(r.json.data.access_token).role, 'service', 'klaim role');
    const svc = r.json.data.access_token;
    const body = { kelas_id: kelasId('IF201'), entries: [ACC.andi, ACC.citra, ACC.dewi].map((a) => ({ nim: a.nim, nilai: nilaiRow('IF201', a.nim).nilai })) };
    const ok1 = await call('POST', GW, '/transkrip/sinkron', { token: svc, body });
    eq(ok1.status, 200, `sinkron service (${JSON.stringify(ok1.json)})`); eq(ok1.json.data.jumlah_disinkronkan, 3, 'jumlah');
    expectAudit(b, { decision: 'allow', subject: 'service-nilai', endpoint: '/transkrip/sinkron' });
    const forgedGrade = await call('POST', GW, '/transkrip/sinkron', { token: svc, body: { kelas_id: kelasId('IF302'), entries: [{ nim: ACC.andi.nim, nilai: 100 }] } });
    eq(forgedGrade.status, 422, 'nilai yang tidak final tidak boleh masuk transkrip'); eq(forgedGrade.code, 'NILAI_NOT_FINAL', 'code');
    eq((await call('POST', GW, '/transkrip/sinkron', { token: svc, body: { kelas_id: kelasId('IF201'), entries: [{ nim: '000', nilai: 80 }] } })).status, 422, 'NIM tidak dikenal');
    eq((await call('GET', GW, '/nilai', { token: svc, device: 'apa-saja' })).status, 403, 'token service tidak bisa membaca nilai');
    eq((await call('GET', GW, `/transkrip/${ACC.andi.nim}`, { token: svc })).status, 403, 'token service tidak bisa membaca transkrip');
  });

  await t('19', 'Sinkron gagal -> finalisasi dibatalkan (nilai & transkrip tetap konsisten)', async (b) => {
    await stop('transkrip');
    const id = kelasId('IF302');
    const r = await call('POST', GW, `/kelas/${id}/finalisasi`, { token: S.sari.token, device: S.sari.device });
    eq(r.status, 502, `status (${JSON.stringify(r.json)})`); eq(r.code, 'SYNC_FAILED', 'code');
    const rows = db.prepare("SELECT status,sync_status FROM nilai WHERE kelas_id=?").all(id);
    ok(rows.every((x) => x.status === 'draft' && x.sync_status === 'none'), 'semua nilai harus kembali draft');
    eq(db.prepare('SELECT COUNT(*) c FROM transkrip WHERE kelas_id=?').get(id).c, 0, 'transkrip kelas ini harus kosong');
    start('transkrip'); await waitHealthy(TRK);
  });

  await t('18a', 'Audit log: field lengkap, zona waktu WIB, tanpa kebocoran secret', async () => {
    const rows = db.prepare('SELECT * FROM audit_log').all();
    ok(rows.some((r) => r.decision === 'allow') && rows.some((r) => r.decision === 'deny'), 'harus ada allow dan deny');
    ok(rows.every((r) => /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\+07:00$/.test(r.timestamp)), 'timestamp harus WIB (+07:00)');
    ok(rows.every((r) => r.subject && r.endpoint && r.reason && r.source), 'subject/endpoint/reason/source tidak boleh kosong');
    const userAllow = rows.filter((r) => r.source === 'gateway' && r.decision === 'allow' && r.endpoint === '/nilai');
    ok(userAllow.length && userAllow.every((r) => r.device_id), 'request user harus mencatat device');
    const blob = JSON.stringify(rows);
    ok(!blob.includes(config.gatewaySecret) && !blob.includes('Mhs#12345') && !blob.includes(S.andi.token), 'audit tidak boleh memuat secret/password/token');
    ok(db.prepare('SELECT password_hash FROM users').all().every((u) => /^\$2[aby]\$/.test(u.password_hash)), 'password harus bcrypt');
  });

  // ---------- Fase B ----------
  const h = Math.floor(nowInZone(config.timezone).minutes / 60);
  const pad = (n) => `${String((n + 24) % 24).padStart(2, '0')}:00`;
  console.log(`\nFase B - gateway dijalankan ulang dengan jam akses ${pad(h + 2)}-${pad(h + 3)} (sekarang ${nowInZone(config.timezone).label} WIB, di luar rentang)\n`);
  await stop('gateway');
  start('gateway', { ACCESS_START: pad(h + 2), ACCESS_END: pad(h + 3) });
  await waitHealthy(GW);

  await t('08', 'Edit & finalisasi nilai di luar jam akses ditolak', async (b) => {
    const r = await call('PUT', GW, `/nilai/${row302.id}`, { token: S.sari.token, device: S.sari.device, body: { nilai: 77 } });
    eq(r.status, 403, 'edit'); eq(r.code, 'OUTSIDE_ACCESS_HOURS', 'code');
    expectAudit(b, { decision: 'deny', subject: 'dosen.sari', reason: 'jam akses' });
    const f = await call('POST', GW, `/kelas/${kelasId('IF302')}/finalisasi`, { token: S.sari.token, device: S.sari.device });
    eq(f.status, 403, 'finalisasi'); eq(f.code, 'OUTSIDE_ACCESS_HOURS', 'code');
    eq(nilaiRow('IF302', ACC.andi.nim).nilai, row302.nilai, 'DB tidak boleh berubah');
    eq((await call('GET', GW, '/nilai', { token: S.sari.token, device: S.sari.device })).status, 200, 'membaca nilai tidak dibatasi jam');
  });

  await t('08b', 'Logika jam 07:00-21:00 WIB (batas) & konsistensi zona waktu', async () => {
    const [s, e] = [parseHM('07:00', 's'), parseHM('21:00', 'e')];
    const m = (hh, mm) => hh * 60 + mm;
    ok(isWithinWindow(m(7, 0), s, e) && isWithinWindow(m(20, 59), s, e), '07:00 dan 20:59 harus diizinkan');
    ok(!isWithinWindow(m(6, 59), s, e) && !isWithinWindow(m(21, 0), s, e) && !isWithinWindow(m(0, 0), s, e), '06:59, 21:00, 00:00 harus ditolak');
    const d = new Date('2026-01-01T17:30:00Z'); // 00:30 WIB hari berikutnya
    const z = nowInZone('Asia/Jakarta', d);
    eq(z.minutes, 30, 'UTC 17:30 = 00:30 WIB'); eq(z.iso, '2026-01-02T00:30:00+07:00', 'format ISO WIB');
  });

  await Promise.all(Object.keys(procs).map(stop));
  db.close();

  const failed = results.filter((r) => !r.pass);
  console.log(`\nHasil: ${results.length - failed.length}/${results.length} lulus`);
  if (failed.length) process.exitCode = 1;
  for (const k of ['test.db', 'test.db-wal', 'test.db-shm']) { try { fs.unlinkSync(path.join(root, 'data', k)); } catch { /* ok */ } }
})().catch(async (e) => {
  console.error('\nHarness error:', e);
  for (const [n, c] of Object.entries(procs)) console.error(`--- log ${n} ---\n${c.logs}`);
  await Promise.all(Object.keys(procs).map(stop));
  process.exit(2);
});
