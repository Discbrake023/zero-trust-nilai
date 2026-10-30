# Penerapan Zero Trust per Fitur

Prinsip: **never trust, always verify**, **least privilege**, **assume breach** (NIST SP 800-207).

| Kebutuhan (soal) | Mekanisme | Prinsip | Kode |
|---|---|---|---|
| Gateway sebagai PEP, satu-satunya pintu | Service hanya listen di 127.0.0.1 dan menolak request tanpa `X-Gateway-Secret`; gateway mengirim secret via proxy dan menimpa kiriman client | never trust (jaringan internal pun tidak dipercaya) | `gateway/proxy.js`, `shared/serviceGuard.js` |
| Verifikasi ulang di service | Service cek secret -> signature/exp/issuer/jenis token (HS256 saja, tolak `alg:none`) -> role di DB. Secret valid tanpa token tetap 401 | assume breach: gateway dianggap bisa dilewati | `shared/serviceGuard.js`, `shared/tokens.js` |
| Access token 10 menit, refresh 1 hari, token service 5 menit | `jsonwebtoken` dengan `expiresIn` dari `.env`; refresh disimpan **hash SHA-256**-nya di `refresh_tokens` | masa berlaku pendek membatasi dampak token bocor | `shared/tokens.js` |
| Logout mencabut refresh token | `revoked_at` diisi; access token dengan `sid` sesi itu juga ditolak gateway | assume breach: token yang dicabut harus langsung mati | `routes/auth.js`, `middleware/authenticate.js` |
| RBAC berbasis kepemilikan | Policy Engine membaca `kelas.dosen_id`, `nilai.status`, `users.nim` dari DB; klaim role di token hanya dicocokkan dengan DB (`ROLE_MISMATCH`) | least privilege; token tidak otoritatif | `policy/policy.js`, `db/repo.js` |
| Device terdaftar | `X-Device-ID` wajib dan harus ada di `devices` untuk user di token; login juga memeriksa device | verifikasi konteks setiap request | `middleware/device.js` |
| Jam akses | Dihitung di zona `Asia/Jakarta` lewat `Intl`, rentang dari `.env` | kebijakan kontekstual yang bisa dikonfigurasi | `utils/time.js`, `policy/policy.js` |
| Antar-service lewat gateway | Service Nilai meminta token service ke `/auth/service` lalu memanggil `/transkrip/sinkron` **lewat gateway**; policy hanya mengizinkan `subject.type=service` dan client `service-nilai` | tidak ada jalur samping; service pun diverifikasi | `service-nilai/gatewayClient.js`, `policy/policy.js` |
| Integritas sinkron | Transkrip menerima hanya nilai **final** yang identik dengan tabel `nilai`, menghitung ulang huruf sendiri, semua entry dalam satu transaksi | tidak mempercayai pengirim, bahkan yang ber-token service | `service-transkrip/routes/transkrip.js` |
| Konsistensi finalisasi | Tx1 draft->final (`pending`), panggil sinkron di luar transaksi (tidak menahan lock SQLite), sukses -> `synced`, gagal -> kompensasi kembali `draft` | assume breach/failure: tidak ada keadaan setengah jadi | `service-nilai/routes/kelas.js` |
| Audit log | Setiap keputusan allow/deny (termasuk gagal autentikasi) ditulis ke `audit_log`; jika audit gagal ditulis, request ditolak (fail-closed). Service juga mencatat penolakannya (`source`) | visibilitas dan akuntabilitas | `gateway/decision.js`, `shared/audit.js` |
| Default deny | Endpoint/metode yang tidak ada di tabel kebijakan, path non-kanonik (`/nilai//1`, `%31`), ditolak | least privilege | `policy/policy.js` |
| Password & secret | bcrypt (cost 10), perbandingan secret timing-safe, verifikasi dummy agar user tidak bisa dienumerasi lewat waktu respons, `.env` di-gitignore | defense in depth | `routes/auth.js`, `utils/hash.js` |
