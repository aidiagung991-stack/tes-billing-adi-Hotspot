import React, { useState, useMemo, useRef } from 'react';
import {
  Send,
  Radio,
  AlertTriangle,
  Wrench,
  CheckCircle2,
  BellRing,
  Users,
  Clock,
  Play,
  Pause,
  StopCircle,
  History,
  Eye,
  Filter,
  Check,
  X,
  AlertCircle,
  Copy,
  ChevronRight,
  ShieldCheck,
  RefreshCw,
  Search,
} from 'lucide-react';
import {
  Customer,
  InternetPackage,
  BusinessSettings,
  BroadcastType,
  BroadcastCampaign,
  BroadcastRecipientLog,
  WhatsAppMessageLog,
  WhatsAppGatewayConfig,
} from '../types/index.ts';
import {
  defaultBroadcastTemplates,
  loadBroadcastHistory,
  saveBroadcastHistory,
  renderBroadcastMessage,
} from '../utils/broadcastStorage.ts';
import {
  loadWAMessageLogs,
  saveWAMessageLogs,
} from '../utils/whatsappStorage.ts';
import {
  sendBackendBroadcastMessage,
  getBackendGatewayConfig,
} from '../services/whatsappGatewayService.ts';

interface BroadcastViewProps {
  customers: Customer[];
  packages: InternetPackage[];
  settings: BusinessSettings;
}

export const BroadcastView: React.FC<BroadcastViewProps> = ({
  customers,
  packages,
  settings,
}) => {
  const [activeTab, setActiveTab] = useState<'create' | 'history'>('create');

  // Form State
  const [broadcastType, setBroadcastType] = useState<BroadcastType>('outage');
  const [title, setTitle] = useState(defaultBroadcastTemplates[0].title);
  const [messageTemplate, setMessageTemplate] = useState(defaultBroadcastTemplates[0].content);
  const [delaySeconds, setDelaySeconds] = useState<number>(2);

  // Audience Filter State
  const [targetAudience, setTargetAudience] = useState<'all' | 'status' | 'type' | 'package' | 'manual'>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('active');
  const [selectedType, setSelectedType] = useState<string>('pppoe');
  const [selectedPackageId, setSelectedPackageId] = useState<string>(packages[0]?.id || '');
  const [manualSelectedCustomerIds, setManualSelectedCustomerIds] = useState<string[]>([]);
  const [manualSearchQuery, setManualSearchQuery] = useState('');

  // Gateway Config state from backend
  const [gatewayConfig, setGatewayConfig] = useState<WhatsAppGatewayConfig | null>(null);

  // Sending progress state
  const [isSending, setIsSending] = useState(false);
  const [sendProgress, setSendProgress] = useState<{
    currentIndex: number;
    total: number;
    successCount: number;
    failureCount: number;
    currentCustomerName: string;
  } | null>(null);
  const cancelRequestedRef = useRef(false);

  // In-app Confirmation Modal (Replaces browser window.confirm for iframe safety)
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  // Finished Campaign Result Modal (Requirement 4)
  const [finishedCampaignResult, setFinishedCampaignResult] = useState<BroadcastCampaign | null>(null);

  // History State
  const [history, setHistory] = useState<BroadcastCampaign[]>(() => loadBroadcastHistory());
  const [selectedCampaignDetail, setSelectedCampaignDetail] = useState<BroadcastCampaign | null>(null);

  // Toast
  const [toast, setToast] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);

  const showToast = (text: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToast({ text, type });
    setTimeout(() => setToast(null), 4000);
  };

  // Sync gateway configuration from backend on mount
  React.useEffect(() => {
    getBackendGatewayConfig().then((cfg) => {
      if (cfg) setGatewayConfig(cfg);
    });
  }, []);

  // Switch template when type changes
  const handleTypeChange = (type: BroadcastType) => {
    setBroadcastType(type);
    const tpl = defaultBroadcastTemplates.find((t) => t.type === type);
    if (tpl) {
      setTitle(tpl.title);
      setMessageTemplate(tpl.content);
    }
  };

  // Insert variable into message body
  const handleInsertVariable = (variable: string) => {
    setMessageTemplate((prev) => prev + ` ${variable} `);
  };

  // Filter recipients based on audience settings and deduplicate phone numbers
  const recipientList = useMemo(() => {
    let rawList: Customer[] = [];

    if (targetAudience === 'all') {
      rawList = customers;
    } else if (targetAudience === 'status') {
      rawList = customers.filter((c) => c.status === selectedStatus);
    } else if (targetAudience === 'type') {
      rawList = customers.filter((c) => c.type === selectedType);
    } else if (targetAudience === 'package') {
      rawList = customers.filter((c) => c.packageId === selectedPackageId);
    } else if (targetAudience === 'manual') {
      rawList = customers.filter((c) => manualSelectedCustomerIds.includes(c.id));
    }

    // Filter valid phone numbers and avoid duplicate phones in same campaign
    const seenPhones = new Set<string>();
    const deduplicated: Customer[] = [];

    rawList.forEach((cust) => {
      const cleanPhone = (cust.phone || '').replace(/\D/g, '');
      if (cleanPhone.length >= 8 && !seenPhones.has(cleanPhone)) {
        seenPhones.add(cleanPhone);
        deduplicated.push(cust);
      }
    });

    return deduplicated;
  }, [
    customers,
    targetAudience,
    selectedStatus,
    selectedType,
    selectedPackageId,
    manualSelectedCustomerIds,
  ]);

  // Live preview for first recipient
  const sampleRecipient = recipientList[0] || customers[0] || {
    id: 'ADI-SAMPLE',
    name: 'Budi Santoso',
    phone: '081234567890',
    packageName: 'Home Basic 10M',
  };

  const sampleRenderedMessage = useMemo(() => {
    return renderBroadcastMessage(messageTemplate, {
      customerName: sampleRecipient.name,
      customerId: sampleRecipient.id,
      packageName: sampleRecipient.packageName || 'Home Basic 10M',
      businessName: settings.businessName || 'Adi_Hotspot Billing',
      contactPhone: settings.phone || '0812-3456-7890',
    });
  }, [messageTemplate, sampleRecipient, settings]);

  const typeNames: Record<BroadcastType, string> = {
    outage: 'Gangguan Jaringan',
    maintenance: 'Jadwal Maintenance',
    restoration: 'Pemulihan Jaringan',
    announcement: 'Pengumuman Umum',
  };

  const targetAudienceLabel = useMemo(() => {
    if (targetAudience === 'all') return `Semua Pelanggan (${recipientList.length})`;
    if (targetAudience === 'status') {
      const statusMap: Record<string, string> = {
        active: 'Pelanggan Aktif',
        isolated: 'Pelanggan Terisolir',
        inactive: 'Pelanggan Nonaktif',
      };
      return `Status: ${statusMap[selectedStatus] || selectedStatus} (${recipientList.length})`;
    }
    if (targetAudience === 'type') {
      return `Tipe: ${selectedType === 'pppoe' ? 'PPPoE (Rumahan)' : 'Hotspot (Voucher)'} (${recipientList.length})`;
    }
    if (targetAudience === 'package') {
      const pkg = packages.find((p) => p.id === selectedPackageId);
      return `Paket: ${pkg?.name || selectedPackageId} (${recipientList.length})`;
    }
    if (targetAudience === 'manual') {
      return `Pilih Manual (${recipientList.length} dipilih)`;
    }
    return `${recipientList.length} Pelanggan`;
  }, [targetAudience, selectedStatus, selectedType, selectedPackageId, packages, recipientList.length]);

  // Open in-app confirmation modal (no window.confirm to ensure iframe compatibility)
  const handleOpenConfirm = () => {
    if (!title.trim()) {
      showToast('Judul broadcast tidak boleh kosong.', 'error');
      return;
    }

    if (!messageTemplate.trim()) {
      showToast('Isi pesan broadcast tidak boleh kosong.', 'error');
      return;
    }

    if (recipientList.length === 0) {
      showToast('Tidak ada penerima dengan nomor WhatsApp valid untuk kriteria filter ini.', 'error');
      return;
    }

    setShowConfirmModal(true);
  };

  // Execute progressive broadcasting after confirmation
  const handleExecuteBroadcast = async () => {
    setShowConfirmModal(false);

    if (!title.trim()) {
      showToast('Judul broadcast tidak boleh kosong.', 'error');
      return;
    }

    if (!messageTemplate.trim()) {
      showToast('Isi pesan broadcast tidak boleh kosong.', 'error');
      return;
    }

    if (recipientList.length === 0) {
      showToast('Tidak ada penerima dengan nomor WhatsApp valid untuk kriteria filter ini.', 'error');
      return;
    }

    setIsSending(true);
    cancelRequestedRef.current = false;

    const total = recipientList.length;
    let successCount = 0;
    let failureCount = 0;
    const recipientLogs: BroadcastRecipientLog[] = [];
    const newWaLogs: WhatsAppMessageLog[] = [];
    const campaignId = `bc-${Date.now().toString().slice(-6)}`;

    setSendProgress({
      currentIndex: 0,
      total,
      successCount: 0,
      failureCount: 0,
      currentCustomerName: recipientList[0]?.name || '',
    });

    for (let i = 0; i < total; i++) {
      if (cancelRequestedRef.current) {
        showToast('Proses pengiriman broadcast dihentikan oleh admin.', 'info');
        break;
      }

      const cust = recipientList[i];
      setSendProgress({
        currentIndex: i + 1,
        total,
        successCount,
        failureCount,
        currentCustomerName: cust.name,
      });

      const personalizedMessage = renderBroadcastMessage(messageTemplate, {
        customerName: cust.name,
        customerId: cust.id,
        packageName: cust.packageName,
        businessName: settings.businessName,
        contactPhone: settings.phone,
      });

      const targetPhoneClean = (cust.phone || '').trim();
      const timeStr = new Date().toISOString().replace('T', ' ').slice(0, 16);

      try {
        const res = await sendBackendBroadcastMessage({
          targetPhone: targetPhoneClean,
          messageContent: personalizedMessage,
          customerId: cust.id,
          customerName: cust.name,
        });

        if (res.success) {
          successCount++;
          recipientLogs.push({
            customerId: cust.id,
            customerName: cust.name,
            phone: cust.phone,
            status: 'sent',
            sentAt: timeStr,
          });
        } else {
          failureCount++;
          recipientLogs.push({
            customerId: cust.id,
            customerName: cust.name,
            phone: cust.phone,
            status: 'failed',
            errorMessage: res.message || 'Gagal terkirim oleh gateway',
            sentAt: timeStr,
          });
        }

        // Record to unified WhatsApp message logs
        newWaLogs.push({
          id: `walog-${campaignId}-${i + 1}`,
          timestamp: timeStr,
          customerName: cust.name,
          customerId: cust.id,
          phone: targetPhoneClean,
          notificationType: 'broadcast' as any,
          notificationTypeName: `Broadcast: ${typeNames[broadcastType]}`,
          messageContent: personalizedMessage,
          status: res.success ? 'sent' : 'failed',
          errorMessage: res.success ? undefined : res.message,
          referenceId: campaignId.toUpperCase(),
        });
      } catch (err: any) {
        failureCount++;
        recipientLogs.push({
          customerId: cust.id,
          customerName: cust.name,
          phone: cust.phone,
          status: 'failed',
          errorMessage: err?.message || 'Kesalahan koneksi pengiriman backend',
          sentAt: timeStr,
        });
      }

      // Configurable delay between dispatches (except last one)
      if (i < total - 1 && !cancelRequestedRef.current) {
        await new Promise((r) => setTimeout(r, Math.max(delaySeconds, 1) * 1000));
      }
    }

    // Save Campaign to History
    const newCampaign: BroadcastCampaign = {
      id: campaignId,
      title: title.trim(),
      type: broadcastType,
      typeName: typeNames[broadcastType],
      messageContent: messageTemplate,
      totalRecipients: recipientLogs.length,
      successCount,
      failureCount,
      createdAt: new Date().toISOString().replace('T', ' ').slice(0, 16),
      recipients: recipientLogs,
    };

    const updatedHistory = [newCampaign, ...history];
    setHistory(updatedHistory);
    saveBroadcastHistory(updatedHistory);

    // Save to WA message logs
    try {
      const existingLogs = loadWAMessageLogs();
      saveWAMessageLogs([...newWaLogs, ...existingLogs]);
    } catch {
      // non-blocking
    }

    setIsSending(false);
    setSendProgress(null);
    setFinishedCampaignResult(newCampaign);

    if (successCount === 0) {
      showToast(
        `Pengiriman selesai: Semua ${failureCount} pesan gagal dikirim. Silakan periksa rincian laporan dan status gateway.`,
        'error'
      );
    } else if (failureCount > 0) {
      showToast(
        `Broadcast selesai sebagian: ${successCount} berhasil, ${failureCount} gagal dari ${recipientLogs.length} penerima.`,
        'info'
      );
    } else {
      showToast(
        `Broadcast berhasil dikirim ke seluruh ${successCount} penerima!`,
        'success'
      );
    }
  };

  const handleCancelBroadcast = () => {
    cancelRequestedRef.current = true;
  };

  const toggleManualCustomer = (id: string) => {
    setManualSelectedCustomerIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleSelectAllManual = () => {
    if (manualSelectedCustomerIds.length === customers.length) {
      setManualSelectedCustomerIds([]);
    } else {
      setManualSelectedCustomerIds(customers.map((c) => c.id));
    }
  };

  const filteredManualCustomers = useMemo(() => {
    if (!manualSearchQuery.trim()) return customers;
    const q = manualSearchQuery.toLowerCase().trim();
    return customers.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.id.toLowerCase().includes(q) ||
        c.phone.includes(q)
    );
  }, [customers, manualSearchQuery]);

  return (
    <div className="space-y-5">
      {/* Toast */}
      {toast && (
        <div
          className={`fixed top-5 right-5 z-50 text-white text-xs sm:text-sm font-semibold px-4 py-3 rounded-xl shadow-xl flex items-center gap-2.5 border ${
            toast.type === 'error'
              ? 'bg-rose-900 border-rose-700'
              : toast.type === 'info'
              ? 'bg-blue-900 border-blue-700'
              : 'bg-emerald-900 border-emerald-700'
          }`}
        >
          {toast.type === 'error' ? <AlertCircle className="w-4 h-4 text-rose-300" /> : <CheckCircle2 className="w-4 h-4 text-emerald-300" />}
          <span>{toast.text}</span>
        </div>
      )}

      {/* Header & Sub-Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200/90 pb-3">
        <div>
          <h2 className="text-lg sm:text-xl font-bold text-slate-900 flex items-center gap-2">
            <Radio className="w-5 h-5 text-blue-600" />
            <span>Broadcast WhatsApp Massal</span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Kirim pengumuman pemeliharaan, gangguan, atau informasi umum sekaligus ke nomor pelanggan.
          </p>
        </div>

        <div className="flex items-center gap-1.5 p-1 bg-slate-200/70 rounded-xl shrink-0 self-start sm:self-auto text-xs">
          <button
            onClick={() => setActiveTab('create')}
            className={`px-3.5 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 transition-all ${
              activeTab === 'create'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Send className="w-3.5 h-3.5 text-blue-600" />
            <span>Kirim Broadcast</span>
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`px-3.5 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 transition-all ${
              activeTab === 'history'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <History className="w-3.5 h-3.5 text-emerald-600" />
            <span>Riwayat Pengiriman</span>
            <span className="px-1.5 py-0.2 text-[10px] rounded-full bg-slate-100 text-slate-800 font-bold">
              {history.length}
            </span>
          </button>
        </div>
      </div>

      {/* In-app Confirmation Modal (Replaces browser window.confirm for iframe safety) */}
      {showConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center">
                  <Radio className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-sm">Konfirmasi Kirim Broadcast</h3>
                  <p className="text-[11px] text-slate-500">Kirim pesan massal via WhatsApp Gateway</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowConfirmModal(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-slate-500">Judul Kampanye:</span>
                  <span className="font-bold text-slate-900 text-right truncate max-w-[200px]">{title}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-500">Kategori Informasi:</span>
                  <span className="font-semibold text-blue-700">{typeNames[broadcastType]}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-500">Target Penerima:</span>
                  <span className="font-semibold text-slate-800">{targetAudienceLabel}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-500">Jumlah Penerima:</span>
                  <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 font-bold text-[11px]">
                    {recipientList.length} Nomor Valid
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-500">Jeda Antar Pesan:</span>
                  <span className="font-medium text-slate-700">{delaySeconds} Detik</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-500">Status Gateway:</span>
                  {gatewayConfig?.status === 'connected' ? (
                    <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-bold text-[10px] flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-pulse"></span>
                      Online (smg.wablas.com)
                    </span>
                  ) : gatewayConfig?.isTokenConfigured ? (
                    <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 font-bold text-[10px]">
                      Terkonfigurasi
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 font-bold text-[10px]">
                      Token Belum Disimpan
                    </span>
                  )}
                </div>
              </div>

              {gatewayConfig && !gatewayConfig.isTokenConfigured && (
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-[11px] flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <strong>Peringatan Gateway:</strong> Token API Wablas belum tersimpan di backend. Pengiriman kemungkinan akan ditolak oleh gateway sampai token disimpan pada menu WhatsApp Gateway.
                  </div>
                </div>
              )}

              <div className="p-3 rounded-xl bg-blue-50 border border-blue-200 text-blue-900 text-[11px] flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                <div>
                  Pesan akan dikirim secara berurutan dengan jeda aman agar nomor WhatsApp terlindungi dari pemblokiran. Anda dapat membatalkan pengiriman kapan saja melalui tombol hentikan pada jendela progres.
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowConfirmModal(false)}
                className="px-4 py-2 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-100 text-xs font-semibold transition-colors"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleExecuteBroadcast}
                className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-md shadow-blue-600/20 flex items-center gap-1.5 transition-all cursor-pointer active:scale-98"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Mulai Kirim Sekarang ({recipientList.length} Pesan)</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Progress Overlay Modal if sending */}
      {isSending && sendProgress && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 text-center space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-blue-100 text-blue-600 flex items-center justify-center mx-auto animate-pulse">
              <Send className="w-6 h-6" />
            </div>

            <div>
              <h3 className="font-bold text-slate-900 text-base">Mengirim Broadcast WhatsApp...</h3>
              <p className="text-xs text-slate-500 mt-1">
                Sedang mengirim ke: <strong className="text-slate-800">{sendProgress.currentCustomerName}</strong>
              </p>
            </div>

            {/* Progress bar */}
            <div className="space-y-1.5">
              <div className="h-3 w-full bg-slate-100 rounded-full overflow-hidden border border-slate-200">
                <div
                  className="h-full bg-blue-600 transition-all duration-300"
                  style={{
                    width: `${Math.round((sendProgress.currentIndex / sendProgress.total) * 100)}%`,
                  }}
                />
              </div>
              <div className="flex justify-between text-xs text-slate-500 font-semibold">
                <span>{sendProgress.currentIndex} dari {sendProgress.total}</span>
                <span>{Math.round((sendProgress.currentIndex / sendProgress.total) * 100)}%</span>
              </div>
            </div>

            {/* Metrics */}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 font-semibold">
                Berhasil: {sendProgress.successCount}
              </div>
              <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 font-semibold">
                Gagal: {sendProgress.failureCount}
              </div>
            </div>

            <p className="text-[11px] text-slate-400">
              Jeda antar pesan: {delaySeconds} detik untuk menjaga reputasi nomor pengirim.
            </p>

            <button
              onClick={handleCancelBroadcast}
              className="px-4 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold border border-rose-200 flex items-center justify-center gap-1.5 mx-auto transition-colors"
            >
              <StopCircle className="w-4 h-4" />
              <span>Hentikan Pengiriman Antrean</span>
            </button>
          </div>
        </div>
      )}

      {/* TAB 1: FORM BROADCAST */}
      {activeTab === 'create' && (
        <div className="space-y-4">
          {gatewayConfig && !gatewayConfig.isTokenConfigured && (
            <div className="p-4 rounded-xl bg-amber-50/90 border border-amber-200 text-amber-900 flex items-start gap-3 text-xs shadow-xs">
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div className="flex-1">
                <strong className="font-bold text-amber-950 block text-sm mb-0.5">
                  Perhatian: WhatsApp Gateway Belum Dikonfigurasi
                </strong>
                <span>
                  Token API Wablas belum tersimpan di backend. Pesan broadcast membutuhkan token aktif untuk dikirim. Silakan konfigurasi kredensial pada menu <strong>WhatsApp Gateway</strong> terlebih dahulu.
                </span>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            {/* Left Column: Configuration & Message Body */}
            <div className="lg:col-span-7 space-y-4">
              {/* 1. Tipe Broadcast */}
              <div className="bg-white rounded-xl p-4.5 border border-slate-200/90 shadow-xs space-y-3">
                <label className="text-xs font-bold text-slate-900 uppercase tracking-wider block">
                  1. Pilih Jenis Informasi Broadcast:
                </label>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  { id: 'outage', label: 'Gangguan', icon: AlertTriangle, color: 'text-amber-600 bg-amber-50' },
                  { id: 'maintenance', label: 'Maintenance', icon: Wrench, color: 'text-blue-600 bg-blue-50' },
                  { id: 'restoration', label: 'Pemulihan', icon: CheckCircle2, color: 'text-emerald-600 bg-emerald-50' },
                  { id: 'announcement', label: 'Pengumuman', icon: BellRing, color: 'text-purple-600 bg-purple-50' },
                ].map((item) => {
                  const Icon = item.icon;
                  const isSelected = broadcastType === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handleTypeChange(item.id as BroadcastType)}
                      className={`p-3 rounded-xl border text-center flex flex-col items-center gap-1.5 transition-all text-xs ${
                        isSelected
                          ? 'border-blue-600 bg-blue-50/60 font-bold text-blue-900 ring-2 ring-blue-500/20'
                          : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                      }`}
                    >
                      <div className={`p-2 rounded-lg ${item.color}`}>
                        <Icon className="w-4 h-4" />
                      </div>
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 2. Target Audience Filter */}
            <div className="bg-white rounded-xl p-4.5 border border-slate-200/90 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                  2. Tentukan Sasaran Penerima:
                </label>
                <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                  {recipientList.length} Penerima Siap
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => setTargetAudience('all')}
                  className={`p-2 rounded-lg border text-center transition-all ${
                    targetAudience === 'all'
                      ? 'border-blue-600 bg-blue-600 text-white font-bold shadow-xs'
                      : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  Semua ({customers.length})
                </button>
                <button
                  type="button"
                  onClick={() => setTargetAudience('status')}
                  className={`p-2 rounded-lg border text-center transition-all ${
                    targetAudience === 'status'
                      ? 'border-blue-600 bg-blue-600 text-white font-bold shadow-xs'
                      : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  Berdasarkan Status
                </button>
                <button
                  type="button"
                  onClick={() => setTargetAudience('type')}
                  className={`p-2 rounded-lg border text-center transition-all ${
                    targetAudience === 'type'
                      ? 'border-blue-600 bg-blue-600 text-white font-bold shadow-xs'
                      : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  Tipe Koneksi
                </button>
                <button
                  type="button"
                  onClick={() => setTargetAudience('package')}
                  className={`p-2 rounded-lg border text-center transition-all ${
                    targetAudience === 'package'
                      ? 'border-blue-600 bg-blue-600 text-white font-bold shadow-xs'
                      : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  Paket Internet
                </button>
                <button
                  type="button"
                  onClick={() => setTargetAudience('manual')}
                  className={`p-2 rounded-lg border text-center transition-all ${
                    targetAudience === 'manual'
                      ? 'border-blue-600 bg-blue-600 text-white font-bold shadow-xs'
                      : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  Pilih Manual
                </button>
              </div>

              {/* Conditional Filter Selectors */}
              {targetAudience === 'status' && (
                <div className="pt-2 text-xs">
                  <label className="font-semibold text-slate-700 block mb-1">Pilih Status:</label>
                  <select
                    value={selectedStatus}
                    onChange={(e) => setSelectedStatus(e.target.value)}
                    className="w-full p-2 rounded-lg border border-slate-200 bg-slate-50"
                  >
                    <option value="active">Pelanggan Aktif</option>
                    <option value="isolated">Pelanggan Terisolir</option>
                    <option value="inactive">Pelanggan Nonaktif</option>
                  </select>
                </div>
              )}

              {targetAudience === 'type' && (
                <div className="pt-2 text-xs">
                  <label className="font-semibold text-slate-700 block mb-1">Pilih Tipe Koneksi:</label>
                  <select
                    value={selectedType}
                    onChange={(e) => setSelectedType(e.target.value)}
                    className="w-full p-2 rounded-lg border border-slate-200 bg-slate-50"
                  >
                    <option value="pppoe">Pelanggan PPPoE (Rumahan)</option>
                    <option value="hotspot">Pelanggan Hotspot (Voucher)</option>
                  </select>
                </div>
              )}

              {targetAudience === 'package' && (
                <div className="pt-2 text-xs">
                  <label className="font-semibold text-slate-700 block mb-1">Pilih Paket:</label>
                  <select
                    value={selectedPackageId}
                    onChange={(e) => setSelectedPackageId(e.target.value)}
                    className="w-full p-2 rounded-lg border border-slate-200 bg-slate-50"
                  >
                    {packages.map((pkg) => (
                      <option key={pkg.id} value={pkg.id}>
                        {pkg.name} ({pkg.speed})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {targetAudience === 'manual' && (
                <div className="pt-2 space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <input
                      type="text"
                      placeholder="Cari pelanggan..."
                      value={manualSearchQuery}
                      onChange={(e) => setManualSearchQuery(e.target.value)}
                      className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs w-48"
                    />
                    <button
                      type="button"
                      onClick={handleSelectAllManual}
                      className="text-xs text-blue-600 font-semibold hover:underline"
                    >
                      {manualSelectedCustomerIds.length === customers.length ? 'Batal Semua' : 'Pilih Semua'}
                    </button>
                  </div>

                  <div className="max-h-44 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100 p-1">
                    {filteredManualCustomers.map((c) => {
                      const isChecked = manualSelectedCustomerIds.includes(c.id);
                      return (
                        <label
                          key={c.id}
                          className="flex items-center gap-2.5 p-2 hover:bg-slate-50 rounded cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggleManualCustomer(c.id)}
                            className="rounded text-blue-600 focus:ring-blue-500"
                          />
                          <div className="flex-1 truncate">
                            <span className="font-bold text-slate-800">{c.name}</span>
                            <span className="text-slate-400 text-[11px] ml-2">({c.phone})</span>
                          </div>
                          <span className="text-[10px] text-slate-500 font-mono">{c.id}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* 3. Judul & Pesan */}
            <div className="bg-white rounded-xl p-4.5 border border-slate-200/90 shadow-xs space-y-3 text-xs">
              <label className="font-bold text-slate-900 uppercase tracking-wider block">
                3. Judul & Isi Pesan:
              </label>

              <div>
                <label className="text-slate-600 font-semibold block mb-1">Judul Broadcast</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 font-bold text-slate-800"
                />
              </div>

              {/* Dynamic Variables helper */}
              <div>
                <span className="text-[11px] font-semibold text-slate-500 block mb-1.5">
                  Klik untuk Sisipkan Variabel Dinamis:
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { label: '{nama_pelanggan}', desc: 'Nama Pelanggan' },
                    { label: '{id_pelanggan}', desc: 'ID Pelanggan' },
                    { label: '{nama_paket}', desc: 'Nama Paket' },
                    { label: '{nama_usaha}', desc: 'Nama Usaha' },
                    { label: '{kontak_admin}', desc: 'Kontak CS' },
                  ].map((v) => (
                    <button
                      key={v.label}
                      type="button"
                      onClick={() => handleInsertVariable(v.label)}
                      className="px-2 py-1 rounded bg-slate-100 hover:bg-blue-100 text-blue-700 font-mono text-[11px] border border-slate-200 transition-colors"
                      title={v.desc}
                    >
                      + {v.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-slate-600 font-semibold block mb-1">Isi Pesan WhatsApp</label>
                <textarea
                  rows={8}
                  value={messageTemplate}
                  onChange={(e) => setMessageTemplate(e.target.value)}
                  className="w-full p-3 rounded-xl border border-slate-200 font-sans leading-relaxed text-slate-800 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
              </div>

              {/* Delay between dispatches */}
              <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                <div>
                  <span className="font-semibold text-slate-800 block">Jeda Antar Pesan (Delay)</span>
                  <span className="text-[11px] text-slate-400">
                    Mencegah pemblokiran oleh WhatsApp karena pengiriman terlalu cepat
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <select
                    value={delaySeconds}
                    onChange={(e) => setDelaySeconds(Number(e.target.value))}
                    className="p-1.5 rounded-lg border border-slate-200 font-semibold text-slate-700"
                  >
                    <option value={1}>1 Detik</option>
                    <option value={2}>2 Detik (Direkomendasikan)</option>
                    <option value={3}>3 Detik</option>
                    <option value={5}>5 Detik</option>
                  </select>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Live Message Preview & Send Button */}
          <div className="lg:col-span-5 space-y-4">
            <div className="bg-white rounded-xl p-4.5 border border-slate-200/90 shadow-xs space-y-3 text-xs sticky top-4">
              <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                <span className="font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
                  <Eye className="w-4 h-4 text-emerald-600" />
                  <span>Pratinjau Pesan Terkirim</span>
                </span>
                <span className="text-[11px] text-slate-400">Contoh: {sampleRecipient.name}</span>
              </div>

              {/* WhatsApp chat mockup box */}
              <div className="bg-[#efeae2] p-3.5 rounded-xl border border-slate-200 shadow-inner">
                <div className="bg-white rounded-xl p-3 shadow-sm max-w-sm ml-auto space-y-2 border border-slate-100">
                  <p className="text-xs text-slate-800 whitespace-pre-line leading-relaxed font-sans">
                    {sampleRenderedMessage}
                  </p>
                  <div className="text-[10px] text-slate-400 text-right">
                    {new Date().toTimeString().slice(0, 5)} WIB ✓✓
                  </div>
                </div>
              </div>

              {/* Security info */}
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1 text-slate-600">
                <div className="flex items-center gap-1.5 font-bold text-slate-800">
                  <ShieldCheck className="w-4 h-4 text-emerald-600" />
                  <span>Keamanan Gateway Terjamin</span>
                </div>
                <p className="text-[11px] leading-relaxed">
                  Pesan dikirim melalui backend proxy Wablas (cluster smg.wablas.com). Token otentikasi
                  disimpan aman di backend tanpa bocor ke frontend.
                </p>
              </div>

              {/* Action Button */}
              <div className="pt-2">
                <button
                  type="button"
                  disabled={recipientList.length === 0 || isSending}
                  onClick={handleOpenConfirm}
                  className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm flex items-center justify-center gap-2 shadow-sm transition-all disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed active:scale-[0.99]"
                >
                  {isSending ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Sedang Mengirim ({sendProgress?.currentIndex || 0}/{recipientList.length})...</span>
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4" />
                      <span>Kirim Broadcast ke {recipientList.length} Pelanggan</span>
                    </>
                  )}
                </button>
                {recipientList.length === 0 && (
                  <p className="text-[11px] text-amber-600 text-center mt-1.5 font-medium">
                    Pilih target pelanggan yang memiliki nomor WhatsApp valid untuk mengaktifkan tombol.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
      )}

      {/* TAB 2: RIWAYAT PENGIRIMAN */}
      {activeTab === 'history' && (
        <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs overflow-hidden">
          <div className="p-4 border-b border-slate-200 flex items-center justify-between">
            <span className="font-bold text-slate-900 text-sm">Riwayat Kampanye Broadcast WhatsApp</span>
            <span className="text-xs text-slate-500">Total: {history.length} broadcast tercatat</span>
          </div>

          <div className="divide-y divide-slate-100 text-xs">
            {history.length === 0 ? (
              <div className="text-center py-12 text-slate-500">
                <History className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                <p className="font-semibold text-slate-700">Belum ada riwayat broadcast</p>
                <p className="text-xs text-slate-400 mt-1">
                  Kampanye broadcast yang dikirim akan otomatis tercatat di halaman ini.
                </p>
              </div>
            ) : (
              history.map((camp) => (
                <div
                  key={camp.id}
                  className="p-4 hover:bg-slate-50/80 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <strong className="font-bold text-slate-900 text-sm">{camp.title}</strong>
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-blue-100 text-blue-800">
                        {camp.typeName}
                      </span>
                      <span className="text-[11px] text-slate-400 font-mono">{camp.createdAt}</span>
                    </div>
                    <p className="text-slate-500 text-[11px] line-clamp-1 max-w-xl">
                      {camp.messageContent}
                    </p>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right">
                      <div className="font-bold text-slate-800">{camp.totalRecipients} Penerima</div>
                      <div className="text-[11px] text-slate-500 flex items-center gap-1.5 justify-end">
                        <span className="text-emerald-600 font-semibold">{camp.successCount} Terkirim</span>
                        {camp.failureCount > 0 && (
                          <span className="text-rose-600 font-semibold">{camp.failureCount} Gagal</span>
                        )}
                      </div>
                    </div>

                    <button
                      onClick={() => setSelectedCampaignDetail(camp)}
                      className="px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-700 font-semibold text-xs flex items-center gap-1"
                    >
                      <Eye className="w-3.5 h-3.5 text-blue-600" />
                      <span>Rincian</span>
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Modal Detail Campaign History */}
      {selectedCampaignDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-2xl w-full flex flex-col max-h-[90vh] shadow-2xl overflow-hidden border border-slate-200">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <div>
                <h3 className="font-bold text-slate-900 text-base">{selectedCampaignDetail.title}</h3>
                <p className="text-xs text-slate-500">
                  {selectedCampaignDetail.typeName} • {selectedCampaignDetail.createdAt}
                </p>
              </div>
              <button
                onClick={() => setSelectedCampaignDetail(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 flex-1 overflow-y-auto space-y-4 text-xs">
              {/* Summary */}
              <div className="grid grid-cols-3 gap-2.5">
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                  <span className="text-[10px] uppercase font-bold text-slate-500 block">Total Penerima</span>
                  <strong className="text-base font-bold text-slate-900">{selectedCampaignDetail.totalRecipients}</strong>
                </div>
                <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200">
                  <span className="text-[10px] uppercase font-bold text-emerald-700 block">Sukses Terkirim</span>
                  <strong className="text-base font-bold text-emerald-800">{selectedCampaignDetail.successCount}</strong>
                </div>
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200">
                  <span className="text-[10px] uppercase font-bold text-rose-700 block">Gagal</span>
                  <strong className="text-base font-bold text-rose-800">{selectedCampaignDetail.failureCount}</strong>
                </div>
              </div>

              {/* Template Text */}
              <div>
                <span className="font-bold text-slate-800 block mb-1">Isi Pesan:</span>
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-slate-700 whitespace-pre-line leading-relaxed">
                  {selectedCampaignDetail.messageContent}
                </div>
              </div>

              {/* Per-recipient status list */}
              <div>
                <span className="font-bold text-slate-800 block mb-2">Rincian Per Penerima:</span>
                <div className="border border-slate-200 rounded-xl overflow-hidden max-h-56 overflow-y-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-100 text-slate-600 sticky top-0 font-semibold text-[10px] uppercase">
                      <tr>
                        <th className="p-2">Pelanggan</th>
                        <th className="p-2">WhatsApp</th>
                        <th className="p-2">Status</th>
                        <th className="p-2">Keterangan</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {selectedCampaignDetail.recipients.map((r, idx) => (
                        <tr key={idx} className="hover:bg-slate-50">
                          <td className="p-2 font-bold">{r.customerName}</td>
                          <td className="p-2 font-mono">{r.phone}</td>
                          <td className="p-2">
                            {r.status === 'sent' ? (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">
                                Terkirim
                              </span>
                            ) : (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800">
                                Gagal
                              </span>
                            )}
                          </td>
                          <td className="p-2 text-[11px] text-slate-500">
                            {r.errorMessage || r.sentAt || '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal Laporan Hasil Broadcast (Requirement 4) */}
      {finishedCampaignResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl max-w-2xl w-full flex flex-col max-h-[90vh] shadow-2xl overflow-hidden border border-slate-200">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2.5">
                <div
                  className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                    finishedCampaignResult.failureCount === 0
                      ? 'bg-emerald-100 text-emerald-700'
                      : finishedCampaignResult.successCount > 0
                      ? 'bg-amber-100 text-amber-700'
                      : 'bg-rose-100 text-rose-700'
                  }`}
                >
                  {finishedCampaignResult.failureCount === 0 ? (
                    <CheckCircle2 className="w-5 h-5" />
                  ) : (
                    <AlertTriangle className="w-5 h-5" />
                  )}
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-sm sm:text-base">
                    Laporan Hasil Pengiriman Broadcast
                  </h3>
                  <p className="text-xs text-slate-500">
                    {finishedCampaignResult.title} • {finishedCampaignResult.typeName}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setFinishedCampaignResult(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 flex-1 overflow-y-auto space-y-4 text-xs">
              {/* Summary Stats */}
              <div className="grid grid-cols-3 gap-2.5">
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-center">
                  <span className="text-[10px] uppercase font-bold text-slate-500 block">Total Penerima</span>
                  <strong className="text-lg font-bold text-slate-900">{finishedCampaignResult.totalRecipients}</strong>
                </div>
                <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-center">
                  <span className="text-[10px] uppercase font-bold text-emerald-700 block">Berhasil Terkirim</span>
                  <strong className="text-lg font-bold text-emerald-800">{finishedCampaignResult.successCount}</strong>
                </div>
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-center">
                  <span className="text-[10px] uppercase font-bold text-rose-700 block">Gagal Terkirim</span>
                  <strong className="text-lg font-bold text-rose-800">{finishedCampaignResult.failureCount}</strong>
                </div>
              </div>

              {/* Status Notice */}
              {finishedCampaignResult.failureCount > 0 && (
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-[11px] flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    Pesan yang gagal dikirim tertera pada tabel di bawah beserta alasan atau kode error dari gateway Wablas. Anda dapat meninjau nomor WhatsApp atau memeriksa koneksi gateway.
                  </div>
                </div>
              )}

              {/* Recipient Details Table */}
              <div>
                <span className="font-bold text-slate-800 block mb-1.5">
                  Daftar Penerima & Status Pengiriman:
                </span>
                <div className="border border-slate-200 rounded-xl overflow-hidden max-h-60 overflow-y-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-100 text-slate-600 sticky top-0 font-semibold text-[10px] uppercase">
                      <tr>
                        <th className="p-2.5">No</th>
                        <th className="p-2.5">Pelanggan</th>
                        <th className="p-2.5">Nomor WhatsApp</th>
                        <th className="p-2.5">Status</th>
                        <th className="p-2.5">Keterangan / Alasan</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {finishedCampaignResult.recipients.map((r, idx) => (
                        <tr key={idx} className="hover:bg-slate-50">
                          <td className="p-2.5 font-mono text-slate-400">{idx + 1}</td>
                          <td className="p-2.5 font-bold text-slate-800">
                            <div>{r.customerName}</div>
                            <span className="text-[10px] font-mono text-slate-400">{r.customerId}</span>
                          </td>
                          <td className="p-2.5 font-mono text-slate-700">{r.phone}</td>
                          <td className="p-2.5">
                            {r.status === 'sent' ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                                <Check className="w-3 h-3" /> Terkirim
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800">
                                <X className="w-3 h-3" /> Gagal
                              </span>
                            )}
                          </td>
                          <td className="p-2.5 text-[11px] text-slate-600">
                            {r.errorMessage ? (
                              <span className="text-rose-700 font-medium">{r.errorMessage}</span>
                            ) : (
                              <span className="text-slate-500">{r.sentAt || 'Terkirim via Wablas'}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Footer Buttons */}
            <div className="px-5 py-3 border-t border-slate-100 bg-slate-50 flex items-center justify-between">
              <span className="text-[11px] text-slate-400">
                Tercatat di riwayat pengiriman sistem
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setFinishedCampaignResult(null);
                    setActiveTab('history');
                  }}
                  className="px-3.5 py-2 rounded-xl border border-slate-200 hover:bg-slate-200/60 text-slate-700 font-semibold text-xs flex items-center gap-1.5 transition-colors"
                >
                  <History className="w-3.5 h-3.5 text-blue-600" />
                  <span>Lihat di Riwayat</span>
                </button>
                <button
                  type="button"
                  onClick={() => setFinishedCampaignResult(null)}
                  className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs transition-colors"
                >
                  Tutup Laporan
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
