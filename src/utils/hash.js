'use strict';
const crypto = require('crypto');

const sha256 = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

module.exports = { sha256, safeEqual, randomId: () => crypto.randomBytes(16).toString('hex') };
