'use strict';
// Langkah 1 PEP: verifikasi identitas (token). Tidak ada request non-/auth yang lolos tanpa ini.
const config = require('../../config');
const repo = require('../../db/repo');
const { verifyAccessLike } = require('../../shared/tokens');
const { nowInZone } = require('../../utils/time');
const { deny } = require('../decision');

module.exports = function authenticate(req, res, next) {
  const m = /^Bearer ([^\s]+)$/.exec(req.get('authorization') || '');
  if (!m) return deny(req, res, { status: 401, code: 'TOKEN_MISSING', reason: 'Access token tidak ada (header Authorization: Bearer <token>)' });

  let p;
  try {
    p = verifyAccessLike(m[1]);
  } catch (e) {
    const expired = e.name === 'TokenExpiredError';
    return deny(req, res, { status: 401, code: expired ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID',
      reason: expired ? 'Access token kedaluwarsa' : 'Token tidak valid (signature/klaim salah)' });
  }

  if (p.token_use === 'service') {
    if (!repo.getServiceClient(p.sub)) {
      return deny(req, res, { status: 401, code: 'CLIENT_UNKNOWN', reason: 'Client service pada token tidak terdaftar', subject: p.sub, role: 'service' });
    }
    req.subject = { type: 'service', id: p.sub, role: 'service' };
    return next();
  }

  // Role diambil dari DATABASE; klaim role di token hanya dicocokkan, tidak dipercaya.
  const user = repo.getUserById(Number(p.sub));
  if (!user) return deny(req, res, { status: 401, code: 'USER_NOT_FOUND', reason: 'User pada token tidak ditemukan', subject: p.sub });
  if (user.role !== p.role) {
    return deny(req, res, { status: 403, code: 'ROLE_MISMATCH', reason: 'Role pada token tidak sesuai dengan database', subject: user.username, role: p.role });
  }
  // Sesi dicabut (logout) => access token yang masih berlaku ikut tidak diterima.
  if (!p.sid || !repo.isSessionActive(p.sid, nowInZone(config.timezone).iso)) {
    return deny(req, res, { status: 401, code: 'SESSION_REVOKED', reason: 'Sesi sudah berakhir atau dicabut (logout)', subject: user.username, role: user.role });
  }
  req.subject = { type: 'user', id: user.id, username: user.username, role: user.role, nim: user.nim };
  return next();
};
