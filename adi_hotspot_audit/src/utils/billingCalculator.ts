import { Customer, InternetPackage, Invoice, BillingSettings } from '../types/index.ts';
import { formatRupiah, formatDateIndo } from './formatters.ts';

export const STORAGE_KEY_BILLING_SETTINGS = 'adi_hotspot_billing_settings_v1';

export const defaultBillingSettings: BillingSettings = {
  billingMethod: 'prorata',
  fixedBillingDay: 1,
  gracePeriodDays: 7,
  prorataFirstInvoice: true,
  inclusiveInstallationDay: true,
  invoiceGenerationDaysAhead: 3,
  updatedAt: '2026-10-31',
};

/**
 * Membaca pengaturan metode penagihan dari localStorage
 */
export function loadBillingSettings(): BillingSettings {
  if (typeof window === 'undefined' || !window.localStorage) {
    return defaultBillingSettings;
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_BILLING_SETTINGS);
    if (!raw) {
      saveBillingSettings(defaultBillingSettings);
      return defaultBillingSettings;
    }
    const parsed = JSON.parse(raw);
    return {
      billingMethod: parsed.billingMethod === 'anniversary' ? 'anniversary' : 'prorata',
      fixedBillingDay: Math.min(28, Math.max(1, Number(parsed.fixedBillingDay) || 1)),
      gracePeriodDays: Math.min(30, Math.max(1, Number(parsed.gracePeriodDays) || 7)),
      prorataFirstInvoice: parsed.prorataFirstInvoice !== false,
      inclusiveInstallationDay: parsed.inclusiveInstallationDay !== false,
      invoiceGenerationDaysAhead: Math.min(30, Math.max(0, Number(parsed.invoiceGenerationDaysAhead) || 3)),
      updatedAt: parsed.updatedAt || new Date().toISOString().split('T')[0],
    };
  } catch {
    return defaultBillingSettings;
  }
}

/**
 * Menyimpan pengaturan metode penagihan ke localStorage
 */
export function saveBillingSettings(settings: BillingSettings): boolean {
  if (typeof window === 'undefined' || !window.localStorage) return false;
  try {
    window.localStorage.setItem(STORAGE_KEY_BILLING_SETTINGS, JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
}

/**
 * Menghitung jumlah hari dalam bulan tertentu (Asia/Jakarta)
 */
export function getDaysInMonth(year: number, month1Indexed: number): number {
  return new Date(year, month1Indexed, 0).getDate();
}

/**
 * Format tanggal YYYY-MM-DD
 */
export function formatDateISO(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Nama bulan dalam Bahasa Indonesia
 */
const INDO_MONTHS = [
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember',
];

export function getIndoMonthName(month0Indexed: number): string {
  return INDO_MONTHS[month0Indexed] || '';
}

/**
 * Hasil kalkulasi simulasi penagihan
 */
export interface BillingCalculationResult {
  method: 'prorata' | 'anniversary';
  isProrata: boolean;
  packagePrice: number;
  calculatedAmount: number;
  monthPeriod: string;
  servicePeriodStart: string;
  servicePeriodEnd: string;
  dueDate: string;
  totalDaysInPeriod: number;
  serviceDays: number;
  formulaDescription: string;
  explanationNote: string;
}

/**
 * Hitung simulasi penagihan dengan METODE 1: PRORATA
 */
export function calculateProrataBilling(params: {
  monthlyFee: number;
  installationDateStr: string; // YYYY-MM-DD
  targetDateStr?: string; // YYYY-MM-DD
  fixedBillingDay: number; // 1-28
  inclusiveInstallationDay: boolean; // apakah tgl pemasangan dihitung
  gracePeriodDays: number; // hari tenggang
  isFirstInvoice?: boolean;
}): BillingCalculationResult {
  const {
    monthlyFee,
    installationDateStr,
    targetDateStr,
    fixedBillingDay,
    inclusiveInstallationDay,
    gracePeriodDays,
    isFirstInvoice = true,
  } = params;

  // Tanggal acuan instalasi
  const installDateParts = installationDateStr.split('-').map(Number);
  const installYear = installDateParts[0] || new Date().getFullYear();
  const installMonth = installDateParts[1] || new Date().getMonth() + 1; // 1-12
  const installDay = installDateParts[2] || new Date().getDate();

  const totalDaysInMonth = getDaysInMonth(installYear, installMonth);

  // Jika bukan tagihan pertama (misal periode bulan berikutnya), tagihan dikenakan penuh
  if (!isFirstInvoice) {
    const periodMonthName = getIndoMonthName(installMonth - 1);
    const periodStr = `${periodMonthName} ${installYear}`;
    const startStr = `${installYear}-${String(installMonth).padStart(2, '0')}-01`;
    const endStr = `${installYear}-${String(installMonth).padStart(2, '0')}-${String(totalDaysInMonth).padStart(2, '0')}`;

    // Jatuh tempo = tanggal tetap + grace period
    const dueDayVal = Math.min(totalDaysInMonth, fixedBillingDay + gracePeriodDays);
    const dueDateStr = `${installYear}-${String(installMonth).padStart(2, '0')}-${String(dueDayVal).padStart(2, '0')}`;

    return {
      method: 'prorata',
      isProrata: false,
      packagePrice: monthlyFee,
      calculatedAmount: monthlyFee,
      monthPeriod: periodStr,
      servicePeriodStart: startStr,
      servicePeriodEnd: endStr,
      dueDate: dueDateStr,
      totalDaysInPeriod: totalDaysInMonth,
      serviceDays: totalDaysInMonth,
      formulaDescription: `Harga paket bulanan penuh (Periode tetap tgl 1 - ${totalDaysInMonth} ${periodMonthName})`,
      explanationNote: `Tagihan reguler penuh untuk periode ${periodStr}. Layanan aktif 1 bulan penuh (${totalDaysInMonth} hari).`,
    };
  }

  // Tagihan pertama: Prorata dari tanggal pemasangan sampai akhir bulan berjalan
  // Hitung jumlah hari layanan
  const startDay = Math.min(installDay, totalDaysInMonth);
  let daysOfService = totalDaysInMonth - startDay;
  if (inclusiveInstallationDay) {
    daysOfService += 1;
  }
  daysOfService = Math.max(1, Math.min(totalDaysInMonth, daysOfService));

  // Rumus: Harga paket bulanan * Jumlah hari layanan / Jumlah hari dalam periode
  const rawProrata = (monthlyFee * daysOfService) / totalDaysInMonth;
  // Dibulatkan ke kelipatan terdekat (misal ratusan atau bulat utuh)
  const calculatedAmount = Math.round(rawProrata);

  const periodMonthName = getIndoMonthName(installMonth - 1);
  const periodStr = `${periodMonthName} ${installYear} (Prorata)`;
  const serviceStartStr = `${installYear}-${String(installMonth).padStart(2, '0')}-${String(startDay).padStart(2, '0')}`;
  const serviceEndStr = `${installYear}-${String(installMonth).padStart(2, '0')}-${String(totalDaysInMonth).padStart(2, '0')}`;

  // Tanggal jatuh tempo tagihan pertama: tanggal pemasangan + gracePeriodDays
  const dueDateObj = new Date(installYear, installMonth - 1, startDay + gracePeriodDays);
  const dueDateStr = formatDateISO(dueDateObj);

  const formulaText = `Rp ${monthlyFee.toLocaleString('id-ID')} × ${daysOfService}/${totalDaysInMonth} hari = Rp ${calculatedAmount.toLocaleString('id-ID')}`;
  const inclusiveText = inclusiveInstallationDay
    ? 'Tanggal pemasangan ikut dihitung (+1 hari)'
    : 'Tanggal pemasangan tidak dihitung';

  const explanation = `Tagihan pertama dihitung secara prorata sejak tanggal pemasangan (${startDay} ${periodMonthName}) hingga akhir periode (${totalDaysInMonth} ${periodMonthName}). Jumlah hari layanan: ${daysOfService} dari total ${totalDaysInMonth} hari (${inclusiveText}).`;

  return {
    method: 'prorata',
    isProrata: true,
    packagePrice: monthlyFee,
    calculatedAmount,
    monthPeriod: periodStr,
    servicePeriodStart: serviceStartStr,
    servicePeriodEnd: serviceEndStr,
    dueDate: dueDateStr,
    totalDaysInPeriod: totalDaysInMonth,
    serviceDays: daysOfService,
    formulaDescription: formulaText,
    explanationNote: explanation,
  };
}

/**
 * Hitung simulasi penagihan dengan METODE 2: SESUAI TANGGAL PEMASANGAN (Anniversary Cycle)
 * Menangani tanggal 29, 30, dan 31 dengan benar ketika bulan berikutnya tidak memiliki tanggal tersebut.
 */
export function calculateAnniversaryBilling(params: {
  monthlyFee: number;
  installationDateStr: string; // YYYY-MM-DD
  cycleMonthOffset?: number; // 0 untuk siklus pertama, 1 untuk siklus kedua, dst
  gracePeriodDays: number;
}): BillingCalculationResult {
  const { monthlyFee, installationDateStr, cycleMonthOffset = 0, gracePeriodDays } = params;

  const parts = installationDateStr.split('-').map(Number);
  const origYear = parts[0] || new Date().getFullYear();
  const origMonth = parts[1] || new Date().getMonth() + 1; // 1-12
  const origDay = parts[2] || new Date().getDate();

  // Hitung bulan siklus awal
  const cycleStartTargetMonth = origMonth + cycleMonthOffset;
  const startYear = origYear + Math.floor((cycleStartTargetMonth - 1) / 12);
  const startMonth = ((cycleStartTargetMonth - 1) % 12) + 1; // 1-12
  const daysInStartMonth = getDaysInMonth(startYear, startMonth);

  // Penanganan tanggal 29, 30, 31 (clamped ke batas akhir bulan bersangkutan jika tidak ada)
  const actualStartDay = Math.min(origDay, daysInStartMonth);

  // Hitung bulan siklus akhir (1 siklus = 1 bulan kemudian minus 1 hari)
  const cycleEndTargetMonth = startMonth + 1;
  const endYear = startYear + Math.floor((cycleEndTargetMonth - 1) / 12);
  const endMonth = ((cycleEndTargetMonth - 1) % 12) + 1;
  const daysInEndMonth = getDaysInMonth(endYear, endMonth);

  // Tanggal akhir periode = 1 hari sebelum tanggal siklus di bulan berikutnya
  let actualEndDay: number;
  if (origDay === 1) {
    // Jika tgl 1, maka akhir adalah akhir bulan yang sama
    actualEndDay = daysInStartMonth;
  } else {
    const targetEndDay = Math.min(origDay - 1, daysInEndMonth);
    actualEndDay = Math.max(1, targetEndDay);
  }

  const startFormatted = `${startYear}-${String(startMonth).padStart(2, '0')}-${String(actualStartDay).padStart(2, '0')}`;
  const endFormatted =
    origDay === 1
      ? `${startYear}-${String(startMonth).padStart(2, '0')}-${String(actualEndDay).padStart(2, '0')}`
      : `${endYear}-${String(endMonth).padStart(2, '0')}-${String(actualEndDay).padStart(2, '0')}`;

  // Hitung jatuh tempo = tanggal awal periode + gracePeriodDays
  const dueDateObj = new Date(startYear, startMonth - 1, actualStartDay + gracePeriodDays);
  const dueDateFormatted = formatDateISO(dueDateObj);

  const startMonthName = getIndoMonthName(startMonth - 1);
  const endMonthName = origDay === 1 ? startMonthName : getIndoMonthName(endMonth - 1);
  const periodLabel = `${actualStartDay} ${startMonthName} - ${actualEndDay} ${endMonthName} ${origDay === 1 ? startYear : endYear}`;

  let clampingNotice = '';
  if (origDay > 28 && actualStartDay !== origDay) {
    clampingNotice = ` (Penyesuaian otomatis: tgl ${origDay} disesuaikan ke tgl ${actualStartDay} karena bulan ${startMonthName} hanya memiliki ${daysInStartMonth} hari).`;
  }

  const explanation = `Siklus tagihan mengikuti tanggal pemasangan pelanggan (${origDay} setiap bulannya). Periode layanan berulang dari ${actualStartDay} ${startMonthName} s/d ${actualEndDay} ${endMonthName}.${clampingNotice} Nominal tagihan tetap penuh sebesar ${formatRupiah(monthlyFee)} per siklus.`;

  return {
    method: 'anniversary',
    isProrata: false,
    packagePrice: monthlyFee,
    calculatedAmount: monthlyFee,
    monthPeriod: periodLabel,
    servicePeriodStart: startFormatted,
    servicePeriodEnd: endFormatted,
    dueDate: dueDateFormatted,
    totalDaysInPeriod: daysInStartMonth,
    serviceDays: daysInStartMonth,
    formulaDescription: `Harga paket bulanan penuh (Siklus ulang tgl ${origDay})`,
    explanationNote: explanation,
  };
}

/**
 * Fungsi cerdas untuk menentukan usulan nominal & tanggal jatuh tempo saat menerbitkan tagihan
 */
export function computeSuggestedInvoice(params: {
  customer: Customer;
  pkg: InternetPackage;
  billingSettings: BillingSettings;
  existingInvoices: Invoice[];
  targetDate?: string;
}): {
  amount: number;
  monthPeriod: string;
  dueDate: string;
  isProrata: boolean;
  servicePeriodStart: string;
  servicePeriodEnd: string;
  prorataDays?: number;
  periodTotalDays?: number;
  serviceDays?: number;
  prorataCalculationNote?: string;
} {
  const { customer, pkg, billingSettings, existingInvoices } = params;

  // Tanggal pemasangan pelanggan (gunakan installationDate atau fallback registeredAt)
  const installDate = customer.installationDate || customer.registeredAt || new Date().toISOString().split('T')[0];

  // Periksa apakah ini tagihan pertama bagi pelanggan tersebut
  const customerInvoices = existingInvoices.filter((inv) => inv.customerId === customer.id);
  const isFirstInvoice = customerInvoices.length === 0;

  if (billingSettings.billingMethod === 'prorata') {
    // Jika metode prorata dan ini tagihan pertama dan opsi prorataFirstInvoice aktif
    if (isFirstInvoice && billingSettings.prorataFirstInvoice) {
      const prorataResult = calculateProrataBilling({
        monthlyFee: pkg.price || customer.monthlyFee,
        installationDateStr: installDate,
        fixedBillingDay: billingSettings.fixedBillingDay,
        inclusiveInstallationDay: billingSettings.inclusiveInstallationDay,
        gracePeriodDays: billingSettings.gracePeriodDays,
        isFirstInvoice: true,
      });

      return {
        amount: prorataResult.calculatedAmount,
        monthPeriod: prorataResult.monthPeriod,
        dueDate: prorataResult.dueDate,
        isProrata: true,
        servicePeriodStart: prorataResult.servicePeriodStart,
        servicePeriodEnd: prorataResult.servicePeriodEnd,
        prorataDays: prorataResult.serviceDays,
        periodTotalDays: prorataResult.totalDaysInPeriod,
        prorataCalculationNote: `${prorataResult.serviceDays}/${prorataResult.totalDaysInPeriod} hari layanan (${prorataResult.formulaDescription})`,
      };
    } else {
      // Periode reguler (Bulan berjalan penuh)
      const now = new Date();
      const currentYear = now.getFullYear();
      const currentMonth = now.getMonth(); // 0-11
      const totalDays = getDaysInMonth(currentYear, currentMonth + 1);
      const periodName = `${getIndoMonthName(currentMonth)} ${currentYear}`;

      const dueDay = Math.min(totalDays, billingSettings.fixedBillingDay + billingSettings.gracePeriodDays);
      const dueDate = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(dueDay).padStart(2, '0')}`;
      const startDate = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-01`;
      const endDate = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(totalDays).padStart(2, '0')}`;

      return {
        amount: pkg.price || customer.monthlyFee,
        monthPeriod: periodName,
        dueDate,
        isProrata: false,
        servicePeriodStart: startDate,
        servicePeriodEnd: endDate,
        periodTotalDays: totalDays,
        serviceDays: totalDays,
      };
    }
  } else {
    // METODE 2: SESUAI TANGGAL PEMASANGAN (Anniversary)
    const anniversaryResult = calculateAnniversaryBilling({
      monthlyFee: pkg.price || customer.monthlyFee,
      installationDateStr: installDate,
      cycleMonthOffset: customerInvoices.length, // siklus ke-N
      gracePeriodDays: billingSettings.gracePeriodDays,
    });

    return {
      amount: anniversaryResult.calculatedAmount,
      monthPeriod: anniversaryResult.monthPeriod,
      dueDate: anniversaryResult.dueDate,
      isProrata: false,
      servicePeriodStart: anniversaryResult.servicePeriodStart,
      servicePeriodEnd: anniversaryResult.servicePeriodEnd,
      periodTotalDays: anniversaryResult.totalDaysInPeriod,
      serviceDays: anniversaryResult.serviceDays,
      prorataCalculationNote: `Siklus berulang tgl ${installDate.split('-')[2] || 1}`,
    };
  }
}
