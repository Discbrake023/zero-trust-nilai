'use strict';
const { initDatabase } = require('../src/db');
const config = require('../src/config');
const { seeded } = initDatabase();
console.log(seeded ? `Database dibuat & di-seed: ${config.db.path}` : `Database sudah ada: ${config.db.path}`);
