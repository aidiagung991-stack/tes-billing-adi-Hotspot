import { Payment, PaymentMethod } from '../types/index.ts';

export const STORAGE_KEY_PAYMENTS = 'adi_hotspot_payments_v1';

/**
 * Validasi apakah objek pembayaran memiliki struktur wajib
 */
export function isValidPayment(item: any): item is Payment {
  return (
    item &&
    typeof item === 'object' &&
    typeof item.id === 'string' &&
    item.id.trim().length > 0 &&
    typeof item.invoiceId === 'string' &&
    typeof item.invoiceNumber === 'string' &&
    typeof item.customerName === 'string' &&
    typeof item.amount === 'number' &&
    !isNaN(item.amount) &&
    item.amount >= 0 &&
    (item.method === 'cash' || item.method === 'transfer' || item.method === 'qris') &&
    typeof item.paidAt === 'string'
  );
}

/**
 * Normalisasi objek pembayaran agar field selalu lengkap dan aman digunakan
 */
export function normalizePayment(item: any): Payment {
  const trxNum =
    item.transactionNumber ||
    item.receiptNumber ||
    `TRX-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-001`;

  return {
    id: item.id || `pay-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    transactionNumber: trxNum,
    invoiceId: item.invoiceId,
    invoiceNumber: item.invoiceNumber,
    customerId: item.customerId || '',
    customerName: item.customerName,
    amount: Number(item.amount) || 0,
    method: (item.method as PaymentMethod) || 'cash',
    notes: item.notes || '',
    paidAt: item.paidAt || new Date().toISOString().replace('T', ' ').slice(0, 16),
    receiptNumber: item.receiptNumber || trxNum,
    receiverName: item.receiverName || 'Admin Kasir',
    isPartial: Boolean(item.isPartial),
  };
}

/**
 * Fungsi legacy membaca data riwayat pembayaran dari localStorage.
 * DI-NONAKTIFKAN: PostgreSQL adalah satu-satunya sumber data operasional utama.
 * Mengembalikan array kosong [] dan tidak memuat data mock / contoh.
 */
export function loadPaymentsFromStorage(): Payment[] {
  return [];
}

/**
 * Fungsi legacy menyimpan data riwayat pembayaran ke localStorage.
 * DI-NONAKTIFKAN: Data operasional tidak disimpan ke localStorage.
 */
export function savePaymentsToStorage(_payments: Payment[]): boolean {
  return false;
}

/**
 * Membuat nomor transaksi otomatis dan unik dengan format TRX-YYYYMMDD-XXX
 */
export function generateUniqueTransactionNumber(
  existingPayments: Payment[],
  targetDate?: string
): string {
  const d = targetDate ? new Date(targetDate) : new Date();
  const year = d.getFullYear() || new Date().getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const dateStr = `${year}${month}${day}`;
  const prefix = `TRX-${dateStr}-`;

  let maxNum = 0;
  for (const p of existingPayments) {
    const numRef = p.transactionNumber || p.receiptNumber || '';
    if (numRef.startsWith(prefix)) {
      const parts = numRef.split('-');
      const numPart = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(numPart) && numPart > maxNum) {
        maxNum = numPart;
      }
    } else if (numRef) {
      // Fallback: check trailing digits
      const match = numRef.match(/\d+$/);
      if (match) {
        const n = parseInt(match[0], 10);
        if (!isNaN(n) && n > maxNum && n < 1000) {
          maxNum = n;
        }
      }
    }
  }

  let nextSeq = maxNum + 1;
  let candidate = `${prefix}${String(nextSeq).padStart(3, '0')}`;

  while (
    existingPayments.some(
      (p) =>
        (p.transactionNumber && p.transactionNumber.toUpperCase() === candidate.toUpperCase()) ||
        (p.receiptNumber && p.receiptNumber.toUpperCase() === candidate.toUpperCase())
    )
  ) {
    nextSeq++;
    candidate = `${prefix}${String(nextSeq).padStart(3, '0')}`;
  }

  return candidate;
}

/**
 * Menghitung total nominal pembayaran pada hari ini
 */
export function getPaymentsTotalToday(payments: Payment[]): number {
  const todayDateStr = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  return payments
    .filter((p) => p.paidAt && p.paidAt.startsWith(todayDateStr))
    .reduce((sum, p) => sum + p.amount, 0);
}

/**
 * Menghitung total nominal pembayaran pada bulan ini
 */
export function getPaymentsTotalThisMonth(payments: Payment[]): number {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const monthPrefix = `${year}-${month}`; // YYYY-MM

  return payments
    .filter((p) => p.paidAt && p.paidAt.startsWith(monthPrefix))
    .reduce((sum, p) => sum + p.amount, 0);
}
