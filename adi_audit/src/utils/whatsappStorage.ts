import {
  WhatsAppGatewayConfig,
  NotificationTemplate,
  NotificationScheduleConfig,
  WhatsAppMessageLog,
  NotificationTemplateKey,
  Customer,
  Invoice,
  Payment,
} from '../types/index.ts';
import { formatRupiah, formatDateIndo } from './formatters.ts';

export const STORAGE_KEY_WA_CONFIG = 'adi_hotspot_wa_config_v1';
export const STORAGE_KEY_WA_TEMPLATES = 'adi_hotspot_wa_templates_v1';
export const STORAGE_KEY_WA_SCHEDULE = 'adi_hotspot_wa_schedule_v1';
export const STORAGE_KEY_WA_LOGS = 'adi_hotspot_wa_logs_v1';

/**
 * Konfigurasi Awal Gateway WhatsApp Wablas
 * Sesuai ketentuan: Status awal 'not_tested' (Belum Diuji) dan Token API TIDAK disimpan di frontend storage.
 */
export const initialWAGatewayConfig: WhatsAppGatewayConfig = {
  provider: 'Wablas',
  serverUrl: 'https://smg.wablas.com',
  senderPhone: '',
  status: 'not_tested',
  lastStatusMessage: 'Gateway belum diuji. Masukkan token dan lakukan tes koneksi ke server Wablas.',
  isTokenConfigured: false,
  maskedToken: '',
  isSecretKeyConfigured: false,
  maskedSecretKey: '',
};

/**
 * 6 Template Pesan Notifikasi Standar dengan variabel dinamis
 */
export const initialWATemplates: NotificationTemplate[] = [
  {
    id: 'new_invoice',
    name: 'Pemberitahuan Tagihan Baru',
    description: 'Dikirim saat tagihan bulanan baru diterbitkan untuk pelanggan.',
    isEnabled: true,
    templateContent: `Halo {nama_pelanggan} ({id_pelanggan}),
Tagihan internet Anda untuk periode *{periode_tagihan}* telah diterbitkan.

📄 *No. Tagihan:* {nomor_tagihan}
📦 *Paket:* {nama_paket}
💰 *Total Tagihan:* {nominal_tagihan}
📅 *Jatuh Tempo:* {tanggal_jatuh_tempo}

Silakan lakukan pembayaran sebelum batas jatuh tempo melalui loket kasir atau transfer bank. Terima kasih.
- *Adi_Hotspot Billing*`,
    updatedAt: '2026-10-30',
  },
  {
    id: 'due_reminder',
    name: 'Pengingat Sebelum Jatuh Tempo',
    description: 'Dikirim H-3 atau H-1 sebelum tanggal batas akhir pembayaran.',
    isEnabled: true,
    templateContent: `Pemberitahuan Pengingat Tagihan

Halo {nama_pelanggan},
Mengingatkan bahwa tagihan internet paket *{nama_paket}* Anda akan jatuh tempo pada *{tanggal_jatuh_tempo}*.

📄 *No. Tagihan:* {nomor_tagihan}
💵 *Sisa Tagihan:* {sisa_tagihan}

Mohon lakukan pembayaran tepat waktu agar kenyamanan koneksi internet keluarga tetap lancar. Abaikan pesan ini jika Anda sudah melunasi.
- *Adi_Hotspot Billing*`,
    updatedAt: '2026-10-30',
  },
  {
    id: 'overdue_notice',
    name: 'Pemberitahuan Tagihan Terlambat',
    description: 'Dikirim saat tagihan telah melewati tanggal jatuh tempo.',
    isEnabled: true,
    templateContent: `⚠️ *Pemberitahuan: Tagihan Melewati Jatuh Tempo*

Yth. {nama_pelanggan} ({id_pelanggan}),
Tagihan internet no. *{nomor_tagihan}* sebesar *{nominal_tagihan}* telah melewati batas jatuh tempo ({tanggal_jatuh_tempo}).

💵 *Sisa yang belum dibayar:* {sisa_tagihan}

Mohon segera menyelesaikan pelunasan untuk menghindari pemutusan / isolir layanan internet sementara secara otomatis oleh sistem.
- *Adi_Hotspot Billing*`,
    updatedAt: '2026-10-30',
  },
  {
    id: 'isolation_notice',
    name: 'Pemberitahuan Isolir Internet',
    description: 'Dikirim otomatis saat status pelanggan diisolir karena tunggakan.',
    isEnabled: true,
    templateContent: `⛔ *Pemberitahuan Isolir Layanan Internet*

Yth. {nama_pelanggan},
Dengan berat hati kami informasikan bahwa akses internet paket *{nama_paket}* Anda saat ini dinonaktifkan sementara (diisolir) karena terdapat tunggakan tagihan *{nomor_tagihan}* sebesar *{sisa_tagihan}*.

Layanan akan otomatis kami aktifkan kembali segera setelah konfirmasi pelunasan diterima kasir.
Hubungi admin jika memerlukan informasi lebih lanjut: {nomor_wa}.
- *Adi_Hotspot Billing*`,
    updatedAt: '2026-10-30',
  },
  {
    id: 'restoration_notice',
    name: 'Pemberitahuan Internet Aktif Kembali',
    description: 'Dikirim saat status pelanggan diaktifkan kembali setelah pembayaran.',
    isEnabled: true,
    templateContent: `✅ *Layanan Internet Telah Aktif Kembali*

Halo {nama_pelanggan},
Terima kasih! Pembayaran tagihan Anda telah kami verifikasi dengan sukses.

Layanan internet paket *{nama_paket}* Anda saat ini telah diaktifkan kembali normal. Selamat menikmati kembali akses internet cepat bersama kami.
- *Adi_Hotspot Billing*`,
    updatedAt: '2026-10-30',
  },
  {
    id: 'payment_confirmation',
    name: 'Konfirmasi Pembayaran Diterima',
    description: 'Dikirim otomatis saat admin mencatat pelunasan atau cicilan tagihan.',
    isEnabled: true,
    templateContent: `🧾 *Bukti Pembayaran Internet Diterima*

Yth. {nama_pelanggan} ({id_pelanggan}),
Pembayaran tagihan Anda telah berhasil dicatat oleh sistem kasir.

📄 *No. Tagihan:* {nomor_tagihan}
💵 *Jumlah Diterima:* {jumlah_pembayaran}
⚖️ *Sisa Tagihan:* {sisa_tagihan}
📦 *Paket:* {nama_paket}

Struk sah dapat diminta ke admin kasir. Terima kasih atas kerja sama dan kelancaran pembayaran Anda!
- *Adi_Hotspot Billing*`,
    updatedAt: '2026-10-30',
  },
];

/**
 * Konfigurasi Jadwal & Kebijakan Notifikasi Otomatis
 */
export const initialWAScheduleConfig: NotificationScheduleConfig = {
  dueReminderDaysBefore: 3,
  sendTime: '09:00',
  overdueReminderDaysAfter: 1,
  autoSendOnNewInvoice: false, // Aman: tidak langsung spam sebelum koneksi live diuji
  autoSendOnPayment: true,
  autoSendOnIsolation: true,
  autoSendOnRestoration: true,
};

/**
 * Riwayat Pesan Contoh (Sebagai Pratinjau Antarmuka)
 */
export const initialWAMessageLogs: WhatsAppMessageLog[] = [
  {
    id: 'walog-101',
    timestamp: '2026-10-09 19:42',
    customerName: 'Budi Santoso',
    customerId: 'ADI-0101',
    phone: '081298765431',
    notificationType: 'payment_confirmation',
    notificationTypeName: 'Konfirmasi Pembayaran',
    messageContent:
      '🧾 Bukti Pembayaran Internet Diterima\n\nYth. Budi Santoso (ADI-0101),\nPembayaran tagihan Anda telah berhasil dicatat...\nNo. Tagihan: INV/2026/10/003\nJumlah: Rp 165.000\nSisa Tagihan: Rp 0 (Lunas)',
    status: 'sent',
    referenceId: 'INV/2026/10/003',
  },
  {
    id: 'walog-102',
    timestamp: '2026-10-05 09:15',
    customerName: 'Hendra Gunawan',
    customerId: 'ADI-0104',
    phone: '087812903847',
    notificationType: 'due_reminder',
    notificationTypeName: 'Pengingat Jatuh Tempo',
    messageContent:
      'Pemberitahuan Pengingat Tagihan\n\nHalo Hendra Gunawan,\nMengingatkan bahwa tagihan internet paket Home Basic 10M Anda akan jatuh tempo pada 5 Okt 2026...',
    status: 'sent',
    referenceId: 'INV/2026/10/005',
  },
  {
    id: 'walog-103',
    timestamp: '2026-10-06 09:00',
    customerName: 'Hendra Gunawan',
    customerId: 'ADI-0104',
    phone: '087812903847',
    notificationType: 'overdue_notice',
    notificationTypeName: 'Tagihan Terlambat',
    messageContent:
      '⚠️ Pemberitahuan: Tagihan Melewati Jatuh Tempo\n\nYth. Hendra Gunawan (ADI-0104),\nTagihan internet no. INV/2026/10/005 sebesar Rp 100.000 telah melewati batas jatuh tempo...',
    status: 'failed',
    errorMessage:
      'Perangkat pengirim sedang tidak aktif / Belum terhubung ke server Wablas (Simulasi kegagalan)',
    referenceId: 'INV/2026/10/005',
  },
];

/**
 * Load Gateway Config dari localStorage (Tanpa token rahasia)
 */
export function loadWAGatewayConfig(): WhatsAppGatewayConfig {
  if (typeof window === 'undefined' || !window.localStorage) {
    return initialWAGatewayConfig;
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_WA_CONFIG);
    if (!raw) return initialWAGatewayConfig;
    const parsed = JSON.parse(raw);
    let serverUrl = parsed.serverUrl || 'https://smg.wablas.com';
    if (serverUrl.includes('semarang.wablas.com') || !serverUrl) {
      serverUrl = 'https://smg.wablas.com';
    }
    return {
      provider: 'Wablas',
      serverUrl,
      senderPhone: parsed.senderPhone || '',
      status: parsed.status || 'not_tested',
      lastTestedAt: parsed.lastTestedAt,
      lastStatusMessage: parsed.lastStatusMessage || initialWAGatewayConfig.lastStatusMessage,
      isTokenConfigured: Boolean(parsed.isTokenConfigured),
      maskedToken: parsed.isTokenConfigured ? '••••••••••••••••••••••••' : '',
      isSecretKeyConfigured: Boolean(parsed.isSecretKeyConfigured),
      maskedSecretKey: parsed.isSecretKeyConfigured ? '••••••••••••••••••••••••' : '',
    };
  } catch {
    return initialWAGatewayConfig;
  }
}

/**
 * Save Gateway Config ke localStorage (Pastikan token dan secret key rahasia tidak pernah disimpan di sini!)
 */
export function saveWAGatewayConfig(config: WhatsAppGatewayConfig): boolean {
  if (typeof window === 'undefined' || !window.localStorage) return false;
  try {
    let targetUrl = config.serverUrl || 'https://smg.wablas.com';
    if (targetUrl.includes('semarang.wablas.com')) {
      targetUrl = 'https://smg.wablas.com';
    }
    // Sanitasi: Buang token dan secret key mentah agar tidak tersimpan di localStorage
    const safePayload = {
      provider: 'Wablas',
      serverUrl: targetUrl,
      senderPhone: config.senderPhone,
      status: config.status,
      lastTestedAt: config.lastTestedAt,
      lastStatusMessage: config.lastStatusMessage,
      isTokenConfigured: config.isTokenConfigured,
      isSecretKeyConfigured: config.isSecretKeyConfigured,
    };
    window.localStorage.setItem(STORAGE_KEY_WA_CONFIG, JSON.stringify(safePayload));
    return true;
  } catch {
    return false;
  }
}

/**
 * Load Templates dari localStorage
 */
export function loadWATemplates(): NotificationTemplate[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return initialWATemplates;
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_WA_TEMPLATES);
    if (!raw) {
      saveWATemplates(initialWATemplates);
      return initialWATemplates;
    }
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed;
    }
    return initialWATemplates;
  } catch {
    return initialWATemplates;
  }
}

/**
 * Save Templates ke localStorage
 */
export function saveWATemplates(templates: NotificationTemplate[]): boolean {
  if (typeof window === 'undefined' || !window.localStorage) return false;
  try {
    window.localStorage.setItem(STORAGE_KEY_WA_TEMPLATES, JSON.stringify(templates));
    return true;
  } catch {
    return false;
  }
}

/**
 * Load Schedule Config dari localStorage
 */
export function loadWAScheduleConfig(): NotificationScheduleConfig {
  if (typeof window === 'undefined' || !window.localStorage) {
    return initialWAScheduleConfig;
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_WA_SCHEDULE);
    if (!raw) {
      saveWAScheduleConfig(initialWAScheduleConfig);
      return initialWAScheduleConfig;
    }
    const parsed = JSON.parse(raw);
    return {
      dueReminderDaysBefore: Number(parsed.dueReminderDaysBefore) || 3,
      sendTime: parsed.sendTime || '09:00',
      overdueReminderDaysAfter: Number(parsed.overdueReminderDaysAfter) || 1,
      autoSendOnNewInvoice: Boolean(parsed.autoSendOnNewInvoice),
      autoSendOnPayment: Boolean(parsed.autoSendOnPayment),
      autoSendOnIsolation: Boolean(parsed.autoSendOnIsolation),
      autoSendOnRestoration: Boolean(parsed.autoSendOnRestoration),
    };
  } catch {
    return initialWAScheduleConfig;
  }
}

/**
 * Save Schedule Config ke localStorage
 */
export function saveWAScheduleConfig(schedule: NotificationScheduleConfig): boolean {
  if (typeof window === 'undefined' || !window.localStorage) return false;
  try {
    window.localStorage.setItem(STORAGE_KEY_WA_SCHEDULE, JSON.stringify(schedule));
    return true;
  } catch {
    return false;
  }
}

/**
 * Load Message Logs dari localStorage
 */
export function loadWAMessageLogs(): WhatsAppMessageLog[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return initialWAMessageLogs;
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_WA_LOGS);
    if (!raw) {
      saveWAMessageLogs(initialWAMessageLogs);
      return initialWAMessageLogs;
    }
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed;
    }
    return initialWAMessageLogs;
  } catch {
    return initialWAMessageLogs;
  }
}

/**
 * Save Message Logs ke localStorage
 */
export function saveWAMessageLogs(logs: WhatsAppMessageLog[]): boolean {
  if (typeof window === 'undefined' || !window.localStorage) return false;
  try {
    window.localStorage.setItem(STORAGE_KEY_WA_LOGS, JSON.stringify(logs));
    return true;
  } catch {
    return false;
  }
}

/**
 * 12 Variabel Resmi Notifikasi WhatsApp (Sesuai Spesifikasi Persyaratan)
 */
export interface TemplateVariableDef {
  tag: string;
  label: string;
  example: string;
  description: string;
}

export const ALLOWED_TEMPLATE_VARIABLES: TemplateVariableDef[] = [
  { tag: '{nama_pelanggan}', label: 'Nama Pelanggan', example: 'Budi Santoso', description: 'Nama lengkap pelanggan' },
  { tag: '{id_pelanggan}', label: 'ID Pelanggan', example: 'ADI-0101', description: 'Nomor identitas unik pelanggan' },
  { tag: '{nomor_tagihan}', label: 'Nomor Tagihan', example: 'INV/2026/10/001', description: 'Nomor invoice resmi' },
  { tag: '{nama_paket}', label: 'Nama Paket', example: 'Home Family 20M', description: 'Paket langganan internet' },
  { tag: '{nominal_tagihan}', label: 'Nominal Tagihan', example: 'Rp 165.000', description: 'Total jumlah tagihan' },
  { tag: '{jumlah_pembayaran}', label: 'Jumlah Pembayaran', example: 'Rp 165.000', description: 'Nominal uang yang telah disetor' },
  { tag: '{sisa_tagihan}', label: 'Sisa Tagihan', example: 'Rp 0', description: 'Sisa tagihan yang belum dibayar' },
  { tag: '{periode_tagihan}', label: 'Periode Tagihan', example: 'Oktober 2026', description: 'Bulan atau rentang masa layanan' },
  { tag: '{tanggal_jatuh_tempo}', label: 'Tanggal Jatuh Tempo', example: '10 Oktober 2026', description: 'Batas akhir pembayaran tagihan' },
  { tag: '{tanggal_pemasangan}', label: 'Tanggal Pemasangan', example: '15 Oktober 2026', description: 'Tanggal aktivasi pemasangan awal' },
  { tag: '{nomor_wa}', label: 'Nomor WhatsApp Admin', example: '0812-3456-7890', description: 'Nomor kontak WhatsApp pengelola' },
  { tag: '{nama_usaha}', label: 'Nama Usaha', example: 'Adi_Hotspot Billing', description: 'Nama profil bisnis RT/RW Net' },
];

/**
 * Validasi template agar variabel yang tidak dikenal tidak digunakan (Fitur Editor A)
 */
export function validateTemplateVariables(content: string): {
  isValid: boolean;
  invalidVariables: string[];
} {
  const allowedSet = new Set(
    ALLOWED_TEMPLATE_VARIABLES.map((v) => v.tag.toLowerCase().replace(/[{}]/g, ''))
  );

  const foundMatches = content.match(/\{([^}]+)\}/g) || [];
  const invalidVars: string[] = [];

  for (const match of foundMatches) {
    const rawInner = match.slice(1, -1).trim().toLowerCase();
    if (!allowedSet.has(rawInner)) {
      if (!invalidVars.includes(match)) {
        invalidVars.push(match);
      }
    }
  }

  return {
    isValid: invalidVars.length === 0,
    invalidVariables: invalidVars,
  };
}

/**
 * Render teks pesan WhatsApp dengan mengganti seluruh 12 variabel dinamis resmi
 */
export function renderNotificationMessage(
  templateContent: string,
  data: {
    customer?: Partial<Customer>;
    invoice?: Partial<Invoice>;
    payment?: Partial<Payment>;
    contactPhone?: string;
    businessName?: string;
  }
): string {
  const cust = data.customer;
  const inv = data.invoice;
  const pay = data.payment;

  const namaPelanggan = cust?.name || inv?.customerName || 'Pelanggan Terhormat';
  const idPelanggan = cust?.id || inv?.customerId || 'ADI-0000';
  const nomorTagihan = inv?.invoiceNumber || 'INV/2026/10/000';
  const namaPaket = cust?.packageName || inv?.packageName || 'Home Internet';
  const nominalTagihan = inv?.amount !== undefined ? formatRupiah(inv.amount) : 'Rp 0';
  const tanggalJatuhTempo = inv?.dueDate ? formatDateIndo(inv.dueDate) : '10 Okt 2026';
  const jumlahPembayaran = pay?.amount
    ? formatRupiah(pay.amount)
    : formatRupiah(inv?.paidAmount || 0);

  let sisaTagihan = 'Rp 0';
  if (inv) {
    const rem =
      inv.remainingAmount !== undefined
        ? inv.remainingAmount
        : inv.status === 'paid'
        ? 0
        : Math.max(0, (inv.amount || 0) - (inv.paidAmount || 0));
    sisaTagihan = formatRupiah(rem);
  }

  const periodeTagihan = inv?.monthPeriod || 'Oktober 2026';
  const installDateStr = cust?.installationDate || cust?.registeredAt;
  const tanggalPemasangan = installDateStr ? formatDateIndo(installDateStr) : '10 Okt 2025';
  const nomorWa = data.contactPhone || cust?.phone || '0812-3456-7890';
  const namaUsaha = data.businessName || 'Adi_Hotspot Billing';

  return templateContent
    .replace(/\{nama_pelanggan\}/gi, namaPelanggan)
    .replace(/\{id_pelanggan\}/gi, idPelanggan)
    .replace(/\{nomor_tagihan\}/gi, nomorTagihan)
    .replace(/\{nama_paket\}/gi, namaPaket)
    .replace(/\{nominal_tagihan\}/gi, nominalTagihan)
    .replace(/\{tanggal_jatuh_tempo\}/gi, tanggalJatuhTempo)
    .replace(/\{jumlah_pembayaran\}/gi, jumlahPembayaran)
    .replace(/\{sisa_tagihan\}/gi, sisaTagihan)
    .replace(/\{periode_tagihan\}/gi, periodeTagihan)
    .replace(/\{tanggal_pemasangan\}/gi, tanggalPemasangan)
    .replace(/\{nomor_wa\}/gi, nomorWa)
    .replace(/\{nama_usaha\}/gi, namaUsaha);
}
