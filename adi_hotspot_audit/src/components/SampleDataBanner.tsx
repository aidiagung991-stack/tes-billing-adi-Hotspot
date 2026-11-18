import React, { useState } from 'react';
import { CheckCircle2, AlertTriangle, X } from 'lucide-react';
import { DbStatusResponse } from '../services/apiService.ts';

interface SampleDataBannerProps {
  dbStatus?: DbStatusResponse | null;
  dbError?: string | null;
}

export const SampleDataBanner: React.FC<SampleDataBannerProps> = ({ dbStatus, dbError }) => {
  const [isVisible, setIsVisible] = useState(true);

  if (!isVisible) return null;

  const isConnected = Boolean(dbStatus?.isConnected);
  const errorMessage = dbError || dbStatus?.error || dbStatus?.message;

  return (
    <div
      className={`border-b px-4 py-2.5 text-xs flex items-center justify-between shadow-xs transition-colors ${
        isConnected
          ? 'bg-emerald-50 border-emerald-200 text-emerald-950'
          : 'bg-rose-50 border-rose-300 text-rose-950'
      }`}
    >
      <div className="flex items-center gap-2 max-w-5xl">
        <span
          className={`inline-flex items-center gap-1.5 rounded px-2 py-0.5 font-bold text-[11px] shrink-0 ${
            isConnected
              ? 'bg-emerald-200/80 text-emerald-900'
              : 'bg-rose-200/80 text-rose-900'
          }`}
        >
          {isConnected ? (
            <>
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700" />
              PostgreSQL Aktif (adi_hotspot)
            </>
          ) : (
            <>
              <AlertTriangle className="w-3.5 h-3.5 text-rose-700" />
              Koneksi Database Belum Terhubung
            </>
          )}
        </span>
        <p className="leading-relaxed text-[11px]">
          {isConnected ? (
            <>
              <strong>Sumber Data Utama:</strong> Terhubung ke database PostgreSQL{' '}
              <code className="font-mono bg-emerald-100/70 px-1 rounded">{dbStatus?.database}</code> di{' '}
              <code className="font-mono bg-emerald-100/70 px-1 rounded">
                {dbStatus?.host}:{dbStatus?.port}
              </code>
              . Seluruh data pelanggan, paket, tagihan, dan pembayaran dikelola langsung dari database.
            </>
          ) : (
            <>
              <strong>Peringatan Koneksi:</strong> Database PostgreSQL{' '}
              <code className="font-mono bg-rose-100/80 px-1 rounded">adi_hotspot</code> belum terhubung
              {errorMessage ? ` (${errorMessage})` : ''}. Aplikasi tidak menggunakan data contoh atau localStorage sebagai fallback data operasional. Pastikan service PostgreSQL dan backend aktif.
            </>
          )}
        </p>
      </div>
      <button
        onClick={() => setIsVisible(false)}
        className="ml-3 p-1 rounded-md hover:bg-black/5 transition-colors shrink-0"
        title="Tutup pemberitahuan"
        aria-label="Tutup"
      >
        <X className="w-3.5 h-3.5 text-slate-500" />
      </button>
    </div>
  );
};
