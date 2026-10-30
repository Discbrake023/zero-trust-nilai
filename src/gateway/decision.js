'use strict';
// Titik tunggal pencatatan keputusan akses gateway (audit log) + response penolakan.
const { writeAudit, pathOf } = require('../shared/audit');
const { sendError, HttpError } = require('../utils/http');

function record(req, decision, reason, extra = {}) {
  const s = req.subject || {};
  writeAudit({
    source: 'gateway',
    subject: extra.subject || s.username || s.id || 'anonymous',
    role: extra.role || s.role || null,
    method: req.method,
    endpoint: pathOf(req),
    deviceId: extra.deviceId !== undefined ? extra.deviceId : req.get('x-device-id'),
    decision, reason,
  });
}

// Fail-closed: jika audit gagal ditulis, request tidak diteruskan.
function allow(req, reason, extra) {
  try { record(req, 'allow', reason, extra); } catch (e) {
    console.error('[gateway] audit gagal', e.message);
    throw new HttpError(500, 'AUDIT_FAILED', 'Audit log gagal ditulis; request ditolak');
  }
}

function deny(req, res, { status = 403, code = 'ACCESS_DENIED', reason, ...extra }) {
  try { record(req, 'deny', reason, extra); } catch (e) { console.error('[gateway] audit gagal', e.message); }
  return sendError(res, status, code, reason);
}

module.exports = { allow, deny };
