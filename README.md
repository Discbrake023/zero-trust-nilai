# Sistem Nilai - Zero Trust Security

Tugas Praktikum Individu **Zero Trust Security** - Keamanan Informasi (KP70065004), Informatika Universitas Siliwangi.

Tiga aplikasi Node.js/Express yang saling terhubung dan memakai satu database SQLite bersama:

| Aplikasi | Port | Peran (NIST SP 800-207) |
|---|---|---|
| **API Gateway** (+ Policy Engine / Policy Administrator) | 3000 | PEP - satu-satunya pintu masuk, plus PE/PA |
| **Service Nilai** | 3001 | Resource - nilai & kelas, finalisasi |
| **Service Transkrip** | 3002 | Resource - transkrip mahasiswa |

```
Client (Thunder Client / curl)
   | Bearer access token + X-Device-ID
   v
API Gateway :3000 --- /auth/* (login, refresh, logout, token service)  [Policy Administrator]
   | 1 authenticate (JWT + sesi)      -> deny + audit
   | 2 verifyDevice (device terdaftar)-> deny + audit
   | 3 Policy Engine (policy.js, baca DB: kelas, nilai, user) -> allow/deny + alasan
   | 4 audit log (tabel audit_log)    -> 5 proxy + header X-Gateway-Secret
   +--> Service Nilai :3001      (cek secret -> cek JWT -> cek role di DB -> data)
   |         ^  finalisasi: minta token service ke gateway, lalu POST /transkrip/sinkron LEWAT gateway
   +--> Service Transkrip :3002  (cek secret -> cek JWT -> hanya role "service" untuk /sinkron)
```

## Persyaratan
- Node.js 18 atau lebih baru (diuji di Node 22). Windows 10/11 + VS Code.
- `better-sqlite3` memakai binary siap-pakai; jika `npm install` mencoba mengompilasi dan gagal, pasang Node LTS terbaru atau "Desktop development with C++" dari Visual Studio Build Tools.

## Instalasi dan menjalankan (PowerShell / CMD di folder project)
```bash
npm install
npm run setup        # membuat .env dengan secret acak (dari .env.example)
npm run start:all    # database dibuat & di-seed otomatis, lalu 3 server menyala
```
Alternatif: tiga terminal terpisah - `npm run start:nilai`, `npm run start:transkrip`, `npm run start:gateway`.

Cek: `http://127.0.0.1:3000/health`. Reset data ke kondisi awal: `npm run db:reset` (hentikan server dulu).

> `.env` tidak ikut repository. Jika kamu mengganti `SERVICE_NILAI_CLIENT_SECRET` setelah database dibuat, jalankan `npm run db:reset` karena hash-nya disimpan saat seed.

## Akun demo
Password hanya ada di tabel ini; di database tersimpan hash bcrypt.

| Role | Username | Password | X-Device-ID | NIM |
|---|---|---|---|---|
| Admin | `admin` | `Admin#123` | `DEV-ADMIN-01` | - |
| Dosen (kelas IF201, IF301) | `dosen.budi` | `Dosen#123` | `DEV-DOSEN-BUDI` | - |
| Dosen (kelas IF302) | `dosen.sari` | `Dosen#123` | `DEV-DOSEN-SARI` | - |
| Mahasiswa | `mhs.andi` | `Mhs#12345` | `DEV-MHS-ANDI` | 247006111001 |
| Mahasiswa | `mhs.citra` | `Mhs#12345` | `DEV-MHS-CITRA` | 247006111002 |
| Mahasiswa | `mhs.dewi` | `Mhs#12345` | `DEV-MHS-DEWI` | 247006111003 |

Service Nilai: `client_id` = `service-nilai`, secret = `SERVICE_NILAI_CLIENT_SECRET` di `.env`.

Data awal: **IF201** Jaringan Komputer (Budi, sudah final + sudah ada di transkrip), **IF301** Keamanan Informasi (Budi, draft), **IF302** Pemrograman Web (Sari, draft). Id nilai: 1-3 = IF201, 4-6 = IF301 (Andi, Citra, Dewi), 7-9 = IF302. Kelas: 1 = IF201, 2 = IF301, 3 = IF302. (Soal meminta minimal 2 kelas dari dosen berbeda; IF201 ditambahkan agar transkrip punya data awal.)

## Endpoint (semua lewat gateway `http://127.0.0.1:3000`)
| Endpoint | Diizinkan | Kondisi |
|---|---|---|
| `POST /auth/login` | semua user | kredensial valid dan device terdaftar |
| `POST /auth/refresh`, `/auth/logout` | semua user | refresh token valid dan belum dicabut |
| `POST /auth/service` | Service Nilai | client id + secret valid |
| `GET /nilai` | mahasiswa, dosen | mahasiswa: hanya miliknya; dosen: hanya kelas yang diampu (opsional `?kelas_id=`, `?nim=`) |
| `PUT /nilai/:id` | dosen | kelas diampu, belum final, dalam jam akses. Body `{"nilai": 0-100}` |
| `POST /kelas/:id/finalisasi` | dosen | kelas diampu, dalam jam akses -> sinkron ke transkrip |
| `GET /transkrip/:nim` | mahasiswa, admin | mahasiswa: NIM sendiri; admin: semua |
| `POST /transkrip/sinkron` | Service Nilai | hanya token service; token user mana pun ditolak |

Semua endpoint selain `/auth/*` wajib `Authorization: Bearer <token>`; request user juga wajib `X-Device-ID`. Endpoint yang tidak ada di tabel kebijakan ditolak (default deny).

Format respons: sukses `{"success":true,"data":...}`, gagal `{"success":false,"error":{"code":"...","message":"..."}}`.

## Struktur folder
```
src/
  config/             konfigurasi dari .env (validasi secret, jam akses)
  db/                 connection, schema, seed, repo (query untuk policy), init
  utils/              time (zona Asia/Jakarta), hash, grade, http (error JSON)
  shared/             tokens (JWT), audit, serviceGuard (secret + JWT + role-DB untuk service)
  gateway/
    index.js          rangkaian PEP: authenticate -> device -> policy -> proxy
    decision.js       pencatatan audit + response deny
    middleware/       authenticate.js, device.js, enforcePolicy.js
    policy/policy.js  Policy Engine (allow/deny + alasan)
    routes/auth.js    login, refresh, logout, token service
    proxy.js          http-proxy-middleware + X-Gateway-Secret
  service-nilai/      index, routes (nilai, kelas/finalisasi), gatewayClient (token service + sinkron)
  service-transkrip/  index, routes (transkrip, sinkron)
scripts/              setup-env, db-init, db-reset, start-all, check-syntax, build-thunder
tests/run-tests.js    pengujian integrasi end-to-end (21 skenario)
thunder-client/       koleksi Thunder Client
docs/                 ZERO_TRUST.md (pemetaan prinsip), PENGUJIAN.md (skenario uji)
```

## Menguji dengan Thunder Client
**Otomatis:** `npm test` - menyalakan sistem di port 4000-4002 dengan database terpisah (`data/test.db`), menjalankan 21 skenario, lalu mematikannya. Tidak mengganggu server dan data demo kamu.

**Manual, per role:**
1. Import `thunder-client/thunder-collection_zero-trust.json` (Thunder Client -> Collections -> menu `...` -> Import). Buat Environment kosong (mis. "Zero Trust") dan aktifkan; request Login menyimpan token ke variabel `token_andi`, `token_budi`, dst. lewat tab Tests. Request "Token service" dan "bypass gateway" berisi placeholder `<ISI ... dari .env>` yang harus kamu ganti. *Catatan: format koleksi dibuat dari pemahaman format ekspor Thunder Client dan belum diuji di aplikasinya. Jika impor gagal, buat request manual dengan contoh di bawah.*
2. **Mahasiswa**: login `mhs.andi` -> `GET /nilai` (200) -> `GET /nilai?nim=247006111002` (403) -> `GET /transkrip/247006111001` (200) -> `GET /transkrip/247006111002` (403).
3. **Dosen**: login `dosen.budi` -> `PUT /nilai/4` (200) -> `PUT /nilai/7` (403, kelas Sari) -> `POST /kelas/2/finalisasi` (200) -> `PUT /nilai/4` lagi (409, sudah final).
4. **Admin**: login `admin` -> `GET /transkrip/247006111001`, `...002`, `...003` (semua 200).
5. **Skenario deny**: device lain di `X-Device-ID` (403), hapus header device (403), tanpa token (401), `POST /transkrip/sinkron` dengan token user (403), akses langsung ke `:3001`/`:3002` tanpa `X-Gateway-Secret` (403).
6. **Jam akses**: ubah `ACCESS_START`/`ACCESS_END` di `.env` (mis. `03:00`/`04:00`), restart gateway, lalu coba `PUT /nilai/...` -> 403 `OUTSIDE_ACCESS_HOURS`.
7. Lihat audit: buka `data/zero-trust.db` dengan ekstensi SQLite di VS Code dan jalankan `SELECT * FROM audit_log ORDER BY id DESC;`.

## Contoh request dan response (hasil nyata dari sistem ini)
Login:
```http
POST http://127.0.0.1:3000/auth/login
X-Device-ID: DEV-MHS-ANDI
Content-Type: application/json

{"username":"mhs.andi","password":"Mhs#12345"}
```
```json
{"success":true,"data":{"token_type":"Bearer","access_token":"eyJhbGci...","expires_in":600,"refresh_token":"eyJhbGci...","user":{"id":4,"username":"mhs.andi","nama":"Andi Pratama","role":"mahasiswa","nim":"247006111001"}}}
```
Dosen mengubah nilai milik kelas dosen lain (deny):
```http
PUT http://127.0.0.1:3000/nilai/7
Authorization: Bearer <token dosen.budi>
X-Device-ID: DEV-DOSEN-BUDI

{"nilai":99}
```
```json
{"success":false,"error":{"code":"ACCESS_DENIED","message":"Dosen bukan pengampu kelas dari nilai ini"}}
```
Finalisasi (Service Nilai -> token service -> sinkron lewat gateway):
```json
{"success":true,"data":{"kelas":{"id":2,"kode":"IF301","nama":"Keamanan Informasi"},"jumlah_nilai_final":3,"sinkron_transkrip":{"kelas_id":2,"jumlah_disinkronkan":3,"entries":[{"nim":"247006111001","nilai":91,"huruf":"A"},{"nim":"247006111002","nilai":72,"huruf":"B"},{"nim":"247006111003","nilai":85,"huruf":"A"}]}}}
```
Device tidak terdaftar:
```json
{"success":false,"error":{"code":"DEVICE_NOT_REGISTERED","message":"Device tidak terdaftar untuk user ini"}}
```
Contoh baris `audit_log`:
```json
{"timestamp":"2026-10-30T07:22:41+07:00","source":"gateway","subject":"dosen.budi","method":"GET","endpoint":"/nilai","device_id":"HP-ORANG-LAIN","decision":"deny","reason":"Device tidak terdaftar untuk user ini"}
```

## Konfigurasi (`.env`)
Lihat `.env.example`. Yang penting: `ACCESS_START` / `ACCESS_END` (jam edit & finalisasi, mis. `07:00`-`21:00`; `24:00` = akhir hari; rentang melewati tengah malam didukung), `TIMEZONE=Asia/Jakarta` (dihitung eksplisit lewat `Intl`, bukan zona waktu OS), `ACCESS_TOKEN_TTL=10m`, `REFRESH_TOKEN_TTL=1d`, `SERVICE_TOKEN_TTL=5m`. Batas jam: awal inklusif, akhir eksklusif (21:00:00 sudah ditolak).

## Keterbatasan yang perlu kamu ketahui
- Jam akses dicek di gateway (Policy Engine), tidak diulang di service.
- Tidak ada pembatasan percobaan login (rate limit/lockout) dan tidak ada HTTPS; sistem berjalan di localhost.
- Access token yang masih berlaku ditolak gateway setelah logout (sesi dicek di DB), tetapi service hanya memverifikasi signature + masa berlaku sesuai soal, jadi pengecekan sesi hanya terjadi di gateway (satu-satunya jalur masuk).
- Jika Service Transkrip sudah menyimpan data tetapi balasannya hilang di jaringan, finalisasi dibatalkan di sisi Nilai; mengulang finalisasi aman karena sinkron bersifat upsert.
- Dokumentasi teknis penerapan Zero Trust: `docs/ZERO_TRUST.md`. Skenario uji: `docs/PENGUJIAN.md`.
