'use strict';
const express = require('express');
const config = require('../config');
const { initDatabase } = require('../db');
const { notFound, errorHandler } = require('../utils/http');
const authRoutes = require('./routes/auth');
const authenticate = require('./middleware/authenticate');
const verifyDevice = require('./middleware/device');
const enforcePolicy = require('./middleware/enforcePolicy');
const { nilaiProxy, transkripProxy } = require('./proxy');

initDatabase();

const app = express();
app.disable('x-powered-by');

app.get('/health', (req, res) => res.json({ service: 'api-gateway', status: 'ok' }));

// /auth/* ditangani gateway sendiri (Policy Administrator). Body parser hanya di sini;
// request ke service diteruskan sebagai stream apa adanya.
app.use('/auth', express.json({ limit: '10kb' }), authRoutes);

// Semua selain /auth: PEP -> identitas -> device -> kebijakan -> audit -> proxy.
app.use(authenticate, verifyDevice, enforcePolicy);
app.use(nilaiProxy);
app.use(transkripProxy);

app.use(notFound);
app.use(errorHandler);

app.listen(config.ports.gateway, '127.0.0.1', () => {
  console.log(`[gateway] API Gateway berjalan di http://127.0.0.1:${config.ports.gateway}`);
  console.log(`[gateway] Jam akses edit/finalisasi: ${config.accessHours.startText}-${config.accessHours.endText} (${config.timezone})`);
});
