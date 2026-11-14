import { BroadcastCampaign, BroadcastType } from '../types/index.ts';

const BROADCAST_STORAGE_KEY = 'adi_hotspot_broadcast_history_v1';

export interface DefaultBroadcastTemplate {
  type: BroadcastType;
  title: string;
  name: string;
  content: string;
}

export const defaultBroadcastTemplates: DefaultBroadcastTemplate[] = [
  {
    type: 'outage',
    name: 'Gangguan Jaringan (Outage)',
    title: 'Pemberitahuan Gangguan Jaringan Internet',
    content: `*PEMBERITAHUAN GANGGUAN JARINGAN INTERNET*

Halo *{nama_pelanggan}* (ID: {id_pelanggan}),

Kami informasikan bahwa saat ini sedang terjadi kendala teknis pada jalur distribusi utama internet di sebagian wilayah RT/RW Net kami. Tim teknisi saat ini sudah berada di lokasi dan sedang berupaya melakukan perbaikan secepatnya.

Estimasi waktu normalisasi: 1 - 2 jam ke depan.
Kami memohon maaf yang sebesar-besarnya atas ketidaknyamanan yang terjadi pada aktivitas online Anda.

Salam hormat,
*{nama_usaha}*
Hubungi Admin: {kontak_admin}`,
  },
  {
    type: 'maintenance',
    name: 'Jadwal Pemeliharaan (Maintenance)',
    title: 'Informasi Jadwal Pemeliharaan Infrastruktur',
    content: `*INFORMASI JADWAL PEMELIHARAAN (MAINTENANCE)*

Halo *{nama_pelanggan}* (ID: {id_pelanggan}),

Guna meningkatkan stabilitas dan kecepatan akses layanan internet {nama_paket}, kami akan melaksanakan pemeliharaan sistem rutin pada:

Hari/Tanggal: Dini hari nanti
Waktu: Pukul 01:00 - 04:00 WIB
Dampak: Koneksi internet akan terputus sementara selama proses upgrade berlangsung.

Layanan akan kembali otomatis setelah proses selesai. Terima kasih atas pengertian dan kerjasamanya.

Salam hangat,
*{nama_usaha}*
Pusat Bantuan: {kontak_admin}`,
  },
  {
    type: 'restoration',
    name: 'Informasi Pemulihan Jaringan',
    title: 'Koneksi Jaringan Internet Telah Normal Kembali',
    content: `*JARINGAN INTERNET TELAH NORMAL KEMBALI*

Halo *{nama_pelanggan}* (ID: {id_pelanggan}),

Kabar baik! Proses perbaikan gangguan jalur fiber optik/link transmisi telah selesai dilaksanakan. Akses internet untuk pelanggan *{nama_usaha}* saat ini sudah pulih dan dapat digunakan kembali secara normal.

*Tips:*
Jika lampu indikator LOS pada modem masih berkedip merah atau internet belum tersambung, mohon cabut kabel adaptor power modem/router selama 1 menit kemudian nyalakan kembali.

Terima kasih atas kesabaran dan kebersamaan Anda!

*{nama_usaha}*
CS: {kontak_admin}`,
  },
  {
    type: 'announcement',
    name: 'Pengumuman Umum',
    title: 'Pengumuman Penting untuk Pelanggan',
    content: `*PENGUMUMAN PENTING DARI {nama_usaha}*

Halo *{nama_pelanggan}* (ID: {id_pelanggan}),

Terima kasih atas kepercayaan Anda menjadi pelanggan setia layanan internet {nama_usaha}. 

Kami informasikan bahwa loket pos pembayaran tagihan dan layanan CS online siap melayani Anda setiap hari. Pastikan pembayaran tagihan dilakukan sebelum tanggal jatuh tempo agar aktivitas internet keluarga tetap lancar tanpa hambatan isolir otomatis.

Untuk bantuan teknis dan konfirmasi pembayaran, silakan hubungi kami melalui nomor ini.

Hormat kami,
*{nama_usaha}*
Telepon/WA: {kontak_admin}`,
  },
];

export function loadBroadcastHistory(): BroadcastCampaign[] {
  try {
    const raw = localStorage.getItem(BROADCAST_STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch (e) {
    console.error('Gagal memuat riwayat broadcast:', e);
    return [];
  }
}

export function saveBroadcastHistory(history: BroadcastCampaign[]): void {
  try {
    localStorage.setItem(BROADCAST_STORAGE_KEY, JSON.stringify(history));
  } catch (e) {
    console.error('Gagal menyimpan riwayat broadcast:', e);
  }
}

export function renderBroadcastMessage(
  template: string,
  params: {
    customerName: string;
    customerId: string;
    packageName: string;
    businessName: string;
    contactPhone: string;
  }
): string {
  return template
    .replace(/{nama_pelanggan}/gi, params.customerName)
    .replace(/{id_pelanggan}/gi, params.customerId)
    .replace(/{nama_paket}/gi, params.packageName)
    .replace(/{nama_usaha}/gi, params.businessName)
    .replace(/{kontak_admin}/gi, params.contactPhone);
}
