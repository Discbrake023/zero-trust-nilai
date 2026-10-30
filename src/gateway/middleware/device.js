'use strict';
// Langkah 2 PEP: device harus terdaftar untuk user tersebut (4.3).
const repo = require('../../db/repo');
const { deny } = require('../decision');

module.exports = function verifyDevice(req, res, next) {
  if (req.subject.type === 'service') return next(); // panggilan antar-service tidak membawa device user
  const deviceId = req.get('x-device-id');
  if (!deviceId) {
    return deny(req, res, { status: 403, code: 'DEVICE_MISSING', reason: 'Header X-Device-ID wajib untuk request user' });
  }
  if (!repo.hasDevice(req.subject.id, deviceId)) {
    return deny(req, res, { status: 403, code: 'DEVICE_NOT_REGISTERED', reason: 'Device tidak terdaftar untuk user ini' });
  }
  return next();
};
