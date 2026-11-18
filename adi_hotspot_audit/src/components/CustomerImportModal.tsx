import React, { useState, useRef } from 'react';
import {
  Upload,
  FileSpreadsheet,
  FileText,
  Download,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  X,
  Loader2,
  Info,
  Check,
  ShieldAlert,
} from 'lucide-react';
import { Customer, InternetPackage } from '../types/index.ts';
import {
  parseCustomerImportFile,
  downloadCustomerTemplate,
  CustomerImportAnalysis,
} from '../utils/customerExportImport.ts';
import { formatRupiah } from '../utils/formatters.ts';

interface CustomerImportModalProps {
  existingCustomers: Customer[];
  packages: InternetPackage[];
  onImportSuccess: (importedCustomers: Customer[]) => void;
  onClose: () => void;
}

export const CustomerImportModal: React.FC<CustomerImportModalProps> = ({
  existingCustomers,
  packages,
  onImportSuccess,
  onClose,
}) => {
  const [file, setFile] = useState<File | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [analysis, setAnalysis] = useState<CustomerImportAnalysis | null>(null);
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [parseError, setParseError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (selectedFile: File) => {
    setFile(selectedFile);
    setParseError(null);
    setIsParsing(true);

    try {
      const res = await parseCustomerImportFile(selectedFile, existingCustomers, packages);
      setAnalysis(res);
    } catch (err: any) {
      setParseError('Gagal membaca file. Pastikan format tabel sesuai dengan template.');
    } finally {
      setIsParsing(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileChange(e.dataTransfer.files[0]);
    }
  };

  const handleConfirmImport = () => {
    if (!analysis) return;

    let rowsToImport = analysis.validRows;

    if (skipDuplicates) {
      rowsToImport = rowsToImport.filter((r) => !r.isDuplicateId && !r.isDuplicateUsername);
    }

    const newCustomers: Customer[] = rowsToImport.map((r) => r.data as Customer);

    onImportSuccess(newCustomers);
    onClose();
  };

  // Compute how many will be added
  const willImportCount = analysis
    ? skipDuplicates
      ? analysis.validRows.filter((r) => !r.isDuplicateId && !r.isDuplicateUsername).length
      : analysis.validRows.length
    : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-900/60 backdrop-blur-xs">
      <div className="bg-white rounded-2xl max-w-4xl w-full flex flex-col max-h-[92vh] shadow-2xl overflow-hidden border border-slate-200">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center">
              <Upload className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-base">Import Data Pelanggan</h3>
              <p className="text-xs text-slate-500">
                Unggah file Excel (.xlsx) atau CSV (.csv) untuk menambahkan data pelanggan
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 flex-1 overflow-y-auto space-y-4 text-xs">
          {/* Download Templates Banner */}
          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/90 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <Info className="w-4 h-4 text-blue-600 shrink-0" />
              <div>
                <strong className="text-slate-800 font-bold block">Unduh Format Template Standar</strong>
                <span className="text-slate-500 text-[11px]">
                  Gunakan format kolom yang sudah disesuaikan agar proses impor berjalan lancar tanpa error
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => downloadCustomerTemplate('xlsx')}
                className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-xs"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Template Excel (.xlsx)</span>
              </button>
              <button
                type="button"
                onClick={() => downloadCustomerTemplate('csv')}
                className="px-3 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-200 text-slate-700 text-xs font-semibold flex items-center gap-1.5 transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Template CSV (.csv)</span>
              </button>
            </div>
          </div>

          {/* Upload Area */}
          {!analysis && (
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-slate-300 hover:border-blue-500 rounded-2xl p-8 text-center cursor-pointer transition-colors bg-slate-50/50 hover:bg-blue-50/20"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.csv"
                onChange={(e) => e.target.files && e.target.files[0] && handleFileChange(e.target.files[0])}
                className="hidden"
              />
              <div className="w-12 h-12 rounded-2xl bg-blue-100 text-blue-600 flex items-center justify-center mx-auto mb-3 shadow-xs">
                {isParsing ? <Loader2 className="w-6 h-6 animate-spin" /> : <Upload className="w-6 h-6" />}
              </div>
              <h4 className="font-bold text-slate-800 text-sm">
                Pilih atau Tarik File Excel (.xlsx) / CSV di sini
              </h4>
              <p className="text-slate-400 text-xs mt-1">
                Mendukung data pelanggan lengkap termasuk koordinat Latitude & Longitude
              </p>
            </div>
          )}

          {parseError && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 flex items-center gap-2">
              <XCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{parseError}</span>
            </div>
          )}

          {/* Analysis & Preview Report */}
          {analysis && (
            <div className="space-y-4">
              {/* Summary Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                  <span className="text-[10px] uppercase font-bold text-slate-500 block">Total Baris</span>
                  <strong className="text-lg font-bold text-slate-900">{analysis.totalRows} Data</strong>
                </div>

                <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200">
                  <span className="text-[10px] uppercase font-bold text-emerald-700 block">Siap Diimpor</span>
                  <strong className="text-lg font-bold text-emerald-800">{analysis.canImportCount} Valid</strong>
                </div>

                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200">
                  <span className="text-[10px] uppercase font-bold text-amber-700 block">Duplikat Terdeteksi</span>
                  <strong className="text-lg font-bold text-amber-800">
                    {analysis.duplicateIdCount + analysis.duplicateUsernameCount}
                  </strong>
                </div>

                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200">
                  <span className="text-[10px] uppercase font-bold text-rose-700 block">Format Tidak Valid</span>
                  <strong className="text-lg font-bold text-rose-800">{analysis.invalidRows.length}</strong>
                </div>
              </div>

              {/* Duplicate Protection Option */}
              {(analysis.duplicateIdCount > 0 || analysis.duplicateUsernameCount > 0) && (
                <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 flex items-start gap-2.5">
                  <ShieldAlert className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <label className="font-bold text-amber-950 flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={skipDuplicates}
                        onChange={(e) => setSkipDuplicates(e.target.checked)}
                        className="rounded text-blue-600 focus:ring-blue-500 w-4 h-4"
                      />
                      <span>Lewati data duplikat tanpa menimpa data yang sudah ada (Direkomendasikan)</span>
                    </label>
                    <p className="text-amber-800 text-[11px] mt-0.5 pl-6">
                      Data dengan ID Pelanggan atau Username yang sudah terdaftar di sistem tidak akan diimpor ulang.
                    </p>
                  </div>
                </div>
              )}

              {/* Preview Table */}
              <div className="border border-slate-200 rounded-xl overflow-hidden shadow-xs">
                <div className="px-3.5 py-2.5 bg-slate-50 border-b border-slate-200 font-bold text-slate-800 flex items-center justify-between">
                  <span>Pratinjau Data File ({file?.name}):</span>
                  <button
                    onClick={() => {
                      setAnalysis(null);
                      setFile(null);
                    }}
                    className="text-xs text-blue-600 hover:underline"
                  >
                    Ganti File
                  </button>
                </div>

                <div className="max-h-60 overflow-y-auto overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-100 text-slate-600 sticky top-0 font-semibold text-[10px] uppercase">
                      <tr>
                        <th className="p-2">Status</th>
                        <th className="p-2">ID</th>
                        <th className="p-2">Nama</th>
                        <th className="p-2">WhatsApp</th>
                        <th className="p-2">Paket</th>
                        <th className="p-2">Tipe</th>
                        <th className="p-2">Koordinat</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {analysis.validRows.slice(0, 15).map((row, idx) => {
                        const isDup = row.isDuplicateId || row.isDuplicateUsername;
                        return (
                          <tr key={idx} className={isDup ? 'bg-amber-50/50' : 'hover:bg-slate-50'}>
                            <td className="p-2">
                              {isDup ? (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800">
                                  {skipDuplicates ? 'Dilewati (Duplikat)' : 'Duplikat'}
                                </span>
                              ) : (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">
                                  Valid
                                </span>
                              )}
                            </td>
                            <td className="p-2 font-mono font-semibold">{row.data.id}</td>
                            <td className="p-2 font-bold">{row.data.name}</td>
                            <td className="p-2">{row.data.phone}</td>
                            <td className="p-2">{row.data.packageName}</td>
                            <td className="p-2 uppercase">{row.data.type}</td>
                            <td className="p-2 font-mono text-[11px] text-slate-500">
                              {row.data.latitude && row.data.longitude
                                ? `${row.data.latitude}, ${row.data.longitude}`
                                : 'Belum diatur'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-100 bg-slate-50 flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl border border-slate-200 hover:bg-slate-200 text-slate-700 text-xs font-semibold"
          >
            Batal
          </button>

          {analysis && (
            <button
              type="button"
              disabled={willImportCount === 0}
              onClick={handleConfirmImport}
              className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold flex items-center gap-1.5 shadow-xs transition-colors disabled:opacity-50"
            >
              <Check className="w-4 h-4" />
              <span>Impor {willImportCount} Pelanggan Baru</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
