import pg, { Pool, PoolClient, QueryResult } from 'pg';
import dotenv from 'dotenv';
import { logSafeServerError, sanitizeDatabaseError } from './errorSanitizer.js';

dotenv.config();

/**
 * Konfigurasi Koneksi Database PostgreSQL
 * Parameter dibaca dari environment variables (.env).
 * Sesuai ketentuan audit, password TIDAK pernah disimpan di kode sumber.
 */
const DB_HOST = process.env.DB_HOST || '127.0.0.1';
const DB_PORT = parseInt(process.env.DB_PORT || '5432', 10);
const DB_NAME = process.env.DB_NAME || 'adi_hotspot';
const DB_USER = process.env.DB_USER || 'adi_app';
const DB_PASSWORD = process.env.DB_PASSWORD || '';

// Connection pool yang dioptimalkan untuk beban 200-500 pelanggan
let pool: Pool | null = null;
let lastConnectionAttempt: { isConnected: boolean; lastChecked: string; message: string } = {
  isConnected: false,
  lastChecked: new Date().toISOString(),
  message: 'Database belum terhubung. Konfigurasikan DB_PASSWORD di .env server Ubuntu.',
};

/**
 * Memeriksa apakah konfigurasi database sudah lengkap di file .env
 */
export function isDatabaseConfigured(): boolean {
  return Boolean(
    DB_PASSWORD &&
    DB_PASSWORD.trim().length > 0 &&
    DB_PASSWORD !== 'your_postgres_password_here'
  );
}

/**
 * Mendapatkan instance Pool PostgreSQL (Singleton)
 */
export function getDbPool(): Pool {
  if (!pool) {
    pool = new pg.Pool({
      host: DB_HOST,
      port: DB_PORT,
      database: DB_NAME,
      user: DB_USER,
      password: DB_PASSWORD,
      max: 20, // Maksimal 20 koneksi konkuren
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000, // Timeout 5 detik jika host tidak dapat dijangkau
    });

    pool.on('error', (err) => {
      if (isDatabaseConfigured()) {
        logSafeServerError('postgres_pool', (err as any)?.code || 'DB_CONNECTION_ERROR');
      }
    });
  }

  return pool;
}

/**
 * Menjalankan query dengan parameterized input (mencegah SQL Injection)
 */
export async function query<T extends pg.QueryResultRow = any>(
  text: string,
  params?: any[]
): Promise<QueryResult<T>> {
  if (!isDatabaseConfigured()) {
    const err = new Error('Database PostgreSQL belum dikonfigurasi (.env DB_PASSWORD kosong).');
    (err as any).isNotConfigured = true;
    throw err;
  }

  const start = Date.now();
  const clientPool = getDbPool();
  try {
    const res = await clientPool.query<T>(text, params);
    return res;
  } catch (error: any) {
    const safe = sanitizeDatabaseError(error, 'Terjadi kesalahan saat mengeksekusi operasi database.');
    const opWord = text.trim().split(/\s+/)[0]?.toUpperCase() || 'QUERY';
    logSafeServerError('postgres_query', safe.code, { operation: opWord });
    throw error;
  }
}

/**
 * Menjalankan operasi dalam sebuah transaksi database (BEGIN, COMMIT, ROLLBACK).
 * Sangat penting untuk proses pencatatan pembayaran dan penerbitan tagihan secara atomik.
 */
export async function withTransaction<T>(
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  if (!isDatabaseConfigured()) {
    const err = new Error('Database PostgreSQL belum dikonfigurasi (.env DB_PASSWORD kosong).');
    (err as any).isNotConfigured = true;
    throw err;
  }

  const clientPool = getDbPool();
  const client = await clientPool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Uji kesehatan koneksi ke PostgreSQL server
 */
export async function checkDatabaseHealth(): Promise<{
  isConnected: boolean;
  host: string;
  port: number;
  database: string;
  user: string;
  latencyMs?: number;
  error?: string;
  message: string;
}> {
  // Jika DB_PASSWORD kosong, jangan coba koneksi jika di lingkungan cloud preview
  if (!DB_PASSWORD || DB_PASSWORD === 'your_postgres_password_here') {
    const info = {
      isConnected: false,
      host: DB_HOST,
      port: DB_PORT,
      database: DB_NAME,
      user: DB_USER,
      message: 'DB_PASSWORD belum diatur. Di server Ubuntu, atur DB_PASSWORD di file .env Anda.',
    };
    lastConnectionAttempt = {
      isConnected: false,
      lastChecked: new Date().toISOString(),
      message: info.message,
    };
    return info;
  }

  const start = Date.now();
  try {
    const clientPool = getDbPool();
    const client = await clientPool.connect();
    try {
      await client.query('SELECT 1 AS healthcheck');
      const latencyMs = Date.now() - start;
      const info = {
        isConnected: true,
        host: DB_HOST,
        port: DB_PORT,
        database: DB_NAME,
        user: DB_USER,
        latencyMs,
        message: `Terhubung ke PostgreSQL ${DB_HOST}:${DB_PORT}/${DB_NAME} (Latency: ${latencyMs}ms)`,
      };
      lastConnectionAttempt = {
        isConnected: true,
        lastChecked: new Date().toISOString(),
        message: info.message,
      };
      return info;
    } finally {
      client.release();
    }
  } catch (err: any) {
    const safe = sanitizeDatabaseError(err, 'Gagal terhubung ke host database PostgreSQL.');
    const info = {
      isConnected: false,
      host: DB_HOST,
      port: DB_PORT,
      database: DB_NAME,
      user: DB_USER,
      error: safe.code,
      message: `Gagal terhubung ke ${DB_HOST}:${DB_PORT} (${safe.message})`,
    };
    lastConnectionAttempt = {
      isConnected: false,
      lastChecked: new Date().toISOString(),
      message: info.message,
    };
    return info;
  }
}

/**
 * Ambil status koneksi terakhir
 */
export function getLastConnectionStatus() {
  return lastConnectionAttempt;
}
