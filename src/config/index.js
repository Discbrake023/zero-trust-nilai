'use strict';
const path = require('path');
const dotenv = require('dotenv');
const { parseHM } = require('../utils/time');

const ROOT = path.resolve(__dirname, '..', '..');
dotenv.config({ path: path.join(ROOT, '.env') }); // tidak menimpa env yang sudah ada

function secret(name) {
  const v = process.env[name];
  if (!v || v.length < 16 || v === 'CHANGE_ME') {
    throw new Error(`Konfigurasi ${name} belum diisi (min. 16 karakter). Jalankan "npm run setup" untuk membuat file .env.`);
  }
  return v;
}
const str = (name, def) => process.env[name] || def;
const port = (name, def) => {
  const n = parseInt(process.env[name] || def, 10);
  if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Error(`${name} tidak valid`);
  return n;
};

const ports = { gateway: port('PORT_GATEWAY', 3000), nilai: port('PORT_NILAI', 3001), transkrip: port('PORT_TRANSKRIP', 3002) };

const config = {
  root: ROOT,
  timezone: str('TIMEZONE', 'Asia/Jakarta'),
  db: { path: path.resolve(ROOT, str('DB_PATH', './data/zero-trust.db')) },
  ports,
  urls: {
    gateway: str('GATEWAY_URL', `http://127.0.0.1:${ports.gateway}`),
    nilai: str('NILAI_URL', `http://127.0.0.1:${ports.nilai}`),
    transkrip: str('TRANSKRIP_URL', `http://127.0.0.1:${ports.transkrip}`),
  },
  jwt: {
    accessSecret: secret('JWT_ACCESS_SECRET'),
    refreshSecret: secret('JWT_REFRESH_SECRET'),
    accessTtl: str('ACCESS_TOKEN_TTL', '10m'),
    refreshTtl: str('REFRESH_TOKEN_TTL', '1d'),
    serviceTtl: str('SERVICE_TOKEN_TTL', '5m'),
    issuer: 'zt-gateway',
  },
  gatewaySecret: secret('GATEWAY_SECRET'),
  serviceNilai: {
    clientId: str('SERVICE_NILAI_CLIENT_ID', 'service-nilai'),
    clientSecret: secret('SERVICE_NILAI_CLIENT_SECRET'),
  },
  accessHours: {
    startText: str('ACCESS_START', '07:00'),
    endText: str('ACCESS_END', '21:00'),
  },
  bcryptRounds: 10,
};
config.accessHours.startMin = parseHM(config.accessHours.startText, 'ACCESS_START');
config.accessHours.endMin = parseHM(config.accessHours.endText, 'ACCESS_END');

module.exports = config;
