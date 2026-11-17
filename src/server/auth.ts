import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import session from 'express-session';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import express from 'express';
import { isDatabaseConfigured, query } from './db.js';
import { SafeOperationalError, logSafeServerError, sanitizeGenericServerError } from './errorSanitizer.js';

export const SESSION_COOKIE_NAME = 'adi_hotspot_sid';
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 jam
export const LOGIN_MAX_FAILED_ATTEMPTS = 5;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 menit
export const LOGIN_LOCKOUT_MS = 15 * 60 * 1000; // 15 menit cooldown sementara
export const MIN_SESSION_SECRET_LENGTH = 32;

const BCRYPT_HASH_REGEX = /^\$2[aby]\$(1[0-9]|2[0-9]|3[01])\$[./A-Za-z0-9]{53}$/;
const WEAK_SECRET_PATTERNS = new Set([
  'your_session_secret_here',
  'your_secret_here',
  'session_secret',
  'secret',
  'changeme',
  'default',
  'password',
  'admin',
  '12345678901234567890123456789012',
]);

declare module 'express-session' {
  interface SessionData {
    isAdmin?: boolean;
    adminUsername?: string;
    csrfToken?: string;
    authenticatedAt?: number;
    expiresAt?: number;
  }
}

export interface ValidAdminAuthConfig {
  configured: true;
  username: string;
  passwordHash: string;
  sessionSecret: string;
}

export interface InvalidAdminAuthConfig {
  configured: false;
  reason: string;
}

export type AdminAuthConfigStatus = ValidAdminAuthConfig | InvalidAdminAuthConfig;

function hasLowEntropy(secret: string): boolean {
  const lower = secret.trim().toLowerCase();
  if (WEAK_SECRET_PATTERNS.has(lower)) return true;
  // Tolak jika karakter unik terlalu sedikit (mis. "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
  const uniqueChars = new Set(secret.split('')).size;
  return uniqueChars < 8;
}

/**
 * Membaca dan memvalidasi konfigurasi autentikasi admin dari environment variables.
 * Tidak ada username, password, ataupun session secret default.
 */
export function getAdminAuthConfig(): AdminAuthConfigStatus {
  const rawUsername = typeof process.env.ADMIN_USERNAME === 'string' ? process.env.ADMIN_USERNAME.trim() : '';
  const rawHash = typeof process.env.ADMIN_PASSWORD_HASH === 'string' ? process.env.ADMIN_PASSWORD_HASH.trim() : '';
  const rawSecret = typeof process.env.SESSION_SECRET === 'string' ? process.env.SESSION_SECRET.trim() : '';

  if (!rawUsername) {
    return { configured: false, reason: 'ADMIN_USERNAME belum dikonfigurasi.' };
  }
  if (!rawHash || !BCRYPT_HASH_REGEX.test(rawHash)) {
    return { configured: false, reason: 'ADMIN_PASSWORD_HASH belum dikonfigurasi atau bukan hash bcrypt valid.' };
  }
  if (!rawSecret || rawSecret.length < MIN_SESSION_SECRET_LENGTH || hasLowEntropy(rawSecret)) {
    return {
      configured: false,
      reason: 'SESSION_SECRET belum dikonfigurasi atau terlalu lemah (minimal 32 karakter acak).',
    };
  }

  return {
    configured: true,
    username: rawUsername,
    passwordHash: rawHash,
    sessionSecret: rawSecret,
  };
}

export function hashSessionId(sid: string): string {
  return crypto.createHash('sha256').update(sid, 'utf8').digest('hex');
}

function constantTimeStringEqual(a: string, b: string): boolean {
  const h1 = crypto.createHash('sha256').update(a, 'utf8').digest();
  const h2 = crypto.createHash('sha256').update(b, 'utf8').digest();
  return crypto.timingSafeEqual(h1, h2);
}

function getCookieSecureOption(): boolean | 'auto' {
  const raw = (process.env.COOKIE_SECURE || 'auto').trim().toLowerCase();
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return 'auto';
}

function resolveSessionCookieOptions(req?: Request): express.CookieOptions {
  const securePref = getCookieSecureOption();
  const secure = securePref === 'auto' ? Boolean(req?.secure) : securePref;
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
  };
}

/**
 * Session store server-side berbasis PostgreSQL (menggantikan MemoryStore).
 * Menyimpan hash SHA-256 dari session ID pada tabel admin_sessions.
 */
export class PostgresSessionStore extends session.Store {
  private lastPruneAt = 0;

  private maybePruneExpired() {
    const now = Date.now();
    if (now - this.lastPruneAt < 5 * 60 * 1000) return;
    this.lastPruneAt = now;
    if (!isDatabaseConfigured()) return;
    query('DELETE FROM admin_sessions WHERE expires_at <= CURRENT_TIMESTAMP').catch(() => {
      // Abaikan error pembersihan periodik non-kritis
    });
  }

  override get(sid: string, callback: (err?: any, session?: session.SessionData | null) => void): void {
    if (!isDatabaseConfigured()) {
      return callback(null, null);
    }
    const sidHash = hashSessionId(sid);
    query<{ sess: session.SessionData; expires_at: string | Date }>(
      'SELECT sess, expires_at FROM admin_sessions WHERE sid_hash = $1 LIMIT 1',
      [sidHash]
    )
      .then((res) => {
        if (!res.rows || res.rows.length === 0) {
          return callback(null, null);
        }
        const row = res.rows[0];
        const expiresAtMs = new Date(row.expires_at).getTime();
        const sessExpiresAtMs = typeof row.sess?.expiresAt === 'number' ? row.sess.expiresAt : expiresAtMs;
        if (
          !Number.isFinite(expiresAtMs) ||
          expiresAtMs <= Date.now() ||
          !Number.isFinite(sessExpiresAtMs) ||
          sessExpiresAtMs <= Date.now()
        ) {
          query('DELETE FROM admin_sessions WHERE sid_hash = $1', [sidHash]).catch(() => {});
          return callback(null, null);
        }
        return callback(null, row.sess);
      })
      .catch((err) => callback(err));
  }

  override set(sid: string, sess: session.SessionData, callback?: (err?: any) => void): void {
    if (!isDatabaseConfigured()) {
      return callback?.(new SafeOperationalError('DB_NOT_CONFIGURED', 'Database PostgreSQL belum dikonfigurasi.', { statusCode: 503 }));
    }
    const sidHash = hashSessionId(sid);
    const expiresAtMs =
      typeof sess.expiresAt === 'number' && Number.isFinite(sess.expiresAt)
        ? sess.expiresAt
        : Date.now() + SESSION_TTL_MS;
    const expiresAtIso = new Date(expiresAtMs).toISOString();

    query(
      `
      INSERT INTO admin_sessions (sid_hash, sess, expires_at, updated_at)
      VALUES ($1, $2::jsonb, $3, CURRENT_TIMESTAMP)
      ON CONFLICT (sid_hash) DO UPDATE SET
        sess = EXCLUDED.sess,
        expires_at = EXCLUDED.expires_at,
        updated_at = CURRENT_TIMESTAMP
      `,
      [sidHash, JSON.stringify(sess), expiresAtIso]
    )
      .then(() => {
        this.maybePruneExpired();
        callback?.();
      })
      .catch((err) => callback?.(err));
  }

  override destroy(sid: string, callback?: (err?: any) => void): void {
    if (!isDatabaseConfigured()) {
      return callback?.();
    }
    const sidHash = hashSessionId(sid);
    query('DELETE FROM admin_sessions WHERE sid_hash = $1', [sidHash])
      .then(() => callback?.())
      .catch((err) => callback?.(err));
  }

  override touch(sid: string, _sess: session.SessionData, callback?: (err?: any) => void): void {
    if (!isDatabaseConfigured()) {
      return callback?.();
    }
    const sidHash = hashSessionId(sid);
    query('UPDATE admin_sessions SET updated_at = CURRENT_TIMESTAMP WHERE sid_hash = $1', [sidHash])
      .then(() => callback?.())
      .catch((err) => callback?.(err));
  }
}

const pgSessionStore = new PostgresSessionStore();
let cachedSessionMiddlewareKey = '';
let cachedSessionMiddleware: RequestHandler | null = null;

function getSessionMiddleware(): RequestHandler | null {
  const authCfg = getAdminAuthConfig();
  if (!authCfg.configured) {
    return null;
  }
  const cookieSecure = getCookieSecureOption();
  const cacheKey = `${authCfg.sessionSecret}:${String(cookieSecure)}`;
  if (!cachedSessionMiddleware || cachedSessionMiddlewareKey !== cacheKey) {
    cachedSessionMiddlewareKey = cacheKey;
    cachedSessionMiddleware = session({
      name: SESSION_COOKIE_NAME,
      secret: authCfg.sessionSecret,
      store: pgSessionStore,
      resave: false,
      saveUninitialized: false,
      rolling: false,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: cookieSecure,
        maxAge: SESSION_TTL_MS,
        path: '/',
      },
    });
  }
  return cachedSessionMiddleware;
}

/**
 * Middleware Express untuk memuat session admin dari PostgreSQL apabila SESSION_SECRET tersedia.
 * Tidak pernah menggunakan secret default jika SESSION_SECRET tidak dikonfigurasi.
 */
export function adminSessionMiddleware(req: Request, res: Response, next: NextFunction): void {
  const mw = getSessionMiddleware();
  if (!mw) {
    return next();
  }
  return mw(req, res, next);
}

export function isValidAdminSession(req: Request): boolean {
  const sess = req.session;
  if (!sess) return false;
  if (sess.isAdmin !== true) return false;
  if (typeof sess.adminUsername !== 'string' || sess.adminUsername.trim().length === 0) return false;
  if (typeof sess.csrfToken !== 'string' || sess.csrfToken.length < 32) return false;
  if (typeof sess.expiresAt !== 'number' || !Number.isFinite(sess.expiresAt) || sess.expiresAt <= Date.now()) {
    return false;
  }
  return true;
}

function getClientRateLimitKey(req: Request): string {
  const rawIp = (req.ip || req.socket?.remoteAddress || 'unknown').trim();
  const normalizedIp = rawIp.startsWith('::ffff:') ? rawIp.slice(7) : rawIp;
  const digest = crypto.createHash('sha256').update(normalizedIp, 'utf8').digest('hex').slice(0, 32);
  return `ip:${digest}`;
}

async function checkLoginRateLimit(rateKey: string): Promise<{ blocked: boolean; retryAfterSeconds: number }> {
  const res = await query<{
    attempt_count: number;
    window_started_at: string | Date;
    locked_until: string | Date | null;
  }>(
    'SELECT attempt_count, window_started_at, locked_until FROM admin_login_attempts WHERE rate_key = $1 LIMIT 1',
    [rateKey]
  );

  if (!res.rows || res.rows.length === 0) {
    return { blocked: false, retryAfterSeconds: 0 };
  }

  const row = res.rows[0];
  if (row.locked_until) {
    const lockedUntilMs = new Date(row.locked_until).getTime();
    if (Number.isFinite(lockedUntilMs) && lockedUntilMs > Date.now()) {
      const retryAfterSeconds = Math.max(1, Math.ceil((lockedUntilMs - Date.now()) / 1000));
      return { blocked: true, retryAfterSeconds };
    }
  }

  return { blocked: false, retryAfterSeconds: 0 };
}

async function recordFailedLoginAttempt(rateKey: string): Promise<{ locked: boolean; retryAfterSeconds: number }> {
  const res = await query<{
    attempt_count: number;
    window_started_at: string | Date;
    locked_until: string | Date | null;
  }>(
    'SELECT attempt_count, window_started_at, locked_until FROM admin_login_attempts WHERE rate_key = $1 LIMIT 1',
    [rateKey]
  );

  const now = Date.now();
  let nextCount = 1;
  let windowStartIso = new Date(now).toISOString();

  if (res.rows && res.rows.length > 0) {
    const row = res.rows[0];
    const prevWindowStart = new Date(row.window_started_at).getTime();
    const prevLockedUntil = row.locked_until ? new Date(row.locked_until).getTime() : 0;
    const withinWindow = Number.isFinite(prevWindowStart) && now - prevWindowStart <= LOGIN_WINDOW_MS;
    const cooldownExpired = prevLockedUntil > 0 && prevLockedUntil <= now;

    if (withinWindow && !cooldownExpired) {
      nextCount = Number(row.attempt_count || 0) + 1;
      windowStartIso = new Date(prevWindowStart).toISOString();
    }
  }

  const shouldLock = nextCount >= LOGIN_MAX_FAILED_ATTEMPTS;
  const lockedUntilIso = shouldLock ? new Date(now + LOGIN_LOCKOUT_MS).toISOString() : null;

  await query(
    `
    INSERT INTO admin_login_attempts (rate_key, attempt_count, window_started_at, locked_until, updated_at)
    VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
    ON CONFLICT (rate_key) DO UPDATE SET
      attempt_count = EXCLUDED.attempt_count,
      window_started_at = EXCLUDED.window_started_at,
      locked_until = EXCLUDED.locked_until,
      updated_at = CURRENT_TIMESTAMP
    `,
    [rateKey, nextCount, windowStartIso, lockedUntilIso]
  );

  return {
    locked: shouldLock,
    retryAfterSeconds: shouldLock ? Math.ceil(LOGIN_LOCKOUT_MS / 1000) : 0,
  };
}

async function clearLoginAttempts(rateKey: string): Promise<void> {
  await query('DELETE FROM admin_login_attempts WHERE rate_key = $1', [rateKey]);
}

const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function validateSameOriginHeader(req: Request): { ok: true; hasOriginOrReferer: boolean } | { ok: false; reason: string } {
  const secFetchSite = typeof req.headers['sec-fetch-site'] === 'string'
    ? req.headers['sec-fetch-site'].trim().toLowerCase()
    : '';
  if (secFetchSite === 'cross-site') {
    return { ok: false, reason: 'Permintaan lintas situs (cross-site) ditolak.' };
  }

  const requestHost = (req.get('host') || '').trim().toLowerCase();
  if (!requestHost) {
    return { ok: false, reason: 'Header Host tidak valid atau tidak ditemukan.' };
  }

  const rawOrigin = req.headers.origin;
  if (typeof rawOrigin === 'string') {
    const trimmedOrigin = rawOrigin.trim();
    if (!trimmedOrigin || trimmedOrigin.toLowerCase() === 'null') {
      return { ok: false, reason: 'Header Origin null atau kosong ditolak.' };
    }
    let parsedOrigin: URL;
    try {
      parsedOrigin = new URL(trimmedOrigin);
    } catch {
      return { ok: false, reason: 'Format header Origin tidak valid.' };
    }
    if (parsedOrigin.protocol !== 'http:' && parsedOrigin.protocol !== 'https:') {
      return { ok: false, reason: 'Protokol Origin tidak diizinkan.' };
    }
    if (parsedOrigin.host.toLowerCase() !== requestHost) {
      return { ok: false, reason: 'Origin tidak cocok dengan Host aplikasi.' };
    }
    if (req.secure && parsedOrigin.protocol !== 'https:') {
      return { ok: false, reason: 'Permintaan HTTPS mewajibkan Origin HTTPS.' };
    }
    return { ok: true, hasOriginOrReferer: true };
  }

  const rawReferer = req.headers.referer;
  if (typeof rawReferer === 'string' && rawReferer.trim() !== '') {
    let parsedReferer: URL;
    try {
      parsedReferer = new URL(rawReferer.trim());
    } catch {
      return { ok: false, reason: 'Format header Referer tidak valid.' };
    }
    if (parsedReferer.protocol !== 'http:' && parsedReferer.protocol !== 'https:') {
      return { ok: false, reason: 'Protokol Referer tidak diizinkan.' };
    }
    if (parsedReferer.host.toLowerCase() !== requestHost) {
      return { ok: false, reason: 'Referer tidak cocok dengan Host aplikasi.' };
    }
    if (req.secure && parsedReferer.protocol !== 'https:') {
      return { ok: false, reason: 'Permintaan HTTPS mewajibkan Referer HTTPS.' };
    }
    return { ok: true, hasOriginOrReferer: true };
  }

  return { ok: true, hasOriginOrReferer: false };
}

function validateLoginRequestCsrf(req: Request): boolean {
  const originCheck = validateSameOriginHeader(req);
  if (!originCheck.ok) return false;

  const contentType = (req.get('content-type') || '').toLowerCase();
  if (!contentType.includes('application/json')) {
    return false;
  }

  // Izinkan jika Origin/Referer valid sesuai Host, atau memiliki custom header eksplisit (blokir simple form CSRF)
  const hasCustomHeader = Boolean(req.get('x-requested-with') || req.get('x-csrf-protection'));
  return originCheck.hasOriginOrReferer || hasCustomHeader;
}

function validateAuthenticatedCsrf(req: Request): boolean {
  const originCheck = validateSameOriginHeader(req);
  if (!originCheck.ok) return false;

  const sessionCsrf = req.session?.csrfToken;
  const headerCsrfRaw = req.headers['x-csrf-token'];
  const headerCsrf = typeof headerCsrfRaw === 'string' ? headerCsrfRaw.trim() : '';

  if (!sessionCsrf || !headerCsrf) {
    return false;
  }
  return constantTimeStringEqual(headerCsrf, sessionCsrf);
}

/**
 * Middleware perlindungan autentikasi & CSRF terpusat untuk seluruh rute /api.
 * Pengecualian publik terbatas pada /api/health, /api/auth/session, /api/auth/login, dan /api/auth/logout.
 */
export function requireAdminAuth(req: Request, res: Response, next: NextFunction): void {
  const fullPath = req.originalUrl.split('?')[0];
  const relPath = req.path;

  // Header anti-cache untuk seluruh API operasional & auth
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');

  // Rute publik minimal (health check minimal & endpoint autentikasi)
  if (
    fullPath === '/api/health' ||
    relPath === '/health' ||
    fullPath === '/api/auth/session' ||
    relPath === '/auth/session' ||
    fullPath === '/api/auth/login' ||
    relPath === '/auth/login' ||
    fullPath === '/api/auth/logout' ||
    relPath === '/auth/logout'
  ) {
    return next();
  }

  if (!isValidAdminSession(req)) {
    logSafeServerError(`AUTH ${req.method} ${relPath}`, 'UNAUTHORIZED');
    res.status(401).json({
      success: false,
      errorCode: 'UNAUTHORIZED',
      message: 'Sesi admin tidak valid atau telah berakhir. Silakan login kembali.',
    });
    return;
  }

  if (STATE_CHANGING_METHODS.has(req.method.toUpperCase())) {
    if (!validateAuthenticatedCsrf(req)) {
      logSafeServerError(`CSRF ${req.method} ${relPath}`, 'FORBIDDEN');
      res.status(403).json({
        success: false,
        errorCode: 'FORBIDDEN',
        message: 'Validasi keamanan permintaan (CSRF/Origin) gagal. Muat ulang halaman dan coba lagi.',
      });
      return;
    }
  }

  next();
}

export function createAuthRouter(): express.Router {
  const authRouter = express.Router();

  // Health check minimal tanpa membocorkan host/user/nama database
  authRouter.get('/health', (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true });
  });

  // Pemeriksaan status session saat aplikasi dibuka
  authRouter.get('/auth/session', (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    const authCfg = getAdminAuthConfig();
    if (!authCfg.configured) {
      return res.json({
        success: true,
        authenticated: false,
        authConfigured: false,
        username: null,
      });
    }

    if (!isValidAdminSession(req)) {
      if (req.session && (req.session.isAdmin || req.session.expiresAt)) {
        req.session.destroy(() => {});
        res.clearCookie(SESSION_COOKIE_NAME, resolveSessionCookieOptions(req));
      }
      return res.json({
        success: true,
        authenticated: false,
        authConfigured: true,
        username: null,
      });
    }

    return res.json({
      success: true,
      authenticated: true,
      authConfigured: true,
      username: req.session.adminUsername,
      csrfToken: req.session.csrfToken,
      expiresAt: req.session.expiresAt,
    });
  });

  // Login admin tunggal
  authRouter.post('/auth/login', async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    try {
      if (!validateLoginRequestCsrf(req)) {
        logSafeServerError('POST /api/auth/login', 'FORBIDDEN');
        return res.status(403).json({
          success: false,
          errorCode: 'FORBIDDEN',
          message: 'Permintaan login ditolak oleh validasi Origin/CSRF.',
        });
      }

      const authCfg = getAdminAuthConfig();
      if (!authCfg.configured) {
        logSafeServerError('POST /api/auth/login', 'AUTH_NOT_CONFIGURED');
        return res.status(503).json({
          success: false,
          errorCode: 'AUTH_NOT_CONFIGURED',
          message: 'Autentikasi admin belum dikonfigurasi pada server (.env).',
        });
      }

      if (!isDatabaseConfigured()) {
        logSafeServerError('POST /api/auth/login', 'DB_NOT_CONFIGURED');
        return res.status(503).json({
          success: false,
          errorCode: 'DB_NOT_CONFIGURED',
          message: 'Database PostgreSQL belum siap untuk memproses sesi login.',
        });
      }

      const rateKey = getClientRateLimitKey(req);
      const rateCheck = await checkLoginRateLimit(rateKey);
      if (rateCheck.blocked) {
        res.setHeader('Retry-After', String(rateCheck.retryAfterSeconds));
        logSafeServerError('POST /api/auth/login', 'RATE_LIMITED');
        return res.status(429).json({
          success: false,
          errorCode: 'RATE_LIMITED',
          message: 'Terlalu banyak percobaan login yang gagal. Silakan tunggu beberapa menit sebelum mencoba lagi.',
        });
      }

      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const inputUsername = typeof body.username === 'string' ? body.username.trim() : '';
      const inputPassword = typeof body.password === 'string' ? body.password : '';

      if (!inputUsername || !inputPassword || inputUsername.length > 128 || inputPassword.length > 256) {
        return res.status(400).json({
          success: false,
          errorCode: 'VALIDATION_ERROR',
          message: 'Username dan password wajib diisi dengan format yang valid.',
        });
      }

      // Selalu jalankan perbandingan waktu-konstan untuk username & bcrypt.compare untuk mencegah user enumeration
      const usernameMatches = constantTimeStringEqual(inputUsername, authCfg.username);
      const passwordMatches = await bcrypt.compare(inputPassword, authCfg.passwordHash);

      if (!usernameMatches || !passwordMatches) {
        const failOutcome = await recordFailedLoginAttempt(rateKey);
        logSafeServerError('POST /api/auth/login', failOutcome.locked ? 'RATE_LIMITED' : 'AUTH_FAILED');
        if (failOutcome.locked) {
          res.setHeader('Retry-After', String(failOutcome.retryAfterSeconds));
          return res.status(429).json({
            success: false,
            errorCode: 'RATE_LIMITED',
            message: 'Terlalu banyak percobaan login yang gagal. Silakan tunggu beberapa menit sebelum mencoba lagi.',
          });
        }
        return res.status(401).json({
          success: false,
          errorCode: 'AUTH_FAILED',
          message: 'Username atau password tidak valid.',
        });
      }

      // Login berhasil -> bersihkan catatan percobaan gagal & regenerasi session ID baru
      await clearLoginAttempts(rateKey);

      if (!req.session) {
        throw new SafeOperationalError('INTERNAL_ERROR', 'Session middleware tidak tersedia.', { statusCode: 500 });
      }

      await new Promise<void>((resolve, reject) => {
        req.session.regenerate((err) => {
          if (err) return reject(err);
          resolve();
        });
      });

      const csrfToken = crypto.randomBytes(32).toString('hex');
      const now = Date.now();
      const expiresAt = now + SESSION_TTL_MS;

      req.session.isAdmin = true;
      req.session.adminUsername = authCfg.username;
      req.session.csrfToken = csrfToken;
      req.session.authenticatedAt = now;
      req.session.expiresAt = expiresAt;

      await new Promise<void>((resolve, reject) => {
        req.session.save((err) => {
          if (err) return reject(err);
          resolve();
        });
      });

      return res.json({
        success: true,
        authenticated: true,
        username: authCfg.username,
        csrfToken,
        expiresAt,
      });
    } catch (error: any) {
      const safe = sanitizeGenericServerError(error, 'Gagal memproses autentikasi admin.');
      logSafeServerError('POST /api/auth/login', safe.code);
      return res.status(safe.statusCode).json({
        success: false,
        errorCode: safe.code,
        message: safe.message,
      });
    }
  });

  // Logout admin -> hapus session server-side di PostgreSQL & bersihkan cookie
  authRouter.post('/auth/logout', async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    try {
      const originCheck = validateSameOriginHeader(req);
      if (!originCheck.ok) {
        logSafeServerError('POST /api/auth/logout', 'FORBIDDEN');
        return res.status(403).json({
          success: false,
          errorCode: 'FORBIDDEN',
          message: 'Permintaan logout ditolak oleh validasi Origin/Host.',
        });
      }

      if (isValidAdminSession(req) && !validateAuthenticatedCsrf(req)) {
        logSafeServerError('POST /api/auth/logout', 'FORBIDDEN');
        return res.status(403).json({
          success: false,
          errorCode: 'FORBIDDEN',
          message: 'Token keamanan CSRF tidak valid untuk proses logout.',
        });
      }

      if (req.session) {
        await new Promise<void>((resolve) => {
          req.session.destroy(() => resolve());
        });
      }

      res.clearCookie(SESSION_COOKIE_NAME, resolveSessionCookieOptions(req));
      return res.json({
        success: true,
        authenticated: false,
        message: 'Anda telah keluar dari sesi admin.',
      });
    } catch (error: any) {
      const safe = sanitizeGenericServerError(error, 'Gagal mengakhiri sesi admin.');
      logSafeServerError('POST /api/auth/logout', safe.code);
      return res.status(safe.statusCode).json({
        success: false,
        errorCode: safe.code,
        message: safe.message,
      });
    }
  });

  return authRouter;
}
