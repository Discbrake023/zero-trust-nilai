'use strict';
const express = require('express');
const config = require('../config');
const { initDatabase } = require('../db');
const { createServiceGuard } = require('../shared/serviceGuard');
const { notFound, errorHandler } = require('../utils/http');
const transkripRoutes = require('./routes/transkrip');

initDatabase();
const guard = createServiceGuard('service-transkrip');

const app = express();
app.disable('x-powered-by');
app.get('/health', (req, res) => res.json({ service: 'service-transkrip', status: 'ok' }));

app.use(guard.verifyGatewaySecret, guard.verifyToken, express.json({ limit: '200kb' }));
app.use('/transkrip', transkripRoutes(guard));

app.use(notFound);
app.use(errorHandler);

app.listen(config.ports.transkrip, '127.0.0.1', () => console.log(`[service-transkrip] berjalan di http://127.0.0.1:${config.ports.transkrip}`));
