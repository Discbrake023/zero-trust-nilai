'use strict';
const express = require('express');
const { getDb } = require('../../db/connection');
const repo = require('../../db/repo');
const config = require('../../config');
const { nowInZone } = require('../../utils/time');
const { HttpError, sendOk } = require('../../utils/http');
const { syncTranskrip } = require('../gatewayClient');

module.exports = function kelasRoutes(guard) {
  const router = express.Router();
  // Express 4 tidak menangkap error dari handler async; teruskan ke errorHandler.
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  // Tx 1 (atomik): draft -> final + sync_status 'pending'. Tidak ada lock yang ditahan saat memanggil Transkrip.
  const markFinal = (kelasId, nowIso) => getDb().transaction(() => {
    const rows = getDb().prepare(
      `SELECT n.id, u.nim, n.nilai FROM nilai n JOIN users u ON u.id=n.mahasiswa_id
       WHERE n.kelas_id=? AND n.status='draft' ORDER BY u.nim`).all(kelasId);
    const upd = getDb().prepare("UPDATE nilai SET status='final', sync_status='pending', finalized_at=? WHERE id=? AND status='draft'");
    for (const r of rows) if (upd.run(nowIso, r.id).changes !== 1) throw new HttpError(409, 'CONFLICT', 'Nilai berubah saat finalisasi, coba lagi');
    return rows;
  }).immediate();

  const markSynced = (ids) => getDb().transaction(() => {
    const st = getDb().prepare("UPDATE nilai SET sync_status='synced' WHERE id=? AND sync_status='pending'");
    for (const id of ids) st.run(id);
  }).immediate();

  // Kompensasi: sinkron gagal -> kembalikan ke draft supaya Nilai dan Transkrip tidak berbeda.
  const rollbackFinal = (ids) => getDb().transaction(() => {
    const st = getDb().prepare("UPDATE nilai SET status='draft', sync_status='none', finalized_at=NULL WHERE id=? AND sync_status='pending'");
    for (const id of ids) st.run(id);
  }).immediate();

  router.post('/:id/finalisasi', guard.requireRole('dosen'), wrap(async (req, res) => {
    if (!/^\d+$/.test(req.params.id)) throw new HttpError(400, 'BAD_REQUEST', 'id kelas tidak valid');
    const kelas = repo.getKelas(Number(req.params.id));
    if (!kelas) throw new HttpError(404, 'NOT_FOUND', 'Kelas tidak ditemukan');
    if (kelas.dosen_id !== req.subject.id) throw new HttpError(403, 'FORBIDDEN', 'Dosen bukan pengampu kelas ini');

    const rows = markFinal(kelas.id, nowInZone(config.timezone).iso);
    if (rows.length === 0) throw new HttpError(409, 'ALREADY_FINAL', 'Tidak ada nilai draft; kelas sudah difinalisasi');
    const ids = rows.map((r) => r.id);

    let sinkron;
    try {
      sinkron = await syncTranskrip({ kelas_id: kelas.id, entries: rows.map((r) => ({ nim: r.nim, nilai: r.nilai })) });
    } catch (err) {
      rollbackFinal(ids);
      console.error('[service-nilai] sinkron gagal, finalisasi dibatalkan:', err.message);
      throw new HttpError(502, 'SYNC_FAILED', `Sinkron ke transkrip gagal; finalisasi dibatalkan (${err.message})`);
    }
    markSynced(ids);
    return sendOk(res, {
      kelas: { id: kelas.id, kode: kelas.kode, nama: kelas.nama },
      jumlah_nilai_final: rows.length,
      sinkron_transkrip: sinkron,
    });
  }));

  return router;
};
