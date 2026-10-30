'use strict';
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('../config');

let db = null;

// Satu file SQLite dipakai bersama oleh gateway, Service Nilai, dan Service Transkrip.
function getDb() {
  if (!db) {
    fs.mkdirSync(path.dirname(config.db.path), { recursive: true });
    db = new Database(config.db.path);
    db.pragma('busy_timeout = 5000'); // tiga proses menulis ke file yang sama
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

module.exports = { getDb };
