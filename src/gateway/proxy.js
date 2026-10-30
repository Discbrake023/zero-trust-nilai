'use strict';
const { createProxyMiddleware } = require('http-proxy-middleware');
const config = require('../config');
const { sendError } = require('../utils/http');

// Gateway menambahkan X-Gateway-Secret (menimpa kiriman client) saat meneruskan ke service.
function makeProxy(target, pathFilter) {
  return createProxyMiddleware({
    target, pathFilter, changeOrigin: false, proxyTimeout: 15000, timeout: 15000,
    on: {
      proxyReq: (proxyReq) => { proxyReq.setHeader('X-Gateway-Secret', config.gatewaySecret); },
      error: (err, req, res) => {
        console.error('[gateway] proxy error:', err.message);
        if (res && typeof res.status === 'function' && !res.headersSent) {
          sendError(res, 502, 'UPSTREAM_UNAVAILABLE', 'Service tujuan tidak dapat dihubungi');
        } else if (res && !res.headersSent && res.writeHead) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: { code: 'UPSTREAM_UNAVAILABLE', message: 'Service tujuan tidak dapat dihubungi' } }));
        }
      },
    },
  });
}

module.exports = {
  nilaiProxy: makeProxy(config.urls.nilai, ['/nilai', '/kelas']),
  transkripProxy: makeProxy(config.urls.transkrip, ['/transkrip']),
};
