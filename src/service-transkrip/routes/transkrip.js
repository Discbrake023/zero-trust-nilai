'use strict';
const express = require('express');
const { getDb } = require('../../db/connection');
const repo = require('../../db/repo');
const config = require('../../config');
const { nowInZone } = require('../../utils/time');
const { nilaiToHuruf, hurufToBobot } = require('../../utils/grade');
const { HttpError, sendOk } = require('../../utils/http');

module.exports = function transkripRoutes(guard) {
  const router = express.Router();

  // Hanya token service (role service). Token user apa pun ditolak.
  router.post('/sinkron', guard.requireRole('service'), (req, res) => {
    const { kelas_id: kelasId, entries } = req.body || {};
    if (!Number.isInteger(kelasId) || !Array.isArray(entries) || entries.length === 0 || entries.length > 500) {
      throw new HttpError(400, 'BAD_REQUEST', 'Body harus berisi kelas_id (integer) dan entries (array 1-500 item)');
    }
    for (const e of entries) {
      if (!e || typeof e.nim !== 'string' || typeof e.nilai !== 'number' || !Number.isFinite(e.nilai) || e.nilai < 0 || e.nilai > 100) {
        throw new HttpError(400, 'BAD_REQUEST', 'Setiap entry harus {nim: string, nilai: angka 0-100}');
      }
    }
    const db = getDb();
    const now = nowInZone(config.timezone).iso;

    // Satu transaksi: semua entry masuk atau tidak sama sekali.
    const run = db.transaction(() => {
      if (!repo.getKelas(kelasId)) throw new HttpError(422, 'KELAS_NOT_FOUND', 'Kelas tidak ditemukan');
      const upsert = db.prepare(
        `INSERT INTO transkrip (mahasiswa_id,kelas_id,nilai,huruf,synced_at) VALUES (?,?,?,?,?)
         ON CONFLICT(mahasiswa_id,kelas_id) DO UPDATE SET nilai=excluded.nilai, huruf=excluded.huruf, synced_at=excluded.synced_at`);
      const out = [];
      for (const e of entries) {
        const mhs = repo.getUserByNim(e.nim);
        if (!mhs || mhs.role !== 'mahasiswa') throw new HttpError(422, 'MAHASISWA_NOT_FOUND', `NIM ${e.nim} tidak ditemukan`);
        // Integritas: hanya nilai FINAL dan identik dengan tabel nilai yang boleh masuk transkrip.
        const src = db.prepare('SELECT nilai,status FROM nilai WHERE kelas_id=? AND mahasiswa_id=?').get(kelasId, mhs.id);
        if (!src || src.status !== 'final' || src.nilai !== e.nilai) {
          throw new HttpError(422, 'NILAI_NOT_FINAL', `Nilai NIM ${e.nim} tidak final atau tidak cocok dengan data nilai`);
        }
        const huruf = nilaiToHuruf(e.nilai); // dihitung ulang, tidak mempercayai pengirim
        upsert.run(mhs.id, kelasId, e.nilai, huruf, now);
        out.push({ nim: e.nim, nilai: e.nilai, huruf });
      }
      return out;
    });
    return sendOk(res, { kelas_id: kelasId, jumlah_disinkronkan: entries.length, entries: run.immediate() });
  });

  router.get('/:nim', guard.requireRole('mahasiswa', 'admin'), (req, res) => {
    const nim = req.params.nim;
    const s = req.subject;
    if (s.role === 'mahasiswa' && s.nim !== nim) {
      throw new HttpError(403, 'FORBIDDEN', 'Mahasiswa hanya boleh melihat transkrip dengan NIM sendiri');
    }
    const mhs = repo.getUserByNim(nim);
    if (!mhs) throw new HttpError(404, 'NOT_FOUND', 'Mahasiswa tidak ditemukan');
    const rows = getDb().prepare(
      `SELECT k.kode, k.nama, k.sks, t.nilai, t.huruf, t.synced_at
       FROM transkrip t JOIN kelas k ON k.id=t.kelas_id WHERE t.mahasiswa_id=? ORDER BY k.kode`).all(mhs.id);
    const totalSks = rows.reduce((a, r) => a + r.sks, 0);
    const poin = rows.reduce((a, r) => a + hurufToBobot(r.huruf) * r.sks, 0);
    return sendOk(res, {
      nim: mhs.nim, nama: mhs.nama, mata_kuliah: rows, total_sks: totalSks,
      ipk: totalSks ? Math.round((poin / totalSks) * 100) / 100 : 0,
    });
  });

  return router;
};
