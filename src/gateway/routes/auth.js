'use strict';
// Policy Administrator: login, refresh, logout, token service (Tabel 3, baris /auth/*).
const express = require('express');
const bcrypt = require('bcryptjs');
const config = require('../../config');
const repo = require('../../db/repo');
const { getDb } = require('../../db/connection');
const tokens = require('../../shared/tokens');
const { sha256, safeEqual } = require('../../utils/hash');
const { nowInZone } = require('../../utils/time');
const { sendOk, sendError, HttpError } = require('../../utils/http');
const { allow, deny } = require('../decision');

const router = express.Router();
const DUMMY_HASH = bcrypt.hashSync('dummy-password', config.bcryptRounds); // anti timing-enumeration user
const str = (v) => typeof v === 'string' && v.length > 0 && v.length <= 2000;
const guard = (fn) => (req, res) => { try { fn(req, res); } catch (e) {
  if (e instanceof HttpError) return sendError(res, e.status, e.code, e.message);
  console.error('[auth]', e); return sendError(res, 500, 'INTERNAL_ERROR', 'Terjadi kesalahan internal'); } };

router.post('/login', guard((req, res) => {
  const { username, password } = req.body || {};
  const deviceId = req.get('x-device-id');
  if (!str(username) || !str(password)) {
    return deny(req, res, { status: 400, code: 'BAD_REQUEST', reason: 'username dan password wajib diisi', subject: 'anonymous' });
  }
  const user = repo.getUserByUsername(username);
  const ok = bcrypt.compareSync(password, user ? user.password_hash : DUMMY_HASH);
  if (!user || !ok) {
    return deny(req, res, { status: 401, code: 'INVALID_CREDENTIALS', reason: 'Kredensial tidak valid', subject: username.slice(0, 50) });
  }
  if (!deviceId) return deny(req, res, { status: 403, code: 'DEVICE_MISSING', reason: 'Header X-Device-ID wajib', subject: user.username, role: user.role });
  if (!repo.hasDevice(user.id, deviceId)) {
    return deny(req, res, { status: 403, code: 'DEVICE_NOT_REGISTERED', reason: 'Device tidak terdaftar untuk user ini', subject: user.username, role: user.role });
  }
  const refresh = tokens.issueRefresh(user, deviceId);
  const access = tokens.signAccess(user, refresh.jti);
  allow(req, 'Login berhasil (kredensial valid, device terdaftar)', { subject: user.username, role: user.role });
  return sendOk(res, {
    token_type: 'Bearer', access_token: access, expires_in: tokens.ttlSeconds(access), refresh_token: refresh.token,
    user: { id: user.id, username: user.username, nama: user.nama, role: user.role, nim: user.nim },
  });
}));

// Memuat & memvalidasi refresh token (signature + status di DB). Mengembalikan baris DB atau null (sudah di-deny).
function loadRefresh(req, res, { allowExpired = false } = {}) {
  const token = (req.body || {}).refresh_token;
  if (!str(token)) { deny(req, res, { status: 400, code: 'BAD_REQUEST', reason: 'refresh_token wajib diisi', subject: 'anonymous' }); return null; }
  let p;
  try { p = tokens.verifyRefresh(token, { ignoreExpiration: allowExpired }); } catch (e) {
    const exp = e.name === 'TokenExpiredError';
    deny(req, res, { status: 401, code: exp ? 'REFRESH_EXPIRED' : 'REFRESH_INVALID', reason: exp ? 'Refresh token kedaluwarsa' : 'Refresh token tidak valid', subject: 'anonymous' });
    return null;
  }
  const row = repo.getRefreshByJti(p.jti);
  const user = row && repo.getUserById(row.user_id);
  const who = { subject: user ? user.username : 'anonymous', role: user ? user.role : null };
  if (!row || !safeEqual(row.token_hash, sha256(token)) || !user) {
    deny(req, res, { status: 401, code: 'REFRESH_UNKNOWN', reason: 'Refresh token tidak dikenal', ...who }); return null;
  }
  if (row.revoked_at) {
    deny(req, res, { status: 401, code: 'REFRESH_REVOKED', reason: 'Refresh token sudah dicabut', ...who }); return null;
  }
  const dev = req.get('x-device-id');
  if (dev && dev !== row.device_id) {
    deny(req, res, { status: 403, code: 'DEVICE_MISMATCH', reason: 'Device tidak sesuai dengan sesi refresh token', ...who }); return null;
  }
  return { row, user, who };
}

router.post('/refresh', guard((req, res) => {
  const r = loadRefresh(req, res);
  if (!r) return undefined;
  if (!repo.hasDevice(r.user.id, r.row.device_id)) {
    return deny(req, res, { status: 403, code: 'DEVICE_NOT_REGISTERED', reason: 'Device sesi sudah tidak terdaftar', ...r.who });
  }
  const access = tokens.signAccess(r.user, r.row.jti);
  allow(req, 'Refresh token valid dan belum dicabut; access token baru diterbitkan', r.who);
  return sendOk(res, { token_type: 'Bearer', access_token: access, expires_in: tokens.ttlSeconds(access) });
}));

router.post('/logout', guard((req, res) => {
  const r = loadRefresh(req, res, { allowExpired: true });
  if (!r) return undefined;
  getDb().prepare('UPDATE refresh_tokens SET revoked_at=? WHERE jti=? AND revoked_at IS NULL')
    .run(nowInZone(config.timezone).iso, r.row.jti);
  allow(req, 'Logout: refresh token dicabut', r.who);
  return sendOk(res, { message: 'Logout berhasil, refresh token dicabut' });
}));

router.post('/service', guard((req, res) => {
  const { client_id: clientId, client_secret: clientSecret } = req.body || {};
  if (!str(clientId) || !str(clientSecret)) {
    return deny(req, res, { status: 400, code: 'BAD_REQUEST', reason: 'client_id dan client_secret wajib diisi', subject: 'anonymous', deviceId: null });
  }
  const client = repo.getServiceClient(clientId);
  const ok = bcrypt.compareSync(clientSecret, client ? client.secret_hash : DUMMY_HASH);
  if (!client || !ok || client.client_id !== config.serviceNilai.clientId) {
    return deny(req, res, { status: 401, code: 'INVALID_CLIENT', reason: 'Client ID atau secret tidak valid', subject: clientId.slice(0, 50), role: 'service', deviceId: null });
  }
  const token = tokens.signService(client.client_id);
  allow(req, 'Token service diterbitkan untuk Service Nilai', { subject: client.client_id, role: 'service', deviceId: null });
  return sendOk(res, { token_type: 'Bearer', access_token: token, expires_in: tokens.ttlSeconds(token), role: 'service' });
}));

router.use((req, res) => sendError(res, 404, 'NOT_FOUND', 'Endpoint /auth tidak ditemukan'));

module.exports = router;
