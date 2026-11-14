import React from 'react';
import {
  Users,
  UserCheck,
  AlertCircle,
  TrendingUp,
  Receipt,
  CreditCard,
  Wifi,
  Server,
  ArrowRight,
  Send,
  CheckCircle2,
  Clock,
  Sparkles,
  AlertTriangle,
} from 'lucide-react';
import { Customer, Invoice, Payment, MenuItemKey } from '../types/index.ts';
import { formatRupiah, formatDateIndo, getInvoiceStatusBadge } from '../utils/formatters.ts';

interface DashboardViewProps {
  customers: Customer[];
  invoices: Invoice[];
  payments: Payment[];
  onNavigate: (menu: MenuItemKey) => void;
  onSendWhatsappReminder: (invoice: Invoice) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  customers,
  invoices,
  payments,
  onNavigate,
  onSendWhatsappReminder,
}) => {
  // Calculations
  const totalCustomers = customers.length;
  const activeCustomers = customers.filter((c) => c.status === 'active').length;
  const isolatedCustomers = customers.filter((c) => c.status === 'isolated').length;
  const inactiveCustomers = customers.filter((c) => c.status === 'inactive').length;

  const unpaidInvoices = invoices.filter((i) => i.status === 'unpaid' || i.status === 'overdue');
  const totalUnpaidAmount = unpaidInvoices.reduce(
    (sum, item) => sum + (item.remainingAmount !== undefined ? item.remainingAmount : item.amount),
    0
  );

  const totalPaymentsAmount = payments.reduce((sum, item) => sum + item.amount, 0);

  return (
    <div className="space-y-6">
      {/* 4 Primary Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* 1. Jumlah Pelanggan */}
        <div className="bg-white rounded-xl p-5 border border-slate-200/90 shadow-xs hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Jumlah Pelanggan
            </span>
            <div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
              <Users className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold text-slate-900 tracking-tight">
              {totalCustomers}{' '}
              <span className="text-sm font-normal text-slate-500">Pelanggan</span>
            </div>
            <div className="mt-2 flex items-center gap-2 text-xs text-slate-600">
              <span className="inline-flex items-center gap-1 font-medium text-blue-600 bg-blue-50 px-2 py-0.5 rounded">
                PPPoE & Hotspot
              </span>
              <span>Terdaftar di sistem</span>
            </div>
          </div>
          <button
            onClick={() => onNavigate('customers')}
            className="mt-4 pt-3 border-t border-slate-100 w-full flex items-center justify-between text-xs font-medium text-blue-600 hover:text-blue-700 transition-colors"
          >
            <span>Kelola pelanggan</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* 2. Pelanggan Aktif */}
        <div className="bg-white rounded-xl p-5 border border-slate-200/90 shadow-xs hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Pelanggan Aktif
            </span>
            <div className="w-10 h-10 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <UserCheck className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold text-slate-900 tracking-tight">
              {activeCustomers}{' '}
              <span className="text-sm font-normal text-emerald-600 font-semibold">Aktif</span>
            </div>
            <div className="mt-2 flex items-center gap-2 text-xs text-slate-500">
              <span className="text-amber-600 font-medium">{isolatedCustomers} Terisolir</span>
              <span>•</span>
              <span className="text-slate-400">{inactiveCustomers} Nonaktif</span>
            </div>
          </div>
          <button
            onClick={() => onNavigate('customers')}
            className="mt-4 pt-3 border-t border-slate-100 w-full flex items-center justify-between text-xs font-medium text-emerald-700 hover:text-emerald-800 transition-colors"
          >
            <span>Lihat status layanan</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* 3. Tagihan Belum Lunas */}
        <div className="bg-white rounded-xl p-5 border border-slate-200/90 shadow-xs hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Tagihan Belum Lunas
            </span>
            <div className="w-10 h-10 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
              <AlertCircle className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold text-amber-600 tracking-tight truncate">
              {formatRupiah(totalUnpaidAmount)}
            </div>
            <div className="mt-2 flex items-center gap-2 text-xs text-slate-600">
              <span className="font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                {unpaidInvoices.length} Invoice
              </span>
              <span>Perlu ditagih</span>
            </div>
          </div>
          <button
            onClick={() => onNavigate('invoices')}
            className="mt-4 pt-3 border-t border-slate-100 w-full flex items-center justify-between text-xs font-medium text-amber-700 hover:text-amber-800 transition-colors"
          >
            <span>Daftar tagihan</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* 4. Total Pembayaran */}
        <div className="bg-white rounded-xl p-5 border border-slate-200/90 shadow-xs hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Total Pembayaran
            </span>
            <div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
              <TrendingUp className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold text-slate-900 tracking-tight truncate">
              {formatRupiah(totalPaymentsAmount)}
            </div>
            <div className="mt-2 flex items-center gap-2 text-xs text-slate-600">
              <span className="font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">
                {payments.length} Transaksi
              </span>
              <span>Tercatat bulan ini</span>
            </div>
          </div>
          <button
            onClick={() => onNavigate('payments')}
            className="mt-4 pt-3 border-t border-slate-100 w-full flex items-center justify-between text-xs font-medium text-blue-600 hover:text-blue-700 transition-colors"
          >
            <span>Lihat riwayat kasir</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Quick Action Navigation Bar */}
      <div className="bg-gradient-to-r from-slate-900 to-slate-800 rounded-xl p-4 sm:p-5 text-white shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-white flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-amber-400" />
            Navigasi Cepat Administrasi RT/RW Net
          </h2>
          <p className="text-xs text-slate-300 mt-0.5">
            Pintasan akses untuk penambahan pelanggan baru, pembuatan tagihan, dan monitoring.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={() => onNavigate('customers')}
            className="px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-semibold transition-colors flex items-center gap-1.5 shadow-sm"
          >
            <Users className="w-3.5 h-3.5" />
            + Tambah Pelanggan
          </button>
          <button
            onClick={() => onNavigate('invoices')}
            className="px-3.5 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-xs font-semibold transition-colors flex items-center gap-1.5"
          >
            <Receipt className="w-3.5 h-3.5" />
            Buat Tagihan
          </button>
          <button
            onClick={() => onNavigate('payments')}
            className="px-3.5 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-xs font-semibold transition-colors flex items-center gap-1.5"
          >
            <CreditCard className="w-3.5 h-3.5" />
            Kasir / Bayar
          </button>
        </div>
      </div>

      {/* Grid: Unpaid Invoices & Recent Payments */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Unpaid / Due Invoices Widget */}
        <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs flex flex-col">
          <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-amber-50 text-amber-600">
                <Receipt className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">Tagihan Perlu Ditagih</h3>
                <p className="text-[11px] text-slate-500">Invoice tertunda atau lewat jatuh tempo</p>
              </div>
            </div>
            <button
              onClick={() => onNavigate('invoices')}
              className="text-xs font-semibold text-blue-600 hover:text-blue-700"
            >
              Lihat Semua
            </button>
          </div>

          <div className="p-4 sm:p-5 flex-1 divide-y divide-slate-100">
            {unpaidInvoices.length === 0 ? (
              <div className="text-center py-8 text-xs text-slate-500">
                Semua tagihan bulan ini sudah lunas.
              </div>
            ) : (
              unpaidInvoices.map((inv) => {
                const statusStyle = getInvoiceStatusBadge(inv.status);
                return (
                  <div
                    key={inv.id}
                    className="py-3 first:pt-0 last:pb-0 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-800">{inv.customerName}</span>
                        <span
                          className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${statusStyle.bg}`}
                        >
                          {statusStyle.label}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        {inv.packageName} • Jatuh Tempo: {formatDateIndo(inv.dueDate)}
                      </p>
                    </div>

                    <div className="flex items-center justify-between sm:justify-end gap-3">
                      <div className="text-right">
                        <div className="text-xs font-bold text-slate-900">
                          {formatRupiah(inv.amount)}
                        </div>
                        <div className="text-[10px] text-slate-400">{inv.invoiceNumber}</div>
                      </div>
                      <button
                        onClick={() => onSendWhatsappReminder(inv)}
                        className="px-2.5 py-1.5 rounded-md bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-medium flex items-center gap-1 border border-emerald-200 transition-colors"
                        title="Simulasi kirim pengingat tagihan via WhatsApp"
                      >
                        <Send className="w-3 h-3 text-emerald-600" />
                        <span>Kirim WA</span>
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Recent Payments Widget */}
        <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs flex flex-col">
          <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-emerald-50 text-emerald-600">
                <CreditCard className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">Pembayaran Terkini</h3>
                <p className="text-[11px] text-slate-500">Transaksi pelunasan terbaru dari kasir</p>
              </div>
            </div>
            <button
              onClick={() => onNavigate('payments')}
              className="text-xs font-semibold text-blue-600 hover:text-blue-700"
            >
              Lihat Semua
            </button>
          </div>

          <div className="p-4 sm:p-5 flex-1 divide-y divide-slate-100">
            {payments.slice(0, 4).map((pay) => (
              <div
                key={pay.id}
                className="py-3 first:pt-0 last:pb-0 flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-800 truncate">
                      {pay.customerName}
                    </span>
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 uppercase">
                      {pay.method}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    {pay.transactionNumber || pay.receiptNumber} • {pay.paidAt}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-xs font-bold text-emerald-600">
                    +{formatRupiah(pay.amount)}
                  </div>
                  <span className="text-[10px] text-slate-400 font-medium">Tercatat Kasir</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Network & Infrastructure Status Preview */}
      <div className="bg-white rounded-xl border border-slate-200/90 p-5 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-slate-100 text-slate-700">
              <Server className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Infrastruktur Router MikroTik & Jaringan
              </h3>
              <p className="text-xs text-slate-500">
                Status router gateway dan alokasi bandwidth hotspot
              </p>
            </div>
          </div>
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-100 text-slate-700 text-xs font-medium border border-slate-200">
            <span className="w-2 h-2 rounded-full bg-amber-500" />
            <span>Router Fisik: Belum Terhubung (Simulasi)</span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
          <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200/70">
            <span className="text-[11px] font-semibold text-slate-500 block">Router Target</span>
            <span className="text-xs font-bold text-slate-800 mt-1 block">
              MikroTik RouterBOARD CCR1009
            </span>
            <span className="text-[11px] text-slate-500 mt-0.5 block">IP Default: 192.168.88.1</span>
          </div>
          <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200/70">
            <span className="text-[11px] font-semibold text-slate-500 block">Port RouterOS API</span>
            <span className="text-xs font-bold text-slate-800 mt-1 block">Port 8728 (API Plain)</span>
            <span className="text-[11px] text-slate-500 mt-0.5 block">Status: Menunggu aktivasi</span>
          </div>
          <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200/70">
            <span className="text-[11px] font-semibold text-slate-500 block">Metode Penagihan</span>
            <span className="text-xs font-bold text-slate-800 mt-1 block">
              Isolir Otomatis (Persiapan)
            </span>
            <span className="text-[11px] text-slate-500 mt-0.5 block">Pool IP Drop / Web Proxy</span>
          </div>
        </div>

        <div className="mt-4 pt-3 flex items-center justify-between">
          <p className="text-xs text-slate-500">
            Integrasi MikroTik akan ditambahkan pada tahap pengembangan lanjutan sesuai spesifikasi.
          </p>
          <button
            onClick={() => onNavigate('mikrotik')}
            className="text-xs font-semibold text-blue-600 hover:text-blue-700 flex items-center gap-1"
          >
            <span>Buka Menu MikroTik</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
