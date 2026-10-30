'use strict';
const bcrypt = require('bcryptjs');
const config = require('../config');
const { nowInZone } = require('../utils/time');
const { sha256, randomId } = require('../utils/hash');
const { nilaiToHuruf } = require('../utils/grade');

// Akun demo (password dicetak di README; di database hanya tersimpan hash bcrypt).
const USERS = [
  { username: 'admin',      nama: 'Administrator Prodi', role: 'admin',     nim: null,           password: 'Admin#123', device: 'DEV-ADMIN-01' },
  { username: 'dosen.budi', nama: 'Dr. Budi Santoso',    role: 'dosen',     nim: null,           password: 'Dosen#123', device: 'DEV-DOSEN-BUDI' },
  { username: 'dosen.sari', nama: 'Dr. Sari Wulandari',  role: 'dosen',     nim: null,           password: 'Dosen#123', device: 'DEV-DOSEN-SARI' },
  { username: 'mhs.andi',   nama: 'Andi Pratama',        role: 'mahasiswa', nim: '247006111001', password: 'Mhs#12345', device: 'DEV-MHS-ANDI' },
  { username: 'mhs.citra',  nama: 'Citra Lestari',       role: 'mahasiswa', nim: '247006111002', password: 'Mhs#12345', device: 'DEV-MHS-CITRA' },
  { username: 'mhs.dewi',   nama: 'Dewi Anggraini',      role: 'mahasiswa', nim: '247006111003', password: 'Mhs#12345', device: 'DEV-MHS-DEWI' },
];

// IF201 sudah final (riwayat semester lalu) -> ikut tersimpan di transkrip.
// IF301 (Budi) dan IF302 (Sari) masih draft agar bisa didemokan.
const KELAS = [
  { kode: 'IF201', nama: 'Jaringan Komputer',  sks: 3, dosen: 'dosen.budi', final: true,  nilai: [88, 76, 92] },
  { kode: 'IF301', nama: 'Keamanan Informasi', sks: 3, dosen: 'dosen.budi', final: false, nilai: [80, 72, 85] },
  { kode: 'IF302', nama: 'Pemrograman Web',    sks: 3, dosen: 'dosen.sari', final: false, nilai: [78, 90, 66] },
];
const MHS = ['mhs.andi', 'mhs.citra', 'mhs.dewi'];

function seedIfEmpty(db) {
  if (db.prepare('SELECT COUNT(*) AS c FROM users').get().c > 0) return false;

  // Hash dihitung di luar transaksi agar lock tulis singkat.
  const rounds = config.bcryptRounds;
  const hashes = Object.fromEntries(USERS.map((u) => [u.username, bcrypt.hashSync(u.password, rounds)]));
  const clientHash = bcrypt.hashSync(config.serviceNilai.clientSecret, rounds);
  const now = nowInZone(config.timezone).iso;

  const tx = db.transaction(() => {
    if (db.prepare('SELECT COUNT(*) AS c FROM users').get().c > 0) return false; // proses lain sudah seed
    const ids = {};
    for (const u of USERS) {
      ids[u.username] = db.prepare('INSERT INTO users (username,password_hash,nama,role,nim) VALUES (?,?,?,?,?)')
        .run(u.username, hashes[u.username], u.nama, u.role, u.nim).lastInsertRowid;
      db.prepare('INSERT INTO devices (user_id,device_id,label) VALUES (?,?,?)').run(ids[u.username], u.device, `Perangkat ${u.nama}`);
    }
    db.prepare('INSERT INTO service_clients (client_id,secret_hash,name) VALUES (?,?,?)')
      .run(config.serviceNilai.clientId, clientHash, 'Service Nilai');

    for (const k of KELAS) {
      const kid = db.prepare('INSERT INTO kelas (kode,nama,sks,dosen_id) VALUES (?,?,?,?)')
        .run(k.kode, k.nama, k.sks, ids[k.dosen]).lastInsertRowid;
      MHS.forEach((m, i) => {
        const n = k.nilai[i];
        db.prepare(`INSERT INTO nilai (kelas_id,mahasiswa_id,nilai,status,sync_status,updated_at,finalized_at)
                    VALUES (?,?,?,?,?,?,?)`)
          .run(kid, ids[m], n, k.final ? 'final' : 'draft', k.final ? 'synced' : 'none', now, k.final ? now : null);
        if (k.final) {
          db.prepare('INSERT INTO transkrip (mahasiswa_id,kelas_id,nilai,huruf,synced_at) VALUES (?,?,?,?,?)')
            .run(ids[m], kid, n, nilaiToHuruf(n), now);
        }
      });
    }

    // Contoh baris refresh token (sudah kedaluwarsa & dicabut). Token sungguhan dibuat saat login.
    db.prepare(`INSERT INTO refresh_tokens (jti,user_id,device_id,token_hash,issued_at,expires_at,revoked_at)
                VALUES (?,?,?,?,?,?,?)`)
      .run(randomId(), ids['mhs.andi'], 'DEV-MHS-ANDI', sha256('contoh-token-seed'), '2000-01-01T00:00:00+07:00', '2000-01-02T00:00:00+07:00', '2000-01-01T01:00:00+07:00');

    db.prepare(`INSERT INTO audit_log (timestamp,source,subject,role,method,endpoint,device_id,decision,reason)
                VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(now, 'seed', 'system', 'system', 'SEED', '/db/seed', null, 'allow', 'Database diinisialisasi dengan data awal');
    return true;
  });
  return tx.immediate();
}

module.exports = { seedIfEmpty, USERS, KELAS };
