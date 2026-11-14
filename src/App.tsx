import React, { useState, useEffect, useRef } from 'react';
import {
  MenuItemKey,
  Customer,
  InternetPackage,
  Invoice,
  Payment,
  PaymentMethod,
  CustomerStatus,
  BusinessSettings,
} from './types/index.ts';
import {
  initialRouterConfig,
  initialBusinessSettings,
} from './data/mockData.ts';
import { computeInvoiceStatus } from './utils/invoiceStorage.ts';
import { generateUniqueTransactionNumber } from './utils/paymentStorage.ts';
import { Sidebar } from './components/Sidebar.tsx';
import { Header } from './components/Header.tsx';
import { SampleDataBanner } from './components/SampleDataBanner.tsx';
import { WhatsappReminderModal } from './components/WhatsappReminderModal.tsx';
import { DashboardView } from './pages/DashboardView.tsx';
import { CustomersView } from './pages/CustomersView.tsx';
import { PackagesView } from './pages/PackagesView.tsx';
import { InvoicesView } from './pages/InvoicesView.tsx';
import { PaymentsView } from './pages/PaymentsView.tsx';
import { MikrotikView } from './pages/MikrotikView.tsx';
import { ReportsView } from './pages/ReportsView.tsx';
import { SettingsView } from './pages/SettingsView.tsx';
import { WhatsAppView } from './pages/WhatsAppView.tsx';
import { BroadcastView } from './pages/BroadcastView.tsx';
import { renderNotificationMessage, initialWATemplates, initialWAScheduleConfig } from './utils/whatsappStorage.ts';
import { WhatsAppMessageLog, BillingSettings } from './types/index.ts';
import { loadBillingSettings } from './utils/billingCalculator.ts';
import {
  getDatabaseStatus,
  fetchCustomersFromApi,
  saveCustomerToApi,
  updateCustomerInApi,
  updateCustomerStatusInApi,
  deleteCustomerFromApi,
  fetchPackagesFromApi,
  savePackageToApi,
  updatePackageInApi,
  deletePackageFromApi,
  fetchInvoicesFromApi,
  saveInvoiceToApi,
  updateInvoiceInApi,
  deleteInvoiceFromApi,
  fetchPaymentsFromApi,
  recordPaymentViaApi,
  fetchSettingsFromApi,
  saveSettingsToApi,
  fetchWATemplatesFromApi,
  saveWATemplateToApi,
  fetchWAScheduleFromApi,
  saveWAScheduleToApi,
  recordWALogToApi,
  fetchMikrotikConfigFromApi,
  DbStatusResponse,
} from './services/apiService.ts';

export default function App() {
  const [activeMenu, setActiveMenu] = useState<MenuItemKey>('dashboard');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Status koneksi PostgreSQL
  const [dbStatus, setDbStatus] = useState<DbStatusResponse | null>(null);
  const [dbError, setDbError] = useState<string | null>(null);

  // Data operasional (pelanggan, paket, tagihan, pembayaran) dimulai dari array kosong []
  // PostgreSQL adalah satu-satunya sumber data utama.
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [packages, setPackages] = useState<InternetPackage[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);

  // Pengaturan non-operasional
  const [routerConfig, setRouterConfig] = useState(initialRouterConfig);
  const [settings, setSettings] = useState<BusinessSettings>(initialBusinessSettings);
  const [billingSettings, setBillingSettings] = useState<BillingSettings>(() => loadBillingSettings());

  // WhatsApp Reminder Modal state
  const [reminderInvoice, setReminderInvoice] = useState<Invoice | null>(null);

  // Inisialisasi dan sinkronisasi data dari PostgreSQL backend saat aplikasi dibuka
  useEffect(() => {
    let isMounted = true;

    async function syncDataFromPostgres() {
      try {
        // 1. Cek kesehatan koneksi database PostgreSQL
        const status = await getDatabaseStatus();
        if (!isMounted) return;
        setDbStatus(status);

        // 2. Jika database PostgreSQL aktif terhubung, muat seluruh data operasional
        if (status && status.isConnected) {
          setDbError(null);
          const [apiPkgs, apiCusts, apiInvs, apiPays, apiBiz, apiBill, waTemplates, waSchedule, apiRouter] = await Promise.all([
            fetchPackagesFromApi(),
            fetchCustomersFromApi(),
            fetchInvoicesFromApi(),
            fetchPaymentsFromApi(),
            fetchSettingsFromApi('business'),
            fetchSettingsFromApi('billing'),
            fetchWATemplatesFromApi(),
            fetchWAScheduleFromApi(),
            fetchMikrotikConfigFromApi(),
          ]);

          // Inisialisasi default WhatsApp hanya jika tabel PostgreSQL benar-benar kosong.
          if (Array.isArray(waTemplates)) {
            const existingTemplateIds = new Set(waTemplates.map((template) => template.id));
            const missingTemplates = initialWATemplates.filter((template) => !existingTemplateIds.has(template.id));
            if (missingTemplates.length > 0) {
              await Promise.all(missingTemplates.map((template) => saveWATemplateToApi(template)));
            }
          }
          if (!waSchedule) {
            await saveWAScheduleToApi(initialWAScheduleConfig);
          }

          if (!isMounted) return;

          // Periksa Array.isArray(res) tanpa memeriksa res.length > 0!
          // Database kosong tetap menghasilkan state array kosong di UI.
          if (Array.isArray(apiPkgs)) {
            setPackages(apiPkgs);
          }
          if (Array.isArray(apiCusts)) {
            setCustomers(apiCusts);
          }
          if (Array.isArray(apiInvs)) {
            setInvoices(apiInvs);
          }
          if (Array.isArray(apiPays)) {
            setPayments(apiPays);
          }
          if (apiBiz) {
            setSettings(apiBiz);
          }
          if (apiBill) {
            setBillingSettings(apiBill);
          }
          if (apiRouter) {
            setRouterConfig(apiRouter);
          }
        } else {
          setDbError(status?.error || status?.message || 'Database PostgreSQL adi_hotspot tidak terhubung.');
        }
      } catch (e: any) {
        if (!isMounted) return;
        console.error('[PostgreSQL Sync] Gagal menyinkronkan data dari PostgreSQL:', e);
        setDbError(e?.message || 'Gagal terhubung ke backend server PostgreSQL.');
      }
    }

    syncDataFromPostgres();

    return () => {
      isMounted = false;
    };
  }, []);

  // Ref untuk mengunci proses transaksi agar tidak terjadi double submit pembayaran
  const isProcessingPaymentRef = useRef(false);

  // Handlers untuk Pelanggan (Menunggu konfirmasi PostgreSQL sebelum update state)
  const handleAddCustomer = async (newCust: Customer): Promise<{ success: boolean; message?: string }> => {
    try {
      const res = await saveCustomerToApi(newCust);
      if (!res.success || !res.data) {
        return { success: false, message: res.message || 'Gagal menyimpan pelanggan ke database: data tidak dikembalikan.' };
      }
      const saved = res.data;
      setCustomers((prev) => [saved, ...prev]);

      // Update jumlah pelanggan aktif pada paket
      setPackages((prev) =>
        prev.map((pkg) =>
          pkg.id === saved.packageId
            ? { ...pkg, activeUsersCount: (pkg.activeUsersCount || 0) + 1 }
            : pkg
        )
      );
      return { success: true, message: 'Pelanggan berhasil disimpan ke database PostgreSQL.' };
    } catch (err: any) {
      return { success: false, message: err?.message || 'Terjadi kesalahan sistem saat menghubungi database.' };
    }
  };

  const handleEditCustomer = async (updatedCust: Customer): Promise<{ success: boolean; message?: string }> => {
    try {
      const res = await updateCustomerInApi(updatedCust.id, updatedCust);
      if (!res.success || !res.data) {
        return { success: false, message: res.message || 'Gagal memperbarui data pelanggan di database: data tidak dikembalikan.' };
      }
      const saved = res.data;
      const oldCust = customers.find((c) => c.id === saved.id);
      setCustomers((prev) => prev.map((c) => (c.id === saved.id ? saved : c)));

      // Jika paket berubah, sesuaikan jumlah user aktif paket
      if (oldCust && oldCust.packageId !== saved.packageId) {
        setPackages((prev) =>
          prev.map((p) => {
            if (p.id === oldCust.packageId) {
              return { ...p, activeUsersCount: Math.max(0, (p.activeUsersCount || 0) - 1) };
            }
            if (p.id === saved.packageId) {
              return { ...p, activeUsersCount: (p.activeUsersCount || 0) + 1 };
            }
            return p;
          })
        );
      }
      return { success: true, message: 'Data pelanggan berhasil diperbarui di database PostgreSQL.' };
    } catch (err: any) {
      return { success: false, message: err?.message || 'Terjadi kesalahan sistem saat menghubungi database.' };
    }
  };

  const handleDeleteCustomer = async (customerId: string): Promise<{ success: boolean; message?: string }> => {
    try {
      const target = customers.find((c) => c.id === customerId);
      const res = await deleteCustomerFromApi(customerId);
      if (!res.success) {
        return { success: false, message: res.message || 'Gagal menghapus pelanggan dari database.' };
      }
      setCustomers((prev) => prev.filter((c) => c.id !== customerId));

      if (target) {
        setPackages((prev) =>
          prev.map((p) =>
            p.id === target.packageId
              ? { ...p, activeUsersCount: Math.max(0, (p.activeUsersCount || 0) - 1) }
              : p
          )
        );
      }
      return { success: true, message: 'Pelanggan berhasil dihapus dari database PostgreSQL.' };
    } catch (err: any) {
      return { success: false, message: err?.message || 'Terjadi kesalahan sistem saat menghubungi database.' };
    }
  };

  const handleToggleCustomerStatus = async (
    customerId: string,
    nextStatus: CustomerStatus
  ): Promise<{ success: boolean; message?: string }> => {
    try {
      const res = await updateCustomerStatusInApi(customerId, nextStatus);
      if (!res.success || !res.data) {
        return { success: false, message: res.message || 'Gagal mengubah status pelanggan di database: data tidak dikembalikan.' };
      }
      const saved = res.data;
      setCustomers((prev) => prev.map((c) => (c.id === customerId ? { ...c, ...saved } : c)));

      // Integrasi WhatsApp Notifikasi: Siapkan notifikasi isolir atau aktif kembali
      const targetCust = saved || customers.find((c) => c.id === customerId);
      if (targetCust && (nextStatus === 'isolated' || nextStatus === 'active')) {
        const templates = await fetchWATemplatesFromApi() || [];
        const tplKey = nextStatus === 'isolated' ? 'isolation_notice' : 'restoration_notice';
        const tpl = templates.find((t) => t.id === tplKey);
        if (tpl && tpl.isEnabled) {
          const relatedInvoice = invoices.find((i) => i.customerId === customerId && i.status !== 'paid');
          const rendered = renderNotificationMessage(tpl.templateContent, {
            customer: targetCust,
            invoice: relatedInvoice,
            contactPhone: settings.phone,
          });
          const now = new Date();
          const timeFormatted = now.toISOString();
          const newLog: WhatsAppMessageLog = {
            id: `walog-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
            timestamp: timeFormatted,
            customerName: targetCust.name,
            customerId: targetCust.id,
            phone: targetCust.phone,
            notificationType: tplKey,
            notificationTypeName: tplKey === 'isolation_notice' ? 'Isolir Layanan' : 'Internet Aktif Kembali',
            messageContent: rendered,
            status: 'pending',
            referenceId: relatedInvoice?.invoiceNumber || targetCust.id,
          };
          const logged = await recordWALogToApi(newLog);
          if (!logged) console.error('Log notifikasi status pelanggan gagal disimpan ke PostgreSQL.');
        }
      }
      return { success: true, message: `Status pelanggan berhasil diubah menjadi ${nextStatus}.` };
    } catch (err: any) {
      return { success: false, message: err?.message || 'Terjadi kesalahan sistem saat menghubungi database.' };
    }
  };

  // Handlers untuk Paket Internet (dengan sinkronisasi PostgreSQL)
  const handleAddPackage = async (newPkg: InternetPackage): Promise<{ success: boolean; message?: string }> => {
    try {
      const res = await savePackageToApi(newPkg);
      if (!res.success || !res.data) {
        return { success: false, message: res.message || 'Gagal menyimpan paket ke database: data tidak dikembalikan.' };
      }
      const saved = res.data;
      setPackages((prev) => [...prev, saved]);
      return { success: true, message: 'Paket berhasil disimpan ke database PostgreSQL.' };
    } catch (err: any) {
      return { success: false, message: err?.message || 'Terjadi kesalahan sistem saat menghubungi database.' };
    }
  };

  const handleEditPackage = async (updatedPkg: InternetPackage): Promise<{ success: boolean; message?: string }> => {
    try {
      const res = await updatePackageInApi(updatedPkg.id, updatedPkg);
      if (!res.success || !res.data) {
        return { success: false, message: res.message || 'Gagal memperbarui paket di database: data tidak dikembalikan.' };
      }
      const saved = res.data;
      setPackages((prev) => prev.map((p) => (p.id === saved.id ? saved : p)));

      // Jika nama atau tarif paket diedit, sinkronkan juga ke pelanggan yang menggunakan paket ini
      setCustomers((prevCusts) => {
        let hasChange = false;
        const nextCusts = prevCusts.map((c) => {
          if (c.packageId === saved.id) {
            hasChange = true;
            return {
              ...c,
              packageName: saved.name,
              monthlyFee: saved.price,
            };
          }
          return c;
        });
        return hasChange ? nextCusts : prevCusts;
      });
      return { success: true, message: 'Paket berhasil diperbarui di database PostgreSQL.' };
    } catch (err: any) {
      return { success: false, message: err?.message || 'Terjadi kesalahan sistem saat menghubungi database.' };
    }
  };

  const handleDeletePackage = async (pkgId: string): Promise<{ success: boolean; message?: string }> => {
    try {
      const res = await deletePackageFromApi(pkgId);
      if (!res.success) {
        return { success: false, message: res.message || 'Gagal menghapus paket dari database.' };
      }
      setPackages((prev) => prev.filter((p) => p.id !== pkgId));
      return { success: true, message: 'Paket berhasil dihapus dari database PostgreSQL.' };
    } catch (err: any) {
      return { success: false, message: err?.message || 'Terjadi kesalahan sistem saat menghubungi database.' };
    }
  };

  // Handlers untuk Tagihan (dengan sinkronisasi PostgreSQL)
  const handleCreateInvoice = async (newInv: Invoice): Promise<{ success: boolean; message?: string }> => {
    try {
      const res = await saveInvoiceToApi(newInv);
      if (!res.success || !res.data) {
        return { success: false, message: res.message || 'Gagal menyimpan tagihan ke database: data tidak dikembalikan.' };
      }
      const saved = res.data;
      setInvoices((prev) => [saved, ...prev]);

      // Integrasi WhatsApp Notifikasi: Siapkan antrean notifikasi tagihan baru
      try {
        const templates = await fetchWATemplatesFromApi() || [];
        const newInvoiceTpl = templates.find((t) => t.id === 'new_invoice');
        if (newInvoiceTpl && newInvoiceTpl.isEnabled) {
          const cust = customers.find((c) => c.id === saved.customerId);
          const rendered = renderNotificationMessage(newInvoiceTpl.templateContent, {
            customer: cust,
            invoice: saved,
            contactPhone: settings.phone,
          });
          const newLog: WhatsAppMessageLog = {
            id: `walog-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
            timestamp: new Date().toISOString(),
            customerName: saved.customerName,
            customerId: saved.customerId,
            phone: saved.customerPhone || cust?.phone || '',
            notificationType: 'new_invoice',
            notificationTypeName: 'Tagihan Baru',
            messageContent: rendered,
            status: 'pending',
            referenceId: saved.invoiceNumber,
          };
          const logged = await recordWALogToApi(newLog);
          if (!logged) console.error('Antrean notifikasi tagihan baru gagal disimpan ke PostgreSQL.');
        }
      } catch (e) {
        console.warn('Gagal menyiapkan antrean notifikasi tagihan baru:', e);
      }
      return { success: true, message: 'Tagihan berhasil diterbitkan di database PostgreSQL.' };
    } catch (err: any) {
      return { success: false, message: err?.message || 'Terjadi kesalahan sistem saat menghubungi database.' };
    }
  };

  const handleEditInvoice = async (updatedInv: Invoice): Promise<{ success: boolean; message?: string }> => {
    try {
      const res = await updateInvoiceInApi(updatedInv.id, updatedInv);
      if (!res.success || !res.data) {
        return { success: false, message: res.message || 'Gagal memperbarui tagihan di database: data tidak dikembalikan.' };
      }
      const saved = res.data;
      setInvoices((prev) => prev.map((inv) => (inv.id === saved.id ? saved : inv)));
      return { success: true, message: 'Tagihan berhasil diperbarui di database PostgreSQL.' };
    } catch (err: any) {
      return { success: false, message: err?.message || 'Terjadi kesalahan sistem saat menghubungi database.' };
    }
  };

  const handleDeleteInvoice = async (invoiceId: string): Promise<{ success: boolean; message?: string }> => {
    try {
      const res = await deleteInvoiceFromApi(invoiceId);
      if (!res.success) {
        return { success: false, message: res.message || 'Gagal menghapus tagihan dari database.' };
      }
      setInvoices((prev) => prev.filter((inv) => inv.id !== invoiceId));
      return { success: true, message: 'Tagihan berhasil dihapus dari database PostgreSQL.' };
    } catch (err: any) {
      return { success: false, message: err?.message || 'Terjadi kesalahan sistem saat menghubungi database.' };
    }
  };

  // Handler untuk mencatat transaksi pembayaran (menunggu respon COMMIT dari PostgreSQL)
  const handleRecordPayment = async (params: {
    invoiceId: string;
    amount: number;
    method: PaymentMethod;
    notes?: string;
    receiverName?: string;
  }): Promise<{ success: boolean; message?: string; payment?: Payment }> => {
    // Validasi 0: Cegah double submit transaksi jika permintaan sebelumnya masih berlangsung
    if (isProcessingPaymentRef.current) {
      return {
        success: false,
        message: 'Permintaan transaksi pembayaran sedang diproses ke database PostgreSQL. Mohon tunggu sejenak...',
      };
    }

    const targetInvoice = invoices.find((inv) => inv.id === params.invoiceId);
    if (!targetInvoice) {
      return { success: false, message: 'Tagihan tidak ditemukan dalam sistem.' };
    }

    const currentPaid =
      targetInvoice.paidAmount !== undefined
        ? targetInvoice.paidAmount
        : targetInvoice.status === 'paid'
        ? targetInvoice.amount
        : 0;

    const currentRemaining =
      targetInvoice.remainingAmount !== undefined
        ? targetInvoice.remainingAmount
        : Math.max(0, targetInvoice.amount - currentPaid);

    // Validasi 1: Cegah pembayaran untuk tagihan yang sudah lunas
    if (targetInvoice.status === 'paid' || currentRemaining <= 0) {
      return {
        success: false,
        message: 'Tagihan ini sudah lunas. Tidak dapat menerima pembayaran ganda.',
      };
    }

    // Validasi 2: Nominal pembayaran harus angka finite dan > 0
    if (!Number.isFinite(params.amount) || params.amount <= 0) {
      return { success: false, message: 'Nominal pembayaran tidak valid. Nominal harus berupa angka finite lebih besar dari 0.' };
    }

    // Validasi 3: Cegah overpayment (nominal > sisa tagihan)
    if (params.amount > currentRemaining) {
      return {
        success: false,
        message: `Nominal pembayaran melebihi sisa tagihan (Maksimal Rp ${currentRemaining.toLocaleString('id-ID')}).`,
      };
    }

    isProcessingPaymentRef.current = true;

    try {
      // Kirim transaksi ke backend PostgreSQL dan TUNGGU hingga COMMIT berhasil!
      // JANGAN mengubah nominal atau state secara optimistis sebelum database mengonfirmasi COMMIT.
      const apiResult = await recordPaymentViaApi({
        invoiceId: params.invoiceId,
        amount: params.amount,
        method: params.method,
        notes: params.notes,
        receiverName: params.receiverName,
      });

      // Validasi ketat: Wajib memeriksa bahwa transaksi COMMIT sukses serta mengembalikan payment dan updatedInvoice resmi
      if (!apiResult.success || !apiResult.payment || !apiResult.updatedInvoice) {
        // Transaksi gagal atau di-ROLLBACK di database: pertahankan state tanpa perubahan palsu!
        return {
          success: false,
          message: apiResult.message || 'Transaksi pembayaran ditolak atau data tidak lengkap dari database PostgreSQL.',
        };
      }

      // Transaksi BERHASIL di-COMMIT di PostgreSQL:
      // Ambil objek resmi dari PostgreSQL hasil RETURNING
      const committedPayment = apiResult.payment;
      const committedInvoice = apiResult.updatedInvoice;

      // Perbarui riwayat pembayaran dengan baris resmi dari database
      setPayments((prev) => [committedPayment, ...prev]);

      // Perbarui data invoice HANYA menggunakan nilai dari committedInvoice (PostgreSQL)
      // Hapus seluruh fallback perhitungan lokal!
      setInvoices((prev) =>
        prev.map((inv) =>
          inv.id === committedInvoice.id
            ? {
                ...inv,
                ...committedInvoice,
                paidAmount: committedInvoice.paidAmount,
                remainingAmount: committedInvoice.remainingAmount,
                status: committedInvoice.status,
                paidAt: committedInvoice.paidAt,
                paymentMethod: committedInvoice.paymentMethod,
              }
            : inv
        )
      );

      // Integrasi WhatsApp Notifikasi: Siapkan antrean konfirmasi pembayaran jika aktif
      try {
        const templates = await fetchWATemplatesFromApi() || [];
        const paymentTpl = templates.find((t) => t.id === 'payment_confirmation');
        if (paymentTpl && paymentTpl.isEnabled) {
          const cust = customers.find((c) => c.id === committedInvoice.customerId);
          const rendered = renderNotificationMessage(paymentTpl.templateContent, {
            customer: cust,
            invoice: committedInvoice,
            payment: committedPayment,
            contactPhone: settings.phone,
          });
          const newLog: WhatsAppMessageLog = {
            id: `walog-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
            timestamp: committedPayment.paidAt || new Date().toISOString().slice(0, 16),
            customerName: committedInvoice.customerName,
            customerId: committedInvoice.customerId,
            phone: committedInvoice.customerPhone || cust?.phone || '',
            notificationType: 'payment_confirmation',
            notificationTypeName: 'Konfirmasi Pembayaran',
            messageContent: rendered,
            status: 'pending',
            referenceId: committedPayment.transactionNumber,
          };
          const logged = await recordWALogToApi(newLog);
          if (!logged) console.error('Antrean konfirmasi pembayaran gagal disimpan ke PostgreSQL.');
        }
      } catch (e) {
        console.warn('Gagal menyiapkan antrean notifikasi pembayaran:', e);
      }

      const isFullyPaid = committedInvoice.status === 'paid';

      return {
        success: true,
        message: isFullyPaid
          ? `Pembayaran ${committedPayment.transactionNumber} berhasil dicatat di PostgreSQL dan tagihan ${committedInvoice.invoiceNumber} telah Lunas!`
          : `Pembayaran sebagian ${committedPayment.transactionNumber} berhasil dicatat di PostgreSQL. Sisa tagihan: Rp ${(committedInvoice.remainingAmount ?? 0).toLocaleString('id-ID')}`,
        payment: committedPayment,
      };
    } catch (err: any) {
      console.error('[PostgreSQL Payment Error]:', err);
      return {
        success: false,
        message: err?.message || 'Terjadi kesalahan sistem saat memproses transaksi pembayaran.',
      };
    } finally {
      isProcessingPaymentRef.current = false;
    }
  };

  const handleMarkAsPaid = async (
    invoiceId: string,
    method: PaymentMethod,
    notes: string
  ): Promise<{ success: boolean; message?: string }> => {
    const target = invoices.find((inv) => inv.id === invoiceId);
    if (!target) return { success: false, message: 'Tagihan tidak ditemukan dalam sistem.' };
    const currentPaid =
      target.paidAmount !== undefined
        ? target.paidAmount
        : target.status === 'paid'
        ? target.amount
        : 0;
    const currentRemaining =
      target.remainingAmount !== undefined
        ? target.remainingAmount
        : Math.max(0, target.amount - currentPaid);
    if (currentRemaining <= 0) {
      return { success: false, message: 'Tagihan ini sudah lunas.' };
    }

    return await handleRecordPayment({
      invoiceId,
      amount: currentRemaining,
      method,
      notes,
    });
  };

  const unpaidInvoicesCount = invoices.filter(
    (i) => i.status === 'unpaid' || i.status === 'overdue'
  ).length;

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col font-sans antialiased text-slate-800">
      {/* Top Banner (PostgreSQL Status Notice) */}
      <SampleDataBanner dbStatus={dbStatus} dbError={dbError} />

      {/* Main Layout Container */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <Sidebar
          activeMenu={activeMenu}
          onSelectMenu={(menu) => setActiveMenu(menu)}
          isOpenMobile={isMobileMenuOpen}
          onCloseMobile={() => setIsMobileMenuOpen(false)}
          unpaidInvoicesCount={unpaidInvoicesCount}
          totalCustomersCount={customers.length}
          routerConfig={routerConfig}
        />

        {/* Content Area */}
        <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
          {/* Header */}
          <Header
            activeMenu={activeMenu}
            onOpenMobileMenu={() => setIsMobileMenuOpen(true)}
            unpaidCount={unpaidInvoicesCount}
          />

          {/* Page Body */}
          <main className="flex-1 p-4 sm:p-6 max-w-7xl w-full mx-auto">
            {activeMenu === 'dashboard' && (
              <DashboardView
                customers={customers}
                invoices={invoices}
                payments={payments}
                onNavigate={(menu) => setActiveMenu(menu)}
                onSendWhatsappReminder={(inv) => setReminderInvoice(inv)}
              />
            )}

            {activeMenu === 'customers' && (
              <CustomersView
                customers={customers}
                packages={packages}
                onAddCustomer={handleAddCustomer}
                onEditCustomer={handleEditCustomer}
                onDeleteCustomer={handleDeleteCustomer}
                onToggleStatus={handleToggleCustomerStatus}
                onCustomerSyncUpdate={(updated) =>
                  setCustomers((prev) => prev.map((c) => (c.id === updated.id ? { ...c, ...updated } : c)))
                }
              />
            )}

            {activeMenu === 'packages' && (
              <PackagesView
                packages={packages}
                customers={customers}
                onAddPackage={handleAddPackage}
                onEditPackage={handleEditPackage}
                onDeletePackage={handleDeletePackage}
              />
            )}

            {activeMenu === 'invoices' && (
              <InvoicesView
                invoices={invoices}
                customers={customers}
                packages={packages}
                settings={settings}
                billingSettings={billingSettings}
                onMarkAsPaid={handleMarkAsPaid}
                onSendWhatsappReminder={(inv) => setReminderInvoice(inv)}
                onCreateInvoice={handleCreateInvoice}
                onEditInvoice={handleEditInvoice}
                onDeleteInvoice={handleDeleteInvoice}
              />
            )}

            {activeMenu === 'broadcast' && (
              <BroadcastView
                customers={customers}
                packages={packages}
                settings={settings}
              />
            )}

            {activeMenu === 'payments' && (
              <PaymentsView
                payments={payments}
                invoices={invoices}
                customers={customers}
                settings={settings}
                onRecordPayment={handleRecordPayment}
              />
            )}

            {activeMenu === 'whatsapp' && (
              <WhatsAppView
                customers={customers}
                invoices={invoices}
                payments={payments}
                settings={settings}
                onSendWhatsappReminder={(inv) => setReminderInvoice(inv)}
              />
            )}

            {activeMenu === 'mikrotik' && (
              <MikrotikView
                routerConfig={routerConfig}
                onConfigUpdated={(cfg) => setRouterConfig(cfg)}
              />
            )}

            {activeMenu === 'reports' && (
              <ReportsView
                customers={customers}
                invoices={invoices}
                payments={payments}
                packages={packages}
              />
            )}

            {activeMenu === 'settings' && (
              <SettingsView
                settings={settings}
                customers={customers}
                packages={packages}
                onSaveSettings={(next) => setSettings(next)}
                onNavigate={(menu) => setActiveMenu(menu)}
              />
            )}
          </main>
        </div>
      </div>

      {/* WhatsApp Reminder Modal */}
      {reminderInvoice && (
        <WhatsappReminderModal
          invoice={reminderInvoice}
          settings={settings}
          onClose={() => setReminderInvoice(null)}
        />
      )}
    </div>
  );
}
