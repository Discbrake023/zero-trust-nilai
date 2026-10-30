'use strict';
// Dipakai Service Nilai & Service Transkrip. Tiga lapis verifikasi ulang (assume breach):
//   1) X-Gateway-Secret  -> request harus datang dari gateway
//   2) JWT (signature, exp, issuer, jenis token) -> request harus punya token valid
//   3) subjek dimuat dari DB -> role di token harus cocok dengan role di database
const config = require('../config');
const repo = require('../db/repo');
const { safeEqual } = require('../utils/hash');
const { sendError } = require('../utils/http');
const { verifyAccessLike } = require('./tokens');
const { writeAudit, pathOf } = require('./audit');

function createServiceGuard(serviceName) {
  const deny = (req, res, status, code, reason, subject = 'unknown', role = null) => {
    try {
      writeAudit({ source: serviceName, subject, role, method: req.method, endpoint: pathOf(req),
        deviceId: req.get('x-device-id'), decision: 'deny', reason });
    } catch (e) { console.error(`[${serviceName}] gagal menulis audit`, e.message); }
    return sendError(res, status, code, reason);
  };

  function verifyGatewaySecret(req, res, next) {
    const given = req.get('x-gateway-secret');
    if (!given || !safeEqual(given, config.gatewaySecret)) {
      return deny(req, res, 403, 'GATEWAY_SECRET_INVALID',
        'Request tidak datang dari API Gateway (X-Gateway-Secret tidak ada/tidak valid)');
    }
    return next();
  }

  function verifyToken(req, res, next) {
    const m = /^Bearer ([^\s]+)$/.exec(req.get('authorization') || '');
    if (!m) return deny(req, res, 401, 'TOKEN_MISSING', 'Authorization Bearer token tidak ada');
    let payload;
    try {
      payload = verifyAccessLike(m[1]);
    } catch (e) {
      const expired = e.name === 'TokenExpiredError';
      return deny(req, res, 401, expired ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID',
        expired ? 'Token kedaluwarsa' : 'Signature/isi token tidak valid');
    }
    if (payload.token_use === 'service') {
      req.subject = { type: 'service', id: payload.sub, role: 'service' };
      return next();
    }
    const user = repo.getUserById(Number(payload.sub));
    if (!user) return deny(req, res, 401, 'USER_NOT_FOUND', 'User pada token tidak ditemukan', payload.sub, payload.role);
    if (user.role !== payload.role) {
      return deny(req, res, 403, 'ROLE_MISMATCH', 'Role pada token tidak sesuai dengan database', user.username, payload.role);
    }
    req.subject = { type: 'user', id: user.id, username: user.username, role: user.role, nim: user.nim, nama: user.nama };
    return next();
  }

  const requireRole = (...roles) => (req, res, next) => {
    if (!roles.includes(req.subject.role)) {
      return deny(req, res, 403, 'ROLE_FORBIDDEN', `Role ${req.subject.role} tidak diizinkan di endpoint ini`,
        req.subject.username || req.subject.id, req.subject.role);
    }
    return next();
  };

  return { verifyGatewaySecret, verifyToken, requireRole, deny };
}

module.exports = { createServiceGuard };
