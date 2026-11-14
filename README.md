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

Migration runner yang digunakan adalah `src/server/migrations.ts` (hasil build: `migrate.js`). Perintah `npm run migrate` menjalankan runner tersebut. **Jangan jalankan perintah migrasi sebelum struktur database dan seluruh file SQL diperiksa serta ada persetujuan eksplisit.** Migration runner tidak boleh digunakan untuk mengubah tabel `test_koneksi`.

## Catatan keamanan akses (tanpa login)

Aplikasi ini dikonfigurasi tanpa akun/login admin sesuai keputusan pemilik. Karena endpoint API dapat membaca dan mengubah data pelanggan, tagihan, pembayaran, pengaturan, serta mengirim WhatsApp, aplikasi hanya boleh digunakan di jaringan LAN yang dipercaya.

- Jangan melakukan port forwarding port 3000 ke internet.
- Jangan menempatkan aplikasi langsung di belakang domain publik.
- Jika perlu akses dari luar lokasi, gunakan VPN seperti WireGuard ke jaringan kantor.
- Aktifkan firewall Ubuntu dan izinkan port 3000 hanya dari subnet LAN aktual. Jangan menebak subnet; periksa konfigurasi jaringan/router terlebih dahulu.
- `HOST=0.0.0.0` diperlukan agar perangkat lain di LAN dapat mengakses aplikasi. Firewall menjadi batas perlindungan jaringan karena aplikasi tidak menggunakan login.

## Rahasia aplikasi

- `DB_PASSWORD`, `WABLAS_API_TOKEN`, `WABLAS_SECRET_KEY`, dan `MIKROTIK_ENCRYPTION_KEY` hanya disimpan di `.env` server atau konfigurasi server yang dilindungi.
- Jangan commit `.env` atau `.wablas-config.json` ke repository.
- File `.wablas-config.json` dibuat dengan permission terbatas (`0600`) pada sistem Linux.
- Domain Wablas dibatasi ke `https://smg.wablas.com`; request tidak mengikuti HTTP redirect ke host lain.
