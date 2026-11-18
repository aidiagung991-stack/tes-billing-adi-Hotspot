import React from 'react';
import {
  LayoutDashboard,
  Users,
  Wifi,
  Receipt,
  CreditCard,
  Server,
  BarChart3,
  Settings,
  MessageSquare,
  Calculator,
  X,
  Radio,
  ExternalLink,
} from 'lucide-react';
import { MenuItemKey, RouterConfig } from '../types/index.ts';

interface SidebarProps {
  activeMenu: MenuItemKey;
  onSelectMenu: (menu: MenuItemKey) => void;
  isOpenMobile: boolean;
  onCloseMobile: () => void;
  unpaidInvoicesCount: number;
  totalCustomersCount: number;
  routerConfig?: RouterConfig;
}

interface MenuItemConfig {
  key: MenuItemKey;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string | number;
  badgeColor?: string;
  subtext?: string;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeMenu,
  onSelectMenu,
  isOpenMobile,
  onCloseMobile,
  unpaidInvoicesCount,
  totalCustomersCount,
  routerConfig,
}) => {
  const isRouterConnected = routerConfig?.status === 'connected';

  const menuItems: MenuItemConfig[] = [
    {
      key: 'dashboard',
      label: 'Dashboard',
      icon: LayoutDashboard,
      subtext: 'Ringkasan & status',
    },
    {
      key: 'customers',
      label: 'Pelanggan',
      icon: Users,
      badge: totalCustomersCount,
      badgeColor: 'bg-slate-200 text-slate-700',
      subtext: 'Data PPPoE & Hotspot',
    },
    {
      key: 'packages',
      label: 'Paket Internet',
      icon: Wifi,
      subtext: 'Kecepatan & tarif',
    },
    {
      key: 'invoices',
      label: 'Tagihan',
      icon: Receipt,
      badge: unpaidInvoicesCount > 0 ? `${unpaidInvoicesCount} Belum Lunas` : undefined,
      badgeColor: 'bg-amber-100 text-amber-800 border border-amber-300',
      subtext: 'Invoice bulanan',
    },
    {
      key: 'broadcast',
      label: 'Broadcast WhatsApp',
      icon: Radio,
      badge: 'Massal',
      badgeColor: 'bg-blue-100 text-blue-800 border border-blue-200',
      subtext: 'Pesan massal & info',
    },
    {
      key: 'payments',
      label: 'Pembayaran',
      icon: CreditCard,
      subtext: 'Riwayat & kasir',
    },
    {
      key: 'whatsapp',
      label: 'WhatsApp Gateway',
      icon: MessageSquare,
      badge: 'Wablas',
      badgeColor: 'bg-emerald-100 text-emerald-800 border border-emerald-200',
      subtext: 'Wablas & notifikasi',
    },
    {
      key: 'mikrotik',
      label: 'MikroTik',
      icon: Server,
      badge: isRouterConnected ? 'Online' : 'Offline',
      badgeColor: isRouterConnected
        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
        : 'bg-slate-800 text-slate-400 border border-slate-700/60',
      subtext: 'Router & status',
    },
    {
      key: 'reports',
      label: 'Laporan',
      icon: BarChart3,
      subtext: 'Rekap keuangan',
    },
    {
      key: 'settings',
      label: 'Pengaturan',
      icon: Settings,
      subtext: 'Profil usaha RT/RW',
    },
  ];

  const handleNavClick = (key: MenuItemKey) => {
    onSelectMenu(key);
    onCloseMobile();
  };

  return (
    <>
      {/* Mobile Backdrop */}
      {isOpenMobile && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/60 backdrop-blur-xs lg:hidden transition-opacity"
          onClick={onCloseMobile}
          aria-hidden="true"
        />
      )}

      {/* Sidebar Container */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-68 bg-slate-900 text-slate-200 flex flex-col border-r border-slate-800 transition-transform duration-300 ease-in-out lg:static lg:translate-x-0 ${
          isOpenMobile ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Brand Header */}
        <div className="h-16 px-5 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center text-white shadow-md shadow-blue-500/20 ring-1 ring-white/20">
              <Radio className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-white tracking-tight text-base">Adi_Hotspot</span>
              </div>
              <p className="text-[11px] font-medium text-slate-400">Billing RT/RW Net</p>
            </div>
          </div>

          <button
            onClick={onCloseMobile}
            className="lg:hidden p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
            aria-label="Tutup Menu"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation list */}
        <div className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          <div className="px-3 pb-2 text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
            Menu Utama
          </div>

          {menuItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeMenu === item.key;
            return (
              <button
                key={item.key}
                onClick={() => handleNavClick(item.key)}
                className={`w-full text-left group flex items-center justify-between px-3 py-2.5 rounded-lg transition-all text-sm font-medium ${
                  isActive
                    ? 'bg-blue-600 text-white shadow-sm shadow-blue-600/30'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <Icon
                    className={`w-5 h-5 shrink-0 transition-transform ${
                      isActive ? 'text-white' : 'text-slate-400 group-hover:text-slate-200'
                    }`}
                  />
                  <div className="truncate">
                    <span className="block truncate">{item.label}</span>
                  </div>
                </div>

                {item.badge && (
                  <span
                    className={`text-[11px] font-medium px-2 py-0.5 rounded-full shrink-0 ml-2 ${
                      isActive ? 'bg-white/20 text-white' : item.badgeColor || 'bg-slate-800 text-slate-300'
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Router Status Widget at Footer */}
        <div className="p-3 border-t border-slate-800 bg-slate-950/50">
          <div
            onClick={() => handleNavClick('mikrotik')}
            className={`p-3 rounded-lg border text-xs transition-all cursor-pointer group ${
              isRouterConnected
                ? 'bg-emerald-950/30 hover:bg-emerald-950/50 border-emerald-800/60'
                : 'bg-slate-800/80 hover:bg-slate-800 border-slate-700/60'
            }`}
            role="button"
            tabIndex={0}
            title="Klik untuk membuka Pengaturan & Status MikroTik"
          >
            <div className="flex items-center justify-between mb-1.5 gap-2">
              <span className="font-semibold text-slate-200 flex items-center gap-1.5 group-hover:text-white transition-colors truncate">
                <Server className={`w-3.5 h-3.5 shrink-0 ${isRouterConnected ? 'text-emerald-400' : 'text-slate-400'}`} />
                <span className="truncate">{routerConfig?.routerName || 'MikroTik Router'}</span>
              </span>
              <span
                className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded border shrink-0 ${
                  isRouterConnected
                    ? 'bg-emerald-950/80 text-emerald-300 border-emerald-700/60'
                    : 'bg-slate-700 text-slate-300 border-slate-600/60'
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    isRouterConnected ? 'bg-emerald-400 animate-pulse' : 'bg-slate-400'
                  }`}
                />
                {isRouterConnected ? 'Terhubung (Online)' : 'Belum Terhubung'}
              </span>
            </div>
            <div className="text-[11px] text-slate-400 leading-snug flex items-center justify-between gap-1">
              <span className="font-mono text-[10.5px] truncate text-slate-300">
                {routerConfig?.host || '192.168.88.1'}:{routerConfig?.apiPort || (routerConfig?.useSsl ? 8729 : 8728)}
              </span>
              <span className="text-[10px] shrink-0 text-slate-400">
                {isRouterConnected ? (routerConfig?.useSsl ? 'API-SSL' : 'API') : 'Standby'}
              </span>
            </div>
          </div>
          <div className="mt-2 text-center text-[10px] text-slate-400">
            v1.0.0 • RT/RW Net Edition
          </div>
        </div>
      </aside>
    </>
  );
};
