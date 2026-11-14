import { Invoice, InvoiceStatus } from '../types/index.ts';

export const STORAGE_KEY_INVOICES = 'adi_hotspot_invoices_v1';

/**
 * Memeriksa apakah status tagihan terlambat berdasarkan tanggal jatuh tempo hari ini.
 * Jika status belum lunas dan jatuh tempo sudah lewat, maka status otomatis menjadi 'overdue' (Terlambat).
 */
export function computeInvoiceStatus(inv: { status: InvoiceStatus; dueDate: string }): InvoiceStatus {
  if (inv.status === 'paid') {
    return 'paid';
  }
  const todayStr = new Date().toISOString().split('T')[0];
  if (inv.dueDate && inv.dueDate < todayStr) {
    return 'overdue';
  }
  return 'unpaid';
}

/**
 * Validasi apakah objek data invoice memiliki struktur wajib
 */
export function isValidInvoice(item: any): item is Invoice {
  return (
    item &&
    typeof item === 'object' &&
    typeof item.id === 'string' &&
    item.id.trim().length > 0 &&
    typeof item.invoiceNumber === 'string' &&
    item.invoiceNumber.trim().length > 0 &&
    typeof item.customerId === 'string' &&
    typeof item.customerName === 'string' &&
    typeof item.packageName === 'string' &&
    typeof item.amount === 'number' &&
    !isNaN(item.amount) &&
    item.amount >= 0 &&
    typeof item.monthPeriod === 'string' &&
    typeof item.dueDate === 'string' &&
    (item.status === 'paid' || item.status === 'unpaid' || item.status === 'overdue')
  );
}

/**
 * Normalisasi data invoice dan sinkronisasi status overdue secara otomatis
 */
export function normalizeInvoice(item: any): Invoice {
  const currentStatus: InvoiceStatus =
    item.status === 'paid' ? 'paid' : computeInvoiceStatus({ status: item.status, dueDate: item.dueDate });

  const totalAmount = Number(item.amount) || 0;
  let paid = Number(item.paidAmount);
  if (isNaN(paid)) {
    paid = currentStatus === 'paid' ? totalAmount : 0;
  }
  let remaining = Number(item.remainingAmount);
  if (isNaN(remaining)) {
    remaining = currentStatus === 'paid' ? 0 : Math.max(0, totalAmount - paid);
  }

  return {
    id: item.id || `inv-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    invoiceNumber: item.invoiceNumber,
    customerId: item.customerId,
    customerName: item.customerName,
    customerPhone: item.customerPhone || '',
    packageName: item.packageName,
    amount: totalAmount,
    paidAmount: paid,
    remainingAmount: remaining,
    monthPeriod: item.monthPeriod,
    dueDate: item.dueDate,
    status: currentStatus,
    createdAt: item.createdAt || new Date().toISOString().split('T')[0],
    paidAt: item.paidAt,
    paymentMethod: item.paymentMethod,
  };
}

/**
 * Fungsi legacy membaca data tagihan dari localStorage.
 * DI-NONAKTIFKAN: PostgreSQL adalah satu-satunya sumber data operasional utama.
 * Mengembalikan array kosong [] dan tidak memuat data mock / contoh.
 */
export function loadInvoicesFromStorage(): Invoice[] {
  return [];
}

/**
 * Fungsi legacy menyimpan data tagihan ke localStorage.
 * DI-NONAKTIFKAN: Data operasional tidak disimpan ke localStorage.
 */
export function saveInvoicesToStorage(_invoices: Invoice[]): boolean {
  return false;
}

/**
 * Membuat nomor invoice otomatis dan unik dengan format INV/YYYY/MM/XXX
 */
export function generateUniqueInvoiceNumber(existingInvoices: Invoice[], targetDate?: string): string {
  const d = targetDate ? new Date(targetDate) : new Date();
  const year = d.getFullYear() || new Date().getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const prefix = `INV/${year}/${month}/`;

  let maxNum = 0;
  for (const inv of existingInvoices) {
    if (inv.invoiceNumber && inv.invoiceNumber.startsWith(prefix)) {
      const parts = inv.invoiceNumber.split('/');
      const numPart = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(numPart) && numPart > maxNum) {
        maxNum = numPart;
      }
    } else if (inv.invoiceNumber) {
      // Fallback check generic number pattern
      const match = inv.invoiceNumber.match(/\d+$/);
      if (match) {
        const n = parseInt(match[0], 10);
        if (!isNaN(n) && n > maxNum && n < 10000) {
          maxNum = n;
        }
      }
    }
  }

  let nextSeq = maxNum + 1;
  let candidate = `${prefix}${String(nextSeq).padStart(3, '0')}`;

  while (existingInvoices.some((i) => i.invoiceNumber && i.invoiceNumber.toUpperCase() === candidate.toUpperCase())) {
    nextSeq++;
    candidate = `${prefix}${String(nextSeq).padStart(3, '0')}`;
  }

  return candidate;
}

/**
 * Memeriksa apakah tagihan untuk pelanggan tertentu pada periode tertentu sudah ada.
 * Mencegah pembuatan tagihan ganda.
 */
export function checkDuplicateInvoice(
  existingInvoices: Invoice[],
  customerId: string,
  monthPeriod: string,
  excludeInvoiceId?: string
): boolean {
  const cleanPeriod = monthPeriod.trim().toLowerCase();
  return existingInvoices.some(
    (inv) =>
      inv.customerId === customerId &&
      inv.monthPeriod.trim().toLowerCase() === cleanPeriod &&
      (!excludeInvoiceId || inv.id !== excludeInvoiceId)
  );
}
