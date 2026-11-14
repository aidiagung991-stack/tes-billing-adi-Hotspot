import net from 'net';
import tls from 'tls';
import crypto from 'crypto';

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

/**
 * Validasi alamat Host / IP RouterOS untuk mencegah SSRF.
 * Mengizinkan alamat IP privat LAN (192.168.x.x, 10.x.x.x, 172.16-31.x.x), loopback lokal, dan hostname lokal.
 * Menolak alamat cloud metadata (169.254.x.x, metadata.google.internal, dsb).
 */
export function validateRouterHost(host: string): string {
  if (!host || typeof host !== 'string') {
    throw new Error('Alamat IP atau Host router wajib diisi.');
  }

  const cleanHost = host.trim().toLowerCase();

  // Larang skema protokol URL seperti http:// atau https://
  if (cleanHost.includes('://')) {
    throw new Error('Masukkan alamat IP atau Hostname router saja, tanpa awalan protokol seperti http:// atau https://.');
  }

  // Larang cloud metadata endpoints (SSRF protection)
  if (
    cleanHost === '169.254.169.254' ||
    cleanHost.startsWith('169.254.') ||
    cleanHost.includes('metadata.google.internal') ||
    cleanHost.includes('metadata.internal') ||
    cleanHost === '100.100.100.200'
  ) {
    throw new Error('Alamat IP tersebut terlarang demi keamanan server (Cloud Metadata Endpoint).');
  }

  // Pastikan karakter host hanya karakter valid (alfanumerik, titik, tanda hubung, atau kolon IPv6)
  const validHostRegex = /^[a-zA-Z0-9.:_-]+$/;
  if (!validHostRegex.test(cleanHost)) {
    throw new Error('Format alamat Host / IP router mengandung karakter yang tidak valid.');
  }

  return cleanHost;
}

/**
 * Validasi port API MikroTik.
 * Rentang valid: 1-65535 (standar MikroTik: 8728 untuk API biasa, 8729 untuk API-SSL).
 */
export function validateRouterPort(port: number | string): number {
  const num = typeof port === 'string' ? parseInt(port, 10) : port;
  if (isNaN(num) || num < 1 || num > 65535) {
    throw new Error('Port API router harus berupa angka antara 1 dan 65535 (default 8728 atau 8729).');
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
  const cleanHost = validateRouterHost(options.host);
  const cleanPort = validateRouterPort(options.port);
  const username = options.username ? options.username.trim() : 'admin';
  const password = options.password ?? '';
  const useSsl = Boolean(options.useSsl);
  const timeoutMs = Math.max(3000, Math.min(30000, (options.timeoutSeconds || 10) * 1000));

  return new Promise((resolve) => {
    let socket: net.Socket | null = null;
    let isFinished = false;
    let accumulatedBuffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);

    const finish = (result: MikrotikConnectionResult) => {
      if (isFinished) return;
      isFinished = true;
      if (socket) {
        try {
          socket.removeAllListeners();
          socket.destroy();
        } catch {
          // ignore
        }
        socket = null;
      }
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
            host: cleanHost,
            port: cleanPort,
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
            host: cleanHost,
            port: cleanPort,
            timeout: timeoutMs,
          },
          () => {
            onConnected();
          }
        );
      }
    } catch (err: any) {
      clearTimeout(timer);
      return finish({
        success: false,
        message: `Gagal menginisialisasi soket koneksi: ${err?.message || 'Error tidak diketahui'}`,
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
      const code = err?.code || '';
      let userFriendlyMsg = `Gagal terhubung ke router ${cleanHost}:${cleanPort}.`;

      if (code === 'ECONNREFUSED') {
        userFriendlyMsg = `Koneksi ditolak oleh ${cleanHost}:${cleanPort} (Port tertutup). Pastikan service API MikroTik telah diaktifkan di menu IP > Services (Port 8728 untuk API biasa, Port 8729 untuk API-SSL).`;
      } else if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH') {
        userFriendlyMsg = `Alamat host/jaringan ${cleanHost} tidak dapat dijangkau. Periksa kabel LAN, routing jaringan, atau tunnel VPN.`;
      } else if (code === 'ETIMEDOUT') {
        userFriendlyMsg = `Koneksi ke ${cleanHost}:${cleanPort} timeout. Router tidak merespons.`;
      } else if (err?.message?.includes('SSL') || err?.message?.includes('TLS')) {
        userFriendlyMsg = `Kesalahan negosiasi SSL/TLS pada port ${cleanPort}. Pastikan service api-ssl telah memiliki sertifikat aktif di MikroTik.`;
      } else {
        userFriendlyMsg += ` ${err?.message || 'Kesalahan jaringan.'}`;
      }

      finish({
        success: false,
        message: userFriendlyMsg,
        errorDetails: code || err?.message,
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

    function onConnected() {
      // Langkah 1: Kirim /login dengan username dan password (standar RouterOS v6.43+ dan RouterOS v7)
      currentStep = 'login_sent';
      const loginSentence = ['/login', `=name=${username}`, `=password=${password}`];
      socket?.write(encodeSentence(loginSentence));
    }

    socket.on('data', (chunk: Buffer) => {
      accumulatedBuffer = Buffer.concat([accumulatedBuffer, chunk]);
      const { sentences, remaining } = extractSentences(accumulatedBuffer);
      accumulatedBuffer = remaining;

      for (const sentence of sentences) {
        handleSentence(sentence);
      }
    });

    function handleSentence(sentence: string[]) {
      if (sentence.length === 0) return;
      const replyType = sentence[0];

      if (replyType === '!fatal') {
        clearTimeout(timer);
        const msg = sentence.find((w) => w.startsWith('=message='))?.replace('=message=', '') || 'Fatal error dari RouterOS';
        return finish({
          success: false,
          message: `Koneksi dihentikan oleh router: ${msg}`,
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
            socket?.write(encodeSentence(['/login', `=name=${username}`, respWord]));
            return;
          }

          // Autentikasi berhasil pada RouterOS modern! Lanjut baca identitas router
          currentStep = 'get_identity';
          socket?.write(encodeSentence(['/system/identity/print']));
          return;
        }

        if (replyType === '!trap') {
          clearTimeout(timer);
          const trapMsg = sentence.find((w) => w.startsWith('=message='))?.replace('=message=', '') || 'Autentikasi gagal';
          return finish({
            success: false,
            message: `Autentikasi MikroTik gagal: ${trapMsg}. Pastikan username dan password benar serta memiliki izin API.`,
            errorDetails: 'AUTH_FAILED',
          });
        }
      }

      if (currentStep === 'login_challenge_sent') {
        if (replyType === '!done') {
          // Autentikasi challenge berhasil! Lanjut baca identitas router
          currentStep = 'get_identity';
          socket?.write(encodeSentence(['/system/identity/print']));
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
        } else if (replyType === '!done') {
          // Lanjut baca resource router (versi RouterOS, board-name, CPU load)
          currentStep = 'get_resource';
          socket?.write(encodeSentence(['/system/resource/print']));
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
        } else if (replyType === '!done') {
          currentStep = 'done';
          clearTimeout(timer);

          // Kirim /quit sebelum menutup soket dengan rapi
          try {
            socket?.write(encodeSentence(['/quit']));
          } catch {
            // ignore
          }

          const routerIdDisplay = gatheredInfo.identity || cleanHost;
          const rosVerDisplay = gatheredInfo.version ? ` (RouterOS ${gatheredInfo.version})` : '';

          finish({
            success: true,
            message: `Koneksi RouterOS API berhasil! Terhubung ke ${routerIdDisplay}${rosVerDisplay}. Autentikasi terverifikasi.`,
            data: gatheredInfo as MikrotikSystemInfo,
          });
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
  const cleanHost = validateRouterHost(options.host);
  const cleanPort = validateRouterPort(options.port);
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

    const cleanup = () => {
      if (socket) {
        try {
          socket.removeAllListeners();
          socket.destroy();
        } catch {
          // ignore
        }
        socket = null;
      }
    };

    const finishError = (err: Error) => {
      if (isFinished) return;
      isFinished = true;
      cleanup();
      if (activeReplyReject) {
        activeReplyReject(err);
      }
      reject(err);
    };

    const finishSuccess = (res: T) => {
      if (isFinished) return;
      isFinished = true;
      cleanup();
      resolve(res);
    };

    const timer = setTimeout(() => {
      finishError(
        new Error(
          `Koneksi timeout. Router di ${cleanHost}:${cleanPort} tidak merespons dalam ${timeoutMs / 1000} detik.`
        )
      );
    }, timeoutMs);

    try {
      if (useSsl) {
        socket = tls.connect(
          {
            host: cleanHost,
            port: cleanPort,
            rejectUnauthorized: false,
            timeout: timeoutMs,
          },
          () => onConnected()
        );
      } else {
        socket = net.connect(
          {
            host: cleanHost,
            port: cleanPort,
            timeout: timeoutMs,
          },
          () => onConnected()
        );
      }
    } catch (err: any) {
      clearTimeout(timer);
      return finishError(new Error(`Gagal menginisialisasi soket: ${err?.message || 'Error'}`));
    }

    socket.setTimeout(timeoutMs);

    socket.on('timeout', () => {
      clearTimeout(timer);
      finishError(new Error(`Koneksi timeout ke ${cleanHost}:${cleanPort}. Router tidak merespons.`));
    });

    socket.on('error', (err: any) => {
      clearTimeout(timer);
      const code = err?.code || '';
      let userFriendlyMsg = `Gagal terhubung ke router ${cleanHost}:${cleanPort}.`;
      if (code === 'ECONNREFUSED') {
        userFriendlyMsg = `Koneksi ditolak oleh ${cleanHost}:${cleanPort} (Port tertutup). Pastikan service API MikroTik aktif di IP > Services.`;
      } else if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH') {
        userFriendlyMsg = `Host ${cleanHost} tidak dapat dijangkau. Periksa routing atau koneksi fisik.`;
      } else {
        userFriendlyMsg += ` ${err?.message || 'Kesalahan jaringan.'}`;
      }
      finishError(new Error(userFriendlyMsg));
    });

    socket.on('close', () => {
      if (!isFinished) {
        clearTimeout(timer);
        finishError(new Error('Koneksi ke router ditutup sebelum operasi selesai.'));
      }
    });

    type AuthStep = 'auth_init' | 'auth_challenge' | 'authenticated';
    let authStep: AuthStep = 'auth_init';

    function onConnected() {
      authStep = 'auth_init';
      socket?.write(encodeSentence(['/login', `=name=${username}`, `=password=${password}`]));
    }

    socket.on('data', (chunk: Buffer) => {
      accumulatedBuffer = Buffer.concat([accumulatedBuffer, chunk]);
      const { sentences, remaining } = extractSentences(accumulatedBuffer);
      accumulatedBuffer = remaining;

      for (const sentence of sentences) {
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
        const msg = sentence.find((w) => w.startsWith('=message='))?.replace('=message=', '') || 'Fatal error';
        return finishError(new Error(`Koneksi dihentikan oleh router: ${msg}`));
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
            socket?.write(encodeSentence(['/login', `=name=${username}`, `=response=00${md5Hash}`]));
            return;
          }

          startActionExecution();
          return;
        }

        if (replyType === '!trap') {
          clearTimeout(timer);
          const trapMsg = sentence.find((w) => w.startsWith('=message='))?.replace('=message=', '') || 'Autentikasi gagal';
          return finishError(new Error(`Autentikasi MikroTik gagal: ${trapMsg}.`));
        }
      }

      if (authStep === 'auth_challenge') {
        if (replyType === '!done') {
          startActionExecution();
          return;
        }
        if (replyType === '!trap') {
          clearTimeout(timer);
          return finishError(new Error('Autentikasi MikroTik gagal (username atau password salah).'));
        }
      }
    }

    function startActionExecution() {
      authStep = 'authenticated';

      const talk = (sentenceToSend: string[]): Promise<string[][]> => {
        return new Promise((res, rej) => {
          activeReplyResolve = res;
          activeReplyReject = rej;
          currentSentenceAccumulator = [];
          socket?.write(encodeSentence(sentenceToSend));
        });
      };

      action(talk)
        .then((result) => {
          clearTimeout(timer);
          try {
            socket?.write(encodeSentence(['/quit']));
          } catch {
            // ignore
          }
          finishSuccess(result);
        })
        .catch((err) => {
          clearTimeout(timer);
          try {
            socket?.write(encodeSentence(['/quit']));
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
        const fatalMsg =
          sentence.find((w) => w.startsWith('=message='))?.replace('=message=', '') ||
          'Koneksi API dihentikan oleh RouterOS (Fatal Error)';
        const fatalErr = new Error(`RouterOS fatal error: ${fatalMsg}`);
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
 * Jika ditemukan, melempar Error deskriptif dan membatalkan proses provisioning.
 */
function assertNoTrapOrFatal(replies: string[][], defaultErrMsg: string): void {
  const fatalSent = replies.find((s) => s[0] === '!fatal');
  if (fatalSent) {
    const msg =
      fatalSent.find((w) => w.startsWith('=message='))?.replace('=message=', '') ||
      'Fatal error dari RouterOS API';
    throw new Error(`RouterOS fatal error: ${msg}`);
  }

  const trapSent = replies.find((s) => s[0] === '!trap');
  if (trapSent) {
    const msg =
      trapSent.find((w) => w.startsWith('=message='))?.replace('=message=', '') || defaultErrMsg;
    throw new Error(msg);
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
): Promise<{ success: boolean; message: string; action: 'add' | 'set' }> {
  const cleanUser = data.username.trim();
  const cleanProfile = data.profile ? data.profile.trim() : '';

  if (!cleanUser) {
    throw new Error('Username PPPoE tidak boleh kosong.');
  }
  if (!cleanProfile) {
    throw new Error('Profile PPPoE tidak boleh kosong atau belum dikonfigurasi.');
  }

  return await withRouterOsClient(options, async (talk) => {
    // 1. Cek seluruh secret dengan username persis (tolak jika duplikat)
    const printReplies = await talk(['/ppp/secret/print', `?name=${cleanUser}`]);
    assertNoTrapOrFatal(printReplies, `Gagal memeriksa akun PPPoE '${cleanUser}' di router.`);

    const matches = findExactMatchingEntries(printReplies, 'name', cleanUser);
    if (matches.length > 1) {
      throw new Error(
        `Terdeteksi ${matches.length} akun duplikat PPPoE Secret untuk username '${cleanUser}' di RouterOS. Sinkronisasi dibatalkan demi keamanan — harap bersihkan duplikasi secara manual di WinBox.`
      );
    }

    if (matches.length === 1) {
      const existingIdWord = matches[0].find((w) => w.startsWith('=.id='));
      const existingId = existingIdWord?.replace('=.id=', '').trim();
      if (!existingId) {
        throw new Error(`Secret PPPoE '${cleanUser}' ditemukan tanpa atribut .id RouterOS yang valid.`);
      }

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
      };
    } else {
      // TAMBAH BARU (ADD)
      if (!data.password || !data.password.trim()) {
        throw new Error(`Password PPPoE wajib diisi untuk pembuatan akun baru '${cleanUser}' di router.`);
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
        if (err?.message?.startsWith('RouterOS fatal error:')) {
          throw err;
        }
        failedIds.push(cleanId);
        errors.push(err?.message || `Gagal memutus sesi ID ${cleanId}`);
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
    throw new Error('Username PPPoE tidak boleh kosong.');
  }

  return await withRouterOsClient(options, async (talk) => {
    const printReplies = await talk(['/ppp/secret/print', `?name=${cleanUser}`]);
    assertNoTrapOrFatal(printReplies, `Gagal mencari akun PPPoE '${cleanUser}' di router.`);

    const matches = findExactMatchingEntries(printReplies, 'name', cleanUser);
    if (matches.length === 0) {
      throw new Error(`Akun PPPoE '${cleanUser}' tidak ditemukan di router MikroTik.`);
    }
    if (matches.length > 1) {
      throw new Error(
        `Terdeteksi ${matches.length} akun duplikat PPPoE Secret untuk '${cleanUser}' di RouterOS. Perubahan status dibatalkan demi keamanan.`
      );
    }

    const idWord = matches[0].find((w) => w.startsWith('=.id='));
    const secretId = idWord?.replace('=.id=', '').trim();
    if (!secretId) {
      throw new Error(`Secret PPPoE '${cleanUser}' tidak memiliki .id yang valid di RouterOS.`);
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
          if (err?.message?.startsWith('RouterOS fatal error:')) {
            throw err;
          }
          disconnectErrors.push(err?.message || `Gagal memutus sesi ${cleanActiveId}`);
        }
      }

      if (disconnectErrors.length > 0) {
        throw new Error(
          `Status secret PPPoE '${cleanUser}' diubah ke disabled, namun ${disconnectErrors.length} sesi aktif gagal diputus: ${disconnectErrors[0]}`
        );
      }

      if (activeIds.length > 0) {
        const verifyActiveReplies = await talk(['/ppp/active/print', `?name=${cleanUser}`]);
        assertNoTrapOrFatal(verifyActiveReplies, `Gagal memeriksa ulang sesi aktif PPPoE '${cleanUser}' saat penonaktifan.`);
        const remainingIds = extractMatchingIds(verifyActiveReplies, 'name', cleanUser);
        if (remainingIds.length > 0) {
          throw new Error(
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
): Promise<{ success: boolean; message: string; action: 'add' | 'set' }> {
  const cleanUser = data.username.trim();
  const cleanProfile = data.profile ? data.profile.trim() : '';

  if (!cleanUser) {
    throw new Error('Username Hotspot tidak boleh kosong.');
  }
  if (!cleanProfile) {
    throw new Error('Profile Hotspot tidak boleh kosong atau belum dikonfigurasi.');
  }

  return await withRouterOsClient(options, async (talk) => {
    const printReplies = await talk(['/ip/hotspot/user/print', `?name=${cleanUser}`]);
    assertNoTrapOrFatal(printReplies, `Gagal memeriksa user Hotspot '${cleanUser}' di router.`);

    const matches = findExactMatchingEntries(printReplies, 'name', cleanUser);
    if (matches.length > 1) {
      throw new Error(
        `Terdeteksi ${matches.length} akun duplikat Hotspot User untuk username '${cleanUser}' di RouterOS. Sinkronisasi dibatalkan demi keamanan — harap bersihkan duplikasi secara manual di WinBox.`
      );
    }

    if (matches.length === 1) {
      const idWord = matches[0].find((w) => w.startsWith('=.id='));
      const existingId = idWord?.replace('=.id=', '').trim();
      if (!existingId) {
        throw new Error(`User Hotspot '${cleanUser}' ditemukan tanpa atribut .id RouterOS yang valid.`);
      }

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
      };
    } else {
      if (!data.password || !data.password.trim()) {
        throw new Error(`Password Hotspot wajib diisi untuk user baru '${cleanUser}'.`);
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
        if (err?.message?.startsWith('RouterOS fatal error:')) {
          throw err;
        }
        failedIds.push(cleanId);
        errors.push(err?.message || `Gagal memutus sesi ID ${cleanId}`);
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
    throw new Error('Username Hotspot tidak boleh kosong.');
  }

  return await withRouterOsClient(options, async (talk) => {
    const printReplies = await talk(['/ip/hotspot/user/print', `?name=${cleanUser}`]);
    assertNoTrapOrFatal(printReplies, `Gagal mencari user Hotspot '${cleanUser}' di router.`);

    const matches = findExactMatchingEntries(printReplies, 'name', cleanUser);
    if (matches.length === 0) {
      throw new Error(`User Hotspot '${cleanUser}' tidak ditemukan di router MikroTik.`);
    }
    if (matches.length > 1) {
      throw new Error(
        `Terdeteksi ${matches.length} akun duplikat Hotspot User untuk '${cleanUser}' di RouterOS. Perubahan status dibatalkan demi keamanan.`
      );
    }

    const idWord = matches[0].find((w) => w.startsWith('=.id='));
    const userId = idWord?.replace('=.id=', '').trim();
    if (!userId) {
      throw new Error(`User Hotspot '${cleanUser}' tidak memiliki .id yang valid di RouterOS.`);
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
          if (err?.message?.startsWith('RouterOS fatal error:')) {
            throw err;
          }
          disconnectErrors.push(err?.message || `Gagal memutus sesi ${cleanActiveId}`);
        }
      }

      if (disconnectErrors.length > 0) {
        throw new Error(
          `Status user Hotspot '${cleanUser}' diubah ke disabled, namun ${disconnectErrors.length} sesi aktif gagal diputus: ${disconnectErrors[0]}`
        );
      }

      if (activeIds.length > 0) {
        const verifyActiveReplies = await talk(['/ip/hotspot/active/print', `?user=${cleanUser}`]);
        assertNoTrapOrFatal(verifyActiveReplies, `Gagal memeriksa ulang sesi aktif Hotspot '${cleanUser}' saat penonaktifan.`);
        const remainingIds = extractMatchingIds(verifyActiveReplies, 'user', cleanUser);
        if (remainingIds.length > 0) {
          throw new Error(
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
        if (err?.message?.startsWith('RouterOS fatal error:')) {
          throw err;
        }
        failedIds.push(cleanId);
        errors.push(err?.message || `Gagal menghapus secret ${cleanId}`);
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
        if (err?.message?.startsWith('RouterOS fatal error:')) {
          throw err;
        }
        failedIds.push(cleanId);
        errors.push(err?.message || `Gagal menghapus user ${cleanId}`);
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
    const errMsg = err?.message || `Gagal menghapus akun ${oldType.toUpperCase()} lama '${cleanOldUser}'`;
    return {
      success: false,
      accountRemoved: false,
      sessionsDisconnected: false,
      message: `hapus akun lama gagal (koneksi/fatal): ${errMsg}`,
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
    const errMsg = err?.message || `Gagal memutus sesi aktif ${oldType.toUpperCase()} lama '${cleanOldUser}'`;
    errors.push(
      `${accountRemoved ? 'akun lama sudah dihapus, namun ' : ''}pemutusan sesi aktif akun lama gagal: ${errMsg}`
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


