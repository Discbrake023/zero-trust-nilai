'use strict';
// Langkah 3 PEP: minta keputusan ke Policy Engine, catat audit, lalu teruskan atau tolak.
const config = require('../../config');
const policy = require('../policy/policy');
const { nowInZone } = require('../../utils/time');
const { allow, deny } = require('../decision');

module.exports = function enforcePolicy(req, res, next) {
  const now = nowInZone(config.timezone);
  const d = policy.decide({ subject: req.subject, method: req.method, path: req.path, query: req.query, nowMinutes: now.minutes });
  if (!d.allow) return deny(req, res, { status: d.status, code: d.code, reason: d.reason });
  allow(req, d.reason);
  return next();
};
