'use strict';
const express = require('express');
const { getDb } = require('../../db/connection');
const repo = require('../../db/repo');
const config = require('../../config');
const { nowInZone } = require('../../utils/time');
const { nilaiToHuruf } = require('../../utils/grade');
const { HttpError, sendOk } = require('../../utils/http');

module.exports = function nilaiRoutes(guard) {
  const router = express.Router();
  const SELECT = `SELECT n.id, n.kelas_id, k.kode AS kelas_kode, k.nama AS kelas_nama,
                         u.nim, u.nama AS mahasiswa_nama, n.nilai, n.status, n.sync_status, n.updated_at
                  FROM nilai n JOIN kelas k ON k.id=n.kelas_id JOIN users u ON u.id=n.mahasiswa_id`;

  // Pelingkupan data dilakukan lagi di service (defense in depth), berdasarkan DB.
  router.get('/', guard.requireRole('mahasiswa', 'dosen'), (req, res) => {
    const { nim, kelas_id: kelasId } = req.query;
    if ((nim !== undefined && typeof nim !== 'string') || (kelasId !== undefined && !/^\d+$/.test(String(kelasId)))) {
      throw new HttpError(400, 'BAD_REQUEST', 'Parameter query tidak valid');
    }
    const s = req.subject;
    let rows;
    if (s.role === 'mahasiswa') {
      if (nim !== undefined && nim !== s.nim) throw new HttpError(403, 'FORBIDDEN', 'Mahasiswa hanya boleh melihat nilai miliknya sendiri');
      rows = getDb().prepare(`${SELECT} WHERE n.mahasiswa_id=? ORDER BY k.kode`).all(s.id);
    } else {
      let sql = `${SELECT} WHERE k.dosen_id=?`;
      const p = [s.id];
      if (kelasId !== undefined) { sql += ' AND n.kelas_id=?'; p.push(Number(kelasId)); }
      if (nim !== undefined) { sql += ' AND u.nim=?'; p.push(nim); }
      rows = getDb().prepare(`${sql} ORDER BY k.kode, u.nim`).all(...p);
    }
    return sendOk(res, rows);
  });

  router.put('/:id', guard.requireRole('dosen'), (req, res) => {
    if (!/^\d+$/.test(req.params.id)) throw new HttpError(400, 'BAD_REQUEST', 'id tidak valid');
    const value = (req.body || {}).nilai;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
      throw new HttpError(400, 'BAD_REQUEST', 'Field "nilai" wajib berupa angka 0-100');
    }
    const id = Number(req.params.id);
    const row = repo.getNilai(id);
    if (!row) throw new HttpError(404, 'NOT_FOUND', 'Data nilai tidak ditemukan');
    if (row.dosen_id !== req.subject.id) throw new HttpError(403, 'FORBIDDEN', 'Dosen bukan pengampu kelas dari nilai ini');
    // WHERE status='draft' membuat pengecekan "belum final" atomik terhadap race.
    const info = getDb().prepare("UPDATE nilai SET nilai=?, updated_at=? WHERE id=? AND status='draft'")
      .run(value, nowInZone(config.timezone).iso, id);
    if (info.changes !== 1) throw new HttpError(409, 'NILAI_FINAL', 'Nilai sudah final dan tidak dapat diubah');
    const updated = getDb().prepare(`${SELECT} WHERE n.id=?`).get(id);
    return sendOk(res, { ...updated, huruf: nilaiToHuruf(updated.nilai) });
  });

  return router;
};
