# Adi_Hotspot Billing

Aplikasi billing RT/RW Net berbasis React, Express, dan PostgreSQL.

## Persiapan Ubuntu

1. Pasang Node.js versi 20.19 atau lebih baru (disarankan Node.js 24 LTS).
2. Salin `.env.example` menjadi `.env` lalu isi konfigurasi database dan Wablas di server Ubuntu. Jangan mengirim isi `.env` kepada siapa pun.
3. Pasang dependensi: `npm install`.
4. Buat hasil produksi: `npm run build`.
5. Jalankan aplikasi: `npm start`.

Build menghasilkan `dist/` untuk frontend, `server.js` untuk server Express, dan `migrations.js` untuk migration runner. `npm start` menjalankan JavaScript hasil build, bukan file TypeScript mentah.

## Penyimpanan WhatsApp

Template notifikasi, pengaturan jadwal notifikasi, riwayat pesan, dan riwayat broadcast menggunakan PostgreSQL melalui API backend. Tidak ada lagi fungsi penyimpanan WhatsApp/broadcast yang membaca atau menulis localStorage. Kredensial Wablas tetap disimpan di sisi server pada `.wablas-config.json` (permission `0600` di Linux), bukan di PostgreSQL atau browser. Riwayat pesan yang ditampilkan API dibatasi ke 200 pesan terbaru; seluruh catatan tetap tersimpan di tabel PostgreSQL.

## Migrasi database

Migration runner yang digunakan adalah `src/server/migrations.ts` (hasil build: `migrations.js`). Perintah `npm run migrate` menjalankan runner tersebut. **Jangan jalankan perintah migrasi sebelum struktur database dan seluruh file SQL diperiksa serta ada persetujuan eksplisit.** Migration runner tidak boleh digunakan untuk mengubah tabel `test_koneksi`.

Daftar migrasi termasuk `migrations/004_admin_auth.sql` yang menambahkan tabel `admin_sessions` (penyimpanan sesi server-side berbasis hash SHA-256) dan `admin_login_attempts` (pembatasan percobaan login berbasis IP di PostgreSQL) tanpa mengubah tabel operasional yang sudah ada.

## Autentikasi & Keamanan Akses (Satu Admin)

Aplikasi ini menggunakan sistem autentikasi **Single Admin** berbasis sesi server-side PostgreSQL (`express-session` + cookie `adi_hotspot_sid` `HttpOnly`, `SameSite=Lax`):

- Tidak ada registrasi publik, pembuatan admin tambahan, maupun manajemen multi-user/role.
- Tidak ada username, password, atau `SESSION_SECRET` bawaan (default) di dalam kode.
- Seluruh endpoint operasional `/api/*` (pelanggan, paket, tagihan, pembayaran, WhatsApp, pengaturan, MikroTik, dan `/api/status`) mewajibkan sesi admin yang valid dan menolak permintaan tanpa login dengan HTTP `401`. Hanya `GET /api/health` (status minimal `{ ok: true }`) dan endpoint autentikasi `/api/auth/session`, `/api/auth/login`, serta `/api/auth/logout` yang dapat diakses tanpa sesi aktif.
- Seluruh permintaan mutasi (`POST`, `PUT`, `PATCH`, `DELETE`) dilindungi validasi `Origin`/`Referer` terhadap `Host`, `Sec-Fetch-Site`, dan token `X-CSRF-Token` yang terikat pada sesi (disimpan hanya di memori JavaScript browser, tidak di `localStorage` atau `sessionStorage`).
- Kegagalan login berturut-turut dibatasi sementara secara persisten di PostgreSQL (`admin_login_attempts`, 5 kali gagal dalam jendela 15 menit memicu cooldown 15 menit dengan HTTP `429`).

### Setup Admin Awal di Server Ubuntu

1. Pastikan migrasi `migrations/004_admin_auth.sql` telah diterapkan pada database PostgreSQL melalui `npm run migrate`.
2. Hasilkan hash bcrypt dan `SESSION_SECRET` secara lokal di server Ubuntu:
   ```bash
   npm run auth:hash
   ```
3. Isi variabel berikut pada `.env` server Ubuntu (gunakan tanda kutip tunggal `'...'` untuk `ADMIN_PASSWORD_HASH` agar karakter `$` tidak dibaca sebagai variabel shell):
   - `ADMIN_USERNAME`
   - `ADMIN_PASSWORD_HASH`
   - `SESSION_SECRET` (minimal 32 karakter acak)
   - `TRUST_PROXY="false"` (atau `"loopback"` hanya jika berjalan di belakang Nginx/Caddy HTTPS pada host yang sama)
   - `COOKIE_SECURE="auto"`
4. Untuk mengganti password admin di kemudian hari, jalankan ulang `npm run auth:hash`, perbarui `ADMIN_PASSWORD_HASH` (dan opsional `SESSION_SECRET`) di `.env`, lalu restart service aplikasi.

## Keamanan Jaringan & Rahasia Aplikasi

- `DB_PASSWORD`, `WABLAS_API_TOKEN`, `WABLAS_SECRET_KEY`, `MIKROTIK_ENCRYPTION_KEY`, `ADMIN_PASSWORD_HASH`, dan `SESSION_SECRET` hanya disimpan di `.env` server yang dilindungi.
- Jangan commit `.env` atau `.wablas-config.json` ke repository.
- File `.wablas-config.json` dibuat dengan permission terbatas (`0600`) pada sistem Linux.
- Domain Wablas dibatasi ke `https://smg.wablas.com`; request tidak mengikuti HTTP redirect ke host lain.
- `HOST=0.0.0.0` digunakan agar perangkat admin di LAN dapat mengakses aplikasi; tetap batasi port 3000 dengan firewall Ubuntu atau gunakan reverse proxy HTTPS (Nginx/Caddy) dengan `TRUST_PROXY="loopback"`.
