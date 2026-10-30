'use strict';
const config = require('../config');
const { getDb } = require('../db/connection');
const { nowInZone } = require('../utils/time');

// Menulis satu baris audit log ke database. Melempar error jika gagal (fail-closed).
function writeAudit({ source, subject, role = null, method = null, endpoint, deviceId = null, decision, reason }) {
  getDb().prepare(
    `INSERT INTO audit_log (timestamp,source,subject,role,method,endpoint,device_id,decision,reason)
     VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(nowInZone(config.timezone).iso, source, String(subject || 'anonymous'), role, method, endpoint,
      deviceId ? String(deviceId).slice(0, 100) : null, decision, reason);
}

const pathOf = (req) => (req.originalUrl || req.url || '').split('?')[0];

module.exports = { writeAudit, pathOf };
