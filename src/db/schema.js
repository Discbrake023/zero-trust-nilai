'use strict';
module.exports = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  nama          TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('mahasiswa','dosen','admin')),
  nim           TEXT UNIQUE
);

CREATE TABLE IF NOT EXISTS devices (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id   INTEGER NOT NULL REFERENCES users(id),
  device_id TEXT NOT NULL,
  label     TEXT,
  UNIQUE (user_id, device_id)
);

CREATE TABLE IF NOT EXISTS kelas (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  kode     TEXT NOT NULL UNIQUE,
  nama     TEXT NOT NULL,
  sks      INTEGER NOT NULL DEFAULT 3,
  dosen_id INTEGER NOT NULL REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS nilai (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  kelas_id     INTEGER NOT NULL REFERENCES kelas(id),
  mahasiswa_id INTEGER NOT NULL REFERENCES users(id),
  nilai        REAL NOT NULL CHECK (nilai >= 0 AND nilai <= 100),
  status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','final')),
  sync_status  TEXT NOT NULL DEFAULT 'none' CHECK (sync_status IN ('none','pending','synced')),
  updated_at   TEXT,
  finalized_at TEXT,
  UNIQUE (kelas_id, mahasiswa_id)
);

CREATE TABLE IF NOT EXISTS transkrip (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  mahasiswa_id INTEGER NOT NULL REFERENCES users(id),
  kelas_id     INTEGER NOT NULL REFERENCES kelas(id),
  nilai        REAL NOT NULL,
  huruf        TEXT NOT NULL,
  synced_at    TEXT NOT NULL,
  UNIQUE (mahasiswa_id, kelas_id)
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  jti        TEXT NOT NULL UNIQUE,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  device_id  TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  issued_at  TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS service_clients (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id   TEXT NOT NULL UNIQUE,
  secret_hash TEXT NOT NULL,
  name        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  source    TEXT NOT NULL,
  subject   TEXT NOT NULL,
  role      TEXT,
  method    TEXT,
  endpoint  TEXT NOT NULL,
  device_id TEXT,
  decision  TEXT NOT NULL CHECK (decision IN ('allow','deny')),
  reason    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(timestamp);
`;
