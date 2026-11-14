import ExcelJS from 'exceljs';
import { Customer, CustomerType, CustomerStatus, InternetPackage } from '../types/index.ts';

export interface CustomerExportOptions {
  statusFilter?: string; // 'all' or specific status
  typeFilter?: string; // 'all' or 'pppoe' / 'hotspot'
  packageFilter?: string; // 'all' or packageId
}

export function filterCustomersForExport(
  customers: Customer[],
  options: CustomerExportOptions
): Customer[] {
  return customers.filter((cust) => {
    if (options.statusFilter && options.statusFilter !== 'all') {
      if (cust.status !== options.statusFilter) return false;
    }
    if (options.typeFilter && options.typeFilter !== 'all') {
      if (cust.type !== options.typeFilter) return false;
    }
    if (options.packageFilter && options.packageFilter !== 'all') {
      if (cust.packageId !== options.packageFilter) return false;
    }
    return true;
  });
}

/**
 * Helper untuk memicu unduhan file Blob di browser
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
 * Ekspor data pelanggan ke file Excel (.xlsx) atau CSV (.csv) menggunakan ExcelJS
 */
export async function exportCustomers(
  customersToExport: Customer[],
  format: 'xlsx' | 'csv',
  filenamePrefix: string = 'Data_Pelanggan'
): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Adi_Hotspot Billing';
  workbook.lastModifiedBy = 'Adi_Hotspot Billing';
  workbook.created = new Date();
  workbook.modified = new Date();

  const worksheet = workbook.addWorksheet('Pelanggan');

  // Definisikan header kolom lengkap dengan auto-width
  const columnsConfig = [
    { header: 'ID Pelanggan', key: 'id', width: 16 },
    { header: 'Nama Pelanggan', key: 'name', width: 24 },
    { header: 'Nomor WhatsApp', key: 'phone', width: 18 },
    { header: 'Alamat KTP / Domisili', key: 'address', width: 30 },
    { header: 'Alamat Pemasangan', key: 'installationAddress', width: 30 },
    { header: 'Paket Internet', key: 'packageName', width: 22 },
    { header: 'Tipe Koneksi', key: 'type', width: 16 },
    { header: 'Username Router', key: 'username', width: 20 },
    { header: 'IP Address', key: 'ipAddress', width: 18 },
    { header: 'Status', key: 'status', width: 14 },
    { header: 'Tanggal Pasang', key: 'installationDate', width: 16 },
    { header: 'Tanggal Jatuh Tempo', key: 'dueDateDay', width: 20 },
    { header: 'Tarif Bulanan', key: 'monthlyFee', width: 18 },
    { header: 'Latitude', key: 'latitude', width: 14 },
    { header: 'Longitude', key: 'longitude', width: 14 },
  ];

  worksheet.columns = columnsConfig;

  // Format header row (warna biru navy elegan, teks tebal)
  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1E293B' }, // Slate 800
  };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
  headerRow.height = 24;

  // Masukkan baris data
  customersToExport.forEach((cust) => {
    let statusLabel = 'Aktif';
    if (cust.status === 'isolated') statusLabel = 'Terisolir';
    else if (cust.status === 'inactive') statusLabel = 'Nonaktif';

    worksheet.addRow({
      id: cust.id,
      name: cust.name,
      phone: cust.phone,
      address: cust.address,
      installationAddress: cust.installationAddress || cust.address,
      packageName: cust.packageName,
      type: cust.type === 'hotspot' ? 'Hotspot' : 'PPPoE',
      username: cust.username,
      ipAddress: cust.ipAddress || '-',
      status: statusLabel,
      installationDate: cust.installationDate || cust.registeredAt,
      dueDateDay: cust.dueDateDay || 10,
      monthlyFee: Number(cust.monthlyFee) || 0,
      latitude: cust.latitude !== undefined && cust.latitude !== null ? Number(cust.latitude) : '',
      longitude: cust.longitude !== undefined && cust.longitude !== null ? Number(cust.longitude) : '',
    });
  });

  // Format border dan number format
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber > 1) {
      row.alignment = { vertical: 'middle' };
      // Format kolom Tarif Bulanan (kolom ke-13)
      const feeCell = row.getCell(13);
      feeCell.numFmt = '#,##0';
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

/**
 * Mengunduh template impor pelanggan dalam format Excel (.xlsx) atau CSV (.csv)
 */
export async function downloadCustomerTemplate(format: 'xlsx' | 'csv'): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Adi_Hotspot Billing';
  const worksheet = workbook.addWorksheet('Template Pelanggan');

  worksheet.columns = [
    { header: 'ID Pelanggan', key: 'id', width: 16 },
    { header: 'Nama Pelanggan', key: 'name', width: 24 },
    { header: 'Nomor WhatsApp', key: 'phone', width: 18 },
    { header: 'Alamat KTP / Domisili', key: 'address', width: 30 },
    { header: 'Alamat Pemasangan', key: 'installationAddress', width: 30 },
    { header: 'Paket Internet', key: 'packageName', width: 22 },
    { header: 'Tipe Koneksi', key: 'type', width: 16 },
    { header: 'Username Router', key: 'username', width: 20 },
    { header: 'IP Address', key: 'ipAddress', width: 18 },
    { header: 'Status', key: 'status', width: 14 },
    { header: 'Tanggal Pasang', key: 'installationDate', width: 16 },
    { header: 'Tanggal Jatuh Tempo', key: 'dueDateDay', width: 20 },
    { header: 'Tarif Bulanan', key: 'monthlyFee', width: 18 },
    { header: 'Latitude', key: 'latitude', width: 14 },
    { header: 'Longitude', key: 'longitude', width: 14 },
  ];

  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF0F766E' }, // Teal 700
  };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
  headerRow.height = 24;

  const sampleData = [
    {
      id: 'ADI-0107',
      name: 'Ahmad Fauzi',
      phone: '081234567890',
      address: 'Jl. Kenanga No. 5 RT 02/04',
      installationAddress: 'Jl. Kenanga No. 5 RT 02/04 (Rumah cat hijau)',
      packageName: 'Home Basic 10M',
      type: 'PPPoE',
      username: 'ahmad_kenanga',
      ipAddress: '192.168.10.107',
      status: 'Aktif',
      installationDate: '2026-01-15',
      dueDateDay: 10,
      monthlyFee: 100000,
      latitude: -6.4825,
      longitude: 106.8535,
    },
    {
      id: 'ADI-0108',
      name: 'Dewi Lestari',
      phone: '085712349988',
      address: 'Gang Mawar No. 12 RT 01/04',
      installationAddress: 'Gang Mawar No. 12 RT 01/04',
      packageName: 'Home Family 20M',
      type: 'PPPoE',
      username: 'dewi_mawar',
      ipAddress: '192.168.10.108',
      status: 'Aktif',
      installationDate: '2026-02-01',
      dueDateDay: 10,
      monthlyFee: 165000,
      latitude: -6.4831,
      longitude: 106.8542,
    },
  ];

  sampleData.forEach((sample) => worksheet.addRow(sample));

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber > 1) {
      row.getCell(13).numFmt = '#,##0';
    }
  });

  const filename = `Template_Import_Pelanggan_Adi_Hotspot.${format}`;

  if (format === 'xlsx') {
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    triggerBrowserDownload(blob, filename);
  } else {
    const buffer = await workbook.csv.writeBuffer();
    const blob = new Blob([buffer], {
      type: 'text/csv;charset=utf-8;',
    });
    triggerBrowserDownload(blob, filename);
  }
}

export interface ParsedCustomerRow {
  rowNumber: number;
  raw: Record<string, any>;
  data: Partial<Customer>;
  isValid: boolean;
  errors: string[];
  isDuplicateId: boolean;
  isDuplicateUsername: boolean;
}

export interface CustomerImportAnalysis {
  totalRows: number;
  validRows: ParsedCustomerRow[];
  invalidRows: ParsedCustomerRow[];
  duplicateIdCount: number;
  duplicateUsernameCount: number;
  canImportCount: number;
}

// Clean phone format: ensure 08... or 628...
export function sanitizePhoneNumber(phone: any): string {
  if (!phone) return '';
  let str = String(phone).replace(/\D/g, '');
  if (str.startsWith('62')) {
    str = '0' + str.slice(2);
  }
  return str;
}

/**
 * Ekstraksi aman nilai sel tanpa mengevaluasi formula sebagai kode.
 * Mencegah prototype pollution dan formula injection.
 */
function extractSafeCellValue(cellValue: any): string {
  if (cellValue === null || cellValue === undefined) {
    return '';
  }

  // Jika berupa object (formula, rich text, hyperlink)
  if (typeof cellValue === 'object') {
    // Jika formula: { formula: '...', result: '...' } -> ambil result saja!
    if ('result' in cellValue) {
      const res = cellValue.result;
      return res !== null && res !== undefined ? String(res).trim() : '';
    }
    // Jika hyperlink: { text: '...', hyperlink: '...' }
    if ('text' in cellValue) {
      return String(cellValue.text || '').trim();
    }
    // Jika rich text array
    if ('richText' in cellValue && Array.isArray(cellValue.richText)) {
      return cellValue.richText.map((item: any) => item.text || '').join('').trim();
    }
    if (cellValue instanceof Date) {
      return cellValue.toISOString().split('T')[0];
    }
    return '';
  }

  return String(cellValue).trim();
}

/**
 * Parser file CSV yang aman untuk browser
 */
function parseCsvSafely(csvText: string): Record<string, any>[] {
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const parseLine = (line: string): string[] => {
    const fields: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if ((ch === ',' || ch === ';') && !inQuotes) {
        fields.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
    fields.push(cur.trim());
    return fields;
  };

  const headers = parseLine(lines[0]);
  const rows: Record<string, any>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseLine(lines[i]);
    const rowObj: Record<string, any> = {};
    headers.forEach((header, idx) => {
      if (header) {
        rowObj[header] = values[idx] ?? '';
      }
    });
    rows.push(rowObj);
  }

  return rows;
}

/**
 * Membaca dan mem-parsing file import pelanggan (.xlsx atau .csv) di browser menggunakan ArrayBuffer
 */
export async function parseCustomerImportFile(
  file: File,
  existingCustomers: Customer[],
  packages: InternetPackage[]
): Promise<CustomerImportAnalysis> {
  const isCsv = file.name.toLowerCase().endsWith('.csv');
  let rawRows: Record<string, any>[] = [];

  if (isCsv) {
    const text = await file.text();
    rawRows = parseCsvSafely(text);
  } else {
    // Impor Excel membaca file di browser menggunakan ArrayBuffer
    const arrayBuffer = await file.arrayBuffer();
    const workbook = new ExcelJS.Workbook();
    
    try {
      await workbook.xlsx.load(arrayBuffer);
    } catch {
      // Jika file ternyata CSV yang salah ekstensi, coba fallback baca sebagai teks
      const textFallback = await file.text();
      rawRows = parseCsvSafely(textFallback);
    }

    if (workbook.worksheets.length > 0) {
      const worksheet = workbook.worksheets[0];
      const headers: string[] = [];

      // Validasi baris 1 sebagai header
      const headerRow = worksheet.getRow(1);
      headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
        const headerName = extractSafeCellValue(cell.value);
        if (headerName) {
          headers[colNumber] = headerName;
        }
      });

      // Validasi dan ekstraksi baris 2 dst
      for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber++) {
        const row = worksheet.getRow(rowNumber);
        if (!row.hasValues) continue;

        const rowObj: Record<string, any> = {};
        let hasAnyData = false;

        headers.forEach((headerName, colNumber) => {
          if (!headerName) return;
          const cell = row.getCell(colNumber);
          const val = extractSafeCellValue(cell.value);
          if (val !== '') hasAnyData = true;
          rowObj[headerName] = val;
        });

        if (hasAnyData) {
          rawRows.push(rowObj);
        }
      }
    }
  }

  const existingIds = new Set(existingCustomers.map((c) => c.id.trim().toUpperCase()));
  const existingUsernames = new Set(existingCustomers.map((c) => c.username.trim().toLowerCase()));

  const parsedRows: ParsedCustomerRow[] = [];

  rawRows.forEach((row, idx) => {
    const rowNum = idx + 2; // baris header adalah baris 1
    const errors: string[] = [];

    // Fleksibilitas pemetaan nama kolom
    const idVal = String(
      row['ID Pelanggan'] || row['ID'] || row['id'] || row['CustomerId'] || ''
    ).trim();
    const nameVal = String(
      row['Nama Pelanggan'] || row['Nama'] || row['Name'] || row['CustomerName'] || ''
    ).trim();
    const phoneVal = sanitizePhoneNumber(
      row['Nomor WhatsApp'] || row['WhatsApp'] || row['No WhatsApp'] || row['No HP'] || row['Phone'] || ''
    );
    const addressVal = String(
      row['Alamat KTP / Domisili'] || row['Alamat'] || row['Address'] || ''
    ).trim();
    const installAddressVal = String(
      row['Alamat Pemasangan'] || row['Alamat Pasang'] || row['InstallationAddress'] || addressVal
    ).trim();
    const packageNameVal = String(
      row['Paket Internet'] || row['Paket'] || row['Package'] || ''
    ).trim();
    const typeValRaw = String(
      row['Tipe Koneksi'] || row['Tipe'] || row['Type'] || 'PPPoE'
    ).trim().toLowerCase();
    const usernameVal = String(
      row['Username Router'] || row['Username'] || row['User'] || ''
    ).trim();
    const ipVal = String(row['IP Address'] || row['IP'] || '').trim();
    const statusValRaw = String(row['Status'] || 'Aktif').trim().toLowerCase();
    const installDateVal = String(
      row['Tanggal Pasang'] || row['Tanggal Terdaftar'] || row['InstallationDate'] || ''
    ).trim();
    const dueDateVal = Number(row['Tanggal Jatuh Tempo'] || row['Jatuh Tempo'] || 10) || 10;
    const feeVal = Number(row['Tarif Bulanan'] || row['Harga'] || row['MonthlyFee'] || 0);

    const latRaw = row['Latitude'] || row['Lat'] || row['lat'];
    const lngRaw = row['Longitude'] || row['Lng'] || row['Long'] || row['long'];
    const latVal = latRaw !== '' && !isNaN(Number(latRaw)) ? Number(latRaw) : undefined;
    const lngVal = lngRaw !== '' && !isNaN(Number(lngRaw)) ? Number(lngRaw) : undefined;

    // Validasi data
    if (!nameVal) {
      errors.push('Nama pelanggan wajib diisi');
    }
    if (!phoneVal || phoneVal.length < 9) {
      errors.push('Nomor WhatsApp tidak valid (minimal 9 digit)');
    }

    // Pencocokan paket internet
    let matchedPkg = packages.find(
      (p) => p.name.toLowerCase() === packageNameVal.toLowerCase() || p.id === packageNameVal
    );
    if (!matchedPkg && packages.length > 0) {
      matchedPkg = packages[0];
    }

    const type: CustomerType = typeValRaw.includes('hotspot') ? 'hotspot' : 'pppoe';

    let status: CustomerStatus = 'active';
    if (statusValRaw.includes('isolir') || statusValRaw.includes('isolated')) {
      status = 'isolated';
    } else if (statusValRaw.includes('non') || statusValRaw.includes('inactive')) {
      status = 'inactive';
    }

    const finalId = idVal || `ADI-${Math.floor(1000 + Math.random() * 9000)}`;
    const finalUsername = usernameVal || `user_${finalId.toLowerCase()}`;
    const finalFee = feeVal > 0 ? feeVal : (matchedPkg ? matchedPkg.price : 100000);

    const isDuplicateId = existingIds.has(finalId.toUpperCase());
    const isDuplicateUsername = existingUsernames.has(finalUsername.toLowerCase());

    const customerObj: Partial<Customer> = {
      id: finalId,
      name: nameVal,
      phone: phoneVal,
      address: addressVal || 'Alamat belum diatur',
      installationAddress: installAddressVal || addressVal || 'Alamat belum diatur',
      packageId: matchedPkg ? matchedPkg.id : 'pkg-1',
      packageName: matchedPkg ? matchedPkg.name : (packageNameVal || 'Home Basic 10M'),
      type,
      username: finalUsername,
      ipAddress: ipVal || undefined,
      status,
      registeredAt: installDateVal || new Date().toISOString().split('T')[0],
      installationDate: installDateVal || new Date().toISOString().split('T')[0],
      dueDateDay: Math.min(Math.max(dueDateVal, 1), 28),
      monthlyFee: finalFee,
      latitude: latVal,
      longitude: lngVal,
    };

    const isValid = errors.length === 0;

    parsedRows.push({
      rowNumber: rowNum,
      raw: row,
      data: customerObj,
      isValid,
      errors,
      isDuplicateId,
      isDuplicateUsername,
    });
  });

  const validRows = parsedRows.filter((r) => r.isValid);
  const invalidRows = parsedRows.filter((r) => !r.isValid);
  const duplicateIdCount = validRows.filter((r) => r.isDuplicateId).length;
  const duplicateUsernameCount = validRows.filter((r) => r.isDuplicateUsername).length;

  return {
    totalRows: parsedRows.length,
    validRows,
    invalidRows,
    duplicateIdCount,
    duplicateUsernameCount,
    canImportCount: validRows.length,
  };
}
