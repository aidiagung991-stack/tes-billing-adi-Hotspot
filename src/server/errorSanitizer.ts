/**
 * Mekanisme sanitasi error dan perlindungan kredensial terpusat untuk backend Adi_Hotspot Billing.
 *
 * Prinsip keamanan:
 * - Error eksternal/internal (PostgreSQL, TCP/TLS socket, RouterOS !trap/!fatal, Node internal)
 *   TIDAK pernah diteruskan mentah ke frontend, log sensitif, maupun router_last_sync_message.
 * - Error validasi pengguna dan error operasional terkontrol yang memang aman tetap dapat ditampilkan
 *   secara informatif bagi admin.
 * - Kode error yang dikembalikan ke API selalu berasal dari daftar allowlist (ALLOWED_ERROR_CODES).
 * - Kode error soket hanya berasal dari allowlist jaringan/socket/TLS terpisah (ALLOWED_SOCKET_ERROR_CODES).
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

export const ALLOWED_SOCKET_ERROR_CODES = [
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'ECONNRESET',
  'EPIPE',
  'TLS_ERROR',
  'NETWORK_ERROR',
] as const;

export type AllowedSocketErrorCode = (typeof ALLOWED_SOCKET_ERROR_CODES)[number];

const ALLOWED_SOCKET_CODE_SET = new Set<string>(ALLOWED_SOCKET_ERROR_CODES);

const FATAL_ERROR_CODES = new Set<AllowedErrorCode>(['ROUTEROS_FATAL']);

const MAX_SAFE_MESSAGE_LENGTH = 320;
const MAX_LOG_CONTEXT_LENGTH = 80;
const MAX_LOG_OPERATION_LENGTH = 24;
const MAX_LOG_RESOURCE_ID_LENGTH = 64;

const SENSITIVE_KEY_ALT =
  'password|passwd|pwd|access_token|refresh_token|id_token|token|client_secret|secret_key|secret|api_key|api-key|apikey|passphrase|private_key';

const SYNC_META_V1_SPLIT_REGEX = /(\[SYNC_META_V1:[A-Za-z0-9_-]+\])/g;
const SYNC_META_V1_EXACT_REGEX = /^\[SYNC_META_V1:[A-Za-z0-9_-]+\]$/;

function getActiveEnvSecrets(): string[] {
  const candidates = new Set<string>();
  const explicitKeys = [
    'DB_PASSWORD',
    'PGPASSWORD',
    'DATABASE_URL',
    'MIKROTIK_ENCRYPTION_KEY',
    'WABLAS_API_TOKEN',
    'WABLAS_SECRET_KEY',
    'JWT_SECRET',
    'SESSION_SECRET',
    'API_SECRET',
    'ADMIN_PASSWORD',
  ];

  for (const key of explicitKeys) {
    const val = process.env[key];
    if (typeof val === 'string' && val.trim().length >= 4) {
      candidates.add(val.trim());
    }
  }

  for (const [key, val] of Object.entries(process.env)) {
    if (!val || typeof val !== 'string') continue;
    if (/(PASSWORD|PASSWD|SECRET|TOKEN|API_KEY|APIKEY|PRIVATE_KEY|PASSPHRASE|CONNECTION_STRING|DATABASE_URL)/i.test(key)) {
      const trimmed = val.trim();
      if (trimmed.length >= 6) {
        candidates.add(trimmed);
      }
    }
  }

  return Array.from(candidates).sort((a, b) => b.length - a.length);
}

function redactTextSegment(segment: string): string {
  let text = segment;

  // 1. Redact secret environment aktif tanpa pernah menampilkannya
  for (const secret of getActiveEnvSecrets()) {
    if (text.includes(secret)) {
      text = text.split(secret).join('[REDACTED]');
    }
  }

  // 2. Redact ciphertext AES-256-GCM enc:v1:...
  text = text.replace(/enc:v1:[^\s'"`),;\]]+/g, '[REDACTED_CREDENTIAL]');

  // 3. Redact PostgreSQL connection URI (termasuk username, password, host, query)
  text = text.replace(/postgres(?:ql)?:\/\/[^\s'"`),;\]]+/gi, 'postgresql://[REDACTED]');

  // 4. Redact header Authorization Bearer/Basic/Token dan standalone Bearer
  text = text.replace(
    /(["']?)Authorization\1\s*[:=]\s*(['"`]?)Bearer\s+[^\s'"`,;)}\]]+\2/gi,
    '$1Authorization$1: $2Bearer [REDACTED]$2'
  );
  text = text.replace(
    /(["']?)Authorization\1\s*[:=]\s*(['"`]?)(?:Basic|Token)\s+[^\s'"`,;)}\]]+\2/gi,
    '$1Authorization$1: $2[REDACTED]$2'
  );
  text = text.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]');

  // 5. Redact format JSON ber-tanda kutip ("password":"...", 'client_secret':'...', dst.)
  const jsonDoubleQuotedRegex = new RegExp(`(["'])(${SENSITIVE_KEY_ALT})\\1\\s*:\\s*"(?:\\\\.|[^"\\\\])*"`, 'gi');
  text = text.replace(jsonDoubleQuotedRegex, '"$2":"[REDACTED]"');

  const jsonSingleQuotedRegex = new RegExp(`(["'])(${SENSITIVE_KEY_ALT})\\1\\s*:\\s*'(?:\\\\.|[^'\\\\])*'`, 'gi');
  text = text.replace(jsonSingleQuotedRegex, "'$2':'[REDACTED]'");

  const jsonUnquotedRegex = new RegExp(`(["'])(${SENSITIVE_KEY_ALT})\\1\\s*:\\s*([^,\\s}\\]]+)`, 'gi');
  text = text.replace(jsonUnquotedRegex, '"$2":"[REDACTED]"');

  // 6. Redact format key-value bertanda kutip maupun tidak bertanda kutip dengan karakter khusus
  const kvQuotedRegex = new RegExp(
    `\\b(${SENSITIVE_KEY_ALT})\\b\\s*([=:])\\s*(?:"(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*'|\`(?:\\\\.|[^\`\\\\])*\`)`,
    'gi'
  );
  text = text.replace(kvQuotedRegex, '$1$2[REDACTED]');

  const kvUnquotedRegex = new RegExp(
    `\\b(${SENSITIVE_KEY_ALT})\\b\\s*([=:])\\s*([^\\s,&;)}\\]'"]+)`,
    'gi'
  );
  text = text.replace(kvUnquotedRegex, '$1$2[REDACTED]');

  // 7. Hapus stack trace Node.js & lokasi file internal
  text = text.replace(/\r?\n\s*at\s+[^\r\n]+/g, '');
  text = text.replace(
    /\bat\s+(?:[A-Za-z0-9_$.<>[\]]+\s+\()?(?:file:\/\/)?(?:\/|[A-Za-z]:\\|node:)?[^\s():]+?\.(?:ts|tsx|js|jsx|mjs|cjs):\d+:\d+\)?/gi,
    ''
  );
  text = text.replace(/\((?:file:\/\/)?(?:\/|[A-Za-z]:\\)[^():\s]+\.(?:ts|tsx|js|jsx|mjs|cjs):\d+:\d+\)/gi, '');
  text = text.replace(
    /(?:file:\/\/\/[^\s):]+|\/(?:app|usr|var|home|tmp|srv|opt|etc)\/[^\s):]+|[A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+\.(?:ts|tsx|js|jsx|mjs|cjs))(?::\d+:\d+)?/gi,
    '[INTERNAL_PATH]'
  );

  // 8. Hapus karakter kontrol berbahaya dan rapikan spasi
  text = text.replace(/[\x00-\x1F\x7F\u2028\u2029]+/g, ' ').replace(/\s{2,}/g, ' ');
  return text;
}

/**
 * Membersihkan teks dari potensi kebocoran kredensial, ciphertext, URI DB, atau stack trace.
 * Tetap mempertahankan penanda terstruktur [SYNC_META_V1:...] secara utuh.
 */
export function redactSensitiveText(input: unknown): string {
  if (typeof input !== 'string') return '';
  if (!input.trim()) return '';

  const parts = input.split(SYNC_META_V1_SPLIT_REGEX);
  const cleanedParts = parts.map((part) => {
    if (!part) return '';
    if (SYNC_META_V1_EXACT_REGEX.test(part)) {
      return part;
    }
    return redactTextSegment(part);
  });

  return cleanedParts.join('').replace(/\s{2,}/g, ' ').trim();
}

function containsUnsafeInternalPattern(raw: string): boolean {
  if (/(!trap|!fatal|=message=|=ret=|=.id=)/i.test(raw)) return true;
  if (/\b(SELECT|INSERT|UPDATE|DELETE|DROP|ALTER|CREATE)\b[\s\S]{0,160}\b(FROM|INTO|TABLE|SET|WHERE)\b/i.test(raw)) {
    return true;
  }
  if (
    /\b(SQLSTATE|pg-protocol|pg_catalog|information_schema|duplicate key value|violates unique constraint|violates foreign key|syntax error at or near|relation\s+"[^"]+"|column\s+"[^"]+"|constraint\s+"[^"]+")\b/i.test(
      raw
    )
  ) {
    return true;
  }
  if (/(\r?\n\s*at\s+|\bat\s+[A-Za-z0-9_$.<>[\]]+\s*\([^)]*\)|[A-Za-z0-9_./\\-]+\.(?:ts|tsx|js|jsx|mjs|cjs):\d+:\d+)/i.test(raw)) {
    return true;
  }
  if (/\b(TypeError|ReferenceError|SyntaxError|RangeError):/i.test(raw)) {
    return true;
  }
  return false;
}

function truncateText(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, Math.max(16, maxLen - 3)).trimEnd()}...`;
}

/**
 * Helper terpusat untuk memastikan fallbackMessage (dan pesan SafeOperationalError)
 * bebas dari kredensial, SQL, stack trace, karakter kontrol, serta dibatasi panjangnya.
 */
export function sanitizeSafeFallbackMessage(
  candidateMessage: unknown,
  defaultSafeFallback: string,
  maxLen: number = MAX_SAFE_MESSAGE_LENGTH
): string {
  const cleanDefault = truncateText(
    redactSensitiveText(defaultSafeFallback) || 'Terjadi kesalahan operasional pada server.',
    maxLen
  );

  if (typeof candidateMessage !== 'string') {
    return cleanDefault;
  }
  const rawTrimmed = candidateMessage.trim();
  if (!rawTrimmed) {
    return cleanDefault;
  }

  // Jika input mengandung pola SQL/RouterOS/stack internal mentah, tolak seluruhnya ke default aman
  if (containsUnsafeInternalPattern(rawTrimmed)) {
    return cleanDefault;
  }

  const redacted = redactSensitiveText(rawTrimmed);
  if (!redacted || /^[:;.,\-_\s]+$/.test(redacted)) {
    return cleanDefault;
  }

  // Jika teks mengandung placeholder redaksi atau jalur internal, kembalikan default aman
  if (
    redacted.includes('[INTERNAL_PATH]') ||
    redacted.includes('[REDACTED')
  ) {
    return cleanDefault;
  }

  return truncateText(redacted, maxLen);
}

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
    const validatedCode = toAllowedErrorCode(code);
    const cleanedMessage = sanitizeSafeFallbackMessage(
      safeMessage,
      'Terjadi kesalahan operasional yang tidak dapat diproses.'
    );

    super(cleanedMessage);
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = 'SafeOperationalError';
    this.code = validatedCode;
    this.safeMessage = cleanedMessage;
    this.statusCode =
      typeof options?.statusCode === 'number' &&
      Number.isInteger(options.statusCode) &&
      options.statusCode >= 400 &&
      options.statusCode <= 599
        ? options.statusCode
        : 400;

    const isAllowedFatalCode = FATAL_ERROR_CODES.has(validatedCode);
    const isValidFatalOption = options?.isFatal === true && ALLOWED_CODE_SET.has(String(code));
    this.isFatal = isAllowedFatalCode || isValidFatalOption;
  }

  override toString(): string {
    return `${this.name} [${this.code}]: ${this.safeMessage}`;
  }
}

export function isSafeOperationalError(err: unknown): err is SafeOperationalError {
  return err instanceof SafeOperationalError;
}

export function isFatalMikrotikError(err: unknown): boolean {
  if (isSafeOperationalError(err)) {
    return Boolean(err.isFatal) || err.code === 'ROUTEROS_FATAL';
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
 * Memetakan error socket TCP/TLS ke allowlist kode jaringan/socket/TLS terpisah.
 * Kode non-socket (mis. DB_QUERY_ERROR, ROUTEROS_TRAP, INTERNAL_ERROR) tidak pernah
 * dianggap sebagai kode socket dan dipetakan ke NETWORK_ERROR.
 */
export function sanitizeSocketErrorCode(err: any): AllowedSocketErrorCode {
  const rawCode = typeof err?.code === 'string' ? err.code.trim().toUpperCase() : '';
  if (rawCode && ALLOWED_SOCKET_CODE_SET.has(rawCode)) {
    return rawCode as AllowedSocketErrorCode;
  }
  if (rawCode === 'ECONNABORTED') {
    return 'ECONNRESET';
  }
  if (
    rawCode.startsWith('ERR_TLS') ||
    rawCode.startsWith('ERR_SSL') ||
    rawCode.includes('CERT') ||
    rawCode.includes('TLS') ||
    rawCode.includes('SSL')
  ) {
    return 'TLS_ERROR';
  }

  // Jangan gunakan pesan err jika rawCode jelas berasal dari kategori non-socket (DB/RouterOS/Internal)
  if (rawCode && (ALLOWED_CODE_SET.has(rawCode) || /^[0-9A-Z]{5}$/.test(rawCode))) {
    return 'NETWORK_ERROR';
  }

  const msg = typeof err?.message === 'string' ? err.message.toLowerCase() : '';
  if (
    msg.includes('tls') ||
    msg.includes('ssl') ||
    msg.includes('certificate') ||
    msg.includes('handshake')
  ) {
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
  const safeFallback = sanitizeSafeFallbackMessage(
    fallbackMessage,
    'Terjadi kesalahan saat memproses operasi database.'
  );

  if (isSafeOperationalError(err)) {
    return {
      code: toAllowedErrorCode(err.code),
      message: sanitizeSafeFallbackMessage(err.safeMessage, safeFallback),
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
      message: truncateText(`${safeFallback} Data dengan identitas yang sama sudah terdaftar.`, MAX_SAFE_MESSAGE_LENGTH),
      statusCode: 409,
    };
  }
  if (pgCode === '23503') {
    return {
      code: 'DB_CONSTRAINT_ERROR',
      message: truncateText(
        `${safeFallback} Data referensi terkait tidak valid atau masih digunakan.`,
        MAX_SAFE_MESSAGE_LENGTH
      ),
      statusCode: 400,
    };
  }
  if (pgCode === '23514' || pgCode === '23502' || pgCode === '22P02' || pgCode === '22001') {
    return {
      code: 'DB_CONSTRAINT_ERROR',
      message: truncateText(`${safeFallback} Format atau batasan nilai input tidak valid.`, MAX_SAFE_MESSAGE_LENGTH),
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
      message: truncateText(
        `${safeFallback} Koneksi ke server database PostgreSQL gagal atau terputus.`,
        MAX_SAFE_MESSAGE_LENGTH
      ),
      statusCode: 503,
    };
  }

  return {
    code: 'DB_QUERY_ERROR',
    message: safeFallback,
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
  const safeFallback = sanitizeSafeFallbackMessage(
    fallbackMessage,
    'Koneksi atau komunikasi ke router MikroTik mengalami gangguan.'
  );

  if (isSafeOperationalError(err)) {
    const safeCode = toAllowedErrorCode(err.code);
    return {
      code: safeCode,
      message: sanitizeSafeFallbackMessage(err.safeMessage, safeFallback),
      isFatal: Boolean(err.isFatal) || safeCode === 'ROUTEROS_FATAL',
    };
  }

  if (isDatabaseErrorObject(err)) {
    const dbSafe = sanitizeDatabaseError(err, safeFallback);
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
      message: truncateText(`${safeFallback} Koneksi ke port API MikroTik ditolak.`, MAX_SAFE_MESSAGE_LENGTH),
      isFatal: false,
    };
  }
  if (sockCode === 'ETIMEDOUT') {
    return {
      code: 'ETIMEDOUT',
      message: truncateText(`${safeFallback} Koneksi ke router MikroTik timeout.`, MAX_SAFE_MESSAGE_LENGTH),
      isFatal: false,
    };
  }
  if (sockCode === 'EHOSTUNREACH' || sockCode === 'ENETUNREACH') {
    return {
      code: sockCode,
      message: truncateText(
        `${safeFallback} Host router MikroTik tidak dapat dijangkau dari jaringan server.`,
        MAX_SAFE_MESSAGE_LENGTH
      ),
      isFatal: false,
    };
  }
  if (sockCode === 'ENOTFOUND') {
    return {
      code: 'ENOTFOUND',
      message: truncateText(`${safeFallback} Alamat host router MikroTik tidak ditemukan.`, MAX_SAFE_MESSAGE_LENGTH),
      isFatal: false,
    };
  }
  if (sockCode === 'ECONNRESET' || sockCode === 'EPIPE') {
    return {
      code: sockCode,
      message: truncateText(`${safeFallback} Koneksi ke router terputus secara mendadak.`, MAX_SAFE_MESSAGE_LENGTH),
      isFatal: false,
    };
  }
  if (sockCode === 'TLS_ERROR') {
    return {
      code: 'TLS_ERROR',
      message: truncateText(
        `${safeFallback} Terjadi kesalahan negosiasi TLS/SSL dengan router.`,
        MAX_SAFE_MESSAGE_LENGTH
      ),
      isFatal: false,
    };
  }

  return {
    code: 'INTERNAL_ERROR',
    message: safeFallback,
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
  const safeFallback = sanitizeSafeFallbackMessage(
    fallbackMessage,
    'Terjadi gangguan internal pada server aplikasi.'
  );

  if (isSafeOperationalError(err)) {
    return {
      code: toAllowedErrorCode(err.code),
      message: sanitizeSafeFallbackMessage(err.safeMessage, safeFallback),
      statusCode: err.statusCode,
    };
  }
  if (isDatabaseErrorObject(err)) {
    return sanitizeDatabaseError(err, safeFallback);
  }
  return {
    code: 'INTERNAL_ERROR',
    message: safeFallback,
    statusCode: 500,
  };
}

function sanitizeLogControlChars(input: string): string {
  return input
    .replace(/[\r\n\t\x00-\x1F\x7F\u2028\u2029]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function sanitizeLogField(
  value: unknown,
  maxLen: number,
  kind: 'context' | 'operation' | 'resourceId'
): string | undefined {
  if (typeof value !== 'string') return undefined;
  const noControls = sanitizeLogControlChars(value);
  if (!noControls) return undefined;

  if (containsUnsafeInternalPattern(noControls)) {
    return kind === 'context' ? 'REDACTED_CONTEXT' : '[REDACTED]';
  }

  const redacted = redactSensitiveText(noControls);
  if (
    !redacted ||
    redacted.includes('[REDACTED') ||
    redacted.includes('[INTERNAL_PATH]') ||
    /[{}]/.test(redacted)
  ) {
    return kind === 'context' ? 'REDACTED_CONTEXT' : '[REDACTED]';
  }

  if (kind === 'operation') {
    const cleanOp = redacted.toUpperCase().replace(/[^A-Z0-9_:-]/g, '');
    if (!cleanOp) return undefined;
    return cleanOp.slice(0, maxLen);
  }

  if (kind === 'resourceId') {
    const cleanId = redacted.trim();
    if (!/^[A-Za-z0-9._:-]+$/.test(cleanId)) {
      return '[REDACTED_ID]';
    }
    return cleanId.slice(0, maxLen);
  }

  // kind === 'context'
  const cleanCtx = redacted.replace(/[^A-Za-z0-9 _/:.-]/g, '').replace(/\s{2,}/g, ' ').trim();
  if (!cleanCtx) return 'server_operation';
  return cleanCtx.slice(0, maxLen);
}

/**
 * Mencatat event diagnostik aman ke log server tanpa menyertakan password, token,
 * ciphertext, SQL mentah, stack trace, newline injection, atau request body sensitif.
 */
export function logSafeServerError(
  context: string,
  code: AllowedErrorCode | string,
  meta?: { operation?: string; resourceId?: string }
): void {
  const safeCode = toAllowedErrorCode(code);
  const safeContext = sanitizeLogField(context, MAX_LOG_CONTEXT_LENGTH, 'context') || 'server_operation';
  const safeOperation = sanitizeLogField(meta?.operation, MAX_LOG_OPERATION_LENGTH, 'operation');
  const safeResourceId = sanitizeLogField(meta?.resourceId, MAX_LOG_RESOURCE_ID_LENGTH, 'resourceId');

  const entry = {
    ts: new Date().toISOString(),
    context: safeContext,
    code: safeCode,
    ...(safeOperation ? { operation: safeOperation } : {}),
    ...(safeResourceId ? { resourceId: safeResourceId } : {}),
  };
  console.error('[Adi_Hotspot AuditLog]', JSON.stringify(entry));
}
