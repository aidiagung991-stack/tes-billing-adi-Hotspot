import React, { useState, useEffect, useMemo } from 'react';
import {
  MessageSquare,
  Send,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Settings,
  Eye,
  EyeOff,
  RefreshCw,
  Copy,
  Check,
  Smartphone,
  Server,
  Calendar,
  Filter,
  Search,
  ExternalLink,
  ShieldCheck,
  ShieldAlert,
  Info,
  X,
  FileText,
  ToggleLeft,
  ToggleRight,
  RotateCcw,
  Plus,
  KeyRound,
} from 'lucide-react';
import {
  WhatsAppGatewayConfig,
  NotificationTemplate,
  NotificationScheduleConfig,
  WhatsAppMessageLog,
  NotificationTemplateKey,
  Customer,
  Invoice,
  Payment,
  BusinessSettings,
} from '../types/index.ts';
import {
  loadWAGatewayConfig,
  saveWAGatewayConfig,
  loadWATemplates,
  saveWATemplates,
  loadWAScheduleConfig,
  saveWAScheduleConfig,
  loadWAMessageLogs,
  saveWAMessageLogs,
  renderNotificationMessage,
  initialWATemplates,
  ALLOWED_TEMPLATE_VARIABLES,
  validateTemplateVariables,
} from '../utils/whatsappStorage.ts';
import {
  getBackendGatewayConfig,
  saveBackendGatewayConfig,
  testBackendGatewayConnection,
  sendBackendTestMessage,
} from '../services/whatsappGatewayService.ts';

interface WhatsAppViewProps {
  customers: Customer[];
  invoices: Invoice[];
  payments: Payment[];
  settings: BusinessSettings;
  onSendWhatsappReminder?: (invoice: Invoice) => void;
}

export const WhatsAppView: React.FC<WhatsAppViewProps> = ({
  customers,
  invoices,
  payments,
  settings,
}) => {
  // Active Tab
  const [activeTab, setActiveTab] = useState<'config' | 'templates' | 'schedule' | 'logs'>('config');

  // Gateway Configuration State
  const [gatewayConfig, setGatewayConfig] = useState<WhatsAppGatewayConfig>(() => loadWAGatewayConfig());
  const [serverUrlInput, setServerUrlInput] = useState(gatewayConfig.serverUrl);
  const [senderPhoneInput, setSenderPhoneInput] = useState(gatewayConfig.senderPhone);
  const [tokenInput, setTokenInput] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [secretKeyInput, setSecretKeyInput] = useState('');
  const [showSecretKey, setShowSecretKey] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isSavingConfig, setIsSavingConfig] = useState(false);

  // Template State (Modul A - Editor Template)
  const [templates, setTemplates] = useState<NotificationTemplate[]>(() => loadWATemplates());
  const [selectedTemplateKey, setSelectedTemplateKey] = useState<NotificationTemplateKey>('new_invoice');
  const [editingTitle, setEditingTitle] = useState(() => {
    const cur = loadWATemplates().find((t) => t.id === 'new_invoice');
    return cur?.name || 'Pemberitahuan Tagihan Baru';
  });
  const [editingContent, setEditingContent] = useState('');
  const [selectedPreviewCustomer, setSelectedPreviewCustomer] = useState(customers[0]?.id || '');

  // Schedule Policy State
  const [scheduleConfig, setScheduleConfig] = useState<NotificationScheduleConfig>(() => loadWAScheduleConfig());

  // Message Logs State
  const [messageLogs, setMessageLogs] = useState<WhatsAppMessageLog[]>(() => loadWAMessageLogs());
  const [logSearchQuery, setLogSearchQuery] = useState('');
  const [logStatusFilter, setLogStatusFilter] = useState<'all' | 'sent' | 'pending' | 'failed'>('all');
  const [previewLogItem, setPreviewLogItem] = useState<WhatsAppMessageLog | null>(null);

  // Test Message Modal
  const [isTestMessageModalOpen, setIsTestMessageModalOpen] = useState(false);
  const [testTargetPhone, setTestTargetPhone] = useState(settings.phone || customers[0]?.phone || '');
  const [testMessageText, setTestMessageText] = useState(
    `*Tes Notifikasi Adi_Hotspot Billing*\n\nHalo, ini adalah pesan pengujian koneksi WhatsApp Gateway Wablas untuk usaha RT/RW Net.`
  );
  const [isSendingTest, setIsSendingTest] = useState(false);

  // Toast feedback
  const [toastMessage, setToastMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  const showToast = (text: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToastMessage({ text, type });
    setTimeout(() => {
      setToastMessage(null);
    }, 4500);
  };

  // Sync initial backend config if server is available
  useEffect(() => {
    async function checkBackend() {
      const serverConfig = await getBackendGatewayConfig();
      if (serverConfig) {
        let cleanUrl = serverConfig.serverUrl || 'https://smg.wablas.com';
        if (cleanUrl.includes('semarang.wablas.com')) {
          cleanUrl = 'https://smg.wablas.com';
        }
        const updatedConfig = { ...serverConfig, serverUrl: cleanUrl };
        setGatewayConfig(updatedConfig);
        setServerUrlInput(cleanUrl);
        setSenderPhoneInput(serverConfig.senderPhone || '');
        saveWAGatewayConfig(updatedConfig);
      }
    }
    checkBackend();
  }, []);

  // Handler memilih preset cluster dan langsung menyimpan ke backend & storage
  const handleSelectCluster = async (domain: string) => {
    setServerUrlInput(domain);
    const updated: WhatsAppGatewayConfig = {
      ...gatewayConfig,
      serverUrl: domain,
    };
    setGatewayConfig(updated);
    saveWAGatewayConfig(updated);
    try {
      await saveBackendGatewayConfig({
        serverUrl: domain,
        senderPhone: senderPhoneInput.trim(),
      });
      showToast(`Cluster ${domain.replace('https://', '')} dipilih dan tersimpan ke backend.`, 'info');
    } catch {
      // Backend offline fallback
    }
  };

  // Update editing content & title when template selection changes
  useEffect(() => {
    const cur = templates.find((t) => t.id === selectedTemplateKey);
    if (cur) {
      setEditingContent(cur.templateContent);
      setEditingTitle(cur.name);
    }
  }, [selectedTemplateKey, templates]);

  // Selected template object
  const currentTemplate = useMemo(() => {
    return templates.find((t) => t.id === selectedTemplateKey) || templates[0];
  }, [templates, selectedTemplateKey]);

  // Validasi variabel template (Fitur Editor A)
  const validationResult = useMemo(() => {
    return validateTemplateVariables(editingContent);
  }, [editingContent]);

  // Sample data for live template preview (all 12 variables)
  const previewSampleData = useMemo(() => {
    const cust = customers.find((c) => c.id === selectedPreviewCustomer) || customers[0];
    const inv = invoices.find((i) => i.customerId === cust?.id) || invoices[0];
    const pay = payments.find((p) => p.invoiceId === inv?.id) || payments[0];
    return {
      customer: cust,
      invoice: inv,
      payment: pay,
      contactPhone: settings.phone,
      businessName: settings.businessName,
    };
  }, [customers, invoices, payments, settings, selectedPreviewCustomer]);

  // Live rendered message preview
  const liveMessagePreview = useMemo(() => {
    return renderNotificationMessage(editingContent, previewSampleData);
  }, [editingContent, previewSampleData]);

  // Variable insertion helper
  const handleInsertVariable = (variableTag: string) => {
    setEditingContent((prev) => {
      if (prev.endsWith(' ') || prev.endsWith('\n') || prev.length === 0) {
        return `${prev}${variableTag} `;
      }
      return `${prev} ${variableTag} `;
    });
  };

  // Save Gateway Settings (Requirement A.1 & A.2)
  const handleSaveGatewayConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingConfig(true);

    try {
      // Kirim ke backend Express agar token & secret key disimpan di server memory / environment rahasia
      const res = await saveBackendGatewayConfig({
        serverUrl: serverUrlInput.trim(),
        senderPhone: senderPhoneInput.trim(),
        token: tokenInput.trim() || undefined,
        secretKey: secretKeyInput.trim() || undefined,
      });

      if (res.success && res.config) {
        setGatewayConfig(res.config);
        saveWAGatewayConfig(res.config);
        setTokenInput('');
        setSecretKeyInput('');
        showToast('Pengaturan gateway WhatsApp berhasil disimpan di server backend!');
      } else {
        // Fallback simpan metadata non-rahasia di frontend
        const updatedLocal: WhatsAppGatewayConfig = {
          ...gatewayConfig,
          serverUrl: serverUrlInput.trim(),
          senderPhone: senderPhoneInput.trim(),
          isTokenConfigured: Boolean(tokenInput.trim() || gatewayConfig.isTokenConfigured),
          maskedToken: tokenInput.trim() ? `••••••••••••••••${tokenInput.trim().slice(-4)}` : gatewayConfig.maskedToken,
          isSecretKeyConfigured: Boolean(secretKeyInput.trim() || gatewayConfig.isSecretKeyConfigured),
          maskedSecretKey: secretKeyInput.trim() ? `••••••••••••••••${secretKeyInput.trim().slice(-4)}` : gatewayConfig.maskedSecretKey,
        };
        setGatewayConfig(updatedLocal);
        saveWAGatewayConfig(updatedLocal);
        setTokenInput('');
        setSecretKeyInput('');
        showToast('Pengaturan gateway diperbarui. (Catatan: Kredensial disimpan di session server)', 'info');
      }
    } catch {
      showToast('Gagal menghubungi backend untuk menyimpan kredensial.', 'error');
    } finally {
      setIsSavingConfig(false);
    }
  };

  // Test Connection to Wablas (Requirement A.1)
  const handleTestConnection = async () => {
    setIsTesting(true);

    try {
      const res = await testBackendGatewayConnection({
        serverUrl: serverUrlInput.trim(),
        token: tokenInput.trim() || undefined,
        secretKey: secretKeyInput.trim() || undefined,
      });

      const updated: WhatsAppGatewayConfig = {
        ...gatewayConfig,
        serverUrl: serverUrlInput.trim(),
        status: res.status,
        lastTestedAt: new Date().toISOString().replace('T', ' ').slice(0, 16),
        lastStatusMessage: res.message,
      };

      setGatewayConfig(updated);
      saveWAGatewayConfig(updated);

      if (res.success) {
        showToast('Tes koneksi BERHASIL: Perangkat terhubung ke server Wablas!', 'success');
      } else {
        showToast(res.message || 'Tes koneksi GAGAL. Periksa server URL atau Token API.', 'error');
      }
    } catch {
      showToast('Gagal melakukan tes koneksi ke backend.', 'error');
    } finally {
      setIsTesting(false);
    }
  };

  // Send Test Message (Requirement A.1)
  const handleSendTestMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testTargetPhone.trim()) {
      showToast('Masukkan nomor WhatsApp tujuan pengujian.', 'error');
      return;
    }

    setIsSendingTest(true);

    try {
      const res = await sendBackendTestMessage({
        targetPhone: testTargetPhone.trim(),
        messageContent: testMessageText.trim(),
      });

      const nowStr = new Date().toISOString().replace('T', ' ').slice(0, 16);

      // Record to message logs
      const newLog: WhatsAppMessageLog = {
        id: `walog-${Date.now().toString().slice(-6)}`,
        timestamp: nowStr,
        customerName: 'Uji Coba Pengiriman',
        phone: testTargetPhone.trim(),
        notificationType: 'new_invoice',
        notificationTypeName: 'Tes Pesan Gateway',
        messageContent: testMessageText.trim(),
        status: res.success ? 'sent' : 'failed',
        errorMessage: res.success ? undefined : res.message,
      };

      const updatedLogs = [newLog, ...messageLogs];
      setMessageLogs(updatedLogs);
      saveWAMessageLogs(updatedLogs);

      if (res.success) {
        showToast('Pesan uji coba berhasil terkirim melalui Wablas!', 'success');
        setIsTestMessageModalOpen(false);
      } else {
        showToast(res.message || 'Gagal mengirim pesan uji coba.', 'error');
      }
    } catch (err: any) {
      showToast('Terjadi kesalahan saat pengiriman pesan uji coba.', 'error');
    } finally {
      setIsSendingTest(false);
    }
  };

  // Toggle Template Enabled/Disabled
  const handleToggleTemplate = (key: NotificationTemplateKey) => {
    const updated = templates.map((t) =>
      t.id === key ? { ...t, isEnabled: !t.isEnabled, updatedAt: new Date().toISOString().split('T')[0] } : t
    );
    setTemplates(updated);
    saveWATemplates(updated);
    showToast(`Template notifikasi "${currentTemplate.name}" berhasil ${!currentTemplate.isEnabled ? 'diaktifkan' : 'dinonaktifkan'}.`);
  };

  // Save current template edits with title & validation check (Modul A)
  const handleSaveCurrentTemplate = () => {
    if (!validationResult.isValid) {
      showToast(
        `Gagal menyimpan: Ditemukan ${validationResult.invalidVariables.length} variabel tidak dikenal (${validationResult.invalidVariables.join(', ')}). Hanya 12 variabel resmi yang diizinkan!`,
        'error'
      );
      return;
    }
    if (!editingTitle.trim()) {
      showToast('Judul template tidak boleh kosong.', 'error');
      return;
    }
    const updated = templates.map((t) =>
      t.id === selectedTemplateKey
        ? {
            ...t,
            name: editingTitle.trim(),
            templateContent: editingContent,
            updatedAt: new Date().toISOString().split('T')[0],
          }
        : t
    );
    setTemplates(updated);
    saveWATemplates(updated);
    showToast(`Template "${editingTitle.trim()}" berhasil disimpan secara persisten!`, 'success');
  };

  // Reset current template to default (Modul A)
  const handleResetTemplateToDefault = () => {
    const original = initialWATemplates.find((t) => t.id === selectedTemplateKey);
    if (!original) return;
    setEditingContent(original.templateContent);
    setEditingTitle(original.name);
    const updated = templates.map((t) => (t.id === selectedTemplateKey ? { ...original } : t));
    setTemplates(updated);
    saveWATemplates(updated);
    showToast(`Template "${original.name}" dipulihkan ke format bawaan default.`, 'info');
  };

  // Reset all 6 templates to defaults (Modul A)
  const handleResetAllTemplates = () => {
    setTemplates(initialWATemplates);
    saveWATemplates(initialWATemplates);
    const cur = initialWATemplates.find((t) => t.id === selectedTemplateKey) || initialWATemplates[0];
    setEditingContent(cur.templateContent);
    setEditingTitle(cur.name);
    showToast('Seluruh 6 template notifikasi WhatsApp berhasil dipulihkan ke format awal!', 'info');
  };

  // Save Schedule Config (Requirement C)
  const handleSaveSchedule = (e: React.FormEvent) => {
    e.preventDefault();
    saveWAScheduleConfig(scheduleConfig);
    showToast('Pengaturan jadwal dan kebijakan pengiriman notifikasi berhasil disimpan!');
  };

  // Filtered Logs (Requirement D)
  const filteredLogs = useMemo(() => {
    return messageLogs.filter((log) => {
      const q = logSearchQuery.toLowerCase().trim();
      const matchesSearch =
        !q ||
        log.customerName.toLowerCase().includes(q) ||
        log.phone.includes(q) ||
        log.notificationTypeName.toLowerCase().includes(q) ||
        (log.referenceId && log.referenceId.toLowerCase().includes(q));

      const matchesStatus = logStatusFilter === 'all' || log.status === logStatusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [messageLogs, logSearchQuery, logStatusFilter]);

  // Variables list for quick clicks
  const availableVariables = [
    { tag: '{nama_pelanggan}', label: 'Nama Pelanggan' },
    { tag: '{id_pelanggan}', label: 'ID Pelanggan' },
    { tag: '{nomor_tagihan}', label: 'Nomor Tagihan' },
    { tag: '{nama_paket}', label: 'Paket Internet' },
    { tag: '{nominal_tagihan}', label: 'Nominal Tagihan' },
    { tag: '{tanggal_jatuh_tempo}', label: 'Jatuh Tempo' },
    { tag: '{jumlah_pembayaran}', label: 'Jumlah Dibayar' },
    { tag: '{sisa_tagihan}', label: 'Sisa Tagihan' },
    { tag: '{periode_tagihan}', label: 'Periode' },
    { tag: '{nomor_wa}', label: 'Kontak Admin' },
  ];

  return (
    <div className="space-y-6">
      {/* Toast Notification */}
      {toastMessage && (
        <div
          className={`fixed top-5 right-5 z-50 text-xs sm:text-sm font-semibold px-4 py-3 rounded-xl shadow-xl flex items-center gap-2.5 border animate-in slide-in-from-top-4 duration-200 ${
            toastMessage.type === 'success'
              ? 'bg-slate-900 text-white border-slate-700'
              : toastMessage.type === 'error'
              ? 'bg-rose-900 text-white border-rose-700'
              : 'bg-blue-900 text-white border-blue-700'
          }`}
        >
          {toastMessage.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          ) : toastMessage.type === 'error' ? (
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
          ) : (
            <Info className="w-4 h-4 text-blue-300 shrink-0" />
          )}
          <span>{toastMessage.text}</span>
          <button onClick={() => setToastMessage(null)} className="ml-2 text-slate-400 hover:text-white">
            ✕
          </button>
        </div>
      )}

      {/* Page Header */}
      <div className="bg-white rounded-2xl p-5 border border-slate-200/90 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="w-8 h-8 rounded-lg bg-emerald-500 text-white flex items-center justify-center font-bold">
              <MessageSquare className="w-4 h-4" />
            </div>
            <h1 className="text-lg font-bold text-slate-900">Pengaturan WhatsApp Gateway</h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              Penyedia Resmi: Wablas
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Konfigurasi gateway Wablas, pengelolaan template pesan otomatis, jadwal pengingat tagihan, dan riwayat pesan.
          </p>
        </div>

        {/* Quick Connection Status Badge */}
        <div className="flex items-center gap-2">
          <div
            className={`px-3 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-2 ${
              gatewayConfig.status === 'connected'
                ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                : gatewayConfig.status === 'disconnected'
                ? 'bg-rose-50 text-rose-800 border-rose-300'
                : 'bg-amber-50 text-amber-800 border-amber-300'
            }`}
          >
            <div
              className={`w-2 h-2 rounded-full ${
                gatewayConfig.status === 'connected'
                  ? 'bg-emerald-500 animate-pulse'
                  : gatewayConfig.status === 'disconnected'
                  ? 'bg-rose-500'
                  : 'bg-amber-500'
              }`}
            />
            <span>
              Status Gateway:{' '}
              {gatewayConfig.status === 'connected'
                ? 'Terhubung'
                : gatewayConfig.status === 'disconnected'
                ? 'Tidak Terhubung'
                : 'Belum Diuji'}
            </span>
          </div>
        </div>
      </div>

      {/* Tabs Navigation */}
      <div className="flex border-b border-slate-200 gap-2 overflow-x-auto text-xs sm:text-sm font-semibold">
        <button
          onClick={() => setActiveTab('config')}
          className={`pb-3 px-3 transition-colors flex items-center gap-2 border-b-2 whitespace-nowrap ${
            activeTab === 'config'
              ? 'border-emerald-600 text-emerald-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Server className="w-4 h-4" />
          <span>Konfigurasi Gateway</span>
        </button>

        <button
          onClick={() => setActiveTab('templates')}
          className={`pb-3 px-3 transition-colors flex items-center gap-2 border-b-2 whitespace-nowrap ${
            activeTab === 'templates'
              ? 'border-emerald-600 text-emerald-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <FileText className="w-4 h-4" />
          <span>Template Notifikasi ({templates.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('schedule')}
          className={`pb-3 px-3 transition-colors flex items-center gap-2 border-b-2 whitespace-nowrap ${
            activeTab === 'schedule'
              ? 'border-emerald-600 text-emerald-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Calendar className="w-4 h-4" />
          <span>Jadwal & Kebijakan</span>
        </button>

        <button
          onClick={() => setActiveTab('logs')}
          className={`pb-3 px-3 transition-colors flex items-center gap-2 border-b-2 whitespace-nowrap ${
            activeTab === 'logs'
              ? 'border-emerald-600 text-emerald-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Clock className="w-4 h-4" />
          <span>Riwayat Pesan ({messageLogs.length})</span>
        </button>
      </div>

      {/* TAB 1: KONFIGURASI GATEWAY (Requirement A) */}
      {activeTab === 'config' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white rounded-2xl p-6 border border-slate-200/90 shadow-xs">
              <div className="flex items-center justify-between pb-4 border-b border-slate-100">
                <div>
                  <h2 className="text-base font-bold text-slate-900">Kredensial & Endpoint Wablas</h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Pastikan perangkat WhatsApp Anda sudah dipindai (scan QR) di dashboard resmi Wablas.
                  </p>
                </div>
                <a
                  href="https://wablas.com"
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs font-semibold text-emerald-600 hover:text-emerald-700 flex items-center gap-1"
                >
                  <span>Dashboard Wablas</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>

              <form onSubmit={handleSaveGatewayConfig} className="py-4 space-y-4 text-xs">
                {/* Nama Penyedia */}
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Penyedia Gateway</label>
                  <div className="p-2.5 rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-between">
                    <span className="font-bold text-slate-800">Wablas (WhatsApp Business API Official Gateway)</span>
                    <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-semibold">
                      Terstandarisasi
                    </span>
                  </div>
                </div>

                {/* API URL / Endpoint Wablas */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="font-semibold text-slate-700">
                      API URL / Endpoint Server Wablas <span className="text-rose-500">*</span>
                    </label>
                    <span className="text-[11px] text-slate-400">Pilih cluster atau masukkan domain server</span>
                  </div>

                  <input
                    type="url"
                    value={serverUrlInput}
                    onChange={(e) => setServerUrlInput(e.target.value)}
                    placeholder="https://smg.wablas.com"
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white font-mono text-xs focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                    required
                  />

                  {/* Preset Cluster Pills */}
                  <div className="mt-2 flex items-center gap-1.5 flex-wrap text-[11px]">
                    <span className="text-slate-400">Cluster Resmi Diizinkan:</span>
                    {['https://smg.wablas.com'].map((domain) => (
                      <button
                        key={domain}
                        type="button"
                        onClick={() => handleSelectCluster(domain)}
                        className={`px-2 py-0.5 rounded border transition-colors ${
                          serverUrlInput === domain
                            ? 'bg-emerald-50 border-emerald-300 text-emerald-800 font-bold ring-1 ring-emerald-400'
                            : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                        }`}
                      >
                        {domain.replace('https://', '')} (Resmi)
                      </button>
                    ))}
                    <span className="text-[10px] text-slate-400 italic">
                      (Backend hanya mengizinkan domain resmi HTTPS smg.wablas.com demi keamanan)
                    </span>
                  </div>
                </div>

                {/* Token API (Security Masking & Storage Rule) */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="font-semibold text-slate-700">
                      Token API Wablas <span className="text-rose-500">*</span>
                    </label>
                    {gatewayConfig.isTokenConfigured && (
                      <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-semibold flex items-center gap-1">
                        <ShieldCheck className="w-3 h-3 text-emerald-600" />
                        Tersimpan Aman di Backend
                      </span>
                    )}
                  </div>

                  <div className="relative">
                    <input
                      type={showToken ? 'text' : 'password'}
                      value={tokenInput}
                      onChange={(e) => setTokenInput(e.target.value)}
                      placeholder={
                        gatewayConfig.isTokenConfigured
                          ? 'Token sudah terkonfigurasi. Masukkan token baru jika ingin mengganti...'
                          : 'Tempel token API dari menu Pengaturan Perangkat Wablas...'
                      }
                      className="w-full pl-3 pr-10 py-2 rounded-lg border border-slate-200 bg-white font-mono text-xs focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                    />
                    <button
                      type="button"
                      onClick={() => setShowToken(!showToken)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
                      title={showToken ? 'Sembunyikan Token' : 'Tampilkan Token'}
                    >
                      {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>

                  {/* Security Notice Banner (Requirement A.2) */}
                  <div className="mt-2 p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-600 text-[11px] flex items-start gap-2">
                    <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                    <div>
                      <strong className="text-slate-800 font-semibold block">Prinsip Keamanan Kredensial:</strong>
                      Token API & Secret Key tidak pernah disimpan di localStorage, sessionStorage, atau kode browser frontend.
                      Semua kredensial dikelola dan disimpan secara rahasia di sisi server backend.
                    </div>
                  </div>
                </div>

                {/* Secret Key Wablas (Wajib untuk Cloud / Dynamic IP) */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-1.5">
                      <label className="font-semibold text-slate-700">
                        Secret Key Wablas
                      </label>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 font-medium">
                        Wajib untuk Server Cloud / IP Dinamis
                      </span>
                    </div>
                    {gatewayConfig.isSecretKeyConfigured && (
                      <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-semibold flex items-center gap-1">
                        <ShieldCheck className="w-3 h-3 text-emerald-600" />
                        Tersimpan Aman di Backend
                      </span>
                    )}
                  </div>

                  <div className="relative">
                    <input
                      type={showSecretKey ? 'text' : 'password'}
                      value={secretKeyInput}
                      onChange={(e) => setSecretKeyInput(e.target.value)}
                      placeholder={
                        gatewayConfig.isSecretKeyConfigured
                          ? 'Secret Key sudah terkonfigurasi di backend. Masukkan baru jika ingin mengganti...'
                          : 'Tempel Secret Key dari dashboard Wablas: Device > Setting...'
                      }
                      className="w-full pl-3 pr-10 py-2 rounded-lg border border-slate-200 bg-white font-mono text-xs focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                    />
                    <button
                      type="button"
                      onClick={() => setShowSecretKey(!showSecretKey)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
                      title={showSecretKey ? 'Sembunyikan Secret Key' : 'Tampilkan Secret Key'}
                    >
                      {showSecretKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>

                  <div className="mt-2 p-2.5 rounded-lg bg-emerald-50/80 border border-emerald-200 text-emerald-900 text-[11px] space-y-1">
                    <div className="flex items-center gap-1.5 font-semibold text-emerald-800">
                      <KeyRound className="w-3.5 h-3.5 text-emerald-600" />
                      <span>Mengatasi &quot;Access denied: Your IP is not authorized. Or need secret key&quot;</span>
                    </div>
                    <p className="text-emerald-700 leading-relaxed">
                      Aplikasi Adi_Hotspot berjalan pada server cloud dengan IP dinamis. Wablas secara resmi menggunakan mekanisme kombinasi <strong>Authorization: Token.SecretKey</strong> agar request pengiriman pesan diizinkan langsung tanpa bergantung pada IP statis.
                    </p>
                    <p className="text-[10.5px] text-emerald-800/80">
                      💡 <strong>Lokasi di Dashboard Wablas:</strong> Menu <strong>Device</strong> &rarr; pilih perangkat &rarr; klik tab <strong>Setting</strong> &rarr; salin <strong>Secret Key</strong> Anda dan simpan di kolom ini.
                    </p>
                  </div>
                </div>

                {/* Nomor WhatsApp Perangkat (Sender Phone) */}
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Nomor WhatsApp Perangkat (Nomor Pengirim)
                  </label>
                  <input
                    type="text"
                    value={senderPhoneInput}
                    onChange={(e) => setSenderPhoneInput(e.target.value)}
                    placeholder="Contoh: 081298765431 atau 6281298765431"
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-mono focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                  />
                  <span className="text-[10px] text-slate-400 block mt-1">
                    Nomor kartu SIM WhatsApp yang saat ini ditautkan pada dashboard Wablas Anda.
                  </span>
                </div>

                {/* Status Koneksi Detail Box */}
                <div
                  className={`p-3.5 rounded-xl border flex items-start gap-3 ${
                    gatewayConfig.status === 'connected'
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                      : gatewayConfig.status === 'disconnected'
                      ? 'bg-rose-50 border-rose-200 text-rose-900'
                      : 'bg-amber-50 border-amber-200 text-amber-900'
                  }`}
                >
                  <div className="mt-0.5">
                    {gatewayConfig.status === 'connected' ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    ) : gatewayConfig.status === 'disconnected' ? (
                      <ShieldAlert className="w-4 h-4 text-rose-600" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-amber-600" />
                    )}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <strong className="font-bold text-xs">
                        Status Koneksi:{' '}
                        {gatewayConfig.status === 'connected'
                          ? 'Terhubung (Online)'
                          : gatewayConfig.status === 'disconnected'
                          ? 'Tidak Terhubung'
                          : 'Belum Diuji'}
                      </strong>
                      {gatewayConfig.lastTestedAt && (
                        <span className="text-[10px] opacity-80">Terakhir diuji: {gatewayConfig.lastTestedAt}</span>
                      )}
                    </div>
                    <p className="text-[11px] mt-0.5 leading-relaxed opacity-90">
                      {gatewayConfig.lastStatusMessage}
                    </p>
                  </div>
                </div>

                {/* Action Buttons: Simpan, Tes Koneksi, Kirim Pesan Percobaan */}
                <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2.5">
                  <div className="flex items-center gap-2">
                    {/* Tombol Tes Koneksi (Requirement A.1) */}
                    <button
                      type="button"
                      onClick={handleTestConnection}
                      disabled={isTesting}
                      className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-900 text-white font-semibold flex items-center gap-1.5 transition-colors shadow-xs disabled:opacity-60"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isTesting ? 'animate-spin' : ''}`} />
                      <span>{isTesting ? 'Menguji Koneksi...' : 'Tes Koneksi'}</span>
                    </button>

                    {/* Tombol Kirim Pesan Percobaan (Requirement A.1) */}
                    <button
                      type="button"
                      onClick={() => setIsTestMessageModalOpen(true)}
                      className="px-4 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold flex items-center gap-1.5 transition-colors border border-slate-200"
                    >
                      <Send className="w-3.5 h-3.5 text-slate-600" />
                      <span>Kirim Pesan Percobaan</span>
                    </button>
                  </div>

                  {/* Tombol Simpan Pengaturan (Requirement A.1) */}
                  <button
                    type="submit"
                    disabled={isSavingConfig}
                    className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold flex items-center gap-1.5 transition-colors shadow-xs disabled:opacity-60"
                  >
                    <Check className="w-4 h-4" />
                    <span>{isSavingConfig ? 'Menyimpan...' : 'Simpan Pengaturan'}</span>
                  </button>
                </div>
              </form>
            </div>
          </div>

          {/* Quick Info & Architecture Sidebar */}
          <div className="space-y-4">
            <div className="bg-white rounded-2xl p-5 border border-slate-200/90 shadow-xs space-y-3">
              <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2">
                <Smartphone className="w-4 h-4 text-emerald-600" />
                Panduan Integrasi Wablas
              </h3>
              <ol className="text-xs text-slate-600 space-y-2 list-decimal list-inside leading-relaxed">
                <li>Buka akun Anda di <strong className="text-slate-800">wablas.com</strong>.</li>
                <li>Pilih cluster server Anda (misal <code>smg.wablas.com</code>, <code>solo.wablas.com</code>, atau <code>api.wablas.com</code>).</li>
                <li>Buka menu <strong className="text-slate-800">Device</strong> dan pastikan status WhatsApp sudah terhubung (Connected).</li>
                <li>Salin <strong className="text-slate-800">API Token</strong> perangkat Anda ke kolom token di samping.</li>
                <li>Klik tombol <strong className="text-slate-800">Simpan Pengaturan</strong> lalu klik <strong className="text-slate-800">Tes Koneksi</strong>.</li>
              </ol>
            </div>

            <div className="bg-emerald-50/60 rounded-2xl p-5 border border-emerald-200/80 shadow-xs space-y-2 text-xs">
              <span className="font-bold text-emerald-950 block">Status Fitur Gateway (Saat Ini):</span>
              <div className="space-y-1.5 text-emerald-900 text-[11px] leading-relaxed">
                <div className="flex items-start gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                  <span>Antarmuka modul konfigurasi, template 6 pesan, & jadwal notifikasi siap digunakan.</span>
                </div>
                <div className="flex items-start gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                  <span>Backend proxy siap memverifikasi token dan mengirim pesan ke API resmi Wablas.</span>
                </div>
                <div className="flex items-start gap-1.5">
                  <Info className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                  <span>Otomatisasi pengiriman massal berbasis cron berjalan saat server backend beroperasi.</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: TEMPLATE NOTIFIKASI (Requirement B) */}
      {activeTab === 'templates' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Template Selection Sidebar */}
          <div className="lg:col-span-4 space-y-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 block px-1">
              Daftar 6 Template Notifikasi
            </span>

            {templates.map((tpl) => {
              const isSelected = tpl.id === selectedTemplateKey;
              return (
                <div
                  key={tpl.id}
                  onClick={() => setSelectedTemplateKey(tpl.id)}
                  className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
                    isSelected
                      ? 'bg-emerald-50/80 border-emerald-500 ring-2 ring-emerald-500/10 shadow-xs'
                      : 'bg-white border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className={`font-bold text-xs ${isSelected ? 'text-emerald-950' : 'text-slate-800'}`}>
                      {tpl.name}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleToggleTemplate(tpl.id);
                      }}
                      className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border transition-colors ${
                        tpl.isEnabled
                          ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
                          : 'bg-slate-100 text-slate-500 border-slate-200'
                      }`}
                    >
                      {tpl.isEnabled ? 'Aktif' : 'Nonaktif'}
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1 line-clamp-2 leading-relaxed">
                    {tpl.description}
                  </p>
                </div>
              );
            })}
          </div>

          {/* Template Editor & Live Preview (Modul A) */}
          <div className="lg:col-span-8 space-y-4">
            <div className="bg-white rounded-2xl p-5 sm:p-6 border border-slate-200/90 shadow-xs space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-slate-100 gap-3">
                <div className="flex-1">
                  <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                    Judul / Nama Template Notifikasi:
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={editingTitle}
                      onChange={(e) => setEditingTitle(e.target.value)}
                      placeholder="Masukkan nama template..."
                      className="w-full px-3 py-1.5 rounded-lg border border-slate-300 font-bold text-sm text-slate-900 bg-white focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                    />
                    <span
                      className={`text-[10px] font-bold px-2.5 py-1 rounded-full whitespace-nowrap ${
                        currentTemplate.isEnabled
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {currentTemplate.isEnabled ? 'Aktif' : 'Nonaktif'}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1">{currentTemplate.description}</p>
                </div>

                <button
                  type="button"
                  onClick={() => handleToggleTemplate(currentTemplate.id)}
                  className={`px-3.5 py-2 rounded-xl text-xs font-semibold border flex items-center gap-1.5 transition-colors self-start sm:self-auto shrink-0 shadow-2xs ${
                    currentTemplate.isEnabled
                      ? 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100'
                      : 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                  }`}
                >
                  {currentTemplate.isEnabled ? (
                    <>
                      <ToggleRight className="w-4 h-4 text-rose-600" />
                      <span>Nonaktifkan Template</span>
                    </>
                  ) : (
                    <>
                      <ToggleLeft className="w-4 h-4 text-emerald-600" />
                      <span>Aktifkan Template</span>
                    </>
                  )}
                </button>
              </div>

              {/* Dynamic 12 Variables Toolbar (Modul A) */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[11px] font-bold text-slate-700 flex items-center gap-1">
                    <span>12 Variabel Resmi Notifikasi:</span>
                    <span className="text-[10px] text-slate-400 font-normal">
                      (Klik variabel untuk menyisipkan ke dalam pesan)
                    </span>
                  </span>
                  <span className="text-[10px] text-emerald-700 font-semibold bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                    12 Variabel Tersedia
                  </span>
                </div>

                <div className="flex flex-wrap gap-1.5 p-2.5 bg-slate-50/80 rounded-xl border border-slate-200">
                  {ALLOWED_TEMPLATE_VARIABLES.map((v) => (
                    <button
                      key={v.tag}
                      type="button"
                      onClick={() => handleInsertVariable(v.tag)}
                      className="px-2 py-1 rounded-lg bg-white hover:bg-emerald-50 hover:text-emerald-800 hover:border-emerald-300 text-slate-700 border border-slate-200 text-[11px] font-mono transition-all flex items-center gap-1 shadow-2xs group"
                      title={`${v.label} (Contoh: ${v.example})`}
                    >
                      <span className="text-emerald-600 font-bold group-hover:scale-110 transition-transform">+</span>
                      <span>{v.tag}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Validation Warning Alert (Modul A) */}
              {!validationResult.isValid && (
                <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 text-xs flex items-start gap-2.5 animate-in fade-in">
                  <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <strong className="font-bold text-rose-800 block">
                      Variabel Tidak Dikenal Terdeteksi:
                    </strong>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {validationResult.invalidVariables.map((iv) => (
                        <span
                          key={iv}
                          className="px-2 py-0.5 rounded bg-rose-200/80 text-rose-900 font-mono text-[11px] font-bold"
                        >
                          {iv}
                        </span>
                      ))}
                    </div>
                    <p className="text-[11px] text-rose-700 mt-1 leading-relaxed">
                      Sistem hanya mengizinkan 12 variabel resmi yang terdaftar di atas. Hapus atau perbaiki variabel tersebut agar template dapat disimpan.
                    </p>
                  </div>
                </div>
              )}

              {/* Textarea Editor */}
              <div>
                <label className="block font-semibold text-slate-700 text-xs mb-1 flex items-center justify-between">
                  <span>Konten Template Pesan WhatsApp:</span>
                  <span className="text-[10px] text-slate-400 font-normal">
                    {editingContent.length} karakter
                  </span>
                </label>
                <textarea
                  rows={9}
                  value={editingContent}
                  onChange={(e) => setEditingContent(e.target.value)}
                  className={`w-full p-3.5 rounded-xl border font-mono text-xs leading-relaxed focus:ring-2 focus:outline-none transition-all ${
                    !validationResult.isValid
                      ? 'border-rose-400 bg-rose-50/20 focus:ring-rose-500/20 focus:border-rose-500'
                      : 'border-slate-200 bg-white focus:ring-emerald-500/20 focus:border-emerald-500'
                  }`}
                  placeholder="Tuliskan format pesan menggunakan tag variabel resmi..."
                />
              </div>

              {/* Live Preview Container (Modul A) */}
              <div className="pt-2 border-t border-slate-100">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-2 gap-2">
                  <span className="font-bold text-xs text-slate-800 flex items-center gap-1.5">
                    <MessageSquare className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Pratinjau Pesan Sebelum Disimpan (Simulasi Live):</span>
                  </span>

                  {/* Pick sample customer for preview */}
                  <div className="flex items-center gap-1.5 text-xs">
                    <span className="text-slate-400 text-[11px]">Data Simulasi:</span>
                    <select
                      value={selectedPreviewCustomer}
                      onChange={(e) => setSelectedPreviewCustomer(e.target.value)}
                      className="px-2 py-1 rounded-lg border border-slate-200 text-xs bg-slate-50 text-slate-700 font-medium"
                    >
                      {customers.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} ({c.id})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* WhatsApp Chat Bubble Mockup */}
                <div className="p-4 rounded-xl bg-slate-100/80 border border-slate-200 flex justify-start">
                  <div className="max-w-md w-full bg-emerald-50 border border-emerald-200 text-slate-900 rounded-2xl rounded-tl-xs p-3.5 shadow-xs text-xs whitespace-pre-wrap font-sans leading-relaxed relative">
                    <div className="text-[10px] font-bold text-emerald-800 mb-1 flex items-center justify-between">
                      <span>ADI_HOTSPOT NOTIFIKASI</span>
                      <span className="font-normal text-slate-400">09:00 WIB</span>
                    </div>
                    {liveMessagePreview}
                    <div className="text-right text-[10px] text-slate-400 mt-1.5 flex items-center justify-end gap-1">
                      <span>09:00</span>
                      <Check className="w-3.5 h-3.5 text-blue-500" />
                    </div>
                  </div>
                </div>
              </div>

              {/* Template Action Controls (Modul A) */}
              <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2.5">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleResetTemplateToDefault}
                    className="px-3 py-1.5 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 text-xs font-medium flex items-center gap-1 border border-slate-200 transition-colors"
                  >
                    <RotateCcw className="w-3.5 h-3.5 text-slate-500" />
                    <span>Pulihkan Default Template Ini</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleResetAllTemplates}
                    className="px-3 py-1.5 rounded-lg text-slate-500 hover:text-rose-700 hover:bg-rose-50 text-xs font-medium flex items-center gap-1 transition-colors"
                    title="Kembalikan semua 6 template ke pengaturan awal sistem"
                  >
                    <span>Pulihkan Seluruh 6 Template</span>
                  </button>
                </div>

                <button
                  type="button"
                  onClick={handleSaveCurrentTemplate}
                  disabled={!validationResult.isValid || !editingTitle.trim()}
                  className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-md shadow-emerald-600/20 flex items-center gap-1.5 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Check className="w-4 h-4" />
                  <span>Simpan Template Ini</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: JADWAL & KEBIJAKAN NOTIFIKASI (Requirement C) */}
      {activeTab === 'schedule' && (
        <div className="max-w-3xl space-y-6">
          <form onSubmit={handleSaveSchedule} className="bg-white rounded-2xl p-6 border border-slate-200/90 shadow-xs space-y-5 text-xs">
            <div className="pb-3 border-b border-slate-100">
              <h2 className="font-bold text-base text-slate-900">Kebijakan Jadwal Pengiriman Notifikasi</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Atur waktu dan kondisi pengiriman pengingat tagihan dan konfirmasi otomatis kepada pelanggan.
              </p>
            </div>

            {/* 1. Pengingat Sebelum Jatuh Tempo */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 rounded-xl bg-slate-50 border border-slate-200">
              <div>
                <label className="block font-semibold text-slate-800 mb-1">
                  Pengingat Sebelum Jatuh Tempo (H-X Hari)
                </label>
                <select
                  value={scheduleConfig.dueReminderDaysBefore}
                  onChange={(e) =>
                    setScheduleConfig({ ...scheduleConfig, dueReminderDaysBefore: Number(e.target.value) })
                  }
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white font-medium"
                >
                  <option value={1}>H-1 (1 Hari Sebelum Jatuh Tempo)</option>
                  <option value={2}>H-2 (2 Hari Sebelum Jatuh Tempo)</option>
                  <option value={3}>H-3 (3 Hari Sebelum Jatuh Tempo - Standar)</option>
                  <option value={5}>H-5 (5 Hari Sebelum Jatuh Tempo)</option>
                </select>
                <span className="text-[10px] text-slate-400 block mt-1">
                  Mengingatkan pelanggan sebelum batas jatuh tempo berakhir.
                </span>
              </div>

              <div>
                <label className="block font-semibold text-slate-800 mb-1">
                  Waktu Pengiriman Pesan (Jam Pengiriman)
                </label>
                <input
                  type="time"
                  value={scheduleConfig.sendTime}
                  onChange={(e) => setScheduleConfig({ ...scheduleConfig, sendTime: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white font-medium"
                />
                <span className="text-[10px] text-slate-400 block mt-1">
                  Waktu kirim yang sopan (rekomendasi: 09:00 WIB pagi).
                </span>
              </div>
            </div>

            {/* 2. Pengingat Keterlambatan */}
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
              <label className="block font-semibold text-slate-800 mb-1">
                Pengingat Tagihan Terlambat (Setelah Jatuh Tempo)
              </label>
              <select
                value={scheduleConfig.overdueReminderDaysAfter}
                onChange={(e) =>
                  setScheduleConfig({ ...scheduleConfig, overdueReminderDaysAfter: Number(e.target.value) })
                }
                className="w-full sm:w-1/2 px-3 py-2 rounded-lg border border-slate-200 bg-white font-medium"
              >
                <option value={1}>H+1 (1 Hari Setelah Jatuh Tempo)</option>
                <option value={2}>H+2 (2 Hari Setelah Jatuh Tempo)</option>
                <option value={3}>H+3 (3 Hari Setelah Jatuh Tempo)</option>
              </select>
              <span className="text-[10px] text-slate-400 block mt-1">
                Mengirim notifikasi keterlambatan dan peringatan isolir kepada pelanggan yang belum lunas.
              </span>
            </div>

            {/* 3. Toggles Pemicu Otomatis (Requirement E) */}
            <div className="space-y-3 pt-2 border-t border-slate-100">
              <span className="font-bold text-xs text-slate-900 block">Pemicu Pengiriman Otomatis:</span>

              <label className="flex items-center justify-between p-3 rounded-xl border border-slate-200 hover:bg-slate-50 cursor-pointer">
                <div>
                  <span className="font-semibold text-slate-800 block">Kirim Konfirmasi Saat Pembayaran Dicatat</span>
                  <span className="text-[11px] text-slate-500">
                    Otomatis kirim struk/kuitansi digital WhatsApp setelah admin klik "Konfirmasi Pembayaran".
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={scheduleConfig.autoSendOnPayment}
                  onChange={(e) =>
                    setScheduleConfig({ ...scheduleConfig, autoSendOnPayment: e.target.checked })
                  }
                  className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500"
                />
              </label>

              <label className="flex items-center justify-between p-3 rounded-xl border border-slate-200 hover:bg-slate-50 cursor-pointer">
                <div>
                  <span className="font-semibold text-slate-800 block">Pemberitahuan Saat Status Diisolir</span>
                  <span className="text-[11px] text-slate-500">
                    Otomatis siapkan pesan notifikasi saat pelanggan berstatus Terisolir (disiapkan integrasi MikroTik).
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={scheduleConfig.autoSendOnIsolation}
                  onChange={(e) =>
                    setScheduleConfig({ ...scheduleConfig, autoSendOnIsolation: e.target.checked })
                  }
                  className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500"
                />
              </label>

              <label className="flex items-center justify-between p-3 rounded-xl border border-slate-200 hover:bg-slate-50 cursor-pointer">
                <div>
                  <span className="font-semibold text-slate-800 block">Pemberitahuan Saat Internet Aktif Kembali</span>
                  <span className="text-[11px] text-slate-500">
                    Otomatis beritahu pelanggan bahwa akses internet sudah dipulihkan kembali.
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={scheduleConfig.autoSendOnRestoration}
                  onChange={(e) =>
                    setScheduleConfig({ ...scheduleConfig, autoSendOnRestoration: e.target.checked })
                  }
                  className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500"
                />
              </label>

              <label className="flex items-center justify-between p-3 rounded-xl border border-slate-200 hover:bg-slate-50 cursor-pointer">
                <div>
                  <span className="font-semibold text-slate-800 block">Kirim Otomatis Saat Tagihan Diterbitkan</span>
                  <span className="text-[11px] text-slate-500">
                    Kirim notifikasi tagihan baru segera setelah invoice dibuat di sistem.
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={scheduleConfig.autoSendOnNewInvoice}
                  onChange={(e) =>
                    setScheduleConfig({ ...scheduleConfig, autoSendOnNewInvoice: e.target.checked })
                  }
                  className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500"
                />
              </label>
            </div>

            {/* Note on Background Worker Execution */}
            <div className="p-3.5 rounded-xl bg-blue-50 border border-blue-200 text-blue-900 text-[11px] leading-relaxed flex items-start gap-2">
              <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
              <div>
                <strong>Eksekusi Terjadwal di Backend:</strong> Pengingat jatuh tempo dan tagihan terlambat
                dijalankan oleh service backend terjadwal (cron job), sehingga notifikasi tetap terkirim tepat waktu
                meskipun komputer kasir sedang tertutup.
              </div>
            </div>

            <div className="pt-3 border-t border-slate-100 flex justify-end">
              <button
                type="submit"
                className="px-5 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold shadow-xs flex items-center gap-1.5"
              >
                <Check className="w-4 h-4" />
                <span>Simpan Kebijakan Jadwal</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* TAB 4: RIWAYAT PESAN (Requirement D) */}
      {activeTab === 'logs' && (
        <div className="space-y-4">
          {/* Toolbar Search & Status Filter */}
          <div className="bg-white rounded-xl p-4 border border-slate-200/90 shadow-xs flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={logSearchQuery}
                onChange={(e) => setLogSearchQuery(e.target.value)}
                placeholder="Cari nama pelanggan, nomor WhatsApp, atau nomor invoice..."
                className="w-full pl-10 pr-4 py-2 text-xs sm:text-sm rounded-lg border border-slate-200 bg-slate-50/50 focus:outline-hidden focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
              />
            </div>

            <div className="flex items-center gap-2">
              <select
                value={logStatusFilter}
                onChange={(e) => setLogStatusFilter(e.target.value as any)}
                className="px-3 py-2 text-xs rounded-lg border border-slate-200 bg-white text-slate-700 font-medium"
              >
                <option value="all">Semua Status</option>
                <option value="sent">Terkirim</option>
                <option value="pending">Menunggu</option>
                <option value="failed">Gagal</option>
              </select>

              <button
                type="button"
                onClick={() => setIsTestMessageModalOpen(true)}
                className="px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-xs shrink-0"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Kirim Tes</span>
              </button>
            </div>
          </div>

          {/* Table: 7 Required Columns (Requirement D) */}
          <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs sm:text-sm">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold text-[11px] uppercase tracking-wider">
                  <tr>
                    <th className="px-3.5 py-3.5 whitespace-nowrap">Tanggal & Waktu</th>
                    <th className="px-3.5 py-3.5 whitespace-nowrap">Nama Pelanggan</th>
                    <th className="px-3.5 py-3.5 whitespace-nowrap">Nomor WhatsApp</th>
                    <th className="px-3.5 py-3.5 whitespace-nowrap">Jenis Notifikasi</th>
                    <th className="px-3.5 py-3.5">Isi Pesan</th>
                    <th className="px-3.5 py-3.5 whitespace-nowrap">Status</th>
                    <th className="px-3.5 py-3.5">Keterangan Kesalahan</th>
                    <th className="px-3.5 py-3.5 text-right whitespace-nowrap">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredLogs.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="text-center py-10 text-slate-500 text-xs">
                        Tidak ada riwayat pesan notifikasi yang sesuai.
                      </td>
                    </tr>
                  ) : (
                    filteredLogs.map((log) => {
                      return (
                        <tr key={log.id} className="hover:bg-slate-50/70 transition-colors">
                          {/* 1. Tanggal dan Waktu */}
                          <td className="px-3.5 py-3.5 whitespace-nowrap font-mono text-xs text-slate-600">
                            {log.timestamp}
                          </td>

                          {/* 2. Nama Pelanggan */}
                          <td className="px-3.5 py-3.5 whitespace-nowrap">
                            <div className="font-bold text-slate-900">{log.customerName}</div>
                            {log.customerId && (
                              <div className="text-[10px] text-slate-400 font-mono">{log.customerId}</div>
                            )}
                          </td>

                          {/* 3. Nomor WhatsApp */}
                          <td className="px-3.5 py-3.5 whitespace-nowrap font-mono text-xs text-slate-700">
                            {log.phone}
                          </td>

                          {/* 4. Jenis Notifikasi */}
                          <td className="px-3.5 py-3.5 whitespace-nowrap">
                            <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-800 text-[11px] font-semibold border border-slate-200">
                              {log.notificationTypeName}
                            </span>
                          </td>

                          {/* 5. Isi Pesan */}
                          <td className="px-3.5 py-3.5 max-w-xs text-xs text-slate-600">
                            <div className="line-clamp-2" title={log.messageContent}>
                              {log.messageContent}
                            </div>
                          </td>

                          {/* 6. Status: Menunggu, Terkirim, atau Gagal */}
                          <td className="px-3.5 py-3.5 whitespace-nowrap">
                            {log.status === 'sent' ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                                Terkirim
                              </span>
                            ) : log.status === 'pending' ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                                <Clock className="w-3 h-3 text-amber-600" />
                                Menunggu
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200">
                                <AlertTriangle className="w-3 h-3 text-rose-600" />
                                Gagal
                              </span>
                            )}
                          </td>

                          {/* 7. Keterangan Kesalahan */}
                          <td className="px-3.5 py-3.5 text-xs text-rose-700 max-w-xs">
                            {log.errorMessage ? (
                              <span className="text-[11px] leading-tight block">{log.errorMessage}</span>
                            ) : (
                              <span className="text-slate-400 text-[11px]">-</span>
                            )}
                          </td>

                          {/* Aksi: Pratinjau Lengkap */}
                          <td className="px-3.5 py-3.5 text-right whitespace-nowrap">
                            <button
                              onClick={() => setPreviewLogItem(log)}
                              className="p-1.5 rounded-lg text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 transition-colors"
                              title="Lihat Pesan Lengkap"
                            >
                              <Eye className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: KIRIM PESAN PERCOBAAN (Requirement A.1) */}
      {isTestMessageModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 relative">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Send className="w-4 h-4 text-emerald-600" />
                <h3 className="font-bold text-base text-slate-900">Kirim Pesan Percobaan</h3>
              </div>
              <button
                onClick={() => setIsTestMessageModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSendTestMessage} className="py-4 space-y-3.5 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Nomor WhatsApp Tujuan (HP Anda/Admin) <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={testTargetPhone}
                  onChange={(e) => setTestTargetPhone(e.target.value)}
                  placeholder="Contoh: 081234567890 atau 6281234567890"
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 font-mono text-xs focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                  required
                />
                <span className="text-[10px] text-slate-400 mt-1 block">
                  Bisa dimulai dengan 08... atau 628... Sistem otomatis menyesuaikan ke format internasional resmi Wablas.
                </span>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Isi Pesan Uji Coba</label>
                <textarea
                  rows={4}
                  value={testMessageText}
                  onChange={(e) => setTestMessageText(e.target.value)}
                  className="w-full p-3 rounded-lg border border-slate-200 text-xs font-mono focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                  required
                />
              </div>

              <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-[11px] leading-relaxed">
                <strong>Catatan:</strong> Pengiriman pesan percobaan membutuhkan koneksi dan token Wablas yang
                sudah aktif pada server backend.
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsTestMessageModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={isSendingTest}
                  className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold flex items-center gap-1.5 shadow-xs disabled:opacity-60"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{isSendingTest ? 'Mengirim...' : 'Kirim Sekarang'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: DETAIL LOG PESAN */}
      {previewLogItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 relative text-xs">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <h3 className="font-bold text-base text-slate-900">Rincian Riwayat Pesan</h3>
                <span className="text-slate-400 text-[11px]">{previewLogItem.timestamp}</span>
              </div>
              <button
                onClick={() => setPreviewLogItem(null)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="py-4 space-y-3">
              <div className="grid grid-cols-2 gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200">
                <div>
                  <span className="text-slate-400 text-[10px] uppercase font-semibold block">Pelanggan</span>
                  <span className="font-bold text-slate-800">{previewLogItem.customerName}</span>
                </div>
                <div>
                  <span className="text-slate-400 text-[10px] uppercase font-semibold block">Nomor WhatsApp</span>
                  <span className="font-mono text-slate-800">{previewLogItem.phone}</span>
                </div>
                <div>
                  <span className="text-slate-400 text-[10px] uppercase font-semibold block">Jenis Notifikasi</span>
                  <span className="font-semibold text-slate-800">{previewLogItem.notificationTypeName}</span>
                </div>
                <div>
                  <span className="text-slate-400 text-[10px] uppercase font-semibold block">Status</span>
                  <span
                    className={`font-bold capitalize ${
                      previewLogItem.status === 'sent'
                        ? 'text-emerald-600'
                        : previewLogItem.status === 'failed'
                        ? 'text-rose-600'
                        : 'text-amber-600'
                    }`}
                  >
                    {previewLogItem.status}
                  </span>
                </div>
              </div>

              {previewLogItem.errorMessage && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-900">
                  <span className="font-bold block text-[11px]">Keterangan Error:</span>
                  <p className="mt-0.5">{previewLogItem.errorMessage}</p>
                </div>
              )}

              <div>
                <span className="text-slate-400 text-[10px] uppercase font-semibold block mb-1">
                  Konten Pesan Terkirim:
                </span>
                <div className="p-3.5 rounded-xl bg-emerald-50/70 border border-emerald-200 text-slate-800 whitespace-pre-wrap font-sans text-xs leading-relaxed">
                  {previewLogItem.messageContent}
                </div>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-100 flex justify-end">
              <button
                type="button"
                onClick={() => setPreviewLogItem(null)}
                className="px-4 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
