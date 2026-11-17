import {
  Customer,
  InternetPackage,
  Invoice,
  Payment,
  BusinessSettings,
  NotificationTemplate,
  NotificationScheduleConfig,
  WhatsAppMessageLog,
  BroadcastCampaign,
  RouterConfig,
} from '../types/index.ts';

export interface DbStatusResponse {
  success: boolean;
  isConnected: boolean;
  host: string;
  port: number;
  database: string;
  user: string;
  latencyMs?: number;
  message: string;
  error?: string;
}

export interface AuthSessionStatus {
  authenticated: boolean;
  authConfigured: boolean;
  username: string | null;
  expiresAt?: number;
}

// Disimpan hanya di memori JS (TIDAK pernah di localStorage atau sessionStorage)
let inMemoryCsrfToken: string | null = null;
let unauthorizedHandler: (() => void) | null = null;

export function setCsrfToken(token: string | null): void {
  inMemoryCsrfToken = token && token.trim() ? token.trim() : null;
}

export function getCsrfToken(): string | null {
  return inMemoryCsrfToken;
}

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

const MUTATING_HTTP_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Wrapper fetch terpusat dengan cookie same-origin, header X-CSRF-Token,
 * dan penanganan otomatis HTTP 401 session kedaluwarsa.
 */
export async function apiFetch(url: string, options?: RequestInit): Promise<Response> {
  const method = (options?.method || 'GET').toUpperCase();
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(options?.headers as Record<string, string> | undefined),
  };

  if (options?.body !== undefined && !headers['Content-Type'] && !headers['content-type']) {
    headers['Content-Type'] = 'application/json';
  }

  if (MUTATING_HTTP_METHODS.has(method)) {
    headers['X-Requested-With'] = 'AdiHotspotClient';
    if (inMemoryCsrfToken) {
      headers['X-CSRF-Token'] = inMemoryCsrfToken;
    }
  }

  const res = await fetch(url, {
    ...options,
    method,
    credentials: 'same-origin',
    headers,
  });

  if (res.status === 401 && !url.startsWith('/api/auth/login') && !url.startsWith('/api/auth/session')) {
    inMemoryCsrfToken = null;
    if (unauthorizedHandler) {
      unauthorizedHandler();
    }
  }

  return res;
}

/**
 * Helper untuk parsing response fetch secara aman
 */
async function fetchJsonSafely<T>(url: string, options?: RequestInit): Promise<{ success: boolean; data?: T; message?: string; statusCode?: number }> {
  try {
    const res = await apiFetch(url, options);

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      return { success: false, statusCode: res.status, message: `Server mengembalikan non-JSON (HTTP ${res.status})` };
    }

    const json = await res.json();
    return { ...json, statusCode: res.status };
  } catch (err: any) {
    return { success: false, message: err?.message || 'Network error' };
  }
}

// ============================================================================
// 0. ADMIN AUTHENTICATION & SESSION API
// ============================================================================
export async function checkAuthSession(): Promise<AuthSessionStatus> {
  try {
    const res = await apiFetch('/api/auth/session', { method: 'GET' });
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      setCsrfToken(null);
      return { authenticated: false, authConfigured: true, username: null };
    }
    const json = await res.json();
    if (json && json.authenticated === true && typeof json.csrfToken === 'string') {
      setCsrfToken(json.csrfToken);
      return {
        authenticated: true,
        authConfigured: json.authConfigured !== false,
        username: typeof json.username === 'string' ? json.username : null,
        expiresAt: typeof json.expiresAt === 'number' ? json.expiresAt : undefined,
      };
    }
    setCsrfToken(null);
    return {
      authenticated: false,
      authConfigured: json?.authConfigured !== false,
      username: null,
    };
  } catch {
    setCsrfToken(null);
    return { authenticated: false, authConfigured: true, username: null };
  }
}

export async function loginAdminApi(
  username: string,
  password: string
): Promise<{ success: boolean; authenticated?: boolean; username?: string; message?: string; statusCode?: number }> {
  const res = await fetchJsonSafely<{ authenticated?: boolean; username?: string; csrfToken?: string }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });

  const anyRes = res as any;
  if (res.success && anyRes.authenticated === true && typeof anyRes.csrfToken === 'string') {
    setCsrfToken(anyRes.csrfToken);
    return {
      success: true,
      authenticated: true,
      username: anyRes.username,
      statusCode: res.statusCode,
    };
  }

  setCsrfToken(null);
  return {
    success: false,
    authenticated: false,
    message: res.message || 'Username atau password tidak valid.',
    statusCode: res.statusCode,
  };
}

export async function logoutAdminApi(): Promise<{ success: boolean; message?: string }> {
  const res = await fetchJsonSafely('/api/auth/logout', {
    method: 'POST',
    body: JSON.stringify({}),
  });
  setCsrfToken(null);
  return {
    success: Boolean(res.success),
    message: res.message,
  };
}

// ============================================================================
// 1. DATABASE HEALTH & STATUS
// ============================================================================
export async function getDatabaseStatus(): Promise<DbStatusResponse | null> {
  const res = await fetchJsonSafely<DbStatusResponse>('/api/status');
  if (res.success && res.data) {
    return res.data;
  }
  return (res as any) || null;
}

// ============================================================================
// 2. PELANGGAN (CUSTOMERS) API
// ============================================================================
export async function fetchCustomersFromApi(): Promise<Customer[] | null> {
  const res = await fetchJsonSafely<Customer[]>('/api/customers');
  if (res.success && Array.isArray(res.data)) {
    return res.data;
  }
  return null;
}

export async function saveCustomerToApi(customer: Customer): Promise<{ success: boolean; message?: string; data?: Customer }> {
  return await fetchJsonSafely<Customer>('/api/customers', {
    method: 'POST',
    body: JSON.stringify(customer),
  });
}

export async function updateCustomerInApi(id: string, customer: Partial<Customer>): Promise<{ success: boolean; message?: string; data?: Customer }> {
  return await fetchJsonSafely<Customer>(`/api/customers/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(customer),
  });
}

export async function updateCustomerStatusInApi(id: string, status: string): Promise<{ success: boolean; message?: string; data?: Customer }> {
  return await fetchJsonSafely<Customer>(`/api/customers/${encodeURIComponent(id)}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export async function deleteCustomerFromApi(id: string): Promise<{ success: boolean; message?: string }> {
  return await fetchJsonSafely(`/api/customers/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export async function syncCustomerToRouterApi(id: string): Promise<{ success: boolean; message: string; data?: Partial<Customer> }> {
  const res = await fetchJsonSafely<Partial<Customer>>(`/api/customers/${encodeURIComponent(id)}/sync-router`, {
    method: 'POST',
  });
  return {
    success: Boolean(res.success),
    message: res.message || (res.success ? 'Sinkronisasi ke router berhasil.' : 'Gagal melakukan sinkronisasi ke router.'),
    data: res.data,
  };
}

// ============================================================================
// 3. PAKET INTERNET (PACKAGES) API
// ============================================================================
export async function fetchPackagesFromApi(): Promise<InternetPackage[] | null> {
  const res = await fetchJsonSafely<InternetPackage[]>('/api/packages');
  if (res.success && Array.isArray(res.data)) {
    return res.data;
  }
  return null;
}

export async function savePackageToApi(pkg: InternetPackage): Promise<{ success: boolean; message?: string; data?: InternetPackage }> {
  return await fetchJsonSafely<InternetPackage>('/api/packages', {
    method: 'POST',
    body: JSON.stringify(pkg),
  });
}

export async function updatePackageInApi(id: string, pkg: Partial<InternetPackage>): Promise<{ success: boolean; message?: string; data?: InternetPackage }> {
  return await fetchJsonSafely<InternetPackage>(`/api/packages/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(pkg),
  });
}

export async function deletePackageFromApi(id: string): Promise<{ success: boolean; message?: string }> {
  return await fetchJsonSafely(`/api/packages/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

// ============================================================================
// 4. TAGIHAN (INVOICES) API
// ============================================================================
export async function fetchInvoicesFromApi(): Promise<Invoice[] | null> {
  const res = await fetchJsonSafely<Invoice[]>('/api/invoices');
  if (res.success && Array.isArray(res.data)) {
    return res.data;
  }
  return null;
}

export async function saveInvoiceToApi(invoice: Invoice): Promise<{ success: boolean; message?: string; data?: Invoice }> {
  return await fetchJsonSafely<Invoice>('/api/invoices', {
    method: 'POST',
    body: JSON.stringify(invoice),
  });
}

export async function updateInvoiceInApi(id: string, invoice: Partial<Invoice>): Promise<{ success: boolean; message?: string; data?: Invoice }> {
  return await fetchJsonSafely<Invoice>(`/api/invoices/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(invoice),
  });
}

export async function deleteInvoiceFromApi(id: string): Promise<{ success: boolean; message?: string }> {
  return await fetchJsonSafely(`/api/invoices/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

// ============================================================================
// 5. PEMBAYARAN (PAYMENTS) API - TRANSAKSI ATOMIK
// ============================================================================
export async function fetchPaymentsFromApi(): Promise<Payment[] | null> {
  const res = await fetchJsonSafely<Payment[]>('/api/payments');
  if (res.success && Array.isArray(res.data)) {
    return res.data;
  }
  return null;
}

export async function recordPaymentViaApi(params: {
  invoiceId: string;
  amount: number;
  method: string;
  notes?: string;
  receiverName?: string;
}): Promise<{ success: boolean; message?: string; payment?: Payment; updatedInvoice?: Invoice }> {
  const res = await fetchJsonSafely<{ payment: Payment; updatedInvoice: Invoice }>('/api/payments', {
    method: 'POST',
    body: JSON.stringify(params),
  });

  if (res.success && res.data && res.data.payment && res.data.updatedInvoice) {
    return {
      success: true,
      payment: res.data.payment,
      updatedInvoice: res.data.updatedInvoice,
      message: res.message,
    };
  }

  return {
    success: false,
    message: res.message || 'Gagal memproses pembayaran di PostgreSQL atau data respon transaksi tidak lengkap.',
  };
}

// ============================================================================
// 6. WHATSAPP TEMPLATES & LOGS API
// ============================================================================
export async function fetchWATemplatesFromApi(): Promise<NotificationTemplate[] | null> {
  const res = await fetchJsonSafely<NotificationTemplate[]>('/api/whatsapp/templates');
  if (res.success && Array.isArray(res.data)) {
    return res.data;
  }
  return null;
}

export async function saveWATemplateToApi(template: NotificationTemplate): Promise<boolean> {
  const res = await fetchJsonSafely('/api/whatsapp/templates', {
    method: 'POST',
    body: JSON.stringify(template),
  });
  return res.success;
}

export async function fetchWALogsFromApi(): Promise<WhatsAppMessageLog[] | null> {
  const res = await fetchJsonSafely<WhatsAppMessageLog[]>('/api/whatsapp/logs');
  if (res.success && Array.isArray(res.data)) {
    return res.data;
  }
  return null;
}

export async function recordWALogToApi(log: WhatsAppMessageLog): Promise<boolean> {
  const res = await fetchJsonSafely('/api/whatsapp/logs', {
    method: 'POST',
    body: JSON.stringify(log),
  });
  return res.success;
}

export async function fetchWAScheduleFromApi(): Promise<NotificationScheduleConfig | null> {
  return await fetchSettingsFromApi('whatsapp_schedule');
}

export async function saveWAScheduleToApi(schedule: NotificationScheduleConfig): Promise<boolean> {
  return await saveSettingsToApi('whatsapp_schedule', schedule);
}

export async function fetchBroadcastHistoryFromApi(): Promise<BroadcastCampaign[] | null> {
  const res = await fetchJsonSafely<BroadcastCampaign[]>('/api/whatsapp/broadcast-history');
  if (res.success && Array.isArray(res.data)) {
    return res.data;
  }
  return null;
}

export async function recordBroadcastHistoryToApi(campaign: BroadcastCampaign): Promise<boolean> {
  const res = await fetchJsonSafely('/api/whatsapp/broadcast-history', {
    method: 'POST',
    body: JSON.stringify(campaign),
  });
  return res.success;
}

// ============================================================================
// 7. PENGATURAN BISNIS (SETTINGS) API
// ============================================================================
export async function fetchSettingsFromApi(key: string): Promise<any | null> {
  const res = await fetchJsonSafely<any>(`/api/settings/${encodeURIComponent(key)}`);
  if (res.success && res.data) {
    return res.data;
  }
  return null;
}

export async function saveSettingsToApi(key: string, value: any): Promise<boolean> {
  const res = await fetchJsonSafely(`/api/settings/${encodeURIComponent(key)}`, {
    method: 'PUT',
    body: JSON.stringify({ value }),
  });
  return res.success;
}

// ============================================================================
// 8. KONFIGURASI MIKROTIK ROUTEROS RB4011
// Kredensial rahasia (password) diamankan di server backend
// ============================================================================
export async function fetchMikrotikConfigFromApi(): Promise<RouterConfig | null> {
  const res = await fetchJsonSafely<RouterConfig>('/api/mikrotik/config');
  if (res.success && res.data) {
    return res.data;
  }
  return null;
}

export async function saveMikrotikConfigToApi(config: Partial<RouterConfig>): Promise<{ success: boolean; message?: string }> {
  const res = await fetchJsonSafely('/api/mikrotik/config', {
    method: 'POST',
    body: JSON.stringify(config),
  });
  return res;
}

export async function testMikrotikConnectionApi(params?: {
  host?: string;
  apiPort?: number;
  username?: string;
  password?: string;
  useSsl?: boolean;
  timeoutSeconds?: number;
}): Promise<{
  success: boolean;
  message: string;
  data?: {
    identity?: string;
    boardName?: string;
    version?: string;
    cpuLoad?: number;
    uptime?: string;
    platform?: string;
    testedAt: string;
  };
  errorDetails?: string;
}> {
  const res = await fetchJsonSafely<{
    identity?: string;
    boardName?: string;
    version?: string;
    cpuLoad?: number;
    uptime?: string;
    platform?: string;
    testedAt: string;
  }>('/api/mikrotik/test-connection', {
    method: 'POST',
    body: JSON.stringify(params || {}),
  });

  return {
    success: res.success,
    message: res.message || (res.success ? 'Koneksi berhasil.' : 'Koneksi gagal.'),
    data: res.data,
  };
}
