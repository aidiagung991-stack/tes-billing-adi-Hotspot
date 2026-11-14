import { randomUUID } from 'node:crypto';
import { Router, Request, Response } from 'express';
import { query, withTransaction, checkDatabaseHealth, isDatabaseConfigured } from './db.js';
import {
  encryptMikrotikPassword,
  decryptMikrotikPassword,
  isMikrotikEncryptionKeyConfigured,
  validateCustomerPassword,
} from './cryptoUtils.js';
import {
  testMikrotikConnection,
  validateRouterHost,
  validateRouterPort,
  checkProfileExists,
  createOrUpdatePppoeSecret,
  disconnectPppoeSession,
  togglePppoeSecret,
  createOrUpdateHotspotUser,
  disconnectHotspotSession,
  toggleHotspotUser,
  verifyPppoeSecretExists,
  verifyHotspotUserExists,
  cleanupOldRouterAccount,
  MikrotikConnectionOptions,
} from './mikrotikService.js';

interface PendingRouterAccount {
  type: 'pppoe' | 'hotspot';
  username: string;
}

interface PendingSyncStages {
  accountProvisioned?: boolean;
  accountVerified?: boolean;
  oldAccountsPending?: number;
  sessionDisconnectPending?: boolean;
}

interface PendingSyncPayloadV1 {
  v: 1;
  needsSessionDisconnect: boolean;
  oldAccounts: PendingRouterAccount[];
  corrupted?: boolean;
  stages?: PendingSyncStages;
}

interface PendingSyncActions {
  needsSessionDisconnect: boolean;
  oldAccounts: PendingRouterAccount[];
  corrupted: boolean;
  corruptedReason?: string;
  stages?: PendingSyncStages;
}

function validateSafeCustomerUsername(username: string): { valid: boolean; clean: string; message?: string } {
  const clean = typeof username === 'string' ? username.trim() : '';
  if (clean.length < 3 || clean.length > 64) {
    return {
      valid: false,
      clean,
      message: 'Username harus terdiri dari 3 hingga 64 karakter.',
    };
  }
  if (/[\x00-\x20\x7F]/.test(clean)) {
    return {
      valid: false,
      clean,
      message: 'Username tidak boleh mengandung spasi, karakter kontrol, atau null byte.',
    };
  }
  return { valid: true, clean };
}

function stripPendingMarkersFromMessage(message: string): string {
  return message
    .replace(/\s*\[SYNC_META_V1:[^\]]*\]/g, '')
    .replace(/\s*\[Perlu ulang pemutusan sesi\]/gi, '')
    .replace(/\s*\[Perlu pembersihan akun lama:[^\]]*\]/gi, '')
    .trim();
}

function parsePendingSyncActions(lastSyncStatus?: string | null, lastSyncMessage?: string | null): PendingSyncActions {
  if (lastSyncStatus === 'synced') {
    return { needsSessionDisconnect: false, oldAccounts: [], corrupted: false };
  }
  const msg = lastSyncMessage || '';
  let needsSessionDisconnect = false;
  let corrupted = false;
  let corruptedReason: string | undefined;
  let stages: PendingSyncStages | undefined;
  const oldAccounts: PendingRouterAccount[] = [];
  const seen = new Set<string>();

  const addOldAcc = (type: 'pppoe' | 'hotspot', username: string) => {
    const cleanUser = username.trim();
    if (!cleanUser) return;
    const key = `${type}:${cleanUser}`;
    if (!seen.has(key)) {
      seen.add(key);
      oldAccounts.push({ type, username: cleanUser });
    }
  };

  // 1. Parse format terstruktur ber-versi [SYNC_META_V1:<base64url>]
  const v1Matches = [...msg.matchAll(/\[SYNC_META_V1:([^\]]*)\]/g)];
  const hasV1Prefix = /\[SYNC_META_V/i.test(msg);

  if (hasV1Prefix && v1Matches.length === 0) {
    corrupted = true;
    corruptedReason = 'Penanda sinkronisasi [SYNC_META_V1] terpotong atau tidak lengkap.';
  }

  for (const match of v1Matches) {
    const rawB64 = (match[1] || '').trim();
    if (!rawB64 || !/^[A-Za-z0-9_-]+$/.test(rawB64)) {
      corrupted = true;
      corruptedReason = 'Payload Base64URL pada penanda [SYNC_META_V1] tidak valid.';
      continue;
    }
    try {
      const jsonStr = Buffer.from(rawB64, 'base64url').toString('utf8');
      const parsed = JSON.parse(jsonStr);
      if (
        !parsed ||
        typeof parsed !== 'object' ||
        Array.isArray(parsed) ||
        parsed.v !== 1 ||
        typeof parsed.needsSessionDisconnect !== 'boolean' ||
        !Array.isArray(parsed.oldAccounts)
      ) {
        corrupted = true;
        corruptedReason = 'Struktur JSON penanda [SYNC_META_V1] tidak valid atau versi tidak dikenali.';
        continue;
      }
      if (parsed.corrupted === true) {
        corrupted = true;
        corruptedReason = 'Status kegagalan sebelumnya menandai penanda sinkronisasi rusak dan butuh pemeriksaan manual.';
      }
      if (parsed.needsSessionDisconnect) {
        needsSessionDisconnect = true;
      }
      if (parsed.stages && typeof parsed.stages === 'object') {
        stages = { ...stages, ...parsed.stages };
      }
      for (const item of parsed.oldAccounts) {
        if (
          !item ||
          typeof item !== 'object' ||
          (item.type !== 'pppoe' && item.type !== 'hotspot') ||
          typeof item.username !== 'string' ||
          !item.username.trim()
        ) {
          corrupted = true;
          corruptedReason = 'Entri akun lama pada penanda [SYNC_META_V1] rusak.';
          continue;
        }
        addOldAcc(item.type, item.username);
      }
    } catch {
      corrupted = true;
      corruptedReason = 'Gagal membaca JSON dari penanda [SYNC_META_V1].';
    }
  }

  // 2. Kompatibilitas mundur dengan penanda versi lama & deteksi kerusakan teks
  const hasValidV1 = v1Matches.length > 0 && !corrupted;
  if (
    msg.includes('[Perlu ulang pemutusan sesi]') ||
    (!hasValidV1 && /(?<!akun lama )pemutusan sesi aktif(?! akun lama).*gagal|sesi aktif gagal diputus/i.test(msg))
  ) {
    needsSessionDisconnect = true;
  }

  const hasLegacyCleanupStart = /\[Perlu pembersihan akun lama:/i.test(msg);
  const legacyMatches = [...msg.matchAll(/\[Perlu pembersihan akun lama:\s*([^\]]*)\]/gi)];
  if (hasLegacyCleanupStart && legacyMatches.length === 0) {
    corrupted = true;
    corruptedReason = 'Penanda lama [Perlu pembersihan akun lama] terpotong.';
  }
  for (const blockMatch of legacyMatches) {
    const entries = blockMatch[1].split(',');
    for (const rawEntry of entries) {
      const m = rawEntry.trim().match(/^(pppoe|hotspot):(.+)$/i);
      if (m && m[2].trim()) {
        addOldAcc(m[1].toLowerCase() as 'pppoe' | 'hotspot', m[2].trim());
      } else if (rawEntry.trim()) {
        corrupted = true;
        corruptedReason = 'Entri penanda lama tidak dapat dibaca.';
      }
    }
  }

  if (corrupted) {
    needsSessionDisconnect = true;
  }

  return { needsSessionDisconnect, oldAccounts, corrupted, corruptedReason, stages };
}

function mergeOldAccounts(
  lists: PendingRouterAccount[][],
  excludeCurrent?: PendingRouterAccount
): PendingRouterAccount[] {
  const result: PendingRouterAccount[] = [];
  const seen = new Set<string>();
  const excludeKey = excludeCurrent
    ? `${excludeCurrent.type}:${excludeCurrent.username.trim()}`
    : null;

  for (const list of lists) {
    for (const item of list) {
      const cleanUser = item.username.trim();
      if (!cleanUser) continue;
      const key = `${item.type}:${cleanUser}`;
      if (excludeKey && key === excludeKey) continue;
      if (!seen.has(key)) {
        seen.add(key);
        result.push({ type: item.type, username: cleanUser });
      }
    }
  }
  return result;
}

function appendPendingMarkers(
  baseMessage: string,
  pending: {
    needsSessionDisconnect: boolean;
    oldAccounts: PendingRouterAccount[];
    corrupted?: boolean;
    stages?: PendingSyncStages;
  }
): string {
  const cleanBase = stripPendingMarkersFromMessage(baseMessage);
  if (!pending.corrupted && !pending.needsSessionDisconnect && pending.oldAccounts.length === 0) {
    return cleanBase;
  }

  const payload: PendingSyncPayloadV1 = {
    v: 1,
    needsSessionDisconnect: Boolean(pending.needsSessionDisconnect || pending.corrupted),
    oldAccounts: pending.oldAccounts,
    ...(pending.corrupted ? { corrupted: true } : {}),
    ...(pending.stages ? { stages: pending.stages } : {}),
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${cleanBase} [SYNC_META_V1:${encoded}]`;
}

const router = Router();

// ============================================================================
// 0. HELPER IDENTIFIKASI SCHEMA MIKROTIK (MIGRATION 003) & KREDENSIAL ROUTER
// ============================================================================
let schemaMigration003Checked = false;
let hasCustomerMikrotikFields = false;
let hasPackageMikrotikFields = false;

async function detectMigration003Fields(): Promise<{ customers: boolean; packages: boolean }> {
  if (schemaMigration003Checked && hasCustomerMikrotikFields && hasPackageMikrotikFields) {
    return { customers: true, packages: true };
  }
  try {
    const custCols = await query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'customers' AND column_name = 'password_encrypted'`
    );
    hasCustomerMikrotikFields = custCols.rows.length > 0;

    const pkgCols = await query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'packages' AND column_name = 'pppoe_profile'`
    );
    hasPackageMikrotikFields = pkgCols.rows.length > 0;
    schemaMigration003Checked = true;
  } catch {
    hasCustomerMikrotikFields = false;
    hasPackageMikrotikFields = false;
  }
  return { customers: hasCustomerMikrotikFields, packages: hasPackageMikrotikFields };
}

/**
 * Mengambil kredensial router aktif dari tabel mikrotik_settings secara aman
 * Mendekripsi password router menggunakan MIKROTIK_ENCRYPTION_KEY
 */
async function getActiveRouterOptions(): Promise<MikrotikConnectionOptions | null> {
  try {
    const res = await query(
      `SELECT host, api_port, username, password_encrypted, password_hash, use_ssl, timeout_seconds
       FROM mikrotik_settings WHERE id = 'default' LIMIT 1`
    );
    if (!res.rows || res.rows.length === 0) return null;
    const row = res.rows[0];
    const encryptedPassword = row.password_encrypted || row.password_hash;
    if (!encryptedPassword) return null;
    if (!isMikrotikEncryptionKeyConfigured()) return null;

    const rawPassword = decryptMikrotikPassword(encryptedPassword);
    const useSsl = Boolean(row.use_ssl);
    return {
      host: validateRouterHost(row.host || '192.168.88.1'),
      port: validateRouterPort(row.api_port ?? (useSsl ? 8729 : 8728)),
      username: (row.username || 'admin').trim(),
      password: rawPassword,
      useSsl,
      timeoutSeconds: Math.max(3, Math.min(30, Number(row.timeout_seconds) || 10)),
    };
  } catch {
    return null;
  }
}

// ============================================================================
// 1. HEALTHCHECK & DATABASE STATUS
// ============================================================================
router.get('/status', async (_req: Request, res: Response) => {
  try {
    const health = await checkDatabaseHealth();
    res.json({
      success: true,
      ...health,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      isConnected: false,
      error: error?.message || 'Database connection error',
    });
  }
});

// Middleware guard: Jika database belum dikonfigurasi di server ini,
// jangan jalankan query dan kembalikan respon aman agar tidak menimbulkan query error di console.
router.use((req, res, next) => {
  if (!isDatabaseConfigured()) {
    return res.json({
      success: false,
      notConfigured: true,
      data: [],
      message: 'Database PostgreSQL belum dikonfigurasi (.env DB_PASSWORD kosong).',
    });
  }
  next();
});

// ============================================================================
// 2. PAKET INTERNET (CRUD) - DILENGKAPI MAPPING PROFILE PPPoE & HOTSPOT
// ============================================================================
router.get('/packages', async (_req: Request, res: Response) => {
  try {
    const schema = await detectMigration003Fields();
    const profileSelect = schema.packages
      ? 'pppoe_profile AS "pppoeProfile", hotspot_profile AS "hotspotProfile",'
      : 'NULL AS "pppoeProfile", NULL AS "hotspotProfile",';

    const result = await query(`
      SELECT 
        id, 
        code, 
        name, 
        speed, 
        download_speed AS "downloadSpeed", 
        upload_speed AS "uploadSpeed", 
        price::float AS price, 
        duration, 
        type, 
        supported_connection AS "supportedConnection", 
        ${profileSelect}
        status, 
        active_users_count AS "activeUsersCount", 
        description,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM packages 
      ORDER BY price ASC, name ASC
    `);
    res.json({ success: true, data: result.rows });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Gagal mengambil data paket dari PostgreSQL: ' + error.message });
  }
});

router.post('/packages', async (req: Request, res: Response) => {
  try {
    const p = req.body;
    if (!p.id || !p.name || p.price === undefined) {
      return res.status(400).json({ success: false, message: 'Field id, nama paket, dan tarif harga wajib diisi.' });
    }

    const schema = await detectMigration003Fields();
    let result;

    if (schema.packages) {
      result = await query(
        `
        INSERT INTO packages (
          id, code, name, speed, download_speed, upload_speed, price, duration,
          type, supported_connection, pppoe_profile, hotspot_profile, status, active_users_count, description
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        ON CONFLICT (id) DO UPDATE SET
          code = EXCLUDED.code,
          name = EXCLUDED.name,
          speed = EXCLUDED.speed,
          download_speed = EXCLUDED.download_speed,
          upload_speed = EXCLUDED.upload_speed,
          price = EXCLUDED.price,
          duration = EXCLUDED.duration,
          type = EXCLUDED.type,
          supported_connection = EXCLUDED.supported_connection,
          pppoe_profile = EXCLUDED.pppoe_profile,
          hotspot_profile = EXCLUDED.hotspot_profile,
          status = EXCLUDED.status,
          description = EXCLUDED.description,
          updated_at = CURRENT_TIMESTAMP
        RETURNING 
          id, code, name, speed, download_speed AS "downloadSpeed", upload_speed AS "uploadSpeed",
          price::float AS price, duration, type, supported_connection AS "supportedConnection",
          pppoe_profile AS "pppoeProfile", hotspot_profile AS "hotspotProfile",
          status, active_users_count AS "activeUsersCount", description
        `,
        [
          p.id,
          p.code || `PKT-${Date.now().toString().slice(-4)}`,
          p.name,
          p.speed || '10 Mbps',
          p.downloadSpeed || p.speed || '10 Mbps',
          p.uploadSpeed || '5 Mbps',
          Number(p.price) || 0,
          p.duration || '1 Bulan',
          p.type || 'pppoe',
          p.supportedConnection || 'pppoe',
          p.pppoeProfile ? p.pppoeProfile.trim() : null,
          p.hotspotProfile ? p.hotspotProfile.trim() : null,
          p.status || 'active',
          Number(p.activeUsersCount) || 0,
          p.description || '',
        ]
      );
    } else {
      result = await query(
        `
        INSERT INTO packages (
          id, code, name, speed, download_speed, upload_speed, price, duration,
          type, supported_connection, status, active_users_count, description
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        ON CONFLICT (id) DO UPDATE SET
          code = EXCLUDED.code,
          name = EXCLUDED.name,
          speed = EXCLUDED.speed,
          download_speed = EXCLUDED.download_speed,
          upload_speed = EXCLUDED.upload_speed,
          price = EXCLUDED.price,
          duration = EXCLUDED.duration,
          type = EXCLUDED.type,
          supported_connection = EXCLUDED.supported_connection,
          status = EXCLUDED.status,
          description = EXCLUDED.description,
          updated_at = CURRENT_TIMESTAMP
        RETURNING 
          id, code, name, speed, download_speed AS "downloadSpeed", upload_speed AS "uploadSpeed",
          price::float AS price, duration, type, supported_connection AS "supportedConnection",
          status, active_users_count AS "activeUsersCount", description
        `,
        [
          p.id,
          p.code || `PKT-${Date.now().toString().slice(-4)}`,
          p.name,
          p.speed || '10 Mbps',
          p.downloadSpeed || p.speed || '10 Mbps',
          p.uploadSpeed || '5 Mbps',
          Number(p.price) || 0,
          p.duration || '1 Bulan',
          p.type || 'pppoe',
          p.supportedConnection || 'pppoe',
          p.status || 'active',
          Number(p.activeUsersCount) || 0,
          p.description || '',
        ]
      );
      if (result.rows && result.rows[0]) {
        result.rows[0].pppoeProfile = p.pppoeProfile || null;
        result.rows[0].hotspotProfile = p.hotspotProfile || null;
      }
    }

    if (!result.rows || result.rows.length === 0) {
      return res.status(500).json({ success: false, message: 'Gagal menyimpan paket: database tidak mengembalikan data.' });
    }

    res.json({ success: true, message: 'Paket berhasil disimpan ke PostgreSQL.', data: result.rows[0] });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Gagal menyimpan paket ke database: ' + error.message });
  }
});

router.put('/packages/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const p = req.body;
    const schema = await detectMigration003Fields();
    let result;

    if (schema.packages) {
      result = await query(
        `
        UPDATE packages SET
          code = COALESCE($1, code),
          name = COALESCE($2, name),
          speed = COALESCE($3, speed),
          download_speed = COALESCE($4, download_speed),
          upload_speed = COALESCE($5, upload_speed),
          price = COALESCE($6, price),
          duration = COALESCE($7, duration),
          type = COALESCE($8, type),
          supported_connection = COALESCE($9, supported_connection),
          pppoe_profile = $10,
          hotspot_profile = $11,
          status = COALESCE($12, status),
          description = COALESCE($13, description),
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $14
        RETURNING 
          id, code, name, speed, download_speed AS "downloadSpeed", upload_speed AS "uploadSpeed",
          price::float AS price, duration, type, supported_connection AS "supportedConnection",
          pppoe_profile AS "pppoeProfile", hotspot_profile AS "hotspotProfile",
          status, active_users_count AS "activeUsersCount", description
        `,
        [
          p.code,
          p.name,
          p.speed,
          p.downloadSpeed,
          p.uploadSpeed,
          p.price !== undefined ? Number(p.price) : null,
          p.duration,
          p.type,
          p.supportedConnection,
          p.pppoeProfile !== undefined ? (p.pppoeProfile ? p.pppoeProfile.trim() : null) : null,
          p.hotspotProfile !== undefined ? (p.hotspotProfile ? p.hotspotProfile.trim() : null) : null,
          p.status,
          p.description,
          id,
        ]
      );
    } else {
      result = await query(
        `
        UPDATE packages SET
          code = COALESCE($1, code),
          name = COALESCE($2, name),
          speed = COALESCE($3, speed),
          download_speed = COALESCE($4, download_speed),
          upload_speed = COALESCE($5, upload_speed),
          price = COALESCE($6, price),
          duration = COALESCE($7, duration),
          type = COALESCE($8, type),
          supported_connection = COALESCE($9, supported_connection),
          status = COALESCE($10, status),
          description = COALESCE($11, description),
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $12
        RETURNING 
          id, code, name, speed, download_speed AS "downloadSpeed", upload_speed AS "uploadSpeed",
          price::float AS price, duration, type, supported_connection AS "supportedConnection",
          status, active_users_count AS "activeUsersCount", description
        `,
        [
          p.code,
          p.name,
          p.speed,
          p.downloadSpeed,
          p.uploadSpeed,
          p.price !== undefined ? Number(p.price) : null,
          p.duration,
          p.type,
          p.supportedConnection,
          p.status,
          p.description,
          id,
        ]
      );
      if (result.rows && result.rows[0]) {
        result.rows[0].pppoeProfile = p.pppoeProfile || null;
        result.rows[0].hotspotProfile = p.hotspotProfile || null;
      }
    }

    if (!result.rows || result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Paket internet tidak ditemukan.' });
    }

    res.json({ success: true, message: 'Paket berhasil diperbarui di PostgreSQL.', data: result.rows[0] });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Gagal memperbarui paket: ' + error.message });
  }
});

router.delete('/packages/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Periksa apakah paket masih digunakan oleh pelanggan
    const custCheck = await query('SELECT COUNT(*) AS count FROM customers WHERE package_id = $1 AND is_deleted IS NOT TRUE', [id]);
    if (parseInt(custCheck.rows[0].count, 10) > 0) {
      return res.status(400).json({
        success: false,
        message: 'Tidak dapat menghapus paket karena masih digunakan oleh pelanggan aktif.',
      });
    }

    await query('DELETE FROM packages WHERE id = $1', [id]);
    res.json({ success: true, message: 'Paket berhasil dihapus dari database.' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Gagal menghapus paket: ' + error.message });
  }
});

// ============================================================================
// 3. DATA PELANGGAN (CRUD) - INTEGRASI MIKROTIK SINGLE-ROUTER PER INSTALASI
// ============================================================================
router.get('/customers', async (_req: Request, res: Response) => {
  try {
    const schema = await detectMigration003Fields();
    const mikrotikCols = schema.customers
      ? `c.router_sync_status AS "routerSyncStatus",
         c.router_last_sync_at::text AS "routerLastSyncAt",
         c.router_last_sync_message AS "routerLastSyncMessage",
         (c.password_encrypted IS NOT NULL AND c.password_encrypted != '') AS "isPasswordConfigured",`
      : `'pending' AS "routerSyncStatus", NULL AS "routerLastSyncAt", NULL AS "routerLastSyncMessage", FALSE AS "isPasswordConfigured",`;

    const result = await query(`
      SELECT 
        c.id, 
        c.name, 
        c.phone, 
        c.address, 
        c.installation_address AS "installationAddress", 
        c.latitude::float AS latitude, 
        c.longitude::float AS longitude, 
        c.package_id AS "packageId", 
        c.package_name AS "packageName", 
        c.type, 
        c.username, 
        c.ip_address AS "ipAddress", 
        c.status, 
        ${mikrotikCols}
        c.registered_at::text AS "registeredAt", 
        c.due_date_day AS "dueDateDay", 
        c.monthly_fee::float AS "monthlyFee", 
        c.installation_date::text AS "installationDate",
        c.created_at AS "createdAt",
        c.updated_at AS "updatedAt"
      FROM customers c
      WHERE c.is_deleted IS NOT TRUE
      ORDER BY c.name ASC
    `);

    // Proteksi Keamanan: Tambahkan maskedPassword, JANGAN PERNAH kembalikan password plaintext atau cipher
    const data = result.rows.map((row: any) => ({
      ...row,
      maskedPassword: row.isPasswordConfigured ? '••••••••' : '',
    }));

    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Gagal mengambil pelanggan dari PostgreSQL: ' + error.message });
  }
});

router.post('/customers', async (req: Request, res: Response) => {
  try {
    const c = req.body;
    if (!c.id || !c.name || !c.phone || !c.packageId) {
      return res.status(400).json({ success: false, message: 'ID, nama, nomor telepon, dan paket wajib diisi.' });
    }

    // 1. Validasi format username (3-64 karakter, tanpa spasi/karakter kontrol)
    const rawUsername = c.username || c.id.toLowerCase().replace(/[^a-z0-9_.-]/g, '_');
    const userCheck = validateSafeCustomerUsername(rawUsername);
    if (!userCheck.valid) {
      return res.status(400).json({
        success: false,
        message: userCheck.message,
      });
    }
    const cleanUsername = userCheck.clean;

    // 2. Enkripsi Password Pelanggan menggunakan AES-256-GCM via cryptoUtils
    let encryptedPasswordToStore: string | null = null;
    let rawPasswordForRouter: string | null = null;

    if (c.password !== undefined && c.password !== null && c.password !== '' && c.password !== '••••••••') {
      const pwdValidation = validateCustomerPassword(c.password);
      if (!pwdValidation.valid) {
        return res.status(400).json({ success: false, message: pwdValidation.message });
      }
      if (!isMikrotikEncryptionKeyConfigured()) {
        return res.status(400).json({
          success: false,
          message: 'Kunci enkripsi MIKROTIK_ENCRYPTION_KEY belum dikonfigurasi di file .env server. Password tidak dapat dienkripsi.',
        });
      }
      rawPasswordForRouter = c.password.trim();
      encryptedPasswordToStore = encryptMikrotikPassword(rawPasswordForRouter!);
    }

    const schema = await detectMigration003Fields();
    let result;

    // 3. Simpan permanen ke PostgreSQL TERLEBIH DAHULU (Status awal: pending)
    if (schema.customers) {
      result = await query(
        `
        INSERT INTO customers (
          id, name, phone, address, installation_address, latitude, longitude,
          package_id, package_name, type, username, password_encrypted, ip_address, status,
          router_sync_status, router_last_sync_message,
          registered_at, due_date_day, monthly_fee, installation_date, is_deleted
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, FALSE)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          phone = EXCLUDED.phone,
          address = EXCLUDED.address,
          installation_address = EXCLUDED.installation_address,
          latitude = EXCLUDED.latitude,
          longitude = EXCLUDED.longitude,
          package_id = EXCLUDED.package_id,
          package_name = EXCLUDED.package_name,
          type = EXCLUDED.type,
          username = EXCLUDED.username,
          password_encrypted = COALESCE(EXCLUDED.password_encrypted, customers.password_encrypted),
          ip_address = EXCLUDED.ip_address,
          status = EXCLUDED.status,
          due_date_day = EXCLUDED.due_date_day,
          monthly_fee = EXCLUDED.monthly_fee,
          installation_date = EXCLUDED.installation_date,
          is_deleted = FALSE,
          deleted_at = NULL,
          updated_at = CURRENT_TIMESTAMP
        RETURNING 
          id, name, phone, address, installation_address AS "installationAddress",
          latitude::float AS latitude, longitude::float AS longitude,
          package_id AS "packageId", package_name AS "packageName", type, username,
          ip_address AS "ipAddress", status,
          router_sync_status AS "routerSyncStatus", router_last_sync_at::text AS "routerLastSyncAt",
          router_last_sync_message AS "routerLastSyncMessage",
          (password_encrypted IS NOT NULL AND password_encrypted != '') AS "isPasswordConfigured",
          registered_at::text AS "registeredAt",
          due_date_day AS "dueDateDay", monthly_fee::float AS "monthlyFee",
          installation_date::text AS "installationDate"
        `,
        [
          c.id,
          c.name,
          c.phone,
          c.address || '',
          c.installationAddress || c.address || '',
          c.latitude ? Number(c.latitude) : null,
          c.longitude ? Number(c.longitude) : null,
          c.packageId,
          c.packageName || 'Paket Internet',
          c.type || 'pppoe',
          cleanUsername,
          encryptedPasswordToStore,
          c.ipAddress || null,
          c.status || 'active',
          'pending',
          'Menunggu proses sinkronisasi ke router',
          c.registeredAt || new Date().toISOString().split('T')[0],
          Number(c.dueDateDay) || 10,
          Number(c.monthlyFee) || 0,
          c.installationDate || null,
        ]
      );
    } else {
      result = await query(
        `
        INSERT INTO customers (
          id, name, phone, address, installation_address, latitude, longitude,
          package_id, package_name, type, username, ip_address, status,
          registered_at, due_date_day, monthly_fee, installation_date, is_deleted
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, FALSE)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          phone = EXCLUDED.phone,
          address = EXCLUDED.address,
          installation_address = EXCLUDED.installation_address,
          latitude = EXCLUDED.latitude,
          longitude = EXCLUDED.longitude,
          package_id = EXCLUDED.package_id,
          package_name = EXCLUDED.package_name,
          type = EXCLUDED.type,
          username = EXCLUDED.username,
          ip_address = EXCLUDED.ip_address,
          status = EXCLUDED.status,
          due_date_day = EXCLUDED.due_date_day,
          monthly_fee = EXCLUDED.monthly_fee,
          installation_date = EXCLUDED.installation_date,
          is_deleted = FALSE,
          deleted_at = NULL,
          updated_at = CURRENT_TIMESTAMP
        RETURNING 
          id, name, phone, address, installation_address AS "installationAddress",
          latitude::float AS latitude, longitude::float AS longitude,
          package_id AS "packageId", package_name AS "packageName", type, username,
          ip_address AS "ipAddress", status, registered_at::text AS "registeredAt",
          due_date_day AS "dueDateDay", monthly_fee::float AS "monthlyFee",
          installation_date::text AS "installationDate"
        `,
        [
          c.id,
          c.name,
          c.phone,
          c.address || '',
          c.installationAddress || c.address || '',
          c.latitude ? Number(c.latitude) : null,
          c.longitude ? Number(c.longitude) : null,
          c.packageId,
          c.packageName || 'Paket Internet',
          c.type || 'pppoe',
          cleanUsername,
          c.ipAddress || null,
          c.status || 'active',
          c.registeredAt || new Date().toISOString().split('T')[0],
          Number(c.dueDateDay) || 10,
          Number(c.monthlyFee) || 0,
          c.installationDate || null,
        ]
      );
      if (result.rows && result.rows[0]) {
        result.rows[0].routerSyncStatus = 'pending';
        result.rows[0].isPasswordConfigured = Boolean(encryptedPasswordToStore);
      }
    }

    // Update jumlah pelanggan aktif pada paket
    await query(`
      UPDATE packages p
      SET active_users_count = (
        SELECT COUNT(*) FROM customers WHERE package_id = p.id AND status = 'active' AND is_deleted IS NOT TRUE
      )
      WHERE p.id = $1
    `, [c.packageId]);

    const createdCustomer = result.rows[0];
    createdCustomer.maskedPassword = createdCustomer.isPasswordConfigured ? '••••••••' : '';

    // 4. Sinkronisasi Operasional ke RouterOS MikroTik
    const routerOptions = await getActiveRouterOptions();
    if (!routerOptions) {
      if (schema.customers) {
        await query(
          `UPDATE customers SET router_sync_status = 'failed', router_last_sync_message = $1 WHERE id = $2`,
          ['Router MikroTik belum terhubung atau password API belum tersimpan.', c.id]
        );
        createdCustomer.routerSyncStatus = 'failed';
        createdCustomer.routerLastSyncMessage = 'Router MikroTik belum terhubung atau password API belum tersimpan.';
      }
      return res.json({
        success: true,
        message: 'Pelanggan berhasil disimpan ke database. Router belum terhubung untuk sinkronisasi akun otomatis.',
        data: createdCustomer,
      });
    }

    // Ambil profile paket dari PostgreSQL
    let profileToUse: string | null = null;
    const isHotspot = c.type === 'hotspot';
    if (schema.packages) {
      const pkgRes = await query('SELECT pppoe_profile, hotspot_profile FROM packages WHERE id = $1', [c.packageId]);
      if (pkgRes.rows.length > 0) {
        profileToUse = isHotspot ? pkgRes.rows[0].hotspot_profile : pkgRes.rows[0].pppoe_profile;
      }
    }

    // Validasi mapping profile paket (TIDAK BOLEH fallback ke default)
    if (!profileToUse || !profileToUse.trim()) {
      const errorMsg = `Profile ${isHotspot ? 'Hotspot' : 'PPPoE'} belum dikonfigurasi pada paket internet '${c.packageName}'. Silakan tentukan nama profile di menu Paket Internet.`;
      if (schema.customers) {
        await query(
          `UPDATE customers SET router_sync_status = 'failed', router_last_sync_message = $1 WHERE id = $2`,
          [errorMsg, c.id]
        );
        createdCustomer.routerSyncStatus = 'failed';
        createdCustomer.routerLastSyncMessage = errorMsg;
      }
      return res.json({
        success: true,
        message: `Data pelanggan tersimpan di PostgreSQL, namun sinkronisasi router ditunda: ${errorMsg}`,
        data: createdCustomer,
      });
    }

    const cleanProfile = profileToUse.trim();

    // Verifikasi keberadaan profile pada RouterOS
    try {
      const profileCheck = await checkProfileExists(routerOptions, cleanProfile, isHotspot ? 'hotspot' : 'pppoe');
      if (!profileCheck.exists) {
        if (schema.customers) {
          await query(
            `UPDATE customers SET router_sync_status = 'failed', router_last_sync_message = $1 WHERE id = $2`,
            [profileCheck.message, c.id]
          );
          createdCustomer.routerSyncStatus = 'failed';
          createdCustomer.routerLastSyncMessage = profileCheck.message;
        }
        return res.json({
          success: true,
          message: `Data pelanggan tersimpan di PostgreSQL, namun sinkronisasi router gagal: ${profileCheck.message}`,
          data: createdCustomer,
        });
      }

      // Profile valid di router -> Lakukan provisioning akun
      if (!rawPasswordForRouter) {
        const errorMsg = 'Password pelanggan belum diisi. Akun tidak dapat dibuat di router.';
        if (schema.customers) {
          await query(
            `UPDATE customers SET router_sync_status = 'failed', router_last_sync_message = $1 WHERE id = $2`,
            [errorMsg, c.id]
          );
          createdCustomer.routerSyncStatus = 'failed';
          createdCustomer.routerLastSyncMessage = errorMsg;
        }
        return res.json({
          success: true,
          message: `Data pelanggan tersimpan di PostgreSQL. ${errorMsg}`,
          data: createdCustomer,
        });
      }

      const isDisabled = c.status !== 'active';
      let provResult;
      if (isHotspot) {
        provResult = await createOrUpdateHotspotUser(routerOptions, {
          username: cleanUsername,
          password: rawPasswordForRouter,
          profile: cleanProfile,
          disabled: isDisabled,
        });
      } else {
        provResult = await createOrUpdatePppoeSecret(routerOptions, {
          username: cleanUsername,
          password: rawPasswordForRouter,
          profile: cleanProfile,
          ipAddress: c.ipAddress || undefined,
          disabled: isDisabled,
        });
      }

      const verifyRes = isHotspot
        ? await verifyHotspotUserExists(routerOptions, cleanUsername, cleanProfile, isDisabled)
        : await verifyPppoeSecretExists(routerOptions, cleanUsername, cleanProfile, isDisabled);
      if (!verifyRes.verified) {
        throw new Error(verifyRes.message);
      }

      if (schema.customers) {
        await query(
          `UPDATE customers 
           SET router_sync_status = 'synced', 
               router_last_sync_at = CURRENT_TIMESTAMP, 
               router_last_sync_message = $1 
           WHERE id = $2`,
          [provResult.message, c.id]
        );
        createdCustomer.routerSyncStatus = 'synced';
        createdCustomer.routerLastSyncAt = new Date().toISOString();
        createdCustomer.routerLastSyncMessage = provResult.message;
      }

      res.json({
        success: true,
        message: `Pelanggan berhasil disimpan ke database dan disinkronkan ke router MikroTik (${provResult.action.toUpperCase()}).`,
        data: createdCustomer,
      });
    } catch (routerErr: any) {
      // PENTING: Kegagalan komunikasi router TIDAK PERNAH membatalkan/menghapus data pelanggan dari PostgreSQL
      const safeErrorMsg = `Gagal sinkronisasi router: ${routerErr?.message || 'Koneksi API error'}`;
      if (schema.customers) {
        await query(
          `UPDATE customers 
           SET router_sync_status = 'failed', 
               router_last_sync_at = CURRENT_TIMESTAMP, 
               router_last_sync_message = $1 
           WHERE id = $2`,
          [safeErrorMsg, c.id]
        );
        createdCustomer.routerSyncStatus = 'failed';
        createdCustomer.routerLastSyncAt = new Date().toISOString();
        createdCustomer.routerLastSyncMessage = safeErrorMsg;
      }

      res.json({
        success: true,
        message: `Pelanggan berhasil disimpan ke PostgreSQL, namun sinkronisasi router gagal: ${safeErrorMsg}`,
        data: createdCustomer,
      });
    }
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Gagal menyimpan pelanggan ke database: ' + error.message });
  }
});

router.put('/customers/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const c = req.body;

    const schema = await detectMigration003Fields();

    // 1. Ambil data pelanggan yang ada di database saat ini
    const existingRes = await query('SELECT * FROM customers WHERE id = $1', [id]);
    if (existingRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Pelanggan tidak ditemukan.' });
    }
    const existing = existingRes.rows[0];

    // 2. Kelola pembaruan password terenkripsi (jika diubah admin)
    let encryptedPasswordToStore = schema.customers ? existing.password_encrypted : null;
    let rawPasswordForRouter: string | null = null;

    if (c.password !== undefined && c.password !== null && c.password !== '' && c.password !== '••••••••') {
      const pwdValidation = validateCustomerPassword(c.password);
      if (!pwdValidation.valid) {
        return res.status(400).json({ success: false, message: pwdValidation.message });
      }
      if (!isMikrotikEncryptionKeyConfigured()) {
        return res.status(400).json({
          success: false,
          message: 'Kunci enkripsi MIKROTIK_ENCRYPTION_KEY belum dikonfigurasi di file .env server.',
        });
      }
      rawPasswordForRouter = c.password.trim();
      encryptedPasswordToStore = encryptMikrotikPassword(rawPasswordForRouter!);
    } else if (schema.customers && existing.password_encrypted && isMikrotikEncryptionKeyConfigured()) {
      try {
        rawPasswordForRouter = decryptMikrotikPassword(existing.password_encrypted);
      } catch {
        rawPasswordForRouter = null;
      }
    }

    const userCheck = validateSafeCustomerUsername(c.username || existing.username);
    if (!userCheck.valid) {
      return res.status(400).json({
        success: false,
        message: userCheck.message,
      });
    }
    const cleanUsername = userCheck.clean;

    let result;
    if (schema.customers) {
      result = await query(
        `
        UPDATE customers SET
          name = COALESCE($1, name),
          phone = COALESCE($2, phone),
          address = COALESCE($3, address),
          installation_address = COALESCE($4, installation_address),
          latitude = COALESCE($5, latitude),
          longitude = COALESCE($6, longitude),
          package_id = COALESCE($7, package_id),
          package_name = COALESCE($8, package_name),
          type = COALESCE($9, type),
          username = COALESCE($10, username),
          password_encrypted = COALESCE($11, password_encrypted),
          ip_address = COALESCE($12, ip_address),
          status = COALESCE($13, status),
          due_date_day = COALESCE($14, due_date_day),
          monthly_fee = COALESCE($15, monthly_fee),
          installation_date = COALESCE($16, installation_date),
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $17
        RETURNING 
          id, name, phone, address, installation_address AS "installationAddress",
          latitude::float AS latitude, longitude::float AS longitude,
          package_id AS "packageId", package_name AS "packageName", type, username,
          ip_address AS "ipAddress", status,
          router_sync_status AS "routerSyncStatus", router_last_sync_at::text AS "routerLastSyncAt",
          router_last_sync_message AS "routerLastSyncMessage",
          (password_encrypted IS NOT NULL AND password_encrypted != '') AS "isPasswordConfigured",
          registered_at::text AS "registeredAt",
          due_date_day AS "dueDateDay", monthly_fee::float AS "monthlyFee",
          installation_date::text AS "installationDate"
        `,
        [
          c.name,
          c.phone,
          c.address,
          c.installationAddress,
          c.latitude !== undefined ? Number(c.latitude) : null,
          c.longitude !== undefined ? Number(c.longitude) : null,
          c.packageId,
          c.packageName,
          c.type,
          cleanUsername,
          encryptedPasswordToStore,
          c.ipAddress,
          c.status,
          c.dueDateDay ? Number(c.dueDateDay) : null,
          c.monthlyFee !== undefined ? Number(c.monthlyFee) : null,
          c.installationDate,
          id,
        ]
      );
    } else {
      result = await query(
        `
        UPDATE customers SET
          name = COALESCE($1, name),
          phone = COALESCE($2, phone),
          address = COALESCE($3, address),
          installation_address = COALESCE($4, installation_address),
          latitude = COALESCE($5, latitude),
          longitude = COALESCE($6, longitude),
          package_id = COALESCE($7, package_id),
          package_name = COALESCE($8, package_name),
          type = COALESCE($9, type),
          username = COALESCE($10, username),
          ip_address = COALESCE($11, ip_address),
          status = COALESCE($12, status),
          due_date_day = COALESCE($13, due_date_day),
          monthly_fee = COALESCE($14, monthly_fee),
          installation_date = COALESCE($15, installation_date),
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $16
        RETURNING 
          id, name, phone, address, installation_address AS "installationAddress",
          latitude::float AS latitude, longitude::float AS longitude,
          package_id AS "packageId", package_name AS "packageName", type, username,
          ip_address AS "ipAddress", status, registered_at::text AS "registeredAt",
          due_date_day AS "dueDateDay", monthly_fee::float AS "monthlyFee",
          installation_date::text AS "installationDate"
        `,
        [
          c.name,
          c.phone,
          c.address,
          c.installationAddress,
          c.latitude !== undefined ? Number(c.latitude) : null,
          c.longitude !== undefined ? Number(c.longitude) : null,
          c.packageId,
          c.packageName,
          c.type,
          cleanUsername,
          c.ipAddress,
          c.status,
          c.dueDateDay ? Number(c.dueDateDay) : null,
          c.monthlyFee !== undefined ? Number(c.monthlyFee) : null,
          c.installationDate,
          id,
        ]
      );
    }

    const updatedCustomer = result.rows[0];
    updatedCustomer.maskedPassword = updatedCustomer.isPasswordConfigured ? '••••••••' : '';

    // 3. Sinkronisasi perubahan akun ke Router MikroTik
    const targetPackageId = c.packageId || existing.package_id;
    const targetType = ((c.type || existing.type) as string).toLowerCase() === 'hotspot' ? 'hotspot' : 'pppoe';
    const isHotspot = targetType === 'hotspot';
    const packageChanged = existing.package_id !== targetPackageId;
    const existingType = (existing.type as string).toLowerCase() === 'hotspot' ? 'hotspot' : 'pppoe';
    const existingUsername = (existing.username || '').trim();
    const accountIdentityChanged = existingType !== targetType || existingUsername !== cleanUsername;
    const isDisabled = (c.status || existing.status) !== 'active';

    const prevPending = parsePendingSyncActions(existing.router_sync_status, existing.router_last_sync_message);
    const pendingOldAccounts = mergeOldAccounts(
      [
        prevPending.oldAccounts,
        accountIdentityChanged && existingUsername ? [{ type: existingType, username: existingUsername }] : [],
      ],
      { type: targetType, username: cleanUsername }
    );
    const pendingDisconnectNeeded =
      packageChanged ||
      isDisabled ||
      prevPending.needsSessionDisconnect;

    const routerOptions = await getActiveRouterOptions();
    if (!routerOptions) {
      const errMsg = appendPendingMarkers(
        'Router MikroTik tidak terhubung atau password API belum tersimpan. Data diperbarui di PostgreSQL, namun belum tersinkron ke router.',
        {
          needsSessionDisconnect: pendingDisconnectNeeded,
          oldAccounts: pendingOldAccounts,
          corrupted: prevPending.corrupted,
          stages: { accountProvisioned: false, accountVerified: false, oldAccountsPending: pendingOldAccounts.length, sessionDisconnectPending: pendingDisconnectNeeded },
        }
      );
      if (schema.customers) {
        await query(
          `UPDATE customers SET router_sync_status = 'failed', router_last_sync_at = CURRENT_TIMESTAMP, router_last_sync_message = $1 WHERE id = $2`,
          [errMsg, id]
        );
        updatedCustomer.routerSyncStatus = 'failed';
        updatedCustomer.routerLastSyncAt = new Date().toISOString();
        updatedCustomer.routerLastSyncMessage = errMsg;
      }
    } else {
      let profileToUse: string | null = null;
      if (schema.packages) {
        const pkgRes = await query('SELECT pppoe_profile, hotspot_profile FROM packages WHERE id = $1', [targetPackageId]);
        if (pkgRes.rows.length > 0) {
          profileToUse = isHotspot ? pkgRes.rows[0].hotspot_profile : pkgRes.rows[0].pppoe_profile;
        }
      }

      if (!profileToUse || !profileToUse.trim()) {
        const errMsg = appendPendingMarkers(
          `Profile ${isHotspot ? 'Hotspot' : 'PPPoE'} belum dikonfigurasi pada paket internet. Data tersimpan di PostgreSQL, namun sinkronisasi router gagal.`,
          {
            needsSessionDisconnect: pendingDisconnectNeeded,
            oldAccounts: pendingOldAccounts,
            corrupted: prevPending.corrupted,
            stages: { accountProvisioned: false, accountVerified: false, oldAccountsPending: pendingOldAccounts.length, sessionDisconnectPending: pendingDisconnectNeeded },
          }
        );
        if (schema.customers) {
          await query(
            `UPDATE customers SET router_sync_status = 'failed', router_last_sync_at = CURRENT_TIMESTAMP, router_last_sync_message = $1 WHERE id = $2`,
            [errMsg, id]
          );
          updatedCustomer.routerSyncStatus = 'failed';
          updatedCustomer.routerLastSyncAt = new Date().toISOString();
          updatedCustomer.routerLastSyncMessage = errMsg;
        }
      } else {
        const cleanProfile = profileToUse.trim();
        try {
          const profileCheck = await checkProfileExists(routerOptions, cleanProfile, targetType);
          if (!profileCheck.exists) {
            // Profile tidak ada di router -> Jangan hapus akun lama & jangan memutus sesi, tandai failed
            const errMsg = appendPendingMarkers(profileCheck.message, {
              needsSessionDisconnect: pendingDisconnectNeeded,
              oldAccounts: pendingOldAccounts,
              corrupted: prevPending.corrupted,
              stages: { accountProvisioned: false, accountVerified: false, oldAccountsPending: pendingOldAccounts.length, sessionDisconnectPending: pendingDisconnectNeeded },
            });
            if (schema.customers) {
              await query(
                `UPDATE customers SET router_sync_status = 'failed', router_last_sync_at = CURRENT_TIMESTAMP, router_last_sync_message = $1 WHERE id = $2`,
                [errMsg, id]
              );
              updatedCustomer.routerSyncStatus = 'failed';
              updatedCustomer.routerLastSyncAt = new Date().toISOString();
              updatedCustomer.routerLastSyncMessage = errMsg;
            }
          } else {
            let stageReached: 'provision' | 'verify' = 'provision';
            let profileChangedOnRouter = false;
            try {
              // TAHAP 1: Buat atau perbarui akun BARU secara idempotent
              let provResult;
              if (isHotspot) {
                provResult = await createOrUpdateHotspotUser(routerOptions, {
                  username: cleanUsername,
                  password: rawPasswordForRouter || undefined,
                  profile: cleanProfile,
                  disabled: isDisabled,
                });
              } else {
                provResult = await createOrUpdatePppoeSecret(routerOptions, {
                  username: cleanUsername,
                  password: rawPasswordForRouter || undefined,
                  profile: cleanProfile,
                  ipAddress: c.ipAddress || existing.ip_address || undefined,
                  disabled: isDisabled,
                });
              }
              profileChangedOnRouter = Boolean(provResult.profileChanged);
              const effectiveDisconnectNeeded = pendingDisconnectNeeded || profileChangedOnRouter;

              // TAHAP 2: Verifikasi akun BARU benar-benar tunggal & sesuai di RouterOS SEBELUM menyentuh akun lama
              stageReached = 'verify';
              const verifyRes = isHotspot
                ? await verifyHotspotUserExists(routerOptions, cleanUsername, cleanProfile, isDisabled)
                : await verifyPppoeSecretExists(routerOptions, cleanUsername, cleanProfile, isDisabled);

              if (!verifyRes.verified) {
                throw new Error(verifyRes.message);
              }

              // TAHAP 3: Bersihkan akun LAMA (hanya setelah akun baru dibuat & diverifikasi)
              const failedOldAccounts: PendingRouterAccount[] = [];
              const cleanupErrors: string[] = [];
              for (const oldAcc of pendingOldAccounts) {
                const cleanupRes = await cleanupOldRouterAccount(routerOptions, oldAcc.type, oldAcc.username);
                if (!cleanupRes.success) {
                  failedOldAccounts.push(oldAcc);
                  cleanupErrors.push(cleanupRes.message);
                }
              }

              // TAHAP 4: Putuskan SELURUH sesi aktif akun target hanya jika ada alasan operasional (paket/profile berubah, nonaktif, atau pending disconnect)
              let sessionDisconnectFailed = false;
              let sessionDisconnectError = '';
              if (effectiveDisconnectNeeded) {
                try {
                  const dcRes = isHotspot
                    ? await disconnectHotspotSession(routerOptions, cleanUsername)
                    : await disconnectPppoeSession(routerOptions, cleanUsername);
                  if (!dcRes.success) {
                    sessionDisconnectFailed = true;
                    sessionDisconnectError = dcRes.message;
                  }
                } catch (dcErr: any) {
                  sessionDisconnectFailed = true;
                  sessionDisconnectError = dcErr?.message || 'Gagal memutuskan sesi aktif';
                }
              }

              if (prevPending.corrupted || failedOldAccounts.length > 0 || sessionDisconnectFailed) {
                const parts: string[] = [
                  `Tahap buat & verifikasi akun '${cleanUsername}' (${targetType.toUpperCase()}) BERHASIL`,
                ];
                if (pendingOldAccounts.length > 0 && failedOldAccounts.length === 0) {
                  parts.push('pembersihan akun lama BERHASIL');
                }
                if (cleanupErrors.length > 0) {
                  parts.push(`pembersihan/putus sesi akun lama GAGAL: ${cleanupErrors[0]}`);
                }
                if (sessionDisconnectFailed) {
                  parts.push(`pemutusan sesi aktif '${cleanUsername}' GAGAL: ${sessionDisconnectError}`);
                }
                if (prevPending.corrupted) {
                  parts.push('penanda sinkronisasi sebelumnya rusak sehingga butuh pemeriksaan manual');
                }
                const partialMsg = appendPendingMarkers(`${parts.join('; ')}.`, {
                  needsSessionDisconnect: sessionDisconnectFailed,
                  oldAccounts: failedOldAccounts,
                  corrupted: prevPending.corrupted,
                  stages: {
                    accountProvisioned: true,
                    accountVerified: true,
                    oldAccountsPending: failedOldAccounts.length,
                    sessionDisconnectPending: sessionDisconnectFailed,
                  },
                });
                if (schema.customers) {
                  await query(
                    `UPDATE customers SET router_sync_status = 'failed', router_last_sync_at = CURRENT_TIMESTAMP, router_last_sync_message = $1 WHERE id = $2`,
                    [partialMsg, id]
                  );
                  updatedCustomer.routerSyncStatus = 'failed';
                  updatedCustomer.routerLastSyncAt = new Date().toISOString();
                  updatedCustomer.routerLastSyncMessage = partialMsg;
                }
              } else {
                if (schema.customers) {
                  const syncDetails: string[] = [];
                  if (accountIdentityChanged || pendingOldAccounts.length > 0) {
                    syncDetails.push('akun lama dihapus & seluruh sesi aktif akun lama diputus');
                  }
                  if (effectiveDisconnectNeeded) {
                    syncDetails.push('seluruh sesi aktif diputus untuk menerapkan profile/status terbaru');
                  }
                  const syncMsg = `Akun '${cleanUsername}' (${targetType.toUpperCase()}) berhasil dibuat/diperbarui & diverifikasi di router MikroTik${
                    syncDetails.length > 0 ? ` (${syncDetails.join(', ')})` : ''
                  }.`;
                  await query(
                    `UPDATE customers SET router_sync_status = 'synced', router_last_sync_at = CURRENT_TIMESTAMP, router_last_sync_message = $1 WHERE id = $2`,
                    [syncMsg, id]
                  );
                  updatedCustomer.routerSyncStatus = 'synced';
                  updatedCustomer.routerLastSyncAt = new Date().toISOString();
                  updatedCustomer.routerLastSyncMessage = syncMsg;
                }
              }
            } catch (stageErr: any) {
              const effectivePendingDisconnect = pendingDisconnectNeeded || profileChangedOnRouter;
              const stageLabel =
                stageReached === 'verify'
                  ? `Tahap verifikasi akun baru '${cleanUsername}' gagal (akun lama tetap dipertahankan)`
                  : `Tahap buat/perbarui akun '${cleanUsername}' gagal (akun lama tetap dipertahankan)`;
              const errMsg = appendPendingMarkers(
                `${stageLabel}: ${stageErr?.message || 'Error'}`,
                {
                  needsSessionDisconnect: effectivePendingDisconnect,
                  oldAccounts: pendingOldAccounts,
                  corrupted: prevPending.corrupted,
                  stages: {
                    accountProvisioned: stageReached === 'verify',
                    accountVerified: false,
                    oldAccountsPending: pendingOldAccounts.length,
                    sessionDisconnectPending: effectivePendingDisconnect,
                  },
                }
              );
              if (schema.customers) {
                await query(
                  `UPDATE customers SET router_sync_status = 'failed', router_last_sync_at = CURRENT_TIMESTAMP, router_last_sync_message = $1 WHERE id = $2`,
                  [errMsg, id]
                );
                updatedCustomer.routerSyncStatus = 'failed';
                updatedCustomer.routerLastSyncAt = new Date().toISOString();
                updatedCustomer.routerLastSyncMessage = errMsg;
              }
            }
          }
        } catch (routerErr: any) {
          const errMsg = appendPendingMarkers(
            `Gagal update ke router: ${routerErr?.message || 'Error'}`,
            {
              needsSessionDisconnect: pendingDisconnectNeeded,
              oldAccounts: pendingOldAccounts,
              corrupted: prevPending.corrupted,
              stages: {
                accountProvisioned: false,
                accountVerified: false,
                oldAccountsPending: pendingOldAccounts.length,
                sessionDisconnectPending: pendingDisconnectNeeded,
              },
            }
          );
          if (schema.customers) {
            await query(
              `UPDATE customers SET router_sync_status = 'failed', router_last_sync_at = CURRENT_TIMESTAMP, router_last_sync_message = $1 WHERE id = $2`,
              [errMsg, id]
            );
            updatedCustomer.routerSyncStatus = 'failed';
            updatedCustomer.routerLastSyncAt = new Date().toISOString();
            updatedCustomer.routerLastSyncMessage = errMsg;
          }
        }
      }
    }

    res.json({ success: true, message: 'Data pelanggan berhasil diperbarui di PostgreSQL.', data: updatedCustomer });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Gagal memperbarui data pelanggan: ' + error.message });
  }
});

router.patch('/customers/:id/status', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status || !['active', 'isolated', 'inactive'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Status tidak valid.' });
    }

    const schema = await detectMigration003Fields();

    const prevRes = await query('SELECT router_sync_status, router_last_sync_message FROM customers WHERE id = $1', [id]);
    const prevRow = prevRes.rows?.[0];
    const prevPending = parsePendingSyncActions(prevRow?.router_sync_status, prevRow?.router_last_sync_message);

    const result = await query(
      `
      UPDATE customers 
      SET status = $1, updated_at = CURRENT_TIMESTAMP 
      WHERE id = $2
      RETURNING 
        id, name, phone, address, installation_address AS "installationAddress",
        latitude::float AS latitude, longitude::float AS longitude,
        package_id AS "packageId", package_name AS "packageName", type, username,
        ip_address AS "ipAddress", status,
        ${
          schema.customers
            ? 'router_sync_status AS "routerSyncStatus", router_last_sync_at::text AS "routerLastSyncAt", router_last_sync_message AS "routerLastSyncMessage", (password_encrypted IS NOT NULL AND password_encrypted != \'\') AS "isPasswordConfigured",'
            : '\'pending\' AS "routerSyncStatus", NULL AS "routerLastSyncAt", NULL AS "routerLastSyncMessage", FALSE AS "isPasswordConfigured",'
        }
        registered_at::text AS "registeredAt",
        due_date_day AS "dueDateDay", monthly_fee::float AS "monthlyFee",
        installation_date::text AS "installationDate"
      `,
      [status, id]
    );

    if (!result.rows || result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Pelanggan tidak ditemukan.' });
    }

    const updatedCustomer = result.rows[0];
    updatedCustomer.maskedPassword = updatedCustomer.isPasswordConfigured ? '••••••••' : '';

    const isDisabled = status !== 'active';
    const isHotspot = updatedCustomer.type === 'hotspot';
    const cleanUsername = (updatedCustomer.username || '').trim();
    const pendingOldAccounts = mergeOldAccounts([prevPending.oldAccounts], {
      type: isHotspot ? 'hotspot' : 'pppoe',
      username: cleanUsername,
    });
    const pendingDisconnect = prevPending.needsSessionDisconnect || isDisabled;

    // Sinkronisasi status aktif / nonaktif (disable) ke router MikroTik
    const routerOptions = await getActiveRouterOptions();
    if (!routerOptions) {
      const errMsg = appendPendingMarkers(
        'Router MikroTik tidak terhubung atau password API belum tersimpan. Status pelanggan di billing diubah, namun belum dapat diterapkan ke router.',
        {
          needsSessionDisconnect: pendingDisconnect,
          oldAccounts: pendingOldAccounts,
          corrupted: prevPending.corrupted,
        }
      );
      if (schema.customers) {
        await query(
          `UPDATE customers SET router_sync_status = 'failed', router_last_sync_at = CURRENT_TIMESTAMP, router_last_sync_message = $1 WHERE id = $2`,
          [errMsg, id]
        );
        updatedCustomer.routerSyncStatus = 'failed';
        updatedCustomer.routerLastSyncAt = new Date().toISOString();
        updatedCustomer.routerLastSyncMessage = errMsg;
      }
    } else if (!cleanUsername) {
      const errMsg = appendPendingMarkers(
        'Username koneksi pelanggan kosong. Status akun tidak dapat disinkronkan ke router.',
        {
          needsSessionDisconnect: pendingDisconnect,
          oldAccounts: pendingOldAccounts,
          corrupted: prevPending.corrupted,
        }
      );
      if (schema.customers) {
        await query(
          `UPDATE customers SET router_sync_status = 'failed', router_last_sync_at = CURRENT_TIMESTAMP, router_last_sync_message = $1 WHERE id = $2`,
          [errMsg, id]
        );
        updatedCustomer.routerSyncStatus = 'failed';
        updatedCustomer.routerLastSyncAt = new Date().toISOString();
        updatedCustomer.routerLastSyncMessage = errMsg;
      }
    } else if (prevPending.corrupted) {
      // Penanda sebelumnya rusak -> jangan pernah menghapus pekerjaan atau menandai synced
      const errMsg = appendPendingMarkers(
        `Status billing diubah menjadi '${status}', namun penanda sinkronisasi sebelumnya rusak/tidak terbaca. Status ditahan 'failed' untuk pemeriksaan manual.`,
        {
          needsSessionDisconnect: true,
          oldAccounts: pendingOldAccounts,
          corrupted: true,
        }
      );
      if (schema.customers) {
        await query(
          `UPDATE customers SET router_sync_status = 'failed', router_last_sync_at = CURRENT_TIMESTAMP, router_last_sync_message = $1 WHERE id = $2`,
          [errMsg, id]
        );
        updatedCustomer.routerSyncStatus = 'failed';
        updatedCustomer.routerLastSyncAt = new Date().toISOString();
        updatedCustomer.routerLastSyncMessage = errMsg;
      }
    } else {
      try {
        if (isHotspot) {
          await toggleHotspotUser(routerOptions, cleanUsername, isDisabled);
        } else {
          await togglePppoeSecret(routerOptions, cleanUsername, isDisabled);
        }

        // Proses pembersihan akun lama yang masih tertunda sebelum menyatakan selesai
        const remainingOldAccounts: PendingRouterAccount[] = [];
        const cleanupErrors: string[] = [];
        for (const oldAcc of pendingOldAccounts) {
          const cleanupRes = await cleanupOldRouterAccount(routerOptions, oldAcc.type, oldAcc.username);
          if (!cleanupRes.success) {
            remainingOldAccounts.push(oldAcc);
            cleanupErrors.push(cleanupRes.message);
          }
        }

        // Jika ada kewajiban pemutusan sesi tertunda (atau status isolated/inactive), verifikasi & putuskan sesi aktif
        let remainingSessionDisconnect = false;
        let sessionDisconnectError = '';
        if (pendingDisconnect) {
          try {
            const dcRes = isHotspot
              ? await disconnectHotspotSession(routerOptions, cleanUsername)
              : await disconnectPppoeSession(routerOptions, cleanUsername);
            if (!dcRes.success) {
              remainingSessionDisconnect = true;
              sessionDisconnectError = dcRes.message;
            }
          } catch (dcErr: any) {
            remainingSessionDisconnect = true;
            sessionDisconnectError = dcErr?.message || 'Gagal memutuskan sesi aktif tertunda';
          }
        }

        if (remainingOldAccounts.length > 0 || remainingSessionDisconnect) {
          const parts: string[] = [
            `Status akun '${cleanUsername}' di router diubah menjadi ${isDisabled ? 'nonaktif (disabled)' : 'aktif'}`,
          ];
          if (cleanupErrors.length > 0) {
            parts.push(`pembersihan akun lama tertunda gagal: ${cleanupErrors[0]}`);
          }
          if (remainingSessionDisconnect) {
            parts.push(`pemutusan sesi aktif tertunda gagal: ${sessionDisconnectError}`);
          }
          const partialMsg = appendPendingMarkers(`${parts.join('; ')}.`, {
            needsSessionDisconnect: remainingSessionDisconnect,
            oldAccounts: remainingOldAccounts,
            stages: {
              accountProvisioned: true,
              accountVerified: true,
              oldAccountsPending: remainingOldAccounts.length,
              sessionDisconnectPending: remainingSessionDisconnect,
            },
          });
          if (schema.customers) {
            await query(
              `UPDATE customers SET router_sync_status = 'failed', router_last_sync_at = CURRENT_TIMESTAMP, router_last_sync_message = $1 WHERE id = $2`,
              [partialMsg, id]
            );
            updatedCustomer.routerSyncStatus = 'failed';
            updatedCustomer.routerLastSyncAt = new Date().toISOString();
            updatedCustomer.routerLastSyncMessage = partialMsg;
          }
        } else if (schema.customers) {
          const syncNotes: string[] = [];
          if (pendingOldAccounts.length > 0) {
            syncNotes.push('pembersihan akun lama selesai');
          }
          if (pendingDisconnect) {
            syncNotes.push('seluruh sesi aktif diperiksa & diputus');
          }
          const syncMsg = `Status akun di router berhasil diubah menjadi ${isDisabled ? 'nonaktif (disabled)' : 'aktif'}${
            syncNotes.length > 0 ? ` (${syncNotes.join(', ')})` : ''
          }.`;
          await query(
            `UPDATE customers SET router_sync_status = 'synced', router_last_sync_at = CURRENT_TIMESTAMP, router_last_sync_message = $1 WHERE id = $2`,
            [syncMsg, id]
          );
          updatedCustomer.routerSyncStatus = 'synced';
          updatedCustomer.routerLastSyncAt = new Date().toISOString();
          updatedCustomer.routerLastSyncMessage = syncMsg;
        }
      } catch (routerErr: any) {
        const errMsg = appendPendingMarkers(
          `Gagal mengubah status di router: ${routerErr?.message || 'Error'}`,
          {
            needsSessionDisconnect: pendingDisconnect,
            oldAccounts: pendingOldAccounts,
            stages: {
              accountProvisioned: true,
              accountVerified: false,
              oldAccountsPending: pendingOldAccounts.length,
              sessionDisconnectPending: pendingDisconnect,
            },
          }
        );
        if (schema.customers) {
          await query(
            `UPDATE customers SET router_sync_status = 'failed', router_last_sync_at = CURRENT_TIMESTAMP, router_last_sync_message = $1 WHERE id = $2`,
            [errMsg, id]
          );
          updatedCustomer.routerSyncStatus = 'failed';
          updatedCustomer.routerLastSyncAt = new Date().toISOString();
          updatedCustomer.routerLastSyncMessage = errMsg;
        }
      }
    }

    res.json({ success: true, message: `Status pelanggan berhasil diubah menjadi ${status}.`, data: updatedCustomer });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Gagal mengubah status pelanggan: ' + error.message });
  }
});

// Endpoint sinkronisasi manual / retry ke MikroTik RouterOS
router.post('/customers/:id/sync-router', async (req: Request, res: Response) => {
  let prevPending: PendingSyncActions = { needsSessionDisconnect: false, oldAccounts: [], corrupted: false };
  let schemaCustomers = false;

  try {
    const { id } = req.params;
    const schema = await detectMigration003Fields();
    schemaCustomers = schema.customers;

    const custRes = await query('SELECT * FROM customers WHERE id = $1 AND is_deleted IS NOT TRUE', [id]);
    if (custRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Pelanggan tidak ditemukan.' });
    }
    const customer = custRes.rows[0];
    const targetType: 'pppoe' | 'hotspot' =
      (customer.type as string)?.toLowerCase() === 'hotspot' ? 'hotspot' : 'pppoe';
    const isHotspot = targetType === 'hotspot';
    const cleanUsername = (customer.username || '').trim();
    const isDisabled = customer.status !== 'active';

    // Baca kondisi sinkronisasi terakhir pelanggan untuk menentukan operasi wajib yang tertunda
    const parsedPrev = parsePendingSyncActions(customer.router_sync_status, customer.router_last_sync_message);
    const pendingOldAccounts = mergeOldAccounts([parsedPrev.oldAccounts], {
      type: targetType,
      username: cleanUsername,
    });
    const needsSessionDisconnect = parsedPrev.needsSessionDisconnect || isDisabled;
    prevPending = {
      needsSessionDisconnect,
      oldAccounts: pendingOldAccounts,
      corrupted: parsedPrev.corrupted,
      corruptedReason: parsedPrev.corruptedReason,
    };

    // Jika data penanda rusak / korup -> gagalkan dengan aman & jangan menandai synced
    if (parsedPrev.corrupted) {
      const corruptMsg = appendPendingMarkers(
        `Penanda pekerjaan sinkronisasi sebelumnya rusak (${parsedPrev.corruptedReason || 'format tidak valid'}). Harap periksa status akun di router secara manual sebelum melanjutkan.`,
        {
          needsSessionDisconnect: true,
          oldAccounts: pendingOldAccounts,
          corrupted: true,
        }
      );
      const nowIso = new Date().toISOString();
      if (schema.customers) {
        await query(
          `UPDATE customers SET router_sync_status = 'failed', router_last_sync_at = CURRENT_TIMESTAMP, router_last_sync_message = $1 WHERE id = $2`,
          [corruptMsg, id]
        );
      }
      return res.status(422).json({
        success: false,
        message: corruptMsg,
        data: {
          id: customer.id,
          username: cleanUsername,
          routerSyncStatus: 'failed',
          routerLastSyncAt: nowIso,
          routerLastSyncMessage: corruptMsg,
        },
      });
    }

    // Cek password pelanggan
    if (!customer.password_encrypted) {
      return res.status(400).json({
        success: false,
        message: 'Password pelanggan belum diatur. Silakan buka form Edit Pelanggan dan masukkan password terlebih dahulu.',
      });
    }

    if (!isMikrotikEncryptionKeyConfigured()) {
      return res.status(500).json({
        success: false,
        message: 'MIKROTIK_ENCRYPTION_KEY belum dikonfigurasi di file .env server. Password tidak dapat didekripsi.',
      });
    }

    let rawPassword = '';
    try {
      rawPassword = decryptMikrotikPassword(customer.password_encrypted);
      const pwdValidation = validateCustomerPassword(rawPassword);
      if (!pwdValidation.valid) {
        return res.status(400).json({
          success: false,
          message: `Password pelanggan tersimpan tidak valid: ${pwdValidation.message}. Harap perbarui password di menu Edit Pelanggan.`,
        });
      }
    } catch {
      return res.status(500).json({
        success: false,
        message: 'Gagal mendekripsi password pelanggan. Format atau kunci enkripsi tidak cocok.',
      });
    }

    // Cek koneksi router
    const routerOptions = await getActiveRouterOptions();
    if (!routerOptions) {
      const errMsg = appendPendingMarkers(
        'Router MikroTik belum terhubung atau password API router belum tersimpan di menu Konfigurasi MikroTik.',
        { needsSessionDisconnect, oldAccounts: pendingOldAccounts }
      );
      if (schema.customers) {
        await query(`UPDATE customers SET router_sync_status = 'failed', router_last_sync_at = CURRENT_TIMESTAMP, router_last_sync_message = $1 WHERE id = $2`, [errMsg, id]);
      }
      return res.status(503).json({
        success: false,
        message: errMsg,
        data: { id: customer.id, username: cleanUsername, routerSyncStatus: 'failed', routerLastSyncMessage: errMsg },
      });
    }

    // Ambil profile paket
    let profileToUse: string | null = null;
    if (schema.packages) {
      const pkgRes = await query('SELECT pppoe_profile, hotspot_profile FROM packages WHERE id = $1', [customer.package_id]);
      if (pkgRes.rows.length > 0) {
        profileToUse = isHotspot ? pkgRes.rows[0].hotspot_profile : pkgRes.rows[0].pppoe_profile;
      }
    }

    if (!profileToUse || !profileToUse.trim()) {
      const errMsg = appendPendingMarkers(
        `Profile ${isHotspot ? 'Hotspot' : 'PPPoE'} belum ditentukan pada paket internet. Silakan tentukan profile di menu Paket Internet.`,
        { needsSessionDisconnect, oldAccounts: pendingOldAccounts }
      );
      if (schema.customers) {
        await query(`UPDATE customers SET router_sync_status = 'failed', router_last_sync_at = CURRENT_TIMESTAMP, router_last_sync_message = $1 WHERE id = $2`, [errMsg, id]);
      }
      return res.status(400).json({
        success: false,
        message: errMsg,
        data: { id: customer.id, username: cleanUsername, routerSyncStatus: 'failed', routerLastSyncMessage: errMsg },
      });
    }

    const cleanProfile = profileToUse.trim();

    // Verifikasi profile ada di router
    const profileCheck = await checkProfileExists(routerOptions, cleanProfile, targetType);
    if (!profileCheck.exists) {
      const errMsg = appendPendingMarkers(profileCheck.message, {
        needsSessionDisconnect,
        oldAccounts: pendingOldAccounts,
      });
      if (schema.customers) {
        await query(`UPDATE customers SET router_sync_status = 'failed', router_last_sync_at = CURRENT_TIMESTAMP, router_last_sync_message = $1 WHERE id = $2`, [errMsg, id]);
      }
      return res.status(400).json({
        success: false,
        message: errMsg,
        data: { id: customer.id, username: cleanUsername, routerSyncStatus: 'failed', routerLastSyncMessage: errMsg },
      });
    }

    // TAHAP 1: Eksekusi provisioning idempotent (ADD atau SET tanpa duplikasi, menolak jika akun duplikat)
    let provResult;
    if (isHotspot) {
      provResult = await createOrUpdateHotspotUser(routerOptions, {
        username: cleanUsername,
        password: rawPassword,
        profile: cleanProfile,
        disabled: isDisabled,
      });
    } else {
      provResult = await createOrUpdatePppoeSecret(routerOptions, {
        username: cleanUsername,
        password: rawPassword,
        profile: cleanProfile,
        ipAddress: customer.ip_address || undefined,
        disabled: isDisabled,
      });
    }

    if (provResult.profileChanged) {
      prevPending.needsSessionDisconnect = true;
    }

    // TAHAP 2: Verifikasi akun tunggal benar-benar ada & sesuai (profile + status disabled) di RouterOS
    const verifyRes = isHotspot
      ? await verifyHotspotUserExists(routerOptions, cleanUsername, cleanProfile, isDisabled)
      : await verifyPppoeSecretExists(routerOptions, cleanUsername, cleanProfile, isDisabled);
    if (!verifyRes.verified) {
      throw new Error(verifyRes.message);
    }

    // TAHAP 3: Ulangi pembersihan akun lama jika kegagalan sebelumnya meninggalkan akun lama / sesi akun lama
    const failedOldAccounts: PendingRouterAccount[] = [];
    const cleanupErrors: string[] = [];
    for (const oldAcc of pendingOldAccounts) {
      const cleanupRes = await cleanupOldRouterAccount(routerOptions, oldAcc.type, oldAcc.username);
      if (!cleanupRes.success) {
        failedOldAccounts.push(oldAcc);
        cleanupErrors.push(cleanupRes.message);
      }
    }

    // TAHAP 4: Putuskan sesi aktif hanya jika ada alasan operasional yang jelas:
    // (a) needsSessionDisconnect dari penanda tertunda, (b) status isolated/inactive, atau (c) perubahan profile terdeteksi
    const shouldDisconnectTargetSession = needsSessionDisconnect || Boolean(provResult.profileChanged);
    let sessionDisconnectFailed = false;
    let sessionDisconnectError = '';
    let sessionDisconnectSummary = shouldDisconnectTargetSession
      ? 'pemeriksaan sesi aktif selesai (tidak ada sesi aktif)'
      : 'sesi aktif pelanggan tidak diputus (pelanggan active tanpa pekerjaan pemutusan sesi tertunda)';

    if (shouldDisconnectTargetSession) {
      try {
        const dcRes = isHotspot
          ? await disconnectHotspotSession(routerOptions, cleanUsername)
          : await disconnectPppoeSession(routerOptions, cleanUsername);
        if (!dcRes.success) {
          sessionDisconnectFailed = true;
          sessionDisconnectError = dcRes.message;
        } else if (dcRes.disconnectedCount > 0) {
          sessionDisconnectSummary = `${dcRes.disconnectedCount} sesi aktif diputus`;
        }
      } catch (dcErr: any) {
        sessionDisconnectFailed = true;
        sessionDisconnectError = dcErr?.message || 'Gagal memutuskan sesi aktif';
      }
    }

    if (failedOldAccounts.length > 0 || sessionDisconnectFailed) {
      const parts: string[] = [
        `Akun '${cleanUsername}' (${provResult.action.toUpperCase()}) terverifikasi di router`,
      ];
      if (pendingOldAccounts.length > 0 && failedOldAccounts.length === 0) {
        parts.push('pembersihan akun lama selesai');
      }
      if (cleanupErrors.length > 0) {
        parts.push(`pembersihan akun lama gagal: ${cleanupErrors[0]}`);
      }
      if (sessionDisconnectFailed) {
        parts.push(`pemutusan sesi aktif '${cleanUsername}' gagal: ${sessionDisconnectError}`);
      }
      const partialMsg = appendPendingMarkers(`${parts.join('; ')}.`, {
        needsSessionDisconnect: sessionDisconnectFailed,
        oldAccounts: failedOldAccounts,
        stages: {
          accountProvisioned: true,
          accountVerified: true,
          oldAccountsPending: failedOldAccounts.length,
          sessionDisconnectPending: sessionDisconnectFailed,
        },
      });
      const nowIso = new Date().toISOString();
      if (schema.customers) {
        await query(
          `UPDATE customers 
           SET router_sync_status = 'failed', 
               router_last_sync_at = CURRENT_TIMESTAMP, 
               router_last_sync_message = $1 
           WHERE id = $2`,
          [partialMsg, id]
        );
      }
      return res.status(502).json({
        success: false,
        message: partialMsg,
        data: {
          id: customer.id,
          username: cleanUsername,
          routerSyncStatus: 'failed',
          routerLastSyncAt: nowIso,
          routerLastSyncMessage: partialMsg,
        },
      });
    }

    const finalDetails: string[] = [];
    if (pendingOldAccounts.length > 0) {
      finalDetails.push('pembersihan akun lama selesai');
    }
    finalDetails.push(sessionDisconnectSummary);
    const finalMsg = `${provResult.message} (${finalDetails.join(', ')})`;
    const nowIso = new Date().toISOString();

    if (schema.customers) {
      await query(
        `UPDATE customers 
         SET router_sync_status = 'synced', 
             router_last_sync_at = CURRENT_TIMESTAMP, 
             router_last_sync_message = $1 
         WHERE id = $2`,
        [finalMsg, id]
      );
    }

    res.json({
      success: true,
      message: `Akun '${cleanUsername}' berhasil disinkronkan ke router MikroTik (${provResult.action.toUpperCase()}).`,
      data: {
        id: customer.id,
        username: cleanUsername,
        routerSyncStatus: 'synced',
        routerLastSyncAt: nowIso,
        routerLastSyncMessage: finalMsg,
      },
    });
  } catch (error: any) {
    const safeErrorMsg = appendPendingMarkers(
      `Gagal sinkronisasi router: ${error?.message || 'Error tidak diketahui'}`,
      prevPending
    );
    try {
      if (schemaCustomers) {
        await query(
          `UPDATE customers 
           SET router_sync_status = 'failed', 
               router_last_sync_at = CURRENT_TIMESTAMP, 
               router_last_sync_message = $1 
           WHERE id = $2`,
          [safeErrorMsg, req.params.id]
        );
      }
    } catch {
      // ignore
    }
    res.status(500).json({
      success: false,
      message: safeErrorMsg,
      data: {
        id: req.params.id,
        routerSyncStatus: 'failed',
        routerLastSyncAt: new Date().toISOString(),
        routerLastSyncMessage: safeErrorMsg,
      },
    });
  }
});

router.delete('/customers/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Strategi pengamanan data keuangan:
    // 1. Lepaskan relasi customer_id pada invoice, payment, dan log agar arsip keuangan tidak terhapus.
    // 2. Tandai pelanggan sebagai is_deleted = TRUE (soft-delete) untuk audit log, atau aman jika dihapus.
    await withTransaction(async (client) => {
      await client.query('UPDATE invoices SET customer_id = NULL WHERE customer_id = $1', [id]);
      await client.query('UPDATE payments SET customer_id = NULL WHERE customer_id = $1', [id]);
      await client.query('UPDATE whatsapp_logs SET customer_id = NULL WHERE customer_id = $1', [id]);
      await client.query('UPDATE broadcast_recipients SET customer_id = NULL WHERE customer_id = $1', [id]);
      await client.query('UPDATE customers SET is_deleted = TRUE, deleted_at = CURRENT_TIMESTAMP WHERE id = $1', [id]);
    });

    res.json({
      success: true,
      message: 'Pelanggan berhasil dihapus. Seluruh arsip invoice dan riwayat pembayaran dipertahankan secara utuh.',
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Gagal menghapus pelanggan: ' + error.message });
  }
});

// ============================================================================
// 4. TAGIHAN (INVOICES) (CRUD)
// ============================================================================
router.get('/invoices', async (_req: Request, res: Response) => {
  try {
    const result = await query(`
      SELECT 
        id, 
        invoice_number AS "invoiceNumber", 
        customer_id AS "customerId", 
        customer_name AS "customerName", 
        customer_phone AS "customerPhone", 
        package_name AS "packageName", 
        amount::float AS amount, 
        paid_amount::float AS "paidAmount", 
        remaining_amount::float AS "remainingAmount", 
        month_period AS "monthPeriod", 
        due_date::text AS "dueDate", 
        status, 
        created_at::text AS "createdAt", 
        paid_at AS "paidAt", 
        payment_method AS "paymentMethod",
        is_prorata AS "isProrata",
        service_period_start::text AS "servicePeriodStart",
        service_period_end::text AS "servicePeriodEnd",
        prorata_days AS "prorataDays",
        period_total_days AS "periodTotalDays",
        prorata_calculation_note AS "prorataCalculationNote"
      FROM invoices
      ORDER BY due_date DESC, invoice_number DESC
    `);
    res.json({ success: true, data: result.rows });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Gagal mengambil tagihan dari PostgreSQL: ' + error.message });
  }
});

router.post('/invoices', async (req: Request, res: Response) => {
  try {
    const inv = req.body;
    if (!inv.id || !inv.invoiceNumber || !inv.customerId || inv.amount === undefined) {
      return res.status(400).json({ success: false, message: 'Nomor tagihan, pelanggan, dan nominal wajib diisi.' });
    }

    const totalAmount = Number(inv.amount);
    if (!Number.isFinite(totalAmount) || totalAmount < 0) {
      return res.status(400).json({
        success: false,
        message: 'Nominal tagihan (amount) tidak valid. Harus berupa angka positif atau nol.',
      });
    }

    // Tentukan paidAmount secara valid dan aman
    let paidAmount = 0;
    if (inv.paidAmount !== undefined && inv.paidAmount !== null && inv.paidAmount !== '') {
      const parsedPaid = Number(inv.paidAmount);
      if (!Number.isFinite(parsedPaid) || parsedPaid < 0) {
        return res.status(400).json({
          success: false,
          message: 'Nominal pembayaran (paidAmount) tidak valid. Tidak boleh bernilai negatif.',
        });
      }
      if (parsedPaid > totalAmount) {
        return res.status(400).json({
          success: false,
          message: `Nominal pembayaran (Rp ${parsedPaid.toLocaleString('id-ID')}) melebihi total tagihan (Rp ${totalAmount.toLocaleString('id-ID')}).`,
        });
      }
      paidAmount = parsedPaid;
    } else if (inv.status === 'paid') {
      // Jika status paid dan nilai pembayaran tidak diberikan, ikuti totalAmount
      paidAmount = totalAmount;
    }

    // remainingAmount SELALU dihitung dari totalAmount - paidAmount untuk memenuhi constraint chk_invoice_remaining_amount
    const remainingAmount = Math.max(0, totalAmount - paidAmount);

    let effectiveStatus = inv.status || 'unpaid';
    if (remainingAmount === 0 && totalAmount > 0) {
      effectiveStatus = 'paid';
    } else if (remainingAmount > 0 && effectiveStatus === 'paid') {
      effectiveStatus = 'unpaid';
    }

    const result = await query(
      `
      INSERT INTO invoices (
        id, invoice_number, customer_id, customer_name, customer_phone, package_name,
        amount, paid_amount, remaining_amount, month_period, due_date, status,
        created_at, paid_at, payment_method, is_prorata, service_period_start,
        service_period_end, prorata_days, period_total_days, prorata_calculation_note
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
      ON CONFLICT (id) DO UPDATE SET
        invoice_number = EXCLUDED.invoice_number,
        customer_name = EXCLUDED.customer_name,
        customer_phone = EXCLUDED.customer_phone,
        package_name = EXCLUDED.package_name,
        amount = EXCLUDED.amount,
        paid_amount = EXCLUDED.paid_amount,
        remaining_amount = EXCLUDED.remaining_amount,
        month_period = EXCLUDED.month_period,
        due_date = EXCLUDED.due_date,
        status = EXCLUDED.status,
        paid_at = EXCLUDED.paid_at,
        payment_method = EXCLUDED.payment_method,
        updated_at = CURRENT_TIMESTAMP
      RETURNING 
        id, invoice_number AS "invoiceNumber", customer_id AS "customerId",
        customer_name AS "customerName", customer_phone AS "customerPhone",
        package_name AS "packageName", amount::float AS amount,
        paid_amount::float AS "paidAmount", remaining_amount::float AS "remainingAmount",
        month_period AS "monthPeriod", due_date::text AS "dueDate", status,
        created_at::text AS "createdAt", paid_at AS "paidAt", payment_method AS "paymentMethod"
      `,
      [
        inv.id,
        inv.invoiceNumber,
        inv.customerId,
        inv.customerName || 'Pelanggan',
        inv.customerPhone || '',
        inv.packageName || 'Paket Internet',
        totalAmount,
        paidAmount,
        remainingAmount,
        inv.monthPeriod || 'Periode Baru',
        inv.dueDate || new Date().toISOString().split('T')[0],
        effectiveStatus,
        inv.createdAt || new Date().toISOString().split('T')[0],
        inv.paidAt || null,
        inv.paymentMethod || null,
        Boolean(inv.isProrata),
        inv.servicePeriodStart || null,
        inv.servicePeriodEnd || null,
        inv.prorataDays || null,
        inv.periodTotalDays || null,
        inv.prorataCalculationNote || null,
      ]
    );

    if (!result.rows || result.rows.length === 0) {
      return res.status(500).json({ success: false, message: 'Gagal membuat tagihan: database tidak mengembalikan data.' });
    }

    res.json({ success: true, message: 'Tagihan berhasil disimpan ke PostgreSQL.', data: result.rows[0] });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Gagal membuat tagihan: ' + error.message });
  }
});

router.put('/invoices/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const inv = req.body;

    const result = await query(
      `
      UPDATE invoices SET
        invoice_number = COALESCE($1, invoice_number),
        customer_name = COALESCE($2, customer_name),
        customer_phone = COALESCE($3, customer_phone),
        package_name = COALESCE($4, package_name),
        amount = COALESCE($5, amount),
        paid_amount = COALESCE($6, paid_amount),
        remaining_amount = COALESCE($7, remaining_amount),
        month_period = COALESCE($8, month_period),
        due_date = COALESCE($9, due_date),
        status = COALESCE($10, status),
        paid_at = COALESCE($11, paid_at),
        payment_method = COALESCE($12, payment_method),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $13
      RETURNING 
        id, invoice_number AS "invoiceNumber", customer_id AS "customerId",
        customer_name AS "customerName", customer_phone AS "customerPhone",
        package_name AS "packageName", amount::float AS amount,
        paid_amount::float AS "paidAmount", remaining_amount::float AS "remainingAmount",
        month_period AS "monthPeriod", due_date::text AS "dueDate", status,
        created_at::text AS "createdAt", paid_at AS "paidAt", payment_method AS "paymentMethod"
      `,
      [
        inv.invoiceNumber,
        inv.customerName,
        inv.customerPhone,
        inv.packageName,
        inv.amount !== undefined ? Number(inv.amount) : null,
        inv.paidAmount !== undefined ? Number(inv.paidAmount) : null,
        inv.remainingAmount !== undefined ? Number(inv.remainingAmount) : null,
        inv.monthPeriod,
        inv.dueDate,
        inv.status,
        inv.paidAt,
        inv.paymentMethod,
        id,
      ]
    );

    if (!result.rows || result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Tagihan tidak ditemukan.' });
    }

    res.json({ success: true, message: 'Tagihan berhasil diperbarui di PostgreSQL.', data: result.rows[0] });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Gagal memperbarui tagihan: ' + error.message });
  }
});

router.delete('/invoices/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Proteksi data keuangan: Cegah penghapusan jika tagihan sudah memiliki riwayat pembayaran
    const payCheck = await query('SELECT COUNT(*) AS count FROM payments WHERE invoice_id = $1', [id]);
    if (parseInt(payCheck.rows[0].count, 10) > 0) {
      return res.status(400).json({
        success: false,
        message: 'Tagihan tidak dapat dihapus karena sudah memiliki riwayat transaksi pembayaran. Data keuangan dilindungi.',
      });
    }

    await query('DELETE FROM invoices WHERE id = $1', [id]);
    res.json({ success: true, message: 'Tagihan berhasil dihapus dari database.' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Gagal menghapus tagihan: ' + error.message });
  }
});

// ============================================================================
// 5. PEMBAYARAN & PEMBAYARAN SEBAGIAN (TRANSAKSI ATOMIK)
// ============================================================================
router.get('/payments', async (_req: Request, res: Response) => {
  try {
    const result = await query(`
      SELECT 
        id, 
        transaction_number AS "transactionNumber", 
        invoice_id AS "invoiceId", 
        invoice_number AS "invoiceNumber", 
        customer_id AS "customerId", 
        customer_name AS "customerName", 
        amount::float AS amount, 
        method, 
        notes, 
        paid_at AS "paidAt", 
        receipt_number AS "receiptNumber", 
        receiver_name AS "receiverName", 
        is_partial AS "isPartial",
        created_at AS "createdAt"
      FROM payments
      ORDER BY paid_at DESC, transaction_number DESC
    `);
    res.json({ success: true, data: result.rows });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Gagal mengambil data pembayaran: ' + error.message });
  }
});

/**
 * Mencatat transaksi pembayaran dengan locking FOR UPDATE dan transaksi atomik
 */
router.post('/payments', async (req: Request, res: Response) => {
  try {
    const { invoiceId, amount, method, notes, receiverName } = req.body;

    if (!invoiceId) {
      return res.status(400).json({ success: false, message: 'ID tagihan wajib diisi.' });
    }

    const payAmount = Number(amount);
    if (!Number.isFinite(payAmount) || payAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Nominal pembayaran tidak valid. Nominal harus berupa angka finite lebih besar dari 0.',
      });
    }

    // Jalankan seluruh proses pembayaran dalam 1 database transaction atomik
    const paymentResult = await withTransaction(async (client) => {
      // 1. Kunci pembuatan nomor transaksi dengan pg_advisory_xact_lock
      // Mengunci konkurensi antar admin sehingga nomor transaksi dijamin unik dan atomik
      await client.query("SELECT pg_advisory_xact_lock(hashtext('payment_transaction_number'))");

      // 2. Kunci baris invoice dengan FOR UPDATE untuk mencegah race condition pembayaran ganda
      const invCheck = await client.query(
        'SELECT * FROM invoices WHERE id = $1 FOR UPDATE',
        [invoiceId]
      );

      if (invCheck.rows.length === 0) {
        throw new Error('Tagihan tidak ditemukan dalam sistem.');
      }

      const inv = invCheck.rows[0];
      const invTotal = Number(inv.amount);
      const invPaidAmount = Number(inv.paid_amount) || 0;
      const invRemainingAmount = Number(inv.remaining_amount) !== undefined 
        ? Number(inv.remaining_amount) 
        : Math.max(0, invTotal - invPaidAmount);

      // 3. Verifikasi konsistensi keuangan antara tabel payments dan invoices
      const sumPaymentsRes = await client.query(
        'SELECT COALESCE(SUM(amount), 0) AS total_paid FROM payments WHERE invoice_id = $1',
        [invoiceId]
      );
      const totalRecordedPayments = Number(sumPaymentsRes.rows[0].total_paid) || 0;

      // Audit A: Periksa apakah total pembayaran di tabel payments sama persis dengan invoices.paid_amount
      if (Math.abs(totalRecordedPayments - invPaidAmount) > 0.01) {
        throw new Error(
          `Inkonsistensi data keuangan terdeteksi pada tagihan ${inv.invoice_number}: total pembayaran riwayat (Rp ${totalRecordedPayments.toLocaleString('id-ID')}) tidak sama dengan paid_amount tagihan (Rp ${invPaidAmount.toLocaleString('id-ID')}). Transaksi dibatalkan untuk melindungi integritas buku besar.`
        );
      }

      // Audit B: Periksa apakah invoices.remaining_amount sama dengan (amount - totalRecordedPayments)
      const expectedRemaining = Math.max(0, invTotal - totalRecordedPayments);
      if (Math.abs(invRemainingAmount - expectedRemaining) > 0.01) {
        throw new Error(
          `Inkonsistensi data keuangan terdeteksi pada tagihan ${inv.invoice_number}: remaining_amount tagihan (Rp ${invRemainingAmount.toLocaleString('id-ID')}) tidak sama dengan sisa tagihan terverifikasi (Rp ${expectedRemaining.toLocaleString('id-ID')}). Transaksi dibatalkan untuk melindungi integritas buku besar.`
        );
      }

      // Validasi status lunas dan sisa tagihan
      if (inv.status === 'paid' || expectedRemaining <= 0) {
        throw new Error('Tagihan ini sudah lunas. Tidak dapat menerima pembayaran tambahan.');
      }

      // Validasi overpayment
      if (totalRecordedPayments + payAmount > invTotal || payAmount > expectedRemaining) {
        throw new Error(
          `Nominal pembayaran (Rp ${payAmount.toLocaleString('id-ID')}) melebihi sisa tagihan terverifikasi (Maksimal: Rp ${expectedRemaining.toLocaleString('id-ID')}). Transaksi ditolak.`
        );
      }

      // Hitung nilai baru berdasarkan data yang telah diverifikasi konsistensinya
      const newPaid = totalRecordedPayments + payAmount;
      const newRemaining = Math.max(0, invTotal - newPaid);
      const isFullyPaid = newRemaining === 0;
      const isPartial = !isFullyPaid;
      const newStatus = isFullyPaid ? 'paid' : inv.status;

      // 4. Update status dan nominal invoice di PostgreSQL
      const updInvRes = await client.query(
        `
        UPDATE invoices SET
          paid_amount = $1,
          remaining_amount = $2,
          status = $3,
          paid_at = CURRENT_TIMESTAMP,
          payment_method = $4,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $5
        RETURNING 
          id, 
          invoice_number AS "invoiceNumber", 
          customer_id AS "customerId", 
          customer_name AS "customerName", 
          customer_phone AS "customerPhone", 
          package_name AS "packageName", 
          amount::float AS amount, 
          paid_amount::float AS "paidAmount", 
          remaining_amount::float AS "remainingAmount", 
          month_period AS "monthPeriod", 
          due_date::text AS "dueDate", 
          status, 
          created_at::text AS "createdAt", 
          paid_at AS "paidAt", 
          payment_method AS "paymentMethod",
          is_prorata AS "isProrata",
          service_period_start::text AS "servicePeriodStart",
          service_period_end::text AS "servicePeriodEnd",
          prorata_days AS "prorataDays",
          period_total_days AS "periodTotalDays",
          prorata_calculation_note AS "prorataCalculationNote"
        `,
        [newPaid, newRemaining, newStatus, method || 'cash', invoiceId]
      );

      if (!updInvRes.rows || updInvRes.rows.length === 0) {
        throw new Error('Database gagal memperbarui baris data tagihan.');
      }

      // 5. Generate nomor transaksi unik berbasis zona waktu lokal Asia/Jakarta (WIB)
      const jakartaDateStr = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Jakarta',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());
      const datePart = jakartaDateStr.replace(/-/g, '');
      const prefix = `TRX-${datePart}-`;

      // Ekstraksi nomor urut dengan penanganan aman data historis nonnumerik
      const maxSeqRes = await client.query(
        `
        SELECT COALESCE(
          MAX(
            CASE 
              WHEN SUBSTRING(transaction_number FROM length($1) + 1) ~ '^[0-9]+$' 
              THEN SUBSTRING(transaction_number FROM length($1) + 1)::integer
              ELSE 0
            END
          ),
          0
        ) AS max_seq
        FROM payments
        WHERE transaction_number LIKE $2
        `,
        [prefix, `${prefix}%`]
      );
      const nextSeq = (parseInt(maxSeqRes.rows[0]?.max_seq, 10) || 0) + 1;
      const trxNumber = `${prefix}${String(nextSeq).padStart(3, '0')}`;
      const paymentId = `pay-${datePart}-${String(nextSeq).padStart(3, '0')}`;

      // 6. Catat riwayat pembayaran ke tabel payments di PostgreSQL
      const insPay = await client.query(
        `
        INSERT INTO payments (
          id, transaction_number, invoice_id, invoice_number, customer_id, customer_name,
          amount, method, notes, receipt_number, receiver_name, is_partial
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING 
          id, transaction_number AS "transactionNumber", invoice_id AS "invoiceId",
          invoice_number AS "invoiceNumber", customer_id AS "customerId",
          customer_name AS "customerName", amount::float AS amount, method, notes,
          paid_at AS "paidAt", receipt_number AS "receiptNumber",
          receiver_name AS "receiverName", is_partial AS "isPartial",
          created_at AS "createdAt"
        `,
        [
          paymentId,
          trxNumber,
          inv.id,
          inv.invoice_number,
          inv.customer_id,
          inv.customer_name,
          payAmount,
          method || 'cash',
          notes || (isPartial ? `Pembayaran sebagian (Sisa: Rp ${newRemaining.toLocaleString('id-ID')})` : 'Pelunasan penuh'),
          trxNumber,
          receiverName || 'Admin Kasir',
          isPartial,
        ]
      );

      if (!insPay.rows || insPay.rows.length === 0) {
        throw new Error('Database gagal mencatat baris data pembayaran.');
      }

      // Kembalikan HANYA baris resmi dari PostgreSQL hasil RETURNING
      return {
        payment: insPay.rows[0],
        updatedInvoice: updInvRes.rows[0],
      };
    });

    // Respons sukses HANYA dikirimkan setelah withTransaction berhasil melakukan COMMIT
    res.json({
      success: true,
      message: 'Pembayaran berhasil dicatat di PostgreSQL.',
      data: paymentResult,
    });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// ============================================================================
// 6. TEMPLATE NOTIFIKASI WHATSAPP
// ============================================================================
router.get('/whatsapp/templates', async (_req: Request, res: Response) => {
  try {
    const result = await query(`
      SELECT 
        id, 
        name, 
        description, 
        is_enabled AS "isEnabled", 
        template_content AS "templateContent", 
        updated_at AS "updatedAt"
      FROM whatsapp_templates
      ORDER BY id ASC
    `);
    res.json({ success: true, data: result.rows });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Gagal mengambil template WhatsApp: ' + error.message });
  }
});

router.post('/whatsapp/templates', async (req: Request, res: Response) => {
  try {
    const { id, name, description, isEnabled, templateContent } = req.body;
    if (!id || !templateContent) {
      return res.status(400).json({ success: false, message: 'ID dan isi template wajib diisi.' });
    }

    const result = await query(
      `
      INSERT INTO whatsapp_templates (id, name, description, is_enabled, template_content, updated_at)
      VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        is_enabled = EXCLUDED.is_enabled,
        template_content = EXCLUDED.template_content,
        updated_at = CURRENT_TIMESTAMP
      RETURNING id, name, description, is_enabled AS "isEnabled", template_content AS "templateContent", updated_at AS "updatedAt"
      `,
      [id, name || id, description || '', isEnabled !== false, templateContent]
    );

    res.json({ success: true, message: 'Template WhatsApp berhasil disimpan.', data: result.rows[0] });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Gagal menyimpan template: ' + error.message });
  }
});

// ============================================================================
// 7. RIWAYAT PESAN WHATSAPP & BROADCAST
// ============================================================================
router.get('/whatsapp/logs', async (_req: Request, res: Response) => {
  try {
    const result = await query(`
      SELECT 
        id, 
        timestamp::text AS timestamp, 
        customer_name AS "customerName", 
        customer_id AS "customerId", 
        phone, 
        notification_type AS "notificationType", 
        notification_type_name AS "notificationTypeName", 
        message_content AS "messageContent", 
        status, 
        error_message AS "errorMessage", 
        reference_id AS "referenceId"
      FROM whatsapp_logs
      ORDER BY timestamp DESC
      LIMIT 200
    `);
    res.json({ success: true, data: result.rows });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Gagal mengambil riwayat pesan WhatsApp: ' + error.message });
  }
});

router.post('/whatsapp/logs', async (req: Request, res: Response) => {
  try {
    const log = req.body;
    if (!log.phone || !log.messageContent) {
      return res.status(400).json({ success: false, message: 'Nomor telepon dan isi pesan wajib diisi.' });
    }

    const logId = log.id || `walog-${randomUUID()}`;
    const logStatus = ['pending', 'sent', 'failed'].includes(log.status) ? log.status : 'pending';
    const result = await query(
      `
      INSERT INTO whatsapp_logs (
        id, timestamp, customer_name, customer_id, phone, notification_type,
        notification_type_name, message_content, status, error_message, reference_id
      ) VALUES ($1, COALESCE($2::timestamptz, CURRENT_TIMESTAMP), $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (id) DO UPDATE SET
        status = EXCLUDED.status,
        error_message = EXCLUDED.error_message,
        timestamp = EXCLUDED.timestamp
      RETURNING id, timestamp::text AS timestamp, customer_name AS "customerName",
        customer_id AS "customerId", phone, notification_type AS "notificationType",
        notification_type_name AS "notificationTypeName", message_content AS "messageContent",
        status, error_message AS "errorMessage", reference_id AS "referenceId"
      `,
      [
        logId,
        log.timestamp || null,
        log.customerName || 'Pelanggan',
        log.customerId || null,
        log.phone,
        log.notificationType || 'general',
        log.notificationTypeName || 'Notifikasi',
        log.messageContent,
        logStatus,
        log.errorMessage || null,
        log.referenceId || null,
      ]
    );

    res.json({ success: true, data: result.rows[0] });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Gagal mencatat log WhatsApp: ' + error.message });
  }
});

router.get('/whatsapp/broadcast-history', async (_req: Request, res: Response) => {
  try {
    const campaigns = await query(`
      SELECT 
        c.id, 
        c.title, 
        c.type, 
        c.type_name AS "typeName", 
        c.message_content AS "messageContent", 
        c.total_recipients AS "totalRecipients", 
        c.success_count AS "successCount", 
        c.failure_count AS "failureCount", 
        c.created_at::text AS "createdAt"
      FROM broadcast_campaigns c
      ORDER BY c.created_at DESC
      LIMIT 100
    `);

    // Ambil daftar penerima per kampanye
    const campaignList = await Promise.all(
      campaigns.rows.map(async (camp) => {
        const recipients = await query(
          `
          SELECT 
            customer_id AS "customerId", 
            customer_name AS "customerName", 
            phone, 
            status, 
            error_message AS "errorMessage", 
            sent_at::text AS "sentAt"
          FROM broadcast_recipients
          WHERE campaign_id = $1
          ORDER BY id ASC
          `,
          [camp.id]
        );
        return {
          ...camp,
          recipients: recipients.rows,
        };
      })
    );

    res.json({ success: true, data: campaignList });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Gagal mengambil riwayat broadcast: ' + error.message });
  }
});

router.post('/whatsapp/broadcast-history', async (req: Request, res: Response) => {
  try {
    const camp = req.body;
    if (!camp.id || !camp.title) {
      return res.status(400).json({ success: false, message: 'ID dan judul broadcast wajib diisi.' });
    }

    if (!Array.isArray(camp.recipients)) {
      return res.status(400).json({ success: false, message: 'Daftar penerima broadcast tidak valid.' });
    }
    if (camp.recipients.some((r: any) => !r.phone || !['sent', 'failed', 'pending'].includes(r.status))) {
      return res.status(400).json({ success: false, message: 'Data nomor atau status penerima broadcast tidak valid.' });
    }

    await withTransaction(async (client) => {
      await client.query('DELETE FROM broadcast_recipients WHERE campaign_id = $1', [camp.id]);
      await client.query(
        `
        INSERT INTO broadcast_campaigns (
          id, title, type, type_name, message_content, total_recipients, success_count, failure_count
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (id) DO UPDATE SET
          title = EXCLUDED.title,
          success_count = EXCLUDED.success_count,
          failure_count = EXCLUDED.failure_count
        `,
        [
          camp.id,
          camp.title,
          camp.type || 'announcement',
          camp.typeName || 'Pengumuman',
          camp.messageContent || '',
          Number(camp.totalRecipients) || 0,
          Number(camp.successCount) || 0,
          Number(camp.failureCount) || 0,
        ]
      );

      if (Array.isArray(camp.recipients)) {
        for (const r of camp.recipients) {
          await client.query(
            `
            INSERT INTO broadcast_recipients (
              campaign_id, customer_id, customer_name, phone, status, error_message, sent_at
            ) VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::timestamptz, CURRENT_TIMESTAMP))
            `,
            [camp.id, r.customerId || null, r.customerName || 'Pelanggan', r.phone, r.status || 'sent', r.errorMessage || null, r.sentAt || null]
          );
        }
      }
    });

    res.json({ success: true, message: 'Riwayat broadcast berhasil disimpan ke PostgreSQL.', data: camp });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Gagal menyimpan riwayat broadcast: ' + error.message });
  }
});

// ============================================================================
// 8. PENGATURAN OPERASIONAL & BISNIS
// ============================================================================
router.get('/settings/:key', async (req: Request, res: Response) => {
  try {
    const { key } = req.params;
    const result = await query('SELECT setting_value AS value FROM app_settings WHERE setting_key = $1', [key]);
    if (result.rows.length === 0) {
      return res.json({ success: true, data: null });
    }
    res.json({ success: true, data: result.rows[0].value });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Gagal mengambil pengaturan: ' + error.message });
  }
});

router.put('/settings/:key', async (req: Request, res: Response) => {
  try {
    const { key } = req.params;
    const { value } = req.body;

    await query(
      `
      INSERT INTO app_settings (setting_key, setting_value, updated_at)
      VALUES ($1, $2, CURRENT_TIMESTAMP)
      ON CONFLICT (setting_key) DO UPDATE SET
        setting_value = EXCLUDED.setting_value,
        updated_at = CURRENT_TIMESTAMP
      `,
      [key, JSON.stringify(value)]
    );

    res.json({ success: true, message: `Pengaturan ${key} berhasil disimpan ke PostgreSQL.` });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Gagal menyimpan pengaturan: ' + error.message });
  }
});

// ============================================================================
// 9. KONFIGURASI MIKROTIK ROUTEROS RB4011 (SINGLE ROUTER PER INSTALASI)
// Kredensial rahasia (password) diamankan menggunakan AES-256-GCM di backend,
// password tidak pernah dikirim ke frontend dalam bentuk teks polos.
// ============================================================================
router.get('/mikrotik/config', async (_req: Request, res: Response) => {
  try {
    const isEncKeyReady = isMikrotikEncryptionKeyConfigured();

    const result = await query(`
      SELECT 
        id,
        router_name AS "routerName",
        host,
        api_port AS "apiPort",
        username,
        status,
        model_target AS "modelTarget",
        ros_version_preview AS "rosVersionPreview",
        use_ssl AS "useSsl",
        timeout_seconds AS "timeoutSeconds",
        notes,
        last_tested_at AS "lastTestedAt",
        last_status_message AS "lastStatusMessage",
        (
          (password_encrypted IS NOT NULL AND password_encrypted != '') OR
          (password_hash IS NOT NULL AND password_hash != '')
        ) AS "isPasswordConfigured"
      FROM mikrotik_settings
      WHERE id = 'default'
      LIMIT 1
    `);

    if (result.rows.length === 0) {
      return res.json({
        success: true,
        data: {
          id: 'default',
          routerName: 'MikroTik RB4011',
          host: '192.168.88.1',
          apiPort: 8728,
          username: 'admin',
          status: 'disconnected',
          modelTarget: 'RB4011iGS+RM',
          rosVersionPreview: 'RouterOS v7.x',
          useSsl: false,
          timeoutSeconds: 10,
          notes: 'Router MikroTik RB4011 untuk gateway PPPoE & Hotspot',
          isPasswordConfigured: false,
          maskedPassword: '',
          isEncryptionKeyConfigured: isEncKeyReady,
        },
      });
    }

    const row = result.rows[0];
    res.json({
      success: true,
      data: {
        id: row.id,
        routerName: row.routerName,
        host: row.host,
        apiPort: row.apiPort,
        username: row.username,
        status: row.status || 'disconnected',
        modelTarget: row.modelTarget || 'RB4011iGS+RM',
        rosVersionPreview: row.rosVersionPreview || 'RouterOS v7.x',
        useSsl: Boolean(row.useSsl),
        timeoutSeconds: Number(row.timeoutSeconds) || 10,
        notes: row.notes || '',
        lastTestedAt: row.lastTestedAt,
        lastStatusMessage: row.lastStatusMessage,
        isPasswordConfigured: Boolean(row.isPasswordConfigured),
        // Proteksi keamanan: Hanya kirim mask placeholder jika password sudah tersimpan,
        // password asli atau password_encrypted TIDAK PERNAH dikirim ke frontend.
        maskedPassword: row.isPasswordConfigured ? '••••••••' : '',
        isEncryptionKeyConfigured: isEncKeyReady,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Gagal mengambil konfigurasi MikroTik: ' + error.message });
  }
});

router.post('/mikrotik/config', async (req: Request, res: Response) => {
  try {
    const {
      routerName,
      host,
      apiPort,
      username,
      password,
      modelTarget,
      rosVersionPreview,
      useSsl,
      timeoutSeconds,
      notes,
    } = req.body;

    // Validasi host dan port (mencegah SSRF & menjamin input valid)
    const cleanHost = validateRouterHost(host || '192.168.88.1');
    const cleanPort = validateRouterPort(apiPort ?? (useSsl ? 8729 : 8728));
    const cleanUsername = (username || 'admin').trim();
    if (!cleanUsername) {
      return res.status(400).json({ success: false, message: 'Username API MikroTik tidak boleh kosong.' });
    }

    // Periksa password_encrypted yang sudah ada di database backend
    const existing = await query(
      'SELECT password_encrypted, password_hash, status FROM mikrotik_settings WHERE id = $1',
      ['default']
    );
    let encryptedPasswordToStore: string | null = null;
    let currentStatus = 'disconnected';

    if (existing.rows.length > 0) {
      encryptedPasswordToStore = existing.rows[0].password_encrypted || existing.rows[0].password_hash || null;
      currentStatus = existing.rows[0].status || 'disconnected';
    }

    // Jika admin memasukkan password baru (bukan token placeholder)
    if (password && password !== '••••••••' && password.trim() !== '') {
      if (!isMikrotikEncryptionKeyConfigured()) {
        return res.status(400).json({
          success: false,
          message:
            'Kunci enkripsi MIKROTIK_ENCRYPTION_KEY belum dikonfigurasi di file .env server. Konfigurasikan MIKROTIK_ENCRYPTION_KEY terlebih dahulu sebelum menyimpan password router demi keamanan.',
        });
      }
      encryptedPasswordToStore = encryptMikrotikPassword(password.trim());
    }

    const cleanTimeout = Math.max(3, Math.min(30, Number(timeoutSeconds) || 10));

    await query(
      `
      INSERT INTO mikrotik_settings (
        id, router_name, host, api_port, username, password_encrypted, password_hash,
        status, model_target, ros_version_preview, use_ssl, timeout_seconds, notes, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $6, $7, $8, $9, $10, $11, $12, CURRENT_TIMESTAMP)
      ON CONFLICT (id) DO UPDATE SET
        router_name = EXCLUDED.router_name,
        host = EXCLUDED.host,
        api_port = EXCLUDED.api_port,
        username = EXCLUDED.username,
        password_encrypted = COALESCE($6, mikrotik_settings.password_encrypted),
        password_hash = COALESCE($6, mikrotik_settings.password_hash),
        model_target = EXCLUDED.model_target,
        ros_version_preview = EXCLUDED.ros_version_preview,
        use_ssl = EXCLUDED.use_ssl,
        timeout_seconds = EXCLUDED.timeout_seconds,
        notes = EXCLUDED.notes,
        updated_at = CURRENT_TIMESTAMP
      `,
      [
        'default',
        (routerName || 'MikroTik RB4011').trim(),
        cleanHost,
        cleanPort,
        cleanUsername,
        encryptedPasswordToStore,
        currentStatus,
        modelTarget || 'RB4011iGS+RM',
        rosVersionPreview || 'RouterOS v7.x',
        Boolean(useSsl),
        cleanTimeout,
        notes || '',
      ]
    );

    res.json({
      success: true,
      message: 'Konfigurasi MikroTik berhasil disimpan ke database PostgreSQL.',
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Gagal menyimpan konfigurasi MikroTik: ' + error.message });
  }
});

// Endpoint pengujian koneksi RouterOS API nyata
router.post('/mikrotik/test-connection', async (req: Request, res: Response) => {
  try {
    const {
      host: bodyHost,
      apiPort: bodyApiPort,
      username: bodyUsername,
      password: bodyPassword,
      useSsl: bodyUseSsl,
      timeoutSeconds: bodyTimeoutSeconds,
    } = req.body || {};

    // Ambil konfigurasi tersimpan dari database
    const savedConfigRes = await query(
      `SELECT host, api_port, username, password_encrypted, password_hash, use_ssl, timeout_seconds, ros_version_preview
       FROM mikrotik_settings WHERE id = 'default' LIMIT 1`
    );
    const dbRow = savedConfigRes.rows[0] || {};

    const targetHost = validateRouterHost(bodyHost || dbRow.host || '192.168.88.1');
    const targetUseSsl = bodyUseSsl !== undefined ? Boolean(bodyUseSsl) : Boolean(dbRow.use_ssl);
    const targetPort = validateRouterPort(bodyApiPort ?? dbRow.api_port ?? (targetUseSsl ? 8729 : 8728));
    const targetUsername = (bodyUsername || dbRow.username || 'admin').trim();
    const targetTimeout = Math.max(3, Math.min(30, Number(bodyTimeoutSeconds ?? dbRow.timeout_seconds ?? 10)));

    // Tentukan password untuk pengujian
    let rawPassword = '';
    if (bodyPassword && bodyPassword !== '••••••••' && bodyPassword.trim() !== '') {
      rawPassword = bodyPassword.trim();
    } else {
      const encryptedStored = dbRow.password_encrypted || dbRow.password_hash;
      if (!encryptedStored) {
        return res.status(400).json({
          success: false,
          message: 'Password akun API MikroTik belum dikonfigurasi. Masukkan password terlebih dahulu.',
        });
      }

      if (!isMikrotikEncryptionKeyConfigured()) {
        return res.status(400).json({
          success: false,
          message:
            'Kunci enkripsi MIKROTIK_ENCRYPTION_KEY belum dikonfigurasi di file .env server. Password tersimpan tidak dapat didekripsi.',
        });
      }

      try {
        rawPassword = decryptMikrotikPassword(encryptedStored);
      } catch {
        return res.status(500).json({
          success: false,
          message: 'Gagal mendeskripsi password router dari database. Periksa kesesuaian MIKROTIK_ENCRYPTION_KEY.',
        });
      }
    }

    // Eksekusi koneksi RouterOS API nyata
    const result = await testMikrotikConnection({
      host: targetHost,
      port: targetPort,
      username: targetUsername,
      password: rawPassword,
      useSsl: targetUseSsl,
      timeoutSeconds: targetTimeout,
    });

    if (result.success) {
      // Perbarui status router di database menjadi connected
      const versionDisplay = result.data?.version ? `RouterOS ${result.data.version}` : null;
      await query(
        `
        UPDATE mikrotik_settings
        SET
          status = 'connected',
          last_tested_at = CURRENT_TIMESTAMP,
          last_status_message = $1,
          ros_version_preview = COALESCE($2, ros_version_preview),
          updated_at = CURRENT_TIMESTAMP
        WHERE id = 'default'
        `,
        [result.message, versionDisplay]
      );

      res.json({
        success: true,
        message: result.message,
        data: result.data,
      });
    } else {
      // Perbarui status router di database menjadi disconnected
      await query(
        `
        UPDATE mikrotik_settings
        SET
          status = 'disconnected',
          last_tested_at = CURRENT_TIMESTAMP,
          last_status_message = $1,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = 'default'
        `,
        [result.message]
      );

      res.json({
        success: false,
        message: result.message,
        errorDetails: result.errorDetails,
      });
    }
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: 'Gagal menguji koneksi MikroTik: ' + error.message,
    });
  }
});

export default router;


