import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import pg from 'pg';

const TEST_ADMIN_USERNAME = 'adi_admin_test';
const TEST_ADMIN_PASSWORD = 'Strong!Admin#Pass2026_NoDefault';
const TEST_ADMIN_HASH = bcrypt.hashSync(TEST_ADMIN_PASSWORD, 10);
const TEST_SESSION_SECRET = 'ultra_secure_test_session_secret_value_at_least_64_characters_long_1234';

process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'auth_test_db_password_secret';
process.env.MIKROTIK_ENCRYPTION_KEY = process.env.MIKROTIK_ENCRYPTION_KEY || 'auth_test_mikrotik_enc_key_32bytes';
process.env.ADMIN_USERNAME = TEST_ADMIN_USERNAME;
process.env.ADMIN_PASSWORD_HASH = TEST_ADMIN_HASH;
process.env.SESSION_SECRET = TEST_SESSION_SECRET;
process.env.TRUST_PROXY = 'false';
process.env.COOKIE_SECURE = 'auto';

class MockAuthPostgresStore {
  adminSessions = new Map<string, { sess: any; expires_at: string }>();
  adminLoginAttempts = new Map<
    string,
    { attempt_count: number; window_started_at: string; locked_until: string | null }
  >();
  loginAttemptUpsertCount = 0;
  customers = [
    {
      id: 'cust-auth-1',
      name: 'Pelanggan Auth Test',
      phone: '08123456789',
      address: 'Jl. Merdeka 1',
      installationAddress: 'Jl. Merdeka 1',
      latitude: null,
      longitude: null,
      packageId: 'pkg-10m',
      packageName: 'Paket 10 Mbps',
      type: 'pppoe',
      username: 'user1',
      ipAddress: null,
      status: 'active',
      routerSyncStatus: 'synced',
      routerLastSyncAt: null,
      routerLastSyncMessage: 'OK',
      isPasswordConfigured: true,
      registeredAt: '2026-01-01T00:00:00.000Z',
      dueDateDay: 10,
      monthlyFee: 150000,
      installationDate: '2026-01-01',
    },
  ];
  packages = [
    {
      id: 'pkg-10m',
      name: 'Paket 10 Mbps',
      speed: '10M/10M',
      downloadSpeedMbps: 10,
      uploadSpeedMbps: 10,
      price: 150000,
      type: 'pppoe',
      validityDays: 30,
      activeUsersCount: 1,
      description: 'Paket Uji',
      pppoeProfile: 'prof-10m',
      hotspotProfile: null,
    },
  ];

  resetOperationalAndSessions() {
    this.adminSessions.clear();
    this.adminLoginAttempts.clear();
  }

  handleQuery(sql: string, params: any[] = []): { rows: any[]; rowCount: number } {
    const q = sql.replace(/\s+/g, ' ').trim();

    if (q === 'SELECT 1 AS healthcheck' || q === 'BEGIN' || q === 'COMMIT' || q === 'ROLLBACK') {
      return { rows: [{ healthcheck: 1 }], rowCount: 1 };
    }

    if (q.startsWith('SELECT sess, expires_at FROM admin_sessions WHERE sid_hash = $1')) {
      const entry = this.adminSessions.get(params[0]);
      return { rows: entry ? [{ sess: entry.sess, expires_at: entry.expires_at }] : [], rowCount: entry ? 1 : 0 };
    }

    if (q.startsWith('INSERT INTO admin_sessions')) {
      const sessObj = typeof params[1] === 'string' ? JSON.parse(params[1]) : params[1];
      this.adminSessions.set(params[0], { sess: sessObj, expires_at: String(params[2]) });
      return { rows: [], rowCount: 1 };
    }

    if (q.startsWith('DELETE FROM admin_sessions WHERE sid_hash = $1')) {
      const deleted = this.adminSessions.delete(params[0]);
      return { rows: [], rowCount: deleted ? 1 : 0 };
    }

    if (q.startsWith('DELETE FROM admin_sessions WHERE expires_at <=')) {
      const now = Date.now();
      for (const [k, v] of this.adminSessions.entries()) {
        if (new Date(v.expires_at).getTime() <= now) {
          this.adminSessions.delete(k);
        }
      }
      return { rows: [], rowCount: 0 };
    }

    if (q.startsWith('UPDATE admin_sessions SET updated_at')) {
      return { rows: [], rowCount: this.adminSessions.has(params[0]) ? 1 : 0 };
    }

    if (q.startsWith('SELECT attempt_count, window_started_at, locked_until FROM admin_login_attempts WHERE rate_key = $1')) {
      const entry = this.adminLoginAttempts.get(params[0]);
      return { rows: entry ? [{ ...entry }] : [], rowCount: entry ? 1 : 0 };
    }

    if (q.startsWith('INSERT INTO admin_login_attempts') && q.includes('RETURNING attempt_count, locked_until')) {
      this.loginAttemptUpsertCount += 1;
      const rateKey = String(params[0]);
      const windowMs = Number(params[1]);
      const maxAttempts = Number(params[2]);
      const lockoutMs = Number(params[3]);
      const now = Date.now();
      const previous = this.adminLoginAttempts.get(rateKey);
      const previousWindow = previous ? new Date(previous.window_started_at).getTime() : 0;
      const previousLock = previous?.locked_until ? new Date(previous.locked_until).getTime() : 0;
      const resetWindow = !previous
        || (previousLock > 0 && previousLock <= now)
        || !Number.isFinite(previousWindow)
        || previousWindow <= now - windowMs;
      const attemptCount = resetWindow ? 1 : Number(previous!.attempt_count) + 1;
      const windowStartedAt = resetWindow ? new Date(now).toISOString() : previous!.window_started_at;
      const lockedUntil = attemptCount >= maxAttempts
        ? new Date(now + lockoutMs).toISOString()
        : null;
      const entry = { attempt_count: attemptCount, window_started_at: windowStartedAt, locked_until: lockedUntil };
      this.adminLoginAttempts.set(rateKey, entry);
      return { rows: [{ attempt_count: attemptCount, locked_until: lockedUntil }], rowCount: 1 };
    }

    if (q.startsWith('INSERT INTO admin_login_attempts')) {
      this.adminLoginAttempts.set(params[0], {
        attempt_count: Number(params[1]),
        window_started_at: String(params[2]),
        locked_until: params[3] ? String(params[3]) : null,
      });
      return { rows: [], rowCount: 1 };
    }

    if (q.startsWith('DELETE FROM admin_login_attempts WHERE rate_key = $1')) {
      this.adminLoginAttempts.delete(params[0]);
      return { rows: [], rowCount: 1 };
    }

    if (q.includes('FROM information_schema.columns')) {
      return { rows: [{ column_name: 'password_encrypted' }, { column_name: 'pppoe_profile' }], rowCount: 2 };
    }

    if (q.includes('FROM customers c WHERE c.is_deleted IS NOT TRUE')) {
      return { rows: [...this.customers], rowCount: this.customers.length };
    }

    if (q.includes('FROM packages')) {
      return { rows: [...this.packages], rowCount: this.packages.length };
    }

    if (q.includes('FROM mikrotik_settings')) {
      return {
        rows: [
          {
            id: 'default',
            routerName: 'MikroTik Test',
            host: '192.168.88.1',
            apiPort: 8728,
            username: 'admin',
            status: 'disconnected',
            modelTarget: 'RB4011',
            rosVersionPreview: 'RouterOS v7',
            useSsl: false,
            timeoutSeconds: 10,
            notes: '',
            lastTestedAt: null,
            lastStatusMessage: 'Belum diuji',
            isPasswordConfigured: false,
          },
        ],
        rowCount: 1,
      };
    }

    if (q.includes('FROM invoices')) {
      return { rows: [], rowCount: 0 };
    }

    if (q.includes('FROM payments')) {
      return { rows: [], rowCount: 0 };
    }

    if (q.includes('FROM business_settings')) {
      return { rows: [], rowCount: 0 };
    }

    if (q.includes('FROM whatsapp_templates') || q.includes('FROM whatsapp_logs') || q.includes('FROM whatsapp_broadcast_campaigns')) {
      return { rows: [], rowCount: 0 };
    }

    throw new Error(`Unhandled SQL in MockAuthPostgresStore: ${q}`);
  }
}

function extractSidCookiePair(res: Response): { cookiePair: string; rawSetCookies: string[]; rawCookieValue: string } {
  const rawSetCookies =
    typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : res.headers.get('set-cookie')
      ? [res.headers.get('set-cookie') as string]
      : [];
  const sidHeader = rawSetCookies.find((c) => c.startsWith('adi_hotspot_sid='));
  if (!sidHeader) {
    return { cookiePair: '', rawSetCookies, rawCookieValue: '' };
  }
  const cookiePair = sidHeader.split(';')[0];
  const rawCookieValue = decodeURIComponent(cookiePair.split('=').slice(1).join('='));
  return { cookiePair, rawSetCookies, rawCookieValue };
}

async function main() {
  const store = new MockAuthPostgresStore();
  const origQuery = pg.Pool.prototype.query;
  const origConnect = pg.Pool.prototype.connect;

  (pg.Pool.prototype as any).query = async function (text: string, params?: any[]) {
    return store.handleQuery(text, params);
  };
  (pg.Pool.prototype as any).connect = async function () {
    return {
      query: async (text: string, params?: any[]) => store.handleQuery(text, params),
      release: () => {},
    };
  };

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adi_hotspot_auth_test_'));
  const tempWablasFile = path.join(tempDir, '.wablas-config.json');

  const { createApp, resolveTrustProxySetting } = await import('../../../server.js');
  const { hashSessionId, SESSION_COOKIE_NAME } = await import('../auth.js');
  const apiService = await import('../../services/apiService.js');

  const app = createApp({ wablasConfigFile: tempWablasFile });
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as net.AddressInfo).port;
  const origin = `http://127.0.0.1:${port}`;
  const baseUrl = `${origin}/api`;

  let passed = 0;
  let failed = 0;

  async function runScenario(no: number, name: string, fn: () => Promise<void>) {
    try {
      await fn();
      passed++;
      console.log(`[PASS] Skenario Auth ${no}: ${name}`);
    } catch (err: any) {
      failed++;
      console.error(`[FAIL] Skenario Auth ${no}: ${name} -> ${err?.message || err}`);
      if (err?.stack) {
        console.error(err.stack);
      }
    }
  }

  let activeCookie = '';
  let activeCsrf = '';
  let activeRawCookieValue = '';

  // Skenario 1: Login valid
  await runScenario(1, 'Login admin valid menerbitkan HttpOnly SameSite=Lax cookie, CSRF token, dan menyimpan sid_hash di PostgreSQL', async () => {
    store.resetOperationalAndSessions();
    const res = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: origin,
      },
      body: JSON.stringify({ username: TEST_ADMIN_USERNAME, password: TEST_ADMIN_PASSWORD }),
    });
    assert.equal(res.status, 200);
    const json: any = await res.json();
    assert.equal(json.success, true);
    assert.equal(json.authenticated, true);
    assert.equal(json.username, TEST_ADMIN_USERNAME);
    assert.ok(typeof json.csrfToken === 'string' && json.csrfToken.length >= 64);

    const { cookiePair, rawSetCookies, rawCookieValue } = extractSidCookiePair(res);
    assert.ok(cookiePair.startsWith(`${SESSION_COOKIE_NAME}=`), 'Session cookie tidak diterbitkan');
    const setCookieStr = rawSetCookies.join('; ');
    assert.match(setCookieStr, /HttpOnly/i);
    assert.match(setCookieStr, /SameSite=Lax/i);

    assert.equal(store.adminSessions.size, 1, 'Session harus tersimpan ke admin_sessions PostgreSQL');
    // Pastikan yang tersimpan sebagai kunci adalah SHA-256 hash, bukan raw session ID
    for (const key of store.adminSessions.keys()) {
      assert.match(key, /^[a-f0-9]{64}$/);
      assert.ok(!rawCookieValue.includes(key));
    }

    activeCookie = cookiePair;
    activeCsrf = json.csrfToken;
    activeRawCookieValue = rawCookieValue;
  });

  // Skenario 2 & 3: Password salah & username salah -> 401 identik
  let wrongPassMsg = '';
  await runScenario(2, 'Login password salah ditolak HTTP 401 dengan pesan generik', async () => {
    store.adminLoginAttempts.clear();
    const res = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: origin,
      },
      body: JSON.stringify({ username: TEST_ADMIN_USERNAME, password: 'SalahPassword123' }),
    });
    assert.equal(res.status, 401);
    const json: any = await res.json();
    assert.equal(json.success, false);
    assert.equal(json.errorCode, 'AUTH_FAILED');
    wrongPassMsg = json.message;
  });

  await runScenario(3, 'Login username salah ditolak HTTP 401 dengan pesan identik (anti user enumeration)', async () => {
    const res = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: origin,
      },
      body: JSON.stringify({ username: 'bukan_admin', password: TEST_ADMIN_PASSWORD }),
    });
    assert.equal(res.status, 401);
    const json: any = await res.json();
    assert.equal(json.success, false);
    assert.equal(json.errorCode, 'AUTH_FAILED');
    assert.equal(json.message, wrongPassMsg);
  });

  // Skenario 4: /api/customers tanpa session -> 401
  await runScenario(4, 'Akses /api/customers tanpa session ditolak HTTP 401', async () => {
    for (const [method, endpoint] of [
      ['GET', '/customers'],
      ['POST', '/customers'],
      ['PUT', '/customers/c1'],
      ['PATCH', '/customers/c1/status'],
      ['POST', '/customers/c1/sync-router'],
      ['DELETE', '/customers/c1'],
    ] as const) {
      const res = await fetch(`${baseUrl}${endpoint}`, {
        method,
        headers: { 'Content-Type': 'application/json', Origin: origin },
        body: method === 'GET' || method === 'DELETE' ? undefined : JSON.stringify({}),
      });
      assert.equal(res.status, 401, `${method} ${endpoint} seharusnya 401, dapat ${res.status}`);
    }
  });

  // Skenario 5: /api/invoices tanpa session -> 401
  await runScenario(5, 'Akses /api/invoices tanpa session ditolak HTTP 401', async () => {
    for (const [method, endpoint] of [
      ['GET', '/invoices'],
      ['POST', '/invoices'],
      ['PUT', '/invoices/inv1'],
      ['DELETE', '/invoices/inv1'],
    ] as const) {
      const res = await fetch(`${baseUrl}${endpoint}`, {
        method,
        headers: { 'Content-Type': 'application/json', Origin: origin },
        body: method === 'GET' || method === 'DELETE' ? undefined : JSON.stringify({}),
      });
      assert.equal(res.status, 401, `${method} ${endpoint} seharusnya 401, dapat ${res.status}`);
    }
  });

  // Skenario 6: /api/payments tanpa session -> 401
  await runScenario(6, 'Akses /api/payments tanpa session ditolak HTTP 401', async () => {
    for (const [method, endpoint] of [
      ['GET', '/payments'],
      ['POST', '/payments'],
    ] as const) {
      const res = await fetch(`${baseUrl}${endpoint}`, {
        method,
        headers: { 'Content-Type': 'application/json', Origin: origin },
        body: method === 'GET' ? undefined : JSON.stringify({}),
      });
      assert.equal(res.status, 401, `${method} ${endpoint} seharusnya 401, dapat ${res.status}`);
    }
  });

  // Skenario 7: Seluruh endpoint WhatsApp tanpa session -> 401
  await runScenario(7, 'Akses seluruh endpoint /api/whatsapp/* tanpa session ditolak HTTP 401', async () => {
    const waRoutes: Array<[string, string]> = [
      ['GET', '/whatsapp/config'],
      ['POST', '/whatsapp/config'],
      ['POST', '/whatsapp/test-connection'],
      ['POST', '/whatsapp/send-test'],
      ['POST', '/whatsapp/send-message'],
      ['POST', '/whatsapp/broadcast'],
      ['POST', '/whatsapp/send-broadcast'],
      ['GET', '/whatsapp/templates'],
      ['POST', '/whatsapp/templates'],
      ['GET', '/whatsapp/logs'],
      ['POST', '/whatsapp/logs'],
      ['GET', '/whatsapp/broadcast-history'],
      ['POST', '/whatsapp/broadcast-history'],
    ];
    for (const [method, endpoint] of waRoutes) {
      const res = await fetch(`${baseUrl}${endpoint}`, {
        method,
        headers: { 'Content-Type': 'application/json', Origin: origin },
        body: method === 'GET' ? undefined : JSON.stringify({}),
      });
      assert.equal(res.status, 401, `${method} ${endpoint} seharusnya 401, dapat ${res.status}`);
    }
  });

  // Skenario 8: MikroTik, status, packages, settings, & health check
  await runScenario(8, 'Akses /api/mikrotik/*, /api/status, /api/packages, /api/settings/* tanpa session -> 401; /api/health publik minimal', async () => {
    const protectedRoutes: Array<[string, string]> = [
      ['GET', '/status'],
      ['GET', '/packages'],
      ['POST', '/packages'],
      ['GET', '/settings/business'],
      ['PUT', '/settings/business'],
      ['GET', '/mikrotik/config'],
      ['POST', '/mikrotik/config'],
      ['POST', '/mikrotik/test-connection'],
      ['GET', '/tidak-ada'],
      ['POST', '/health'],
      ['GET', '/auth/login'],
      ['GET', '/auth/logout'],
    ];
    for (const [method, endpoint] of protectedRoutes) {
      const res = await fetch(`${baseUrl}${endpoint}`, {
        method,
        headers: { 'Content-Type': 'application/json', Origin: origin },
        body: method === 'GET' ? undefined : JSON.stringify({}),
      });
      assert.equal(res.status, 401, `${method} ${endpoint} seharusnya 401, dapat ${res.status}`);
    }

    const healthRes = await fetch(`${baseUrl}/health`);
    assert.equal(healthRes.status, 200);
    const healthJson: any = await healthRes.json();
    assert.deepEqual(healthJson, { ok: true });
  });

  // Skenario 9: Akses endpoint terproteksi dengan session & CSRF valid berhasil
  await runScenario(9, 'Akses endpoint terproteksi dengan session valid dan CSRF token valid berhasil', async () => {
    for (const endpoint of ['/status', '/customers', '/packages', '/whatsapp/config', '/mikrotik/config']) {
      const res = await fetch(`${baseUrl}${endpoint}`, {
        method: 'GET',
        headers: { Cookie: activeCookie },
      });
      assert.equal(res.status, 200, `GET ${endpoint} dengan session valid harus 200`);
      const cc = res.headers.get('cache-control') || '';
      assert.match(cc, /no-store/i);
    }

    const waSave = await fetch(`${baseUrl}/whatsapp/config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: origin,
        Cookie: activeCookie,
        'X-CSRF-Token': activeCsrf,
      },
      body: JSON.stringify({
        serverUrl: 'https://smg.wablas.com',
        senderPhone: '081234567890',
      }),
    });
    assert.equal(waSave.status, 200);
  });

  // Skenario 10: Logout menghancurkan session server-side dan cookie lama tidak bisa dipakai lagi
  await runScenario(10, 'Logout menghapus session di PostgreSQL dan cookie lama langsung ditolak 401', async () => {
    assert.equal(store.adminSessions.size, 1);
    const logoutRes = await fetch(`${baseUrl}/auth/logout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: origin,
        Cookie: activeCookie,
        'X-CSRF-Token': activeCsrf,
      },
      body: JSON.stringify({}),
    });
    assert.equal(logoutRes.status, 200);
    assert.equal(store.adminSessions.size, 0, 'Session wajib terhapus dari tabel admin_sessions setelah logout');

    const afterLogoutRes = await fetch(`${baseUrl}/customers`, {
      method: 'GET',
      headers: { Cookie: activeCookie },
    });
    assert.equal(afterLogoutRes.status, 401);
  });

  // Skenario 11: Session kedaluwarsa ditolak
  await runScenario(11, 'Session kedaluwarsa di PostgreSQL ditolak 401 dan dibersihkan', async () => {
    const expiredSid = 'expired_sid_test_value_123456';
    const expiredHash = hashSessionId(expiredSid);
    const pastIso = new Date(Date.now() - 60_000).toISOString();
    store.adminSessions.set(expiredHash, {
      sess: {
        isAdmin: true,
        adminUsername: TEST_ADMIN_USERNAME,
        csrfToken: 'a'.repeat(64),
        expiresAt: Date.now() - 60_000,
        cookie: { originalMaxAge: 1000 },
      },
      expires_at: pastIso,
    });

    // Buat cookie bertanda tangan menggunakan session secret untuk menguji path PostgresSessionStore.get()
    // dan juga login dulu lalu ubah expiresAt di DB menjadi masa lalu agar valid secara signature cookie
    store.adminLoginAttempts.clear();
    const loginRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({ username: TEST_ADMIN_USERNAME, password: TEST_ADMIN_PASSWORD }),
    });
    assert.equal(loginRes.status, 200);
    const { cookiePair } = extractSidCookiePair(loginRes);
    const loginJson: any = await loginRes.json();

    // Paksa seluruh session di DB menjadi expired
    for (const [k, v] of store.adminSessions.entries()) {
      v.expires_at = new Date(Date.now() - 10_000).toISOString();
      v.sess.expiresAt = Date.now() - 10_000;
      store.adminSessions.set(k, v);
    }

    const res = await fetch(`${baseUrl}/customers`, {
      method: 'GET',
      headers: { Cookie: cookiePair },
    });
    assert.equal(res.status, 401);
    assert.equal(store.adminSessions.has(expiredHash), true);
    store.adminSessions.delete(expiredHash);
    assert.equal(store.adminSessions.size, 0, 'Session expired yang diakses harus terhapus dari DB');

    // Cookie usang pada GET /api/auth/session harus dibersihkan lewat Set-Cookie
    const sessCheck = await fetch(`${baseUrl}/auth/session`, {
      method: 'GET',
      headers: { Cookie: cookiePair },
    });
    assert.equal(sessCheck.status, 200);
    const sessJson: any = await sessCheck.json();
    assert.equal(sessJson.authenticated, false);
    const { rawSetCookies } = extractSidCookiePair(sessCheck);
    assert.ok(
      rawSetCookies.some((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`) && /Expires=Thu, 01 Jan 1970/i.test(c)),
      'Cookie kedaluwarsa pada /api/auth/session harus dibersihkan melalui Set-Cookie'
    );

    activeCookie = '';
    activeCsrf = loginJson.csrfToken;
  });

  // Skenario 12: Session ID regeneration saat login
  await runScenario(12, 'Session ID diregenerasi setelah login berhasil (cookie lama != cookie pasca login)', async () => {
    store.adminLoginAttempts.clear();
    const staleCookie = `${SESSION_COOKIE_NAME}=s%3Apreexisting_session_id.invalidsignature`;
    const loginRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: origin,
        Cookie: staleCookie,
      },
      body: JSON.stringify({ username: TEST_ADMIN_USERNAME, password: TEST_ADMIN_PASSWORD }),
    });
    assert.equal(loginRes.status, 200);
    const { cookiePair, rawCookieValue } = extractSidCookiePair(loginRes);
    const json: any = await loginRes.json();

    assert.notEqual(cookiePair, staleCookie);
    assert.ok(!rawCookieValue.includes('preexisting_session_id'));
    activeCookie = cookiePair;
    activeCsrf = json.csrfToken;
    activeRawCookieValue = rawCookieValue;
  });

  // Skenario 13: Proteksi CSRF pada mutating requests & login
  await runScenario(13, 'Mutating request tanpa token CSRF atau Origin/Sec-Fetch-Site tidak valid ditolak HTTP 403', async () => {
    // 13a. POST tanpa X-CSRF-Token
    const noCsrf = await fetch(`${baseUrl}/whatsapp/config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: origin,
        Cookie: activeCookie,
      },
      body: JSON.stringify({ serverUrl: 'https://smg.wablas.com', senderPhone: '08123' }),
    });
    assert.equal(noCsrf.status, 403);

    // 13b. POST dengan X-CSRF-Token salah
    const badCsrf = await fetch(`${baseUrl}/whatsapp/config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: origin,
        Cookie: activeCookie,
        'X-CSRF-Token': 'wrong_token_000000000000000000000000000000000000',
      },
      body: JSON.stringify({ serverUrl: 'https://smg.wablas.com', senderPhone: '08123' }),
    });
    assert.equal(badCsrf.status, 403);

    // 13c. POST/PUT/PATCH/DELETE dengan Origin lintas situs
    for (const [method, endpoint] of [
      ['POST', '/packages'],
      ['PUT', '/settings/business'],
      ['PATCH', '/customers/c1/status'],
      ['DELETE', '/customers/c1'],
    ] as const) {
      const evilOrigin = await fetch(`${baseUrl}${endpoint}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://attacker.example',
          Cookie: activeCookie,
          'X-CSRF-Token': activeCsrf,
        },
        body: method === 'DELETE' ? undefined : JSON.stringify({}),
      });
      assert.equal(evilOrigin.status, 403, `${method} ${endpoint} lintas Origin harus 403`);
    }

    // 13d. Origin: null dan Sec-Fetch-Site: cross-site ditolak
    const nullOrigin = await fetch(`${baseUrl}/whatsapp/config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'null',
        Cookie: activeCookie,
        'X-CSRF-Token': activeCsrf,
      },
      body: JSON.stringify({ serverUrl: 'https://smg.wablas.com', senderPhone: '08123' }),
    });
    assert.equal(nullOrigin.status, 403);

    const crossSite = await fetch(`${baseUrl}/whatsapp/config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: origin,
        'Sec-Fetch-Site': 'cross-site',
        Cookie: activeCookie,
        'X-CSRF-Token': activeCsrf,
      },
      body: JSON.stringify({ serverUrl: 'https://smg.wablas.com', senderPhone: '08123' }),
    });
    assert.equal(crossSite.status, 403);

    // 13e. Login CSRF: Origin lintas situs atau form non-JSON ditolak
    const evilLoginOrigin = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://attacker.example',
      },
      body: JSON.stringify({ username: TEST_ADMIN_USERNAME, password: TEST_ADMIN_PASSWORD }),
    });
    assert.equal(evilLoginOrigin.status, 403);

    const formLoginCsrf = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Origin: origin,
      },
      body: `username=${TEST_ADMIN_USERNAME}&password=${TEST_ADMIN_PASSWORD}`,
    });
    assert.equal(formLoginCsrf.status, 403);
  });

  // Skenario 14: Zero-secret-leak, persistent rate limit, dan spoofing X-Forwarded-Proto
  await runScenario(14, 'Password/hash/SESSION_SECRET/Cookie tidak bocor; rate limit persisten & X-Forwarded-Proto spoof ditolak', async () => {
    const capturedLogs: string[] = [];
    const origErr = console.error;
    const origWarn = console.warn;
    const origLog = console.log;
    console.error = (...args: any[]) => capturedLogs.push(args.map(String).join(' '));
    console.warn = (...args: any[]) => capturedLogs.push(args.map(String).join(' '));
    console.log = (...args: any[]) => capturedLogs.push(args.map(String).join(' '));

    const responsePayloads: string[] = [];
    try {
      store.adminLoginAttempts.clear();

      // Uji 5x gagal login -> memicu rate limit persisten 429 pada percobaan ke-5 / ke-6
      let lastStatus = 0;
      for (let i = 0; i < 6; i++) {
        const res = await fetch(`${baseUrl}/auth/login`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: origin,
            'X-Forwarded-Proto': 'https',
            'X-Forwarded-For': `203.0.113.${i + 10}`,
          },
          body: JSON.stringify({ username: TEST_ADMIN_USERNAME, password: 'WrongPassword!123' }),
        });
        const text = await res.text();
        responsePayloads.push(text);
        lastStatus = res.status;
      }
      assert.equal(lastStatus, 429, 'Harus memicu HTTP 429 setelah batas percobaan gagal');

      // Simulasikan restart instance Express baru: rate limit tetap bertahan di PostgreSQL!
      const secondApp = createApp({ wablasConfigFile: tempWablasFile });
      const secondServer = http.createServer(secondApp);
      await new Promise<void>((resolve) => secondServer.listen(0, '127.0.0.1', () => resolve()));
      const secondPort = (secondServer.address() as net.AddressInfo).port;
      const secondOrigin = `http://127.0.0.1:${secondPort}`;
      try {
        const blockedOnNewApp = await fetch(`${secondOrigin}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Origin: secondOrigin },
          body: JSON.stringify({ username: TEST_ADMIN_USERNAME, password: TEST_ADMIN_PASSWORD }),
        });
        assert.equal(blockedOnNewApp.status, 429, 'Rate limit persisten PostgreSQL harus tetap memblokir di instance baru');
        responsePayloads.push(await blockedOnNewApp.text());

        // Simulasikan cooldown sementara berakhir -> TIDAK lockout permanen, admin bisa login kembali!
        for (const [k, v] of store.adminLoginAttempts.entries()) {
          v.locked_until = new Date(Date.now() - 1000).toISOString();
          store.adminLoginAttempts.set(k, v);
        }
        const unlockedLogin = await fetch(`${secondOrigin}/api/auth/login`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: secondOrigin,
            'X-Forwarded-Proto': 'https',
          },
          body: JSON.stringify({ username: TEST_ADMIN_USERNAME, password: TEST_ADMIN_PASSWORD }),
        });
        assert.equal(unlockedLogin.status, 200, 'Setelah cooldown berakhir, login valid harus diizinkan kembali');
        const setCookieStr = (unlockedLogin.headers.get('set-cookie') || '');
        assert.ok(!/; *Secure\b/i.test(setCookieStr), 'Spoof X-Forwarded-Proto saat TRUST_PROXY=false tidak boleh mengaktifkan Secure cookie pada HTTP');
        responsePayloads.push(await unlockedLogin.text());
      } finally {
        await new Promise<void>((resolve) => secondServer.close(() => resolve()));
      }

      // Pastikan resolveTrustProxySetting tidak mengizinkan proxy terbuka
      assert.equal(resolveTrustProxySetting(undefined), false);
      assert.equal(resolveTrustProxySetting('false'), false);
      assert.equal(resolveTrustProxySetting('loopback'), 'loopback');
      assert.equal(resolveTrustProxySetting('true'), false);
    } finally {
      console.error = origErr;
      console.warn = origWarn;
      console.log = origLog;
    }

    const combinedAll = [...capturedLogs, ...responsePayloads].join('\n');
    for (const secretVal of [
      TEST_ADMIN_PASSWORD,
      TEST_ADMIN_HASH,
      TEST_SESSION_SECRET,
      activeRawCookieValue,
      process.env.DB_PASSWORD || '',
      process.env.MIKROTIK_ENCRYPTION_KEY || '',
    ]) {
      if (secretVal) {
        assert.ok(!combinedAll.includes(secretVal), `Kebocoran rahasia terdeteksi pada log/respons!`);
      }
    }
  });

  // Skenario 15: Frontend guard (tidak memuat data sebelum login, 401 reset token, nol localStorage/sessionStorage)
  await runScenario(15, 'Frontend guard: tidak ada fetch data operasional sebelum login, token tidak di localStorage/sessionStorage, 401 reset state', async () => {
    const requestedUrls: string[] = [];
    const storageMock = () => {
      const m = new Map<string, string>();
      return {
        getItem: (k: string) => m.get(k) ?? null,
        setItem: (k: string, v: string) => m.set(k, v),
        removeItem: (k: string) => m.delete(k),
        clear: () => m.clear(),
        size: () => m.size,
      };
    };
    const mockLocal = storageMock();
    const mockSession = storageMock();
    const origFetch = globalThis.fetch;
    (globalThis as any).localStorage = mockLocal;
    (globalThis as any).sessionStorage = mockSession;
    (globalThis as any).fetch = async (url: string, init?: RequestInit) => {
      requestedUrls.push(String(url));
      if (String(url).startsWith('/api/auth/session')) {
        return new Response(JSON.stringify({ success: true, authenticated: false, authConfigured: true, username: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (String(url).startsWith('/api/auth/login')) {
        return new Response(
          JSON.stringify({
            success: true,
            authenticated: true,
            username: TEST_ADMIN_USERNAME,
            csrfToken: 'csrf_token_frontend_test_value_1234567890abcdef',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (String(url).startsWith('/api/customers')) {
        return new Response(JSON.stringify({ success: false, errorCode: 'UNAUTHORIZED', message: 'Expired' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    };

    try {
      // 15a. Saat belum terautentikasi, checkAuthSession hanya memanggil /api/auth/session (tidak memanggil /api/status / /api/customers)
      const s = await apiService.checkAuthSession();
      assert.equal(s.authenticated, false);
      assert.deepEqual(requestedUrls, ['/api/auth/session']);
      assert.equal(apiService.getCsrfToken(), null);

      // 15b. Setelah login, CSRF token hanya disimpan di memori JS (bukan localStorage/sessionStorage)
      const loginOut = await apiService.loginAdminApi(TEST_ADMIN_USERNAME, TEST_ADMIN_PASSWORD);
      assert.equal(loginOut.success, true);
      assert.equal(apiService.getCsrfToken(), 'csrf_token_frontend_test_value_1234567890abcdef');
      assert.equal(mockLocal.size(), 0);
      assert.equal(mockSession.size(), 0);

      // 15c. HTTP 401 memicu unauthorizedHandler dan menghapus inMemoryCsrfToken
      let unauthorizedTriggered = false;
      apiService.setUnauthorizedHandler(() => {
        unauthorizedTriggered = true;
      });
      await apiService.fetchCustomersFromApi();
      assert.equal(unauthorizedTriggered, true);
      assert.equal(apiService.getCsrfToken(), null);

      // 15d. Verifikasi statis App.tsx & whatsappGatewayService.ts
      const appSource = fs.readFileSync(path.resolve(process.cwd(), 'src/App.tsx'), 'utf-8');
      assert.ok(appSource.includes('if (!isAuthenticated) {'), 'App.tsx harus memblokir syncDataFromPostgres sebelum login');
      assert.ok(appSource.includes('checkAuthSession()'), 'App.tsx harus memeriksa session saat startup');
      const waSource = fs.readFileSync(path.resolve(process.cwd(), 'src/services/whatsappGatewayService.ts'), 'utf-8');
      assert.ok(!/\bfetch\s*\(\s*['"]\/api\//.test(waSource), 'whatsappGatewayService.ts tidak boleh memanggil fetch("/api/...") langsung tanpa apiFetch');
    } finally {
      globalThis.fetch = origFetch;
      delete (globalThis as any).localStorage;
      delete (globalThis as any).sessionStorage;
      apiService.setUnauthorizedHandler(null);
      apiService.setCsrfToken(null);
    }
  });

  // Skenario 16: Percobaan gagal bersamaan tetap dihitung secara atomik tanpa lost update.
  await runScenario(16, 'Rate limiter menghitung login gagal bersamaan tanpa lost update', async () => {
    store.adminLoginAttempts.clear();
    store.loginAttemptUpsertCount = 0;
    const requests = Array.from({ length: 8 }, () => fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: origin,
      },
      body: JSON.stringify({ username: TEST_ADMIN_USERNAME, password: 'WrongConcurrentPassword!123' }),
    }));
    const responses = await Promise.all(requests);
    const statuses = responses.map((response) => response.status);
    const rateLimitedCount = statuses.filter((status) => status === 429).length;
    const unauthorizedCount = statuses.filter((status) => status === 401).length;
    assert.equal(unauthorizedCount, 4, 'Empat percobaan pertama seharusnya menerima HTTP 401');
    assert.equal(rateLimitedCount, 4, 'Percobaan ke-5 dan seterusnya harus menerima HTTP 429');
    assert.equal(store.adminLoginAttempts.size, 1, 'Harus ada satu counter untuk IP yang sama');
    const attempt = [...store.adminLoginAttempts.values()][0];
    assert.ok(
      attempt.attempt_count >= 5 && attempt.attempt_count <= 8,
      `Minimal 5 kegagalan awal harus tercatat hingga lockout aktif (aktual: ${attempt.attempt_count})`
    );
    assert.equal(
      attempt.attempt_count,
      store.loginAttemptUpsertCount,
      'Seluruh panggilan recordFailedLoginAttempt bersamaan harus tercatat tepat tanpa lost update'
    );
    assert.ok(attempt.locked_until, 'Cooldown harus aktif setelah batas lima kegagalan');
  });

  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(tempDir, { recursive: true, force: true });
  (pg.Pool.prototype as any).query = origQuery;
  (pg.Pool.prototype as any).connect = origConnect;

  console.log(`\nRINGKASAN AUTH TESTS: TOTAL=${passed + failed}, PASS=${passed}, FAIL=${failed}`);
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Auth integration test suite crashed:', err);
  process.exit(1);
});
