# Skenario Pengujian

Jalankan `npm test` (21 skenario, sistem sungguhan di port 4000-4002, DB `data/test.db`, dihapus setelah selesai). Setiap skenario juga memverifikasi baris yang sesuai di `audit_log`.

| # | Skenario | ID uji | Hasil yang diharapkan |
|---|---|---|---|
| 1 | Login berhasil | 01 | 200; access 600 dtk, refresh 86400 dtk tersimpan di DB; audit allow |
| 2 | Password salah | 02 | 401 `INVALID_CREDENTIALS`; pesan sama untuk user tidak ada |
| 3 | Mahasiswa lihat nilai sendiri | 03 | 200, semua baris NIM sendiri |
| 4 | Mahasiswa lihat nilai orang lain | 04 | 403 di gateway; 403 juga bila gateway di-bypass |
| 5 | Dosen ubah nilai kelasnya | 05 | 200, DB berubah; nilai >100 -> 400 |
| 6 | Dosen ubah nilai kelas dosen lain | 06 | 403; DB tidak berubah |
| 7 | Nilai final tidak bisa diubah | 07 | finalisasi 200 + sinkron; edit -> 409 `NILAI_FINAL`; finalisasi ulang 409 |
| 8 | Edit/finalisasi di luar jam akses | 08, 08b | 403 `OUTSIDE_ACCESS_HOURS` (gateway dijalankan ulang dengan jam akses di luar jam sekarang); batas 07:00/21:00 dan konversi UTC->WIB diuji terpisah |
| 9 | Device tidak terdaftar | 09 | 403 (device asing, tanpa header, device milik user lain, login dari device asing) |
| 10 | Token kedaluwarsa | 10 | 401 `TOKEN_EXPIRED` di gateway dan di service; signature salah, `alg:none`, role dipalsukan (`ROLE_MISMATCH`) ditolak |
| 11 | Refresh token dicabut | 11 | refresh sebelum logout 200; sesudahnya 401 `REFRESH_REVOKED`; access token sesi itu 401 `SESSION_REVOKED` |
| 12 | Admin lihat semua transkrip | 12 | 200 untuk 3 NIM |
| 13 | Mahasiswa hanya transkrip sendiri | 13 | sendiri 200; orang lain 403; dosen 403 |
| 14 | Token user untuk sinkron | 14 | 403 (mahasiswa, dosen, admin); service juga 403 `ROLE_FORBIDDEN` |
| 15 | Service tanpa gateway secret | 15 | 403 `GATEWAY_SECRET_INVALID` di kedua service |
| 16 | Secret ada, token tidak valid | 16 | 401 (tanpa token, token sampah, refresh token sebagai access token) |
| 17 | Sinkron dengan token service | 17 | token service 300 dtk, sinkron 200; nilai tidak final/NIM asing -> 422 |
| 18 | Audit log lengkap | 18a + cek per skenario | field terisi, timestamp `+07:00`, device tercatat, tanpa password/token/secret |
| + | Sinkron gagal -> konsistensi | 19 | Service Transkrip dimatikan; finalisasi 502 dan nilai kembali `draft` |

Uji manual dengan curl (contoh): lihat bagian "Contoh request" di README.
