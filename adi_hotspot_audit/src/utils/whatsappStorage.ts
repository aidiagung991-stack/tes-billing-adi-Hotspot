import {
  WhatsAppGatewayConfig,
  NotificationTemplate,
  NotificationScheduleConfig,
  Customer,
  Invoice,
  Payment,
} from '../types/index.ts';
import { formatRupiah, formatDateIndo } from './formatters.ts';

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
