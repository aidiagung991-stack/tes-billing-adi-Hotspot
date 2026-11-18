import React, { useState } from 'react';
import {
  Download,
  FileSpreadsheet,
  FileText,
  Filter,
  Check,
  X,
  Users,
} from 'lucide-react';
import { Customer, InternetPackage } from '../types/index.ts';
import { exportCustomers, filterCustomersForExport } from '../utils/customerExportImport.ts';

interface CustomerExportModalProps {
  customers: Customer[];
  packages: InternetPackage[];
  onClose: () => void;
}

export const CustomerExportModal: React.FC<CustomerExportModalProps> = ({
  customers,
  packages,
  onClose,
}) => {
  const [format, setFormat] = useState<'xlsx' | 'csv'>('xlsx');
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [packageFilter, setPackageFilter] = useState('all');

  const filtered = filterCustomersForExport(customers, {
    statusFilter,
    typeFilter,
    packageFilter,
  });

  const handleExport = () => {
    const today = new Date().toISOString().split('T')[0];
    const prefix = `Data_Pelanggan_Adi_Hotspot_${today}`;
    exportCustomers(filtered, format, prefix);
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
              <h3 className="font-bold text-slate-900 text-base">Export Data Pelanggan</h3>
              <p className="text-xs text-slate-500">Unduh data pelanggan dalam format Excel atau CSV</p>
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
                  <div className="text-[11px] text-slate-500 font-normal">Format spreadsheet standar</div>
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
                  <div className="text-[11px] text-slate-500 font-normal">Teks terpisah koma</div>
                </div>
              </button>
            </div>
          </div>

          {/* Filters */}
          <div className="space-y-3 pt-2 border-t border-slate-100">
            <span className="font-bold text-slate-700 flex items-center gap-1.5">
              <Filter className="w-3.5 h-3.5 text-slate-400" />
              <span>Opsi Filter Data yang Diekspor:</span>
            </span>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <div>
                <label className="text-[11px] font-semibold text-slate-500 block mb-1">Status</label>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="w-full p-2 rounded-lg border border-slate-200 bg-slate-50"
                >
                  <option value="all">Semua Status</option>
                  <option value="active">Aktif</option>
                  <option value="isolated">Terisolir</option>
                  <option value="inactive">Nonaktif</option>
                </select>
              </div>

              <div>
                <label className="text-[11px] font-semibold text-slate-500 block mb-1">Tipe Koneksi</label>
                <select
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value)}
                  className="w-full p-2 rounded-lg border border-slate-200 bg-slate-50"
                >
                  <option value="all">Semua Tipe</option>
                  <option value="pppoe">PPPoE</option>
                  <option value="hotspot">Hotspot</option>
                </select>
              </div>

              <div>
                <label className="text-[11px] font-semibold text-slate-500 block mb-1">Paket</label>
                <select
                  value={packageFilter}
                  onChange={(e) => setPackageFilter(e.target.value)}
                  className="w-full p-2 rounded-lg border border-slate-200 bg-slate-50"
                >
                  <option value="all">Semua Paket</option>
                  {packages.map((pkg) => (
                    <option key={pkg.id} value={pkg.id}>
                      {pkg.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Record summary */}
          <div className="p-3 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-blue-600" />
              <span className="text-slate-700 font-medium">Jumlah Data yang Terpilih:</span>
            </div>
            <strong className="text-blue-900 font-bold text-sm">
              {filtered.length} dari {customers.length} Pelanggan
            </strong>
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
            disabled={filtered.length === 0}
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
