import React from 'react';
import {
  Menu,
  Calendar,
  LogOut,
} from 'lucide-react';
import { MenuItemKey } from '../types/index.ts';

interface HeaderProps {
  activeMenu: MenuItemKey;
  onOpenMobileMenu: () => void;
  searchTerm?: string;
  onSearchChange?: (val: string) => void;
  unpaidCount: number;
  adminUsername?: string | null;
  onLogout?: () => void;
  isLoggingOut?: boolean;
}

const menuTitles: Record<MenuItemKey, { title: string; subtitle: string }> = {
  dashboard: {
    title: 'Dashboard Operasional',
    subtitle: 'Ringkasan performa pelanggan, tagihan, dan pembayaran RT/RW Net',
  },
  customers: {
    title: 'Data Pelanggan',
    subtitle: 'Manajemen data pelanggan PPPoE dan Hotspot Voucher',
  },
  packages: {
    title: 'Paket Internet',
    subtitle: 'Konfigurasi profil kecepatan, masa aktif, dan tarif internet',
  },
  invoices: {
    title: 'Daftar Tagihan',
    subtitle: 'Penerbitan invoice bulanan dan pemantauan status jatuh tempo',
  },
  payments: {
    title: 'Riwayat Pembayaran',
    subtitle: 'Catatan transaksi kasir, transfer bank, dan QRIS',
  },
  broadcast: {
    title: 'Broadcast WhatsApp Massal',
    subtitle: 'Kirim pengumuman pemeliharaan, gangguan, dan info massal ke pelanggan',
  },
  whatsapp: {
    title: 'WhatsApp Gateway Wablas',
    subtitle: 'Konfigurasi API Wablas, template notifikasi otomatis, dan log pesan',
  },
  mikrotik: {
    title: 'Konfigurasi MikroTik',
    subtitle: 'Status koneksi RouterOS, interface, dan monitoring resource',
  },
  reports: {
    title: 'Laporan & Keuangan',
    subtitle: 'Rekapitulasi pendapatan bulanan dan performa layanan jaringan',
  },
  settings: {
    title: 'Pengaturan Usaha',
    subtitle: 'Profil RT/RW Net, kontak admin, dan template pesan WhatsApp',
  },
};

export const Header: React.FC<HeaderProps> = ({
  activeMenu,
  onOpenMobileMenu,
  unpaidCount,
  adminUsername,
  onLogout,
  isLoggingOut = false,
}) => {
  const currentMenu = menuTitles[activeMenu] || {
    title: 'Adi_Hotspot Billing',
    subtitle: 'Administrasi RT/RW Net',
  };

  // Indonesian date string
  const todayFormatted = new Intl.DateTimeFormat('id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date());

  const displayUsername = adminUsername && adminUsername.trim() ? adminUsername.trim() : 'Admin';
  const initials = displayUsername.slice(0, 2).toUpperCase();

  return (
    <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-slate-200/80 transition-all">
      <div className="px-4 sm:px-6 py-3.5 flex items-center justify-between gap-4">
        {/* Left: Mobile Toggle & Page Title */}
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={onOpenMobileMenu}
            className="lg:hidden p-2 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors"
            aria-label="Buka Menu Navigasi"
          >
            <Menu className="w-5 h-5" />
          </button>

          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-lg sm:text-xl font-bold text-slate-900 tracking-tight truncate">
                {currentMenu.title}
              </h1>
              <span className="hidden sm:inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                RT/RW Net
              </span>
            </div>
            <p className="hidden md:block text-xs text-slate-500 truncate mt-0.5">
              {currentMenu.subtitle}
            </p>
          </div>
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          {/* Today Date */}
          <div className="hidden xl:flex items-center gap-1.5 text-xs text-slate-600 bg-slate-50 px-2.5 py-1.5 rounded-lg border border-slate-200">
            <Calendar className="w-3.5 h-3.5 text-slate-500" />
            <span className="font-medium">{todayFormatted}</span>
          </div>

          {/* Unpaid Alert Badge */}
          {unpaidCount > 0 && (
            <div className="hidden sm:flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-amber-50 text-amber-800 border border-amber-200">
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
              <span>{unpaidCount} Tagihan Belum Lunas</span>
            </div>
          )}

          {/* User profile badge & Logout */}
          <div className="flex items-center gap-2.5 pl-2 sm:pl-3 sm:border-l sm:border-slate-200">
            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-blue-700 to-indigo-600 flex items-center justify-center text-white font-semibold text-xs shadow-xs shrink-0">
              {initials}
            </div>
            <div className="hidden sm:block text-left">
              <p className="text-xs font-semibold text-slate-800 leading-tight">{displayUsername}</p>
              <p className="text-[10px] text-slate-500 font-medium">Administrator RT/RW</p>
            </div>
            {onLogout && (
              <button
                type="button"
                onClick={onLogout}
                disabled={isLoggingOut}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-red-50 hover:text-red-700 border border-slate-200 hover:border-red-200 whitespace-nowrap shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 disabled:opacity-50 transition-colors cursor-pointer"
                title="Keluar dari sesi admin"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>{isLoggingOut ? 'Keluar...' : 'Keluar'}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
