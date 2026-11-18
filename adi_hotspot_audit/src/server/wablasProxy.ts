/**
 * Wablas WhatsApp Gateway Proxy (Server-Side)
 * 
 * Modul ini menangani komunikasi aman ke API Wablas dari backend Node.js / Express:
 * - Menjaga token API tetap rahasia di sisi server (tidak terekspos ke browser / frontend).
 * - Menghindari masalah CORS (Cross-Origin Resource Sharing) browser.
 * - Mengirim header Authorization resmi (Bearer token).
 * - Menangani parsing respons JSON, status error Wablas, dan kegagalan DNS/koneksi secara aman.
 */

export interface WablasTestConnectionOptions {
  serverUrl?: string;
  token?: string;
  secretKey?: string;
  timeoutMs?: number;
}

export interface WablasTestConnectionResult {
  success: boolean;
  status: 'connected' | 'disconnected';
  message: string;
  data?: any;
  phone?: string;
  quota?: string | number;
  statusCode?: number;
}

export interface WablasSendMessageOptions {
  targetPhone: string;
  messageContent: string;
  serverUrl?: string;
  token?: string;
  secretKey?: string;
  timeoutMs?: number;
}

export interface WablasSendMessageResult {
  success: boolean;
  message: string;
  errorCode?: string | number;
  data?: any;
  statusCode?: number;
}

/**
 * Membersihkan token dari prefix 'Bearer ' dan spasi berlebih
 */
export function cleanToken(token: string): string {
  let clean = token.trim();
  if (clean.toLowerCase().startsWith('bearer ')) {
    clean = clean.slice(7).trim();
  }
  return clean;
}

/**
 * Membersihkan secret key dari spasi berlebih
 */
export function cleanSecretKey(secretKey?: string): string {
  if (!secretKey) return '';
  return secretKey.trim();
}

/**
 * Format token ke format Authorization header resmi Wablas
 * Wablas v1/v2 secara default menggunakan raw token tanpa prefix 'Bearer '
 */
export function formatBearerToken(token: string): string {
  return cleanToken(token);
}

/**
 * Membangun string autentikasi Wablas resmi:
 * - Jika token sudah berupa {token}.{secret_key}, gunakan langsung.
 * - Jika secret key tersedia secara terpisah, gabungkan menjadi {token}.{secret_key}.
 * - Format ini diwajibkan oleh Wablas saat request dikirim dari IP dinamis / Cloud Run (IP belum di-whitelist).
 */
export function buildWablasAuth(token: string, secretKey?: string): string {
  const cleanedToken = cleanToken(token);
  const cleanedSecret = cleanSecretKey(secretKey);

  if (cleanedToken.includes('.')) {
    return cleanedToken;
  }

  if (cleanedSecret && !cleanedSecret.includes('••••')) {
    return `${cleanedToken}.${cleanedSecret}`;
  }

  return cleanedToken;
}

export const ALLOWED_WABLAS_DOMAINS = ['smg.wablas.com'] as const;
export const DEFAULT_WABLAS_SERVER_URL = 'https://smg.wablas.com';

/**
 * Validasi ketat alamat server Wablas di sisi backend:
 * - Wajib menggunakan protokol HTTPS (tolak HTTP dan protokol selain HTTPS).
 * - Tolak localhost, 127.x.x.x, ::1, 0.0.0.0, IP privat (10.x, 172.16-31.x, 192.168.x), IP link-local/cloud metadata (169.254.x).
 * - Tolak domain selain domain resmi Wablas yang diizinkan (smg.wablas.com).
 * - Tolak port non-standar (hanya port standar HTTPS 443 yang diizinkan).
 */
export function validateWablasServerUrl(inputUrl?: string): string {
  const raw = (inputUrl && inputUrl.trim()) || process.env.WABLAS_SERVER_URL || DEFAULT_WABLAS_SERVER_URL;
  let trimmed = raw.trim().replace(/\/+$/, '');

  // Alias semarang.wablas.com dinormalisasi ke smg.wablas.com
  if (trimmed.includes('semarang.wablas.com')) {
    trimmed = trimmed.replace('semarang.wablas.com', 'smg.wablas.com');
  }

  // Tolak protokol non-HTTPS secara tegas
  if (trimmed.toLowerCase().startsWith('http://')) {
    throw new Error('Alamat server Wablas ditolak: Wajib menggunakan protokol HTTPS yang aman. Protokol HTTP tidak diizinkan.');
  }

  if (!trimmed.toLowerCase().startsWith('https://')) {
    // Jika input tidak diawali protokol, gunakan https://
    trimmed = `https://${trimmed}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`Format URL server Wablas tidak valid: "${inputUrl}"`);
  }

  if (parsed.protocol !== 'https:') {
    throw new Error('Alamat server Wablas ditolak: Protokol URL wajib HTTPS.');
  }

  const hostname = parsed.hostname.toLowerCase();

  // Tolak localhost, loopback, private IP, IP internal, dan link-local/cloud metadata (Anti-SSRF)
  const forbiddenHosts = ['localhost', '0.0.0.0', '::1', '[::1]'];
  if (forbiddenHosts.includes(hostname) || hostname.startsWith('127.')) {
    throw new Error(`Alamat server '${hostname}' ditolak. Akses ke localhost/loopback dilarang demi keamanan.`);
  }

  if (
    hostname.startsWith('10.') ||
    hostname.startsWith('192.168.') ||
    hostname.startsWith('169.254.') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal')
  ) {
    throw new Error(`Alamat server '${hostname}' ditolak. Akses ke IP privat/internal dilarang demi keamanan.`);
  }

  if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) {
    throw new Error(`Alamat IP privat '${hostname}' ditolak demi keamanan.`);
  }

  // Backend hanya boleh mengakses domain Wablas resmi yang diizinkan (smg.wablas.com)
  const isAllowed = (ALLOWED_WABLAS_DOMAINS as readonly string[]).includes(hostname);
  if (!isAllowed) {
    throw new Error(
      `Domain server Wablas '${hostname}' tidak diizinkan. Backend hanya mengizinkan domain resmi: ${ALLOWED_WABLAS_DOMAINS.join(', ')}.`
    );
  }

  // Tolak port khusus selain HTTPS standar (443)
  if (parsed.port && parsed.port !== '443') {
    throw new Error(`Port khusus ':${parsed.port}' tidak diizinkan. Hanya port HTTPS standar (443) yang diperbolehkan.`);
  }

  return `https://${hostname}`;
}

/**
 * Membersihkan URL server dan memastikan validasi domain resmi
 */
export function sanitizeServerUrl(url?: string): string {
  return validateWablasServerUrl(url);
}

/**
 * Menguji koneksi ke API resmi Wablas (GET /api/device/info)
 * Menggunakan process.env.WABLAS_SERVER_URL dan process.env.WABLAS_API_TOKEN sebagai fallback utama.
 */
export async function testConnection(
  options: WablasTestConnectionOptions = {}
): Promise<WablasTestConnectionResult> {
  let serverUrl: string;
  try {
    serverUrl = validateWablasServerUrl(options.serverUrl);
  } catch (urlErr: any) {
    return {
      success: false,
      status: 'disconnected',
      message: urlErr?.message || 'Alamat server Wablas tidak valid atau tidak diizinkan.',
      statusCode: 400,
    };
  }
  
  // Ambil token dari parameter (jika diinputkan user dan bukan masking) atau dari environment variable server
  const rawToken =
    options.token && !options.token.includes('••••')
      ? options.token.trim()
      : process.env.WABLAS_API_TOKEN && process.env.WABLAS_API_TOKEN !== 'MY_WABLAS_API_TOKEN'
      ? process.env.WABLAS_API_TOKEN.trim()
      : '';

  if (!rawToken) {
    return {
      success: false,
      status: 'disconnected',
      message: 'Token API Wablas belum diisi atau belum dikonfigurasi di server backend.',
    };
  }

  const rawSecretKey =
    options.secretKey && !options.secretKey.includes('••••')
      ? options.secretKey.trim()
      : process.env.WABLAS_SECRET_KEY && process.env.WABLAS_SECRET_KEY !== 'MY_WABLAS_SECRET_KEY'
      ? process.env.WABLAS_SECRET_KEY.trim()
      : '';

  const cleanedToken = cleanToken(rawToken);
  const authHeader = buildWablasAuth(cleanedToken, rawSecretKey);
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs || 12000;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // Wablas mendukung ?token=... pada GET /api/device/info serta header Authorization
    const targetEndpoint = `${serverUrl}/api/device/info?token=${encodeURIComponent(cleanedToken)}`;
    
    // Coba 1: Menggunakan authHeader pada header Authorization (standar resmi Wablas)
    let response = await fetch(targetEndpoint, {
      method: 'GET',
      redirect: 'error',
      headers: {
        'Authorization': authHeader,
        'Accept': 'application/json',
      },
      signal: controller.signal,
    });

    let rawText = await response.text();
    let responseData: any = null;
    try {
      responseData = JSON.parse(rawText);
    } catch {
      responseData = null;
    }

    // Jika gagal karena token invalid, coba periksa apakah cluster memerlukan prefix Bearer
    if (!response.ok && responseData && responseData.message?.toLowerCase().includes('token')) {
      try {
        const retryResponse = await fetch(targetEndpoint, {
          method: 'GET',
          redirect: 'error',
          headers: {
            'Authorization': `Bearer ${authHeader}`,
            'Accept': 'application/json',
          },
          signal: controller.signal,
        });
        const retryText = await retryResponse.text();
        const retryJson = JSON.parse(retryText);
        if (retryResponse.ok && retryJson && (retryJson.status === true || retryJson.data?.status === 'connected')) {
          response = retryResponse;
          responseData = retryJson;
        }
      } catch {
        // Fallback retry gagal, tetap gunakan hasil dari Coba 1
      }
    }

    clearTimeout(timeoutId);

    // Jika response HTTP sukses (200 OK)
    if (response.ok && responseData) {
      if (responseData.status === true || responseData.data?.status === 'connected') {
        const phone = responseData.data?.phone;
        const quota = responseData.data?.quota;
        const quotaInfo = quota !== undefined ? ` (Sisa Kuota: ${quota})` : '';

        return {
          success: true,
          status: 'connected',
          message: `Koneksi berhasil! Perangkat terhubung ke server Wablas (${serverUrl})${quotaInfo}.`,
          phone,
          quota,
          data: responseData.data,
          statusCode: response.status,
        };
      }

      // HTTP 200 tetapi device belum aktif atau scan QR
      return {
        success: false,
        status: 'disconnected',
        message:
          responseData?.message ||
          'Perangkat WhatsApp pada Wablas belum aktif atau belum memindai kode QR.',
        data: responseData,
        statusCode: response.status,
      };
    }

    // Jika response HTTP bernilai status error (4xx / 5xx)
    // Server Wablas mengembalikan HTTP 500 dengan body {"status": false, "message": "token invalid"} jika token salah.
    if (responseData && responseData.message) {
      const msg = responseData.message.toLowerCase();
      if (msg.includes('token') && (msg.includes('invalid') || msg.includes('expired') || msg.includes('salah') || msg.includes('null'))) {
        return {
          success: false,
          status: 'disconnected',
          message: `Otorisasi gagal: Token API Wablas tidak valid pada cluster server ini (${serverUrl}). Pastikan Token disalin dari menu 'Pengaturan Perangkat' pada cluster ${serverUrl} dan nomor WhatsApp di akun Wablas Anda sudah aktif/scan QR.`,
          data: responseData,
          statusCode: response.status,
        };
      }
      return {
        success: false,
        status: 'disconnected',
        message: `Server Wablas: ${responseData.message}`,
        data: responseData,
        statusCode: response.status,
      };
    }

    // Kasus error HTTP standar tanpa JSON body
    if (response.status === 401 || response.status === 403) {
      return {
        success: false,
        status: 'disconnected',
        message: 'Otorisasi gagal (HTTP 401/403): Token API Wablas tidak valid atau kedaluwarsa.',
        statusCode: response.status,
      };
    }

    return {
      success: false,
      status: 'disconnected',
      message: `Server Wablas merespons dengan status error HTTP ${response.status}.`,
      statusCode: response.status,
    };
  } catch (error: any) {
    clearTimeout(timeoutId);

    if (error.name === 'AbortError') {
      return {
        success: false,
        status: 'disconnected',
        message: `Koneksi ke server Wablas melebihi batas waktu (Timeout ${timeoutMs / 1000} detik).`,
      };
    }

    // Tangani error resolusi DNS (ENOTFOUND)
    const errMessage = error?.message || '';
    const errCode = error?.cause?.code || error?.code;

    if (errCode === 'ENOTFOUND' || errMessage.includes('ENOTFOUND')) {
      return {
        success: false,
        status: 'disconnected',
        message: `Domain server Wablas (${serverUrl}) tidak dapat dijangkau (DNS Host tidak ditemukan). Pastikan domain cluster sesuai dengan dashboard Wablas Anda.`,
      };
    }

    if (errCode === 'ECONNREFUSED' || errMessage.includes('ECONNREFUSED')) {
      return {
        success: false,
        status: 'disconnected',
        message: `Koneksi ditolak oleh server ${serverUrl}. Pastikan port dan domain server benar.`,
      };
    }

    return {
      success: false,
      status: 'disconnected',
      message: `Gagal menghubungi endpoint ${serverUrl}: Jaringan tidak dapat dijangkau atau terjadi kesalahan koneksi.`,
    };
  }
}

/**
 * Mengirim pesan WhatsApp melalui API resmi Wablas (POST /api/send-message)
 */
export async function sendWablasMessage(
  options: WablasSendMessageOptions
): Promise<WablasSendMessageResult> {
  let serverUrl: string;
  try {
    serverUrl = validateWablasServerUrl(options.serverUrl);
  } catch (urlErr: any) {
    return {
      success: false,
      message: urlErr?.message || 'Alamat server Wablas tidak valid atau tidak diizinkan.',
      errorCode: 'INVALID_WABLAS_SERVER_URL',
      statusCode: 400,
    };
  }
  
  const rawToken =
    options.token && !options.token.includes('••••')
      ? options.token.trim()
      : process.env.WABLAS_API_TOKEN && process.env.WABLAS_API_TOKEN !== 'MY_WABLAS_API_TOKEN'
      ? process.env.WABLAS_API_TOKEN.trim()
      : '';

  if (!rawToken) {
    return {
      success: false,
      message: 'Token API Wablas belum dikonfigurasi. Harap simpan token terlebih dahulu.',
    };
  }

  let cleanPhone = options.targetPhone.replace(/\D/g, '');
  if (cleanPhone.startsWith('0')) {
    cleanPhone = '62' + cleanPhone.slice(1);
  } else if (cleanPhone.startsWith('8')) {
    cleanPhone = '62' + cleanPhone;
  }

  if (!cleanPhone || cleanPhone.length < 8) {
    return {
      success: false,
      message: 'Nomor WhatsApp tujuan tidak valid. Gunakan format nomor yang benar (contoh: 08123456789 atau 628123456789).',
    };
  }

  if (!options.messageContent || !options.messageContent.trim()) {
    return {
      success: false,
      message: 'Isi pesan WhatsApp tidak boleh kosong.',
    };
  }

  const rawSecretKey =
    options.secretKey && !options.secretKey.includes('••••')
      ? options.secretKey.trim()
      : process.env.WABLAS_SECRET_KEY && process.env.WABLAS_SECRET_KEY !== 'MY_WABLAS_SECRET_KEY'
      ? process.env.WABLAS_SECRET_KEY.trim()
      : '';

  const cleanedToken = cleanToken(rawToken);
  const authHeader = buildWablasAuth(cleanedToken, rawSecretKey);
  const hasSecretKey = Boolean((rawSecretKey && rawSecretKey.length > 0) || cleanedToken.includes('.'));
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs || 15000;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const v2Endpoint = `${serverUrl}/api/v2/send-message`;
    const v1Endpoint = `${serverUrl}/api/send-message`;

    // Format payload resmi Wablas v2 (JSON): { data: [{ phone, message }] }
    const v2Payload = JSON.stringify({
      data: [
        {
          phone: cleanPhone,
          message: options.messageContent.trim(),
        },
      ],
    });

    // Format payload alternatif Wablas v1
    const v1Payload = JSON.stringify({
      phone: cleanPhone,
      message: options.messageContent.trim(),
      secret: false,
    });

    const headers: Record<string, string> = {
      'Authorization': authHeader,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    // Helper untuk membaca dan membedakan respons JSON vs respons HTML/teks
    const parseResponseSafely = async (res: Response) => {
      const contentType = res.headers.get('content-type') || '';
      const text = await res.text();
      const trimmed = text.trim();
      const isHtml = trimmed.startsWith('<') || contentType.includes('text/html');

      let parsedJson: any = null;
      if (!isHtml && (contentType.includes('application/json') || trimmed.startsWith('{') || trimmed.startsWith('['))) {
        try {
          parsedJson = JSON.parse(trimmed);
        } catch {
          parsedJson = null;
        }
      }

      return {
        isHtml,
        isJson: parsedJson !== null,
        jsonData: parsedJson,
        rawText: trimmed,
        contentType,
        statusCode: res.status,
      };
    };

    // Langkah 1: Coba kirim via endpoint v2 resmi
    let response = await fetch(v2Endpoint, {
      method: 'POST',
      redirect: 'error',
      headers,
      body: v2Payload,
      signal: controller.signal,
    });

    let parsed = await parseResponseSafely(response);

    // Jika v2 404 Not Found, coba fallback ke endpoint v1
    if (response.status === 404) {
      const responseV1 = await fetch(v1Endpoint, {
        method: 'POST',
        redirect: 'error',
        headers,
        body: v1Payload,
        signal: controller.signal,
      });
      parsed = await parseResponseSafely(responseV1);
      response = responseV1;
    }

    // Jika server meminta Bearer token secara spesifik
    if (!response.ok && parsed.isJson && parsed.jsonData?.message?.toLowerCase().includes('token')) {
      try {
        const retryHeaders = {
          ...headers,
          'Authorization': `Bearer ${authHeader}`,
        };
        const retryResp = await fetch(response.url || v2Endpoint, {
          method: 'POST',
          redirect: 'error',
          headers: retryHeaders,
          body: v2Payload,
          signal: controller.signal,
        });
        const retryParsed = await parseResponseSafely(retryResp);
        if (retryResp.ok && retryParsed.isJson && (retryParsed.jsonData.status === true || retryParsed.jsonData.status === 'success')) {
          response = retryResp;
          parsed = retryParsed;
        }
      } catch {
        // Fallback retry gagal, gunakan hasil sebelumnya
      }
    }

    clearTimeout(timeoutId);

    // KASUS 1: Respons berupa HTML (bukan JSON)
    if (parsed.isHtml || !parsed.isJson) {
      let friendlyError = '';
      let errCode = `HTTP_${response.status}`;
      if (response.status === 404) {
        friendlyError = `Endpoint API pengiriman pesan tidak ditemukan di server Wablas (${serverUrl}) (HTTP 404).`;
        errCode = 'WABLAS_ENDPOINT_NOT_FOUND';
      } else if (response.status === 401) {
        friendlyError = `Autentikasi ditolak oleh server Wablas (HTTP 401). Token API tidak valid atau telah kadaluarsa.`;
        errCode = 'WABLAS_UNAUTHORIZED';
      } else if (response.status === 403) {
        if (!hasSecretKey) {
          friendlyError = `Akses pengiriman ditolak server Wablas (HTTP 403): Server aplikasi menggunakan IP dinamis cloud atau akun Anda mewajibkan Secret Key. Masukkan Secret Key dari menu Device > Setting akun Wablas ke form WhatsApp Gateway.`;
          errCode = 'WABLAS_NEED_SECRET_KEY';
        } else {
          friendlyError = `Akses ke server Wablas ditolak (HTTP 403). Periksa Token API atau Secret Key pada cluster ${serverUrl}.`;
          errCode = 'WABLAS_FORBIDDEN';
        }
      } else if (response.status === 429) {
        friendlyError = `Batas kuota request tercapai (Rate Limit / HTTP 429). Silakan coba lagi beberapa saat.`;
        errCode = 'WABLAS_RATE_LIMITED';
      } else if (response.status === 301 || response.status === 302) {
        friendlyError = `Permintaan dialihkan ke halaman web oleh server Wablas (Redirect HTTP ${response.status}).`;
        errCode = 'WABLAS_REDIRECT';
      } else if (response.status >= 500) {
        friendlyError = `Server Wablas (${serverUrl}) mengembalikan halaman error (HTTP ${response.status}). Layanan Wablas kemungkinan sedang mengalami pemeliharaan.`;
        errCode = 'WABLAS_SERVER_ERROR';
      } else {
        friendlyError = `Server Wablas mengembalikan respon HTML bukannya JSON (HTTP ${response.status}).`;
        errCode = 'WABLAS_NON_JSON_RESPONSE';
      }

      return {
        success: false,
        message: friendlyError,
        errorCode: errCode,
        statusCode: response.status,
      };
    }

    // KASUS 2: Respons JSON Berhasil
    const responseData = parsed.jsonData;
    const isSuccess =
      response.ok &&
      (responseData.status === true ||
        responseData.status === 'success' ||
        (responseData.data && Array.isArray(responseData.data.messages)));

    if (isSuccess) {
      return {
        success: true,
        message: `Pesan uji coba WhatsApp berhasil dikirim ke nomor ${cleanPhone}.`,
        data: responseData,
        statusCode: response.status,
      };
    }

    // KASUS 3: Respons JSON dengan Status Gagal dari Wablas (HTTP 401, 403, 429, 500, dll)
    let serverMessage = responseData?.message || responseData?.status || `Gagal mengirim pesan (HTTP ${response.status}).`;
    const lowerMsg = String(serverMessage).toLowerCase();
    let errCode = `HTTP_${response.status}`;

    if (lowerMsg.includes('not authorized') || lowerMsg.includes('whitelist') || lowerMsg.includes('secret key') || response.status === 403) {
      if (!hasSecretKey) {
        serverMessage = `Akses pengiriman ditolak Wablas: Akun Wablas mewajibkan Secret Key untuk pengiriman pesan dari lingkungan cloud (IP dinamis). Silakan masukkan Secret Key pada kolom 'Secret Key Wablas' (dapat diperoleh di dashboard Wablas: menu Device > Setting).`;
        errCode = 'WABLAS_NEED_SECRET_KEY';
      } else {
        serverMessage = `Akses pengiriman ditolak Wablas: Secret Key atau Token tidak cocok di dashboard Wablas (${serverUrl}). Silakan periksa kembali Secret Key pada menu Device > Setting.`;
        errCode = 'WABLAS_AUTH_DENIED';
      }
    } else if (lowerMsg.includes('quota') || lowerMsg.includes('kuota') || lowerMsg.includes('limit')) {
      serverMessage = `Gagal mengirim pesan: Sisa kuota pesan WhatsApp di akun Wablas tidak mencukupi atau telah habis. (Respon Wablas: ${responseData?.message || serverMessage})`;
      errCode = 'WABLAS_QUOTA_EXHAUSTED';
    } else if (lowerMsg.includes('token') && (lowerMsg.includes('invalid') || lowerMsg.includes('null') || lowerMsg.includes('salah'))) {
      serverMessage = `Token API Wablas tidak valid pada cluster ini. (Respon Wablas: ${responseData?.message || serverMessage})`;
      errCode = 'WABLAS_INVALID_TOKEN';
    } else if (lowerMsg.includes('disconnect') || lowerMsg.includes('offline')) {
      serverMessage = `Perangkat WhatsApp di server Wablas sedang offline/terputus. Silakan hubungkan ulang perangkat pada dashboard Wablas.`;
      errCode = 'WABLAS_DEVICE_DISCONNECTED';
    } else if (response.status === 429) {
      serverMessage = `Batas pengiriman pesan terlampaui (Rate Limit HTTP 429). ${responseData?.message ? `(${responseData.message})` : ''}`;
      errCode = 'WABLAS_RATE_LIMITED';
    } else if (response.status >= 500) {
      serverMessage = `Server Wablas mengalami kendala internal (HTTP ${response.status}). ${responseData?.message ? `(${responseData.message})` : ''}`;
      errCode = 'WABLAS_INTERNAL_ERROR';
    } else {
      if (responseData?.message && typeof responseData.message === 'string') {
        serverMessage = `Wablas (HTTP ${response.status}): ${responseData.message}`;
      }
    }

    return {
      success: false,
      message: serverMessage,
      errorCode: errCode,
      data: responseData,
      statusCode: response.status,
    };
  } catch (error: any) {
    clearTimeout(timeoutId);

    if (error.name === 'AbortError') {
      return {
        success: false,
        errorCode: 'TIMEOUT',
        statusCode: 408,
        message: 'Pengiriman pesan melebihi batas waktu (Timeout 15 detik).',
      };
    }

    const netCode = error?.cause?.code || error?.code;
    const netMsg =
      netCode === 'ENOTFOUND'
        ? 'Domain server Wablas tidak dapat dijangkau (DNS host tidak ditemukan).'
        : netCode === 'ECONNREFUSED'
        ? 'Koneksi ditolak oleh server Wablas.'
        : 'Jaringan ke server Wablas tidak dapat dijangkau.';

    return {
      success: false,
      errorCode: 'NETWORK_ERROR',
      statusCode: 503,
      message: `Gagal menghubungi server Wablas: ${netMsg}`,
    };
  }
}

