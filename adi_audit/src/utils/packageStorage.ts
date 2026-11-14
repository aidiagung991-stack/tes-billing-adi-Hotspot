import { InternetPackage, PackageConnectionType, PackageStatus } from '../types/index.ts';

export const STORAGE_KEY_PACKAGES = 'adi_hotspot_packages_v1';

/**
 * Validasi apakah objek data paket internet memiliki struktur wajib
 */
export function isValidPackage(item: any): item is InternetPackage {
  return (
    item &&
    typeof item === 'object' &&
    typeof item.id === 'string' &&
    item.id.trim().length > 0 &&
    typeof item.name === 'string' &&
    item.name.trim().length > 0 &&
    typeof item.speed === 'string' &&
    item.speed.trim().length > 0 &&
    typeof item.price === 'number' &&
    !isNaN(item.price) &&
    item.price >= 0
  );
}

/**
 * Normalisasi data paket agar selalu memiliki field code, supportedConnection, dan status
 */
export function normalizePackage(item: any, index: number = 0): InternetPackage {
  const supportedConnection: PackageConnectionType =
    item.supportedConnection === 'both' ||
    item.supportedConnection === 'pppoe' ||
    item.supportedConnection === 'hotspot'
      ? item.supportedConnection
      : item.type === 'hotspot'
      ? 'hotspot'
      : 'pppoe';

  const status: PackageStatus = item.status === 'inactive' ? 'inactive' : 'active';
  const code: string = item.code || `PKT-${String(index + 1).padStart(2, '0')}`;

  return {
    id: item.id || `pkg-${Date.now()}-${index}`,
    code,
    name: item.name,
    speed: item.speed,
    downloadSpeed: item.downloadSpeed || item.speed,
    uploadSpeed: item.uploadSpeed || '5 Mbps',
    price: Number(item.price) || 0,
    duration: item.duration || '1 Bulan',
    type: item.type || (supportedConnection === 'hotspot' ? 'hotspot' : 'pppoe'),
    supportedConnection,
    status,
    activeUsersCount: typeof item.activeUsersCount === 'number' ? item.activeUsersCount : 0,
    description: item.description || `Paket internet ${item.speed}`,
  };
}

/**
 * Fungsi legacy membaca paket dari localStorage.
 * DI-NONAKTIFKAN: PostgreSQL adalah satu-satunya sumber data operasional utama.
 * Mengembalikan array kosong [] dan tidak memuat data mock / contoh.
 */
export function loadPackagesFromStorage(): InternetPackage[] {
  return [];
}

/**
 * Fungsi legacy penyimpanan paket ke localStorage.
 * DI-NONAKTIFKAN: Data operasional tidak disimpan ke localStorage.
 */
export function savePackagesToStorage(_packages: InternetPackage[]): boolean {
  return false;
}

/**
 * Menghasilkan saran kode paket unik baru (contoh: PKT-07 atau berdasarkan nama/kecepatan)
 */
export function generateUniquePackageCode(
  name: string,
  existingPackages: InternetPackage[]
): string {
  // Coba ambil angka kecepatan jika ada di nama (misal "50M" atau "10 Mbps")
  const speedMatch = name.match(/(\d+)\s*(mbps|m)?/i);
  let baseCode = '';

  if (speedMatch) {
    baseCode = `PKT-${speedMatch[1]}M`;
  } else {
    baseCode = `PKT-${String(existingPackages.length + 1).padStart(2, '0')}`;
  }

  // Jika sudah ada yang memakai kode ini, tambahkan counter
  let candidate = baseCode.toUpperCase();
  let counter = 1;

  while (existingPackages.some((p) => p.code && p.code.toUpperCase() === candidate)) {
    counter++;
    candidate = `${baseCode}-${counter}`.toUpperCase();
  }

  return candidate;
}
