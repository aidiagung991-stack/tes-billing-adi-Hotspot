import {
  Customer,
  InternetPackage,
  Invoice,
  Payment,
  BusinessSettings,
  NotificationTemplate,
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

/**
 * Helper untuk parsing response fetch secara aman
 */
async function fetchJsonSafely<T>(url: string, options?: RequestInit): Promise<{ success: boolean; data?: T; message?: string }> {
  try {
    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(options?.headers || {}),
      },
    });

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      return { success: false, message: `Server mengembalikan non-JSON (HTTP ${res.status})` };
    }

    const json = await res.json();
    return json;
  } catch (err: any) {
    return { success: false, message: err?.message || 'Network error' };
  }
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

