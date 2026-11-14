# Catatan Perbaikan ZIP Adi_Hotspot Billing

Sumber: `adi_hotspot-billing(4).zip`.

## Perubahan yang dilakukan

1. `package.json`
   - `npm run build` sekarang membangun frontend Vite, server Express menjadi `server.js`, dan migration runner menjadi `migrations.js`.
   - `npm start` menjalankan `node server.js`, bukan `node server.ts`.
   - `npm run migrate` menjalankan `node migrations.js`; runner tetap berasal dari `src/server/migrations.ts`.
   - Build membutuhkan dependensi development (termasuk esbuild). Setelah build, runtime dapat menjalankan server JavaScript hasil build.
2. `server.ts`
   - Menambahkan header keamanan dasar, menonaktifkan `X-Powered-By`, dan membatasi JSON request body menjadi 1 MB.
   - Bind address dapat diatur melalui `HOST` (default `0.0.0.0` agar akses LAN tetap berfungsi).
   - File konfigurasi Wablas ditulis secara atomik dan permission Linux dibatasi ke `0600`.
3. `src/server/wablasProxy.ts`
   - Menambahkan `redirect: 'error'` ke request Wablas agar fetch tidak mengikuti redirect ke host lain.
4. `.env.example`
   - Menambahkan `HOST=0.0.0.0` beserta catatan keamanan akses LAN.
5. `.gitignore`
   - Mengabaikan hasil build `server.js` dan `migrations.js`.
6. `README.md`
   - Menambahkan instruksi build, startup, migrasi, dan catatan keamanan karena aplikasi tidak memakai login.

## Hal yang sengaja tidak dilakukan

- Tidak menambahkan akun/login admin, sesuai keputusan pemilik.
- Tidak menjalankan migration atau query ke PostgreSQL.
- Tidak mengubah file SQL migration.
- Tidak mengubah atau menghapus tabel `test_koneksi`.
- Tidak mengubah password database, token Wablas, secret key, atau kunci enkripsi.
- Belum memindahkan seluruh pemanggilan template/riwayat WhatsApp dari localStorage ke API PostgreSQL. Walaupun endpoint backend untuk beberapa data tersebut sudah tersedia, halaman frontend masih memiliki pemanggilan localStorage. Ini perlu menjadi pekerjaan terpisah dan diuji menyeluruh.

## Status pengujian

- Pemeriksaan statis atas perubahan file dilakukan.
- `npm install` tidak berhasil diselesaikan di lingkungan pemeriksaan (waktu habis / dependensi tidak tersedia di cache).
- `tsc --noEmit` tidak dapat dijalankan tuntas karena dependensi dan tipe `vite/client` belum terpasang.
- Karena itu, build produksi **belum terverifikasi**. Jalankan `npm install` lalu `npm run lint` dan `npm run build` di lingkungan proyek sebelum deployment.
