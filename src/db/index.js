'use strict';
const { getDb } = require('./connection');
const schema = require('./schema');
const { seedIfEmpty } = require('./seed');

// Idempoten: aman dipanggil oleh ketiga proses saat startup.
function initDatabase() {
  const db = getDb();
  db.exec(schema);
  const seeded = seedIfEmpty(db);
  return { db, seeded };
}

module.exports = { initDatabase, getDb };
