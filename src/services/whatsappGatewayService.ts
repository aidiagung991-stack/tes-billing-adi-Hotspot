import { WhatsAppGatewayConfig } from '../types/index.ts';
import { apiFetch } from './apiService.ts';

export interface TestConnectionResponse {
  success: boolean;
  status: 'connected' | 'disconnected';
  message: string;
  data?: any;
}

export interface SendMessageResponse {
  success: boolean;
  message: string;
  errorCode?: string | number;
  statusCode?: number;
  data?: any;
}

/**
 * Helper internal untuk mem-parse respons fetch secara aman (mencegah error Unexpected token '<')
 */
async function parseFetchResponseSafely(res: Response): Promise<{ isJson: boolean; data: any; rawText: string; isHtml: boolean }> {
  const contentType = res.headers.get('content-type') || '';
  const rawText = await res.text();
  const trimmed = rawText.trim();
  const isHtml = trimmed.startsWith('<') || contentType.includes('text/html');

  if (isHtml) {
    return { isJson: false, data: null, rawText: trimmed, isHtml: true };
  }

  if (contentType.includes('application/json') || trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const data = JSON.parse(trimmed);
      return { isJson: true, data, rawText: trimmed, isHtml: false };
    } catch {
      return { isJson: false, data: null, rawText: trimmed, isHtml: false };
    }
  }

  return { isJson: false, data: null, rawText: trimmed, isHtml: false };
}

/**
 * Mengambil konfigurasi status gateway dari backend Express.
 * Catatan: Token rahasia tidak pernah dikirimkan utuh ke frontend (hanya status isTokenConfigured & maskedToken).
 */
export async function getBackendGatewayConfig(): Promise<WhatsAppGatewayConfig | null> {
  try {
    const res = await apiFetch('/api/whatsapp/config', {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const { isJson, data } = await parseFetchResponseSafely(res);
    return isJson ? data : null;
  } catch (err) {
    console.warn('[WhatsApp Service] Endpoint backend belum dapat dijangkau:', err);
    return null;
  }
}

/**
 * Menyimpan konfigurasi gateway ke backend Express secara aman.
 * Token API langsung dikirim ke server untuk disimpan di backend / environment,
 * bukan disimpan di localStorage atau sessionStorage frontend.
 */
export async function saveBackendGatewayConfig(payload: {
  serverUrl: string;
  senderPhone: string;
  token?: string;
  secretKey?: string;
}): Promise<{ success: boolean; message: string; config?: WhatsAppGatewayConfig }> {
  try {
    const res = await apiFetch('/api/whatsapp/config', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const { isJson, data, isHtml } = await parseFetchResponseSafely(res);
    if (isJson && data) {
      return data;
    }

    if (isHtml) {
      return {
        success: false,
        message: `Server backend merespons dengan format HTML (HTTP ${res.status}). Pastikan server backend sedang berjalan.`,
      };
    }

    return {
      success: false,
      message: `Gagal menyimpan konfigurasi (HTTP ${res.status}).`,
    };
  } catch (err: any) {
    return {
      success: false,
      message: 'Gagal menghubungi server backend: ' + (err?.message || 'Koneksi gagal'),
    };
  }
}

/**
 * Menguji koneksi gateway ke server Wablas via proxy backend.
 * Memanggil endpoint resmi Wablas GET /api/device/info dengan Authorization Header.
 */
export async function testBackendGatewayConnection(payload: {
  serverUrl?: string;
  token?: string;
  secretKey?: string;
}): Promise<TestConnectionResponse> {
  try {
    const res = await apiFetch('/api/whatsapp/test-connection', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const { isJson, data, isHtml } = await parseFetchResponseSafely(res);
    if (isJson && data) {
      return data;
    }

    if (isHtml) {
      return {
        success: false,
        status: 'disconnected',
        message: `Server mengembalikan halaman HTML (HTTP ${res.status}). Periksa URL endpoint dan koneksi proxy.`,
      };
    }

    return {
      success: false,
      status: 'disconnected',
      message: `Tes koneksi gagal (HTTP ${res.status}).`,
    };
  } catch (err: any) {
    return {
      success: false,
      status: 'disconnected',
      message:
        'Gagal melakukan pengujian: Backend server tidak merespons (' +
        (err?.message || 'Network error') +
        ')',
    };
  }
}

/**
 * Mengirim pesan percobaan ke nomor tertentu via proxy backend
 */
export async function sendBackendTestMessage(payload: {
  targetPhone: string;
  messageContent: string;
}): Promise<SendMessageResponse> {
  try {
    const res = await apiFetch('/api/whatsapp/send-test', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const { isJson, data, isHtml, rawText } = await parseFetchResponseSafely(res);
    if (isJson && data) {
      return data;
    }

    if (isHtml) {
      return {
        success: false,
        message: `Server mengembalikan format HTML (HTTP ${res.status}). Pastikan rute API backend berjalan normal.`,
      };
    }

    return {
      success: false,
      message: rawText || `Gagal mengirim pesan (HTTP ${res.status}).`,
    };
  } catch (err: any) {
    return {
      success: false,
      message: 'Gagal mengirim pesan: ' + (err?.message || 'Network error'),
    };
  }
}

/**
 * Mengirim pesan broadcast ke nomor tertentu via proxy backend Wablas
 */
export async function sendBackendBroadcastMessage(payload: {
  targetPhone: string;
  messageContent: string;
  customerId?: string;
  customerName?: string;
}): Promise<SendMessageResponse> {
  try {
    const res = await apiFetch('/api/whatsapp/broadcast', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const { isJson, data, isHtml, rawText } = await parseFetchResponseSafely(res);
    if (isJson && data) {
      return data;
    }

    if (isHtml) {
      return {
        success: false,
        message: `Server backend merespons dengan format HTML (HTTP ${res.status}). Pastikan endpoint backend aktif.`,
      };
    }

    return {
      success: false,
      message: rawText || `Gagal mengirim pesan broadcast (HTTP ${res.status}).`,
    };
  } catch (err: any) {
    return {
      success: false,
      message: 'Gagal mengirim pesan broadcast: ' + (err?.message || 'Network error'),
    };
  }
}
