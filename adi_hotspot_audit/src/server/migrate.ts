/**
 * Safe Migration Wrapper for Adi_Hotspot Billing.
 * 
 * Skrip ini adalah wrapper pengaman yang meneruskan eksekusi ke Migration Runner
 * resmi (src/server/migrations.ts) yang memiliki perlindungan lengkap:
 * - PostgreSQL Advisory Lock
 * - Migration Ledger (public.schema_migrations)
 * - Checksum SHA-256
 * - Deteksi file migration yang hilang
 * - Deteksi migration out-of-order / backdated
 * - Transaksi terpisah per file SQL dengan rollback otomatis
 * - Tidak menjalankan ulang migration yang sudah berhasil
 */
import { runMigrations } from './migrations.js';

runMigrations().catch((err) => {
  console.error('Fatal unhandled error in migration runner:', err);
  process.exitCode = 1;
});

