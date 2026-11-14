import { Customer } from '../types/index.ts';

export const STORAGE_KEY_CUSTOMERS = 'adi_hotspot_customers_v1';

/**
 * Validasi apakah objek data pelanggan memiliki struktur wajib
 */
export function isValidCustomer(item: any): item is Customer {
  return (
    item &&
    typeof item === 'object' &&
    typeof item.id === 'string' &&
    item.id.trim().length > 0 &&
    typeof item.name === 'string' &&
    item.name.trim().length > 0 &&
    typeof item.phone === 'string' &&
    typeof item.packageName === 'string' &&
    (item.type === 'pppoe' || item.type === 'hotspot') &&
    typeof item.username === 'string' &&
    (item.status === 'active' || item.status === 'isolated' || item.status === 'inactive')
  );
}

/**
 * Fungsi legacy untuk membaca data pelanggan dari localStorage.
 * DI-NONAKTIFKAN: PostgreSQL adalah satu-satunya sumber data operasional utama.
 * Mengembalikan array kosong [] dan tidak memuat data mock / contoh.
 */
export function loadCustomersFromStorage(): Customer[] {
  return [];
}

/**
 * Fungsi legacy penyimpanan pelanggan ke localStorage.
 * DI-NONAKTIFKAN: Data operasional tidak disimpan ke localStorage.
 */
export function saveCustomersToStorage(_customers: Customer[]): boolean {
  return false;
}

/**
 * Fungsi pembantu untuk mereset data pelanggan.
 * Mengembalikan array kosong [] sesuai arsitektur data kosong PostgreSQL.
 */
export function resetCustomersStorage(): Customer[] {
  return [];
}
