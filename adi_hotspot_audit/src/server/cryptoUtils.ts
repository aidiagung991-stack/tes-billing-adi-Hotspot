import crypto from 'crypto';
import { SafeOperationalError } from './errorSanitizer.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // Standar aman untuk AES-256-GCM
const AUTH_TAG_LENGTH = 16;

/**
 * Memeriksa apakah kunci enkripsi MIKROTIK_ENCRYPTION_KEY sudah terkonfigurasi di environment variable.
 */
export function isMikrotikEncryptionKeyConfigured(): boolean {
  const envKey = process.env.MIKROTIK_ENCRYPTION_KEY;
  return Boolean(
    envKey &&
    envKey.trim().length > 0 &&
    envKey !== 'your_secure_mikrotik_encryption_passphrase_here'
  );
}

/**
 * Mendapatkan kunci enkripsi 32-byte (256-bit) dari environment variable MIKROTIK_ENCRYPTION_KEY.
 * Menggunakan SHA-256 hash agar panjang kunci selalu tepat 32 byte terlepas dari panjang string input.
 * DILARANG menggunakan fallback key bawaan dan DILARANG mencetak kunci ke log.
 */
function getEncryptionKey(): Buffer {
  const envKey = process.env.MIKROTIK_ENCRYPTION_KEY;
  if (!envKey || envKey.trim().length === 0 || envKey === 'your_secure_mikrotik_encryption_passphrase_here') {
    throw new SafeOperationalError(
      'ENCRYPTION_NOT_CONFIGURED',
      'Kunci enkripsi MIKROTIK_ENCRYPTION_KEY belum dikonfigurasi di file .env server. Proses enkripsi dan dekripsi ditolak demi keamanan data.',
      { statusCode: 500 }
    );
  }
  return crypto.createHash('sha256').update(envKey.trim()).digest();
}

/**
 * Mengenkripsi password RouterOS MikroTik secara reversible menggunakan AES-256-GCM.
 * Password tersimpan aman di database dan hanya dapat didekripsi oleh backend.
 * Format output: "enc:v1:<iv_hex>:<auth_tag_hex>:<cipher_hex>"
 */
export function encryptMikrotikPassword(plaintext: string): string {
  if (!plaintext) return '';
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');

  return `enc:v1:${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Mendekripsi kembali password RouterOS MikroTik saat backend melakukan koneksi API
 * ke RouterBOARD RB4011. Jangan pernah mengirimkan hasil dekripsi ini ke browser/frontend.
 */
export function decryptMikrotikPassword(encryptedPayload: string): string {
  if (!encryptedPayload) return '';

  if (!encryptedPayload.startsWith('enc:v1:')) {
    // Jika data lama belum berformat enc:v1
    return encryptedPayload;
  }

  const parts = encryptedPayload.split(':');
  if (parts.length !== 5) {
    throw new SafeOperationalError('DECRYPTION_ERROR', 'Format password terenkripsi tidak valid.', {
      statusCode: 500,
    });
  }

  const [, , ivHex, authTagHex, cipherHex] = parts;
  const key = getEncryptionKey();
  try {
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(cipherHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch {
    throw new SafeOperationalError(
      'DECRYPTION_ERROR',
      'Gagal mendekripsi kredensial terenkripsi. Format atau kunci enkripsi tidak cocok.',
      { statusCode: 500 }
    );
  }
}

/**
 * Memvalidasi format password akun pelanggan sebelum dienkripsi dan disimpan:
 * - Minimal 6 karakter
 * - Menolak null byte (\0 atau \x00)
 * - Menolak karakter kontrol ASCII (0x00 - 0x1F dan 0x7F)
 * - DILARANG mencatat password plaintext ke log atau output error
 */
export function validateCustomerPassword(password: string): { valid: boolean; message?: string } {
  if (!password || typeof password !== 'string') {
    return { valid: false, message: 'Password akun pelanggan wajib diisi.' };
  }
  // Tolak null byte (\0) dan karakter kontrol ASCII (0x00-0x1F, 0x7F)
  if (password.includes('\0') || /[\x00-\x1F\x7F]/.test(password)) {
    return {
      valid: false,
      message: 'Password tidak boleh mengandung null byte atau karakter kontrol yang tidak diizinkan.',
    };
  }
  const trimmed = password.trim();
  if (trimmed.length < 6) {
    return { valid: false, message: 'Password akun pelanggan minimal 6 karakter demi keamanan akun.' };
  }
  return { valid: true };
}

