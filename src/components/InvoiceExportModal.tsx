import React, { useState, useMemo } from 'react';
import {
  Download,
  FileSpreadsheet,
  FileText,
  Filter,
  Check,
  X,
  Receipt,
  DollarSign,
} from 'lucide-react';
import { Invoice, Customer } from '../types/index.ts';
import { exportInvoices, filterInvoicesForExport } from '../utils/invoiceExport.ts';
import { formatRupiah } from '../utils/formatters.ts';

interface InvoiceExportModalProps {
  invoices: Invoice[];
  customers: Customer[];
  onClose: () => void;
}

export const InvoiceExportModal: React.FC<InvoiceExportModalProps> = ({
  invoices,
  customers,
  onClose,
}) => {
  const [format, setFormat] = useState<'xlsx' | 'csv'>('xlsx');
  const [periodFilter, setPeriodFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [customerFilter, setCustomerFilter] = useState('all');

  // Unique list of periods
  const uniquePeriods = useMemo(() => {
    const setP = new Set<string>();
    invoices.forEach((i) => {
      if (i.monthPeriod && i.monthPeriod.trim()) {
        setP.add(i.monthPeriod.trim());
      }
    });
    return Array.from(setP);
  }, [invoices]);

  const filteredInvoices = useMemo(() => {
    return filterInvoicesForExport(invoices, {
      periodFilter,
      statusFilter,
      customerFilter,
    });
  }, [invoices, periodFilter, statusFilter, customerFilter]);

  const totalFilteredAmount = useMemo(() => {
    return filteredInvoices.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  }, [filteredInvoices]);

  const handleExport = () => {
    let cleanPeriod = periodFilter !== 'all' ? periodFilter.replace(/\s+/g, '_') : 'Semua';
    const filenamePrefix = `Data_Tagihan_${cleanPeriod}_${new Date().toISOString().split('T')[0]}`;

    exportInvoices(filteredInvoices, customers, format, filenamePrefix);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs">
      <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl overflow-hidden border border-slate-200">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center">
              <Download className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-base">Export Data Tagihan</h3>
              <p className="text-xs text-slate-500">Unduh data tagihan dalam format Excel atau CSV</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4 text-xs">
          {/* Format selection */}
          <div>
            <label className="font-bold text-slate-700 block mb-1.5">Pilih Format File:</label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setFormat('xlsx')}
                className={`p-3 rounded-xl border text-left flex items-center gap-2.5 transition-all ${
                  format === 'xlsx'
                    ? 'border-blue-600 bg-blue-50/60 text-blue-950 font-bold ring-2 ring-blue-500/20'
                    : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                }`}
              >
                <FileSpreadsheet className={`w-5 h-5 ${format === 'xlsx' ? 'text-blue-600' : 'text-slate-400'}`} />
                <div>
                  <div className="font-bold">Excel (.xlsx)</div>
                  <div className="text-[11px] text-slate-500 font-normal">Kalkulasi rumus numerik siap pakai</div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setFormat('csv')}
                className={`p-3 rounded-xl border text-left flex items-center gap-2.5 transition-all ${
                  format === 'csv'
                    ? 'border-blue-600 bg-blue-50/60 text-blue-950 font-bold ring-2 ring-blue-500/20'
                    : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                }`}
              >
                <FileText className={`w-5 h-5 ${format === 'csv' ? 'text-blue-600' : 'text-slate-400'}`} />
                <div>
                  <div className="font-bold">CSV (.csv)</div>
                  <div className="text-[11px] text-slate-500 font-normal">Kompatibel software akuntansi</div>
                </div>
              </button>
            </div>
          </div>

          {/* Filter options */}
          <div className="space-y-3 pt-2 border-t border-slate-100">
            <span className="font-bold text-slate-700 flex items-center gap-1.5">
              <Filter className="w-3.5 h-3.5 text-slate-400" />
              <span>Filter Data Tagihan yang Diekspor:</span>
            </span>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <div>
                <label className="text-[11px] font-semibold text-slate-500 block mb-1">Periode</label>
                <select
                  value={periodFilter}
                  onChange={(e) => setPeriodFilter(e.target.value)}
                  className="w-full p-2 rounded-lg border border-slate-200 bg-slate-50"
                >
                  <option value="all">Semua Periode</option>
                  {uniquePeriods.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[11px] font-semibold text-slate-500 block mb-1">Status</label>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="w-full p-2 rounded-lg border border-slate-200 bg-slate-50"
                >
                  <option value="all">Semua Status</option>
                  <option value="unpaid">Belum Dibayar</option>
                  <option value="overdue">Terlambat</option>
                  <option value="paid">Lunas</option>
                </select>
              </div>

              <div>
                <label className="text-[11px] font-semibold text-slate-500 block mb-1">Pelanggan</label>
                <select
                  value={customerFilter}
                  onChange={(e) => setCustomerFilter(e.target.value)}
                  className="w-full p-2 rounded-lg border border-slate-200 bg-slate-50 truncate"
                >
                  <option value="all">Semua Pelanggan</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Records and amount summary */}
          <div className="p-3.5 rounded-xl bg-blue-50 border border-blue-200 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-slate-700 font-medium flex items-center gap-1.5">
                <Receipt className="w-4 h-4 text-blue-600" />
                <span>Jumlah Tagihan Terpilih:</span>
              </span>
              <strong className="text-blue-900 font-bold text-sm">
                {filteredInvoices.length} dari {invoices.length} Invoice
              </strong>
            </div>
            <div className="flex items-center justify-between text-[11px] text-blue-800 pt-1 border-t border-blue-200/60">
              <span>Total Nilai Tagihan:</span>
              <strong className="font-bold">{formatRupiah(totalFilteredAmount)}</strong>
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl border border-slate-200 hover:bg-slate-200 text-slate-700 text-xs font-semibold"
          >
            Batal
          </button>
          <button
            type="button"
            disabled={filteredInvoices.length === 0}
            onClick={handleExport}
            className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold flex items-center gap-1.5 shadow-xs transition-colors disabled:opacity-50"
          >
            <Download className="w-4 h-4" />
            <span>Unduh File ({format.toUpperCase()})</span>
          </button>
        </div>
      </div>
    </div>
  );
};
