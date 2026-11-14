import React, { useState } from 'react';
import {
  Server,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  Cpu,
  HardDrive,
  Activity,
  Layers,
  Shield,
  Sliders,
  ExternalLink,
  Info,
} from 'lucide-react';
import { RouterConfig } from '../types/index.ts';

interface MikrotikViewProps {
  routerConfig: RouterConfig;
}

export const MikrotikView: React.FC<MikrotikViewProps> = ({ routerConfig }) => {
  const [host, setHost] = useState(routerConfig.host);
  const [apiPort, setApiPort] = useState(routerConfig.apiPort);
  const [username, setUsername] = useState(routerConfig.username);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  const handleTestConnection = (e: React.FormEvent) => {
    e.preventDefault();
    setIsTesting(true);
    setTestResult(null);

    setTimeout(() => {
      setIsTesting(false);
      setTestResult(
        'Simulasi Uji Coba: Sesuai spesifikasi, modul integrasi MikroTik belum diaktifkan. Tidak ada permintaan jaringan dikirim ke router fisik.'
      );
    }, 1000);
  };

  return (
    <div className="space-y-6">
      {/* Prominent Connection Status Notice Banner */}
      <div className="bg-amber-50 border border-amber-200/90 rounded-2xl p-5 shadow-xs">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center shrink-0">
              <Server className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-sm font-bold text-amber-950">
                  Status Koneksi Router: Belum Terhubung
                </h3>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-200/70 text-amber-900 uppercase">
                  Tahap Persiapan
                </span>
              </div>
              <p className="text-xs text-amber-800 mt-1 leading-relaxed">
                Aplikasi berada pada mode pratinjau kerangka antarmuka. Integrasi langsung ke RouterOS
                MikroTik via API (Port 8728/8729) belum dihubungkan demi keamanan dan stabilitas.
              </p>
            </div>
          </div>

          <div className="shrink-0 flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse" />
            <span className="text-xs font-semibold text-amber-900">Modul Simulasi</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Router Settings Form */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100">
            <div>
              <h3 className="text-base font-bold text-slate-900">Konfigurasi Akses RouterOS</h3>
              <p className="text-xs text-slate-500">
                Parameter alamat IP dan port API MikroTik untuk integrasi mendatang
              </p>
            </div>
            <div className="p-2 rounded-lg bg-slate-100 text-slate-600">
              <Sliders className="w-4 h-4" />
            </div>
          </div>

          <form onSubmit={handleTestConnection} className="py-4 space-y-4 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Nama Label Router
                </label>
                <input
                  type="text"
                  disabled
                  value={routerConfig.routerName}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-slate-600 cursor-not-allowed"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Target Model RouterBOARD
                </label>
                <input
                  type="text"
                  disabled
                  value={routerConfig.modelTarget}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-slate-600 cursor-not-allowed"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="sm:col-span-2">
                <label className="block font-semibold text-slate-700 mb-1">
                  IP Address Router (Gateway)
                </label>
                <input
                  type="text"
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  placeholder="192.168.88.1"
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 font-mono text-xs focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
                <span className="text-[10px] text-slate-400 mt-1 block">
                  IP lokal router atau VPN tunnel admin
                </span>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Port API Service</label>
                <input
                  type="number"
                  value={apiPort}
                  onChange={(e) => setApiPort(Number(e.target.value))}
                  placeholder="8728"
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 font-mono text-xs focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
                <span className="text-[10px] text-slate-400 mt-1 block">Default API: 8728</span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Username Akun API
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="admin_billing"
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 font-mono text-xs focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Password Akun API
                </label>
                <input
                  type="password"
                  disabled
                  value="••••••••••••"
                  placeholder="Password aman"
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed"
                />
                <span className="text-[10px] text-amber-600 mt-1 block">
                  Kredensial tidak disimpan di frontend (keamanan kode).
                </span>
              </div>
            </div>

            {testResult && (
              <div className="p-3 rounded-xl bg-slate-100 border border-slate-200 text-slate-700 text-xs flex items-start gap-2">
                <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                <p>{testResult}</p>
              </div>
            )}

            <div className="pt-2 flex items-center justify-between">
              <span className="text-xs text-slate-500">
                Penyimpanan konfigurasi siap saat backend diaktifkan.
              </span>
              <button
                type="submit"
                disabled={isTesting}
                className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-900 text-white font-semibold flex items-center gap-1.5 transition-colors shadow-xs"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isTesting ? 'animate-spin' : ''}`} />
                <span>{isTesting ? 'Memeriksa...' : 'Uji Koneksi (Simulasi)'}</span>
              </button>
            </div>
          </form>
        </div>

        {/* Roadmap & Safe Architecture Checklist */}
        <div className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs flex flex-col justify-between">
          <div>
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
              <Shield className="w-4 h-4 text-blue-600" />
              Panduan Arsitektur MikroTik
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Standar integrasi aman RT/RW Net
            </p>

            <ul className="mt-4 space-y-3 text-xs text-slate-600">
              <li className="flex items-start gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-1.5 shrink-0" />
                <span>
                  <strong>PPP Secrets / PPPoE:</strong> Sinkronisasi akun rumahan langsung dari
                  data pelanggan.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-1.5 shrink-0" />
                <span>
                  <strong>Hotspot Users:</strong> Pembuatan kode voucher dengan masa aktif dan
                  shared user.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-1.5 shrink-0" />
                <span>
                  <strong>Isolir Otomatis:</strong> Penambahan IP ke address-list isolir jika lewat
                  jatuh tempo.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-1.5 shrink-0" />
                <span>
                  <strong>Queue Bandwidth:</strong> Pengaturan limit upload/download otomatis sesuai
                  paket.
                </span>
              </li>
            </ul>
          </div>

          <div className="mt-6 p-3 rounded-xl bg-blue-50 border border-blue-200 text-xs text-blue-900">
            <strong>Catatan Pengembang:</strong>
            <p className="mt-1 text-[11px] leading-relaxed text-blue-800">
              Kode frontend ini dirancang bersih dan modular agar modul RouterOS API dapat dipasang di
              layer server (Node.js/Express) tanpa merombak UI.
            </p>
          </div>
        </div>
      </div>

      {/* Simulated Interface Status (Preview Only) */}
      <div className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div>
            <h4 className="text-sm font-bold text-slate-900">
              Pratinjau Interface Router (Data Contoh)
            </h4>
            <p className="text-xs text-slate-500">
              Contoh rancangan pemantauan interface fisik dan virtual
            </p>
          </div>
          <span className="text-[10px] font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
            Simulasi UI
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-4">
          <div className="p-3 rounded-xl border border-slate-200 bg-slate-50/60">
            <div className="flex items-center justify-between">
              <span className="font-mono font-bold text-slate-800 text-xs">ether1-WAN</span>
              <span className="text-[10px] text-slate-500 font-semibold bg-slate-200 px-1.5 py-0.5 rounded">
                Idle
              </span>
            </div>
            <p className="text-[11px] text-slate-500 mt-1">Uplink ISP Fiber Optic</p>
            <div className="mt-2 text-xs font-semibold text-slate-700">0 Kbps / 0 Kbps</div>
          </div>

          <div className="p-3 rounded-xl border border-slate-200 bg-slate-50/60">
            <div className="flex items-center justify-between">
              <span className="font-mono font-bold text-slate-800 text-xs">ether2-LAN</span>
              <span className="text-[10px] text-slate-500 font-semibold bg-slate-200 px-1.5 py-0.5 rounded">
                Idle
              </span>
            </div>
            <p className="text-[11px] text-slate-500 mt-1">Distribusi Switch OLT / Hub</p>
            <div className="mt-2 text-xs font-semibold text-slate-700">0 Kbps / 0 Kbps</div>
          </div>

          <div className="p-3 rounded-xl border border-slate-200 bg-slate-50/60">
            <div className="flex items-center justify-between">
              <span className="font-mono font-bold text-slate-800 text-xs">ether3-Hotspot</span>
              <span className="text-[10px] text-slate-500 font-semibold bg-slate-200 px-1.5 py-0.5 rounded">
                Idle
              </span>
            </div>
            <p className="text-[11px] text-slate-500 mt-1">Access Point Warga</p>
            <div className="mt-2 text-xs font-semibold text-slate-700">0 Kbps / 0 Kbps</div>
          </div>

          <div className="p-3 rounded-xl border border-slate-200 bg-slate-50/60">
            <div className="flex items-center justify-between">
              <span className="font-mono font-bold text-slate-800 text-xs">&lt;pppoe-in&gt;</span>
              <span className="text-[10px] text-slate-500 font-semibold bg-slate-200 px-1.5 py-0.5 rounded">
                Virtual
              </span>
            </div>
            <p className="text-[11px] text-slate-500 mt-1">PPPoE Server Binding</p>
            <div className="mt-2 text-xs font-semibold text-slate-700">Server Ready</div>
          </div>
        </div>
      </div>
    </div>
  );
};
