import React from 'react';
import {
  BarChart3,
  TrendingUp,
  Download,
  Calendar,
  DollarSign,
  Users,
  CheckCircle2,
  Clock,
  PieChart,
} from 'lucide-react';
import { Customer, Invoice, Payment, InternetPackage } from '../types/index.ts';
import { formatRupiah } from '../utils/formatters.ts';

interface ReportsViewProps {
  customers: Customer[];
  invoices: Invoice[];
  payments: Payment[];
  packages: InternetPackage[];
}

export const ReportsView: React.FC<ReportsViewProps> = ({
  customers,
  invoices,
  payments,
  packages,
}) => {
  const totalBilled = invoices.reduce((sum, inv) => sum + inv.amount, 0);
  const totalCollected = payments.reduce((sum, pay) => sum + pay.amount, 0);
  const totalPending = invoices
    .filter((inv) => inv.status !== 'paid')
    .reduce((sum, inv) => sum + (inv.remainingAmount !== undefined ? inv.remainingAmount : inv.amount), 0);

  const collectionRate =
    totalBilled > 0 ? Math.round((totalCollected / totalBilled) * 100) : 0;

  const handleExportCSV = () => {
    // Generate simple CSV of invoices
    const headers = 'Nomor Invoice,Pelanggan,Paket,Jumlah,Status,Jatuh Tempo\n';
    const rows = invoices
      .map(
        (i) =>
          `"${i.invoiceNumber}","${i.customerName}","${i.packageName}",${i.amount},"${i.status}","${i.dueDate}"`
      )
      .join('\n');

    const blob = new Blob([headers + rows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', 'Laporan_Billing_Adi_Hotspot.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6">
      {/* Top Banner with Export */}
      <div className="bg-white rounded-2xl p-5 border border-slate-200/90 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-slate-900">
            Laporan Keuangan & Penagihan Bulanan
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Analisis arus kas kasir, rasio pelunasan pelanggan, dan utilisasi paket internet
          </p>
        </div>

        <button
          onClick={handleExportCSV}
          className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-900 text-white text-xs font-semibold flex items-center gap-2 transition-colors shadow-xs"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Ekspor Laporan (CSV)</span>
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl p-5 border border-slate-200/90 shadow-xs">
          <span className="text-xs font-semibold text-slate-500 uppercase">
            Total Tagihan Diterbitkan
          </span>
          <div className="text-2xl font-bold text-slate-900 mt-2">{formatRupiah(totalBilled)}</div>
          <div className="mt-2 text-xs text-slate-500">{invoices.length} invoice di bulan ini</div>
        </div>

        <div className="bg-white rounded-xl p-5 border border-slate-200/90 shadow-xs">
          <span className="text-xs font-semibold text-emerald-600 uppercase">
            Realisasi Pembayaran
          </span>
          <div className="text-2xl font-bold text-emerald-600 mt-2">
            {formatRupiah(totalCollected)}
          </div>
          <div className="mt-2 text-xs text-emerald-700 font-medium">
            Tingkat pelunasan: {collectionRate}%
          </div>
        </div>

        <div className="bg-white rounded-xl p-5 border border-slate-200/90 shadow-xs">
          <span className="text-xs font-semibold text-amber-600 uppercase">
            Sisa Piutang / Belum Lunas
          </span>
          <div className="text-2xl font-bold text-amber-600 mt-2">
            {formatRupiah(totalPending)}
          </div>
          <div className="mt-2 text-xs text-amber-700">
            {invoices.filter((i) => i.status !== 'paid').length} invoice tertunda
          </div>
        </div>
      </div>

      {/* Progress Bar Collection Rate */}
      <div className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs">
        <div className="flex items-center justify-between text-xs font-bold text-slate-800 mb-2">
          <span>Efektivitas Penagihan (Realisasi Kas vs Potensi Tagihan)</span>
          <span>{collectionRate}%</span>
        </div>
        <div className="w-full h-3 rounded-full bg-slate-100 overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-blue-600 to-emerald-500 rounded-full transition-all duration-500"
            style={{ width: `${Math.min(collectionRate, 100)}%` }}
          />
        </div>
        <p className="text-[11px] text-slate-500 mt-2">
          Dari total potensi {formatRupiah(totalBilled)}, kas RT/RW Net telah menerima pelunasan{' '}
          {formatRupiah(totalCollected)}.
        </p>
      </div>

      {/* Breakdown per Paket */}
      <div className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs">
        <h3 className="text-sm font-bold text-slate-900 pb-3 border-b border-slate-100 mb-4">
          Distribusi Pelanggan Berdasarkan Paket Internet
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {packages.map((pkg) => {
            const count = customers.filter((c) => c.packageId === pkg.id).length;
            const percentage =
              customers.length > 0 ? Math.round((count / customers.length) * 100) : 0;
            return (
              <div key={pkg.id} className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/70">
                <div className="flex justify-between items-start">
                  <div>
                    <h4 className="font-bold text-xs text-slate-900">{pkg.name}</h4>
                    <span className="text-[11px] text-slate-500">{formatRupiah(pkg.price)} / bln</span>
                  </div>
                  <span className="text-xs font-extrabold text-blue-600 bg-blue-50 px-2 py-0.5 rounded">
                    {count} User
                  </span>
                </div>
                <div className="mt-3 w-full h-1.5 rounded-full bg-slate-200 overflow-hidden">
                  <div className="h-full bg-blue-600 rounded-full" style={{ width: `${percentage}%` }} />
                </div>
                <div className="mt-1 text-[10px] text-slate-400 text-right">{percentage}% dari total pelanggan</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
