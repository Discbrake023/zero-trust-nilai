'use strict';
const express = require('express');
const config = require('../config');
const { initDatabase } = require('../db');
const { createServiceGuard } = require('../shared/serviceGuard');
const { notFound, errorHandler } = require('../utils/http');
const nilaiRoutes = require('./routes/nilai');
const kelasRoutes = require('./routes/kelas');

initDatabase();
const guard = createServiceGuard('service-nilai');

const app = express();
app.disable('x-powered-by');
app.get('/health', (req, res) => res.json({ service: 'service-nilai', status: 'ok' })); // satu-satunya endpoint tanpa secret

// 1) gateway secret  2) JWT  3) subjek dari DB  -- sebelum route apa pun
app.use(guard.verifyGatewaySecret, guard.verifyToken, express.json({ limit: '100kb' }));

app.use('/nilai', nilaiRoutes(guard));
app.use('/kelas', kelasRoutes(guard));

app.use(notFound);
app.use(errorHandler);

app.listen(config.ports.nilai, '127.0.0.1', () => console.log(`[service-nilai] berjalan di http://127.0.0.1:${config.ports.nilai}`));
