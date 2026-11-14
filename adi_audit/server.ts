import express, { Request, Response } from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { testConnection, sendWablasMessage, validateWablasServerUrl, DEFAULT_WABLAS_SERVER_URL } from './src/server/wablasProxy';
import dbRouter from './src/server/dbRoutes';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const HOST = process.env.HOST || '0.0.0.0';

// Hardening dasar untuk aplikasi yang berjalan di jaringan lokal.
app.disable('x-powered-by');
app.use((_req: Request, res: Response, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});
app.use(express.json({ limit: '1mb' }));

// Mount database API endpoints
app.use('/api', dbRouter);

// File persistence for Wablas gateway secrets on the server (never exposed to client)
const CONFIG_FILE = path.resolve(__dirname, '.wablas-config.json');

// In-memory server-side state for Wablas gateway configuration
let wablasServerUrl = DEFAULT_WABLAS_SERVER_URL;
try {
  if (process.env.WABLAS_SERVER_URL) {
    wablasServerUrl = validateWablasServerUrl(process.env.WABLAS_SERVER_URL);
  }
} catch {
  wablasServerUrl = DEFAULT_WABLAS_SERVER_URL;
}

let wablasApiToken = process.env.WABLAS_API_TOKEN && process.env.WABLAS_API_TOKEN !== 'MY_WABLAS_API_TOKEN' ? process.env.WABLAS_API_TOKEN : '';
let wablasSecretKey = process.env.WABLAS_SECRET_KEY && process.env.WABLAS_SECRET_KEY !== 'MY_WABLAS_SECRET_KEY' ? process.env.WABLAS_SECRET_KEY : '';
let wablasSenderPhone = process.env.WABLAS_SENDER_PHONE || '';
let wablasConnectionStatus: 'not_tested' | 'connected' | 'disconnected' = 'not_tested';
let lastTestedAt: string | null = null;
let lastStatusMessage = 'Gateway belum diuji. Masukkan token dan lakukan tes koneksi ke server Wablas.';

// Load saved config from local server file if exists
try {
  if (fs.existsSync(CONFIG_FILE)) {
    // Batasi hak baca file konfigurasi yang berisi token/secret hanya untuk pemilik proses.
    try { fs.chmodSync(CONFIG_FILE, 0o600); } catch { /* best effort */ }
    const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
    const saved = JSON.parse(raw);
    if (saved.wablasServerUrl) {
      try {
        wablasServerUrl = validateWablasServerUrl(saved.wablasServerUrl);
      } catch {
        wablasServerUrl = DEFAULT_WABLAS_SERVER_URL;
      }
    }
    if (saved.wablasApiToken) wablasApiToken = saved.wablasApiToken;
    if (saved.wablasSecretKey) wablasSecretKey = saved.wablasSecretKey;
    if (saved.wablasSenderPhone) wablasSenderPhone = saved.wablasSenderPhone;
    if (saved.wablasConnectionStatus) wablasConnectionStatus = saved.wablasConnectionStatus;
    if (saved.lastTestedAt) lastTestedAt = saved.lastTestedAt;
    if (saved.lastStatusMessage) lastStatusMessage = saved.lastStatusMessage;
  }
} catch (e) {
  // Silent fail
}

function persistConfig() {
  try {
    const data = {
      wablasServerUrl,
      wablasApiToken,
      wablasSecretKey,
      wablasSenderPhone,
      wablasConnectionStatus,
      lastTestedAt,
      lastStatusMessage,
    };
    const tempFile = `${CONFIG_FILE}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), { encoding: 'utf-8', mode: 0o600 });
    fs.renameSync(tempFile, CONFIG_FILE);
    fs.chmodSync(CONFIG_FILE, 0o600);
  } catch (e) {
    // Silent fail
  }
}

/**
 * Endpoint GET: Ambil status konfigurasi Wablas (Token & Secret Key disamarkan/masked demi keamanan)
 */
app.get('/api/whatsapp/config', (_req: Request, res: Response) => {
  const isTokenConfigured = Boolean(wablasApiToken && wablasApiToken.trim().length > 0);
  const maskedToken = isTokenConfigured
    ? `••••••••••••••••${wablasApiToken.slice(-4)}`
    : '';

  const isSecretKeyConfigured = Boolean(wablasSecretKey && wablasSecretKey.trim().length > 0);
  const maskedSecretKey = isSecretKeyConfigured
    ? `••••••••••••••••${wablasSecretKey.slice(-4)}`
    : '';

  res.json({
    provider: 'Wablas',
    serverUrl: wablasServerUrl,
    senderPhone: wablasSenderPhone,
    status: wablasConnectionStatus,
    isTokenConfigured,
    maskedToken,
    isSecretKeyConfigured,
    maskedSecretKey,
    lastTestedAt,
    lastStatusMessage,
  });
});

/**
 * Endpoint POST: Simpan konfigurasi Wablas secara aman di sisi server
 */
app.post('/api/whatsapp/config', (req: Request, res: Response) => {
  try {
    const { serverUrl, senderPhone, token, secretKey } = req.body;

    if (serverUrl !== undefined) {
      if (typeof serverUrl !== 'string' || !serverUrl.trim()) {
        return res.status(400).json({
          success: false,
          message: 'Alamat server Wablas tidak boleh kosong.',
        });
      }
      try {
        wablasServerUrl = validateWablasServerUrl(serverUrl);
      } catch (validationErr: any) {
        return res.status(400).json({
          success: false,
          message: validationErr?.message || 'Alamat server Wablas tidak diizinkan.',
        });
      }
    }
    if (typeof senderPhone === 'string') {
      wablasSenderPhone = senderPhone.trim();
    }

    // Pertahankan token lama jika tidak ada token baru atau hanya token masking yang dikirim
    if (token && typeof token === 'string' && token.trim() && !token.includes('••••')) {
      wablasApiToken = token.trim();
      wablasConnectionStatus = 'not_tested';
      lastStatusMessage = 'Kredensial baru disimpan di server backend. Silakan lakukan tes koneksi.';
    }

    // Pertahankan secret key lama jika tidak ada nilai baru atau hanya nilai masking yang dikirim
    if (secretKey && typeof secretKey === 'string' && secretKey.trim() && !secretKey.includes('••••')) {
      wablasSecretKey = secretKey.trim();
      wablasConnectionStatus = 'not_tested';
      lastStatusMessage = 'Kredensial baru disimpan di server backend. Silakan lakukan tes koneksi.';
    }

    const isTokenConfigured = Boolean(wablasApiToken && wablasApiToken.trim().length > 0);
    const maskedToken = isTokenConfigured
      ? `••••••••••••••••${wablasApiToken.slice(-4)}`
      : '';

    const isSecretKeyConfigured = Boolean(wablasSecretKey && wablasSecretKey.trim().length > 0);
    const maskedSecretKey = isSecretKeyConfigured
      ? `••••••••••••••••${wablasSecretKey.slice(-4)}`
      : '';

    persistConfig();

    res.json({
      success: true,
      message: 'Pengaturan WhatsApp Gateway berhasil disimpan di server backend.',
      config: {
        provider: 'Wablas',
        serverUrl: wablasServerUrl,
        senderPhone: wablasSenderPhone,
        status: wablasConnectionStatus,
        isTokenConfigured,
        maskedToken,
        isSecretKeyConfigured,
        maskedSecretKey,
        lastTestedAt,
        lastStatusMessage,
      },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: 'Gagal menyimpan konfigurasi: ' + (error?.message || 'Internal server error'),
    });
  }
});

/**
 * Endpoint POST: Tes koneksi ke API resmi Wablas (GET /api/device/info)
 * Menggunakan modul proxy server-side src/server/wablasProxy.ts dengan Authorization header
 */
app.post('/api/whatsapp/test-connection', async (req: Request, res: Response) => {
  try {
    let serverUrlToTest = wablasServerUrl;
    if (req.body?.serverUrl) {
      if (typeof req.body.serverUrl !== 'string' || !req.body.serverUrl.trim()) {
        return res.status(400).json({
          success: false,
          status: 'disconnected',
          statusCode: 400,
          message: 'Alamat server Wablas tidak boleh kosong.',
        });
      }
      try {
        serverUrlToTest = validateWablasServerUrl(req.body.serverUrl);
      } catch (validationErr: any) {
        return res.status(400).json({
          success: false,
          status: 'disconnected',
          statusCode: 400,
          message: validationErr?.message || 'Alamat server Wablas tidak diizinkan.',
        });
      }
    }

    const tokenToUse =
      req.body?.token && !req.body.token.includes('••••')
        ? req.body.token.trim()
        : wablasApiToken || process.env.WABLAS_API_TOKEN;

    const secretKeyToUse =
      req.body?.secretKey && !req.body.secretKey.includes('••••')
        ? req.body.secretKey.trim()
        : wablasSecretKey || process.env.WABLAS_SECRET_KEY;

    const result = await testConnection({
      serverUrl: serverUrlToTest,
      token: tokenToUse,
      secretKey: secretKeyToUse,
    });

    // Perbarui status dan log waktu server
    wablasConnectionStatus = result.status;
    lastTestedAt = new Date().toISOString().replace('T', ' ').slice(0, 16);
    lastStatusMessage = result.message;

    if (result.phone) {
      wablasSenderPhone = result.phone;
    }

    persistConfig();

    return res.json(result);
  } catch (error: any) {
    wablasConnectionStatus = 'disconnected';
    lastTestedAt = new Date().toISOString().replace('T', ' ').slice(0, 16);
    lastStatusMessage = 'Kesalahan internal saat pengujian: ' + (error?.message || 'Unknown error');

    return res.json({
      success: false,
      status: 'disconnected',
      errorCode: 'INTERNAL_TEST_ERROR',
      statusCode: 500,
      message: lastStatusMessage,
    });
  }
});

/**
 * Handler umum untuk pengiriman pesan WhatsApp via Wablas Proxy
 */
async function handleSendMessage(req: Request, res: Response) {
  try {
    const { targetPhone, messageContent } = req.body;

    if (!targetPhone || !targetPhone.trim()) {
      return res.json({
        success: false,
        errorCode: 'VALIDATION_PHONE_REQUIRED',
        statusCode: 400,
        message: 'Nomor WhatsApp penerima wajib diisi.',
      });
    }

    if (!messageContent || !messageContent.trim()) {
      return res.json({
        success: false,
        errorCode: 'VALIDATION_MESSAGE_REQUIRED',
        statusCode: 400,
        message: 'Isi pesan tidak boleh kosong.',
      });
    }

    const tokenToUse = wablasApiToken || process.env.WABLAS_API_TOKEN;
    if (!tokenToUse || tokenToUse === 'MY_WABLAS_API_TOKEN') {
      return res.json({
        success: false,
        errorCode: 'AUTH_TOKEN_NOT_CONFIGURED',
        statusCode: 400,
        message: 'Token API Wablas belum dikonfigurasi. Harap simpan token terlebih dahulu di Pengaturan Gateway.',
      });
    }

    const secretKeyToUse = wablasSecretKey || process.env.WABLAS_SECRET_KEY;

    const result = await sendWablasMessage({
      targetPhone,
      messageContent,
      serverUrl: wablasServerUrl,
      token: tokenToUse,
      secretKey: secretKeyToUse,
    });

    // PENTING: Kembalikan respons JSON yang konsisten (HTTP 200) ke frontend
    // agar reverse proxy / Cloud Run edge tidak mencegat dan menggantinya dengan halaman error HTML.
    return res.json({
      success: result.success,
      message: result.message,
      errorCode: result.errorCode || (result.success ? undefined : `HTTP_${result.statusCode || 400}`),
      statusCode: result.statusCode || (result.success ? 200 : 400),
      data: result.data,
    });
  } catch (err: any) {
    return res.json({
      success: false,
      errorCode: 'INTERNAL_SERVER_ERROR',
      statusCode: 500,
      message: 'Kesalahan internal server: ' + (err?.message || 'Unknown error'),
    });
  }
}

/**
 * Endpoint POST: Kirim pesan percobaan melalui API resmi Wablas (POST /api/v2/send-message & /api/send-message)
 */
app.post('/api/whatsapp/send-test', handleSendMessage);

/**
 * Endpoint POST: Alias pengiriman pesan WhatsApp (POST /api/whatsapp/send-message)
 */
app.post('/api/whatsapp/send-message', handleSendMessage);

/**
 * Endpoint POST: Pengiriman pesan broadcast WhatsApp via backend proxy Wablas
 */
app.post('/api/whatsapp/broadcast', handleSendMessage);
app.post('/api/whatsapp/send-broadcast', handleSendMessage);

// Mount Vite or static files
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, HOST, () => {
    console.log(`[Adi_Hotspot] Server berjalan pada http://${HOST}:${PORT}`);
  });
}

startServer();
