# Catatan Perbaikan WhatsApp — Adi_Hotspot Billing

Sumber proyek: `adi_hotspot-billing-fixed.zip` hasil pekerjaan sebelumnya.

## Perubahan

- Template notifikasi WhatsApp dimuat/disimpan melalui API PostgreSQL (`whatsapp_templates`). Template bawaan hanya ditambahkan jika ID template tersebut belum ada, sehingga template yang sudah dikustomisasi tidak ditimpa.
- Jadwal/kebijakan notifikasi dimuat/disimpan melalui `app_settings` dengan key `whatsapp_schedule`.
- Riwayat pesan WhatsApp (pesan tes, pengingat, tagihan baru, konfirmasi pembayaran, isolir/pemulihan, dan pesan broadcast) dicatat melalui API ke `whatsapp_logs`.
- Riwayat broadcast dan penerimanya dimuat/disimpan melalui API PostgreSQL (`broadcast_campaigns` dan `broadcast_recipients`).
- Log broadcast disimpan segera setelah percobaan kirim per penerima, termasuk kegagalan, bukan menunggu semua penerima selesai.
- Penggunaan fungsi localStorage untuk template, jadwal, log WhatsApp, dan riwayat broadcast dihapus dari alur aplikasi. Token/secret Wablas tetap disimpan di server, tidak dikirim kembali ke browser.
- Endpoint pencatatan log mengembalikan data log lengkap dan menggunakan UUID jika ID tidak dikirim.
- Status timestamp dikirim sebagai ISO 8601 agar PostgreSQL menyimpan informasi zona waktu dengan benar.
- File konfigurasi Wablas di server sekarang melaporkan kegagalan penulisan file kepada endpoint, bukan diam-diam menganggap penyimpanan berhasil.

## Pemeriksaan yang berhasil

- Semua file TypeScript/TSX di `src/` dan `server.ts` berhasil diproses oleh TypeScript transpiler tanpa diagnostic sintaks.
- Pemeriksaan import bernama antar file lokal: tidak ditemukan import yang tidak memiliki export.
- Tidak ditemukan lagi pemanggilan `localStorage` untuk template, jadwal, log WhatsApp, maupun riwayat broadcast. Referensi `localStorage` yang tersisa hanya berupa teks keterangan keamanan di UI.
- File SQL `migrations/001_initial_schema.sql` dan `migrations/002_update_schema.sql` sama persis dengan ZIP sumber; tidak diubah.

## Build belum dapat diverifikasi

Perintah `npm run build` sudah dicoba, tetapi berhenti dengan `vite: not found` karena dependensi proyek belum tersedia. `npm install --ignore-scripts --no-audit --no-fund` dicoba, tetapi tidak selesai dalam batas waktu lingkungan ini dan tidak menghasilkan `node_modules`. Oleh sebab itu, **jangan menganggap build produksi sudah lulus**.

Setelah mengekstrak ZIP di komputer/server yang memiliki akses npm registry, jalankan:

```bash
npm install
npm run lint
npm run build
```

Jika `npm run lint` dan `npm run build` berhasil, baru lanjut ke pengujian runtime. Jangan jalankan `npm run migrate` pada tahap ini.

## Yang tidak dilakukan

- Tidak menambahkan login admin, sesuai keputusan pemilik.
- Tidak mengubah file SQL migration.
- Tidak menjalankan migration atau query ke PostgreSQL.
- Tidak mengubah atau menghapus tabel `test_koneksi`.
- Tidak mengakses atau mengubah `.env`, password database, token Wablas, secret key, maupun kunci enkripsi.
- Tidak mengintegrasikan MikroTik pada tahap ini.

## Catatan batasan

- API riwayat pesan menampilkan 200 pesan terbaru; seluruh catatan tetap tersimpan di PostgreSQL.
- API riwayat broadcast menampilkan 100 kampanye terbaru.
- Aplikasi tanpa login harus dibatasi di LAN tepercaya. Jangan membuka port 3000 ke internet publik; akses dari luar lokasi harus melalui VPN.
