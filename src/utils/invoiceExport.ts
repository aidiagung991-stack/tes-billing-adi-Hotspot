import ExcelJS from 'exceljs';
import { Invoice, Customer } from '../types/index.ts';

export interface InvoiceExportOptions {
  periodFilter?: string; // 'all' or specific e.g. 'Oktober 2026'
  statusFilter?: string; // 'all', 'paid', 'unpaid', 'overdue'
  customerFilter?: string; // 'all' or customerId
}

export function filterInvoicesForExport(
  invoices: Invoice[],
  options: InvoiceExportOptions
): Invoice[] {
  return invoices.filter((inv) => {
    if (options.customerFilter && options.customerFilter !== 'all') {
      if (inv.customerId !== options.customerFilter) return false;
    }
    if (options.periodFilter && options.periodFilter !== 'all') {
      if (inv.monthPeriod.toLowerCase() !== options.periodFilter.toLowerCase()) return false;
    }
    if (options.statusFilter && options.statusFilter !== 'all') {
      if (inv.status !== options.statusFilter) return false;
    }
    return true;
  });
}

/**
 * Helper untuk mengunduh file Blob di browser
 */
function triggerBrowserDownload(blob: Blob, fullFileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.setAttribute('download', fullFileName);
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

/**
 * Ekspor data tagihan ke format Excel (.xlsx) atau CSV (.csv) menggunakan ExcelJS.
 * Kompatibel dengan Microsoft Excel dan LibreOffice Calc.
 */
export async function exportInvoices(
  invoicesToExport: Invoice[],
  customers: Customer[],
  format: 'xlsx' | 'csv',
  filenamePrefix: string = 'Data_Tagihan'
): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Adi_Hotspot Billing';
  workbook.lastModifiedBy = 'Adi_Hotspot Billing';
  workbook.created = new Date();
  workbook.modified = new Date();

  const worksheet = workbook.addWorksheet('Data Tagihan');

  // Definisikan 14 kolom eksplisit dengan lebar yang proporsional
  worksheet.columns = [
    { header: 'Nomor Tagihan', key: 'invoiceNumber', width: 20 },
    { header: 'ID Pelanggan', key: 'customerId', width: 16 },
    { header: 'Nama Pelanggan', key: 'customerName', width: 24 },
    { header: 'Nomor WhatsApp', key: 'customerPhone', width: 18 },
    { header: 'Paket Internet', key: 'packageName', width: 22 },
    { header: 'Tipe Koneksi', key: 'connectionType', width: 16 },
    { header: 'Periode Tagihan', key: 'monthPeriod', width: 18 },
    { header: 'Tanggal Dibuat', key: 'createdAt', width: 16 },
    { header: 'Tanggal Jatuh Tempo', key: 'dueDate', width: 20 },
    { header: 'Total Tagihan', key: 'totalAmount', width: 18 },
    { header: 'Jumlah Terbayar', key: 'paidAmount', width: 18 },
    { header: 'Sisa Tagihan', key: 'remainingAmount', width: 18 },
    { header: 'Status Tagihan', key: 'statusLabel', width: 16 },
    { header: 'Tanggal Lunas', key: 'paidAt', width: 20 },
  ];

  // Styling baris header (navy slate elegan, teks putih tebal)
  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1E293B' }, // Slate 800
  };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
  headerRow.height = 24;

  // Isi baris data dengan nilai numerik murni pada kolom keuangan
  invoicesToExport.forEach((inv) => {
    const cust = customers.find((c) => c.id === inv.customerId);
    const connectionType = cust?.type ? cust.type.toUpperCase() : 'PPPoE';
    const customerPhone = inv.customerPhone || cust?.phone || '-';

    const totalAmount = Number(inv.amount) || 0;
    const paidAmount =
      inv.paidAmount !== undefined
        ? Number(inv.paidAmount)
        : inv.status === 'paid'
        ? totalAmount
        : 0;
    const remainingAmount =
      inv.remainingAmount !== undefined
        ? Number(inv.remainingAmount)
        : Math.max(0, totalAmount - paidAmount);

    let statusLabel = 'Belum Lunas';
    if (inv.status === 'paid') statusLabel = 'Lunas';
    else if (inv.status === 'overdue') statusLabel = 'Terlambat';

    worksheet.addRow({
      invoiceNumber: inv.invoiceNumber,
      customerId: inv.customerId,
      customerName: inv.customerName,
      customerPhone,
      packageName: inv.packageName,
      connectionType,
      monthPeriod: inv.monthPeriod,
      createdAt: inv.createdAt || '-',
      dueDate: inv.dueDate,
      totalAmount,
      paidAmount,
      remainingAmount,
      statusLabel,
      paidAt: inv.paidAt || (inv.status === 'paid' ? inv.createdAt : '-'),
    });
  });

  // Terapkan format angka akuntansi/desimal pada kolom nominal (kolom 10, 11, 12)
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber > 1) {
      row.alignment = { vertical: 'middle' };
      row.getCell(10).numFmt = '#,##0'; // Total Tagihan
      row.getCell(11).numFmt = '#,##0'; // Jumlah Terbayar
      row.getCell(12).numFmt = '#,##0'; // Sisa Tagihan
    }
  });

  const cleanPrefix = filenamePrefix.replace(/[/\\?%*:|"<>]/g, '_');
  const extension = format === 'xlsx' ? 'xlsx' : 'csv';
  const fullFileName = `${cleanPrefix}.${extension}`;

  if (format === 'xlsx') {
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    triggerBrowserDownload(blob, fullFileName);
  } else {
    const buffer = await workbook.csv.writeBuffer();
    const blob = new Blob([buffer], {
      type: 'text/csv;charset=utf-8;',
    });
    triggerBrowserDownload(blob, fullFileName);
  }
}
