import net from 'net';
import tls from 'tls';
import dns from 'dns';
import crypto from 'crypto';
import {
  SafeOperationalError,
  isFatalMikrotikError,
  sanitizeMikrotikError,
  sanitizeSocketErrorCode,
} from './errorSanitizer.js';

export interface MikrotikConnectionOptions {
  host: string;
  port: number;
  username: string;
  password?: string;
  useSsl?: boolean;
  timeoutSeconds?: number;
}

export interface MikrotikSystemInfo {
  identity?: string;
  boardName?: string;
  version?: string;
  cpuLoad?: number;
  uptime?: string;
  platform?: string;
  testedAt: string;
}

export interface MikrotikConnectionResult {
  success: boolean;
  message: string;
  data?: MikrotikSystemInfo;
  errorDetails?: string;
}

export interface ValidatedRouterTarget {
  host: string;
  resolvedIp: string;
  allResolvedIps: string[];
  isIpLiteral: boolean;
}

const BLOCKED_EXACT_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'broadcasthost',
  'metadata.google.internal',
  'metadata.internal',
  'instance-data',
]);

function parseCanonicalIpv4Octets(ip: string): [number, number, number, number] | null {
  if (!net.isIPv4(ip)) return null;
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^(?:0|[1-9]\d{0,2})$/.test(part)) {
      return null;
    }
    const val = Number(part);
    if (!Number.isInteger(val) || val < 0 || val > 255) {
      return null;
    }
    octets.push(val);
  }
  return [octets[0], octets[1], octets[2], octets[3]];
}

function ipv4OctetsToUint32(octets: [number, number, number, number]): number {
  return ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0;
}

function isIpv4InCidr(ipUint32: number, networkUint32: number, prefixLen: number): boolean {
  const mask = prefixLen === 0 ? 0 : (~0 << (32 - prefixLen)) >>> 0;
  return ((ipUint32 & mask) >>> 0) === ((networkUint32 & mask) >>> 0);
}

/**
 * Klasifikasi biner alamat IPv4 berdasarkan rentang CIDR (tanpa mengandalkan pencocokan string).
 * Allowlist: HANYA RFC1918 (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16).
 */
function classifyIpv4Address(ip: string): { allowed: boolean; reason: string } {
  const octets = parseCanonicalIpv4Octets(ip);
  if (!octets) {
    return { allowed: false, reason: 'format IPv4 tidak valid atau tidak kanonis' };
  }
  const u32 = ipv4OctetsToUint32(octets);

  // Alamat khusus/berisiko yang wajib ditolak secara eksplisit
  if (isIpv4InCidr(u32, 0x00000000, 8)) {
    return { allowed: false, reason: 'alamat unspecified (0.0.0.0/8) tidak diizinkan' };
  }
  if (isIpv4InCidr(u32, 0x7f000000, 8)) {
    return { allowed: false, reason: 'alamat loopback (127.0.0.0/8) tidak diizinkan' };
  }
  if (isIpv4InCidr(u32, 0xa9fe0000, 16)) {
    return { allowed: false, reason: 'alamat link-local / cloud metadata (169.254.0.0/16) tidak diizinkan' };
  }
  if (isIpv4InCidr(u32, 0x64400000, 10)) {
    return { allowed: false, reason: 'alamat CGNAT/shared (100.64.0.0/10) tidak diizinkan' };
  }
  if (isIpv4InCidr(u32, 0xe0000000, 4)) {
    return { allowed: false, reason: 'alamat multicast (224.0.0.0/4) tidak diizinkan' };
  }
  if (isIpv4InCidr(u32, 0xf0000000, 4)) {
    return { allowed: false, reason: 'alamat reserved / broadcast (240.0.0.0/4) tidak diizinkan' };
  }
  if (
    isIpv4InCidr(u32, 0xc0000000, 24) || // 192.0.0.0/24 IETF protocol
    isIpv4InCidr(u32, 0xc0000200, 24) || // 192.0.2.0/24 TEST-NET-1
    isIpv4InCidr(u32, 0xc6120000, 15) || // 198.18.0.0/15 Benchmarking
    isIpv4InCidr(u32, 0xc6336400, 24) || // 198.51.100.0/24 TEST-NET-2
    isIpv4InCidr(u32, 0xcb007100, 24)    // 203.0.113.0/24 TEST-NET-3
  ) {
    return { allowed: false, reason: 'alamat IP khusus (reserved/benchmark/test-net) tidak diizinkan' };
  }

  // Allowlist ketat RFC1918
  const isRfc1918 =
    isIpv4InCidr(u32, 0x0a000000, 8) ||  // 10.0.0.0/8
    isIpv4InCidr(u32, 0xac100000, 12) || // 172.16.0.0/12
    isIpv4InCidr(u32, 0xc0a80000, 16);   // 192.168.0.0/16

  if (!isRfc1918) {
    return { allowed: false, reason: 'alamat IP publik tidak diizinkan (hanya IP privat LAN RFC1918)' };
  }

  return { allowed: true, reason: 'RFC1918' };
}

/**
 * Mengurai alamat IPv6 ke representasi 8 grup 16-bit (128-bit) secara biner
 * sehingga bentuk terkompresi, huruf besar, maupun embedded IPv4 tidak dapat lolos.
 */
function parseIpv6ToGroups(rawIp: string): number[] | null {
  const clean = rawIp.trim().toLowerCase();
  if (!net.isIPv6(clean)) return null;

  let working = clean;
  // Jika bagian akhir berbentuk dotted-quad IPv4 (mis. ::ffff:192.168.1.1), konversi menjadi dua grup 16-bit
  const lastColon = working.lastIndexOf(':');
  if (lastColon !== -1 && working.slice(lastColon + 1).includes('.')) {
    const ipv4Part = working.slice(lastColon + 1);
    const octets = parseCanonicalIpv4Octets(ipv4Part);
    if (!octets) return null;
    const hi = ((octets[0] << 8) | octets[1]).toString(16);
    const lo = ((octets[2] << 8) | octets[3]).toString(16);
    working = `${working.slice(0, lastColon + 1)}${hi}:${lo}`;
  }

  const halves = working.split('::');
  if (halves.length > 2) return null;

  const parseSegmentList = (segStr: string): number[] | null => {
    if (!segStr) return [];
    const parts = segStr.split(':');
    const out: number[] = [];
    for (const p of parts) {
      if (!/^[0-9a-f]{1,4}$/.test(p)) return null;
      out.push(parseInt(p, 16));
    }
    return out;
  };

  if (halves.length === 1) {
    const groups = parseSegmentList(halves[0]);
    return groups && groups.length === 8 ? groups : null;
  }

  const left = parseSegmentList(halves[0]);
  const right = parseSegmentList(halves[1]);
  if (!left || !right) return null;
  const zeroFill = 8 - (left.length + right.length);
  if (zeroFill < 1) return null;
  return [...left, ...Array(zeroFill).fill(0), ...right];
}

/**
 * Kebijakan allowlist IPv6 yang aman (fail-closed):
 * Saat ini tidak ada rentang IPv6 yang diizinkan untuk koneksi RouterOS LAN;
 * seluruh IPv6 (termasuk IPv4-mapped ::ffff:0:0/96, loopback ::1, unspecified ::,
 * link-local fe80::/10, multicast ff00::/8, ULA fd00::/8 termasuk metadata IPv6, dan global 2000::/3) ditolak.
 */
function classifyIpv6Address(rawIp: string): { allowed: boolean; reason: string } {
  const g = parseIpv6ToGroups(rawIp);
  if (!g) {
    return { allowed: false, reason: 'format alamat IPv6 tidak valid' };
  }

  const isAllZeroPrefix = g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0;

  // Unspecified ::
  if (isAllZeroPrefix && g[5] === 0 && g[6] === 0 && g[7] === 0) {
    return { allowed: false, reason: 'alamat IPv6 unspecified (::) tidak diizinkan' };
  }
  // Loopback ::1
  if (isAllZeroPrefix && g[5] === 0 && g[6] === 0 && g[7] === 1) {
    return { allowed: false, reason: 'alamat IPv6 loopback (::1) tidak diizinkan' };
  }
  // IPv4-mapped IPv6 (::ffff:0:0/96) & IPv4-compatible (::/96) & IPv4-translated (::ffff:0:0:0/96)
  if (
    (isAllZeroPrefix && (g[5] === 0xffff || g[5] === 0)) ||
    (g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0xffff && g[5] === 0)
  ) {
    return { allowed: false, reason: 'alamat IPv4-mapped/compatible IPv6 tidak diizinkan demi mencegah bypass validasi' };
  }
  // Link-local fe80::/10
  if ((g[0] & 0xffc0) === 0xfe80) {
    return { allowed: false, reason: 'alamat IPv6 link-local (fe80::/10) tidak diizinkan' };
  }
  // Multicast ff00::/8
  if ((g[0] & 0xff00) === 0xff00) {
    return { allowed: false, reason: 'alamat IPv6 multicast (ff00::/8) tidak diizinkan' };
  }
  // Semua alamat IPv6 lainnya (termasuk ULA fc00::/7 dan global 2000::/3) tidak berada pada allowlist IPv6
  return { allowed: false, reason: 'alamat IPv6 tidak diizinkan oleh kebijakan allowlist host router' };
}

function isObfuscatedNumericHost(cleanHost: string): boolean {
  const labels = cleanHost.split('.');
  if (labels.length === 0) return true;
  // Tolak notasi integer desimal, heksadesimal (0x...), oktal (0177...), atau shorthand IPv4 (127.1)
  if (labels.every((lbl) => /^(?:0x[0-9a-f]+|[0-9]+)$/i.test(lbl))) {
    return true;
  }
  const lastLabel = labels[labels.length - 1];
  if (/^(?:0x[0-9a-f]+|[0-9]+)$/i.test(lastLabel)) {
    return true;
  }
  return false;
}

function isValidRfc1123Hostname(cleanHost: string): boolean {
  if (cleanHost.length < 1 || cleanHost.length > 253) return false;
  if (cleanHost.startsWith('.') || cleanHost.endsWith('.')) return false;
  const labels = cleanHost.split('.');
  for (const label of labels) {
    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) {
      return false;
    }
  }
  return true;
}

/**
 * Validasi alamat Host / IP RouterOS secara sinkron (tanpa resolusi DNS).
 * - Mengizinkan IPv4 privat RFC1918 (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16).
 * - Menolak IP publik, loopback, link-local, multicast, unspecified, broadcast, CGNAT, reserved,
 *   seluruh IPv6 termasuk IPv4-mapped IPv6, serta hostname terlarang (localhost, metadata.*).
 * - Untuk hostname yang lolos pemeriksaan sintaks awal, pemanggil koneksi wajib melanjutkan ke
 *   `resolveAndValidateRouterHost()` guna memvalidasi seluruh hasil resolusi DNS & mencegah DNS rebinding.
 */
export function validateRouterHost(host: string): string {
  if (!host || typeof host !== 'string') {
    throw new SafeOperationalError('VALIDATION_ERROR', 'Alamat IP atau Host router wajib diisi.', {
      statusCode: 400,
    });
  }

  const trimmed = host.trim();
  if (!trimmed || /[\x00-\x20\x7F/?#@%\\]/.test(trimmed)) {
    throw new SafeOperationalError(
      'VALIDATION_ERROR',
      'Format alamat Host / IP router mengandung karakter yang tidak valid.',
      { statusCode: 400 }
    );
  }

  // Larang skema protokol URL seperti http:// atau https://
  if (trimmed.includes('://')) {
    throw new SafeOperationalError(
      'VALIDATION_ERROR',
      'Masukkan alamat IP atau Hostname router saja, tanpa awalan protokol seperti http:// atau https://.',
      { statusCode: 400 }
    );
  }

  let cleanHost = trimmed.toLowerCase();

  // Tangani bentuk IPv6 berkurung siku seperti [::1] atau [::ffff:127.0.0.1]
  if (cleanHost.startsWith('[') || cleanHost.endsWith(']')) {
    if (!cleanHost.startsWith('[') || !cleanHost.endsWith(']')) {
      throw new SafeOperationalError(
        'VALIDATION_ERROR',
        'Format alamat Host / IP router tidak valid.',
        { statusCode: 400 }
      );
    }
    const unwrapped = cleanHost.slice(1, -1);
    const v6Check = classifyIpv6Address(unwrapped);
    throw new SafeOperationalError(
      'VALIDATION_ERROR',
      `Alamat host router ditolak: ${v6Check.reason}.`,
      { statusCode: 400 }
    );
  }

  // Jika input adalah literal IPv6 (tanpa kurung siku)
  if (net.isIPv6(cleanHost)) {
    const v6Check = classifyIpv6Address(cleanHost);
    if (!v6Check.allowed) {
      throw new SafeOperationalError(
        'VALIDATION_ERROR',
        `Alamat host router ditolak: ${v6Check.reason}.`,
        { statusCode: 400 }
      );
    }
    return cleanHost;
  }

  // Tolak penggunaan ':' selain IPv6 (mis. penyisipan port di dalam host)
  if (cleanHost.includes(':')) {
    throw new SafeOperationalError(
      'VALIDATION_ERROR',
      'Alamat host router tidak boleh menyertakan port secara langsung atau format IPv6 tidak valid.',
      { statusCode: 400 }
    );
  }

  // Jika input berbentuk IPv4 literal (termasuk deteksi oktal/non-kanonis via isIPv4 / dots)
  if (net.isIPv4(cleanHost)) {
    const v4Check = classifyIpv4Address(cleanHost);
    if (!v4Check.allowed) {
      throw new SafeOperationalError(
        'VALIDATION_ERROR',
        `Alamat IP router ditolak: ${v4Check.reason}.`,
        { statusCode: 400 }
      );
    }
    return cleanHost;
  }

  // Tolak notasi IPv4 tersamar (desimal tunggal, heksadesimal 0x..., oktal 0177.0.0.1, shorthand 127.1)
  if (isObfuscatedNumericHost(cleanHost)) {
    throw new SafeOperationalError(
      'VALIDATION_ERROR',
      'Format alamat IP router tidak kanonis atau tidak valid. Gunakan format IPv4 privat RFC1918 standar (mis. 192.168.88.1).',
      { statusCode: 400 }
    );
  }

  // Tolak hostname loopback dan cloud metadata yang diketahui berbahaya
  if (
    BLOCKED_EXACT_HOSTNAMES.has(cleanHost) ||
    cleanHost.endsWith('.localhost') ||
    cleanHost.endsWith('.metadata.internal')
  ) {
    throw new SafeOperationalError(
      'VALIDATION_ERROR',
      'Hostname loopback atau metadata cloud terlarang demi keamanan server.',
      { statusCode: 400 }
    );
  }

  if (!isValidRfc1123Hostname(cleanHost)) {
    throw new SafeOperationalError(
      'VALIDATION_ERROR',
      'Format Hostname / IP router tidak valid.',
      { statusCode: 400 }
    );
  }

  return cleanHost;
}

/**
 * Validasi host sekaligus resolusi DNS untuk memastikan seluruh alamat hasil resolusi
 * merupakan IPv4 privat RFC1918 yang diizinkan, serta mengunci IP tujuan guna mencegah DNS rebinding.
 */
export async function resolveAndValidateRouterHost(host: string): Promise<ValidatedRouterTarget> {
  const cleanHost = validateRouterHost(host);

  if (parseCanonicalIpv4Octets(cleanHost) !== null) {
    return {
      host: cleanHost,
      resolvedIp: cleanHost,
      allResolvedIps: [cleanHost],
      isIpLiteral: true,
    };
  }

  let records: Array<{ address: string; family: number }>;
  try {
    const lookupRes = await dns.promises.lookup(cleanHost, { all: true, verbatim: true });
    records = Array.isArray(lookupRes) ? lookupRes : [];
  } catch {
    throw new SafeOperationalError(
      'ENOTFOUND',
      'Hostname router tidak dapat ditemukan melalui resolusi DNS.',
      { statusCode: 400 }
    );
  }

  if (records.length === 0) {
    throw new SafeOperationalError(
      'ENOTFOUND',
      'Hostname router tidak menghasilkan alamat IP yang valid dari DNS.',
      { statusCode: 400 }
    );
  }

  const validatedIps: string[] = [];
  for (const record of records) {
    const candidateIp = typeof record?.address === 'string' ? record.address.trim() : '';
    if (!candidateIp) {
      throw new SafeOperationalError(
        'VALIDATION_ERROR',
        'Hasil resolusi DNS hostname router mengandung entri kosong yang tidak valid.',
        { statusCode: 400 }
      );
    }
    if (net.isIPv6(candidateIp)) {
      const v6Check = classifyIpv6Address(candidateIp);
      throw new SafeOperationalError(
        'VALIDATION_ERROR',
        `Hostname router ditolak karena resolusi DNS menghasilkan alamat yang tidak diizinkan (${v6Check.reason}).`,
        { statusCode: 400 }
      );
    }
    const v4Check = classifyIpv4Address(candidateIp);
    if (!v4Check.allowed) {
      throw new SafeOperationalError(
        'VALIDATION_ERROR',
        `Hostname router ditolak karena resolusi DNS menghasilkan alamat yang tidak diizinkan (${v4Check.reason}).`,
        { statusCode: 400 }
      );
    }
    if (!validatedIps.includes(candidateIp)) {
      validatedIps.push(candidateIp);
    }
  }

  return {
    host: cleanHost,
    resolvedIp: validatedIps[0],
    allResolvedIps: validatedIps,
    isIpLiteral: false,
  };
}

function createPinnedSocketLookup(pinnedIpv4: string): net.LookupFunction {
  return ((
    _hostname: string,
    opts: any,
    cb?: (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void
  ) => {
    const callback = typeof opts === 'function' ? opts : cb;
    if (!callback) return;
    if (typeof opts === 'object' && opts !== null && opts.all) {
      callback(null, [{ address: pinnedIpv4, family: 4 }]);
    } else {
      callback(null, pinnedIpv4, 4);
    }
  }) as net.LookupFunction;
}

/**
 * Validasi port API MikroTik.
 * Rentang valid: 1-65535 (standar MikroTik: 8728 untuk API biasa, 8729 untuk API-SSL).
 */
export function validateRouterPort(port: number | string): number {
  let num: number;
  if (typeof port === 'number') {
    num = port;
  } else if (typeof port === 'string') {
    const trimmed = port.trim();
    if (!/^\d{1,5}$/.test(trimmed)) {
      throw new SafeOperationalError(
        'VALIDATION_ERROR',
        'Port API router harus berupa angka bulat antara 1 dan 65535 (default 8728 atau 8729).',
        { statusCode: 400 }
      );
    }
    num = Number(trimmed);
  } else {
    num = NaN;
  }
  if (!Number.isInteger(num) || num < 1 || num > 65535) {
    throw new SafeOperationalError(
      'VALIDATION_ERROR',
      'Port API router harus berupa angka antara 1 dan 65535 (default 8728 atau 8729).',
      { statusCode: 400 }
    );
  }
  return num;
}

/**
 * Encode sebuah kata string ke dalam format panjang berjenjang RouterOS API.
 */
function encodeWord(word: string): Buffer {
  const wordBuf = Buffer.from(word, 'utf8');
  const len = wordBuf.length;
  let lenBuf: Buffer;

  if (len < 0x80) {
    lenBuf = Buffer.from([len]);
  } else if (len < 0x4000) {
    lenBuf = Buffer.from([(len >> 8) | 0x80, len & 0xff]);
  } else if (len < 0x200000) {
    lenBuf = Buffer.from([(len >> 16) | 0xc0, (len >> 8) & 0xff, len & 0xff]);
  } else if (len < 0x10000000) {
    lenBuf = Buffer.from([
      (len >> 24) | 0xe0,
      (len >> 16) & 0xff,
      (len >> 8) & 0xff,
      len & 0xff,
    ]);
  } else {
    lenBuf = Buffer.from([
      0xf0,
      (len >> 24) & 0xff,
      (len >> 16) & 0xff,
      (len >> 8) & 0xff,
      len & 0xff,
    ]);
  }

  return Buffer.concat([lenBuf, wordBuf]);
}

/**
 * Encode satu kalimat (sentence) RouterOS API yang diakhiri dengan byte 0x00.
 */
function encodeSentence(words: string[]): Buffer {
  const parts = words.map(encodeWord);
  parts.push(Buffer.from([0x00])); // Sentence terminator
  return Buffer.concat(parts);
}

/**
 * Decode panjang kata berikutnya dari buffer stream.
 */
function decodeLength(buf: Buffer, offset: number): { len: number; bytesRead: number } | null {
  if (offset >= buf.length) return null;
  const b0 = buf[offset];

  if ((b0 & 0x80) === 0) {
    return { len: b0, bytesRead: 1 };
  } else if ((b0 & 0xc0) === 0x80) {
    if (offset + 1 >= buf.length) return null;
    return { len: ((b0 & ~0x80) << 8) | buf[offset + 1], bytesRead: 2 };
  } else if ((b0 & 0xe0) === 0xc0) {
    if (offset + 2 >= buf.length) return null;
    return { len: ((b0 & ~0xe0) << 16) | (buf[offset + 1] << 8) | buf[offset + 2], bytesRead: 3 };
  } else if ((b0 & 0xf0) === 0xe0) {
    if (offset + 3 >= buf.length) return null;
    return {
      len:
        ((b0 & ~0xf0) << 24) |
        (buf[offset + 1] << 16) |
        (buf[offset + 2] << 8) |
        buf[offset + 3],
      bytesRead: 4,
    };
  } else if (b0 === 0xf0) {
    if (offset + 4 >= buf.length) return null;
    return {
      len:
        (buf[offset + 1] << 24) |
        (buf[offset + 2] << 16) |
        (buf[offset + 3] << 8) |
        buf[offset + 4],
      bytesRead: 5,
    };
  }
  return null;
}

/**
 * Mengekstrak seluruh kalimat lengkap dari buffer akumulasi.
 */
function extractSentences(buffer: Buffer): { sentences: string[][]; remaining: Buffer } {
  const sentences: string[][] = [];
  let currentWords: string[] = [];
  let offset = 0;

  while (offset < buffer.length) {
    const lenInfo = decodeLength(buffer, offset);
    if (!lenInfo) {
      break; // Belum cukup data panjang byte
    }

    offset += lenInfo.bytesRead;

    if (lenInfo.len === 0) {
      // Akhir dari sebuah kalimat
      sentences.push(currentWords);
      currentWords = [];
      buffer = buffer.subarray(offset);
      offset = 0;
      continue;
    }

    if (offset + lenInfo.len > buffer.length) {
      // Belum cukup data isi kata
      offset -= lenInfo.bytesRead;
      break;
    }

    const word = buffer.toString('utf8', offset, offset + lenInfo.len);
    currentWords.push(word);
    offset += lenInfo.len;
  }

  return { sentences, remaining: buffer.subarray(offset) };
}

/**
 * Menguji koneksi RouterOS API nyata ke router MikroTik fisik/virtual.
 * Menggunakan protokol RouterOS API native via TCP socket (port 8728) atau TLS socket (port 8729).
 * Tidak menggunakan child_process, aman dari SSRF, dan tidak membocorkan password ke log maupun frontend.
 */
export async function testMikrotikConnection(
  options: MikrotikConnectionOptions
): Promise<MikrotikConnectionResult> {
  const cleanPort = validateRouterPort(options.port);
  const resolvedTarget = await resolveAndValidateRouterHost(options.host);
  const cleanHost = resolvedTarget.host;
  const connectIp = resolvedTarget.resolvedIp;
  const pinnedLookup = createPinnedSocketLookup(connectIp);
  const username = options.username ? options.username.trim() : 'admin';
  const password = options.password ?? '';
  const useSsl = Boolean(options.useSsl);
  const timeoutMs = Math.max(3000, Math.min(30000, (options.timeoutSeconds || 10) * 1000));

  return new Promise((resolve) => {
    let socket: net.Socket | null = null;
    let isFinished = false;
    let accumulatedBuffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);

    const cleanupSocket = (graceful = false) => {
      clearTimeout(timer);
      if (socket) {
        const s = socket;
        socket = null;
        try {
          s.removeAllListeners('data');
          s.removeAllListeners('timeout');
          s.removeAllListeners('close');
          s.removeAllListeners('end');
          s.removeAllListeners('connect');
          s.removeAllListeners('secureConnect');
          s.removeAllListeners('error');
          // Pasang error sink sebelum teardown agar ECONNRESET/EPIPE asinkron saat teardown tidak unhandled
          s.on('error', () => {
            // ignore teardown error after settle
          });
          if (!s.destroyed) {
            if (graceful && s.writable) {
              const forceTimer = setTimeout(() => {
                if (!s.destroyed) {
                  try {
                    s.destroy();
                  } catch {
                    // ignore
                  }
                }
              }, 50);
              forceTimer.unref();
              s.once('close', () => clearTimeout(forceTimer));
              s.end();
            } else {
              s.destroy();
            }
          }
        } catch {
          // ignore
        }
      }
    };

    const finish = (result: MikrotikConnectionResult, graceful = false) => {
      if (isFinished) return;
      isFinished = true;
      cleanupSocket(graceful);
      resolve(result);
    };

    // Buat timer timeout independen
    const timer = setTimeout(() => {
      finish({
        success: false,
        message: `Koneksi timeout. Router di ${cleanHost}:${cleanPort} tidak merespons dalam ${timeoutMs / 1000} detik. Periksa apakah router aktif dan firewall mengizinkan akses dari server billing.`,
        errorDetails: 'ETIMEDOUT',
      });
    }, timeoutMs);

    try {
      if (useSsl) {
        socket = tls.connect(
          {
            host: connectIp,
            port: cleanPort,
            lookup: pinnedLookup,
            ...(resolvedTarget.isIpLiteral ? {} : { servername: cleanHost }),
            rejectUnauthorized: false, // Mengizinkan self-signed certificate umum pada router MikroTik lokal
            timeout: timeoutMs,
          },
          () => {
            onConnected();
          }
        );
      } else {
        socket = net.connect(
          {
            host: connectIp,
            port: cleanPort,
            family: 4,
            lookup: pinnedLookup,
            timeout: timeoutMs,
          },
          () => {
            onConnected();
          }
        );
      }
    } catch {
      clearTimeout(timer);
      return finish({
        success: false,
        message: 'Gagal menginisialisasi soket koneksi ke router. Periksa alamat host, port, dan jaringan.',
        errorDetails: 'SOCKET_INIT_FAILED',
      });
    }

    socket.setTimeout(timeoutMs);

    socket.on('timeout', () => {
      clearTimeout(timer);
      finish({
        success: false,
        message: `Koneksi timeout. Tidak ada respons dari ${cleanHost}:${cleanPort}. Pastikan service API MikroTik aktif.`,
        errorDetails: 'ETIMEDOUT',
      });
    });

    socket.on('error', (err: any) => {
      clearTimeout(timer);
      const code = sanitizeSocketErrorCode(err);
      let userFriendlyMsg = `Gagal terhubung ke router ${cleanHost}:${cleanPort} karena gangguan jaringan/soket.`;

      if (code === 'ECONNREFUSED') {
        userFriendlyMsg = `Koneksi ditolak oleh ${cleanHost}:${cleanPort} (Port tertutup). Pastikan service API MikroTik telah diaktifkan di menu IP > Services (Port 8728 untuk API biasa, Port 8729 untuk API-SSL).`;
      } else if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH') {
        userFriendlyMsg = `Alamat host/jaringan ${cleanHost} tidak dapat dijangkau. Periksa kabel LAN, routing jaringan, atau tunnel VPN.`;
      } else if (code === 'ETIMEDOUT') {
        userFriendlyMsg = `Koneksi ke ${cleanHost}:${cleanPort} timeout. Router tidak merespons.`;
      } else if (code === 'ENOTFOUND') {
        userFriendlyMsg = `Hostname router ${cleanHost} tidak dapat ditemukan (DNS error).`;
      } else if (code === 'ECONNRESET' || code === 'EPIPE') {
        userFriendlyMsg = `Koneksi ke router ${cleanHost}:${cleanPort} terputus secara mendadak oleh jaringan atau target.`;
      } else if (code === 'TLS_ERROR') {
        userFriendlyMsg = `Kesalahan negosiasi SSL/TLS pada port ${cleanPort}. Pastikan service api-ssl telah memiliki sertifikat aktif di MikroTik.`;
      }

      finish({
        success: false,
        message: userFriendlyMsg,
        errorDetails: code,
      });
    });

    socket.on('close', () => {
      clearTimeout(timer);
      if (!isFinished) {
        finish({
          success: false,
          message: 'Koneksi ke router ditutup oleh server target sebelum proses autentikasi selesai.',
          errorDetails: 'CONNECTION_CLOSED_PREMATURELY',
        });
      }
    });

    // Workflow komunikasi RouterOS API
    type Step = 'login_sent' | 'login_challenge_sent' | 'get_identity' | 'get_resource' | 'done';
    let currentStep: Step = 'login_sent';
    const gatheredInfo: Partial<MikrotikSystemInfo> = {
      testedAt: new Date().toISOString(),
    };

    function safeWrite(sentenceToSend: string[]) {
      if (!isFinished && socket && !socket.destroyed && socket.writable) {
        socket.write(encodeSentence(sentenceToSend));
      }
    }

    function onConnected() {
      // Langkah 1: Kirim /login dengan username dan password (standar RouterOS v6.43+ dan RouterOS v7)
      currentStep = 'login_sent';
      const loginSentence = ['/login', `=name=${username}`, `=password=${password}`];
      safeWrite(loginSentence);
    }

    socket.on('data', (chunk: Buffer) => {
      if (isFinished) return;
      accumulatedBuffer = Buffer.concat([accumulatedBuffer, chunk]);
      const { sentences, remaining } = extractSentences(accumulatedBuffer);
      accumulatedBuffer = remaining;

      for (const sentence of sentences) {
        if (isFinished) break;
        handleSentence(sentence);
      }
    });

    function handleSentence(sentence: string[]) {
      if (isFinished || sentence.length === 0) return;
      const replyType = sentence[0];

      if (replyType === '!fatal') {
        clearTimeout(timer);
        return finish({
          success: false,
          message: 'Koneksi dihentikan oleh router MikroTik sebelum proses selesai. Periksa izin API dan layanan RouterOS.',
          errorDetails: 'ROUTEROS_FATAL',
        });
      }

      if (currentStep === 'login_sent') {
        if (replyType === '!done') {
          const retWord = sentence.find((w) => w.startsWith('=ret='));
          if (retWord) {
            // Mode legacy RouterOS (< v6.43) challenge-response
            const challengeHex = retWord.replace('=ret=', '');
            currentStep = 'login_challenge_sent';
            const md5Hash = crypto
              .createHash('md5')
              .update(Buffer.concat([Buffer.from([0x00]), Buffer.from(password, 'utf8'), Buffer.from(challengeHex, 'hex')]))
              .digest('hex');
            const respWord = `=response=00${md5Hash}`;
            safeWrite(['/login', `=name=${username}`, respWord]);
            return;
          }

          // Autentikasi berhasil pada RouterOS modern! Lanjut baca identitas router
          currentStep = 'get_identity';
          safeWrite(['/system/identity/print']);
          return;
        }

        if (replyType === '!trap') {
          clearTimeout(timer);
          return finish({
            success: false,
            message: 'Autentikasi MikroTik gagal. Pastikan username dan password benar serta memiliki izin API.',
            errorDetails: 'AUTH_FAILED',
          });
        }
      }

      if (currentStep === 'login_challenge_sent') {
        if (replyType === '!done') {
          // Autentikasi challenge berhasil! Lanjut baca identitas router
          currentStep = 'get_identity';
          safeWrite(['/system/identity/print']);
          return;
        }

        if (replyType === '!trap') {
          clearTimeout(timer);
          return finish({
            success: false,
            message: 'Autentikasi MikroTik gagal (username atau password salah).',
            errorDetails: 'AUTH_FAILED',
          });
        }
      }

      if (currentStep === 'get_identity') {
        if (replyType === '!re') {
          for (const word of sentence) {
            if (word.startsWith('=name=')) {
              gatheredInfo.identity = word.replace('=name=', '');
            }
          }
        } else if (replyType === '!trap') {
          clearTimeout(timer);
          return finish({
            success: false,
            message: 'Router menolak perintah pembacaan identitas sistem. Periksa hak akses read API pengguna router.',
            errorDetails: 'ROUTEROS_TRAP',
          });
        } else if (replyType === '!done') {
          // Lanjut baca resource router (versi RouterOS, board-name, CPU load)
          currentStep = 'get_resource';
          safeWrite(['/system/resource/print']);
          return;
        }
      }

      if (currentStep === 'get_resource') {
        if (replyType === '!re') {
          for (const word of sentence) {
            if (word.startsWith('=version=')) {
              gatheredInfo.version = word.replace('=version=', '');
            } else if (word.startsWith('=board-name=')) {
              gatheredInfo.boardName = word.replace('=board-name=', '');
            } else if (word.startsWith('=cpu-load=')) {
              const cpuNum = parseInt(word.replace('=cpu-load=', ''), 10);
              gatheredInfo.cpuLoad = isNaN(cpuNum) ? undefined : cpuNum;
            } else if (word.startsWith('=uptime=')) {
              gatheredInfo.uptime = word.replace('=uptime=', '');
            } else if (word.startsWith('=platform=')) {
              gatheredInfo.platform = word.replace('=platform=', '');
            }
          }
        } else if (replyType === '!trap') {
          clearTimeout(timer);
          return finish({
            success: false,
            message: 'Router menolak perintah pembacaan informasi resource sistem. Periksa hak akses read API pengguna router.',
            errorDetails: 'ROUTEROS_TRAP',
          });
        } else if (replyType === '!done') {
          currentStep = 'done';
          clearTimeout(timer);

          // Kirim /quit sebelum menutup soket dengan rapi
          let sentQuit = false;
          try {
            if (!isFinished && socket && !socket.destroyed && socket.writable) {
              socket.write(encodeSentence(['/quit']));
              sentQuit = true;
            }
          } catch {
            // ignore
          }

          const routerIdDisplay = gatheredInfo.identity || cleanHost;
          const rosVerDisplay = gatheredInfo.version ? ` (RouterOS ${gatheredInfo.version})` : '';

          finish(
            {
              success: true,
              message: `Koneksi RouterOS API berhasil! Terhubung ke ${routerIdDisplay}${rosVerDisplay}. Autentikasi terverifikasi.`,
              data: gatheredInfo as MikrotikSystemInfo,
            },
            sentQuit
          );
        }
      }
    }
  });
}

/**
 * Runner terpadu untuk membuka soket koneksi RouterOS API terautentikasi,
 * mengeksekusi fungsi action menggunakan talk(sentence), lalu mengirim /quit dan menutup soket secara bersih.
 */
export async function withRouterOsClient<T>(
  options: MikrotikConnectionOptions,
  action: (talk: (sentence: string[]) => Promise<string[][]>) => Promise<T>
): Promise<T> {
  const cleanPort = validateRouterPort(options.port);
  const resolvedTarget = await resolveAndValidateRouterHost(options.host);
  const cleanHost = resolvedTarget.host;
  const connectIp = resolvedTarget.resolvedIp;
  const pinnedLookup = createPinnedSocketLookup(connectIp);
  const username = options.username ? options.username.trim() : 'admin';
  const password = options.password ?? '';
  const useSsl = Boolean(options.useSsl);
  const timeoutMs = Math.max(3000, Math.min(30000, (options.timeoutSeconds || 10) * 1000));

  return new Promise((resolve, reject) => {
    let socket: net.Socket | null = null;
    let isFinished = false;
    let accumulatedBuffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);

    let activeReplyResolve: ((sentences: string[][]) => void) | null = null;
    let activeReplyReject: ((err: Error) => void) | null = null;
    let currentSentenceAccumulator: string[][] = [];

    const cleanup = (graceful = false) => {
      clearTimeout(timer);
      if (socket) {
        const s = socket;
        socket = null;
        try {
          s.removeAllListeners('data');
          s.removeAllListeners('timeout');
          s.removeAllListeners('close');
          s.removeAllListeners('end');
          s.removeAllListeners('connect');
          s.removeAllListeners('secureConnect');
          s.removeAllListeners('error');
          // Pasang error sink sebelum teardown agar event ECONNRESET/EPIPE asinkron saat teardown tidak unhandled
          s.on('error', () => {
            // ignore teardown error after settle
          });
          if (!s.destroyed) {
            if (graceful && s.writable) {
              const forceTimer = setTimeout(() => {
                if (!s.destroyed) {
                  try {
                    s.destroy();
                  } catch {
                    // ignore
                  }
                }
              }, 50);
              forceTimer.unref();
              s.once('close', () => clearTimeout(forceTimer));
              s.end();
            } else {
              s.destroy();
            }
          }
        } catch {
          // ignore
        }
      }
    };

    const finishError = (err: Error) => {
      if (isFinished) return;
      isFinished = true;
      cleanup(false);
      if (activeReplyReject) {
        const rejecter = activeReplyReject;
        activeReplyResolve = null;
        activeReplyReject = null;
        rejecter(err);
      }
      reject(err);
    };

    const finishSuccess = (res: T, graceful = false) => {
      if (isFinished) return;
      isFinished = true;
      cleanup(graceful);
      activeReplyResolve = null;
      activeReplyReject = null;
      resolve(res);
    };

    const timer = setTimeout(() => {
      finishError(
        new SafeOperationalError(
          'ETIMEDOUT',
          `Koneksi timeout. Router di ${cleanHost}:${cleanPort} tidak merespons dalam ${timeoutMs / 1000} detik.`
        )
      );
    }, timeoutMs);

    try {
      if (useSsl) {
        socket = tls.connect(
          {
            host: connectIp,
            port: cleanPort,
            lookup: pinnedLookup,
            ...(resolvedTarget.isIpLiteral ? {} : { servername: cleanHost }),
            rejectUnauthorized: false,
            timeout: timeoutMs,
          },
          () => onConnected()
        );
      } else {
        socket = net.connect(
          {
            host: connectIp,
            port: cleanPort,
            family: 4,
            lookup: pinnedLookup,
            timeout: timeoutMs,
          },
          () => onConnected()
        );
      }
    } catch {
      clearTimeout(timer);
      return finishError(
        new SafeOperationalError('SOCKET_INIT_FAILED', 'Gagal menginisialisasi soket koneksi ke router.')
      );
    }

    socket.setTimeout(timeoutMs);

    socket.on('timeout', () => {
      clearTimeout(timer);
      finishError(
        new SafeOperationalError('ETIMEDOUT', `Koneksi timeout ke ${cleanHost}:${cleanPort}. Router tidak merespons.`)
      );
    });

    socket.on('error', (err: any) => {
      clearTimeout(timer);
      const code = sanitizeSocketErrorCode(err);
      let userFriendlyMsg = `Gagal terhubung ke router ${cleanHost}:${cleanPort} karena gangguan jaringan/soket.`;
      if (code === 'ECONNREFUSED') {
        userFriendlyMsg = `Koneksi ditolak oleh ${cleanHost}:${cleanPort} (Port tertutup). Pastikan service API MikroTik aktif di IP > Services.`;
      } else if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH') {
        userFriendlyMsg = `Host ${cleanHost} tidak dapat dijangkau. Periksa routing atau koneksi fisik.`;
      } else if (code === 'ETIMEDOUT') {
        userFriendlyMsg = `Koneksi ke ${cleanHost}:${cleanPort} timeout. Router tidak merespons.`;
      } else if (code === 'ECONNRESET' || code === 'EPIPE') {
        userFriendlyMsg = `Koneksi ke router ${cleanHost}:${cleanPort} terputus secara mendadak.`;
      } else if (code === 'TLS_ERROR') {
        userFriendlyMsg = `Kesalahan negosiasi SSL/TLS pada router ${cleanHost}:${cleanPort}.`;
      }
      finishError(new SafeOperationalError(code, userFriendlyMsg));
    });

    socket.on('close', () => {
      if (!isFinished) {
        clearTimeout(timer);
        finishError(
          new SafeOperationalError('CONNECTION_CLOSED_PREMATURELY', 'Koneksi ke router ditutup sebelum operasi selesai.')
        );
      }
    });

    type AuthStep = 'auth_init' | 'auth_challenge' | 'authenticated';
    let authStep: AuthStep = 'auth_init';

    function safeClientWrite(sentenceToSend: string[]) {
      if (!isFinished && socket && !socket.destroyed && socket.writable) {
        socket.write(encodeSentence(sentenceToSend));
      }
    }

    function onConnected() {
      authStep = 'auth_init';
      safeClientWrite(['/login', `=name=${username}`, `=password=${password}`]);
    }

    socket.on('data', (chunk: Buffer) => {
      if (isFinished) return;
      accumulatedBuffer = Buffer.concat([accumulatedBuffer, chunk]);
      const { sentences, remaining } = extractSentences(accumulatedBuffer);
      accumulatedBuffer = remaining;

      for (const sentence of sentences) {
        if (isFinished) break;
        if (sentence.length === 0) continue;

        if (authStep !== 'authenticated') {
          handleAuthSentence(sentence);
        } else {
          handleCommandSentence(sentence);
        }
      }
    });

    function handleAuthSentence(sentence: string[]) {
      const replyType = sentence[0];

      if (replyType === '!fatal') {
        clearTimeout(timer);
        return finishError(
          new SafeOperationalError('ROUTEROS_FATAL', 'Koneksi dihentikan oleh router MikroTik.', { isFatal: true })
        );
      }

      if (authStep === 'auth_init') {
        if (replyType === '!done') {
          const retWord = sentence.find((w) => w.startsWith('=ret='));
          if (retWord) {
            const challengeHex = retWord.replace('=ret=', '');
            authStep = 'auth_challenge';
            const md5Hash = crypto
              .createHash('md5')
              .update(Buffer.concat([Buffer.from([0x00]), Buffer.from(password, 'utf8'), Buffer.from(challengeHex, 'hex')]))
              .digest('hex');
            safeClientWrite(['/login', `=name=${username}`, `=response=00${md5Hash}`]);
            return;
          }

          startActionExecution();
          return;
        }

        if (replyType === '!trap') {
          clearTimeout(timer);
          return finishError(
            new SafeOperationalError(
              'ROUTEROS_AUTH_FAILED',
              'Autentikasi MikroTik gagal. Pastikan username dan password router benar serta memiliki izin API.'
            )
          );
        }
      }

      if (authStep === 'auth_challenge') {
        if (replyType === '!done') {
          startActionExecution();
          return;
        }
        if (replyType === '!trap') {
          clearTimeout(timer);
          return finishError(
            new SafeOperationalError('ROUTEROS_AUTH_FAILED', 'Autentikasi MikroTik gagal (username atau password salah).')
          );
        }
      }
    }

    function startActionExecution() {
      authStep = 'authenticated';

      const talk = (sentenceToSend: string[]): Promise<string[][]> => {
        return new Promise((res, rej) => {
          if (isFinished || !socket || socket.destroyed || !socket.writable) {
            return rej(
              new SafeOperationalError('ROUTEROS_SOCKET_ERROR', 'Koneksi RouterOS sudah tertutup sebelum perintah dikirim.')
            );
          }
          activeReplyResolve = res;
          activeReplyReject = rej;
          currentSentenceAccumulator = [];
          try {
            socket.write(encodeSentence(sentenceToSend));
          } catch {
            activeReplyResolve = null;
            activeReplyReject = null;
            rej(new SafeOperationalError('ROUTEROS_SOCKET_ERROR', 'Gagal mengirim perintah ke koneksi RouterOS.'));
          }
        });
      };

      action(talk)
        .then((result) => {
          clearTimeout(timer);
          let sentQuit = false;
          try {
            if (!isFinished && socket && !socket.destroyed && socket.writable) {
              socket.write(encodeSentence(['/quit']));
              sentQuit = true;
            }
          } catch {
            // ignore
          }
          finishSuccess(result, sentQuit);
        })
        .catch((err) => {
          clearTimeout(timer);
          try {
            safeClientWrite(['/quit']);
          } catch {
            // ignore
          }
          finishError(err);
        });
    }

    function handleCommandSentence(sentence: string[]) {
      currentSentenceAccumulator.push(sentence);
      const replyType = sentence[0];

      if (replyType === '!fatal') {
        clearTimeout(timer);
        const fatalErr = new SafeOperationalError(
          'ROUTEROS_FATAL',
          'Koneksi API dihentikan oleh RouterOS.',
          { isFatal: true }
        );
        if (activeReplyReject) {
          const rejecter = activeReplyReject;
          activeReplyResolve = null;
          activeReplyReject = null;
          currentSentenceAccumulator = [];
          rejecter(fatalErr);
        }
        finishError(fatalErr);
        return;
      }

      if (replyType === '!done') {
        if (activeReplyResolve) {
          const resolver = activeReplyResolve;
          const collected = currentSentenceAccumulator;
          activeReplyResolve = null;
          activeReplyReject = null;
          currentSentenceAccumulator = [];
          resolver(collected);
        }
      }
    }
  });
}

/**
 * Memeriksa kalimat balasan RouterOS API dan memastikan tidak mengandung respons !fatal atau !trap.
 * Tidak meneruskan isi mentah =message= dari RouterOS; menggunakan pesan operasional terkontrol.
 */
function assertNoTrapOrFatal(replies: string[][], defaultErrMsg: string): void {
  const fatalSent = replies.find((s) => s[0] === '!fatal');
  if (fatalSent) {
    throw new SafeOperationalError('ROUTEROS_FATAL', 'Koneksi API dihentikan oleh RouterOS.', {
      isFatal: true,
    });
  }

  const trapSent = replies.find((s) => s[0] === '!trap');
  if (trapSent) {
    throw new SafeOperationalError('ROUTEROS_TRAP', defaultErrMsg);
  }
}

/**
 * Memvalidasi apakah nama profile (PPPoE atau Hotspot) benar-benar ada di RouterOS RB4011.
 * Dilarang menggunakan profile default jika profile belum ada di router.
 */
export async function checkProfileExists(
  options: MikrotikConnectionOptions,
  profileName: string,
  type: 'pppoe' | 'hotspot'
): Promise<{ exists: boolean; message: string }> {
  if (!profileName || !profileName.trim()) {
    return { exists: false, message: 'Nama profile belum ditentukan atau kosong.' };
  }
  const cleanProfile = profileName.trim();

  return await withRouterOsClient(options, async (talk) => {
    const printCmd = type === 'pppoe' ? '/ppp/profile/print' : '/ip/hotspot/user/profile/print';
    const replies = await talk([printCmd, `?name=${cleanProfile}`]);
    assertNoTrapOrFatal(replies, `Gagal memeriksa daftar profile ${type.toUpperCase()} di router.`);

    const hasMatch = replies.some(
      (sent) => sent[0] === '!re' && sent.some((w) => w === `=name=${cleanProfile}`)
    );

    if (hasMatch) {
      return { exists: true, message: `Profile '${cleanProfile}' valid dan terverifikasi di RouterOS.` };
    }

    return {
      exists: false,
      message: `Profile MikroTik '${cleanProfile}' tidak ditemukan pada router di menu ${
        type === 'pppoe' ? 'PPP > Profiles' : 'IP > Hotspot > User Profiles'
      }. Harap buat profile tersebut terlebih dahulu di WinBox.`,
    };
  });
}

/**
 * Helper internal untuk mengumpulkan seluruh kalimat !re dengan pencocokan atribut persis (case-sensitive).
 */
function findExactMatchingEntries(
  replies: string[][],
  matchAttrName: string,
  matchValue: string
): string[][] {
  return replies.filter(
    (s) => s[0] === '!re' && s.some((w) => w === `=${matchAttrName}=${matchValue}`)
  );
}

/**
 * Helper internal untuk mengekstrak seluruh nilai .id unik dari kalimat !re yang cocok secara persis.
 */
function extractMatchingIds(
  replies: string[][],
  matchAttrName: string,
  matchValue: string
): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const s of findExactMatchingEntries(replies, matchAttrName, matchValue)) {
    const idWord = s.find((w) => w.startsWith('=.id='));
    const rawId = idWord?.replace('=.id=', '').trim();
    if (rawId) {
      const cleanId = rawId.startsWith('*') ? rawId : `*${rawId}`;
      if (!seen.has(cleanId)) {
        seen.add(cleanId);
        ids.push(cleanId);
      }
    }
  }
  return ids;
}

/**
 * Menambah atau memperbarui PPPoE Secret secara idempotent di RouterOS.
 * Menolak dan gagal secara aman jika terdeteksi akun duplikat (>1 secret dengan username sama).
 */
export async function createOrUpdatePppoeSecret(
  options: MikrotikConnectionOptions,
  data: {
    username: string;
    password?: string;
    profile: string;
    ipAddress?: string;
    disabled?: boolean;
  }
): Promise<{ success: boolean; message: string; action: 'add' | 'set'; profileChanged: boolean }> {
  const cleanUser = data.username.trim();
  const cleanProfile = data.profile ? data.profile.trim() : '';

  if (!cleanUser) {
    throw new SafeOperationalError('ROUTEROS_VALIDATION_ERROR', 'Username PPPoE tidak boleh kosong.');
  }
  if (!cleanProfile) {
    throw new SafeOperationalError(
      'ROUTEROS_VALIDATION_ERROR',
      'Profile PPPoE tidak boleh kosong atau belum dikonfigurasi.'
    );
  }

  return await withRouterOsClient(options, async (talk) => {
    // 1. Cek seluruh secret dengan username persis (tolak jika duplikat)
    const printReplies = await talk(['/ppp/secret/print', `?name=${cleanUser}`]);
    assertNoTrapOrFatal(printReplies, `Gagal memeriksa akun PPPoE '${cleanUser}' di router.`);

    const matches = findExactMatchingEntries(printReplies, 'name', cleanUser);
    if (matches.length > 1) {
      throw new SafeOperationalError(
        'ROUTEROS_DUPLICATE_ACCOUNT',
        `Terdeteksi ${matches.length} akun duplikat PPPoE Secret untuk username '${cleanUser}' di RouterOS. Sinkronisasi dibatalkan demi keamanan — harap bersihkan duplikasi secara manual di WinBox.`
      );
    }

    if (matches.length === 1) {
      const existingIdWord = matches[0].find((w) => w.startsWith('=.id='));
      const existingId = existingIdWord?.replace('=.id=', '').trim();
      if (!existingId) {
        throw new SafeOperationalError(
          'ROUTEROS_TRAP',
          `Secret PPPoE '${cleanUser}' ditemukan tanpa atribut .id RouterOS yang valid.`
        );
      }
      const previousProfile =
        matches[0].find((w) => w.startsWith('=profile='))?.replace('=profile=', '').trim() || '';
      const profileChanged = Boolean(previousProfile && previousProfile !== cleanProfile);

      // UPDATE (SET)
      const cleanId = existingId.startsWith('*') ? existingId : `*${existingId}`;
      const setCmd = ['/ppp/secret/set', `=.id=${cleanId}`, `=profile=${cleanProfile}`, `=service=pppoe`];
      if (data.password && data.password.trim()) {
        setCmd.push(`=password=${data.password.trim()}`);
      }
      if (data.ipAddress && data.ipAddress.trim()) {
        setCmd.push(`=remote-address=${data.ipAddress.trim()}`);
      }
      if (data.disabled !== undefined) {
        setCmd.push(`=disabled=${data.disabled ? 'yes' : 'no'}`);
      }

      const setReplies = await talk(setCmd);
      assertNoTrapOrFatal(setReplies, `Gagal memperbarui secret PPPoE '${cleanUser}' di router.`);

      return {
        success: true,
        message: `Secret PPPoE '${cleanUser}' berhasil diperbarui di router MikroTik.`,
        action: 'set',
        profileChanged,
      };
    } else {
      // TAMBAH BARU (ADD)
      if (!data.password || !data.password.trim()) {
        throw new SafeOperationalError(
          'ROUTEROS_VALIDATION_ERROR',
          `Password PPPoE wajib diisi untuk pembuatan akun baru '${cleanUser}' di router.`
        );
      }
      const addCmd = [
        '/ppp/secret/add',
        `=name=${cleanUser}`,
        `=password=${data.password.trim()}`,
        `=profile=${cleanProfile}`,
        `=service=pppoe`,
      ];
      if (data.ipAddress && data.ipAddress.trim()) {
        addCmd.push(`=remote-address=${data.ipAddress.trim()}`);
      }
      if (data.disabled) {
        addCmd.push('=disabled=yes');
      }

      const addReplies = await talk(addCmd);
      assertNoTrapOrFatal(addReplies, `Gagal menambahkan secret PPPoE '${cleanUser}' di router.`);

      return {
        success: true,
        message: `Secret PPPoE '${cleanUser}' berhasil dibuat di router MikroTik.`,
        action: 'add',
        profileChanged: false,
      };
    }
  });
}

/**
 * Memutuskan SELURUH sesi aktif PPPoE pelanggan di RouterOS.
 * Hanya dipanggil SETELAH perubahan profile dikonfirmasi sukses oleh router.
 * Jika salah satu sesi gagal diputus (!trap / !fatal) atau masih tersisa setelah verifikasi, mengembalikan success: false.
 */
export async function disconnectPppoeSession(
  options: MikrotikConnectionOptions,
  username: string
): Promise<{
  success: boolean;
  message: string;
  disconnected: boolean;
  disconnectedCount: number;
  failedCount: number;
}> {
  const cleanUser = username.trim();
  if (!cleanUser) {
    return {
      success: false,
      message: 'Username PPPoE tidak boleh kosong.',
      disconnected: false,
      disconnectedCount: 0,
      failedCount: 0,
    };
  }

  return await withRouterOsClient(options, async (talk) => {
    const activeReplies = await talk(['/ppp/active/print', `?name=${cleanUser}`]);
    assertNoTrapOrFatal(activeReplies, `Gagal memeriksa sesi aktif PPPoE '${cleanUser}' di router.`);

    const activeIds = extractMatchingIds(activeReplies, 'name', cleanUser);

    if (activeIds.length === 0) {
      return {
        success: true,
        message: `Tidak ada sesi aktif PPPoE yang sedang berjalan untuk '${cleanUser}'.`,
        disconnected: false,
        disconnectedCount: 0,
        failedCount: 0,
      };
    }

    let disconnectedCount = 0;
    const failedIds: string[] = [];
    const errors: string[] = [];

    for (const cleanId of activeIds) {
      try {
        const removeReplies = await talk(['/ppp/active/remove', `=.id=${cleanId}`]);
        assertNoTrapOrFatal(
          removeReplies,
          `Gagal memutuskan sesi aktif PPPoE '${cleanUser}' (ID ${cleanId}) di router.`
        );
        disconnectedCount++;
      } catch (err: any) {
        if (isFatalMikrotikError(err)) {
          throw err;
        }
        failedIds.push(cleanId);
        const safeErr = sanitizeMikrotikError(err, `Gagal memutus sesi ID ${cleanId}`);
        errors.push(safeErr.message);
      }
    }

    if (failedIds.length > 0) {
      return {
        success: false,
        message: `Berhasil memutus ${disconnectedCount} sesi, namun ${failedIds.length} sesi aktif PPPoE '${cleanUser}' gagal diputus: ${errors[0]}`,
        disconnected: disconnectedCount > 0,
        disconnectedCount,
        failedCount: failedIds.length,
      };
    }

    // Pemeriksaan ulang setelah pemutusan untuk memastikan tidak ada sesi PPPoE tertinggal
    const verifyReplies = await talk(['/ppp/active/print', `?name=${cleanUser}`]);
    assertNoTrapOrFatal(verifyReplies, `Gagal memverifikasi ulang sesi aktif PPPoE '${cleanUser}' di router.`);
    const remainingIds = extractMatchingIds(verifyReplies, 'name', cleanUser);
    if (remainingIds.length > 0) {
      return {
        success: false,
        message: `Masih terdapat ${remainingIds.length} sesi aktif PPPoE '${cleanUser}' yang tertinggal di router setelah proses pemutusan.`,
        disconnected: disconnectedCount > 0,
        disconnectedCount,
        failedCount: remainingIds.length,
      };
    }

    return {
      success: true,
      message: `${disconnectedCount} sesi aktif PPPoE '${cleanUser}' berhasil diputuskan dari router.`,
      disconnected: true,
      disconnectedCount,
      failedCount: 0,
    };
  });
}

/**
 * Mengubah status aktif / nonaktif (disable) secret PPPoE pelanggan.
 * Menolak jika terdeteksi duplikasi akun. Jika dinonaktifkan, seluruh sesi aktif yang cocok diputuskan dan diverifikasi kosong.
 */
export async function togglePppoeSecret(
  options: MikrotikConnectionOptions,
  username: string,
  disabled: boolean
): Promise<{ success: boolean; message: string }> {
  const cleanUser = username.trim();
  if (!cleanUser) {
    throw new SafeOperationalError('ROUTEROS_VALIDATION_ERROR', 'Username PPPoE tidak boleh kosong.');
  }

  return await withRouterOsClient(options, async (talk) => {
    const printReplies = await talk(['/ppp/secret/print', `?name=${cleanUser}`]);
    assertNoTrapOrFatal(printReplies, `Gagal mencari akun PPPoE '${cleanUser}' di router.`);

    const matches = findExactMatchingEntries(printReplies, 'name', cleanUser);
    if (matches.length === 0) {
      throw new SafeOperationalError(
        'ROUTEROS_NOT_FOUND',
        `Akun PPPoE '${cleanUser}' tidak ditemukan di router MikroTik.`
      );
    }
    if (matches.length > 1) {
      throw new SafeOperationalError(
        'ROUTEROS_DUPLICATE_ACCOUNT',
        `Terdeteksi ${matches.length} akun duplikat PPPoE Secret untuk '${cleanUser}' di RouterOS. Perubahan status dibatalkan demi keamanan.`
      );
    }

    const idWord = matches[0].find((w) => w.startsWith('=.id='));
    const secretId = idWord?.replace('=.id=', '').trim();
    if (!secretId) {
      throw new SafeOperationalError(
        'ROUTEROS_TRAP',
        `Secret PPPoE '${cleanUser}' tidak memiliki .id yang valid di RouterOS.`
      );
    }

    const cleanId = secretId.startsWith('*') ? secretId : `*${secretId}`;
    const setReplies = await talk(['/ppp/secret/set', `=.id=${cleanId}`, `=disabled=${disabled ? 'yes' : 'no'}`]);
    assertNoTrapOrFatal(setReplies, `Gagal mengubah status secret PPPoE '${cleanUser}' di router.`);

    // Jika dinonaktifkan, putuskan SELURUH sesi aktif agar pelanggan langsung terputus
    if (disabled) {
      const activeReplies = await talk(['/ppp/active/print', `?name=${cleanUser}`]);
      assertNoTrapOrFatal(activeReplies, `Gagal memeriksa sesi aktif PPPoE '${cleanUser}' saat penonaktifan.`);

      const activeIds = extractMatchingIds(activeReplies, 'name', cleanUser);
      const disconnectErrors: string[] = [];

      for (const cleanActiveId of activeIds) {
        try {
          const removeReplies = await talk(['/ppp/active/remove', `=.id=${cleanActiveId}`]);
          assertNoTrapOrFatal(
            removeReplies,
            `Gagal memutuskan sesi aktif PPPoE '${cleanUser}' (ID ${cleanActiveId}) saat penonaktifan.`
          );
        } catch (err: any) {
          if (isFatalMikrotikError(err)) {
            throw err;
          }
          const safeErr = sanitizeMikrotikError(err, `Gagal memutus sesi ${cleanActiveId}`);
          disconnectErrors.push(safeErr.message);
        }
      }

      if (disconnectErrors.length > 0) {
        throw new SafeOperationalError(
          'ROUTEROS_DISCONNECT_INCOMPLETE',
          `Status secret PPPoE '${cleanUser}' diubah ke disabled, namun ${disconnectErrors.length} sesi aktif gagal diputus: ${disconnectErrors[0]}`
        );
      }

      if (activeIds.length > 0) {
        const verifyActiveReplies = await talk(['/ppp/active/print', `?name=${cleanUser}`]);
        assertNoTrapOrFatal(verifyActiveReplies, `Gagal memeriksa ulang sesi aktif PPPoE '${cleanUser}' saat penonaktifan.`);
        const remainingIds = extractMatchingIds(verifyActiveReplies, 'name', cleanUser);
        if (remainingIds.length > 0) {
          throw new SafeOperationalError(
            'ROUTEROS_DISCONNECT_INCOMPLETE',
            `Status secret PPPoE '${cleanUser}' diubah ke disabled, namun ${remainingIds.length} sesi aktif masih tersisa di router.`
          );
        }
      }
    }

    return {
      success: true,
      message: `Akun PPPoE '${cleanUser}' berhasil di-${disabled ? 'nonaktifkan' : 'aktifkan'}.`,
    };
  });
}

/**
 * Menambah atau memperbarui Hotspot User secara idempotent di RouterOS.
 * Menolak dan gagal secara aman jika terdeteksi akun duplikat (>1 user dengan username sama).
 */
export async function createOrUpdateHotspotUser(
  options: MikrotikConnectionOptions,
  data: {
    username: string;
    password?: string;
    profile: string;
    disabled?: boolean;
  }
): Promise<{ success: boolean; message: string; action: 'add' | 'set'; profileChanged: boolean }> {
  const cleanUser = data.username.trim();
  const cleanProfile = data.profile ? data.profile.trim() : '';

  if (!cleanUser) {
    throw new SafeOperationalError('ROUTEROS_VALIDATION_ERROR', 'Username Hotspot tidak boleh kosong.');
  }
  if (!cleanProfile) {
    throw new SafeOperationalError(
      'ROUTEROS_VALIDATION_ERROR',
      'Profile Hotspot tidak boleh kosong atau belum dikonfigurasi.'
    );
  }

  return await withRouterOsClient(options, async (talk) => {
    const printReplies = await talk(['/ip/hotspot/user/print', `?name=${cleanUser}`]);
    assertNoTrapOrFatal(printReplies, `Gagal memeriksa user Hotspot '${cleanUser}' di router.`);

    const matches = findExactMatchingEntries(printReplies, 'name', cleanUser);
    if (matches.length > 1) {
      throw new SafeOperationalError(
        'ROUTEROS_DUPLICATE_ACCOUNT',
        `Terdeteksi ${matches.length} akun duplikat Hotspot User untuk username '${cleanUser}' di RouterOS. Sinkronisasi dibatalkan demi keamanan — harap bersihkan duplikasi secara manual di WinBox.`
      );
    }

    if (matches.length === 1) {
      const idWord = matches[0].find((w) => w.startsWith('=.id='));
      const existingId = idWord?.replace('=.id=', '').trim();
      if (!existingId) {
        throw new SafeOperationalError(
          'ROUTEROS_TRAP',
          `User Hotspot '${cleanUser}' ditemukan tanpa atribut .id RouterOS yang valid.`
        );
      }
      const previousProfile =
        matches[0].find((w) => w.startsWith('=profile='))?.replace('=profile=', '').trim() || '';
      const profileChanged = Boolean(previousProfile && previousProfile !== cleanProfile);

      const cleanId = existingId.startsWith('*') ? existingId : `*${existingId}`;
      const setCmd = ['/ip/hotspot/user/set', `=.id=${cleanId}`, `=profile=${cleanProfile}`];
      if (data.password && data.password.trim()) {
        setCmd.push(`=password=${data.password.trim()}`);
      }
      if (data.disabled !== undefined) {
        setCmd.push(`=disabled=${data.disabled ? 'yes' : 'no'}`);
      }

      const setReplies = await talk(setCmd);
      assertNoTrapOrFatal(setReplies, `Gagal memperbarui user Hotspot '${cleanUser}' di router.`);

      return {
        success: true,
        message: `User Hotspot '${cleanUser}' berhasil diperbarui di router MikroTik.`,
        action: 'set',
        profileChanged,
      };
    } else {
      if (!data.password || !data.password.trim()) {
        throw new SafeOperationalError(
          'ROUTEROS_VALIDATION_ERROR',
          `Password Hotspot wajib diisi untuk user baru '${cleanUser}'.`
        );
      }
      const addCmd = [
        '/ip/hotspot/user/add',
        `=name=${cleanUser}`,
        `=password=${data.password.trim()}`,
        `=profile=${cleanProfile}`,
      ];
      if (data.disabled) {
        addCmd.push('=disabled=yes');
      }

      const addReplies = await talk(addCmd);
      assertNoTrapOrFatal(addReplies, `Gagal menambahkan user Hotspot '${cleanUser}' di router.`);

      return {
        success: true,
        message: `User Hotspot '${cleanUser}' berhasil dibuat di router MikroTik.`,
        action: 'add',
        profileChanged: false,
      };
    }
  });
}

/**
 * Memutuskan SELURUH sesi aktif Hotspot pelanggan di RouterOS.
 * Jika salah satu sesi gagal diputus (!trap / !fatal) atau masih tersisa setelah verifikasi, mengembalikan success: false.
 */
export async function disconnectHotspotSession(
  options: MikrotikConnectionOptions,
  username: string
): Promise<{
  success: boolean;
  message: string;
  disconnected: boolean;
  disconnectedCount: number;
  failedCount: number;
}> {
  const cleanUser = username.trim();
  if (!cleanUser) {
    return {
      success: false,
      message: 'Username Hotspot tidak boleh kosong.',
      disconnected: false,
      disconnectedCount: 0,
      failedCount: 0,
    };
  }

  return await withRouterOsClient(options, async (talk) => {
    const activeReplies = await talk(['/ip/hotspot/active/print', `?user=${cleanUser}`]);
    assertNoTrapOrFatal(activeReplies, `Gagal memeriksa sesi aktif Hotspot '${cleanUser}' di router.`);

    const activeIds = extractMatchingIds(activeReplies, 'user', cleanUser);

    if (activeIds.length === 0) {
      return {
        success: true,
        message: `Tidak ada sesi aktif Hotspot yang sedang berjalan untuk '${cleanUser}'.`,
        disconnected: false,
        disconnectedCount: 0,
        failedCount: 0,
      };
    }

    let disconnectedCount = 0;
    const failedIds: string[] = [];
    const errors: string[] = [];

    for (const cleanId of activeIds) {
      try {
        const removeReplies = await talk(['/ip/hotspot/active/remove', `=.id=${cleanId}`]);
        assertNoTrapOrFatal(
          removeReplies,
          `Gagal memutuskan sesi aktif Hotspot '${cleanUser}' (ID ${cleanId}) di router.`
        );
        disconnectedCount++;
      } catch (err: any) {
        if (isFatalMikrotikError(err)) {
          throw err;
        }
        failedIds.push(cleanId);
        const safeErr = sanitizeMikrotikError(err, `Gagal memutus sesi ID ${cleanId}`);
        errors.push(safeErr.message);
      }
    }

    if (failedIds.length > 0) {
      return {
        success: false,
        message: `Berhasil memutus ${disconnectedCount} sesi, namun ${failedIds.length} sesi aktif Hotspot '${cleanUser}' gagal diputus: ${errors[0]}`,
        disconnected: disconnectedCount > 0,
        disconnectedCount,
        failedCount: failedIds.length,
      };
    }

    // Pemeriksaan ulang setelah pemutusan untuk memastikan tidak ada sesi Hotspot tertinggal
    const verifyReplies = await talk(['/ip/hotspot/active/print', `?user=${cleanUser}`]);
    assertNoTrapOrFatal(verifyReplies, `Gagal memverifikasi ulang sesi aktif Hotspot '${cleanUser}' di router.`);
    const remainingIds = extractMatchingIds(verifyReplies, 'user', cleanUser);
    if (remainingIds.length > 0) {
      return {
        success: false,
        message: `Masih terdapat ${remainingIds.length} sesi aktif Hotspot '${cleanUser}' yang tertinggal di router setelah proses pemutusan.`,
        disconnected: disconnectedCount > 0,
        disconnectedCount,
        failedCount: remainingIds.length,
      };
    }

    return {
      success: true,
      message: `${disconnectedCount} sesi aktif Hotspot '${cleanUser}' berhasil diputuskan dari router.`,
      disconnected: true,
      disconnectedCount,
      failedCount: 0,
    };
  });
}

/**
 * Mengubah status aktif / nonaktif (disable) user Hotspot pelanggan.
 * Menolak jika terdeteksi duplikasi akun. Jika dinonaktifkan, seluruh sesi aktif yang cocok diputuskan dan diverifikasi kosong.
 */
export async function toggleHotspotUser(
  options: MikrotikConnectionOptions,
  username: string,
  disabled: boolean
): Promise<{ success: boolean; message: string }> {
  const cleanUser = username.trim();
  if (!cleanUser) {
    throw new SafeOperationalError('ROUTEROS_VALIDATION_ERROR', 'Username Hotspot tidak boleh kosong.');
  }

  return await withRouterOsClient(options, async (talk) => {
    const printReplies = await talk(['/ip/hotspot/user/print', `?name=${cleanUser}`]);
    assertNoTrapOrFatal(printReplies, `Gagal mencari user Hotspot '${cleanUser}' di router.`);

    const matches = findExactMatchingEntries(printReplies, 'name', cleanUser);
    if (matches.length === 0) {
      throw new SafeOperationalError(
        'ROUTEROS_NOT_FOUND',
        `User Hotspot '${cleanUser}' tidak ditemukan di router MikroTik.`
      );
    }
    if (matches.length > 1) {
      throw new SafeOperationalError(
        'ROUTEROS_DUPLICATE_ACCOUNT',
        `Terdeteksi ${matches.length} akun duplikat Hotspot User untuk '${cleanUser}' di RouterOS. Perubahan status dibatalkan demi keamanan.`
      );
    }

    const idWord = matches[0].find((w) => w.startsWith('=.id='));
    const userId = idWord?.replace('=.id=', '').trim();
    if (!userId) {
      throw new SafeOperationalError(
        'ROUTEROS_TRAP',
        `User Hotspot '${cleanUser}' tidak memiliki .id yang valid di RouterOS.`
      );
    }

    const cleanId = userId.startsWith('*') ? userId : `*${userId}`;
    const setReplies = await talk(['/ip/hotspot/user/set', `=.id=${cleanId}`, `=disabled=${disabled ? 'yes' : 'no'}`]);
    assertNoTrapOrFatal(setReplies, `Gagal mengubah status user Hotspot '${cleanUser}' di router.`);

    if (disabled) {
      const activeReplies = await talk(['/ip/hotspot/active/print', `?user=${cleanUser}`]);
      assertNoTrapOrFatal(activeReplies, `Gagal memeriksa sesi aktif Hotspot '${cleanUser}' saat penonaktifan.`);

      const activeIds = extractMatchingIds(activeReplies, 'user', cleanUser);
      const disconnectErrors: string[] = [];

      for (const cleanActiveId of activeIds) {
        try {
          const removeReplies = await talk(['/ip/hotspot/active/remove', `=.id=${cleanActiveId}`]);
          assertNoTrapOrFatal(
            removeReplies,
            `Gagal memutuskan sesi aktif Hotspot '${cleanUser}' (ID ${cleanActiveId}) saat penonaktifan.`
          );
        } catch (err: any) {
          if (isFatalMikrotikError(err)) {
            throw err;
          }
          const safeErr = sanitizeMikrotikError(err, `Gagal memutus sesi ${cleanActiveId}`);
          disconnectErrors.push(safeErr.message);
        }
      }

      if (disconnectErrors.length > 0) {
        throw new SafeOperationalError(
          'ROUTEROS_DISCONNECT_INCOMPLETE',
          `Status user Hotspot '${cleanUser}' diubah ke disabled, namun ${disconnectErrors.length} sesi aktif gagal diputus: ${disconnectErrors[0]}`
        );
      }

      if (activeIds.length > 0) {
        const verifyActiveReplies = await talk(['/ip/hotspot/active/print', `?user=${cleanUser}`]);
        assertNoTrapOrFatal(verifyActiveReplies, `Gagal memeriksa ulang sesi aktif Hotspot '${cleanUser}' saat penonaktifan.`);
        const remainingIds = extractMatchingIds(verifyActiveReplies, 'user', cleanUser);
        if (remainingIds.length > 0) {
          throw new SafeOperationalError(
            'ROUTEROS_DISCONNECT_INCOMPLETE',
            `Status user Hotspot '${cleanUser}' diubah ke disabled, namun ${remainingIds.length} sesi aktif masih tersisa di router.`
          );
        }
      }
    }

    return {
      success: true,
      message: `User Hotspot '${cleanUser}' berhasil di-${disabled ? 'nonaktifkan' : 'aktifkan'}.`,
    };
  });
}

/**
 * Memverifikasi bahwa TEPAT SATU akun PPPoE tersimpan dan terkonfigurasi sesuai di RouterOS sebelum cleanup akun lama.
 */
export async function verifyPppoeSecretExists(
  options: MikrotikConnectionOptions,
  username: string,
  expectedProfile?: string,
  expectedDisabled?: boolean
): Promise<{ verified: boolean; count: number; message: string }> {
  const cleanUser = username.trim();
  return await withRouterOsClient(options, async (talk) => {
    const replies = await talk(['/ppp/secret/print', `?name=${cleanUser}`]);
    assertNoTrapOrFatal(replies, `Gagal memverifikasi secret PPPoE '${cleanUser}' di router.`);

    const matches = findExactMatchingEntries(replies, 'name', cleanUser);
    if (matches.length === 0) {
      return {
        verified: false,
        count: 0,
        message: `Verifikasi gagal: Secret PPPoE '${cleanUser}' tidak ditemukan di router setelah proses simpan.`,
      };
    }
    if (matches.length > 1) {
      return {
        verified: false,
        count: matches.length,
        message: `Verifikasi gagal: Terdeteksi ${matches.length} akun duplikat secret PPPoE untuk '${cleanUser}' di RouterOS. Sinkronisasi dibatalkan demi keamanan.`,
      };
    }

    const entry = matches[0];
    if (expectedProfile) {
      const hasProfile = entry.some((w) => w === `=profile=${expectedProfile.trim()}`);
      if (!hasProfile) {
        return {
          verified: false,
          count: 1,
          message: `Verifikasi gagal: Profile secret PPPoE '${cleanUser}' di router belum sesuai dengan '${expectedProfile}'.`,
        };
      }
    }
    if (expectedDisabled !== undefined) {
      const disabledVal = entry.find((w) => w.startsWith('=disabled='))?.replace('=disabled=', '').toLowerCase();
      const isEntryDisabled = disabledVal === 'yes' || disabledVal === 'true';
      if (isEntryDisabled !== expectedDisabled) {
        return {
          verified: false,
          count: 1,
          message: `Verifikasi gagal: Status disabled secret PPPoE '${cleanUser}' di router belum sesuai (${expectedDisabled ? 'disabled' : 'aktif'}).`,
        };
      }
    }
    return {
      verified: true,
      count: 1,
      message: `Secret PPPoE '${cleanUser}' terverifikasi tunggal dan aktif di router.`,
    };
  });
}

/**
 * Memverifikasi bahwa TEPAT SATU user Hotspot tersimpan dan terkonfigurasi sesuai di RouterOS sebelum cleanup akun lama.
 */
export async function verifyHotspotUserExists(
  options: MikrotikConnectionOptions,
  username: string,
  expectedProfile?: string,
  expectedDisabled?: boolean
): Promise<{ verified: boolean; count: number; message: string }> {
  const cleanUser = username.trim();
  return await withRouterOsClient(options, async (talk) => {
    const replies = await talk(['/ip/hotspot/user/print', `?name=${cleanUser}`]);
    assertNoTrapOrFatal(replies, `Gagal memverifikasi user Hotspot '${cleanUser}' di router.`);

    const matches = findExactMatchingEntries(replies, 'name', cleanUser);
    if (matches.length === 0) {
      return {
        verified: false,
        count: 0,
        message: `Verifikasi gagal: User Hotspot '${cleanUser}' tidak ditemukan di router setelah proses simpan.`,
      };
    }
    if (matches.length > 1) {
      return {
        verified: false,
        count: matches.length,
        message: `Verifikasi gagal: Terdeteksi ${matches.length} akun duplikat user Hotspot untuk '${cleanUser}' di RouterOS. Sinkronisasi dibatalkan demi keamanan.`,
      };
    }

    const entry = matches[0];
    if (expectedProfile) {
      const hasProfile = entry.some((w) => w === `=profile=${expectedProfile.trim()}`);
      if (!hasProfile) {
        return {
          verified: false,
          count: 1,
          message: `Verifikasi gagal: Profile user Hotspot '${cleanUser}' di router belum sesuai dengan '${expectedProfile}'.`,
        };
      }
    }
    if (expectedDisabled !== undefined) {
      const disabledVal = entry.find((w) => w.startsWith('=disabled='))?.replace('=disabled=', '').toLowerCase();
      const isEntryDisabled = disabledVal === 'yes' || disabledVal === 'true';
      if (isEntryDisabled !== expectedDisabled) {
        return {
          verified: false,
          count: 1,
          message: `Verifikasi gagal: Status disabled user Hotspot '${cleanUser}' di router belum sesuai (${expectedDisabled ? 'disabled' : 'aktif'}).`,
        };
      }
    }
    return {
      verified: true,
      count: 1,
      message: `User Hotspot '${cleanUser}' terverifikasi tunggal dan aktif di router.`,
    };
  });
}

/**
 * Menghapus secret PPPoE lama secara idempotent di RouterOS.
 */
export async function removePppoeSecret(
  options: MikrotikConnectionOptions,
  username: string
): Promise<{ success: boolean; removedCount: number; failedCount: number; message: string }> {
  const cleanUser = username.trim();
  if (!cleanUser) {
    return { success: true, removedCount: 0, failedCount: 0, message: 'Username kosong dilewati.' };
  }

  return await withRouterOsClient(options, async (talk) => {
    const printReplies = await talk(['/ppp/secret/print', `?name=${cleanUser}`]);
    assertNoTrapOrFatal(printReplies, `Gagal mencari secret PPPoE lama '${cleanUser}' di router.`);

    const secretIds = extractMatchingIds(printReplies, 'name', cleanUser);
    if (secretIds.length === 0) {
      return {
        success: true,
        removedCount: 0,
        failedCount: 0,
        message: `Secret PPPoE lama '${cleanUser}' sudah tidak ada di router.`,
      };
    }

    let removedCount = 0;
    const failedIds: string[] = [];
    const errors: string[] = [];

    for (const cleanId of secretIds) {
      try {
        const removeReplies = await talk(['/ppp/secret/remove', `=.id=${cleanId}`]);
        assertNoTrapOrFatal(removeReplies, `Gagal menghapus secret PPPoE lama '${cleanUser}' (ID ${cleanId}).`);
        removedCount++;
      } catch (err: any) {
        if (isFatalMikrotikError(err)) {
          throw err;
        }
        failedIds.push(cleanId);
        const safeErr = sanitizeMikrotikError(err, `Gagal menghapus secret ${cleanId}`);
        errors.push(safeErr.message);
      }
    }

    if (failedIds.length > 0) {
      return {
        success: false,
        removedCount,
        failedCount: failedIds.length,
        message: `Gagal menghapus ${failedIds.length} entri secret PPPoE lama '${cleanUser}': ${errors[0]}`,
      };
    }

    return {
      success: true,
      removedCount,
      failedCount: 0,
      message: `Secret PPPoE lama '${cleanUser}' (${removedCount} entri) berhasil dihapus dari router.`,
    };
  });
}

/**
 * Menghapus user Hotspot lama secara idempotent di RouterOS.
 */
export async function removeHotspotUser(
  options: MikrotikConnectionOptions,
  username: string
): Promise<{ success: boolean; removedCount: number; failedCount: number; message: string }> {
  const cleanUser = username.trim();
  if (!cleanUser) {
    return { success: true, removedCount: 0, failedCount: 0, message: 'Username kosong dilewati.' };
  }

  return await withRouterOsClient(options, async (talk) => {
    const printReplies = await talk(['/ip/hotspot/user/print', `?name=${cleanUser}`]);
    assertNoTrapOrFatal(printReplies, `Gagal mencari user Hotspot lama '${cleanUser}' di router.`);

    const userIds = extractMatchingIds(printReplies, 'name', cleanUser);
    if (userIds.length === 0) {
      return {
        success: true,
        removedCount: 0,
        failedCount: 0,
        message: `User Hotspot lama '${cleanUser}' sudah tidak ada di router.`,
      };
    }

    let removedCount = 0;
    const failedIds: string[] = [];
    const errors: string[] = [];

    for (const cleanId of userIds) {
      try {
        const removeReplies = await talk(['/ip/hotspot/user/remove', `=.id=${cleanId}`]);
        assertNoTrapOrFatal(removeReplies, `Gagal menghapus user Hotspot lama '${cleanUser}' (ID ${cleanId}).`);
        removedCount++;
      } catch (err: any) {
        if (isFatalMikrotikError(err)) {
          throw err;
        }
        failedIds.push(cleanId);
        const safeErr = sanitizeMikrotikError(err, `Gagal menghapus user ${cleanId}`);
        errors.push(safeErr.message);
      }
    }

    if (failedIds.length > 0) {
      return {
        success: false,
        removedCount,
        failedCount: failedIds.length,
        message: `Gagal menghapus ${failedIds.length} entri user Hotspot lama '${cleanUser}': ${errors[0]}`,
      };
    }

    return {
      success: true,
      removedCount,
      failedCount: 0,
      message: `User Hotspot lama '${cleanUser}' (${removedCount} entri) berhasil dihapus dari router.`,
    };
  });
}

/**
 * Membersihkan akun lama di router (menghapus akun agar tidak reconnect, lalu memutus seluruh sesi aktifnya).
 * Hanya boleh dipanggil SETELAH akun baru berhasil dibuat dan diverifikasi.
 */
export async function cleanupOldRouterAccount(
  options: MikrotikConnectionOptions,
  oldType: 'pppoe' | 'hotspot',
  oldUsername: string
): Promise<{
  success: boolean;
  accountRemoved: boolean;
  sessionsDisconnected: boolean;
  message: string;
}> {
  const cleanOldUser = oldUsername.trim();
  if (!cleanOldUser) {
    return {
      success: true,
      accountRemoved: true,
      sessionsDisconnected: true,
      message: 'Tidak ada username lama untuk dibersihkan.',
    };
  }

  let accountRemoved = false;
  let sessionsDisconnected = false;
  const errors: string[] = [];

  // 1. Hapus akun lama lebih dahulu agar tidak langsung reconnect
  try {
    const rmRes =
      oldType === 'hotspot'
        ? await removeHotspotUser(options, cleanOldUser)
        : await removePppoeSecret(options, cleanOldUser);
    if (rmRes.success) {
      accountRemoved = true;
    } else {
      errors.push(`hapus akun lama gagal: ${rmRes.message}`);
    }
  } catch (err: any) {
    const safeErr = sanitizeMikrotikError(
      err,
      `Gagal menghapus akun ${oldType.toUpperCase()} lama '${cleanOldUser}'`
    );
    return {
      success: false,
      accountRemoved: false,
      sessionsDisconnected: false,
      message: `hapus akun lama gagal (koneksi/fatal): ${safeErr.message}`,
    };
  }

  // 2. Putuskan seluruh sesi aktif akun lama
  try {
    const dcRes =
      oldType === 'hotspot'
        ? await disconnectHotspotSession(options, cleanOldUser)
        : await disconnectPppoeSession(options, cleanOldUser);
    if (dcRes.success) {
      sessionsDisconnected = true;
    } else {
      errors.push(
        `${accountRemoved ? 'akun lama sudah dihapus, namun ' : ''}pemutusan sesi aktif akun lama gagal: ${dcRes.message}`
      );
    }
  } catch (err: any) {
    const safeErr = sanitizeMikrotikError(
      err,
      `Gagal memutus sesi aktif ${oldType.toUpperCase()} lama '${cleanOldUser}'`
    );
    errors.push(
      `${accountRemoved ? 'akun lama sudah dihapus, namun ' : ''}pemutusan sesi aktif akun lama gagal: ${safeErr.message}`
    );
  }

  if (errors.length > 0 || !accountRemoved || !sessionsDisconnected) {
    return {
      success: false,
      accountRemoved,
      sessionsDisconnected,
      message:
        errors.length > 0
          ? errors.join('; ')
          : `Pembersihan akun lama ${oldType.toUpperCase()} '${cleanOldUser}' belum lengkap (accountRemoved=${accountRemoved}, sessionsDisconnected=${sessionsDisconnected}).`,
    };
  }

  return {
    success: true,
    accountRemoved: true,
    sessionsDisconnected: true,
    message: `Akun lama ${oldType.toUpperCase()} '${cleanOldUser}' dan seluruh sesi aktifnya berhasil dibersihkan dari router.`,
  };
}


