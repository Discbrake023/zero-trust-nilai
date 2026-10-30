'use strict';
const jwt = require('jsonwebtoken');
const config = require('../config');
const { sha256, randomId } = require('../utils/hash');
const { getDb } = require('../db/connection');
const { nowInZone } = require('../utils/time');

const ALG = ['HS256'];
const ROLES = ['mahasiswa', 'dosen', 'admin'];

// Access token user: sub = id user, role, sid = id sesi (jti refresh token)
function signAccess(user, sid) {
  return jwt.sign(
    { role: user.role, username: user.username, token_use: 'access', sid },
    config.jwt.accessSecret,
    { subject: String(user.id), expiresIn: config.jwt.accessTtl, issuer: config.jwt.issuer, algorithm: 'HS256', jwtid: randomId() });
}

// Token service: role = service
function signService(clientId) {
  return jwt.sign(
    { role: 'service', token_use: 'service' },
    config.jwt.accessSecret,
    { subject: clientId, expiresIn: config.jwt.serviceTtl, issuer: config.jwt.issuer, algorithm: 'HS256', jwtid: randomId() });
}

// Refresh token: JWT + disimpan (hash) di database agar bisa dicabut.
function issueRefresh(user, deviceId) {
  const jti = randomId();
  const token = jwt.sign({ token_use: 'refresh' }, config.jwt.refreshSecret,
    { subject: String(user.id), expiresIn: config.jwt.refreshTtl, issuer: config.jwt.issuer, algorithm: 'HS256', jwtid: jti });
  const { iat, exp } = jwt.decode(token);
  const iso = (s) => nowInZone(config.timezone, new Date(s * 1000)).iso;
  getDb().prepare(
    'INSERT INTO refresh_tokens (jti,user_id,device_id,token_hash,issued_at,expires_at) VALUES (?,?,?,?,?,?)')
    .run(jti, user.id, deviceId, sha256(token), iso(iat), iso(exp));
  return { token, jti };
}

// Verifikasi access token ATAU token service (dipakai gateway dan kedua service).
function verifyAccessLike(token) {
  const p = jwt.verify(token, config.jwt.accessSecret, { algorithms: ALG, issuer: config.jwt.issuer });
  if (p.token_use === 'service') {
    if (p.role !== 'service') throw new jwt.JsonWebTokenError('klaim role token service tidak valid');
  } else if (p.token_use === 'access') {
    if (!ROLES.includes(p.role)) throw new jwt.JsonWebTokenError('klaim role tidak valid');
  } else {
    throw new jwt.JsonWebTokenError('jenis token tidak dikenal');
  }
  if (!p.sub) throw new jwt.JsonWebTokenError('klaim sub tidak ada');
  return p;
}

function verifyRefresh(token, { ignoreExpiration = false } = {}) {
  const p = jwt.verify(token, config.jwt.refreshSecret, { algorithms: ALG, issuer: config.jwt.issuer, ignoreExpiration });
  if (p.token_use !== 'refresh' || !p.jti) throw new jwt.JsonWebTokenError('bukan refresh token');
  return p;
}

const ttlSeconds = (token) => { const d = jwt.decode(token); return d.exp - d.iat; };

module.exports = { signAccess, signService, issueRefresh, verifyAccessLike, verifyRefresh, ttlSeconds };
