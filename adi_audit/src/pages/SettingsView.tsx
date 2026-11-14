import React, { useState } from 'react';
import {
  Settings,
  Building,
  Save,
  CheckCircle2,
  Info,
  Smartphone,
  CreditCard,
  Layers,
} from 'lucide-react';
import { BusinessSettings, MenuItemKey, Customer, InternetPackage } from '../types/index.ts';

interface SettingsViewProps {
  settings: BusinessSettings;
  customers?: Customer[];
  packages?: InternetPackage[];
  onSaveSettings: (nextSettings: BusinessSettings) => void;
  onNavigate?: (menu: MenuItemKey) => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  settings,
  customers = [],
  packages = [],
  onSaveSettings,
  onNavigate,
}) => {
  const [formData, setFormData] = useState<BusinessSettings>(settings);
  const [savedNotice, setSavedNotice] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveSettings(formData);
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 3000);
  };

  return (
    <div className="space-y-6 max-w-4xl">
      {savedNotice && (
        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold flex items-center gap-2 animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          <span>Pengaturan usaha RT/RW Net berhasil disimpan secara lokal!</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Business Profile */}
        <div className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs">
          <div className="flex items-center gap-2.5 pb-4 border-b border-slate-100">
            <div className="p-2 rounded-lg bg-blue-50 text-blue-600">
              <Building className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Profil Usaha RT/RW Net</h3>
              <p className="text-xs text-slate-500">
                Identitas yang dicantumkan pada struk kasir dan pesan tagihan
              </p>
            </div>
          </div>

          <div className="pt-4 grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Nama Usaha Hotspot / ISP RT-RW *
              </label>
              <input
                type="text"
                required
                value={formData.businessName}
                onChange={(e) => setFormData({ ...formData, businessName: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Nama Pemilik / Admin Utama *
              </label>
              <input
                type="text"
                required
                value={formData.ownerName}
                onChange={(e) => setFormData({ ...formData, ownerName: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Nomor WhatsApp Admin / CS *
              </label>
              <input
                type="text"
                required
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Wilayah RT / RW</label>
              <input
                type="text"
                value={formData.rtRw}
                onChange={(e) => setFormData({ ...formData, rtRw: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block font-semibold text-slate-700 mb-1">
                Alamat Loket / Pos Pembayaran
              </label>
              <input
                type="text"
                value={formData.address}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block font-semibold text-slate-700 mb-1">
                Informasi Rekening Pembayaran (Ditampilkan di Struk & WA)
              </label>
              <input
                type="text"
                value={formData.paymentNoticeBank}
                onChange={(e) => setFormData({ ...formData, paymentNoticeBank: e.target.value })}
                placeholder="Contoh: BCA 1234567890 a.n Adi Kusuma | QRIS tersedia di pos"
                className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              />
            </div>
          </div>
        </div>



        {/* System Architecture Information Card */}
        <div className="bg-slate-50 rounded-2xl border border-slate-200 p-5 text-xs text-slate-600">
          <div className="flex items-center gap-2 font-bold text-slate-900 mb-2">
            <Layers className="w-4 h-4 text-blue-600" />
            <span>Kesiapan Tahap Lanjutan</span>
          </div>
          <p className="leading-relaxed">
            Struktur data dan tata kelola navigasi telah dibangun secara modular. Integrasi database
            permanen, payment gateway otomatis, dan router MikroTik RouterOS API siap dihubungkan
            secara bertahap tanpa perlu mengubah kerangka UI saat ini.
          </p>
        </div>

        {/* Submit Button */}
        <div className="flex justify-end">
          <button
            type="submit"
            className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs flex items-center gap-2 shadow-xs transition-colors"
          >
            <Save className="w-4 h-4" />
            <span>Simpan Pengaturan Usaha</span>
          </button>
        </div>
      </form>
    </div>
  );
};
