import net from 'node:net';
import http from 'node:http';
import assert from 'node:assert/strict';
import express from 'express';
import pg from 'pg';

// Pastikan env tersedia sebelum modul db/crypto dimuat secara dinamis
process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'mock_test_db_password';
process.env.MIKROTIK_ENCRYPTION_KEY = process.env.MIKROTIK_ENCRYPTION_KEY || 'phase1_audit_test_encryption_key_32bytes';

interface MockRouterSecret {
  '.id': string;
  name: string;
  password: string;
  profile: string;
  disabled: 'true' | 'false';
  'remote-address'?: string;
}

interface MockRouterSession {
  '.id': string;
  name?: string;
  user?: string;
  address?: string;
}

interface MockCustomerRow {
  id: string;
  name: string;
  phone: string;
  address: string;
  installation_address: string;
  latitude: number | null;
  longitude: number | null;
  package_id: string;
  package_name: string;
  type: 'pppoe' | 'hotspot';
  username: string;
  password_encrypted: string | null;
  ip_address: string | null;
  status: 'active' | 'isolated' | 'inactive';
  router_sync_status: 'pending' | 'synced' | 'failed';
  router_last_sync_at: string | null;
  router_last_sync_message: string | null;
  registered_at: string;
  due_date_day: number;
  monthly_fee: number;
  installation_date: string | null;
  is_deleted: boolean;
  deleted_at: string | null;
  updated_at: string;
}

interface MockPackageRow {
  id: string;
  name: string;
  pppoe_profile: string | null;
  hotspot_profile: string | null;
  active_users_count: number;
}

// ============================================================================
// 1. IN-MEMORY TCP MOCK ROUTEROS API SERVER (NO PHYSICAL MIKROTIK TOUCHED)
// ============================================================================
function encodeWord(word: string): Buffer {
  const wordBuf = Buffer.from(word, 'utf8');
  const len = wordBuf.length;
  let lenBuf: Buffer;
  if (len < 0x80) {
    lenBuf = Buffer.from([len]);
  } else if (len < 0x4000) {
    lenBuf = Buffer.from([(len >> 8) | 0x80, len & 0xff]);
  } else {
    lenBuf = Buffer.from([(len >> 16) | 0xc0, (len >> 8) & 0xff, len & 0xff]);
  }
  return Buffer.concat([lenBuf, wordBuf]);
}

function encodeSentence(words: string[]): Buffer {
  return Buffer.concat([...words.map(encodeWord), Buffer.from([0x00])]);
}

function decodeLength(buf: Buffer, offset: number): { len: number; bytesRead: number } | null {
  if (offset >= buf.length) return null;
  const b0 = buf[offset];
  if ((b0 & 0x80) === 0) return { len: b0, bytesRead: 1 };
  if ((b0 & 0xc0) === 0x80) {
    if (offset + 1 >= buf.length) return null;
    return { len: ((b0 & ~0x80) << 8) | buf[offset + 1], bytesRead: 2 };
  }
  if ((b0 & 0xe0) === 0xc0) {
    if (offset + 2 >= buf.length) return null;
    return { len: ((b0 & ~0xe0) << 16) | (buf[offset + 1] << 8) | buf[offset + 2], bytesRead: 3 };
  }
  return null;
}

function extractSentences(buffer: Buffer): { sentences: string[][]; remaining: Buffer } {
  const sentences: string[][] = [];
  let currentWords: string[] = [];
  let offset = 0;

  while (offset < buffer.length) {
    const lenInfo = decodeLength(buffer, offset);
    if (!lenInfo) break;
    offset += lenInfo.bytesRead;

    if (lenInfo.len === 0) {
      sentences.push(currentWords);
      currentWords = [];
      buffer = buffer.subarray(offset);
      offset = 0;
      continue;
    }

    if (offset + lenInfo.len > buffer.length) {
      offset -= lenInfo.bytesRead;
      break;
    }

    currentWords.push(buffer.toString('utf8', offset, offset + lenInfo.len));
    offset += lenInfo.len;
  }

  return { sentences, remaining: buffer.subarray(offset) };
}

class MockRouterOsServer {
  server: net.Server;
  port = 0;
  offline = false;
  private stopping = false;
  private activeSockets = new Set<net.Socket>();

  pppoeProfiles = new Set<string>(['prof-pppoe-10m', 'prof-pppoe-20m']);
  hotspotProfiles = new Set<string>(['prof-hs-10m', 'prof-hs-20m']);

  pppoeSecrets: MockRouterSecret[] = [];
  hotspotUsers: MockRouterSecret[] = [];
  pppoeActives: MockRouterSession[] = [];
  hotspotActives: MockRouterSession[] = [];

  commandLog: string[][] = [];
  trapOnCommand = new Map<string, string>(); // key: commandPath e.g. '/ppp/secret/set'
  fatalOnCommand = new Map<string, string>();
  resetOnCommand = new Set<string>(); // simulasi abrupt TCP RST (ECONNRESET)
  hangOnCommand = new Set<string>(); // simulasi server tidak membalas (timeout)
  failRemoveIds = new Set<string>(); // e.g. '*S2'
  lingerAfterRemoveIds = new Set<string>(); // remove succeeds in RouterOS reply but session persists on subsequent /print
  nextIdCounter = 100;

  constructor() {
    this.server = net.createServer((socket) => {
      this.activeSockets.add(socket);
      let socketClosing = false;
      let quitReceived = false;
      let fatalSent = false;

      // Wajib pasang listener error paling awal sebelum operasi destroy()/write() apa pun
      socket.on('error', (err: NodeJS.ErrnoException) => {
        const code = err?.code || '';
        if (
          this.stopping ||
          this.offline ||
          socketClosing ||
          quitReceived ||
          fatalSent ||
          code === 'ECONNRESET' ||
          code === 'EPIPE' ||
          code === 'ECONNABORTED' ||
          code === 'ERR_STREAM_DESTROYED'
        ) {
          return;
        }
        console.error(`MockRouterOsServer unexpected socket error (${code}):`, err);
        if (!socket.destroyed) {
          socket.destroy();
        }
      });

      socket.on('end', () => {
        socketClosing = true;
      });

      socket.on('close', () => {
        socketClosing = true;
        this.activeSockets.delete(socket);
      });

      if (this.offline) {
        socketClosing = true;
        socket.destroy();
        return;
      }

      let buf: Buffer = Buffer.alloc(0);
      socket.on('data', (chunk) => {
        if (socketClosing || socket.destroyed) return;
        buf = Buffer.concat([buf, chunk]);
        const extracted = extractSentences(buf);
        buf = extracted.remaining;

        for (const words of extracted.sentences) {
          if (socketClosing || socket.destroyed) break;
          const outcome = this.handleSentence(socket, words);
          if (outcome === 'quit') {
            quitReceived = true;
            socketClosing = true;
            if (!socket.destroyed) {
              socket.end();
            }
            break;
          }
          if (outcome === 'fatal') {
            fatalSent = true;
            socketClosing = true;
            if (!socket.destroyed) {
              socket.end();
            }
            break;
          }
          if (outcome === 'reset') {
            socketClosing = true;
            break;
          }
        }
      });
    });

    this.server.on('error', (err) => {
      if (!this.stopping) {
        console.error('MockRouterOsServer server error:', err);
      }
    });
  }

  private safeWrite(socket: net.Socket, words: string[]) {
    if (socket.destroyed || !socket.writable) return;
    try {
      socket.write(encodeSentence(words));
    } catch {
      // Abaikan race condition penulisan saat peer menutup koneksi secara mendadak
    }
  }

  async start(): Promise<number> {
    this.stopping = false;
    await new Promise<void>((resolve) => {
      this.server.listen(0, '127.0.0.1', () => {
        const addr = this.server.address() as net.AddressInfo;
        this.port = addr.port;
        resolve();
      });
    });
    return this.port;
  }

  async stop(): Promise<void> {
    this.stopping = true;
    for (const sock of this.activeSockets) {
      try {
        if (!sock.destroyed) sock.destroy();
      } catch {
        // ignore
      }
    }
    this.activeSockets.clear();
    await new Promise<void>((resolve) => {
      this.server.close(() => resolve());
    });
  }

  reset(clearData = true) {
    this.offline = false;
    this.commandLog = [];
    this.trapOnCommand.clear();
    this.fatalOnCommand.clear();
    this.resetOnCommand.clear();
    this.hangOnCommand.clear();
    this.failRemoveIds.clear();
    this.lingerAfterRemoveIds.clear();
    if (clearData) {
      this.pppoeProfiles = new Set(['prof-pppoe-10m', 'prof-pppoe-20m']);
      this.hotspotProfiles = new Set(['prof-hs-10m', 'prof-hs-20m']);
      this.pppoeSecrets = [];
      this.hotspotUsers = [];
      this.pppoeActives = [];
      this.hotspotActives = [];
    }
  }

  private nextId(prefix: string): string {
    this.nextIdCounter += 1;
    return `*${prefix}${this.nextIdCounter}`;
  }

  private parseAttrs(words: string[]): Record<string, string> {
    const attrs: Record<string, string> = {};
    for (const w of words.slice(1)) {
      if (w.startsWith('=')) {
        const eqIdx = w.indexOf('=', 1);
        if (eqIdx > 1) {
          attrs[w.slice(1, eqIdx)] = w.slice(eqIdx + 1);
        }
      } else if (w.startsWith('?')) {
        const eqIdx = w.indexOf('=', 1);
        if (eqIdx > 1) {
          attrs[`?${w.slice(1, eqIdx)}`] = w.slice(eqIdx + 1);
        }
      }
    }
    return attrs;
  }

  private handleSentence(socket: net.Socket, words: string[]): 'ok' | 'quit' | 'fatal' | 'reset' {
    if (words.length === 0) return 'ok';
    const cmd = words[0];
    this.commandLog.push(words);

    if (cmd === '/quit') {
      return 'quit';
    }

    if (this.resetOnCommand.has(cmd)) {
      if (!socket.destroyed) {
        socket.destroy();
      }
      return 'reset';
    }

    if (this.hangOnCommand.has(cmd)) {
      return 'ok';
    }

    if (this.fatalOnCommand.has(cmd)) {
      const msg = this.fatalOnCommand.get(cmd)!;
      this.safeWrite(socket, ['!fatal', msg]);
      return 'fatal';
    }

    if (this.trapOnCommand.has(cmd)) {
      const msg = this.trapOnCommand.get(cmd)!;
      this.safeWrite(socket, ['!trap', `=message=${msg}`]);
      this.safeWrite(socket, ['!done']);
      return 'ok';
    }

    const attrs = this.parseAttrs(words);

    if (cmd === '/login') {
      this.safeWrite(socket, ['!done']);
      return 'ok';
    }

    if (cmd === '/system/identity/print') {
      this.safeWrite(socket, ['!re', '=name=MockRB4011']);
      this.safeWrite(socket, ['!done']);
      return 'ok';
    }

    if (cmd === '/system/resource/print') {
      this.safeWrite(socket, ['!re', '=version=7.14', '=board-name=RB4011iGS+', '=cpu-load=5']);
      this.safeWrite(socket, ['!done']);
      return 'ok';
    }

    if (cmd === '/ppp/profile/print') {
      const filterName = attrs['?name'];
      const names = [...this.pppoeProfiles].filter((n) => (filterName !== undefined ? n === filterName : true));
      for (const n of names) {
        this.safeWrite(socket, ['!re', `=name=${n}`]);
      }
      this.safeWrite(socket, ['!done']);
      return 'ok';
    }

    if (cmd === '/ip/hotspot/user/profile/print') {
      const filterName = attrs['?name'];
      const names = [...this.hotspotProfiles].filter((n) => (filterName !== undefined ? n === filterName : true));
      for (const n of names) {
        this.safeWrite(socket, ['!re', `=name=${n}`]);
      }
      this.safeWrite(socket, ['!done']);
      return 'ok';
    }

    if (cmd === '/ppp/secret/print') {
      const filterName = attrs['?name'];
      const matches = this.pppoeSecrets.filter((s) => (filterName !== undefined ? s.name === filterName : true));
      for (const s of matches) {
        this.safeWrite(socket, [
          '!re',
          `=.id=${s['.id']}`,
          `=name=${s.name}`,
          `=password=${s.password}`,
          `=profile=${s.profile}`,
          `=disabled=${s.disabled}`,
        ]);
      }
      this.safeWrite(socket, ['!done']);
      return 'ok';
    }

    if (cmd === '/ppp/secret/add') {
      const newSecret: MockRouterSecret = {
        '.id': this.nextId('P'),
        name: attrs.name || '',
        password: attrs.password || '',
        profile: attrs.profile || '',
        disabled: attrs.disabled === 'yes' ? 'true' : 'false',
        ...(attrs['remote-address'] ? { 'remote-address': attrs['remote-address'] } : {}),
      };
      this.pppoeSecrets.push(newSecret);
      this.safeWrite(socket, ['!done', `=ret=${newSecret['.id']}`]);
      return 'ok';
    }

    if (cmd === '/ppp/secret/set') {
      const id = attrs['.id'];
      const found = this.pppoeSecrets.find((s) => s['.id'] === id);
      if (!found) {
        this.safeWrite(socket, ['!trap', `=message=no such item (${id})`]);
        this.safeWrite(socket, ['!done']);
        return 'ok';
      }
      if (attrs.password !== undefined) found.password = attrs.password;
      if (attrs.profile !== undefined) found.profile = attrs.profile;
      if (attrs.disabled !== undefined) found.disabled = attrs.disabled === 'yes' ? 'true' : 'false';
      if (attrs['remote-address'] !== undefined) found['remote-address'] = attrs['remote-address'];
      this.safeWrite(socket, ['!done']);
      return 'ok';
    }

    if (cmd === '/ppp/secret/remove') {
      const id = attrs['.id'];
      if (this.failRemoveIds.has(id)) {
        this.safeWrite(socket, ['!trap', `=message=injected failure removing secret ${id}`]);
        this.safeWrite(socket, ['!done']);
        return 'ok';
      }
      const before = this.pppoeSecrets.length;
      this.pppoeSecrets = this.pppoeSecrets.filter((s) => s['.id'] !== id);
      if (this.pppoeSecrets.length === before) {
        this.safeWrite(socket, ['!trap', `=message=no such item (${id})`]);
      }
      this.safeWrite(socket, ['!done']);
      return 'ok';
    }

    if (cmd === '/ip/hotspot/user/print') {
      const filterName = attrs['?name'];
      const matches = this.hotspotUsers.filter((s) => (filterName !== undefined ? s.name === filterName : true));
      for (const s of matches) {
        this.safeWrite(socket, [
          '!re',
          `=.id=${s['.id']}`,
          `=name=${s.name}`,
          `=password=${s.password}`,
          `=profile=${s.profile}`,
          `=disabled=${s.disabled}`,
        ]);
      }
      this.safeWrite(socket, ['!done']);
      return 'ok';
    }

    if (cmd === '/ip/hotspot/user/add') {
      const newUser: MockRouterSecret = {
        '.id': this.nextId('H'),
        name: attrs.name || '',
        password: attrs.password || '',
        profile: attrs.profile || '',
        disabled: attrs.disabled === 'yes' ? 'true' : 'false',
      };
      this.hotspotUsers.push(newUser);
      this.safeWrite(socket, ['!done', `=ret=${newUser['.id']}`]);
      return 'ok';
    }

    if (cmd === '/ip/hotspot/user/set') {
      const id = attrs['.id'];
      const found = this.hotspotUsers.find((s) => s['.id'] === id);
      if (!found) {
        this.safeWrite(socket, ['!trap', `=message=no such item (${id})`]);
        this.safeWrite(socket, ['!done']);
        return 'ok';
      }
      if (attrs.password !== undefined) found.password = attrs.password;
      if (attrs.profile !== undefined) found.profile = attrs.profile;
      if (attrs.disabled !== undefined) found.disabled = attrs.disabled === 'yes' ? 'true' : 'false';
      this.safeWrite(socket, ['!done']);
      return 'ok';
    }

    if (cmd === '/ip/hotspot/user/remove') {
      const id = attrs['.id'];
      if (this.failRemoveIds.has(id)) {
        this.safeWrite(socket, ['!trap', `=message=injected failure removing hotspot user ${id}`]);
        this.safeWrite(socket, ['!done']);
        return 'ok';
      }
      const before = this.hotspotUsers.length;
      this.hotspotUsers = this.hotspotUsers.filter((s) => s['.id'] !== id);
      if (this.hotspotUsers.length === before) {
        this.safeWrite(socket, ['!trap', `=message=no such item (${id})`]);
      }
      this.safeWrite(socket, ['!done']);
      return 'ok';
    }

    if (cmd === '/ppp/active/print') {
      const filterName = attrs['?name'];
      const matches = this.pppoeActives.filter((a) => (filterName !== undefined ? a.name === filterName : true));
      for (const a of matches) {
        this.safeWrite(socket, ['!re', `=.id=${a['.id']}`, `=name=${a.name || ''}`, `=address=${a.address || '10.0.0.2'}`]);
      }
      this.safeWrite(socket, ['!done']);
      return 'ok';
    }

    if (cmd === '/ppp/active/remove') {
      const id = attrs['.id'];
      if (this.failRemoveIds.has(id)) {
        this.safeWrite(socket, ['!trap', `=message=injected failure removing ppp active ${id}`]);
        this.safeWrite(socket, ['!done']);
        return 'ok';
      }
      if (!this.lingerAfterRemoveIds.has(id)) {
        this.pppoeActives = this.pppoeActives.filter((a) => a['.id'] !== id);
      }
      this.safeWrite(socket, ['!done']);
      return 'ok';
    }

    if (cmd === '/ip/hotspot/active/print') {
      const filterUser = attrs['?user'];
      const matches = this.hotspotActives.filter((a) => (filterUser !== undefined ? a.user === filterUser : true));
      for (const a of matches) {
        this.safeWrite(socket, ['!re', `=.id=${a['.id']}`, `=user=${a.user || ''}`, `=address=${a.address || '10.5.50.2'}`]);
      }
      this.safeWrite(socket, ['!done']);
      return 'ok';
    }

    if (cmd === '/ip/hotspot/active/remove') {
      const id = attrs['.id'];
      if (this.failRemoveIds.has(id)) {
        this.safeWrite(socket, ['!trap', `=message=injected failure removing hotspot active ${id}`]);
        this.safeWrite(socket, ['!done']);
        return 'ok';
      }
      if (!this.lingerAfterRemoveIds.has(id)) {
        this.hotspotActives = this.hotspotActives.filter((a) => a['.id'] !== id);
      }
      this.safeWrite(socket, ['!done']);
      return 'ok';
    }

    this.safeWrite(socket, ['!done']);
    return 'ok';
  }
}

// ============================================================================
// 2. IN-MEMORY POSTGRESQL MOCK (PATCHES pg.Pool FOR END-TO-END dbRoutes TESTS)
// ============================================================================
class MockPostgresStore {
  routerPort = 8728;
  routerPasswordEncrypted = '';
  routerLastStatusMessage: string | null = null;
  packages = new Map<string, MockPackageRow>();
  customers = new Map<string, MockCustomerRow>();
  invoices = new Map<string, any>();
  injectErrorOnPattern: { pattern: RegExp; error: any } | null = null;

  reset(routerPort: number, routerPasswordEncrypted: string) {
    this.routerPort = routerPort;
    this.routerPasswordEncrypted = routerPasswordEncrypted;
    this.routerLastStatusMessage = null;
    this.packages.clear();
    this.customers.clear();
    this.invoices.clear();
    this.injectErrorOnPattern = null;

    this.packages.set('pkg-10m', {
      id: 'pkg-10m',
      name: 'Paket 10 Mbps',
      pppoe_profile: 'prof-pppoe-10m',
      hotspot_profile: 'prof-hs-10m',
      active_users_count: 0,
    });
    this.packages.set('pkg-20m', {
      id: 'pkg-20m',
      name: 'Paket 20 Mbps',
      pppoe_profile: 'prof-pppoe-20m',
      hotspot_profile: 'prof-hs-20m',
      active_users_count: 0,
    });
    this.packages.set('pkg-missing-prof', {
      id: 'pkg-missing-prof',
      name: 'Paket Missing Router Profile',
      pppoe_profile: 'non-existent-profile',
      hotspot_profile: 'non-existent-hs-profile',
      active_users_count: 0,
    });
  }

  private mapReturningRow(row: MockCustomerRow) {
    return {
      id: row.id,
      name: row.name,
      phone: row.phone,
      address: row.address,
      installationAddress: row.installation_address,
      latitude: row.latitude,
      longitude: row.longitude,
      packageId: row.package_id,
      packageName: row.package_name,
      type: row.type,
      username: row.username,
      ipAddress: row.ip_address,
      status: row.status,
      routerSyncStatus: row.router_sync_status,
      routerLastSyncAt: row.router_last_sync_at,
      routerLastSyncMessage: row.router_last_sync_message,
      isPasswordConfigured: Boolean(row.password_encrypted && row.password_encrypted !== ''),
      registeredAt: row.registered_at,
      dueDateDay: row.due_date_day,
      monthlyFee: row.monthly_fee,
      installationDate: row.installation_date,
    };
  }

  handleQuery(sql: string, params: any[] = []): { rows: any[]; rowCount: number } {
    const q = sql.replace(/\s+/g, ' ').trim();

    if (this.injectErrorOnPattern && this.injectErrorOnPattern.pattern.test(q)) {
      throw this.injectErrorOnPattern.error;
    }

    if (q === 'BEGIN' || q === 'COMMIT' || q === 'ROLLBACK' || q === 'SELECT 1 AS healthcheck') {
      return { rows: [{ healthcheck: 1 }], rowCount: 1 };
    }

    if (q.startsWith('SELECT pg_advisory_xact_lock')) {
      return { rows: [{ pg_advisory_xact_lock: '' }], rowCount: 1 };
    }

    if (q.startsWith('SELECT * FROM invoices WHERE id = $1 FOR UPDATE')) {
      const inv = this.invoices.get(params[0]);
      return { rows: inv ? [{ ...inv }] : [], rowCount: inv ? 1 : 0 };
    }

    if (q.startsWith('SELECT COALESCE(SUM(amount), 0) AS total_paid FROM payments')) {
      return { rows: [{ total_paid: 0 }], rowCount: 1 };
    }

    if (q.includes('FROM information_schema.columns')) {
      if (q.includes("table_name = 'customers'")) {
        return { rows: [{ column_name: 'password_encrypted' }], rowCount: 1 };
      }
      if (q.includes("table_name = 'packages'")) {
        return { rows: [{ column_name: 'pppoe_profile' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }

    if (q.includes('FROM mikrotik_settings') && q.includes('AS "isPasswordConfigured"')) {
      return {
        rows: [
          {
            id: 'default',
            routerName: 'MockRB4011',
            host: '127.0.0.1',
            apiPort: this.routerPort,
            username: 'admin',
            status: 'disconnected',
            modelTarget: 'RB4011iGS+RM',
            rosVersionPreview: 'RouterOS v7.14',
            useSsl: false,
            timeoutSeconds: 5,
            notes: '',
            lastTestedAt: null,
            lastStatusMessage: this.routerLastStatusMessage,
            isPasswordConfigured: Boolean(this.routerPasswordEncrypted),
          },
        ],
        rowCount: 1,
      };
    }

    if (q.includes('FROM mikrotik_settings')) {
      return {
        rows: [
          {
            host: '127.0.0.1',
            api_port: this.routerPort,
            username: 'admin',
            password_encrypted: this.routerPasswordEncrypted,
            password_hash: null,
            use_ssl: false,
            timeout_seconds: 5,
          },
        ],
        rowCount: 1,
      };
    }

    if (q.startsWith('UPDATE mikrotik_settings')) {
      this.routerLastStatusMessage = params[0] || null;
      return { rows: [], rowCount: 1 };
    }

    if (q.includes('FROM customers c WHERE c.is_deleted IS NOT TRUE')) {
      const list = [...this.customers.values()].filter((c) => !c.is_deleted).map((c) => this.mapReturningRow(c));
      return { rows: list, rowCount: list.length };
    }

    if (q.startsWith('SELECT pppoe_profile, hotspot_profile FROM packages WHERE id = $1')) {
      const pkg = this.packages.get(params[0]);
      return { rows: pkg ? [pkg] : [], rowCount: pkg ? 1 : 0 };
    }

    if (q.startsWith('UPDATE packages p SET active_users_count')) {
      const pkg = this.packages.get(params[0]);
      if (pkg) {
        pkg.active_users_count = [...this.customers.values()].filter(
          (c) => c.package_id === pkg.id && c.status === 'active' && !c.is_deleted
        ).length;
      }
      return { rows: [], rowCount: pkg ? 1 : 0 };
    }

    if (q.startsWith('SELECT * FROM customers WHERE id = $1')) {
      const row = this.customers.get(params[0]);
      if (!row || (q.includes('is_deleted IS NOT TRUE') && row.is_deleted)) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [{ ...row }], rowCount: 1 };
    }

    if (q.startsWith('SELECT router_sync_status, router_last_sync_message FROM customers WHERE id = $1')) {
      const row = this.customers.get(params[0]);
      return {
        rows: row ? [{ router_sync_status: row.router_sync_status, router_last_sync_message: row.router_last_sync_message }] : [],
        rowCount: row ? 1 : 0,
      };
    }

    if (q.startsWith('INSERT INTO customers')) {
      const nowIso = new Date().toISOString();
      const row: MockCustomerRow = {
        id: params[0],
        name: params[1],
        phone: params[2],
        address: params[3],
        installation_address: params[4],
        latitude: params[5],
        longitude: params[6],
        package_id: params[7],
        package_name: params[8],
        type: params[9],
        username: params[10],
        password_encrypted: params[11],
        ip_address: params[12],
        status: params[13],
        router_sync_status: params[14],
        router_last_sync_at: null,
        router_last_sync_message: params[15],
        registered_at: params[16],
        due_date_day: params[17],
        monthly_fee: params[18],
        installation_date: params[19],
        is_deleted: false,
        deleted_at: null,
        updated_at: nowIso,
      };
      this.customers.set(row.id, row);
      return { rows: [this.mapReturningRow(row)], rowCount: 1 };
    }

    if (q.startsWith('UPDATE customers SET router_sync_status =')) {
      const statusMatch = q.match(/router_sync_status\s*=\s*'(synced|failed|pending)'/);
      const syncStatus = (statusMatch?.[1] as 'synced' | 'failed' | 'pending') || 'failed';
      const message = params[0];
      const id = params[1];
      const row = this.customers.get(id);
      if (row) {
        row.router_sync_status = syncStatus;
        row.router_last_sync_message = message;
        row.router_last_sync_at = new Date().toISOString();
      }
      return { rows: [], rowCount: row ? 1 : 0 };
    }

    if (q.startsWith('UPDATE customers SET status = $1')) {
      const status = params[0];
      const id = params[1];
      const row = this.customers.get(id);
      if (!row) return { rows: [], rowCount: 0 };
      row.status = status;
      row.updated_at = new Date().toISOString();
      return { rows: [this.mapReturningRow(row)], rowCount: 1 };
    }

    if (q.startsWith('UPDATE customers SET name = COALESCE')) {
      const id = params[16];
      const row = this.customers.get(id);
      if (!row) return { rows: [], rowCount: 0 };
      if (params[0] != null) row.name = params[0];
      if (params[1] != null) row.phone = params[1];
      if (params[2] != null) row.address = params[2];
      if (params[3] != null) row.installation_address = params[3];
      if (params[4] != null) row.latitude = params[4];
      if (params[5] != null) row.longitude = params[5];
      if (params[6] != null) row.package_id = params[6];
      if (params[7] != null) row.package_name = params[7];
      if (params[8] != null) row.type = params[8];
      if (params[9] != null) row.username = params[9];
      if (params[10] != null) row.password_encrypted = params[10];
      if (params[11] != null) row.ip_address = params[11];
      if (params[12] != null) row.status = params[12];
      if (params[13] != null) row.due_date_day = params[13];
      if (params[14] != null) row.monthly_fee = params[14];
      if (params[15] != null) row.installation_date = params[15];
      row.updated_at = new Date().toISOString();
      return { rows: [this.mapReturningRow(row)], rowCount: 1 };
    }

    throw new Error(`Unhandled SQL in MockPostgresStore: ${q}`);
  }
}

// ============================================================================
// 3. HARNESS & ALL 17+ TEST SCENARIOS
// ============================================================================
async function main() {
  const mockRouter = new MockRouterOsServer();
  const routerPort = await mockRouter.start();

  const dbStore = new MockPostgresStore();

  // Patch pg.Pool BEFORE importing dbRoutes
  const origQuery = pg.Pool.prototype.query;
  const origConnect = pg.Pool.prototype.connect;

  (pg.Pool.prototype as any).query = async function (text: string, params?: any[]) {
    return dbStore.handleQuery(text, params);
  };
  (pg.Pool.prototype as any).connect = async function () {
    return {
      query: async (text: string, params?: any[]) => dbStore.handleQuery(text, params),
      release: () => {},
    };
  };

  const { encryptMikrotikPassword, decryptMikrotikPassword } = await import('../cryptoUtils.js');
  const {
    testMikrotikConnection,
    disconnectPppoeSession,
    disconnectHotspotSession,
    createOrUpdatePppoeSecret,
  } = await import('../mikrotikService.js');
  const {
    ALLOWED_ERROR_CODES,
    ALLOWED_SOCKET_ERROR_CODES,
    SafeOperationalError,
    sanitizeSocketErrorCode,
    sanitizeDatabaseError,
    sanitizeMikrotikError,
    sanitizeGenericServerError,
    redactSensitiveText,
    logSafeServerError,
  } = await import('../errorSanitizer.js');
  const dbRoutesModule = await import('../dbRoutes.js');
  const { parsePendingSyncActions, sanitizeMikrotikOperationMessage, createDbRouter } = dbRoutesModule;

  const routerPasswordEnc = encryptMikrotikPassword('router_secret_123');
  dbStore.reset(routerPort, routerPasswordEnc);

  const app = express();
  app.use(express.json());
  app.use('/api', dbRoutesModule.default);

  const httpServer = http.createServer(app);
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', () => resolve()));
  const baseUrl = `http://127.0.0.1:${(httpServer.address() as net.AddressInfo).port}/api`;

  async function api(method: string, path: string, body?: any): Promise<{ status: number; json: any; rawText: string }> {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const rawText = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(rawText);
    } catch {
      // keep null
    }
    return { status: res.status, json, rawText };
  }

  function decodeV1Meta(msg: string | null | undefined): any {
    if (!msg) return null;
    const m = msg.match(/\[SYNC_META_V1:([A-Za-z0-9_-]+)\]/);
    if (!m) return null;
    return JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8'));
  }

  function assertNoPlaintextLeak(payloadText: string, dbRow: MockCustomerRow | undefined, secretPwd: string) {
    assert.ok(!payloadText.includes(secretPwd), 'API response leaked plaintext password!');
    if (dbRow?.router_last_sync_message) {
      assert.ok(!dbRow.router_last_sync_message.includes(secretPwd), 'DB sync message leaked plaintext password!');
    }
  }

  let passed = 0;
  let failed = 0;

  async function runScenario(no: number, name: string, fn: () => Promise<void>) {
    mockRouter.reset(true);
    dbStore.reset(routerPort, routerPasswordEnc);
    try {
      await fn();
      passed++;
      console.log(`[PASS] Skenario ${no}: ${name}`);
    } catch (err: any) {
      failed++;
      console.error(`[FAIL] Skenario ${no}: ${name} -> ${err?.message || err}`);
    }
  }

  // Skenario 1: Provisioning PPPoE baru berhasil
  await runScenario(1, 'Provisioning pelanggan PPPoE baru berhasil', async () => {
    const res = await api('POST', '/customers', {
      id: 'c-01',
      name: 'Andi PPPoE',
      phone: '0811111111',
      packageId: 'pkg-10m',
      packageName: 'Paket 10 Mbps',
      type: 'pppoe',
      username: 'andi_pppoe',
      password: 'SecretPassword123',
      status: 'active',
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.routerSyncStatus, 'synced');
    assert.equal(mockRouter.pppoeSecrets.length, 1);
    assert.equal(mockRouter.pppoeSecrets[0].name, 'andi_pppoe');
    assert.equal(mockRouter.pppoeSecrets[0].profile, 'prof-pppoe-10m');
    assert.equal(mockRouter.pppoeSecrets[0].disabled, 'false');
    assertNoPlaintextLeak(res.rawText, dbStore.customers.get('c-01'), 'SecretPassword123');
  });

  // Skenario 2: Provisioning Hotspot baru berhasil
  await runScenario(2, 'Provisioning pelanggan Hotspot baru berhasil', async () => {
    const res = await api('POST', '/customers', {
      id: 'c-02',
      name: 'Budi Hotspot',
      phone: '0822222222',
      packageId: 'pkg-10m',
      packageName: 'Paket 10 Mbps',
      type: 'hotspot',
      username: 'budi_hs',
      password: 'HotspotPass999',
      status: 'active',
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.routerSyncStatus, 'synced');
    assert.equal(mockRouter.hotspotUsers.length, 1);
    assert.equal(mockRouter.hotspotUsers[0].name, 'budi_hs');
    assert.equal(mockRouter.hotspotUsers[0].profile, 'prof-hs-10m');
    assertNoPlaintextLeak(res.rawText, dbStore.customers.get('c-02'), 'HotspotPass999');
  });

  // Skenario 3: Update paket berhasil mengubah profile dan memutus seluruh sesi aktif
  await runScenario(3, 'Update paket berhasil ubah profile dan putus seluruh sesi aktif', async () => {
    await api('POST', '/customers', {
      id: 'c-03',
      name: 'Citra',
      phone: '0833',
      packageId: 'pkg-10m',
      packageName: 'Paket 10 Mbps',
      type: 'pppoe',
      username: 'citra03',
      password: 'Password03',
      status: 'active',
    });
    mockRouter.pppoeActives.push({ '.id': '*A1', name: 'citra03' }, { '.id': '*A2', name: 'citra03' });

    const upd = await api('PUT', '/customers/c-03', {
      packageId: 'pkg-20m',
      packageName: 'Paket 20 Mbps',
    });
    assert.equal(upd.status, 200);
    assert.equal(upd.json.data.routerSyncStatus, 'synced');
    assert.equal(mockRouter.pppoeSecrets[0].profile, 'prof-pppoe-20m');
    assert.equal(mockRouter.pppoeActives.length, 0);
  });

  // Skenario 4: Update paket gagal sebelum profile berubah -> sesi aktif TIDAK diputus
  await runScenario(4, 'Update paket gagal sebelum profile berubah -> sesi aktif TIDAK diputus', async () => {
    await api('POST', '/customers', {
      id: 'c-04',
      name: 'Dedi',
      phone: '0844',
      packageId: 'pkg-10m',
      packageName: 'Paket 10 Mbps',
      type: 'pppoe',
      username: 'dedi04',
      password: 'Password04',
      status: 'active',
    });
    mockRouter.pppoeActives.push({ '.id': '*A4', name: 'dedi04' });
    mockRouter.trapOnCommand.set('/ppp/secret/set', 'router readonly error');

    const upd = await api('PUT', '/customers/c-04', {
      packageId: 'pkg-20m',
      packageName: 'Paket 20 Mbps',
    });
    assert.equal(upd.status, 200);
    assert.equal(upd.json.data.routerSyncStatus, 'failed');
    assert.equal(mockRouter.pppoeSecrets[0].profile, 'prof-pppoe-10m');
    assert.equal(mockRouter.pppoeActives.length, 1, 'Sesi aktif tidak boleh diputus saat set gagal!');
    const meta = decodeV1Meta(upd.json.data.routerLastSyncMessage);
    assert.equal(meta.needsSessionDisconnect, true);
  });

  // Skenario 5: Profile berubah, tetapi putus salah satu sesi aktif gagal -> failed + retry sync-router berhasil hingga synced
  await runScenario(5, 'Profile berubah, salah satu putus sesi gagal -> failed -> retry sync-router sukses synced', async () => {
    await api('POST', '/customers', {
      id: 'c-05',
      name: 'Eka',
      phone: '0855',
      packageId: 'pkg-10m',
      packageName: 'Paket 10 Mbps',
      type: 'pppoe',
      username: 'eka05',
      password: 'Password05',
      status: 'active',
    });
    mockRouter.pppoeActives.push({ '.id': '*S5A', name: 'eka05' }, { '.id': '*S5B', name: 'eka05' });
    mockRouter.failRemoveIds.add('*S5B');

    const upd = await api('PUT', '/customers/c-05', {
      packageId: 'pkg-20m',
      packageName: 'Paket 20 Mbps',
    });
    assert.equal(upd.json.data.routerSyncStatus, 'failed');
    assert.equal(mockRouter.pppoeSecrets[0].profile, 'prof-pppoe-20m');
    assert.equal(mockRouter.pppoeActives.length, 1);
    const meta = decodeV1Meta(upd.json.data.routerLastSyncMessage);
    assert.equal(meta.needsSessionDisconnect, true);

    mockRouter.failRemoveIds.delete('*S5B');
    const retry = await api('POST', '/customers/c-05/sync-router');
    assert.equal(retry.status, 200);
    assert.equal(retry.json.data.routerSyncStatus, 'synced');
    assert.equal(mockRouter.pppoeActives.length, 0);
  });

  // Skenario 6: Ganti username PPPoE/Hotspot -> akun baru dibuat & diverifikasi, akun lama dihapus & sesinya diputus
  await runScenario(6, 'Ganti username PPPoE -> akun baru terverifikasi, akun lama & sesinya bersih', async () => {
    await api('POST', '/customers', {
      id: 'c-06',
      name: 'Fajar',
      phone: '0866',
      packageId: 'pkg-10m',
      packageName: 'Paket 10 Mbps',
      type: 'pppoe',
      username: 'fajar_lama',
      password: 'Password06',
      status: 'active',
    });
    mockRouter.pppoeActives.push({ '.id': '*A6', name: 'fajar_lama' });

    const upd = await api('PUT', '/customers/c-06', { username: 'fajar_baru' });
    assert.equal(upd.json.data.routerSyncStatus, 'synced');
    assert.equal(mockRouter.pppoeSecrets.some((s) => s.name === 'fajar_baru'), true);
    assert.equal(mockRouter.pppoeSecrets.some((s) => s.name === 'fajar_lama'), false);
    assert.equal(mockRouter.pppoeActives.length, 0);
  });

  // Skenario 7: Ubah tipe PPPoE <-> Hotspot -> akun baru dibuat, akun lama tipe berbeda dihapus & sesinya diputus
  await runScenario(7, 'Ubah tipe PPPoE ke Hotspot -> akun Hotspot dibuat, secret PPPoE & sesi lama bersih', async () => {
    await api('POST', '/customers', {
      id: 'c-07',
      name: 'Gina',
      phone: '0877',
      packageId: 'pkg-10m',
      packageName: 'Paket 10 Mbps',
      type: 'pppoe',
      username: 'gina_pppoe',
      password: 'Password07',
      status: 'active',
    });
    mockRouter.pppoeActives.push({ '.id': '*A7', name: 'gina_pppoe' });

    const upd = await api('PUT', '/customers/c-07', { type: 'hotspot', username: 'gina_hs' });
    assert.equal(upd.json.data.routerSyncStatus, 'synced');
    assert.equal(mockRouter.hotspotUsers.some((u) => u.name === 'gina_hs' && u.profile === 'prof-hs-10m'), true);
    assert.equal(mockRouter.pppoeSecrets.length, 0);
    assert.equal(mockRouter.pppoeActives.length, 0);
  });

  // Skenario 8: Akun baru gagal dibuat/diverifikasi saat perubahan identitas -> akun lama & sesi lama TIDAK dihapus
  await runScenario(8, 'Akun baru gagal dibuat saat ganti identitas -> akun lama & sesi TIDAK dihapus', async () => {
    await api('POST', '/customers', {
      id: 'c-08',
      name: 'Hadi',
      phone: '0888',
      packageId: 'pkg-10m',
      packageName: 'Paket 10 Mbps',
      type: 'pppoe',
      username: 'hadi_lama',
      password: 'Password08',
      status: 'active',
    });
    mockRouter.pppoeActives.push({ '.id': '*A8', name: 'hadi_lama' });
    mockRouter.trapOnCommand.set('/ppp/secret/add', 'cannot create secret');

    const upd = await api('PUT', '/customers/c-08', { username: 'hadi_baru' });
    assert.equal(upd.json.data.routerSyncStatus, 'failed');
    assert.equal(dbStore.customers.get('c-08')?.username, 'hadi_baru');
    assert.equal(mockRouter.pppoeSecrets.some((s) => s.name === 'hadi_lama'), true);
    assert.equal(mockRouter.pppoeActives.length, 1);
    const meta = decodeV1Meta(upd.json.data.routerLastSyncMessage);
    assert.deepEqual(meta.oldAccounts, [{ type: 'pppoe', username: 'hadi_lama' }]);
  });

  // Skenario 9: Akun baru berhasil, hapus akun lama gagal -> status failed + penanda oldAccounts -> retry bersih hingga synced
  await runScenario(9, 'Akun baru OK, hapus akun lama gagal -> failed + SYNC_META_V1 -> retry sukses synced', async () => {
    await api('POST', '/customers', {
      id: 'c-09',
      name: 'Indra',
      phone: '0899',
      packageId: 'pkg-10m',
      packageName: 'Paket 10 Mbps',
      type: 'pppoe',
      username: 'indra_lama',
      password: 'Password09',
      status: 'active',
    });
    const oldId = mockRouter.pppoeSecrets[0]['.id'];
    mockRouter.pppoeActives.push({ '.id': '*A9', name: 'indra_lama' });
    mockRouter.failRemoveIds.add(oldId);

    const upd = await api('PUT', '/customers/c-09', { username: 'indra_baru' });
    assert.equal(upd.json.data.routerSyncStatus, 'failed');
    assert.equal(mockRouter.pppoeSecrets.some((s) => s.name === 'indra_baru'), true);
    assert.equal(mockRouter.pppoeSecrets.some((s) => s.name === 'indra_lama'), true);

    mockRouter.failRemoveIds.delete(oldId);
    const retry = await api('POST', '/customers/c-09/sync-router');
    assert.equal(retry.status, 200);
    assert.equal(retry.json.data.routerSyncStatus, 'synced');
    assert.equal(mockRouter.pppoeSecrets.some((s) => s.name === 'indra_lama'), false);
    assert.equal(mockRouter.pppoeActives.length, 0);
  });

  // Skenario 10: Pembaruan berikutnya dengan username/tipe sama ketika akun lama belum bersih -> akun lama tetap tidak hilang
  await runScenario(10, 'Edit berikutnya dengan username/tipe sama tetap membawa penanda akun lama tertunda', async () => {
    await api('POST', '/customers', {
      id: 'c-10',
      name: 'Joko',
      phone: '0810',
      packageId: 'pkg-10m',
      packageName: 'Paket 10 Mbps',
      type: 'pppoe',
      username: 'joko_lama',
      password: 'Password10',
      status: 'active',
    });
    const oldId = mockRouter.pppoeSecrets[0]['.id'];
    mockRouter.failRemoveIds.add(oldId);

    const upd1 = await api('PUT', '/customers/c-10', { username: 'joko_baru' });
    assert.equal(upd1.json.data.routerSyncStatus, 'failed');

    // Edit kedua: hanya ubah nama (username tetap joko_baru), cleanup masih gagal
    const upd2 = await api('PUT', '/customers/c-10', { name: 'Joko Updated' });
    assert.equal(upd2.json.data.routerSyncStatus, 'failed');
    const meta2 = decodeV1Meta(upd2.json.data.routerLastSyncMessage);
    assert.deepEqual(meta2.oldAccounts, [{ type: 'pppoe', username: 'joko_lama' }]);

    // Pulihkan & retry -> baru bersih
    mockRouter.failRemoveIds.delete(oldId);
    const retry = await api('POST', '/customers/c-10/sync-router');
    assert.equal(retry.json.data.routerSyncStatus, 'synced');
    assert.equal(mockRouter.pppoeSecrets.some((s) => s.name === 'joko_lama'), false);
  });

  // Skenario 11: Username mengandung karakter khusus tersimpan utuh di penanda & dibersihkan saat retry
  await runScenario(11, 'Username berkarakter khusus tersimpan utuh di SYNC_META_V1 dan dibersihkan saat retry', async () => {
    const specialUser = 'user@kota+1#rt02/a';
    await api('POST', '/customers', {
      id: 'c-11',
      name: 'Kiki Special',
      phone: '0811',
      packageId: 'pkg-10m',
      packageName: 'Paket 10 Mbps',
      type: 'pppoe',
      username: specialUser,
      password: 'Password11',
      status: 'active',
    });
    const oldId = mockRouter.pppoeSecrets[0]['.id'];
    mockRouter.pppoeActives.push({ '.id': '*A11', name: specialUser });
    mockRouter.failRemoveIds.add(oldId);

    const upd = await api('PUT', '/customers/c-11', { username: 'kiki_new' });
    assert.equal(upd.json.data.routerSyncStatus, 'failed');
    const meta = decodeV1Meta(upd.json.data.routerLastSyncMessage);
    assert.deepEqual(meta.oldAccounts, [{ type: 'pppoe', username: specialUser }]);

    mockRouter.failRemoveIds.delete(oldId);
    const retry = await api('POST', '/customers/c-11/sync-router');
    assert.equal(retry.json.data.routerSyncStatus, 'synced');
    assert.equal(mockRouter.pppoeSecrets.some((s) => s.name === specialUser), false);
    assert.equal(mockRouter.pppoeActives.length, 0);
  });

  // Skenario 12: Username mengandung koma tersimpan utuh di penanda (tidak terpecah koma) & dibersihkan saat retry
  await runScenario(12, 'Username mengandung koma tersimpan utuh di SYNC_META_V1 dan dibersihkan saat retry', async () => {
    const commaUser = 'warga,blokA,01';
    await api('POST', '/customers', {
      id: 'c-12',
      name: 'Lina Comma',
      phone: '0812',
      packageId: 'pkg-10m',
      packageName: 'Paket 10 Mbps',
      type: 'hotspot',
      username: commaUser,
      password: 'Password12',
      status: 'active',
    });
    const oldId = mockRouter.hotspotUsers[0]['.id'];
    mockRouter.hotspotActives.push({ '.id': '*H12', user: commaUser });
    mockRouter.failRemoveIds.add(oldId);

    const upd = await api('PUT', '/customers/c-12', { username: 'lina_new' });
    assert.equal(upd.json.data.routerSyncStatus, 'failed');
    const meta = decodeV1Meta(upd.json.data.routerLastSyncMessage);
    assert.equal(meta.oldAccounts.length, 1);
    assert.deepEqual(meta.oldAccounts[0], { type: 'hotspot', username: commaUser });

    mockRouter.failRemoveIds.delete(oldId);
    const retry = await api('POST', '/customers/c-12/sync-router');
    assert.equal(retry.json.data.routerSyncStatus, 'synced');
    assert.equal(mockRouter.hotspotUsers.some((u) => u.name === commaUser), false);
    assert.equal(mockRouter.hotspotActives.length, 0);
  });

  // Skenario 13: Penanda router_last_sync_message rusak/terpotong -> gagal aman (failed), tidak auto-synced
  await runScenario(13, 'Penanda router_last_sync_message rusak/terpotong -> failed aman, tidak pernah auto-synced', async () => {
    await api('POST', '/customers', {
      id: 'c-13',
      name: 'Mona Corrupt',
      phone: '0813',
      packageId: 'pkg-10m',
      packageName: 'Paket 10 Mbps',
      type: 'pppoe',
      username: 'mona13',
      password: 'Password13',
      status: 'active',
    });
    const row = dbStore.customers.get('c-13')!;
    row.router_sync_status = 'failed';
    row.router_last_sync_message = 'Gagal sebelumnya [SYNC_META_V1:broken_truncated_b64';

    const retry = await api('POST', '/customers/c-13/sync-router');
    assert.equal(retry.status, 422);
    assert.equal(retry.json.success, false);
    assert.equal(retry.json.data.routerSyncStatus, 'failed');
    assert.equal(dbStore.customers.get('c-13')?.router_sync_status, 'failed');

    const patchRes = await api('PATCH', '/customers/c-13/status', { status: 'active' });
    assert.equal(patchRes.status, 200);
    assert.equal(patchRes.json.data.routerSyncStatus, 'failed');
    const metaAfter = decodeV1Meta(patchRes.json.data.routerLastSyncMessage);
    assert.equal(metaAfter.corrupted, true);
  });

  // Skenario 14: Duplikasi akun username persis sama (>1 entri) -> ditolak dengan error jelas, tidak hapus sembarangan
  await runScenario(14, 'Duplikasi akun exact username (>1) -> ditolak failed tanpa menghapus akun', async () => {
    mockRouter.pppoeSecrets.push(
      { '.id': '*DUP1', name: 'dup_user', password: 'Password14', profile: 'prof-pppoe-10m', disabled: 'false' },
      { '.id': '*DUP2', name: 'dup_user', password: 'Password14', profile: 'prof-pppoe-10m', disabled: 'false' },
      { '.id': '*OTHER', name: 'pelanggan_lain', password: 'Other', profile: 'prof-pppoe-10m', disabled: 'false' }
    );
    const res = await api('POST', '/customers', {
      id: 'c-14',
      name: 'Niko Dup',
      phone: '0814',
      packageId: 'pkg-10m',
      packageName: 'Paket 10 Mbps',
      type: 'pppoe',
      username: 'dup_user',
      password: 'Password14',
      status: 'active',
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.routerSyncStatus, 'failed');
    assert.match(res.json.data.routerLastSyncMessage, /duplikat|Duplikasi/i);
    assert.equal(mockRouter.pppoeSecrets.length, 3, 'Tidak boleh menghapus entri duplikat atau akun lain sembarangan!');
  });

  // Skenario 15: Perbedaan huruf besar/kecil username (case-sensitivity)
  await runScenario(15, 'Case-sensitive username matching -> Budi01 tidak ikut tersentuh saat kelola budi01', async () => {
    mockRouter.pppoeSecrets.push({
      '.id': '*CASE_UP',
      name: 'Budi01',
      password: 'UpperPass',
      profile: 'prof-pppoe-10m',
      disabled: 'false',
    });
    mockRouter.pppoeActives.push({ '.id': '*ACT_UP', name: 'Budi01' });

    const res = await api('POST', '/customers', {
      id: 'c-15',
      name: 'budi lower',
      phone: '0815',
      packageId: 'pkg-10m',
      packageName: 'Paket 10 Mbps',
      type: 'pppoe',
      username: 'budi01',
      password: 'LowerPassword15',
      status: 'active',
    });
    assert.equal(res.json.data.routerSyncStatus, 'synced');
    assert.equal(mockRouter.pppoeSecrets.length, 2);

    // Putuskan sesi budi01 -> Budi01 tidak ikut terputus
    mockRouter.pppoeActives.push({ '.id': '*ACT_LOW', name: 'budi01' });
    const patchIso = await api('PATCH', '/customers/c-15/status', { status: 'isolated' });
    assert.equal(patchIso.json.data.routerSyncStatus, 'synced');
    assert.equal(mockRouter.pppoeSecrets.find((s) => s.name === 'Budi01')?.disabled, 'false');
    assert.equal(mockRouter.pppoeSecrets.find((s) => s.name === 'budi01')?.disabled, 'true');
    assert.equal(mockRouter.pppoeActives.length, 1);
    assert.equal(mockRouter.pppoeActives[0].name, 'Budi01');
  });

  // Skenario 16: PATCH /customers/:id/status ketika ada pekerjaan tertunda (needsSessionDisconnect & oldAccounts)
  await runScenario(16, 'PATCH status menjaga & memproses pending needsSessionDisconnect dan oldAccounts hingga benar-benar tuntas', async () => {
    await api('POST', '/customers', {
      id: 'c-16',
      name: 'Oki Status',
      phone: '0816',
      packageId: 'pkg-10m',
      packageName: 'Paket 10 Mbps',
      type: 'pppoe',
      username: 'oki_lama',
      password: 'Password16',
      status: 'active',
    });
    const oldId = mockRouter.pppoeSecrets[0]['.id'];
    mockRouter.pppoeActives.push({ '.id': '*A16_OLD', name: 'oki_lama' });
    mockRouter.failRemoveIds.add(oldId);

    // Ganti username, cleanup gagal -> tertunda oldAccount
    const upd = await api('PUT', '/customers/c-16', { username: 'oki_baru' });
    assert.equal(upd.json.data.routerSyncStatus, 'failed');

    // Tambahkan sesi aktif baru & gagalkan remove sesi saat isolated
    mockRouter.pppoeActives.push({ '.id': '*A16_NEW', name: 'oki_baru' });
    mockRouter.failRemoveIds.add('*A16_NEW');

    const patchIso = await api('PATCH', '/customers/c-16/status', { status: 'isolated' });
    assert.equal(patchIso.json.data.routerSyncStatus, 'failed');

    // Sekarang ubah kembali ke active sementara oki_baru masih punya pending disconnect & cleanup masih gagal -> toggle enable OK tetapi status HARUS tetap failed!
    const patchBackFail = await api('PATCH', '/customers/c-16/status', { status: 'active' });
    assert.equal(patchBackFail.json.data.routerSyncStatus, 'failed');
    const metaBack = decodeV1Meta(patchBackFail.json.data.routerLastSyncMessage);
    assert.equal(metaBack.needsSessionDisconnect, true);
    assert.deepEqual(metaBack.oldAccounts, [{ type: 'pppoe', username: 'oki_lama' }]);

    // Pulihkan semua fault & PATCH status active -> seluruh pending bersih -> barulah boleh synced!
    mockRouter.failRemoveIds.delete(oldId);
    mockRouter.failRemoveIds.delete('*A16_NEW');
    const patchClean = await api('PATCH', '/customers/c-16/status', { status: 'active' });
    assert.equal(patchClean.json.data.routerSyncStatus, 'synced');
    assert.equal(mockRouter.pppoeSecrets.some((s) => s.name === 'oki_lama'), false);
    assert.equal(mockRouter.pppoeActives.length, 0);
  });

  // Skenario 17: !trap, !fatal, router offline, dan verifikasi pasca-remove 0 sesi aktif tersisa
  await runScenario(17, '!trap, !fatal, router offline, verifikasi pasca-remove 0 sesi, dan kompatibilitas penanda lama', async () => {
    // 17a: Router offline saat POST customer -> data tersimpan di PostgreSQL, routerSyncStatus = failed
    mockRouter.offline = true;
    const postOffline = await api('POST', '/customers', {
      id: 'c-17',
      name: 'Rina Fault',
      phone: '0817',
      packageId: 'pkg-10m',
      packageName: 'Paket 10 Mbps',
      type: 'pppoe',
      username: 'rina17',
      password: 'Password17',
      status: 'active',
    });
    assert.equal(postOffline.status, 200);
    assert.equal(postOffline.json.data.routerSyncStatus, 'failed');
    assert.ok(dbStore.customers.has('c-17'), 'Data pelanggan harus tetap tersimpan saat router offline!');

    // 17b: !fatal pada provisioning saat retry -> tertangani sebagai failed eksplisit
    mockRouter.offline = false;
    mockRouter.fatalOnCommand.set('/ppp/secret/add', 'critical router failure');
    const retryFatal = await api('POST', '/customers/c-17/sync-router');
    assert.equal(retryFatal.json.data.routerSyncStatus, 'failed');

    // 17c: Provisioning sukses
    mockRouter.fatalOnCommand.clear();
    const retryOk = await api('POST', '/customers/c-17/sync-router');
    assert.equal(retryOk.json.data.routerSyncStatus, 'synced');

    // 17d: !trap saat /ppp/secret/set
    mockRouter.trapOnCommand.set('/ppp/secret/set', 'invalid profile constraint');
    const trapUpd = await api('PUT', '/customers/c-17', { packageId: 'pkg-20m', packageName: 'Paket 20 Mbps' });
    assert.equal(trapUpd.json.data.routerSyncStatus, 'failed');
    mockRouter.trapOnCommand.clear();

    // 17e: Verifikasi pasca-remove (remove reply !done namun sesi masih tersisa saat /print ulang)
    mockRouter.pppoeActives.push({ '.id': '*LINGER1', name: 'rina17' });
    mockRouter.lingerAfterRemoveIds.add('*LINGER1');
    const dcRes = await disconnectPppoeSession(
      { host: '127.0.0.1', port: routerPort, username: 'admin', password: 'router_secret_123', timeoutSeconds: 5 },
      'rina17'
    );
    assert.equal(dcRes.success, false, 'Harus gagal jika sesi masih tersisa saat verifikasi /print pasca-remove!');
    assert.match(dcRes.message, /tertinggal|masih terdapat/i);

    mockRouter.hotspotActives.push({ '.id': '*HLINGER', user: 'rina_hs' });
    mockRouter.lingerAfterRemoveIds.add('*HLINGER');
    const hsDcRes = await disconnectHotspotSession(
      { host: '127.0.0.1', port: routerPort, username: 'admin', password: 'router_secret_123', timeoutSeconds: 5 },
      'rina_hs'
    );
    assert.equal(hsDcRes.success, false);

    // Uji helper createOrUpdatePppoeSecret ketika duplicate muncul langsung
    mockRouter.pppoeSecrets.push({ '.id': '*EX1', name: 'rina17', password: 'Password17', profile: 'prof-pppoe-10m', disabled: 'false' });
    await assert.rejects(
      () =>
        createOrUpdatePppoeSecret(
          { host: '127.0.0.1', port: routerPort, username: 'admin', password: 'router_secret_123', timeoutSeconds: 5 },
          { username: 'rina17', password: 'Password17', profile: 'prof-pppoe-10m' }
        ),
      /duplikat/i
    );

    // 17f: Kompatibilitas mundur penanda versi lama [Perlu pembersihan akun lama: ...] & [Perlu ulang pemutusan sesi]
    mockRouter.lingerAfterRemoveIds.clear();
    mockRouter.pppoeActives = [{ '.id': '*LEGACY_ACT', name: 'legacy_old_user' }];
    mockRouter.pppoeSecrets = [
      { '.id': '*L_OLD', name: 'legacy_old_user', password: 'Password17', profile: 'prof-pppoe-10m', disabled: 'false' },
      { '.id': '*L_NEW', name: 'rina17', password: 'Password17', profile: 'prof-pppoe-10m', disabled: 'false' },
    ];
    const row = dbStore.customers.get('c-17')!;
    row.router_sync_status = 'failed';
    row.router_last_sync_message =
      'Gagal lama [Perlu ulang pemutusan sesi] [Perlu pembersihan akun lama: pppoe:legacy_old_user]';

    const legacyRetry = await api('POST', '/customers/c-17/sync-router');
    assert.equal(legacyRetry.json.data.routerSyncStatus, 'synced');
    assert.equal(mockRouter.pppoeSecrets.some((s) => s.name === 'legacy_old_user'), false);
    assert.equal(mockRouter.pppoeActives.length, 0);
  });

  // Skenario 18: Pelanggan active tanpa pekerjaan pemutusan sesi tertunda -> retry TIDAK memutus sesi aktif (PPPoE & Hotspot)
  await runScenario(18, 'Retry pelanggan active tanpa pekerjaan tertunda TIDAK memutus sesi aktif PPPoE maupun Hotspot', async () => {
    await api('POST', '/customers', {
      id: 'c-18a',
      name: 'Sari Active PPPoE',
      phone: '081801',
      packageId: 'pkg-10m',
      packageName: 'Paket 10 Mbps',
      type: 'pppoe',
      username: 'sari18',
      password: 'Password18A',
      status: 'active',
    });
    await api('POST', '/customers', {
      id: 'c-18b',
      name: 'Tono Active Hotspot',
      phone: '081802',
      packageId: 'pkg-10m',
      packageName: 'Paket 10 Mbps',
      type: 'hotspot',
      username: 'tono18',
      password: 'Password18B',
      status: 'active',
    });

    // Pasang sesi aktif yang sedang dipakai pelanggan
    mockRouter.pppoeActives.push({ '.id': '*ACT_18A', name: 'sari18' });
    mockRouter.hotspotActives.push({ '.id': '*ACT_18B', user: 'tono18' });
    mockRouter.commandLog = [];

    // Retry saat status synced & active -> TIDAK boleh memutus sesi
    const retryPppoe = await api('POST', '/customers/c-18a/sync-router');
    assert.equal(retryPppoe.status, 200);
    assert.equal(retryPppoe.json.data.routerSyncStatus, 'synced');
    assert.equal(mockRouter.pppoeActives.length, 1, 'Sesi aktif PPPoE pelanggan active tidak boleh diputus!');
    assert.equal(
      mockRouter.commandLog.some((cmd) => cmd[0] === '/ppp/active/remove' || cmd[0] === '/ppp/active/print'),
      false,
      'Perintah pemutusan sesi PPPoE tidak boleh dipanggil saat tidak ada alasan operasional!'
    );

    const retryHs = await api('POST', '/customers/c-18b/sync-router');
    assert.equal(retryHs.status, 200);
    assert.equal(retryHs.json.data.routerSyncStatus, 'synced');
    assert.equal(mockRouter.hotspotActives.length, 1, 'Sesi aktif Hotspot pelanggan active tidak boleh diputus!');
    assert.equal(
      mockRouter.commandLog.some((cmd) => cmd[0] === '/ip/hotspot/active/remove' || cmd[0] === '/ip/hotspot/active/print'),
      false,
      'Perintah pemutusan sesi Hotspot tidak boleh dipanggil saat tidak ada alasan operasional!'
    );

    // Simulasikan edit billing (nama saja, router sempat offline -> failed tanpa needsSessionDisconnect) lalu retry saat router online -> tetap tidak memutus sesi!
    mockRouter.offline = true;
    const updOffline = await api('PUT', '/customers/c-18a', { name: 'Sari Renamed' });
    assert.equal(updOffline.json.data.routerSyncStatus, 'failed');
    mockRouter.offline = false;
    mockRouter.commandLog = [];

    const retryAfterOffline = await api('POST', '/customers/c-18a/sync-router');
    assert.equal(retryAfterOffline.status, 200);
    assert.equal(retryAfterOffline.json.data.routerSyncStatus, 'synced');
    assert.equal(mockRouter.pppoeActives.length, 1, 'Retry pasca offline edit non-profile tidak boleh memutus sesi aktif!');
    assert.equal(mockRouter.commandLog.some((cmd) => cmd[0] === '/ppp/active/remove'), false);
    assertNoPlaintextLeak(retryPppoe.rawText + retryAfterOffline.rawText, dbStore.customers.get('c-18a'), 'Password18A');
  });

  // Skenario 19: Pelanggan active DENGAN penanda pemutusan sesi tertunda -> retry MEMUTUS sesi
  await runScenario(19, 'Retry pelanggan active dengan needsSessionDisconnect tertunda WAJIB memutus sesi aktif', async () => {
    await api('POST', '/customers', {
      id: 'c-19',
      name: 'Umar Pending DC',
      phone: '0819',
      packageId: 'pkg-10m',
      packageName: 'Paket 10 Mbps',
      type: 'pppoe',
      username: 'umar19',
      password: 'Password19',
      status: 'active',
    });
    mockRouter.pppoeActives.push({ '.id': '*ACT_19', name: 'umar19' });

    const payload = Buffer.from(
      JSON.stringify({ v: 1, needsSessionDisconnect: true, oldAccounts: [] }),
      'utf8'
    ).toString('base64url');
    const row = dbStore.customers.get('c-19')!;
    row.router_sync_status = 'failed';
    row.router_last_sync_message = `Menunggu pemutusan sesi tertunda. [SYNC_META_V1:${payload}]`;

    const retry = await api('POST', '/customers/c-19/sync-router');
    assert.equal(retry.status, 200);
    assert.equal(retry.json.data.routerSyncStatus, 'synced');
    assert.equal(mockRouter.pppoeActives.length, 0, 'Sesi aktif wajib diputus karena ada needsSessionDisconnect tertunda!');
  });

  // Skenario 20: Pelanggan isolated dan inactive -> retry memastikan seluruh sesi aktif terputus
  await runScenario(20, 'Retry pelanggan isolated maupun inactive WAJIB memutus seluruh sesi aktifnya', async () => {
    await api('POST', '/customers', {
      id: 'c-20a',
      name: 'Vina Isolated',
      phone: '082001',
      packageId: 'pkg-10m',
      packageName: 'Paket 10 Mbps',
      type: 'pppoe',
      username: 'vina20',
      password: 'Password20A',
      status: 'isolated',
    });
    await api('POST', '/customers', {
      id: 'c-20b',
      name: 'Wawan Inactive',
      phone: '082002',
      packageId: 'pkg-10m',
      packageName: 'Paket 10 Mbps',
      type: 'hotspot',
      username: 'wawan20',
      password: 'Password20B',
      status: 'inactive',
    });

    // Anggap masih ada sesi aktif nyangkut di router
    mockRouter.pppoeActives.push({ '.id': '*ISO1', name: 'vina20' }, { '.id': '*ISO2', name: 'vina20' });
    mockRouter.hotspotActives.push({ '.id': '*INACT1', user: 'wawan20' });

    const retryIso = await api('POST', '/customers/c-20a/sync-router');
    assert.equal(retryIso.status, 200);
    assert.equal(retryIso.json.data.routerSyncStatus, 'synced');
    assert.equal(mockRouter.pppoeActives.length, 0);
    assert.equal(mockRouter.pppoeSecrets[0].disabled, 'true');

    const retryInact = await api('POST', '/customers/c-20b/sync-router');
    assert.equal(retryInact.status, 200);
    assert.equal(retryInact.json.data.routerSyncStatus, 'synced');
    assert.equal(mockRouter.hotspotActives.length, 0);
    assert.equal(mockRouter.hotspotUsers[0].disabled, 'true');
  });

  // Skenario 21: Pemutusan sesi saat retry gagal -> status tetap failed & penanda tersimpan -> retry berikutnya tuntas tanpa akun duplikat
  await runScenario(21, 'Retry gagal putus sesi -> failed + penanda tersimpan -> retry berikutnya tuntas tanpa akun duplikat', async () => {
    await api('POST', '/customers', {
      id: 'c-21',
      name: 'Xena Retry Loop',
      phone: '0821',
      packageId: 'pkg-10m',
      packageName: 'Paket 10 Mbps',
      type: 'pppoe',
      username: 'xena21',
      password: 'Password21',
      status: 'active',
    });
    mockRouter.pppoeActives.push({ '.id': '*X1', name: 'xena21' });
    mockRouter.failRemoveIds.add('*X1');

    // Simulasikan package update gagal putus sesi
    const upd = await api('PUT', '/customers/c-21', { packageId: 'pkg-20m', packageName: 'Paket 20 Mbps' });
    assert.equal(upd.json.data.routerSyncStatus, 'failed');

    // Retry ke-1 masih gagal putus sesi -> status tetap failed, penanda needsSessionDisconnect tetap ada
    const retry1 = await api('POST', '/customers/c-21/sync-router');
    assert.equal(retry1.status, 502);
    assert.equal(retry1.json.data.routerSyncStatus, 'failed');
    const meta1 = decodeV1Meta(retry1.json.data.routerLastSyncMessage);
    assert.equal(meta1.needsSessionDisconnect, true);
    assert.equal(mockRouter.pppoeSecrets.length, 1);

    // Retry ke-2 setelah fault hilang -> tuntas synced & tetap hanya 1 akun (tidak duplikat)
    mockRouter.failRemoveIds.delete('*X1');
    const retry2 = await api('POST', '/customers/c-21/sync-router');
    assert.equal(retry2.status, 200);
    assert.equal(retry2.json.data.routerSyncStatus, 'synced');
    assert.equal(mockRouter.pppoeActives.length, 0);
    assert.equal(mockRouter.pppoeSecrets.length, 1, 'Retry tidak boleh membuat akun duplikat!');
    assert.equal(mockRouter.pppoeSecrets[0].profile, 'prof-pppoe-20m');
  });

  // Skenario 22: Pelanggan active dengan perubahan profile paket di router -> retry memutus sesi untuk terapkan profile baru
  await runScenario(22, 'Retry pelanggan active saat profile di router berbeda dengan paket -> putus sesi agar profile baru aktif', async () => {
    await api('POST', '/customers', {
      id: 'c-22',
      name: 'Yudi Profile Drift',
      phone: '0822',
      packageId: 'pkg-10m',
      packageName: 'Paket 10 Mbps',
      type: 'pppoe',
      username: 'yudi22',
      password: 'Password22',
      status: 'active',
    });
    // Anggap admin mengubah nama pppoe_profile pada paket dari prof-pppoe-10m menjadi prof-pppoe-20m
    dbStore.packages.get('pkg-10m')!.pppoe_profile = 'prof-pppoe-20m';
    mockRouter.pppoeActives.push({ '.id': '*Y22', name: 'yudi22' });

    const retry = await api('POST', '/customers/c-22/sync-router');
    assert.equal(retry.status, 200);
    assert.equal(retry.json.data.routerSyncStatus, 'synced');
    assert.equal(mockRouter.pppoeSecrets[0].profile, 'prof-pppoe-20m');
    assert.equal(mockRouter.pppoeActives.length, 0, 'Sesi harus diputus ketika profile router berubah!');
  });

  // Skenario 23: Kegagalan DI ANTARA penghapusan akun lama (sukses) dan pemutusan sesi lama (gagal) -> retry selesaikan pemutusan sesi tanpa sentuh tetangga mirip
  await runScenario(23, 'Akun lama sudah terhapus namun sesi lamanya gagal diputus -> retry tuntas tanpa sentuh username mirip', async () => {
    // Buat akun pelanggan lain dengan nama mirip untuk uji anti-false-match cleanup
    mockRouter.pppoeSecrets.push({
      '.id': '*NEIGHBOR',
      name: 'zaki_lama_2',
      password: 'NeighborPass',
      profile: 'prof-pppoe-10m',
      disabled: 'false',
    });
    mockRouter.pppoeActives.push({ '.id': '*ACT_NEIGHBOR', name: 'zaki_lama_2' });

    await api('POST', '/customers', {
      id: 'c-23',
      name: 'Zaki Mid-Fail',
      phone: '0823',
      packageId: 'pkg-10m',
      packageName: 'Paket 10 Mbps',
      type: 'pppoe',
      username: 'zaki_lama',
      password: 'Password23',
      status: 'active',
    });
    // Sesi aktif milik zaki_lama gagal diputus, sementara akun secret zaki_lama berhasil terhapus
    mockRouter.pppoeActives.push({ '.id': '*ACT_ZAKI_OLD', name: 'zaki_lama' });
    mockRouter.failRemoveIds.add('*ACT_ZAKI_OLD');

    const upd = await api('PUT', '/customers/c-23', { username: 'zaki_baru' });
    assert.equal(upd.json.data.routerSyncStatus, 'failed');
    assert.equal(mockRouter.pppoeSecrets.some((s) => s.name === 'zaki_baru'), true);
    assert.equal(mockRouter.pppoeSecrets.some((s) => s.name === 'zaki_lama'), false, 'Secret zaki_lama sudah terhapus pada tahap 1 cleanup');
    assert.equal(mockRouter.pppoeActives.some((a) => a['.id'] === '*ACT_ZAKI_OLD'), true, 'Sesi lama belum terputus');
    const meta = decodeV1Meta(upd.json.data.routerLastSyncMessage);
    assert.deepEqual(meta.oldAccounts, [{ type: 'pppoe', username: 'zaki_lama' }]);

    // Pasang sesi aktif baru di akun target zaki_baru untuk memastikan retry cleanup lama TIDAK memutus akun baru zaki_baru
    mockRouter.pppoeActives.push({ '.id': '*ACT_ZAKI_NEW', name: 'zaki_baru' });
    mockRouter.failRemoveIds.delete('*ACT_ZAKI_OLD');

    const retry = await api('POST', '/customers/c-23/sync-router');
    assert.equal(retry.status, 200);
    assert.equal(retry.json.data.routerSyncStatus, 'synced');
    assert.equal(mockRouter.pppoeActives.some((a) => a['.id'] === '*ACT_ZAKI_OLD'), false, 'Sesi akun lama wajib terputus saat retry');
    assert.equal(mockRouter.pppoeActives.some((a) => a['.id'] === '*ACT_ZAKI_NEW'), true, 'Sesi akun baru active tidak boleh ikut terputus');
    assert.equal(mockRouter.pppoeSecrets.some((s) => s.name === 'zaki_lama_2'), true, 'Akun mirip milik pelanggan lain tidak boleh disentuh!');
    assert.equal(mockRouter.pppoeActives.some((a) => a['.id'] === '*ACT_NEIGHBOR'), true, 'Sesi milik pelanggan lain tidak boleh diputus!');
  });

  // Skenario 24: Re-aktivasi pelanggan isolated -> active melalui PATCH status tanpa memutus sesi tanpa alasan
  await runScenario(24, 'Re-aktivasi pelanggan isolated -> active via PATCH status tidak memanggil pemutusan sesi tanpa alasan', async () => {
    await api('POST', '/customers', {
      id: 'c-24',
      name: 'Bima Reactivate',
      phone: '0824',
      packageId: 'pkg-10m',
      packageName: 'Paket 10 Mbps',
      type: 'pppoe',
      username: 'bima24',
      password: 'Password24',
      status: 'isolated',
    });
    assert.equal(mockRouter.pppoeSecrets[0].disabled, 'true');

    // Simulasikan terdapat sesi aktif saat pengaktifan kembali tanpa penanda pending disconnect
    mockRouter.pppoeActives.push({ '.id': '*ACT_BIMA', name: 'bima24' });
    mockRouter.commandLog = [];

    const reactivate = await api('PATCH', '/customers/c-24/status', { status: 'active' });
    assert.equal(reactivate.status, 200);
    assert.equal(reactivate.json.data.status, 'active');
    assert.equal(reactivate.json.data.routerSyncStatus, 'synced');
    assert.equal(mockRouter.pppoeSecrets[0].disabled, 'false');
    assert.equal(mockRouter.pppoeActives.length, 1);
    assert.equal(mockRouter.commandLog.some((cmd) => cmd[0] === '/ppp/active/remove'), false);
    assertNoPlaintextLeak(reactivate.rawText, dbStore.customers.get('c-24'), 'Password24');
  });

  // Skenario 25: SYNC_META_V1 valid (needsSessionDisconnect=false) tidak ditimpa penanda legacy [Perlu ulang pemutusan sesi]
  await runScenario(25, 'Metadata SYNC_META_V1 valid (needsSessionDisconnect=false) tidak ditimpa [Perlu ulang pemutusan sesi] maupun penanda legacy lain', async () => {
    const b64False = Buffer.from(
      JSON.stringify({ v: 1, needsSessionDisconnect: false, oldAccounts: [] }),
      'utf8'
    ).toString('base64url');
    const mixedMsg =
      `Catatan lama: [Perlu ulang pemutusan sesi] [Perlu pembersihan akun lama: pppoe:stale_legacy] [SYNC_META_V1:${b64False}]`;

    const parsed = parsePendingSyncActions('failed', mixedMsg);
    assert.equal(parsed.needsSessionDisconnect, false, 'needsSessionDisconnect dari V1 valid harus tetap false');
    assert.equal(parsed.oldAccounts.length, 0, 'oldAccounts dari V1 valid tidak boleh ditimpa legacy');
    assert.equal(parsed.corrupted, false, 'corrupted harus tetap false');

    // Verifikasi end-to-end sync-router tidak memutus sesi pelanggan active ketika metadata V1 menyatakan false
    await api('POST', '/customers', {
      id: 'c-25',
      name: 'Regresi V1 False',
      phone: '0825',
      packageId: 'pkg-10m',
      packageName: 'Paket 10 Mbps',
      type: 'pppoe',
      username: 'regresi25',
      password: 'Password25',
      status: 'active',
    });
    mockRouter.pppoeActives.push({ '.id': '*ACT_25', name: 'regresi25' });
    const row = dbStore.customers.get('c-25')!;
    row.router_sync_status = 'failed';
    row.router_last_sync_message = mixedMsg;
    mockRouter.commandLog = [];

    const retry = await api('POST', '/customers/c-25/sync-router');
    assert.equal(retry.status, 200);
    assert.equal(retry.json.data.routerSyncStatus, 'synced');
    assert.equal(mockRouter.pppoeActives.length, 1, 'Sesi aktif tidak boleh diputus saat V1 needsSessionDisconnect=false!');
    assert.equal(mockRouter.commandLog.some((cmd) => cmd[0] === '/ppp/active/remove'), false);
  });

  // Skenario 26: SYNC_META_V1 valid (needsSessionDisconnect=true) tetap true tanpa terpengaruh penanda/heuristik legacy
  await runScenario(26, 'Metadata SYNC_META_V1 valid (needsSessionDisconnect=true) tetap true dan menjaga oldAccounts V1 tanpa intervensi legacy', async () => {
    const b64True = Buffer.from(
      JSON.stringify({
        v: 1,
        needsSessionDisconnect: true,
        oldAccounts: [{ type: 'hotspot', username: 'akun_v1' }],
      }),
      'utf8'
    ).toString('base64url');
    const mixedMsg =
      `Catatan legacy [Perlu ulang pemutusan sesi] [Perlu pembersihan akun lama: pppoe:akun_legacy_abaikan] [SYNC_META_V1:${b64True}]`;

    const parsed = parsePendingSyncActions('failed', mixedMsg);
    assert.equal(parsed.needsSessionDisconnect, true);
    assert.equal(parsed.corrupted, false);
    assert.deepEqual(parsed.oldAccounts, [{ type: 'hotspot', username: 'akun_v1' }]);
  });

  // Skenario 27: Pesan legacy tanpa SYNC_META_V1 mengandung [Perlu ulang pemutusan sesi] -> needsSessionDisconnect=true
  await runScenario(27, 'Pesan legacy tanpa SYNC_META_V1 dengan [Perlu ulang pemutusan sesi] menghasilkan needsSessionDisconnect=true', async () => {
    const legacyMsg = 'Profile berhasil diubah, namun sesi aktif gagal diputus [Perlu ulang pemutusan sesi]';
    const parsed = parsePendingSyncActions('failed', legacyMsg);
    assert.equal(parsed.needsSessionDisconnect, true);
    assert.equal(parsed.corrupted, false);
  });

  // Skenario 28: Pesan legacy tanpa SYNC_META_V1 dan tanpa indikasi pemutusan sesi -> needsSessionDisconnect=false
  await runScenario(28, 'Pesan legacy tanpa SYNC_META_V1 dan tanpa indikasi pemutusan sesi menghasilkan needsSessionDisconnect=false', async () => {
    const legacyCleanMsg = 'Gagal terhubung ke router 192.168.88.1:8728 (ETIMEDOUT).';
    const parsed = parsePendingSyncActions('failed', legacyCleanMsg);
    assert.equal(parsed.needsSessionDisconnect, false);
    assert.equal(parsed.corrupted, false);
    assert.equal(parsed.oldAccounts.length, 0);
  });

  // Skenario 29: Metadata SYNC_META_V1 rusak/tidak valid sementara pesan mengandung penanda legacy -> fallback aman & pending action tetap terjaga
  await runScenario(29, 'Metadata SYNC_META_V1 rusak dengan penanda legacy menggunakan fallback aman tanpa menghilangkan pending action', async () => {
    const badBase64Msg =
      'Gagal sinkronisasi [SYNC_META_V1:broken!@#invalid] [Perlu ulang pemutusan sesi] [Perlu pembersihan akun lama: pppoe:legacy_old1,hotspot:legacy_old2]';
    const parsedBadB64 = parsePendingSyncActions('failed', badBase64Msg);
    assert.equal(parsedBadB64.corrupted, true);
    assert.equal(parsedBadB64.needsSessionDisconnect, true);
    assert.deepEqual(parsedBadB64.oldAccounts, [
      { type: 'pppoe', username: 'legacy_old1' },
      { type: 'hotspot', username: 'legacy_old2' },
    ]);

    const truncatedV1Msg =
      'Gagal terpotong [SYNC_META_V1:eyJ2Ijox [Perlu pembersihan akun lama: pppoe:legacy_trunc]';
    const parsedTrunc = parsePendingSyncActions('failed', truncatedV1Msg);
    assert.equal(parsedTrunc.corrupted, true);
    assert.equal(parsedTrunc.needsSessionDisconnect, true);
    assert.deepEqual(parsedTrunc.oldAccounts, [{ type: 'pppoe', username: 'legacy_trunc' }]);
  });

  // Skenario 30: Ketahanan socket lifecycle (/quit bersih, offline, !fatal, mid-command ECONNRESET, dan timeout) tanpa unhandled error
  await runScenario(30, 'Ketahanan socket lifecycle: /quit, offline, !fatal, mid-command TCP reset (ECONNRESET), dan timeout tertangani bersih', async () => {
    const connOpts = {
      host: '127.0.0.1',
      port: routerPort,
      username: 'admin',
      password: 'router_secret_123',
      timeoutSeconds: 3,
    };

    // 30a: testMikrotikConnection sukses + kirim /quit
    const okConn = await testMikrotikConnection(connOpts);
    assert.equal(okConn.success, true);
    assert.equal(okConn.data?.identity, 'MockRB4011');
    await new Promise((r) => setTimeout(r, 25));
    assert.ok(mockRouter.commandLog.some((cmd) => cmd[0] === '/quit'));

    // 30b: testMikrotikConnection saat router offline (mock melakukan socket.destroy())
    mockRouter.offline = true;
    const offConn = await testMikrotikConnection(connOpts);
    assert.equal(offConn.success, false);
    mockRouter.offline = false;

    // 30c: Mid-command abrupt TCP RST (ECONNRESET) saat /ppp/secret/add -> gagal terkendali tanpa crash
    mockRouter.resetOnCommand.add('/ppp/secret/add');
    const rstRes = await api('POST', '/customers', {
      id: 'c-30',
      name: 'Socket Reset Test',
      phone: '0830',
      packageId: 'pkg-10m',
      packageName: 'Paket 10 Mbps',
      type: 'pppoe',
      username: 'reset30',
      password: 'Password30',
      status: 'active',
    });
    assert.equal(rstRes.status, 200);
    assert.equal(rstRes.json.data.routerSyncStatus, 'failed');
    assertNoPlaintextLeak(rstRes.rawText, dbStore.customers.get('c-30'), 'Password30');
    mockRouter.resetOnCommand.clear();

    // 30d: Timeout saat server tidak membalas /system/identity/print (socket.destroy() + timer cleanup)
    mockRouter.hangOnCommand.add('/system/identity/print');
    const timeoutConn = await testMikrotikConnection(connOpts);
    assert.equal(timeoutConn.success, false);
    assert.equal(timeoutConn.errorDetails, 'ETIMEDOUT');
    mockRouter.hangOnCommand.clear();
  });

  // ==========================================================================
  // PENGUJIAN REGRESI KEAMANAN & SANITASI ERROR (SKENARIO 31-36)
  // ==========================================================================

  // Skenario 31: !trap RouterOS yang mengandung kata "password" tidak pernah bocor ke API response atau router_last_sync_message
  await runScenario(31, 'Audit Keamanan: !trap RouterOS mengandung "password" tidak bocor ke response API maupun router_last_sync_message', async () => {
    const trapSecret = 'password=LEAKED_TRAP_PASSWORD_999';
    mockRouter.trapOnCommand.set('/login', `cannot log in: wrong ${trapSecret}`);
    const testRes = await api('POST', '/mikrotik/test-connection', {});
    assert.equal(testRes.status, 200);
    assert.equal(testRes.json.success, false);
    assert.ok(!testRes.rawText.includes('LEAKED_TRAP_PASSWORD_999'), 'Pesan !trap login bocor ke response!');
    assert.ok(!testRes.rawText.includes('password='), 'Pesan mentah !trap login bocor ke response!');
    assert.ok(ALLOWED_ERROR_CODES.includes(testRes.json.errorDetails), `errorDetails harus allowlist: ${testRes.json.errorDetails}`);

    // Uji juga !trap dengan "password" saat provisioning/update pelanggan
    mockRouter.trapOnCommand.clear();
    await api('POST', '/customers', {
      id: 'c-sec-31',
      name: 'Audit Trap',
      phone: '083100',
      packageId: 'pkg-10m',
      packageName: 'Paket 10 Mbps',
      type: 'pppoe',
      username: 'sec_trap31',
      password: 'CustomerSecret31',
      status: 'active',
    });
    mockRouter.trapOnCommand.set('/ppp/secret/set', `invalid parameter ${trapSecret} internal_debug`);
    const updRes = await api('PUT', '/customers/c-sec-31', { packageId: 'pkg-20m', packageName: 'Paket 20 Mbps' });
    assert.equal(updRes.status, 200);
    assert.equal(updRes.json.data.routerSyncStatus, 'failed');
    assert.ok(!updRes.rawText.includes('LEAKED_TRAP_PASSWORD_999'), '!trap /ppp/secret/set bocor ke API!');
    const dbMsg = dbStore.customers.get('c-sec-31')?.router_last_sync_message || '';
    assert.ok(!dbMsg.includes('LEAKED_TRAP_PASSWORD_999'), '!trap /ppp/secret/set bocor ke router_last_sync_message!');
    assert.ok(!dbMsg.includes('internal_debug'), 'Pesan internal RouterOS tidak boleh disimpan di router_last_sync_message!');
    assertNoPlaintextLeak(updRes.rawText, dbStore.customers.get('c-sec-31'), 'CustomerSecret31');
  });

  // Skenario 32: !fatal RouterOS yang mengandung kata "token" tidak pernah bocor ke API response, error, atau router_last_sync_message
  await runScenario(32, 'Audit Keamanan: !fatal RouterOS mengandung "token" tidak bocor ke response, error, maupun router_last_sync_message', async () => {
    const fatalSecret = 'session invalidated token=SECRET_ADMIN_TOKEN_777';
    mockRouter.fatalOnCommand.set('/login', fatalSecret);
    const testRes = await api('POST', '/mikrotik/test-connection', {});
    assert.equal(testRes.status, 200);
    assert.equal(testRes.json.success, false);
    assert.equal(testRes.json.errorDetails, 'ROUTEROS_FATAL');
    assert.ok(!testRes.rawText.includes('SECRET_ADMIN_TOKEN_777'), 'Pesan !fatal login bocor!');
    assert.ok(!testRes.rawText.includes('token='), 'Pesan mentah token !fatal login bocor!');

    mockRouter.fatalOnCommand.clear();
    await api('POST', '/customers', {
      id: 'c-sec-32',
      name: 'Audit Fatal',
      phone: '083200',
      packageId: 'pkg-10m',
      packageName: 'Paket 10 Mbps',
      type: 'pppoe',
      username: 'sec_fatal32',
      password: 'CustomerSecret32',
      status: 'active',
    });

    mockRouter.fatalOnCommand.set('/ppp/secret/set', fatalSecret);
    const syncRes = await api('POST', '/customers/c-sec-32/sync-router');
    assert.equal(syncRes.status, 500);
    assert.equal(syncRes.json.success, false);
    assert.equal(syncRes.json.data.routerSyncStatus, 'failed');
    assert.ok(!syncRes.rawText.includes('SECRET_ADMIN_TOKEN_777'), '!fatal command bocor ke response!');
    const dbMsg = dbStore.customers.get('c-sec-32')?.router_last_sync_message || '';
    assert.ok(!dbMsg.includes('SECRET_ADMIN_TOKEN_777'), '!fatal command bocor ke router_last_sync_message!');
    assertNoPlaintextLeak(syncRes.rawText, dbStore.customers.get('c-sec-32'), 'CustomerSecret32');
  });

  // Skenario 33: Error soket mengandung pesan sensitif tidak bocor & hanya memakai kode error allowlist
  await runScenario(33, 'Audit Keamanan: Error soket sensitif disanitasi dan errorDetails selalu berasal dari allowlist', async () => {
    const sensitiveSocketErr = Object.assign(
      new Error('connect ECONNREFUSED 10.250.99.88:8728 secret_internal_tunnel_token=XYZ123'),
      { code: 'ECONNREFUSED' }
    );
    const mappedCode = sanitizeSocketErrorCode(sensitiveSocketErr);
    assert.equal(mappedCode, 'ECONNREFUSED');
    assert.ok(ALLOWED_ERROR_CODES.includes(mappedCode));

    const unknownSocketErr = Object.assign(
      new Error('Weird internal socket failure with password=RAW_SOCK_SECRET'),
      { code: 'WEIRD_NON_ALLOWLIST_CODE' }
    );
    assert.equal(sanitizeSocketErrorCode(unknownSocketErr), 'NETWORK_ERROR');

    // Simulasi soket offline pada testMikrotikConnection via endpoint API
    mockRouter.offline = true;
    const offRes = await api('POST', '/mikrotik/test-connection', {});
    assert.equal(offRes.status, 200);
    assert.equal(offRes.json.success, false);
    assert.ok(ALLOWED_ERROR_CODES.includes(offRes.json.errorDetails), 'errorDetails wajib masuk allowlist');
    assert.ok(!offRes.rawText.includes('router_secret_123'), 'Password router bocor saat error soket!');
  });

  // Skenario 34: Error PostgreSQL (SQL, nama tabel internal, SQLSTATE, stack trace) tidak bocor, namun error validasi aman tetap jelas
  await runScenario(34, 'Audit Keamanan: Error PostgreSQL tidak bocor ke response API & validasi aman tetap informatif', async () => {
    // 34a: Injeksi error PG mentah pada GET /customers
    const pgErr: any = new Error(
      'relation "internal_billing_secrets_v2" does not exist in query SELECT password_encrypted FROM mikrotik_settings WHERE host=\'10.8.0.1\'\n    at Parser.parseErrorMessage (/app/node_modules/pg-protocol/dist/parser.js:287:98)'
    );
    pgErr.code = '42P01';
    pgErr.severity = 'ERROR';
    dbStore.injectErrorOnPattern = { pattern: /FROM customers c/i, error: pgErr };

    const custErrRes = await api('GET', '/customers');
    assert.equal(custErrRes.status, 500);
    assert.equal(custErrRes.json.success, false);
    assert.equal(custErrRes.json.errorCode, 'DB_QUERY_ERROR');
    assert.ok(!custErrRes.rawText.includes('internal_billing_secrets_v2'), 'Nama tabel/pesan PG mentah bocor!');
    assert.ok(!custErrRes.rawText.includes('SELECT password_encrypted'), 'Query SQL mentah bocor!');
    assert.ok(!custErrRes.rawText.includes('pg-protocol'), 'Stack trace bocor!');

    // 34b: Injeksi error PG mentah pada POST /customers/:id/sync-router -> tidak bocor ke response & tidak bocor ke router_last_sync_message
    dbStore.injectErrorOnPattern = null;
    await api('POST', '/customers', {
      id: 'c-sec-34',
      name: 'Audit DB Fail',
      phone: '083400',
      packageId: 'pkg-10m',
      packageName: 'Paket 10 Mbps',
      type: 'pppoe',
      username: 'sec_db34',
      password: 'CustomerSecret34',
      status: 'active',
    });
    const pgSyncErr: any = new Error(
      'connection to server at "db-internal.prod.local" (10.10.10.50), port 5432 failed: password authentication failed for user "pgadmin"\n    at TCPConnectWrap.afterConnect'
    );
    pgSyncErr.code = '08006';
    pgSyncErr.severity = 'FATAL';
    dbStore.injectErrorOnPattern = { pattern: /SELECT pppoe_profile, hotspot_profile FROM packages/i, error: pgSyncErr };

    const syncDbFail = await api('POST', '/customers/c-sec-34/sync-router');
    assert.equal(syncDbFail.status, 500);
    assert.equal(syncDbFail.json.errorCode, 'DB_CONNECTION_ERROR');
    assert.equal(syncDbFail.json.data.routerSyncStatus, 'failed');
    assert.ok(!syncDbFail.rawText.includes('db-internal.prod.local'), 'Host DB internal bocor!');
    assert.ok(!syncDbFail.rawText.includes('pgadmin'), 'User DB internal bocor!');
    assert.ok(!syncDbFail.rawText.includes('TCPConnectWrap'), 'Stack trace DB bocor!');
    dbStore.injectErrorOnPattern = null;

    // 34c: Error validasi bisnis aman pada POST /payments tetap jelas untuk admin, sedangkan error PG di /payments disanitasi
    const safePayValidation = await api('POST', '/payments', {
      invoiceId: 'inv-tidak-ada',
      amount: 100000,
    });
    assert.equal(safePayValidation.status, 400);
    assert.equal(safePayValidation.json.message, 'Tagihan tidak ditemukan dalam sistem.');

    dbStore.injectErrorOnPattern = { pattern: /FROM invoices WHERE id = \$1 FOR UPDATE/i, error: pgErr };
    const pgPayFail = await api('POST', '/payments', {
      invoiceId: 'inv-001',
      amount: 100000,
    });
    assert.equal(pgPayFail.status, 500);
    assert.equal(pgPayFail.json.errorCode, 'DB_QUERY_ERROR');
    assert.ok(!pgPayFail.rawText.includes('internal_billing_secrets_v2'), 'Pesan PG pada POST /payments bocor!');
  });

  // Skenario 35: Respons API tidak pernah mengandung password pelanggan, password router, ciphertext enc:v1, token, atau stack trace
  await runScenario(35, 'Audit Keamanan: Respons API & DB sync message bebas dari password, ciphertext enc:v1, token, & stack trace, serta enkripsi AES-256-GCM utuh', async () => {
    const custPwd = 'UltraSecretCustPass#2026!';
    const routerPwd = 'router_secret_123';

    // Verifikasi kompatibilitas AES-256-GCM enc:v1 & backward compatibility legacy decryptMikrotikPassword
    const enc = encryptMikrotikPassword(custPwd);
    assert.ok(enc.startsWith('enc:v1:'), 'Format enkripsi harus tetap enc:v1');
    assert.equal(decryptMikrotikPassword(enc), custPwd);
    assert.equal(decryptMikrotikPassword('legacy_plain_or_old_format'), 'legacy_plain_or_old_format');

    const createRes = await api('POST', '/customers', {
      id: 'c-sec-35',
      name: 'Audit Zero Leak',
      phone: '083500',
      packageId: 'pkg-10m',
      packageName: 'Paket 10 Mbps',
      type: 'pppoe',
      username: 'sec_clean35',
      password: custPwd,
      status: 'active',
    });
    const listRes = await api('GET', '/customers');
    const cfgRes = await api('GET', '/mikrotik/config');
    const testRes = await api('POST', '/mikrotik/test-connection', {});
    const syncRes = await api('POST', '/customers/c-sec-35/sync-router');

    const payloads = [createRes.rawText, listRes.rawText, cfgRes.rawText, testRes.rawText, syncRes.rawText];
    for (const raw of payloads) {
      assert.ok(!raw.includes(custPwd), 'Password pelanggan bocor ke respons API!');
      assert.ok(!raw.includes(routerPwd), 'Password router bocor ke respons API!');
      assert.ok(!/enc:v1:[0-9a-fA-F:]+/.test(raw), 'Ciphertext enc:v1 bocor ke respons API!');
      assert.ok(!/\n\s*at\s+/.test(raw), 'Stack trace bocor ke respons API!');
    }
    assert.equal(cfgRes.json.data.maskedPassword, '••••••••');
    assert.equal(listRes.json.data[0].maskedPassword, '••••••••');

    // Verifikasi redactSensitiveText mempertahankan [SYNC_META_V1:...] sambil menyensor rahasia
    const metaTag = '[SYNC_META_V1:eyJ2IjoxLCJuZWVkc1Nlc3Npb25EaXNjb25uZWN0Ijp0cnVlLCJvbGRBY2NvdW50cyI6W119]';
    const redacted = redactSensitiveText(`Gagal token=ABC_LEAK enc:v1:aa:bb:cc ${metaTag}`);
    assert.ok(!redacted.includes('ABC_LEAK'));
    assert.ok(!redacted.includes('enc:v1:aa:bb:cc'));
    assert.ok(redacted.includes(metaTag), 'Penanda SYNC_META_V1 harus tetap utuh setelah sanitasi');
  });

  // Skenario 36: Provisioning gagal tidak pernah berstatus synced + pemutusan penuh multi-sesi tetap berjalan aman setelah sanitasi
  await runScenario(36, 'Audit Keamanan & Regresi: Provisioning gagal tidak menjadi synced, retry + SYNC_META_V1 + multi-sesi disconnect tetap konsisten', async () => {
    await api('POST', '/customers', {
      id: 'c-sec-36',
      name: 'Audit Multi Session',
      phone: '083600',
      packageId: 'pkg-10m',
      packageName: 'Paket 10 Mbps',
      type: 'pppoe',
      username: 'sec_multi36',
      password: 'CustomerSecret36',
      status: 'active',
    });
    mockRouter.pppoeActives.push(
      { '.id': '*M1', name: 'sec_multi36' },
      { '.id': '*M2', name: 'sec_multi36' }
    );
    mockRouter.failRemoveIds.add('*M2');

    const upd = await api('PUT', '/customers/c-sec-36', { packageId: 'pkg-20m', packageName: 'Paket 20 Mbps' });
    assert.equal(upd.json.data.routerSyncStatus, 'failed', 'Jika sebagian sesi gagal diputus, status dilarang menjadi synced');
    assert.equal(mockRouter.pppoeActives.length, 1);

    // Pastikan SYNC_META_V1 tetap utuh & terbaca oleh parsePendingSyncActions walaupun terjadi error sebelumnya
    const parsed = parsePendingSyncActions(upd.json.data.routerSyncStatus, upd.json.data.routerLastSyncMessage);
    assert.equal(parsed.needsSessionDisconnect, true);
    assert.equal(parsed.corrupted, false);

    mockRouter.failRemoveIds.delete('*M2');
    const retry = await api('POST', '/customers/c-sec-36/sync-router');
    assert.equal(retry.status, 200);
    assert.equal(retry.json.data.routerSyncStatus, 'synced');
    assert.equal(mockRouter.pppoeActives.length, 0);
  });

  // Skenario 37: Helper sanitizeMikrotikOperationMessage memelihara pesan bisnis aman, memblokir kebocoran operasional/rahasia, & membatasi panjang pesan
  await runScenario(37, 'Audit Sanitasi Pesan Operasi: sanitizeMikrotikOperationMessage pertahankan pesan bisnis aman, blokir !trap/!fatal/socket/SQL/stack/secret, & batasi panjang', async () => {
    const safeProfileMissing =
      "Profile MikroTik 'paket-10mbps' tidak ditemukan pada router di menu PPP > Profiles. Harap buat profile tersebut terlebih dahulu di WinBox.";
    const safeCreated = "Secret PPPoE 'pelanggan01' berhasil dibuat di router MikroTik.";
    const safeNoSession = "Tidak ada sesi aktif PPPoE yang sedang berjalan untuk 'pelanggan01'.";

    assert.equal(
      sanitizeMikrotikOperationMessage(safeProfileMissing, 'Fallback aman'),
      safeProfileMissing,
      'Pesan bisnis aman profile tidak ditemukan harus dipertahankan'
    );
    assert.equal(
      sanitizeMikrotikOperationMessage(safeCreated, 'Fallback aman'),
      safeCreated,
      'Pesan bisnis aman akun dibuat harus dipertahankan'
    );
    assert.equal(
      sanitizeMikrotikOperationMessage(safeNoSession, 'Fallback aman'),
      safeNoSession,
      'Pesan bisnis aman tidak ada sesi aktif harus dipertahankan'
    );

    const leakVectors = [
      '!trap =message=secret profile invalid password=LEAK_TRAP_PWD_111',
      '!fatal =ret=0 token=LEAK_FATAL_TOKEN_222',
      'connect ECONNREFUSED 10.99.88.77:8728 socket hang up',
      'SELECT password_encrypted FROM mikrotik_settings WHERE id = 1',
      'Gagal internal enc:v1:0123456789abcdef:fedcba9876543210:001122',
      'TypeError: cannot read properties\n    at provisionUser (/app/src/server/mikrotikService.ts:123:45)',
      `Kebocoran env secret ${process.env.MIKROTIK_ENCRYPTION_KEY} saat operasi`,
    ];

    for (const vec of leakVectors) {
      const sanitized = sanitizeMikrotikOperationMessage(vec, 'Operasi router gagal diproses dengan aman.');
      assert.equal(
        sanitized,
        'Operasi router gagal diproses dengan aman.',
        `Pesan tidak aman seharusnya diganti fallback: ${vec}`
      );
    }

    const hugeLog = `Profil berhasil terverifikasi ${'A'.repeat(1500)}`;
    const capped = sanitizeMikrotikOperationMessage(hugeLog, 'Fallback aman');
    assert.ok(capped.length <= 260, `Pesan operasi harus dibatasi panjangnya (aktual: ${capped.length})`);
    assert.ok(capped.endsWith('...'), 'Pesan operasi panjang harus dipotong rapi dengan elipsis');
  });

  // Skenario 38: Pengujian end-to-end sanitasi pesan operasi MikroTik di POST /customers, PUT /customers/:id, PATCH /customers/:id/status, & POST /customers/:id/sync-router + keutuhan SYNC_META_V1
  await runScenario(38, 'Audit Sanitasi Pesan Operasi End-to-End: POST/PUT/PATCH/sync-router tidak pernah membocorkan !trap/!fatal/socket/SQL/stack/secret & pertahankan SYNC_META_V1', async () => {
    const LEAK_PAYLOAD =
      "!trap !fatal =message=fail connect ECONNREFUSED 10.10.9.9:8728 password=RAW_OP_PASS token=RAW_OP_TOKEN enc:v1:aa11bb:cc22dd:ee33ff SELECT * FROM mikrotik_settings WHERE host='10.1.1.1'\n    at runSocket (/app/src/server/mikrotikService.ts:44:12) " +
      'LOG_PADDING_'.repeat(120);
    const FORBIDDEN_MARKERS = [
      '!trap',
      '!fatal',
      '=message=',
      'ECONNREFUSED',
      'RAW_OP_PASS',
      'RAW_OP_TOKEN',
      'enc:v1:aa11bb',
      'SELECT * FROM',
      'mikrotikService.ts',
      'LOG_PADDING_',
    ];

    const assertNoLeakAndCapped = (text: string | null | undefined, context: string) => {
      const val = text || '';
      for (const marker of FORBIDDEN_MARKERS) {
        assert.ok(!val.includes(marker), `${context} membocorkan "${marker}"`);
      }
      const withoutMeta = val.replace(/\s*\[SYNC_META_V1:[A-Za-z0-9_-]+\]/g, '').trim();
      assert.ok(
        withoutMeta.length <= 420,
        `${context} melebihi batas panjang pesan aman (${withoutMeta.length} > 420): ${withoutMeta}`
      );
    };

    type OpMode = 'profile_fail' | 'verify_fail' | 'cleanup_dc_fail' | 'oversized_ok';
    let currentMode: OpMode = 'profile_fail';
    const fakeProfileRes = async () =>
      currentMode === 'profile_fail'
        ? { exists: false, message: LEAK_PAYLOAD }
        : { exists: true, message: `Profile valid ${'X'.repeat(1200)}` };
    const fakeProvisionRes = async (_opts: any, _params: any) => ({
      success: true,
      action: 'set' as const,
      profileChanged: true,
      message: currentMode === 'oversized_ok' ? `Sinkronisasi akun berhasil dengan catatan panjang ${'Z'.repeat(1200)}` : LEAK_PAYLOAD,
    });
    const fakeVerifyRes = async () =>
      currentMode === 'verify_fail'
        ? { verified: false, count: 0, message: LEAK_PAYLOAD }
        : { verified: true, count: 1, message: 'Terverifikasi tunggal' };
    const fakeCleanupRes = async () =>
      currentMode === 'cleanup_dc_fail'
        ? { success: false, message: LEAK_PAYLOAD }
        : { success: true, message: 'Akun lama bersih' };
    const fakeDisconnectRes = async () =>
      currentMode === 'cleanup_dc_fail'
        ? { success: false, message: LEAK_PAYLOAD, disconnected: false, disconnectedCount: 0, failedCount: 1 }
        : { success: true, message: '1 sesi diputus', disconnected: true, disconnectedCount: 1, failedCount: 0 };

    const injectedRouter = createDbRouter({
      checkProfileExists: fakeProfileRes as any,
      createOrUpdatePppoeSecret: fakeProvisionRes as any,
      createOrUpdateHotspotUser: fakeProvisionRes as any,
      verifyPppoeSecretExists: fakeVerifyRes as any,
      verifyHotspotUserExists: fakeVerifyRes as any,
      cleanupOldRouterAccount: fakeCleanupRes as any,
      disconnectPppoeSession: fakeDisconnectRes as any,
      disconnectHotspotSession: fakeDisconnectRes as any,
      togglePppoeSecret: async () => ({ success: true, message: LEAK_PAYLOAD }),
      toggleHotspotUser: async () => ({ success: true, message: LEAK_PAYLOAD }),
    });

    const injectedApp = express();
    injectedApp.use(express.json());
    injectedApp.use('/api', injectedRouter);
    const injectedServer = http.createServer(injectedApp);
    await new Promise<void>((resolve) => injectedServer.listen(0, '127.0.0.1', () => resolve()));
    const injectedBase = `http://127.0.0.1:${(injectedServer.address() as net.AddressInfo).port}/api`;

    const apiInjected = async (method: string, path: string, body?: any) => {
      const res = await fetch(`${injectedBase}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      const rawText = await res.text();
      return { status: res.status, json: rawText ? JSON.parse(rawText) : null, rawText };
    };

    try {
      // 38a: POST /customers dengan profileCheck gagal berisi payload berbahaya
      currentMode = 'profile_fail';
      const postProfFail = await apiInjected('POST', '/customers', {
        id: 'c-sec-38-post-prof',
        name: 'Audit Post Profile Fail',
        phone: '083801',
        packageId: 'pkg-10m',
        packageName: 'Paket 10 Mbps',
        type: 'pppoe',
        username: 'sec38_post_prof',
        password: 'CustomerSecret38A',
        status: 'active',
      });
      assert.equal(postProfFail.status, 200);
      assert.equal(postProfFail.json.data.routerSyncStatus, 'failed');
      assertNoLeakAndCapped(postProfFail.json.message, 'POST /customers profile_fail api.message');
      assertNoLeakAndCapped(postProfFail.json.data.routerLastSyncMessage, 'POST /customers profile_fail data.routerLastSyncMessage');
      assertNoLeakAndCapped(dbStore.customers.get('c-sec-38-post-prof')?.router_last_sync_message, 'POST /customers profile_fail DB');

      // 38b: POST /customers dengan verify gagal berisi payload berbahaya
      currentMode = 'verify_fail';
      const postVerFail = await apiInjected('POST', '/customers', {
        id: 'c-sec-38-post-ver',
        name: 'Audit Post Verify Fail',
        phone: '083802',
        packageId: 'pkg-10m',
        packageName: 'Paket 10 Mbps',
        type: 'pppoe',
        username: 'sec38_post_ver',
        password: 'CustomerSecret38B',
        status: 'active',
      });
      assert.equal(postVerFail.status, 200);
      assert.equal(postVerFail.json.data.routerSyncStatus, 'failed');
      assertNoLeakAndCapped(postVerFail.json.message, 'POST /customers verify_fail api.message');
      assertNoLeakAndCapped(postVerFail.json.data.routerLastSyncMessage, 'POST /customers verify_fail data.routerLastSyncMessage');
      assertNoLeakAndCapped(dbStore.customers.get('c-sec-38-post-ver')?.router_last_sync_message, 'POST /customers verify_fail DB');

      // 38c: POST /customers berhasil dengan provResult.message sangat panjang -> synced & terpotong rapi
      currentMode = 'oversized_ok';
      const postOk = await apiInjected('POST', '/customers', {
        id: 'c-sec-38-main',
        name: 'Audit Main 38',
        phone: '083803',
        packageId: 'pkg-10m',
        packageName: 'Paket 10 Mbps',
        type: 'pppoe',
        username: 'sec38_old_user',
        password: 'CustomerSecret38C',
        status: 'active',
      });
      assert.equal(postOk.status, 200);
      assert.equal(postOk.json.data.routerSyncStatus, 'synced');
      assertNoLeakAndCapped(postOk.json.data.routerLastSyncMessage, 'POST /customers oversized_ok');
      assertNoLeakAndCapped(dbStore.customers.get('c-sec-38-main')?.router_last_sync_message, 'POST /customers oversized_ok DB');

      // 38d-1: PUT /customers/:id saat profileCheck gagal berisi payload berbahaya (pending marker tetap aman & utuh)
      currentMode = 'profile_fail';
      const putProfFail = await apiInjected('PUT', '/customers/c-sec-38-main', {
        username: 'sec38_new_user',
        packageId: 'pkg-20m',
        packageName: 'Paket 20 Mbps',
      });
      assert.equal(putProfFail.status, 200);
      assert.equal(putProfFail.json.data.routerSyncStatus, 'failed');
      assertNoLeakAndCapped(putProfFail.json.message, 'PUT /customers profile_fail api.message');
      assertNoLeakAndCapped(putProfFail.json.data.routerLastSyncMessage, 'PUT /customers profile_fail data.routerLastSyncMessage');
      assertNoLeakAndCapped(dbStore.customers.get('c-sec-38-main')?.router_last_sync_message, 'PUT /customers profile_fail DB');
      const parsedPutProf = parsePendingSyncActions('failed', putProfFail.json.data.routerLastSyncMessage);
      assert.equal(parsedPutProf.corrupted, false);
      assert.deepEqual(parsedPutProf.oldAccounts, [{ type: 'pppoe', username: 'sec38_old_user' }]);

      // 38d-2: PUT /customers/:id saat verify gagal berisi payload berbahaya
      currentMode = 'verify_fail';
      const putVerFail = await apiInjected('PUT', '/customers/c-sec-38-main', {
        packageId: 'pkg-20m',
        packageName: 'Paket 20 Mbps',
      });
      assert.equal(putVerFail.status, 200);
      assert.equal(putVerFail.json.data.routerSyncStatus, 'failed');
      assertNoLeakAndCapped(putVerFail.json.message, 'PUT /customers verify_fail api.message');
      assertNoLeakAndCapped(putVerFail.json.data.routerLastSyncMessage, 'PUT /customers verify_fail data.routerLastSyncMessage');
      assertNoLeakAndCapped(dbStore.customers.get('c-sec-38-main')?.router_last_sync_message, 'PUT /customers verify_fail DB');
      const parsedPutVer = parsePendingSyncActions('failed', putVerFail.json.data.routerLastSyncMessage);
      assert.equal(parsedPutVer.corrupted, false);
      assert.deepEqual(parsedPutVer.oldAccounts, [{ type: 'pppoe', username: 'sec38_old_user' }]);

      // 38d-3: PUT /customers/:id saat cleanupOldRouterAccount & disconnectPppoeSession gagal dengan payload berbahaya
      currentMode = 'cleanup_dc_fail';
      const putFail = await apiInjected('PUT', '/customers/c-sec-38-main', {
        packageId: 'pkg-20m',
        packageName: 'Paket 20 Mbps',
      });
      assert.equal(putFail.status, 200);
      assert.equal(putFail.json.data.routerSyncStatus, 'failed');
      assertNoLeakAndCapped(putFail.json.message, 'PUT /customers cleanup_dc_fail api.message');
      assertNoLeakAndCapped(putFail.json.data.routerLastSyncMessage, 'PUT /customers cleanup_dc_fail data.routerLastSyncMessage');
      assertNoLeakAndCapped(dbStore.customers.get('c-sec-38-main')?.router_last_sync_message, 'PUT /customers cleanup_dc_fail DB');
      const parsedAfterPut = parsePendingSyncActions('failed', putFail.json.data.routerLastSyncMessage);
      assert.equal(parsedAfterPut.corrupted, false, 'SYNC_META_V1 setelah PUT sanitasi harus utuh & valid');
      assert.equal(parsedAfterPut.needsSessionDisconnect, true);
      assert.deepEqual(parsedAfterPut.oldAccounts, [{ type: 'pppoe', username: 'sec38_old_user' }]);

      // 38e: PATCH /customers/:id/status saat cleanupOldRouterAccount & disconnectPppoeSession gagal dengan payload berbahaya
      const patchFail = await apiInjected('PATCH', '/customers/c-sec-38-main/status', { status: 'isolated' });
      assert.equal(patchFail.status, 200);
      assert.equal(patchFail.json.data.routerSyncStatus, 'failed');
      assertNoLeakAndCapped(patchFail.json.message, 'PATCH /status cleanup_dc_fail api.message');
      assertNoLeakAndCapped(patchFail.json.data.routerLastSyncMessage, 'PATCH /status cleanup_dc_fail data.routerLastSyncMessage');
      assertNoLeakAndCapped(dbStore.customers.get('c-sec-38-main')?.router_last_sync_message, 'PATCH /status cleanup_dc_fail DB');
      const parsedAfterPatch = parsePendingSyncActions('failed', patchFail.json.data.routerLastSyncMessage);
      assert.equal(parsedAfterPatch.corrupted, false, 'SYNC_META_V1 setelah PATCH status sanitasi harus utuh & valid');
      assert.equal(parsedAfterPatch.needsSessionDisconnect, true);
      assert.deepEqual(parsedAfterPatch.oldAccounts, [{ type: 'pppoe', username: 'sec38_old_user' }]);

      // 38f: POST /customers/:id/sync-router pada profile_fail, verify_fail, cleanup_dc_fail, dan oversized_ok
      currentMode = 'profile_fail';
      const syncProfFail = await apiInjected('POST', '/customers/c-sec-38-main/sync-router');
      assert.equal(syncProfFail.status, 400);
      assert.equal(syncProfFail.json.data.routerSyncStatus, 'failed');
      assertNoLeakAndCapped(syncProfFail.json.message, 'sync-router profile_fail api.message');
      assertNoLeakAndCapped(syncProfFail.json.data.routerLastSyncMessage, 'sync-router profile_fail data');
      assert.equal(parsePendingSyncActions('failed', syncProfFail.json.data.routerLastSyncMessage).corrupted, false);

      currentMode = 'verify_fail';
      const syncVerFail = await apiInjected('POST', '/customers/c-sec-38-main/sync-router');
      assert.equal(syncVerFail.status, 500);
      assert.equal(syncVerFail.json.data.routerSyncStatus, 'failed');
      assertNoLeakAndCapped(syncVerFail.json.message, 'sync-router verify_fail api.message');
      assertNoLeakAndCapped(syncVerFail.json.data.routerLastSyncMessage, 'sync-router verify_fail data');
      assert.equal(parsePendingSyncActions('failed', syncVerFail.json.data.routerLastSyncMessage).corrupted, false);

      currentMode = 'cleanup_dc_fail';
      const syncCleanDcFail = await apiInjected('POST', '/customers/c-sec-38-main/sync-router');
      assert.equal(syncCleanDcFail.status, 502);
      assert.equal(syncCleanDcFail.json.data.routerSyncStatus, 'failed');
      assertNoLeakAndCapped(syncCleanDcFail.json.message, 'sync-router cleanup_dc_fail api.message');
      assertNoLeakAndCapped(syncCleanDcFail.json.data.routerLastSyncMessage, 'sync-router cleanup_dc_fail data');
      assertNoLeakAndCapped(dbStore.customers.get('c-sec-38-main')?.router_last_sync_message, 'sync-router cleanup_dc_fail DB');
      const parsedAfterSyncFail = parsePendingSyncActions('failed', syncCleanDcFail.json.data.routerLastSyncMessage);
      assert.equal(parsedAfterSyncFail.corrupted, false);
      assert.equal(parsedAfterSyncFail.needsSessionDisconnect, true);
      assert.deepEqual(parsedAfterSyncFail.oldAccounts, [{ type: 'pppoe', username: 'sec38_old_user' }]);

      currentMode = 'oversized_ok';
      const syncOk = await apiInjected('POST', '/customers/c-sec-38-main/sync-router');
      assert.equal(syncOk.status, 200);
      assert.equal(syncOk.json.data.routerSyncStatus, 'synced');
      assertNoLeakAndCapped(syncOk.json.data.routerLastSyncMessage, 'sync-router oversized_ok data');
      assertNoLeakAndCapped(dbStore.customers.get('c-sec-38-main')?.router_last_sync_message, 'sync-router oversized_ok DB');
    } finally {
      await new Promise<void>((resolve) => injectedServer.close(() => resolve()));
    }
  });

  // Skenario 39: SafeOperationalError mensanitasi pesan sebelum super(), memvalidasi allowlist kode & isFatal secara ketat
  await runScenario(39, 'Audit errorSanitizer: SafeOperationalError menyamakan .message/.safeMessage/.stack terbersihkan & validasi allowlist + isFatal', async () => {
    const rawDanger =
      'Gagal proses password=TOP_SECRET_39 token=TOK_39 enc:v1:aa:bb:cc SELECT * FROM users\n    at secretFn (/app/src/server/dbRoutes.ts:10:2)';
    const err = new SafeOperationalError('UNKNOWN_RAW_CODE' as any, rawDanger, { isFatal: 'yes' as any });

    assert.equal(err.code, 'INTERNAL_ERROR', 'Kode error tidak dikenal harus diganti kode allowlist');
    assert.ok(ALLOWED_ERROR_CODES.includes(err.code));
    assert.equal(err.message, err.safeMessage, 'error.message harus persis sama dengan error.safeMessage');
    assert.equal(err.isFatal, false, 'Kode tidak dikenal & opsi non-boolean tidak boleh membuat isFatal=true');

    const serialized = `${err.message} | ${err.safeMessage} | ${err.toString()} | ${err.stack || ''}`;
    for (const forbidden of ['TOP_SECRET_39', 'TOK_39', 'enc:v1:aa:bb:cc', 'SELECT * FROM', 'secretFn']) {
      assert.ok(!serialized.includes(forbidden), `SafeOperationalError membocorkan "${forbidden}" pada properti Error!`);
    }

    // Validasi aturan isFatal
    const fatalInvalidCode = new SafeOperationalError('BAD_CODE' as any, 'Pesan aman', { isFatal: true });
    assert.equal(fatalInvalidCode.code, 'INTERNAL_ERROR');
    assert.equal(fatalInvalidCode.isFatal, false, 'Kode tidak valid tidak boleh menjadi fatal meskipun isFatal=true');

    const fatalValid = new SafeOperationalError('ROUTEROS_FATAL', 'Koneksi dihentikan router.');
    assert.equal(fatalValid.code, 'ROUTEROS_FATAL');
    assert.equal(fatalValid.isFatal, true);
    assert.equal(fatalValid.message, fatalValid.safeMessage);
  });

  // Skenario 40: Sanitasi fallbackMessage pada sanitizeDatabaseError, sanitizeMikrotikError, dan sanitizeGenericServerError
  await runScenario(40, 'Audit errorSanitizer: Fallback berisi password/token/ciphertext/SQL/stack trace tidak bocor di ketiga sanitizer', async () => {
    const dirtyFallback =
      'Fallback bocor password=FALLBACK_PASS token=FALLBACK_TOK enc:v1:11:22:33 SELECT password_encrypted FROM mikrotik_settings\n    at badCaller (/app/src/server/db.ts:99:1) ' +
      'P'.repeat(400);

    const dbBranches: any[] = [
      Object.assign(new Error('dup'), { code: '23505' }),
      Object.assign(new Error('fk'), { code: '23503' }),
      Object.assign(new Error('chk'), { code: '23514' }),
      Object.assign(new Error('conn'), { code: '08006' }),
      Object.assign(new Error('qry'), { code: '42P01' }),
      new SafeOperationalError('DB_QUERY_ERROR', dirtyFallback, { statusCode: 500 }),
    ];
    for (const sample of dbBranches) {
      const res = sanitizeDatabaseError(sample, dirtyFallback);
      for (const forbidden of ['FALLBACK_PASS', 'FALLBACK_TOK', 'enc:v1:11:22:33', 'SELECT password_encrypted', 'badCaller']) {
        assert.ok(!res.message.includes(forbidden), `sanitizeDatabaseError membocorkan "${forbidden}"`);
      }
      assert.ok(res.message.length <= 320);
    }

    const mtBranches: any[] = [
      Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }),
      Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }),
      Object.assign(new Error('tls'), { code: 'ERR_TLS_CERT_ALTNAME_INVALID' }),
      new Error('unknown internal raw error'),
      new SafeOperationalError('ROUTEROS_TRAP', dirtyFallback),
    ];
    for (const sample of mtBranches) {
      const res = sanitizeMikrotikError(sample, dirtyFallback);
      for (const forbidden of ['FALLBACK_PASS', 'FALLBACK_TOK', 'enc:v1:11:22:33', 'SELECT password_encrypted', 'badCaller']) {
        assert.ok(!res.message.includes(forbidden), `sanitizeMikrotikError membocorkan "${forbidden}"`);
      }
      assert.ok(res.message.length <= 320);
    }

    const genBranches: any[] = [
      new Error('raw server failure'),
      Object.assign(new Error('pg err'), { code: '23505' }),
      new SafeOperationalError('INTERNAL_ERROR', dirtyFallback, { statusCode: 500 }),
    ];
    for (const sample of genBranches) {
      const res = sanitizeGenericServerError(sample, dirtyFallback);
      for (const forbidden of ['FALLBACK_PASS', 'FALLBACK_TOK', 'enc:v1:11:22:33', 'SELECT password_encrypted', 'badCaller']) {
        assert.ok(!res.message.includes(forbidden), `sanitizeGenericServerError membocorkan "${forbidden}"`);
      }
      assert.ok(res.message.length <= 320);
    }

    // Fallback bisnis aman tetap dipertahankan
    const safeDb = sanitizeDatabaseError(Object.assign(new Error('raw'), { code: '23505' }), 'Gagal menyimpan data pelanggan.');
    assert.ok(safeDb.message.startsWith('Gagal menyimpan data pelanggan.'));
  });

  // Skenario 41: Redaksi kredensial diperluas tanpa merusak pesan operasional aman maupun penanda SYNC_META_V1
  await runScenario(41, 'Audit errorSanitizer: redactSensitiveText menangani JSON, quoted key-value, Bearer, PostgreSQL URI, enc:v1, stack, & pertahankan SYNC_META_V1', async () => {
    const prevWablasToken = process.env.WABLAS_API_TOKEN;
    process.env.WABLAS_API_TOKEN = 'WABLAS_LIVE_TOKEN_XYZ_987';
    try {
      const payload = Buffer.from(
        JSON.stringify({ v: 1, needsSessionDisconnect: true, oldAccounts: [{ type: 'pppoe', username: 'user,khusus#1' }] }),
        'utf8'
      ).toString('base64url');
      const metaTag = `[SYNC_META_V1:${payload}]`;

      const complexInput = [
        '{"password":"JsonPass!@#1","passwd":"Passwd!2","pwd":"PwdValue_3"}',
        "{'client_secret':'ClientSec!@#','api-key':'ApiKey-777','access_token':'AccTok_888','refresh_token':'RefTok_999'}",
        "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig",
        "secret='Quoted Secret $#!' apikey=RawApiKey#42 api_key=SnakeKey$9 token=PlainTok!1",
        'postgresql://dbuser:SuperPgP@ss!2026@internal-db.local:5432/adi_hotspot?sslmode=require',
        'enc:v1:aabbccddeeff001122334455:6677889900aabbccddeeff11:1234567890abcdef',
        `env=${process.env.WABLAS_API_TOKEN} db=${process.env.DB_PASSWORD} key=${process.env.MIKROTIK_ENCRYPTION_KEY}`,
        'Error internal\n    at queryHandler (/app/src/server/dbRoutes.ts:512:14)',
        metaTag,
      ].join(' ');

      const redacted = redactSensitiveText(complexInput);
      const mustNotContain = [
        'JsonPass!@#1',
        'Passwd!2',
        'PwdValue_3',
        'ClientSec!@#',
        'ApiKey-777',
        'AccTok_888',
        'RefTok_999',
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
        'Quoted Secret $#!',
        'RawApiKey#42',
        'SnakeKey$9',
        'PlainTok!1',
        'dbuser:SuperPgP@ss!2026',
        'internal-db.local',
        'aabbccddeeff001122334455',
        'WABLAS_LIVE_TOKEN_XYZ_987',
        String(process.env.DB_PASSWORD),
        String(process.env.MIKROTIK_ENCRYPTION_KEY),
        'queryHandler',
        '/app/src/server/dbRoutes.ts',
      ];
      for (const secret of mustNotContain) {
        assert.ok(!redacted.includes(secret), `redactSensitiveText gagal menyensor "${secret}" -> hasil: ${redacted}`);
      }
      assert.ok(redacted.includes(metaTag), 'SYNC_META_V1 tidak boleh rusak oleh redaksi');

      const parsedMeta = parsePendingSyncActions('failed', redacted);
      assert.equal(parsedMeta.corrupted, false);
      assert.equal(parsedMeta.needsSessionDisconnect, true);
      assert.deepEqual(parsedMeta.oldAccounts, [{ type: 'pppoe', username: 'user,khusus#1' }]);

      // Pesan operasional aman tidak boleh rusak atau hilang
      const safeOps = [
        "Profile MikroTik 'paket-10mbps' tidak ditemukan pada router.",
        'Koneksi timeout ke router 10.10.1.1:8728.',
        'Autentikasi MikroTik gagal (username atau password salah).',
      ];
      for (const msg of safeOps) {
        assert.equal(redactSensitiveText(msg), msg, `Pesan operasional aman tidak boleh hilang/berubah: ${msg}`);
      }
    } finally {
      if (prevWablasToken === undefined) {
        delete process.env.WABLAS_API_TOKEN;
      } else {
        process.env.WABLAS_API_TOKEN = prevWablasToken;
      }
    }
  });

  // Skenario 42: Allowlist kode socket terpisah tidak salah mengklasifikasikan kode DB atau RouterOS
  await runScenario(42, 'Audit errorSanitizer: sanitizeSocketErrorCode pakai allowlist socket terpisah & tidak salah klasifikasi kode DB/RouterOS', async () => {
    const validSockets = [
      'ECONNREFUSED',
      'ETIMEDOUT',
      'EHOSTUNREACH',
      'ENETUNREACH',
      'ENOTFOUND',
      'ECONNRESET',
      'EPIPE',
      'TLS_ERROR',
    ];
    for (const code of validSockets) {
      const mapped = sanitizeSocketErrorCode({ code });
      assert.equal(mapped, code);
      assert.ok((ALLOWED_SOCKET_ERROR_CODES as readonly string[]).includes(mapped));
    }

    const nonSocketCodes = ['DB_QUERY_ERROR', 'DB_CONSTRAINT_ERROR', 'ROUTEROS_TRAP', 'INTERNAL_ERROR', 'VALIDATION_ERROR', '42P01'];
    for (const nonSocket of nonSocketCodes) {
      const mapped = sanitizeSocketErrorCode({ code: nonSocket, message: 'tls certificate mention inside db message' });
      assert.equal(mapped, 'NETWORK_ERROR', `Kode non-socket "${nonSocket}" tidak boleh diklasifikasikan sebagai kode socket (${mapped})`);
    }
    assert.equal(sanitizeSocketErrorCode({ code: 'UNKNOWN_99', message: 'unexpected io failure' }), 'NETWORK_ERROR');
    assert.equal(sanitizeSocketErrorCode({ code: 'UNKNOWN_SSL', message: 'SSL handshake certificate error' }), 'TLS_ERROR');
  });

  // Skenario 43: logSafeServerError memblokir log injection, newline, SQL, kredensial, username/body, & membatasi panjang
  await runScenario(43, 'Audit errorSanitizer: logSafeServerError mencegah newline injection, rahasia, SQL, stack, & memvalidasi allowlist kode', async () => {
    const capturedLogs: string[] = [];
    const origConsoleError = console.error;
    console.error = (...args: any[]) => {
      capturedLogs.push(args.map((a) => String(a)).join(' '));
    };

    try {
      logSafeServerError(
        'POST /api/customers\r\nFAKE_INJECTED_LOG {"password":"SecretCtx"}\n    at fn (/app/src/server/x.ts:1:1)',
        'UNSAFE_CUSTOM_CODE',
        {
          operation: 'SELECT password_encrypted FROM customers\nWHERE id=1',
          resourceId: 'cust01\r\ntoken=LEAK_ID {"username":"budi_pelanggan"} ' + 'X'.repeat(200),
        }
      );

      logSafeServerError('POST /api/customers/sync', 'ROUTEROS_TRAP', {
        operation: 'UPDATE',
        resourceId: 'c-safe-43',
      });
    } finally {
      console.error = origConsoleError;
    }

    assert.equal(capturedLogs.length, 2);
    const maliciousLog = capturedLogs[0];
    assert.ok(!/[\r\n]/.test(maliciousLog), 'Log tidak boleh mengandung newline / CRLF injection');
    for (const forbidden of ['FAKE_INJECTED_LOG', 'SecretCtx', 'SELECT password_encrypted', 'LEAK_ID', 'budi_pelanggan', 'UNSAFE_CUSTOM_CODE', 'x.ts']) {
      assert.ok(!maliciousLog.includes(forbidden), `AuditLog membocorkan "${forbidden}": ${maliciousLog}`);
    }
    const parsedBad = JSON.parse(maliciousLog.replace(/^\[Adi_Hotspot AuditLog\]\s*/, ''));
    assert.equal(parsedBad.code, 'INTERNAL_ERROR');
    assert.ok(parsedBad.context.length <= 80);
    assert.ok((parsedBad.operation || '').length <= 24);
    assert.ok((parsedBad.resourceId || '').length <= 64);

    const safeLog = JSON.parse(capturedLogs[1].replace(/^\[Adi_Hotspot AuditLog\]\s*/, ''));
    assert.equal(safeLog.code, 'ROUTEROS_TRAP');
    assert.equal(safeLog.context, 'POST /api/customers/sync');
    assert.equal(safeLog.operation, 'UPDATE');
    assert.equal(safeLog.resourceId, 'c-safe-43');
  });

  // Restore prototypes & stop servers cleanly
  pg.Pool.prototype.query = origQuery;
  pg.Pool.prototype.connect = origConnect;
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  await mockRouter.stop();

  console.log(`\nRINGKASAN PENGUJIAN MIKROTIK TAHAP 1: TOTAL=${passed + failed}, PASS=${passed}, FAIL=${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal error in mikrotikIntegration.test.ts:', err);
  process.exit(1);
});
