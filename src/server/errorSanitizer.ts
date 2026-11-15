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

export const FATAL_ERROR_CODES = new Set<AllowedErrorCode>(['ROUTEROS_FATAL']);

const MAX_SAFE_MESSAGE_LENGTH = 320;
const MAX_LOG_CONTEXT_LENGTH = 80;
const MAX_LOG_OPERATION_LENGTH = 24;
const MAX_LOG_RESOURCE_ID_LENGTH = 64;

export const MAX_SYNC_META_V1_B64_LENGTH = 2000;
export const MAX_SYNC_META_V1_DECODED_BYTES = 1536;
export const MAX_SYNC_META_V1_OLD_ACCOUNTS = 10;
export const MAX_SYNC_META_V1_USERNAME_LENGTH = 64;

const ALLOWED_SYNC_META_TOP_KEYS = new Set([
  'v',
  'needsSessionDisconnect',
  'oldAccounts',
  'corrupted',
  'stages',
]);
const ALLOWED_SYNC_META_ACCOUNT_KEYS = new Set(['type', 'username']);
const ALLOWED_SYNC_META_STAGE_KEYS = new Set([
  'accountProvisioned',
  'accountVerified',
  'oldAccountsPending',
  'sessionDisconnectPending',
]);

const KNOWN_TLS_ERROR_CODES = new Set([
  'TLS_ERROR',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'CERT_NOT_YET_VALID',
  'CERT_HAS_EXPIRED',
  'CERT_REVOKED',
  'CERT_CHAIN_TOO_LONG',
  'CERT_UNTRUSTED',
  'CERT_REJECTED',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'INVALID_PURPOSE',
]);

const UNIFIED_SENSITIVE_KEY_PATTERNS = [
  'mikrotik[_-]?encryption[_-]?keys?',
  'encryption[_-]?keys?',
  'db[_-]?passwords?',
  'access[_-]?tokens?',
  'refresh[_-]?tokens?',
  'auth[_-]?tokens?',
  'id[_-]?tokens?',
  'authorization',
  'client[_-]?secrets?',
  'secret[_-]?keys?',
  'private[_-]?keys?',
  'api[_-]?keys?',
  'credentials?',
  'passphrase',
  'passwords?',
  'passwd',
  'secrets?',
  'tokens?',
  'pwd',
] as const;

const SENSITIVE_KEY_ALT = UNIFIED_SENSITIVE_KEY_PATTERNS.join('|');
const SENSITIVE_PROP_BOUNDARY_REGEX = new RegExp(`(?:^|[_-])(${SENSITIVE_KEY_ALT})(?:$|[_-])`, 'i');
const SENSITIVE_META_VALUE_KV_REGEX = new RegExp(`\\b(${SENSITIVE_KEY_ALT})\\b["']?\\s*[=:]`, 'i');
const SENSITIVE_META_VALUE_KEYWORD_REGEX = /\b(mikrotik[_-]?encryption[_-]?keys?|db[_-]?passwords?)\b/i;

const SYNC_META_V1_SPLIT_REGEX = /(\[SYNC_META_V1:[^\]]*\])/g;
const SYNC_META_V1_CAPTURE_REGEX = /^\[SYNC_META_V1:([^\]]*)\]$/;

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
    `\\b(${SENSITIVE_KEY_ALT})\\b\\s*([=:])\\s*(?!Bearer\\s+\\[REDACTED\\]|\\[REDACTED(?:_CREDENTIAL)?\\])([^\\s,&;)}\\]'"]+)`,
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

export interface ValidatedSyncMetaOldAccount {
  type: 'pppoe' | 'hotspot';
  username: string;
}

export interface ValidatedSyncMetaStages {
  accountProvisioned?: boolean;
  accountVerified?: boolean;
  oldAccountsPending?: number;
  sessionDisconnectPending?: boolean;
}

export interface ValidatedSyncMetaPayloadV1 {
  v: 1;
  needsSessionDisconnect: boolean;
  oldAccounts: ValidatedSyncMetaOldAccount[];
  corrupted?: boolean;
  stages?: ValidatedSyncMetaStages;
}

const MAX_SYNC_META_V1_RECURSION_DEPTH = 6;
const MAX_SYNC_META_V1_TOTAL_NODES = 120;

function isSensitiveMetaPropertyName(key: string): boolean {
  if (SENSITIVE_PROP_BOUNDARY_REGEX.test(key)) {
    return true;
  }
  const normalizedSnake = key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2');
  return SENSITIVE_PROP_BOUNDARY_REGEX.test(normalizedSnake);
}

function containsCredentialInMetaValue(raw: string): boolean {
  if (/enc:v1:/i.test(raw)) return true;
  if (/postgres(?:ql)?:\/\//i.test(raw)) return true;
  if (/\bBearer\s+\S+/i.test(raw)) return true;
  if (SENSITIVE_META_VALUE_KV_REGEX.test(raw)) return true;
  if (SENSITIVE_META_VALUE_KEYWORD_REGEX.test(raw)) return true;
  for (const secret of getActiveEnvSecrets()) {
    if (raw.includes(secret)) return true;
  }
  return false;
}

function decodeStrictUtf8(buf: Buffer): string | null {
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const decoded = decoder.decode(buf);
    if (!Buffer.from(decoded, 'utf8').equals(buf)) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

function inspectDecodedMetaSecurity(root: unknown): { safe: true } | { safe: false; reason: string } {
  let visitedNodes = 0;

  const walk = (node: unknown, depth: number): { safe: true } | { safe: false; reason: string } => {
    if (depth > MAX_SYNC_META_V1_RECURSION_DEPTH) {
      return { safe: false, reason: 'Kedalaman struktur JSON penanda [SYNC_META_V1] melebihi batas aman.' };
    }
    visitedNodes++;
    if (visitedNodes > MAX_SYNC_META_V1_TOTAL_NODES) {
      return { safe: false, reason: 'Jumlah elemen pada penanda [SYNC_META_V1] melebihi batas aman.' };
    }

    if (typeof node === 'string') {
      if (/[\x00-\x1F\x7F\u2028\u2029]/.test(node)) {
        return { safe: false, reason: 'Penanda [SYNC_META_V1] mengandung karakter kontrol terlarang.' };
      }
      if (containsCredentialInMetaValue(node)) {
        return { safe: false, reason: 'Penanda [SYNC_META_V1] mengandung pola kredensial terlarang.' };
      }
      return { safe: true };
    }

    if (node === null || typeof node === 'number' || typeof node === 'boolean') {
      return { safe: true };
    }

    if (Array.isArray(node)) {
      for (const item of node) {
        const res = walk(item, depth + 1);
        if (!res.safe) return res;
      }
      return { safe: true };
    }

    if (typeof node === 'object') {
      for (const key of Object.keys(node as Record<string, unknown>)) {
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
          return { safe: false, reason: 'Penanda [SYNC_META_V1] mengandung properti prototipe terlarang.' };
        }
        if (isSensitiveMetaPropertyName(key)) {
          return { safe: false, reason: 'Penanda [SYNC_META_V1] mengandung nama properti sensitif terlarang.' };
        }
        const res = walk((node as Record<string, unknown>)[key], depth + 1);
        if (!res.safe) return res;
      }
      return { safe: true };
    }

    return { safe: false, reason: 'Tipe nilai pada penanda [SYNC_META_V1] tidak valid.' };
  };

  return walk(root, 0);
}

/**
 * Validasi ketat struktur, ukuran, Base64URL, UTF-8 ketat, properti yang diizinkan,
 * dan kebersihan kredensial rekursif pada payload [SYNC_META_V1:<rawB64>].
 */
export function parseSyncMetaV1Payload(
  rawB64: unknown
): { valid: true; payload: ValidatedSyncMetaPayloadV1 } | { valid: false; reason: string } {
  if (typeof rawB64 !== 'string') {
    return { valid: false, reason: 'Payload penanda [SYNC_META_V1] harus berupa string.' };
  }
  const trimmed = rawB64.trim();
  if (!trimmed || trimmed.length > MAX_SYNC_META_V1_B64_LENGTH) {
    return { valid: false, reason: 'Ukuran penanda [SYNC_META_V1] kosong atau melebihi batas aman.' };
  }
  if (!/^[A-Za-z0-9_-]+$/.test(trimmed)) {
    return { valid: false, reason: 'Payload Base64URL pada penanda [SYNC_META_V1] tidak valid.' };
  }

  let buf: Buffer;
  try {
    buf = Buffer.from(trimmed, 'base64url');
  } catch {
    return { valid: false, reason: 'Gagal mendekode Base64URL penanda [SYNC_META_V1].' };
  }

  if (buf.length === 0 || buf.length > MAX_SYNC_META_V1_DECODED_BYTES || buf.toString('base64url') !== trimmed) {
    return { valid: false, reason: 'Encoding Base64URL atau ukuran terdekode [SYNC_META_V1] tidak valid.' };
  }

  const jsonStr = decodeStrictUtf8(buf);
  if (jsonStr === null) {
    return { valid: false, reason: 'Byte UTF-8 pada penanda [SYNC_META_V1] tidak valid.' };
  }
  if (/[\x00-\x1F\x7F\u2028\u2029]/.test(jsonStr)) {
    return { valid: false, reason: 'Penanda [SYNC_META_V1] mengandung karakter kontrol terlarang.' };
  }

  let parsed: any;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return { valid: false, reason: 'Gagal membaca JSON dari penanda [SYNC_META_V1].' };
  }

  const securityCheck = inspectDecodedMetaSecurity(parsed);
  if (!securityCheck.safe) {
    return { valid: false, reason: securityCheck.reason };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { valid: false, reason: 'Struktur JSON penanda [SYNC_META_V1] bukan objek.' };
  }

  for (const key of Object.keys(parsed)) {
    if (!ALLOWED_SYNC_META_TOP_KEYS.has(key)) {
      return { valid: false, reason: 'Penanda [SYNC_META_V1] mengandung properti asing yang ditolak.' };
    }
  }

  if (parsed.v !== 1 || typeof parsed.needsSessionDisconnect !== 'boolean' || !Array.isArray(parsed.oldAccounts)) {
    return { valid: false, reason: 'Struktur JSON penanda [SYNC_META_V1] tidak valid atau versi tidak dikenali.' };
  }

  if (parsed.corrupted !== undefined && typeof parsed.corrupted !== 'boolean') {
    return { valid: false, reason: 'Nilai properti corrupted pada [SYNC_META_V1] tidak valid.' };
  }

  if (parsed.oldAccounts.length > MAX_SYNC_META_V1_OLD_ACCOUNTS) {
    return { valid: false, reason: 'Jumlah oldAccounts pada penanda [SYNC_META_V1] melebihi batas aman.' };
  }

  const cleanOldAccounts: ValidatedSyncMetaOldAccount[] = [];
  for (const item of parsed.oldAccounts) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return { valid: false, reason: 'Entri akun lama pada penanda [SYNC_META_V1] rusak.' };
    }
    const itemKeys = Object.keys(item);
    if (itemKeys.length !== 2 || !itemKeys.every((k) => ALLOWED_SYNC_META_ACCOUNT_KEYS.has(k))) {
      return { valid: false, reason: 'Entri akun lama pada [SYNC_META_V1] memiliki properti tidak sah.' };
    }
    if (item.type !== 'pppoe' && item.type !== 'hotspot') {
      return { valid: false, reason: 'Jenis akun lama pada [SYNC_META_V1] tidak dikenali.' };
    }
    if (typeof item.username !== 'string' || /[\x00-\x1F\x7F\u2028\u2029]/.test(item.username)) {
      return { valid: false, reason: 'Username akun lama pada [SYNC_META_V1] tidak valid.' };
    }
    const cleanUser = item.username.trim();
    if (cleanUser.length < 1 || cleanUser.length > MAX_SYNC_META_V1_USERNAME_LENGTH) {
      return { valid: false, reason: 'Panjang username pada penanda [SYNC_META_V1] melanggar batas.' };
    }
    if (containsCredentialInMetaValue(cleanUser)) {
      return { valid: false, reason: 'Username pada [SYNC_META_V1] mengandung pola kredensial terlarang.' };
    }
    cleanOldAccounts.push({ type: item.type, username: cleanUser });
  }

  let cleanStages: ValidatedSyncMetaStages | undefined;
  if (parsed.stages !== undefined) {
    if (!parsed.stages || typeof parsed.stages !== 'object' || Array.isArray(parsed.stages)) {
      return { valid: false, reason: 'Properti stages pada [SYNC_META_V1] tidak valid.' };
    }
    for (const sKey of Object.keys(parsed.stages)) {
      if (!ALLOWED_SYNC_META_STAGE_KEYS.has(sKey)) {
        return { valid: false, reason: 'Properti stages pada [SYNC_META_V1] mengandung field asing.' };
      }
    }
    const st = parsed.stages;
    if (st.accountProvisioned !== undefined && typeof st.accountProvisioned !== 'boolean') {
      return { valid: false, reason: 'Field accountProvisioned pada stages tidak valid.' };
    }
    if (st.accountVerified !== undefined && typeof st.accountVerified !== 'boolean') {
      return { valid: false, reason: 'Field accountVerified pada stages tidak valid.' };
    }
    if (st.sessionDisconnectPending !== undefined && typeof st.sessionDisconnectPending !== 'boolean') {
      return { valid: false, reason: 'Field sessionDisconnectPending pada stages tidak valid.' };
    }
    if (
      st.oldAccountsPending !== undefined &&
      (typeof st.oldAccountsPending !== 'number' ||
        !Number.isInteger(st.oldAccountsPending) ||
        st.oldAccountsPending < 0 ||
        st.oldAccountsPending > MAX_SYNC_META_V1_OLD_ACCOUNTS)
    ) {
      return { valid: false, reason: 'Field oldAccountsPending pada stages tidak valid.' };
    }
    cleanStages = {
      ...(st.accountProvisioned !== undefined ? { accountProvisioned: st.accountProvisioned } : {}),
      ...(st.accountVerified !== undefined ? { accountVerified: st.accountVerified } : {}),
      ...(st.oldAccountsPending !== undefined ? { oldAccountsPending: st.oldAccountsPending } : {}),
      ...(st.sessionDisconnectPending !== undefined
        ? { sessionDisconnectPending: st.sessionDisconnectPending }
        : {}),
    };
  }

  return {
    valid: true,
    payload: {
      v: 1,
      needsSessionDisconnect: parsed.needsSessionDisconnect,
      oldAccounts: cleanOldAccounts,
      ...(parsed.corrupted !== undefined ? { corrupted: parsed.corrupted } : {}),
      ...(cleanStages ? { stages: cleanStages } : {}),
    },
  };
}

/**
 * Membersihkan teks dari potensi kebocoran kredensial, ciphertext, URI DB, atau stack trace.
 * Tetap mempertahankan penanda terstruktur [SYNC_META_V1:...] yang valid secara skema & ukuran.
 */
export function redactSensitiveText(input: unknown): string {
  if (typeof input !== 'string') return '';
  if (!input.trim()) return '';

  const parts = input.split(SYNC_META_V1_SPLIT_REGEX);
  const cleanedParts = parts.map((part) => {
    if (!part) return '';
    const markerMatch = part.match(SYNC_META_V1_CAPTURE_REGEX);
    if (markerMatch) {
      const check = parseSyncMetaV1Payload(markerMatch[1]);
      return check.valid ? part : '[INVALID_SYNC_META]';
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

    this.isFatal = FATAL_ERROR_CODES.has(validatedCode);
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
    const validatedCode = toAllowedErrorCode(err.code);
    return FATAL_ERROR_CODES.has(validatedCode) && err.isFatal === true;
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
 * Hanya mempercayai err.code (bukan teks err.message yang tidak tepercaya).
 * Kode non-socket (DB/SQLSTATE/aplikasi/RouterOS) tidak pernah dianggap kode socket.
 */
export function sanitizeSocketErrorCode(err: any): AllowedSocketErrorCode {
  const rawCode = typeof err?.code === 'string' ? err.code.trim().toUpperCase() : '';
  if (!rawCode) {
    return 'NETWORK_ERROR';
  }
  if (ALLOWED_SOCKET_CODE_SET.has(rawCode)) {
    return rawCode as AllowedSocketErrorCode;
  }
  if (rawCode === 'ECONNABORTED') {
    return 'ECONNRESET';
  }
  if (
    KNOWN_TLS_ERROR_CODES.has(rawCode) ||
    rawCode.startsWith('ERR_TLS_') ||
    rawCode.startsWith('ERR_SSL_')
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
      isFatal: FATAL_ERROR_CODES.has(safeCode) && err.isFatal === true,
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
