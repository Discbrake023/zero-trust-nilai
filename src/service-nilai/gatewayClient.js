'use strict';
// Komunikasi antar-service: Service Nilai SELALU lewat API Gateway (bukan langsung ke Service Transkrip).
const jwt = require('jsonwebtoken');
const config = require('../config');

let cached = null; // { token, expMs }

async function callGateway(path, { token, body }) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${config.urls.gateway}${path}`, {
    method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(8000),
  });
  let json = null;
  try { json = await res.json(); } catch { /* body bukan JSON */ }
  return { status: res.status, json };
}

async function getServiceToken() {
  if (cached && cached.expMs - Date.now() > 30000) return cached.token;
  const r = await callGateway('/auth/service', {
    body: { client_id: config.serviceNilai.clientId, client_secret: config.serviceNilai.clientSecret },
  });
  if (r.status !== 200 || !r.json || !r.json.success) {
    throw new Error(`gateway menolak permintaan token service (HTTP ${r.status})`);
  }
  const token = r.json.data.access_token;
  cached = { token, expMs: jwt.decode(token).exp * 1000 };
  return token;
}

async function syncTranskrip(payload) {
  const token = await getServiceToken();
  const r = await callGateway('/transkrip/sinkron', { token, body: payload });
  if (r.status === 401) cached = null;
  if (r.status !== 200 || !r.json || !r.json.success) {
    const msg = r.json && r.json.error ? r.json.error.message : 'tanpa detail';
    throw new Error(`sinkron transkrip ditolak (HTTP ${r.status}): ${msg}`);
  }
  return r.json.data;
}

module.exports = { getServiceToken, syncTranskrip };
