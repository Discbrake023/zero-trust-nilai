'use strict';
// Query yang dipakai Policy Engine dan service. Semua keputusan kepemilikan data
// dibaca dari sini (database), bukan dari klaim di dalam JWT.
const { getDb } = require('./connection');

const one = (sql, ...p) => getDb().prepare(sql).get(...p);

module.exports = {
  getUserById: (id) => one('SELECT id,username,nama,role,nim FROM users WHERE id=?', id),
  getUserByUsername: (u) => one('SELECT * FROM users WHERE username=?', u),
  getUserByNim: (nim) => one('SELECT id,username,nama,role,nim FROM users WHERE nim=?', nim),
  hasDevice: (userId, deviceId) => !!one('SELECT 1 AS x FROM devices WHERE user_id=? AND device_id=?', userId, deviceId),
  getKelas: (id) => one('SELECT * FROM kelas WHERE id=?', id),
  getNilai: (id) => one(
    `SELECT n.*, k.dosen_id, k.kode AS kelas_kode FROM nilai n JOIN kelas k ON k.id=n.kelas_id WHERE n.id=?`, id),
  getServiceClient: (clientId) => one('SELECT * FROM service_clients WHERE client_id=?', clientId),
  getRefreshByJti: (jti) => one('SELECT * FROM refresh_tokens WHERE jti=?', jti),
  isSessionActive: (jti, nowIso) => !!one(
    'SELECT 1 AS x FROM refresh_tokens WHERE jti=? AND revoked_at IS NULL AND expires_at > ?', jti, nowIso),
};
