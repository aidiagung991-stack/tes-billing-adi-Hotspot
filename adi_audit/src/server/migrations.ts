import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Kunci Advisory Lock unik 64-bit untuk proses migration Adi_Hotspot Billing
// Mencegah dua proses migration berjalan bersamaan pada satu database
const MIGRATION_ADVISORY_LOCK_ID = 84729104;

/**
 * Menghitung checksum SHA-256 dari isi file SQL.
 * Melakukan normalisasi line endings (\r\n -> \n) agar checksum konsisten
 * lintas sistem operasi (Linux / Windows).
 */
function calculateChecksum(content: string): string {
  const normalized = content.replace(/\r\n/g, '\n');
  return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
}

/**
 * Mencari path folder 'migrations' secara fleksibel agar tetap valid
 * baik saat dijalankan di lingkungan pengembangan (TSX) maupun hasil build produksi.
 */
function resolveMigrationsDirectory(): string {
  const possiblePaths = [
    path.resolve(process.cwd(), 'migrations'),
    path.resolve(__dirname, '../../migrations'),
    path.resolve(__dirname, '../migrations'),
    path.resolve(__dirname, 'migrations'),
  ];

  for (const candidate of possiblePaths) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return candidate;
    }
  }

  throw new Error(
    `Folder 'migrations' tidak ditemukan di lokasi mana pun: \n - ${possiblePaths.join('\n - ')}`
  );
}

/**
 * Fungsi utama Migration Runner dengan sistem Ledger, Checksum SHA-256,
 * deteksi file hilang, dan perlindungan urutan migration (Anti-Out-of-Order).
 */
export async function runMigrations(): Promise<boolean> {
  // 1. Konfigurasi Koneksi (Default 127.0.0.1 untuk instalasi lokal mini PC Ubuntu)
  const DB_HOST = process.env.DB_HOST || '127.0.0.1';
  const DB_PORT = parseInt(process.env.DB_PORT || '5432', 10);
  const DB_NAME = process.env.DB_NAME || 'adi_hotspot';
  const DB_USER = process.env.DB_USER || 'adi_app';
  const DB_PASSWORD = process.env.DB_PASSWORD || '';

  console.log('================================================================');
  console.log(' Adi_Hotspot Billing - PostgreSQL Migration Runner');
  console.log('================================================================');
  console.log(`Target Host     : ${DB_HOST}`);
  console.log(`Target Port     : ${DB_PORT}`);
  console.log(`Database Name   : ${DB_NAME}`);
  console.log(`Database User   : ${DB_USER}`);
  console.log(`Database Schema : public`);
  // Keamanan: Password tidak pernah ditampilkan di log
  console.log(`Password Status : ${DB_PASSWORD ? 'Terkonfigurasi di file .env' : 'KOSONG / BELUM DIATUR'}`);
  console.log('----------------------------------------------------------------');

  if (!DB_PASSWORD || DB_PASSWORD === 'your_postgres_password_here') {
    console.error('❌ ERROR: Variabel DB_PASSWORD belum diatur di file .env.');
    console.error('   Silakan isi password user database adi_app di file .env pada server Ubuntu Anda.');
    process.exitCode = 1;
    return false;
  }

  let migrationsDir: string;
  try {
    migrationsDir = resolveMigrationsDirectory();
    console.log(`Direktori Migrasi : ${migrationsDir}`);
  } catch (err: any) {
    console.error(`❌ ERROR: ${err.message}`);
    process.exitCode = 1;
    return false;
  }

  // Ambil dan urutkan file SQL secara menaik (001 sebelum 002, dst.)
  const migrationFiles = fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

  if (migrationFiles.length === 0) {
    console.error('❌ ERROR: Tidak ada file .sql ditemukan di direktori migrations.');
    process.exitCode = 1;
    return false;
  }

  console.log(`Ditemukan ${migrationFiles.length} file migration pada disk:`);
  migrationFiles.forEach((file, idx) => console.log(`  ${idx + 1}. ${file}`));
  console.log('----------------------------------------------------------------');

  const client = new pg.Client({
    host: DB_HOST,
    port: DB_PORT,
    database: DB_NAME,
    user: DB_USER,
    password: DB_PASSWORD,
    connectionTimeoutMillis: 10000,
  });

  let hasLock = false;
  let isConnected = false;

  try {
    console.log('Menghubungkan ke PostgreSQL...');
    await client.connect();
    isConnected = true;
    console.log('✅ Berhasil terhubung ke database PostgreSQL.');

    // 2. Kunci Schema ke 'public' secara konsisten
    await client.query('SET search_path TO public;');

    // 3. PostgreSQL Advisory Lock untuk konkruensi aman
    const lockRes = await client.query(
      'SELECT pg_try_advisory_lock($1) AS acquired;',
      [MIGRATION_ADVISORY_LOCK_ID]
    );

    if (!lockRes.rows[0]?.acquired) {
      console.warn('⚠️ PERINGATAN: Proses migration lain sedang berjalan pada database ini.');
      console.warn('   Advisory lock tidak dapat diperoleh. Eksekusi dibatalkan demi keamanan.');
      process.exitCode = 1;
      return false;
    }

    hasLock = true;
    console.log('🔒 Advisory lock berhasil diperoleh. Memulai evaluasi ledger migration...');

    // 4. Inisialisasi Tabel Ledger 'schema_migrations' di schema public
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.schema_migrations (
        id SERIAL PRIMARY KEY,
        filename VARCHAR(255) NOT NULL UNIQUE,
        checksum VARCHAR(64) NOT NULL,
        executed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        execution_time_ms INTEGER NOT NULL
      );
    `);

    // Ambil seluruh riwayat migration yang pernah berhasil dijalankan
    const ledgerRes = await client.query(`
      SELECT filename, checksum, executed_at::text AS executed_at
      FROM public.schema_migrations
      ORDER BY id ASC;
    `);

    const executedMap = new Map<string, { checksum: string; executed_at: string }>();
    for (const row of ledgerRes.rows) {
      executedMap.set(row.filename, {
        checksum: row.checksum,
        executed_at: row.executed_at,
      });
    }

    const availableFilesSet = new Set(migrationFiles);

    // =========================================================================
    // AUDIT CHECK 1: Deteksi file migration yang hilang dari disk
    // =========================================================================
    const missingFiles: string[] = [];
    for (const executedFile of executedMap.keys()) {
      if (!availableFilesSet.has(executedFile)) {
        missingFiles.push(executedFile);
      }
    }

    if (missingFiles.length > 0) {
      console.error('\n❌ PELANGGARAN INTEGRITAS: FILE MIGRATION TERCATAT HILANG DARI DISK!');
      console.error('   Database mencatat file migration berikut telah diterapkan, tetapi fisiknya tidak ditemukan di folder migrations:');
      missingFiles.forEach((file) => console.error(`   - ${file}`));
      console.error('   Proses dihentikan secara total untuk mencegah kerusakan dan inkonsistensi skema.');
      console.error('   Tindakan: Pulihkan file SQL yang hilang ke folder migrations sebelum menjalankan ulang.');
      process.exitCode = 1;
      return false;
    }

    // =========================================================================
    // AUDIT CHECK 2: Perlindungan urutan migration (Anti-Out-of-Order / Backdated)
    // =========================================================================
    // Tentukan migration terakhir berdasarkan urutan eksekusi yang tercatat di tabel
    // public.schema_migrations (baris terakhir dari ledgerRes.rows yang terurut berdasarkan id ASC)
    const latestExecutedFile: string | null =
      ledgerRes.rows.length > 0
        ? ledgerRes.rows[ledgerRes.rows.length - 1].filename
        : null;

    // Periksa apakah ada file baru yang urutan namanya lebih rendah atau sama dengan migration terakhir
    const outOfOrderFiles: string[] = [];
    for (const file of migrationFiles) {
      if (!executedMap.has(file)) {
        if (latestExecutedFile) {
          const comp = file.localeCompare(latestExecutedFile, undefined, {
            numeric: true,
            sensitivity: 'base',
          });
          if (comp <= 0) {
            outOfOrderFiles.push(file);
          }
        }
      }
    }

    if (outOfOrderFiles.length > 0) {
      console.error('\n❌ PELANGGARAN URUTAN MIGRATION (OUT-OF-ORDER DETECTED):');
      console.error(`   Migration terakhir yang sudah diterapkan di database adalah: '${latestExecutedFile}'`);
      console.error('   Ditemukan file migration baru yang memiliki urutan penamaan LEBIH RENDAH atau SAMA dengan migration terakhir:');
      outOfOrderFiles.forEach((file) => console.error(`   - ${file}`));
      console.error('   PostgreSQL migration tidak mengizinkan penyisipan migrasi lampau (backdated migration).');
      console.error('   Tindakan: Ubah prefix nomor file migration baru agar memiliki urutan lebih tinggi dari migration terakhir.');
      process.exitCode = 1;
      return false;
    }

    // =========================================================================
    // AUDIT CHECK 3: Verifikasi Checksum SHA-256 seluruh file yang sudah tercatat
    // =========================================================================
    for (const file of migrationFiles) {
      if (executedMap.has(file)) {
        const record = executedMap.get(file)!;
        const filePath = path.join(migrationsDir, file);
        const sqlContent = fs.readFileSync(filePath, 'utf-8');
        const currentChecksum = calculateChecksum(sqlContent);

        if (record.checksum !== currentChecksum) {
          console.error('\n❌ PELANGGARAN INTEGRITAS MIGRATION (CHECKSUM MISMATCH):');
          console.error(`   File migration '${file}' telah diubah setelah sebelumnya berhasil dijalankan!`);
          console.error(`   - Checksum tersimpan di database : ${record.checksum}`);
          console.error(`   - Checksum file fisik saat ini    : ${currentChecksum}`);
          console.error(`   - Waktu eksekusi sebelumnya       : ${record.executed_at}`);
          console.error('   Proses dihentikan demi menjaga integritas dan stabilitas database.');
          process.exitCode = 1;
          return false;
        }
      }
    }

    let appliedCount = 0;
    let skippedCount = 0;

    // 5. Eksekusi Setiap File Migration Baru Berdasarkan Urutan Menaik
    for (const file of migrationFiles) {
      if (executedMap.has(file)) {
        const record = executedMap.get(file)!;
        console.log(`⏩ [TERCATAT] ${file} sudah pernah dijalankan pada ${record.executed_at}. Dilewati.`);
        skippedCount++;
        continue;
      }

      const filePath = path.join(migrationsDir, file);
      const sqlContent = fs.readFileSync(filePath, 'utf-8');
      const currentChecksum = calculateChecksum(sqlContent);

      console.log(`\n⚙️  Menjalankan migration baru: ${file}...`);
      const startTime = Date.now();

      // Setiap file migration dijalankan dalam transaksi tersendiri (atomik)
      try {
        await client.query('BEGIN');
        await client.query('SET search_path TO public;');

        // Eksekusi konten SQL migration
        await client.query(sqlContent);

        const durationMs = Date.now() - startTime;

        // Catat ke ledger hanya setelah seluruh perintah SQL dalam file berhasil
        await client.query(
          `
          INSERT INTO public.schema_migrations (filename, checksum, execution_time_ms)
          VALUES ($1, $2, $3);
          `,
          [file, currentChecksum, durationMs]
        );

        // Commit transaksi
        await client.query('COMMIT');

        console.log(`✅ [SELESAI] ${file} berhasil di-COMMIT dalam ${durationMs}ms (SHA-256: ${currentChecksum.slice(0, 12)}...)`);
        appliedCount++;
      } catch (migrationErr: any) {
        // Rollback transaksi jika terjadi kesalahan
        try {
          await client.query('ROLLBACK');
        } catch {
          // ignore rollback error
        }

        console.error(`\n❌ GAGAL MENJALANKAN FILE MIGRATION: ${file}`);
        console.error(`   Pesan Kesalahan : ${migrationErr.message}`);
        if (migrationErr.code) {
          console.error(`   PostgreSQL Code : ${migrationErr.code}`);
        }
        if (migrationErr.detail) {
          console.error(`   Detail          : ${migrationErr.detail}`);
        }
        if (migrationErr.hint) {
          console.error(`   Hint            : ${migrationErr.hint}`);
        }
        if (migrationErr.position) {
          console.error(`   Karakter Posisi : ${migrationErr.position}`);
        }

        process.exitCode = 1;
        return false;
      }
    }

    console.log('\n================================================================');
    console.log('✅ LAPORAN SELESAI: PROSES EVALUASI MIGRATION BERHASIL');
    console.log(`   - File baru dieksekusi : ${appliedCount}`);
    console.log(`   - File lama dilewati   : ${skippedCount}`);
    console.log(`   - Total terverifikasi  : ${migrationFiles.length}`);
    console.log('================================================================');
    return true;
  } catch (err: any) {
    console.error('\n❌ KESALAHAN PADA KONEKSI ATAU ENGINE POSTGRESQL:');
    console.error(err.message);
    if (err.code) {
      console.error(`PostgreSQL Error Code: ${err.code}`);
    }
    process.exitCode = 1;
    return false;
  } finally {
    // 6. Pembersihan Sumber Daya & Pelepasan Lock Sebelum Selesai
    if (hasLock && isConnected) {
      try {
        await client.query('SELECT pg_advisory_unlock($1);', [MIGRATION_ADVISORY_LOCK_ID]);
        console.log('🔓 Advisory lock berhasil dilepaskan.');
      } catch (unlockErr: any) {
        console.error('⚠️ Gagal melepaskan advisory lock:', unlockErr?.message);
      }
    }

    if (isConnected) {
      try {
        await client.end();
        console.log('🔌 Koneksi database berhasil ditutup dengan bersih.');
      } catch (closeErr: any) {
        console.error('⚠️ Gagal menutup koneksi database:', closeErr?.message);
      }
    }
  }
}

// Jalankan runner otomatis jika file dieksekusi langsung via CLI / script
const isDirectExecution =
  process.argv[1] &&
  (process.argv[1].endsWith('migrations.ts') || process.argv[1].endsWith('migrations.js'));

if (isDirectExecution) {
  runMigrations().catch((err) => {
    console.error('Fatal unhandled error:', err);
    process.exitCode = 1;
  });
}
