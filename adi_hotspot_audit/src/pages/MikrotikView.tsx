import React, { useState, useEffect } from 'react';
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
  Info,
  Lock,
  Eye,
  EyeOff,
  Save,
  Clock,
  Wifi,
  Radio,
  Check,
  XCircle,
} from 'lucide-react';
import { RouterConfig } from '../types/index.ts';
import {
  fetchMikrotikConfigFromApi,
  saveMikrotikConfigToApi,
  testMikrotikConnectionApi,
} from '../services/apiService.ts';

interface MikrotikViewProps {
  routerConfig: RouterConfig;
  onConfigUpdated?: (config: RouterConfig) => void;
}

const ROUTER_MODEL_PRESETS = [
  { id: 'RB4011iGS+RM', name: 'MikroTik RB4011iGS+RM (10x GbE + 1x SFP+ 10Gbps, Quad-Core 1.4GHz)' },
  { id: 'RB5009UG+S+IN', name: 'MikroTik RB5009UG+S+IN (7x GbE + 1x 2.5GbE + 1x SFP+ 10Gbps)' },
  { id: 'CCR2004-16G-2S+', name: 'MikroTik CCR2004-16G-2S+ (16x GbE + 2x SFP+ 10Gbps Cloud Core)' },
  { id: 'RB750Gr3', name: 'MikroTik RB750Gr3 / hEX (5x Gigabit Ethernet, Dual-Core 880MHz)' },
  { id: 'RB3011UiAS-RM', name: 'MikroTik RB3011UiAS-RM (10x GbE + 1x SFP, Dual-Core 1.4GHz)' },
  { id: 'CCR1009-7G-1C-1S+', name: 'MikroTik CCR1009-7G-1C-1S+ (Tilera 9-Core, Cloud Core Router)' },
  { id: 'CHR-x86', name: 'MikroTik CHR (Cloud Hosted Router x86 / VM Proxmox / KVM)' },
  { id: 'Custom', name: 'Model RouterOS Lainnya (RouterOS v7 / v6.43+)' },
];

export const MikrotikView: React.FC<MikrotikViewProps> = ({
  routerConfig: initialConfig,
  onConfigUpdated,
}) => {
  // Form fields
  const [routerName, setRouterName] = useState(initialConfig.routerName || 'MikroTik RB4011');
  const [modelTarget, setModelTarget] = useState(initialConfig.modelTarget || 'RB4011iGS+RM');
  const [host, setHost] = useState(initialConfig.host || '192.168.88.1');
  const [apiPort, setApiPort] = useState<number>(initialConfig.apiPort || 8728);
  const [useSsl, setUseSsl] = useState<boolean>(Boolean(initialConfig.useSsl));
  const [username, setUsername] = useState(initialConfig.username || 'admin');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [timeoutSeconds, setTimeoutSeconds] = useState<number>(initialConfig.timeoutSeconds || 10);
  const [notes, setNotes] = useState(initialConfig.notes || '');

  // Status and details from backend
  const [isPasswordConfigured, setIsPasswordConfigured] = useState<boolean>(
    Boolean(initialConfig.isPasswordConfigured)
  );
  const [isEncryptionKeyConfigured, setIsEncryptionKeyConfigured] = useState<boolean>(
    initialConfig.isEncryptionKeyConfigured !== false
  );
  const [currentStatus, setCurrentStatus] = useState<string>(
    initialConfig.status || 'disconnected'
  );
  const [lastTestedAt, setLastTestedAt] = useState<string | null>(
    initialConfig.lastTestedAt || null
  );
  const [lastStatusMessage, setLastStatusMessage] = useState<string | null>(
    initialConfig.lastStatusMessage || null
  );
  const [rosVersionPreview, setRosVersionPreview] = useState<string>(
    initialConfig.rosVersionPreview || 'RouterOS v7.x'
  );

  // Router system info collected during successful real connection
  const [liveInfo, setLiveInfo] = useState<{
    identity?: string;
    boardName?: string;
    version?: string;
    cpuLoad?: number;
    uptime?: string;
    platform?: string;
  } | null>(null);

  // UI state
  const [isSaving, setIsSaving] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  const [isTesting, setIsTesting] = useState(false);
  const [testFeedback, setTestFeedback] = useState<{
    success: boolean;
    message: string;
    errorDetails?: string;
  } | null>(null);

  // Sync with PostgreSQL on component mount
  useEffect(() => {
    let isMounted = true;
    async function loadLatestConfig() {
      const config = await fetchMikrotikConfigFromApi();
      if (config && isMounted) {
        setRouterName(config.routerName || 'MikroTik RB4011');
        setModelTarget(config.modelTarget || 'RB4011iGS+RM');
        setHost(config.host || '192.168.88.1');
        setApiPort(config.apiPort || (config.useSsl ? 8729 : 8728));
        setUseSsl(Boolean(config.useSsl));
        setUsername(config.username || 'admin');
        setIsPasswordConfigured(Boolean(config.isPasswordConfigured));
        setIsEncryptionKeyConfigured(config.isEncryptionKeyConfigured !== false);
        setCurrentStatus(config.status || 'disconnected');
        setLastTestedAt(config.lastTestedAt || null);
        setLastStatusMessage(config.lastStatusMessage || null);
        setRosVersionPreview(config.rosVersionPreview || 'RouterOS v7.x');
        setTimeoutSeconds(config.timeoutSeconds || 10);
        setNotes(config.notes || '');

        onConfigUpdated?.(config);
      }
    }
    loadLatestConfig();
    return () => {
      isMounted = false;
    };
  }, []);

  // Handle SSL switch toggle (auto suggest default port if unchanged)
  const handleToggleSsl = (nextSsl: boolean) => {
    setUseSsl(nextSsl);
    if (nextSsl && apiPort === 8728) {
      setApiPort(8729);
    } else if (!nextSsl && apiPort === 8729) {
      setApiPort(8728);
    }
  };

  // 1. Simpan Konfigurasi ke PostgreSQL
  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setSaveFeedback(null);

    try {
      const payload: Partial<RouterConfig> = {
        routerName: routerName.trim(),
        modelTarget,
        host: host.trim(),
        apiPort: Number(apiPort) || 8728,
        useSsl,
        username: username.trim(),
        timeoutSeconds: Number(timeoutSeconds) || 10,
        notes: notes.trim(),
        rosVersionPreview,
      };

      // Hanya kirim password jika pengguna memasukkan nilai baru
      if (password && password.trim() !== '') {
        payload.password = password.trim();
      }

      const res = await saveMikrotikConfigToApi(payload);

      if (res.success) {
        setSaveFeedback({
          type: 'success',
          message:
            res.message ||
            'Konfigurasi router MikroTik berhasil disimpan secara permanen ke database PostgreSQL.',
        });
        if (password.trim() !== '') {
          setIsPasswordConfigured(true);
          setPassword('');
        }

        // Muat ulang konfigurasi segar dari database
        const updated = await fetchMikrotikConfigFromApi();
        if (updated) {
          setIsPasswordConfigured(Boolean(updated.isPasswordConfigured));
          setIsEncryptionKeyConfigured(updated.isEncryptionKeyConfigured !== false);
          onConfigUpdated?.(updated);
        }
      } else {
        setSaveFeedback({
          type: 'error',
          message: res.message || 'Gagal menyimpan konfigurasi router ke database.',
        });
      }
    } catch (err: any) {
      setSaveFeedback({
        type: 'error',
        message: err?.message || 'Terjadi kesalahan sistem saat menghubungi backend server.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  // 2. Uji Koneksi RouterOS API Nyata
  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestFeedback(null);
    setSaveFeedback(null);

    try {
      const testParams: {
        host: string;
        apiPort: number;
        username: string;
        password?: string;
        useSsl: boolean;
        timeoutSeconds: number;
      } = {
        host: host.trim(),
        apiPort: Number(apiPort) || (useSsl ? 8729 : 8728),
        username: username.trim(),
        useSsl,
        timeoutSeconds: Number(timeoutSeconds) || 10,
      };

      // Jika ada input password baru di form, gunakan untuk pengujian
      if (password && password.trim() !== '') {
        testParams.password = password.trim();
      }

      const result = await testMikrotikConnectionApi(testParams);

      setTestFeedback({
        success: result.success,
        message: result.message,
        errorDetails: result.errorDetails,
      });

      if (result.success && result.data) {
        setCurrentStatus('connected');
        setLiveInfo(result.data);
        setLastTestedAt(result.data.testedAt || new Date().toISOString());
        setLastStatusMessage(result.message);
        if (result.data.version) {
          setRosVersionPreview(`RouterOS ${result.data.version}`);
        }
      } else {
        setCurrentStatus('disconnected');
        setLastTestedAt(new Date().toISOString());
        setLastStatusMessage(result.message);
      }

      // Ambil kembali status terbaru dari database
      const updated = await fetchMikrotikConfigFromApi();
      if (updated) {
        setCurrentStatus(updated.status);
        setLastTestedAt(updated.lastTestedAt || null);
        setLastStatusMessage(updated.lastStatusMessage || null);
        onConfigUpdated?.(updated);
      }
    } catch (err: any) {
      setTestFeedback({
        success: false,
        message: err?.message || 'Terjadi kesalahan saat memanggil pengujian koneksi RouterOS API.',
      });
      setCurrentStatus('disconnected');
    } finally {
      setIsTesting(false);
    }
  };

  const isConnected = currentStatus === 'connected';

  return (
    <div className="space-y-6">
      {/* Peringatan Kunci Enkripsi MIKROTIK_ENCRYPTION_KEY jika belum disetel di server */}
      {!isEncryptionKeyConfigured && (
        <div className="bg-rose-50 border border-rose-300 rounded-2xl p-4 shadow-xs">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-rose-100 text-rose-700 flex items-center justify-center shrink-0">
              <Lock className="w-5 h-5" />
            </div>
            <div className="flex-1">
              <h4 className="text-sm font-bold text-rose-950">
                Peringatan Keamanan: Kunci Enkripsi MIKROTIK_ENCRYPTION_KEY Belum Dikonfigurasi
              </h4>
              <p className="text-xs text-rose-800 mt-1 leading-relaxed">
                Backend menolak penyimpanan atau pembacaan password router demi melindungi kerahasiaan
                jaringan. Harap tambahkan baris berikut pada file <code className="font-mono bg-rose-100 px-1.5 py-0.5 rounded text-rose-900 font-bold">.env</code> di server Ubuntu Anda:
              </p>
              <div className="mt-2 bg-slate-900 text-slate-100 font-mono text-xs px-3 py-2 rounded-lg select-all">
                MIKROTIK_ENCRYPTION_KEY="masukkan_frasa_rahasia_acak_minimal_32_karakter_di_sini"
              </div>
              <p className="text-[11px] text-rose-700 mt-1.5">
                Setelah menambahkan kunci ke .env server Ubuntu, restart service PM2 / Node.js Anda.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Connection Status Banner (Berdasarkan Hasil Autentikasi Nyata RouterOS API) */}
      <div
        className={`border rounded-2xl p-5 shadow-xs transition-colors ${
          isConnected
            ? 'bg-emerald-50/90 border-emerald-300'
            : 'bg-slate-50 border-slate-200'
        }`}
      >
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div
              className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${
                isConnected
                  ? 'bg-emerald-100 text-emerald-800'
                  : 'bg-slate-200 text-slate-700'
              }`}
            >
              <Server className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-base font-bold text-slate-900">
                  {isConnected ? (
                    <span className="text-emerald-950 flex items-center gap-1.5">
                      Status Router: Terhubung (ONLINE)
                    </span>
                  ) : (
                    <span>Status Router: Belum Terhubung (OFFLINE / Siap Diuji)</span>
                  )}
                </h3>
                <span
                  className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${
                    isConnected
                      ? 'bg-emerald-200/80 text-emerald-900'
                      : 'bg-slate-200 text-slate-700'
                  }`}
                >
                  {isConnected ? 'API Terverifikasi' : 'Single Router'}
                </span>
              </div>
              <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                {lastStatusMessage ||
                  (isConnected
                    ? 'Koneksi RouterOS API aktif dan autentikasi berhasil.'
                    : 'Konfigurasi tersimpan di PostgreSQL. Klik "Uji Koneksi RouterOS API" untuk memverifikasi soket jaringan ke router fisik.')}
              </p>
              {lastTestedAt && (
                <div className="flex items-center gap-1 text-[11px] text-slate-500 mt-1.5">
                  <Clock className="w-3.5 h-3.5 text-slate-400" />
                  <span>Pengujian terakhir: {new Date(lastTestedAt).toLocaleString('id-ID')}</span>
                </div>
              )}
            </div>
          </div>

          <div className="shrink-0 flex items-center gap-2">
            <span
              className={`w-3 h-3 rounded-full ${
                isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'
              }`}
            />
            <span className="text-xs font-semibold text-slate-800">
              {isConnected ? 'Router Aktif' : 'Standby'}
            </span>
          </div>
        </div>

        {/* Live Router System Information Cards if Connected */}
        {liveInfo && (
          <div className="mt-4 pt-4 border-t border-emerald-200/70 grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-white/80 p-2.5 rounded-xl border border-emerald-100">
              <span className="text-[10px] text-slate-500 font-medium block">Router Identity</span>
              <span className="text-xs font-bold text-slate-900 font-mono">
                {liveInfo.identity || host}
              </span>
            </div>
            <div className="bg-white/80 p-2.5 rounded-xl border border-emerald-100">
              <span className="text-[10px] text-slate-500 font-medium block">Model Hardware</span>
              <span className="text-xs font-bold text-slate-900">
                {liveInfo.boardName || modelTarget}
              </span>
            </div>
            <div className="bg-white/80 p-2.5 rounded-xl border border-emerald-100">
              <span className="text-[10px] text-slate-500 font-medium block">Versi RouterOS</span>
              <span className="text-xs font-bold text-slate-900 font-mono">
                {liveInfo.version ? `v${liveInfo.version}` : rosVersionPreview}
              </span>
            </div>
            <div className="bg-white/80 p-2.5 rounded-xl border border-emerald-100">
              <span className="text-[10px] text-slate-500 font-medium block">Beban CPU & Uptime</span>
              <span className="text-xs font-bold text-slate-900 font-mono">
                {liveInfo.cpuLoad !== undefined ? `${liveInfo.cpuLoad}% CPU` : 'Normal'}
                {liveInfo.uptime ? ` • ${liveInfo.uptime}` : ''}
              </span>
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Router Settings Form (Single-Router PostgreSQL Configuration) */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100">
            <div>
              <h3 className="text-base font-bold text-slate-900">Konfigurasi Akses RouterOS MikroTik</h3>
              <p className="text-xs text-slate-500">
                Pengaturan koneksi API ke router utama jaringan (tersimpan aman di PostgreSQL)
              </p>
            </div>
            <div className="p-2 rounded-lg bg-blue-50 text-blue-600">
              <Sliders className="w-4 h-4" />
            </div>
          </div>

          <form onSubmit={handleSaveConfig} className="py-4 space-y-4 text-xs">
            {/* Feedback Notifications */}
            {saveFeedback && (
              <div
                className={`p-3.5 rounded-xl border flex items-start gap-2.5 ${
                  saveFeedback.type === 'success'
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                    : 'bg-rose-50 border-rose-200 text-rose-900'
                }`}
              >
                {saveFeedback.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                )}
                <div className="text-xs leading-relaxed">{saveFeedback.message}</div>
              </div>
            )}

            {testFeedback && (
              <div
                className={`p-3.5 rounded-xl border flex items-start gap-2.5 ${
                  testFeedback.success
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                    : 'bg-rose-50 border-rose-200 text-rose-900'
                }`}
              >
                {testFeedback.success ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                ) : (
                  <XCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                )}
                <div>
                  <div className="font-semibold text-xs">{testFeedback.message}</div>
                  {testFeedback.errorDetails && (
                    <div className="text-[11px] font-mono mt-1 opacity-80">
                      Kode Error: {testFeedback.errorDetails}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Nama Router & Model Target */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Nama Label Router <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={routerName}
                  onChange={(e) => setRouterName(e.target.value)}
                  placeholder="Contoh: MikroTik RB4011 Gateway"
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-slate-800"
                />
                <span className="text-[10px] text-slate-400 mt-1 block">
                  Identitas penamaan router pada sistem billing
                </span>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Model RouterBOARD Target <span className="text-rose-500">*</span>
                </label>
                <select
                  value={modelTarget}
                  onChange={(e) => setModelTarget(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-slate-800 bg-white"
                >
                  {ROUTER_MODEL_PRESETS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
                <span className="text-[10px] text-slate-400 mt-1 block">
                  Model perangkat yang dioperasikan
                </span>
              </div>
            </div>

            {/* IP Address, Port & SSL */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="sm:col-span-2">
                <label className="block font-semibold text-slate-700 mb-1">
                  IP Address Router / Gateway <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  placeholder="192.168.88.1"
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 font-mono text-xs focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
                <span className="text-[10px] text-slate-400 mt-1 block">
                  Alamat IP LAN router atau IP tunnel VPN server billing
                </span>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Port API Service <span className="text-rose-500">*</span>
                </label>
                <input
                  type="number"
                  required
                  min={1}
                  max={65535}
                  value={apiPort}
                  onChange={(e) => setApiPort(Number(e.target.value))}
                  placeholder={useSsl ? '8729' : '8728'}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 font-mono text-xs focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
                <span className="text-[10px] text-slate-400 mt-1 block">
                  {useSsl ? 'Default API-SSL: 8729' : 'Default API: 8728'}
                </span>
              </div>
            </div>

            {/* Opsi Keamanan SSL */}
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center justify-between">
              <div>
                <span className="font-semibold text-slate-800 text-xs block">
                  Gunakan Koneksi Aman API-SSL (Port 8729 / TLS)
                </span>
                <span className="text-[11px] text-slate-500">
                  Enkripsi lalu lintas API RouterOS menggunakan sertifikat TLS/SSL
                </span>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={useSsl}
                  onChange={(e) => handleToggleSsl(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
              </label>
            </div>

            {/* Username & Password */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Username Akun API <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="admin"
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 font-mono text-xs focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
                <span className="text-[10px] text-slate-400 mt-1 block">
                  Akun user di menu MikroTik System &gt; Users (grup write/full)
                </span>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Password Akun API {isPasswordConfigured && <span className="text-emerald-600 font-normal">(Tersimpan Aman)</span>}
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={
                      isPasswordConfigured
                        ? '•••••••• (Biarkan kosong jika tidak diubah)'
                        : 'Masukkan password API router'
                    }
                    className="w-full px-3 py-2 pr-9 rounded-lg border border-slate-200 font-mono text-xs focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <span className="text-[10px] text-slate-400 mt-1 block">
                  Dienkripsi AES-256-GCM di backend. Password lama tidak terhapus jika kolom ini kosong.
                </span>
              </div>
            </div>

            {/* Timeout & Catatan */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Batas Waktu Timeout (Detik)
                </label>
                <input
                  type="number"
                  min={3}
                  max={30}
                  value={timeoutSeconds}
                  onChange={(e) => setTimeoutSeconds(Number(e.target.value))}
                  placeholder="10"
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 font-mono text-xs focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
                <span className="text-[10px] text-slate-400 mt-1 block">
                  Rentang 3 - 30 detik (standar: 10s)
                </span>
              </div>

              <div className="sm:col-span-2">
                <label className="block font-semibold text-slate-700 mb-1">Catatan Tambahan</label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Lokasi rack server, jalur uplink, atau penanda khusus"
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-slate-800"
                />
              </div>
            </div>

            {/* Tombol Aksi: Simpan & Uji Koneksi */}
            <div className="pt-3 border-t border-slate-100 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
              <span className="text-xs text-slate-500">
                Arsitektur Single-Router: Konfigurasi berlaku untuk seluruh tagihan dan isolir instalasi ini.
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  disabled={isSaving || isTesting}
                  className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold flex items-center justify-center gap-1.5 transition-colors shadow-xs disabled:opacity-50"
                >
                  <Save className={`w-3.5 h-3.5 ${isSaving ? 'animate-spin' : ''}`} />
                  <span>{isSaving ? 'Menyimpan...' : 'Simpan Konfigurasi'}</span>
                </button>

                <button
                  type="button"
                  onClick={handleTestConnection}
                  disabled={isTesting || isSaving}
                  className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-900 text-white font-semibold flex items-center justify-center gap-1.5 transition-colors shadow-xs disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isTesting ? 'animate-spin' : ''}`} />
                  <span>{isTesting ? 'Menghubungkan...' : 'Uji Koneksi RouterOS API'}</span>
                </button>
              </div>
            </div>
          </form>
        </div>

        {/* Security & RouterOS Operational Guidance */}
        <div className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs flex flex-col justify-between">
          <div>
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
              <Shield className="w-4 h-4 text-blue-600" />
              Keamanan Integrasi MikroTik
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Standar operasional Single-Router RT/RW Net
            </p>

            <ul className="mt-4 space-y-3 text-xs text-slate-600">
              <li className="flex items-start gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-1.5 shrink-0" />
                <span>
                  <strong>Enkripsi AES-256-GCM:</strong> Password router disimpan terenkripsi di
                  database PostgreSQL dan tidak pernah diekspos ke antarmuka web.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-1.5 shrink-0" />
                <span>
                  <strong>Proteksi SSRF:</strong> Backend memvalidasi host IP/hostname dan mencegah
                  akses ke endpoint metadata cloud secara ketat.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-1.5 shrink-0" />
                <span>
                  <strong>Layanan API RouterOS:</strong> Pastikan service <code className="font-mono text-blue-700 bg-blue-50 px-1 py-0.5 rounded">api</code> (8728) atau <code className="font-mono text-blue-700 bg-blue-50 px-1 py-0.5 rounded">api-ssl</code> (8729) telah diaktifkan pada menu IP &gt; Services di WinBox / WebFig.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-1.5 shrink-0" />
                <span>
                  <strong>Firewall IP Filter:</strong> Disarankan menambahkan aturan firewall <code className="font-mono text-slate-700 bg-slate-100 px-1 py-0.5 rounded">allow</code> pada port API khusus dari alamat IP server billing Ubuntu.
                </span>
              </li>
            </ul>
          </div>

          <div className="mt-6 p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-700">
            <strong>Catatan Operasional:</strong>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-600">
              Pengujian koneksi dilakukan langsung oleh server backend Node.js menggunakan soket
              TCP/TLS native. Koneksi hanya dinyatakan <strong>ONLINE</strong> jika autentikasi RouterOS berhasil.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
