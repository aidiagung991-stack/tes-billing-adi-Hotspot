import React, { useState, useMemo } from 'react';
import {
  Calculator,
  Calendar,
  CheckCircle2,
  Clock,
  Info,
  Layers,
  RotateCcw,
  Save,
  Sliders,
  Sparkles,
  Users,
  Check,
  AlertTriangle,
  FileText,
  DollarSign,
  HelpCircle,
} from 'lucide-react';
import { Customer, InternetPackage, BillingSettings } from '../types/index.ts';
import { formatRupiah, formatDateIndo } from '../utils/formatters.ts';
import {
  loadBillingSettings,
  saveBillingSettings,
  defaultBillingSettings,
  calculateProrataBilling,
  calculateAnniversaryBilling,
  getDaysInMonth,
  getIndoMonthName,
} from '../utils/billingCalculator.ts';

interface BillingSettingsViewProps {
  customers: Customer[];
  packages: InternetPackage[];
  onBillingSettingsUpdated?: (newSettings: BillingSettings) => void;
}

export const BillingSettingsView: React.FC<BillingSettingsViewProps> = ({
  customers,
  packages,
  onBillingSettingsUpdated,
}) => {
  const [settings, setSettings] = useState<BillingSettings>(() => loadBillingSettings());
  const [savedToast, setSavedToast] = useState(false);

  // Simulation Form States
  const [simCustomerId, setSimCustomerId] = useState<string>(customers[0]?.id || '');
  const [simPackageId, setSimPackageId] = useState<string>(
    customers[0]?.packageId || packages[0]?.id || ''
  );
  const [simInstallDate, setSimInstallDate] = useState<string>(
    customers[0]?.installationDate || customers[0]?.registeredAt || '2026-10-20'
  );
  const [simIsFirstInvoice, setSimIsFirstInvoice] = useState<boolean>(true);

  // When selected simulation customer changes, prefill their package & install date
  const handleSelectSimCustomer = (custId: string) => {
    setSimCustomerId(custId);
    const found = customers.find((c) => c.id === custId);
    if (found) {
      if (found.packageId) setSimPackageId(found.packageId);
      const dateVal = found.installationDate || found.registeredAt;
      if (dateVal) setSimInstallDate(dateVal);
    }
  };

  // Selected package for simulation
  const selectedPackage = useMemo(() => {
    return packages.find((p) => p.id === simPackageId) || packages[0];
  }, [packages, simPackageId]);

  // Simulation Calculation
  const simulationResult = useMemo(() => {
    const monthlyFee = selectedPackage?.price || 100000;

    if (settings.billingMethod === 'prorata') {
      return calculateProrataBilling({
        monthlyFee,
        installationDateStr: simInstallDate,
        fixedBillingDay: settings.fixedBillingDay,
        inclusiveInstallationDay: settings.inclusiveInstallationDay,
        gracePeriodDays: settings.gracePeriodDays,
        isFirstInvoice: simIsFirstInvoice && settings.prorataFirstInvoice,
      });
    } else {
      return calculateAnniversaryBilling({
        monthlyFee,
        installationDateStr: simInstallDate,
        cycleMonthOffset: simIsFirstInvoice ? 0 : 1,
        gracePeriodDays: settings.gracePeriodDays,
      });
    }
  }, [selectedPackage, simInstallDate, settings, simIsFirstInvoice]);

  // Handle Save
  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const updated: BillingSettings = {
      ...settings,
      updatedAt: new Date().toISOString().split('T')[0],
    };
    saveBillingSettings(updated);
    setSettings(updated);
    if (onBillingSettingsUpdated) {
      onBillingSettingsUpdated(updated);
    }
    setSavedToast(true);
    setTimeout(() => setSavedToast(false), 3500);
  };

  // Handle Reset to Defaults
  const handleReset = () => {
    saveBillingSettings(defaultBillingSettings);
    setSettings(defaultBillingSettings);
    if (onBillingSettingsUpdated) {
      onBillingSettingsUpdated(defaultBillingSettings);
    }
    setSavedToast(true);
    setTimeout(() => setSavedToast(false), 3500);
  };

  return (
    <div className="space-y-6 max-w-5xl animate-in fade-in duration-150">
      {/* Top Banner / Header */}
      <div className="bg-white rounded-2xl p-5 sm:p-6 border border-slate-200/90 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-white flex items-center justify-center shadow-md shadow-blue-500/20 shrink-0">
            <Calculator className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-bold text-slate-900">
                Pengaturan Metode Penagihan
              </h2>
              <span
                className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full border ${
                  settings.billingMethod === 'prorata'
                    ? 'bg-purple-100 text-purple-800 border-purple-200'
                    : 'bg-blue-100 text-blue-800 border-blue-200'
                }`}
              >
                {settings.billingMethod === 'prorata'
                  ? '⚡ METODE AKTIF: PRORATA'
                  : '📅 METODE AKTIF: SESUAI TGL PEMASANGAN'}
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">
              Tentukan rumus perhitungan tagihan pertama pelanggan baru, siklus penagihan rutin, dan batas tanggal jatuh tempo.
            </p>
          </div>
        </div>

        {savedToast && (
          <div className="px-3.5 py-2 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold flex items-center gap-2 shrink-0 animate-in fade-in">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <span>Pengaturan Berhasil Disimpan!</span>
          </div>
        )}
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        {/* SECTION B: PILIHAN DUA METODE UTAMA PENAGIHAN */}
        <div className="space-y-3">
          <span className="text-xs font-bold text-slate-700 uppercase tracking-wider block px-1">
            Pilih Metode Penagihan Utama (Modul B)
          </span>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* METODE 1: PRORATA */}
            <div
              onClick={() => setSettings({ ...settings, billingMethod: 'prorata' })}
              className={`p-5 rounded-2xl border-2 cursor-pointer transition-all relative flex flex-col justify-between ${
                settings.billingMethod === 'prorata'
                  ? 'border-purple-600 bg-purple-50/40 shadow-sm ring-2 ring-purple-600/10'
                  : 'border-slate-200 bg-white hover:border-slate-300'
              }`}
            >
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-lg bg-purple-100 text-purple-700 font-black text-xs flex items-center justify-center">
                      1
                    </span>
                    <h3 className="font-bold text-sm text-slate-900">
                      Metode Prorata (Tetap Tanggal 1)
                    </h3>
                  </div>
                  <input
                    type="radio"
                    name="billingMethod"
                    checked={settings.billingMethod === 'prorata'}
                    onChange={() => setSettings({ ...settings, billingMethod: 'prorata' })}
                    className="w-4 h-4 text-purple-600 focus:ring-purple-500"
                  />
                </div>

                <p className="text-xs text-slate-600 leading-relaxed mb-3">
                  Semua pelanggan ditagih serentak pada tanggal tetap (default tgl 1) setiap bulannya. Pelanggan baru yang dipasang di pertengahan bulan hanya membayar sejumlah hari aktif layanan sampai akhir bulan pertama.
                </p>

                <div className="p-3 bg-white/90 rounded-xl border border-purple-200/80 text-[11px] text-purple-950 space-y-1.5 font-mono mb-3">
                  <div className="font-bold text-purple-900">📐 Rumus Prorata Tagihan Pertama:</div>
                  <div className="text-purple-800 bg-purple-50 p-2 rounded-lg leading-relaxed">
                    Tagihan = Harga Paket × (Hari Layanan / Total Hari Bulan Itu)
                  </div>
                </div>

                <ul className="text-[11px] text-slate-600 space-y-1.5 list-disc list-inside">
                  <li>Tagihan pertama disesuaikan secara adil berdasarkan hari pemakaian.</li>
                  <li>Tagihan periode berikutnya (bulan ke-2 dst) otomatis menggunakan harga paket bulanan penuh.</li>
                  <li>Memudahkan pembukuan karena penagihan massal serempak di awal bulan.</li>
                </ul>
              </div>

              <div className="mt-4 pt-3 border-t border-purple-200/60 flex items-center justify-between text-xs font-semibold text-purple-900">
                <span>Rekomendasi RT/RW Net</span>
                {settings.billingMethod === 'prorata' ? (
                  <span className="flex items-center gap-1 text-purple-700">
                    <Check className="w-4 h-4 text-purple-600" /> Sedang Dipilih
                  </span>
                ) : (
                  <span className="text-slate-400">Klik untuk memilih</span>
                )}
              </div>
            </div>

            {/* METODE 2: SESUAI TANGGAL PEMASANGAN (ANNIVERSARY) */}
            <div
              onClick={() => setSettings({ ...settings, billingMethod: 'anniversary' })}
              className={`p-5 rounded-2xl border-2 cursor-pointer transition-all relative flex flex-col justify-between ${
                settings.billingMethod === 'anniversary'
                  ? 'border-blue-600 bg-blue-50/40 shadow-sm ring-2 ring-blue-600/10'
                  : 'border-slate-200 bg-white hover:border-slate-300'
              }`}
            >
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-lg bg-blue-100 text-blue-700 font-black text-xs flex items-center justify-center">
                      2
                    </span>
                    <h3 className="font-bold text-sm text-slate-900">
                      Sesuai Tanggal Pemasangan (Anniversary)
                    </h3>
                  </div>
                  <input
                    type="radio"
                    name="billingMethod"
                    checked={settings.billingMethod === 'anniversary'}
                    onChange={() => setSettings({ ...settings, billingMethod: 'anniversary' })}
                    className="w-4 h-4 text-blue-600 focus:ring-blue-500"
                  />
                </div>

                <p className="text-xs text-slate-600 leading-relaxed mb-3">
                  Siklus tagihan setiap pelanggan mengikuti tanggal pemasangannya. Misal dipasang tgl 15, maka siklus berulang setiap tanggal 15 bulan berikutnya dengan tarif penuh.
                </p>

                <div className="p-3 bg-white/90 rounded-xl border border-blue-200/80 text-[11px] text-blue-950 space-y-1.5 font-mono mb-3">
                  <div className="font-bold text-blue-900">🛡️ Proteksi Tanggal 29, 30, & 31:</div>
                  <div className="text-blue-800 bg-blue-50 p-2 rounded-lg leading-relaxed">
                    Jika bulan berikutnya tidak memiliki tgl 29/30/31 (misal Februari), sistem otomatis menyesuaikan ke hari terakhir bulan tersebut secara presisi.
                  </div>
                </div>

                <ul className="text-[11px] text-slate-600 space-y-1.5 list-disc list-inside">
                  <li>Setiap siklus ditagih harga penuh paket bulanan tanpa pecahan hari.</li>
                  <li>Beban penerbitan tagihan tersebar merata sepanjang bulan (tidak menumpuk di tgl 1).</li>
                  <li>Jatuh tempo dihitung dari awal tanggal siklus ditambah masa tenggang.</li>
                </ul>
              </div>

              <div className="mt-4 pt-3 border-t border-blue-200/60 flex items-center justify-between text-xs font-semibold text-blue-900">
                <span>Arus Kas Merata</span>
                {settings.billingMethod === 'anniversary' ? (
                  <span className="flex items-center gap-1 text-blue-700">
                    <Check className="w-4 h-4 text-blue-600" /> Sedang Dipilih
                  </span>
                ) : (
                  <span className="text-slate-400">Klik untuk memilih</span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* SECTION C: PENGATURAN TAMBAHAN PARAMETER */}
        <div className="bg-white rounded-2xl p-5 sm:p-6 border border-slate-200/90 shadow-xs space-y-5">
          <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
            <Sliders className="w-4 h-4 text-blue-600" />
            <h3 className="font-bold text-sm text-slate-900">
              Parameter & Aturan Tambahan (Modul C)
            </h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
            {/* 1. Tanggal Tetap Penagihan (Khusus Prorata) */}
            <div className={`p-3.5 rounded-xl border ${settings.billingMethod === 'prorata' ? 'bg-purple-50/30 border-purple-200' : 'bg-slate-50 border-slate-200 opacity-60'}`}>
              <label className="block font-semibold text-slate-800 mb-1">
                Tanggal Tetap Penagihan Bulanan
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={28}
                  disabled={settings.billingMethod !== 'prorata'}
                  value={settings.fixedBillingDay}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      fixedBillingDay: Math.min(28, Math.max(1, Number(e.target.value) || 1)),
                    })
                  }
                  className="w-24 px-3 py-1.5 rounded-lg border border-slate-300 font-bold text-slate-800 bg-white"
                />
                <span className="text-slate-500 text-[11px]">setiap bulan (1-28)</span>
              </div>
              <span className="text-[10px] text-slate-400 block mt-1">
                Batas akhir siklus bulanan prorata (standar: tanggal 1).
              </span>
            </div>

            {/* 2. Jumlah Hari Tenggang Pembayaran (Grace Period) */}
            <div className="p-3.5 rounded-xl border bg-slate-50 border-slate-200">
              <label className="block font-semibold text-slate-800 mb-1">
                Jumlah Hari Tenggang Pembayaran *
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={30}
                  required
                  value={settings.gracePeriodDays}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      gracePeriodDays: Math.min(30, Math.max(1, Number(e.target.value) || 7)),
                    })
                  }
                  className="w-24 px-3 py-1.5 rounded-lg border border-slate-300 font-bold text-slate-800 bg-white"
                />
                <span className="text-slate-500 text-[11px]">Hari setelah terbit</span>
              </div>
              <span className="text-[10px] text-slate-400 block mt-1">
                Jatuh tempo dihitung: Tgl Terbit/Siklus + {settings.gracePeriodDays} hari.
              </span>
            </div>

            {/* 3. Waktu Penerbitan Tagihan */}
            <div className="p-3.5 rounded-xl border bg-slate-50 border-slate-200">
              <label className="block font-semibold text-slate-800 mb-1">
                Waktu Penerbitan Tagihan
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  max={14}
                  value={settings.invoiceGenerationDaysAhead}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      invoiceGenerationDaysAhead: Math.min(14, Math.max(0, Number(e.target.value) || 0)),
                    })
                  }
                  className="w-24 px-3 py-1.5 rounded-lg border border-slate-300 font-bold text-slate-800 bg-white"
                />
                <span className="text-slate-500 text-[11px]">Hari sebelum siklus</span>
              </div>
              <span className="text-[10px] text-slate-400 block mt-1">
                Tagihan siap dikirim H-{settings.invoiceGenerationDaysAhead} sebelum periode dimulai.
              </span>
            </div>
          </div>

          {/* Opsi Kebijakan Prorata */}
          <div className="pt-3 border-t border-slate-100 grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            <label className="flex items-start gap-2.5 p-3 rounded-xl border border-slate-200 bg-slate-50/60 cursor-pointer hover:bg-slate-50">
              <input
                type="checkbox"
                checked={settings.prorataFirstInvoice}
                onChange={(e) =>
                  setSettings({ ...settings, prorataFirstInvoice: e.target.checked })
                }
                className="mt-0.5 rounded border-slate-300 text-purple-600 focus:ring-purple-500"
              />
              <div>
                <span className="font-bold text-slate-800 block">
                  Terapkan Prorata Pada Tagihan Pertama Pelanggan Baru
                </span>
                <span className="text-[11px] text-slate-500 leading-relaxed block mt-0.5">
                  Jika dicentang, pelanggan yang baru pasang tidak ditagih penuh 1 bulan di invoice pertamanya, melainkan dihitung berdasarkan sisa hari pemakaian.
                </span>
              </div>
            </label>

            <label className="flex items-start gap-2.5 p-3 rounded-xl border border-slate-200 bg-slate-50/60 cursor-pointer hover:bg-slate-50">
              <input
                type="checkbox"
                checked={settings.inclusiveInstallationDay}
                onChange={(e) =>
                  setSettings({ ...settings, inclusiveInstallationDay: e.target.checked })
                }
                className="mt-0.5 rounded border-slate-300 text-purple-600 focus:ring-purple-500"
              />
              <div>
                <span className="font-bold text-slate-800 block">
                  Tanggal Pemasangan Ikut Dihitung Sebagai Hari Layanan
                </span>
                <span className="text-[11px] text-slate-500 leading-relaxed block mt-0.5">
                  <strong>Contoh:</strong> Dipasang tgl 20 Oktober pada bulan 31 hari. Jika ikut dihitung, hari layanan = (31 - 20) + 1 = 12 hari aktif.
                </span>
              </div>
            </label>
          </div>
        </div>

        {/* SECTION D: PRATINJAU SIMULASI PERHITUNGAN TAGIHAN INTERAKTIF (Modul C & D) */}
        <div className="bg-white rounded-2xl p-5 sm:p-6 border border-slate-200/90 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-slate-100 gap-2">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-500" />
              <div>
                <h3 className="font-bold text-sm text-slate-900">
                  Pratinjau Simulasi Tagihan Pelanggan (Live Preview)
                </h3>
                <p className="text-xs text-slate-500">
                  Uji perhitungan penagihan sebelum menyimpan konfigurasi ke sistem
                </p>
              </div>
            </div>

            <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700">
              Simulasi Dinamis Sesuai Aturan Aktif
            </span>
          </div>

          {/* Simulation Controls Form */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs p-3.5 bg-slate-50 rounded-xl border border-slate-200">
            {/* Pick Sample Customer */}
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Contoh Pelanggan:
              </label>
              <select
                value={simCustomerId}
                onChange={(e) => handleSelectSimCustomer(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs"
              >
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.id})
                  </option>
                ))}
              </select>
            </div>

            {/* Pick Package */}
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Paket Internet:
              </label>
              <select
                value={simPackageId}
                onChange={(e) => setSimPackageId(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs"
              >
                {packages.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({formatRupiah(p.price)})
                  </option>
                ))}
              </select>
            </div>

            {/* Installation Date Input */}
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Tanggal Pemasangan:
              </label>
              <input
                type="date"
                value={simInstallDate}
                onChange={(e) => setSimInstallDate(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs"
              />
            </div>

            {/* Is First Invoice */}
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Status Tagihan:
              </label>
              <select
                value={simIsFirstInvoice ? 'first' : 'regular'}
                onChange={(e) => setSimIsFirstInvoice(e.target.value === 'first')}
                className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs"
              >
                <option value="first">Tagihan Pertama (Aktivasi Baru)</option>
                <option value="regular">Tagihan Kedua / Bulan Rutin</option>
              </select>
            </div>
          </div>

          {/* Simulation Output Card */}
          <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/70 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-2 border-b border-slate-200/80 gap-2">
              <div className="flex items-center gap-2">
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                    simulationResult.isProrata
                      ? 'bg-purple-100 text-purple-800 border border-purple-200'
                      : 'bg-blue-100 text-blue-800 border border-blue-200'
                  }`}
                >
                  {simulationResult.isProrata ? 'PRORATA AKTIF' : 'TAGIHAN PENUH (REGULER)'}
                </span>
                <span className="text-xs font-bold text-slate-800">
                  Periode: {simulationResult.monthPeriod}
                </span>
              </div>
              <div className="text-right">
                <span className="text-[10px] text-slate-500 block">Nominal Yang Dihasilkan</span>
                <span className="text-xl font-black text-emerald-600">
                  {formatRupiah(simulationResult.calculatedAmount)}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-[11px]">
              <div className="p-2.5 bg-white rounded-lg border border-slate-200">
                <span className="text-slate-400 block text-[10px]">Harga Normal Paket</span>
                <span className="font-bold text-slate-800">
                  {formatRupiah(simulationResult.packagePrice)}
                </span>
              </div>
              <div className="p-2.5 bg-white rounded-lg border border-slate-200">
                <span className="text-slate-400 block text-[10px]">Masa Layanan</span>
                <span className="font-bold text-slate-800 truncate block">
                  {formatDateIndo(simulationResult.servicePeriodStart)} s/d{' '}
                  {formatDateIndo(simulationResult.servicePeriodEnd)}
                </span>
              </div>
              <div className="p-2.5 bg-white rounded-lg border border-slate-200">
                <span className="text-slate-400 block text-[10px]">Hari Layanan / Total Hari</span>
                <span className="font-bold text-purple-700">
                  {simulationResult.serviceDays} dari {simulationResult.totalDaysInPeriod} hari
                </span>
              </div>
              <div className="p-2.5 bg-white rounded-lg border border-slate-200">
                <span className="text-slate-400 block text-[10px]">Batas Jatuh Tempo (+{settings.gracePeriodDays} hari)</span>
                <span className="font-bold text-rose-600">
                  {formatDateIndo(simulationResult.dueDate)}
                </span>
              </div>
            </div>

            <div className="p-3 bg-white rounded-xl border border-slate-200 text-xs space-y-1">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wide block">
                Rincian & Catatan Perhitungan:
              </span>
              <p className="font-mono text-slate-800 font-semibold text-[11px]">
                {simulationResult.formulaDescription}
              </p>
              <p className="text-[11px] text-slate-600 leading-relaxed mt-1">
                {simulationResult.explanationNote}
              </p>
            </div>
          </div>
        </div>

        {/* Action Buttons: Simpan & Pulihkan Default */}
        <div className="pt-2 flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={handleReset}
            className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold flex items-center gap-1.5 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5 text-slate-500" />
            <span>Kembalikan Pengaturan Default</span>
          </button>

          <button
            type="submit"
            className="px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-md shadow-blue-600/20 flex items-center gap-2 transition-all"
          >
            <Save className="w-4 h-4" />
            <span>Simpan Pengaturan Tagihan</span>
          </button>
        </div>
      </form>
    </div>
  );
};
