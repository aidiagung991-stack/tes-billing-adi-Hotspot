/**
 * Utilitas format mata uang dan tanggal bahasa Indonesia
 */

export function formatRupiah(amount: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatDateIndo(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return new Intl.DateTimeFormat('id-ID', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(d);
  } catch {
    return dateStr;
  }
}

export function getCustomerStatusBadge(status: 'active' | 'isolated' | 'inactive') {
  switch (status) {
    case 'active':
      return {
        label: 'Aktif',
        bg: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800',
        dot: 'bg-emerald-500',
      };
    case 'isolated':
      return {
        label: 'Terisolir',
        bg: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800',
        dot: 'bg-amber-500',
      };
    case 'inactive':
      return {
        label: 'Nonaktif',
        bg: 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700',
        dot: 'bg-slate-400',
      };
  }
}

export function getInvoiceStatusBadge(status: 'paid' | 'unpaid' | 'overdue') {
  switch (status) {
    case 'paid':
      return {
        label: 'Lunas',
        bg: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800',
        dot: 'bg-emerald-500',
      };
    case 'unpaid':
      return {
        label: 'Belum Dibayar',
        bg: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800',
        dot: 'bg-amber-500',
      };
    case 'overdue':
      return {
        label: 'Terlambat',
        bg: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800',
        dot: 'bg-rose-500',
      };
  }
}

export function getPaymentMethodBadge(method: 'cash' | 'transfer' | 'qris') {
  switch (method) {
    case 'cash':
      return {
        label: 'Tunai (Kasir)',
        bg: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800',
      };
    case 'transfer':
      return {
        label: 'Transfer Bank',
        bg: 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-300 dark:border-indigo-800',
      };
    case 'qris':
      return {
        label: 'QRIS',
        bg: 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-800',
      };
  }
}

/**
 * Otomatis membuat ID Pelanggan unik dengan format ADI-XXXX
 */
export function generateUniqueCustomerId(existingCustomers: { id: string }[]): string {
  let maxSeq = 100;
  for (const c of existingCustomers) {
    const match = c.id.match(/\d+/g);
    if (match) {
      const num = parseInt(match[match.length - 1], 10);
      if (!isNaN(num) && num > maxSeq) {
        maxSeq = num;
      }
    }
  }
  let nextSeq = maxSeq + 1;
  let candidate = `ADI-${String(nextSeq).padStart(4, '0')}`;
  while (existingCustomers.some((c) => c.id === candidate)) {
    nextSeq++;
    candidate = `ADI-${String(nextSeq).padStart(4, '0')}`;
  }
  return candidate;
}

export function getPackageStatusBadge(status: 'active' | 'inactive') {
  switch (status) {
    case 'active':
      return {
        label: 'Aktif',
        bg: 'bg-emerald-50 text-emerald-700 border-emerald-200',
        dot: 'bg-emerald-500',
      };
    case 'inactive':
      return {
        label: 'Nonaktif',
        bg: 'bg-slate-100 text-slate-600 border-slate-200',
        dot: 'bg-slate-400',
      };
  }
}

export function getPackageConnectionBadge(conn: 'pppoe' | 'hotspot' | 'both') {
  switch (conn) {
    case 'pppoe':
      return {
        label: 'PPPoE',
        bg: 'bg-indigo-50 text-indigo-700 border-indigo-200',
      };
    case 'hotspot':
      return {
        label: 'Hotspot',
        bg: 'bg-purple-50 text-purple-700 border-purple-200',
      };
    case 'both':
      return {
        label: 'PPPoE & Hotspot',
        bg: 'bg-blue-50 text-blue-700 border-blue-200',
      };
  }
}

