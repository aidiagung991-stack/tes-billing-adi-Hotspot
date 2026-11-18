# Audit dan Perbaikan Rate Limiter Login

Tanggal pemeriksaan: 18 November 2026
Sumber: ZIP `adi_hotspot-billing (1)(8).zip`

## Temuan sebelum perbaikan

`src/server/auth.ts` sebelumnya menjalankan dua operasi terpisah ketika login gagal:

1. `SELECT attempt_count ... WHERE rate_key = $1`
2. `INSERT ... ON CONFLICT DO UPDATE` dengan nilai hitungan yang dihitung oleh aplikasi.

Dua permintaan login dari IP yang sama dapat membaca hitungan lama secara bersamaan, lalu menulis nilai hitungan yang sama. Akibatnya sebagian kegagalan login dapat hilang dari penghitung (*lost update*) dan ambang lima kegagalan tidak selalu tercapai sesuai jumlah permintaan.

## Perbaikan

`recordFailedLoginAttempt()` sekarang menggunakan satu perintah PostgreSQL `INSERT ... ON CONFLICT DO UPDATE ... RETURNING`.

- Penambahan penghitung dilakukan di dalam PostgreSQL, bukan dihitung dari hasil `SELECT` di aplikasi.
- Konflik pada primary key `rate_key` diserialisasi oleh PostgreSQL sehingga permintaan bersamaan tidak saling menimpa.
- Waktu jendela 15 menit dan cooldown 15 menit dihitung menggunakan `clock_timestamp()` di database.
- Penghitung direset menjadi 1 jika jendela 15 menit telah lewat atau cooldown sebelumnya telah berakhir.
- Login gagal kelima dan permintaan gagal yang sudah berada dalam antrean akan mendapatkan status terkunci berdasarkan nilai `locked_until` yang dikembalikan database.
- Tidak ada perubahan skema database yang diperlukan.

## Regression test

Ditambahkan skenario integrasi yang mengirim delapan permintaan login salah secara bersamaan dari IP yang sama. Ekspektasi: empat respons pertama HTTP 401, empat berikutnya HTTP 429, dan penghitung tersimpan bernilai delapan dengan `locked_until` aktif.

Mock PostgreSQL pada test autentikasi dan test MikroTik juga diperbarui agar memodelkan operasi UPSERT atomik yang baru.

## Pemeriksaan yang dilakukan

- TypeScript `transpileModule` untuk `auth.ts`, `authIntegration.test.ts`, dan `mikrotikIntegration.test.ts`: **syntax OK**.
- `npm ci --ignore-scripts --no-audit --no-fund`: tidak selesai dalam batas waktu lingkungan; dependensi tidak tersedia.
- `tsc --noEmit`: tidak dapat dijalankan penuh karena tipe `vite/client` belum tersedia.
- Karena dependensi tidak tersedia, **test integrasi, lint penuh, dan build belum dapat dinyatakan lulus**.

## Audit migration (tanpa menjalankan migration)

`src/server/migrations.ts` mengambil semua file `.sql` yang belum tercatat di `schema_migrations`, mengurutkannya, lalu menjalankan semuanya secara berurutan. Dengan demikian `npm run migrate` dapat menjalankan `003_add_mikrotik_account_fields.sql` dan `004_admin_auth.sql` sekaligus jika keduanya belum tercatat.

Migration 003 sendiri menyatakan bahwa ia tidak boleh dijalankan otomatis sebelum persetujuan pengguna. Runner saat ini tidak memiliki mekanisme persetujuan khusus untuk file 003. Karena itu jangan menjalankan `npm run migrate` pada produksi sebelum status migration di database dan rencana penerapannya diperiksa serta disetujui. Tidak ada migration yang dijalankan dalam pekerjaan ini.

## Batas perubahan

- Hanya `src/server/auth.ts` dan dua file test yang diubah untuk perbaikan rate limiter.
- Ditambahkan skenario regression test dan dokumen audit ini.
- Tidak mengubah file SQL, `.env`, konfigurasi produksi, atau data pelanggan.
- Tidak mengakses server produksi, tidak menjalankan migration, dan tidak menyentuh tabel `test_koneksi`.
