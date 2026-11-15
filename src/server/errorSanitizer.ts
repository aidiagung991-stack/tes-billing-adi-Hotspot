/**
 * Mekanisme sanitasi error dan perlindungan kredensial terpusat untuk backend Adi_Hotspot Billing.
 *
 * Prinsip keamanan:
 * - Error eksternal/internal (PostgreSQL, TCP/TLS socket, RouterOS !trap/!fatal, Node internal)
 *   TIDAK pernah diteruskan mentah ke frontend, log sensitif, maupun router_last_sync_message.
 * - Error validasi pengguna dan error operasional terkontrol yang memang aman tetap dapat ditampilkan
 *   secara informatif bagi admin.
 * - Kode error yang dikembalikan ke API selalu berasal dari daftar allowlist (ALLOWED_ERROR_CODES).
 */

export const ALLOWED_ERROR_CODES = [
  'VALIDATION_ERROR',
  'NOT_FOUND',
  'CONFLICT',
  'DB_NOT_CONFIGURED',
  'DB_CONNECTION_ERROR',
  'DB_QUERY_ERROR',
  'DB_CONSTRAINT_ERROR',
  'ENCRYPTION_NOT_CONFIGURED',
  'DECRYPTION_ERROR',
  'AUTH_FAILED',
  'ROUTEROS_AUTH_FAILED',
  'ROUTEROS_FATAL',
  'ROUTEROS_TRAP',
  'ROUTEROS_TIMEOUT',
  'ROUTEROS_DUPLICATE_ACCOUNT',
  'ROUTEROS_PROFILE_MISSING',
  'ROUTEROS_NOT_FOUND',
  'ROUTEROS_DISCONNECT_INCOMPLETE',
  'ROUTEROS_SOCKET_ERROR',
  'ROUTEROS_VALIDATION_ERROR',
  'SOCKET_INIT_FAILED',
  'CONNECTION_CLOSED_PREMATURELY',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'ECONNRESET',
  'EPIPE',
  'TLS_ERROR',
  'NETWORK_ERROR',
  'INTERNAL_ERROR',
] as const;

export type AllowedErrorCode = (typeof ALLOWED_ERROR_CODES)[number];

const ALLOWED_CODE_SET = new Set<string>(ALLOWED_ERROR_CODES);

export class SafeOperationalError extends Error {
  readonly code: AllowedErrorCode;
  readonly safeMessage: string;
  readonly statusCode: number;
  readonly isFatal: boolean;

  constructor(
    code: AllowedErrorCode,
    safeMessage: string,
    options?: { statusCode?: number; isFatal?: boolean }
  ) {
    super(safeMessage);
    this.name = 'SafeOperationalError';
    this.code = code;
    this.safeMessage = redactSensitiveText(safeMessage);
    this.statusCode = options?.statusCode ?? 400;
    this.isFatal = Boolean(options?.isFatal || code === 'ROUTEROS_FATAL');
  }
}

export function isSafeOperationalError(err: unknown): err is SafeOperationalError {
  return err instanceof SafeOperationalError;
}

export function isFatalMikrotikError(err: unknown): boolean {
  if (isSafeOperationalError(err)) {
    return err.isFatal || err.code === 'ROUTEROS_FATAL';
  }
  return false;
}

export function toAllowedErrorCode(
  candidate: unknown,
  fallback: AllowedErrorCode = 'INTERNAL_ERROR'
): AllowedErrorCode {
  if (typeof candidate === 'string' && ALLOWED_CODE_SET.has(candidate)) {
    return candidate as AllowedErrorCode;
  }
  return fallback;
}

/**
 * Membersihkan teks dari potensi kebocoran kredensial, ciphertext, URI DB, atau stack trace.
 * Tetap mempertahankan penanda terstruktur [SYNC_META_V1:...] karena tidak berpola rahasia.
 */
export function redactSensitiveText(input: unknown): string {
  if (typeof input !== 'string') return '';
  let text = input;

  // Lindungi env secret aktif jika secara tidak sengaja muncul pada pesan
  const envSecrets = [
    process.env.DB_PASSWORD,
    process.env.MIKROTIK_ENCRYPTION_KEY,
    process.env.WABLAS_API_TOKEN,
    process.env.WABLAS_SECRET_KEY,
  ];
  for (const secret of envSecrets) {
    if (secret && secret.trim().length >= 4) {
      text = text.split(secret.trim()).join('[REDACTED]');
    }
  }

  // Redact format ciphertext AES-256-GCM enc:v1:...
  text = text.replace(/enc:v1:[0-9a-fA-F:]+/g, '[REDACTED_CREDENTIAL]');

  // Redact URI koneksi database PostgreSQL
  text = text.replace(/postgres(?:ql)?:\/\/[^\s'"`]+/gi, 'postgresql://[REDACTED]');

  // Redact pola Authorization Bearer atau query token/password
  text = text.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]');
  text = text.replace(/(token|password|secret|apikey|api_key)\s*[=:]\s*[^\s,&;]+/gi, '$1=[REDACTED]');

  // Hapus baris stack trace jika ada
  text = text.replace(/\r?\n\s*at\s+[^\r\n]+/g, '');

  return text.trim();
}

/**
 * Memetakan error socket TCP/TLS ke kode allowlist yang aman tanpa mengekspos err.message mentah.
 */
export function sanitizeSocketErrorCode(err: any): AllowedErrorCode {
  const rawCode = typeof err?.code === 'string' ? err.code.toUpperCase() : '';
  if (rawCode && ALLOWED_CODE_SET.has(rawCode)) {
    return rawCode as AllowedErrorCode;
  }
  if (rawCode.startsWith('ERR_TLS') || rawCode.startsWith('ERR_SSL') || rawCode.includes('CERT')) {
    return 'TLS_ERROR';
  }
  const msg = typeof err?.message === 'string' ? err.message.toLowerCase() : '';
  if (msg.includes('tls') || msg.includes('ssl') || msg.includes('certificate')) {
    return 'TLS_ERROR';
  }
  return 'NETWORK_ERROR';
}

export function isDatabaseErrorObject(err: any): boolean {
  if (!err || typeof err !== 'object') return false;
  if (err.isNotConfigured === true) return true;
  if (typeof err.code === 'string' && /^[0-9A-Z]{5}$/.test(err.code)) {
    // PostgreSQL SQLSTATE 5-character code (e.g. 23505, 42P01, 28P01, 08006, 57P01)
    return true;
  }
  if (typeof err.severity === 'string' || typeof err.routine === 'string' || typeof err.schema === 'string') {
    return true;
  }
  return false;
}

/**
 * Sanitasi error PostgreSQL / database agar SQL, host, kredensial, skema internal,
 * dan stack trace tidak pernah bocor ke API response atau pesan sinkronisasi.
 */
export function sanitizeDatabaseError(
  err: unknown,
  fallbackMessage: string
): { code: AllowedErrorCode; message: string; statusCode: number } {
  if (isSafeOperationalError(err)) {
    return {
      code: err.code,
      message: err.safeMessage,
      statusCode: err.statusCode,
    };
  }

  const anyErr = err as any;
  if (anyErr?.isNotConfigured) {
    return {
      code: 'DB_NOT_CONFIGURED',
      message: 'Database PostgreSQL belum dikonfigurasi pada server.',
      statusCode: 503,
    };
  }

  const pgCode = typeof anyErr?.code === 'string' ? anyErr.code : '';
  if (pgCode === '23505') {
    return {
      code: 'DB_CONSTRAINT_ERROR',
      message: `${fallbackMessage} Data dengan identitas yang sama sudah terdaftar.`,
      statusCode: 409,
    };
  }
  if (pgCode === '23503') {
    return {
      code: 'DB_CONSTRAINT_ERROR',
      message: `${fallbackMessage} Data referensi terkait tidak valid atau masih digunakan.`,
      statusCode: 400,
    };
  }
  if (pgCode === '23514' || pgCode === '23502' || pgCode === '22P02' || pgCode === '22001') {
    return {
      code: 'DB_CONSTRAINT_ERROR',
      message: `${fallbackMessage} Format atau batasan nilai input tidak valid.`,
      statusCode: 400,
    };
  }
  if (
    pgCode === 'ECONNREFUSED' ||
    pgCode === 'ETIMEDOUT' ||
    pgCode === 'ENOTFOUND' ||
    pgCode === 'ECONNRESET' ||
    pgCode === '57P01' ||
    pgCode === '57P02' ||
    pgCode === '57P03' ||
    pgCode.startsWith('08')
  ) {
    return {
      code: 'DB_CONNECTION_ERROR',
      message: `${fallbackMessage} Koneksi ke server database PostgreSQL gagal atau terputus.`,
      statusCode: 503,
    };
  }

  return {
    code: 'DB_QUERY_ERROR',
    message: fallbackMessage,
    statusCode: 500,
  };
}

/**
 * Sanitasi error komunikasi RouterOS / soket agar pesan mentah !trap, !fatal,
 * maupun detail soket sensitif tidak pernah bocor ke admin/frontend.
 */
export function sanitizeMikrotikError(
  err: unknown,
  fallbackMessage: string
): { code: AllowedErrorCode; message: string; isFatal: boolean } {
  if (isSafeOperationalError(err)) {
    return {
      code: err.code,
      message: err.safeMessage,
      isFatal: err.isFatal,
    };
  }

  if (isDatabaseErrorObject(err)) {
    const dbSafe = sanitizeDatabaseError(err, fallbackMessage);
    return {
      code: dbSafe.code,
      message: dbSafe.message,
      isFatal: false,
    };
  }

  const anyErr = err as any;
  const sockCode = sanitizeSocketErrorCode(anyErr);
  if (sockCode === 'ECONNREFUSED') {
    return {
      code: 'ECONNREFUSED',
      message: `${fallbackMessage} Koneksi ke port API MikroTik ditolak.`,
      isFatal: false,
    };
  }
  if (sockCode === 'ETIMEDOUT') {
    return {
      code: 'ETIMEDOUT',
      message: `${fallbackMessage} Koneksi ke router MikroTik timeout.`,
      isFatal: false,
    };
  }
  if (sockCode === 'EHOSTUNREACH' || sockCode === 'ENETUNREACH') {
    return {
      code: sockCode,
      message: `${fallbackMessage} Host router MikroTik tidak dapat dijangkau dari jaringan server.`,
      isFatal: false,
    };
  }
  if (sockCode === 'ECONNRESET' || sockCode === 'EPIPE') {
    return {
      code: sockCode,
      message: `${fallbackMessage} Koneksi ke router terputus secara mendadak.`,
      isFatal: false,
    };
  }
  if (sockCode === 'TLS_ERROR') {
    return {
      code: 'TLS_ERROR',
      message: `${fallbackMessage} Terjadi kesalahan negosiasi TLS/SSL dengan router.`,
      isFatal: false,
    };
  }

  return {
    code: 'INTERNAL_ERROR',
    message: fallbackMessage,
    isFatal: false,
  };
}

/**
 * Sanitasi error umum server (mis. endpoint Express non-DB atau fallback umum).
 */
export function sanitizeGenericServerError(
  err: unknown,
  fallbackMessage: string
): { code: AllowedErrorCode; message: string; statusCode: number } {
  if (isSafeOperationalError(err)) {
    return {
      code: err.code,
      message: err.safeMessage,
      statusCode: err.statusCode,
    };
  }
  if (isDatabaseErrorObject(err)) {
    return sanitizeDatabaseError(err, fallbackMessage);
  }
  return {
    code: 'INTERNAL_ERROR',
    message: fallbackMessage,
    statusCode: 500,
  };
}

/**
 * Mencatat event diagnostik aman ke log server tanpa menyertakan password, token,
 * ciphertext, SQL mentah, stack trace, atau request body sensitif.
 */
export function logSafeServerError(
  context: string,
  code: AllowedErrorCode | string,
  meta?: { operation?: string; resourceId?: string }
): void {
  const safeCode = toAllowedErrorCode(code);
  const entry = {
    ts: new Date().toISOString(),
    context,
    code: safeCode,
    ...(meta?.operation ? { operation: meta.operation } : {}),
    ...(meta?.resourceId ? { resourceId: meta.resourceId } : {}),
  };
  console.error('[Adi_Hotspot AuditLog]', JSON.stringify(entry));
}
