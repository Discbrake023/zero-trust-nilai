'use strict';
// Policy Engine: memutuskan allow/deny berdasarkan Tabel 3 + atribut dari DATABASE.
// Mengembalikan { allow, status, code, reason }. Default: DENY.
const config = require('../../config');
const repo = require('../../db/repo');
const { isWithinWindow } = require('../../utils/time');

const ALLOW = (reason) => ({ allow: true, status: 200, code: 'ALLOW', reason });
const DENY = (reason, status = 403, code = 'ACCESS_DENIED') => ({ allow: false, status, code, reason });

const hoursLabel = () => `${config.accessHours.startText}-${config.accessHours.endText} ${config.timezone}`;
const inHours = (m) => isWithinWindow(m, config.accessHours.startMin, config.accessHours.endMin);
const isStr = (v) => v === undefined || typeof v === 'string';

function getNilai({ subject, query }) {
  if (!isStr(query.nim) || !isStr(query.kelas_id)) return DENY('Parameter query tidak valid', 400, 'BAD_REQUEST');
  if (subject.role === 'mahasiswa') {
    if (query.nim !== undefined && query.nim !== subject.nim) return DENY('Mahasiswa hanya boleh melihat nilai miliknya sendiri');
    return ALLOW('Mahasiswa melihat nilai miliknya sendiri');
  }
  if (subject.role === 'dosen') {
    if (query.kelas_id !== undefined) {
      if (!/^\d+$/.test(query.kelas_id)) return DENY('kelas_id tidak valid', 400, 'BAD_REQUEST');
      const kelas = repo.getKelas(Number(query.kelas_id));
      if (!kelas) return DENY('Kelas tidak ditemukan', 404, 'NOT_FOUND');
      if (kelas.dosen_id !== subject.id) return DENY('Dosen bukan pengampu kelas ini');
    }
    return ALLOW('Dosen melihat nilai pada kelas yang diampunya');
  }
  return DENY(`Role ${subject.role} tidak boleh melihat nilai`);
}

function putNilai({ subject, nowMinutes }, id) {
  if (subject.role !== 'dosen') return DENY(`Role ${subject.role} tidak boleh mengubah nilai`);
  const row = repo.getNilai(Number(id));
  if (!row) return DENY('Data nilai tidak ditemukan', 404, 'NOT_FOUND');
  if (row.dosen_id !== subject.id) return DENY('Dosen bukan pengampu kelas dari nilai ini');
  if (row.status === 'final') return DENY('Nilai sudah final dan tidak dapat diubah', 409, 'NILAI_FINAL');
  if (!inHours(nowMinutes)) return DENY(`Di luar jam akses perubahan nilai (${hoursLabel()})`, 403, 'OUTSIDE_ACCESS_HOURS');
  return ALLOW('Dosen pengampu mengubah nilai draft dalam jam akses');
}

function finalisasi({ subject, nowMinutes }, id) {
  if (subject.role !== 'dosen') return DENY(`Role ${subject.role} tidak boleh memfinalisasi nilai`);
  const kelas = repo.getKelas(Number(id));
  if (!kelas) return DENY('Kelas tidak ditemukan', 404, 'NOT_FOUND');
  if (kelas.dosen_id !== subject.id) return DENY('Dosen bukan pengampu kelas ini');
  if (!inHours(nowMinutes)) return DENY(`Di luar jam akses finalisasi nilai (${hoursLabel()})`, 403, 'OUTSIDE_ACCESS_HOURS');
  return ALLOW('Dosen pengampu memfinalisasi kelas dalam jam akses');
}

function getTranskrip({ subject }, nim) {
  if (subject.role === 'admin') return ALLOW('Admin melihat transkrip');
  if (subject.role === 'mahasiswa') {
    return subject.nim === nim ? ALLOW('Mahasiswa melihat transkrip miliknya sendiri')
      : DENY('Mahasiswa hanya boleh melihat transkrip dengan NIM sendiri');
  }
  return DENY(`Role ${subject.role} tidak boleh melihat transkrip`);
}

function sinkron({ subject }) {
  if (subject.type !== 'service') return DENY('Token user tidak boleh menyinkronkan transkrip; hanya token service');
  if (subject.id !== config.serviceNilai.clientId) return DENY('Hanya Service Nilai yang boleh menyinkronkan transkrip');
  return ALLOW('Service Nilai menyinkronkan transkrip dengan token service');
}

const RULES = [
  { method: 'GET',  pattern: /^\/nilai$/,                      fn: getNilai },
  { method: 'PUT',  pattern: /^\/nilai\/(\d{1,9})$/,           fn: putNilai },
  { method: 'POST', pattern: /^\/kelas\/(\d{1,9})\/finalisasi$/, fn: finalisasi },
  { method: 'POST', pattern: /^\/transkrip\/sinkron$/,         fn: sinkron },
  { method: 'GET',  pattern: /^\/transkrip\/([0-9A-Za-z_-]{1,32})$/, fn: getTranskrip },
];

function decide(ctx) {
  const path = ctx.path.length > 1 ? ctx.path.replace(/\/+$/, '') : ctx.path;
  for (const r of RULES) {
    if (r.method !== ctx.method) continue;
    const m = r.pattern.exec(path);
    if (m) return r.fn(ctx, m[1]);
  }
  return DENY('Tidak ada kebijakan yang mengizinkan endpoint ini (default deny)', 403, 'NO_POLICY');
}

module.exports = { decide };
