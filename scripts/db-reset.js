'use strict';
const fs = require('fs');
const config = require('../src/config');
for (const ext of ['', '-wal', '-shm']) {
  const f = config.db.path + ext;
  if (fs.existsSync(f)) { fs.unlinkSync(f); console.log('dihapus:', f); }
}
require('./db-init');
