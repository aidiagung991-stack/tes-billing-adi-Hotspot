import React, { useState, useMemo, useEffect } from 'react';
import {
  Receipt,
  Search,
  Filter,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Send,
  Plus,
  CreditCard,
  Calendar,
  User,
  Copy,
  Check,
  Eye,
  Edit2,
  Trash2,
  X,
  Database,
  RotateCcw,
  ShieldAlert,
  Hash,
  DollarSign,
  AlertCircle,
  Calculator,
  TrendingUp,
  MessageSquare,
  History,
  Smartphone,
  ExternalLink,
  Info,
  FileText,
  XCircle,
} from 'lucide-react';
import {
  Invoice,
  InvoiceStatus,
  Customer,
  InternetPackage,
  PaymentMethod,
  BusinessSettings,
  WhatsAppMessageLog,
  NotificationTemplateKey,
  NotificationTemplate,
  BillingSettings,
} from '../types/index.ts';
import {
  formatRupiah,
  formatDateIndo,
  getInvoiceStatusBadge,
} from '../utils/formatters.ts';
import {
  generateUniqueInvoiceNumber,
  checkDuplicateInvoice,
  computeInvoiceStatus,
} from '../utils/invoiceStorage.ts';
import {
  loadWATemplates,
  loadWAMessageLogs,
  saveWAMessageLogs,
  renderNotificationMessage,
} from '../utils/whatsappStorage.ts';
import { sendBackendTestMessage } from '../services/whatsappGatewayService.ts';
import { InvoiceExportModal } from '../components/InvoiceExportModal.tsx';
import { Download } from 'lucide-react';

interface InvoicesViewProps {
  invoices: Invoice[];
  customers: Customer[];
  packages: InternetPackage[];
  settings?: BusinessSettings;
  billingSettings?: BillingSettings;
  onMarkAsPaid: (invoiceId: string, method: PaymentMethod, notes: string) => Promise<{ success: boolean; message?: string }> | { success: boolean; message?: string } | void;
  onSendWhatsappReminder: (invoice: Invoice) => void;
  onCreateInvoice: (newInv: Invoice) => Promise<{ success: boolean; message?: string }> | { success: boolean; message?: string } | void;
  onEditInvoice: (updatedInv: Invoice) => Promise<{ success: boolean; message?: string }> | { success: boolean; message?: string } | void;
  onDeleteInvoice: (invoiceId: string) => Promise<{ success: boolean; message?: string }> | { success: boolean; message?: string } | void;
}

interface InvoiceFormErrors {
  customerId?: string;
  amount?: string;
  monthPeriod?: string;
  dueDate?: string;
  invoiceNumber?: string;
  duplicate?: string;
}

export const InvoicesView: React.FC<InvoicesViewProps> = ({
  invoices,
  customers,
  packages,
  settings,
  billingSettings,
  onMarkAsPaid,
  onSendWhatsappReminder,
  onCreateInvoice,
  onEditInvoice,
  onDeleteInvoice,
}) => {
  // Search & Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [customerFilter, setCustomerFilter] = useState('all');
  const [periodFilter, setPeriodFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'all' | InvoiceStatus>('all');

  // Modals
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState<Invoice | null>(null);
  const [detailInvoice, setDetailInvoice] = useState<Invoice | null>(null);
  const [invoiceToDelete, setInvoiceToDelete] = useState<Invoice | null>(null);
  const [selectedInvoiceToPay, setSelectedInvoiceToPay] = useState<Invoice | null>(null);

  // Payment modal state
  const [payMethod, setPayMethod] = useState<PaymentMethod>('cash');
  const [payNotes, setPayNotes] = useState('Pembayaran diterima kasir');

  // Active Tab: Invoices List vs WhatsApp Invoices History
  const [activeTab, setActiveTab] = useState<'invoices' | 'history'>('invoices');

  // WhatsApp Preview & Send Modal States (Requirements 3, 4, 5, 6, 7, 8, 9, 12, 13, 14, 16, 17)
  const [waPreviewInvoice, setWaPreviewInvoice] = useState<Invoice | null>(null);
  const [selectedWaTemplateKey, setSelectedWaTemplateKey] = useState<NotificationTemplateKey>('due_reminder');
  const [waCustomMessage, setWaCustomMessage] = useState('');
  const [isSendingWA, setIsSendingWA] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState(false);

  // WhatsApp Message Logs & Filters (Requirements 10 & 11)
  const [waLogs, setWaLogs] = useState<WhatsAppMessageLog[]>(() => loadWAMessageLogs());
  const [waLogCustomerFilter, setWaLogCustomerFilter] = useState('all');
  const [waLogPeriodFilter, setWaLogPeriodFilter] = useState('all');
  const [waLogStatusFilter, setWaLogStatusFilter] = useState<'all' | 'sent' | 'failed' | 'pending'>('all');
  const [waLogSearchQuery, setWaLogSearchQuery] = useState('');
  const [selectedWaLogDetail, setSelectedWaLogDetail] = useState<WhatsAppMessageLog | null>(null);

  // Toast Notification
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [toastType, setToastType] = useState<'success' | 'error' | 'info'>('success');

  const showToast = (msg: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToastMessage(msg);
    setToastType(type);
    setTimeout(() => {
      setToastMessage(null);
    }, 4000);
  };

  // Ambil template aktif dari localStorage
  const waTemplates = useMemo(() => {
    return loadWATemplates();
  }, [waPreviewInvoice]);

  // Template notifikasi khusus tagihan
  const availableInvoiceTemplates = useMemo(() => {
    const invoiceKeys: NotificationTemplateKey[] = ['due_reminder', 'overdue_notice', 'new_invoice'];
    const filtered = waTemplates.filter((t) => invoiceKeys.includes(t.id));
    return filtered.length > 0 ? filtered : waTemplates;
  }, [waTemplates]);

  // Handler membuka modal pratinjau WhatsApp (Requirement 1, 2, 3, 4, 5)
  const handleOpenWhatsappModal = (inv: Invoice) => {
    const cust = customers.find((c) => c.id === inv.customerId);
    const targetPhone = inv.customerPhone || cust?.phone || '';

    if (!targetPhone || targetPhone.replace(/\D/g, '').length < 8) {
      showToast('Nomor WhatsApp pelanggan tidak tersedia atau tidak valid.', 'error');
      return;
    }

    // Default template: jika status terlambat -> overdue_notice, jika belum dibayar -> due_reminder
    const defaultKey: NotificationTemplateKey = inv.status === 'overdue' ? 'overdue_notice' : 'due_reminder';
    setSelectedWaTemplateKey(defaultKey);

    const tpl = waTemplates.find((t) => t.id === defaultKey) || waTemplates[0];
    const rendered = tpl
      ? renderNotificationMessage(tpl.templateContent, {
          customer: cust,
          invoice: inv,
          contactPhone: settings?.phone || '0812-3456-7890',
          businessName: settings?.businessName || 'Adi_Hotspot Billing',
        })
      : '';

    setWaCustomMessage(rendered);
    setWaPreviewInvoice(inv);
    setIsSendingWA(false);
    setCopyFeedback(false);
  };

  // Handler pergantian template pada pratinjau
  const handleSelectTemplateKey = (key: NotificationTemplateKey) => {
    setSelectedWaTemplateKey(key);
    if (!waPreviewInvoice) return;
    const cust = customers.find((c) => c.id === waPreviewInvoice.customerId);
    const tpl = waTemplates.find((t) => t.id === key);
    if (tpl) {
      const rendered = renderNotificationMessage(tpl.templateContent, {
        customer: cust,
        invoice: waPreviewInvoice,
        contactPhone: settings?.phone || '0812-3456-7890',
        businessName: settings?.businessName || 'Adi_Hotspot Billing',
      });
      setWaCustomMessage(rendered);
    }
  };

  // Handler pengiriman pesan WhatsApp via backend proxy Wablas (Requirements 6, 7, 8, 9, 10, 12, 13, 14, 16, 17)
  const handleSendWhatsappMessage = async () => {
    if (isSendingWA) return; // Mencegah double submit / spam klik
    if (!waPreviewInvoice) return;

    const cust = customers.find((c) => c.id === waPreviewInvoice.customerId);
    const targetPhone = waPreviewInvoice.customerPhone || cust?.phone || '';

    if (!targetPhone || targetPhone.replace(/\D/g, '').length < 8) {
      showToast('Nomor WhatsApp penerima tidak valid.', 'error');
      return;
    }

    if (!waCustomMessage.trim()) {
      showToast('Isi pesan WhatsApp tidak boleh kosong.', 'error');
      return;
    }

    setIsSendingWA(true);

    try {
      // Panggil backend proxy Wablas (Token dijaga aman di sisi server)
      const res = await sendBackendTestMessage({
        targetPhone: targetPhone.trim(),
        messageContent: waCustomMessage.trim(),
      });

      const nowStr = new Date().toISOString().replace('T', ' ').slice(0, 16);
      const currentTpl = waTemplates.find((t) => t.id === selectedWaTemplateKey);
      const tplName = currentTpl?.name || 'Notifikasi Tagihan';

      // Simpan riwayat pengiriman (Requirement 10)
      const newLog: WhatsAppMessageLog = {
        id: `walog-${Date.now().toString().slice(-6)}`,
        timestamp: nowStr,
        customerName: waPreviewInvoice.customerName,
        customerId: waPreviewInvoice.customerId,
        phone: targetPhone.trim(),
        notificationType: selectedWaTemplateKey,
        notificationTypeName: tplName,
        messageContent: waCustomMessage.trim(),
        status: res.success ? 'sent' : 'failed',
        referenceId: waPreviewInvoice.invoiceNumber,
        errorMessage: res.success ? undefined : res.message,
      };

      const currentLogs = loadWAMessageLogs();
      const updatedLogs = [newLog, ...currentLogs];
      saveWAMessageLogs(updatedLogs);
      setWaLogs(updatedLogs);

      if (res.success) {
        showToast(
          `Pesan WhatsApp untuk invoice ${waPreviewInvoice.invoiceNumber} berhasil dikirim ke ${targetPhone}!`,
          'success'
        );
        setWaPreviewInvoice(null);
      } else {
        showToast(res.message || 'Gagal mengirim pesan WhatsApp via Wablas.', 'error');
      }
    } catch (err: any) {
      showToast('Terjadi kesalahan koneksi saat pengiriman pesan WhatsApp.', 'error');
    } finally {
      setIsSendingWA(false);
    }
  };

  // Form States (Create / Edit)
  const [formNumber, setFormNumber] = useState('');
  const [formCustomerId, setFormCustomerId] = useState('');
  const [formPackageId, setFormPackageId] = useState('');
  const [formPackageName, setFormPackageName] = useState('');
  const [formAmount, setFormAmount] = useState<number | string>(0);
  const [formMonthPeriod, setFormMonthPeriod] = useState('');
  const [formDueDate, setFormDueDate] = useState('');
  const [formStatus, setFormStatus] = useState<InvoiceStatus>('unpaid');
  const [formErrors, setFormErrors] = useState<InvoiceFormErrors>({});

  // Prorata & Billing Method info for Form Create (Modul B & D)
  const [formIsProrata, setFormIsProrata] = useState(false);
  const [formServicePeriodStart, setFormServicePeriodStart] = useState('');
  const [formServicePeriodEnd, setFormServicePeriodEnd] = useState('');
  const [formProrataDays, setFormProrataDays] = useState<number | undefined>(undefined);
  const [formPeriodTotalDays, setFormPeriodTotalDays] = useState<number | undefined>(undefined);
  const [formProrataCalculationNote, setFormProrataCalculationNote] = useState('');

  // Get current Indonesian month and year default
  const getDefaultPeriodString = () => {
    const d = new Date();
    const monthNames = [
      'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
      'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
    ];
    return `${monthNames[d.getMonth()]} ${d.getFullYear()}`;
  };

  // Open Create Modal (Modul B & D)
  // Open Create Modal (Sistem Sederhana Bulanan)
  const handleOpenCreateModal = () => {
    const autoNumber = generateUniqueInvoiceNumber(invoices);
    const defaultPeriod = getDefaultPeriodString();

    const firstCust = customers[0];
    const custId = firstCust?.id || '';
    const pkg =
      packages.find((p) => p.id === firstCust?.packageId) ||
      packages.find((p) => p.name === firstCust?.packageName) ||
      packages[0];

    // Due date standard: due date day in current month, or 7 days from now
    const now = new Date();
    const dueDay = firstCust?.dueDateDay || 10;
    const computedDueDate = new Date(now.getFullYear(), now.getMonth(), dueDay)
      .toISOString()
      .split('T')[0];

    setFormNumber(autoNumber);
    setFormCustomerId(custId);
    setFormPackageName(firstCust?.packageName || pkg?.name || 'Home Basic 10M');
    setFormAmount(firstCust?.monthlyFee || pkg?.price || 100000);
    setFormMonthPeriod(defaultPeriod);
    setFormDueDate(computedDueDate);
    setFormStatus('unpaid');
    setFormIsProrata(false);
    setFormServicePeriodStart('');
    setFormServicePeriodEnd('');
    setFormProrataDays(undefined);
    setFormPeriodTotalDays(undefined);
    setFormProrataCalculationNote('');
    setFormErrors({});
    setIsCreateOpen(true);
  };

  // Handle Customer Selection in Create Form (Sistem Sederhana Bulanan)
  const handleCustomerSelectChange = (selectedId: string) => {
    setFormCustomerId(selectedId);
    const cust = customers.find((c) => c.id === selectedId);
    if (cust) {
      const pkg =
        packages.find((p) => p.id === cust.packageId) ||
        packages.find((p) => p.name === cust.packageName) ||
        packages[0];

      const now = new Date();
      const dueDay = cust.dueDateDay || 10;
      const computedDueDate = new Date(now.getFullYear(), now.getMonth(), dueDay)
        .toISOString()
        .split('T')[0];

      setFormPackageName(cust.packageName || pkg?.name || '');
      setFormAmount(cust.monthlyFee || pkg?.price || 100000);
      setFormDueDate(computedDueDate);
      setFormIsProrata(false);
    }

    if (formErrors.customerId || formErrors.duplicate) {
      setFormErrors((prev) => ({ ...prev, customerId: undefined, duplicate: undefined }));
    }
  };

  // Handle Package Selection in Create / Edit Form
  const handlePackageSelectChange = (selectedPkgId: string) => {
    const pkg = packages.find((p) => p.id === selectedPkgId);
    if (pkg) {
      setFormPackageName(pkg.name);
      // Automatically adjust nominal based on package price, but admin can still customize
      setFormAmount(pkg.price);
    }
  };

  // Open Edit Modal
  const handleOpenEditModal = (inv: Invoice) => {
    setEditingInvoice(inv);
    setFormNumber(inv.invoiceNumber);
    setFormCustomerId(inv.customerId);
    setFormPackageName(inv.packageName);
    setFormAmount(inv.amount);
    setFormMonthPeriod(inv.monthPeriod);
    setFormDueDate(inv.dueDate);
    setFormStatus(inv.status);
    setFormErrors({});
  };

  // Form Validation
  const validateInvoiceForm = (isEditing: boolean, currentInvoiceId?: string): boolean => {
    const errors: InvoiceFormErrors = {};

    // 1. Pelanggan
    if (!formCustomerId) {
      errors.customerId = 'Pilih pelanggan untuk tagihan ini';
    }

    // 2. Periode Tagihan
    if (!formMonthPeriod.trim()) {
      errors.monthPeriod = 'Periode tagihan wajib diisi (contoh: Oktober 2026)';
    }

    // 3. Tanggal Jatuh Tempo
    if (!formDueDate) {
      errors.dueDate = 'Tanggal jatuh tempo wajib diisi';
    }

    // 4. Nominal Tagihan
    const numAmount = Number(formAmount);
    if (formAmount === '' || isNaN(numAmount)) {
      errors.amount = 'Nominal tagihan wajib diisi angka';
    } else if (numAmount < 0) {
      errors.amount = 'Nominal tagihan tidak boleh bernilai negatif';
    }

    // 5. Nomor Tagihan
    if (!formNumber.trim()) {
      errors.invoiceNumber = 'Nomor tagihan wajib diisi';
    } else {
      const exists = invoices.some((i) => {
        if (isEditing && currentInvoiceId && i.id === currentInvoiceId) {
          return false;
        }
        return i.invoiceNumber.toUpperCase() === formNumber.trim().toUpperCase();
      });
      if (exists) {
        errors.invoiceNumber = 'Nomor tagihan ini sudah terdaftar';
      }
    }

    // 6. Cegah Tagihan Ganda untuk Pelanggan dan Periode yang Sama!
    if (formCustomerId && formMonthPeriod.trim()) {
      const isDuplicate = checkDuplicateInvoice(
        invoices,
        formCustomerId,
        formMonthPeriod,
        isEditing ? currentInvoiceId : undefined
      );

      if (isDuplicate) {
        const cust = customers.find((c) => c.id === formCustomerId);
        const cName = cust ? cust.name : formCustomerId;
        errors.duplicate = `Tagihan ganda terdeteksi: Pelanggan "${cName}" sudah memiliki tagihan untuk periode "${formMonthPeriod.trim()}".`;
      }
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // Submit Create Invoice
  const handleSubmitCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateInvoiceForm(false)) return;

    const cust = customers.find((c) => c.id === formCustomerId);
    if (!cust) return;

    const newId = `inv-${Date.now().toString().slice(-6)}`;
    const todayStr = new Date().toISOString().split('T')[0];

    // Compute status dynamically based on due date if status is not paid
    const effectiveStatus: InvoiceStatus =
      formStatus === 'paid'
        ? 'paid'
        : computeInvoiceStatus({ status: 'unpaid', dueDate: formDueDate });

    const newInvoice: Invoice = {
      id: newId,
      invoiceNumber: formNumber.trim().toUpperCase(),
      customerId: cust.id,
      customerName: cust.name,
      customerPhone: cust.phone,
      packageName: formPackageName || cust.packageName,
      amount: Number(formAmount),
      monthPeriod: formMonthPeriod.trim(),
      dueDate: formDueDate,
      status: effectiveStatus,
      createdAt: todayStr,
      paidAt: effectiveStatus === 'paid' ? `${todayStr} 08:00` : undefined,
      paymentMethod: effectiveStatus === 'paid' ? 'cash' : undefined,
      isProrata: formIsProrata,
      servicePeriodStart: formServicePeriodStart,
      servicePeriodEnd: formServicePeriodEnd,
      prorataDays: formProrataDays,
      periodTotalDays: formPeriodTotalDays,
      prorataCalculationNote: formProrataCalculationNote,
    };

    try {
      const res = await onCreateInvoice(newInvoice);
      if (res && res.success === false) {
        setFormErrors({ amount: res.message || 'Gagal menerbitkan tagihan ke database.' });
        return;
      }
      setIsCreateOpen(false);
      showToast(`Tagihan "${newInvoice.invoiceNumber}" untuk ${newInvoice.customerName} berhasil diterbitkan!`);
    } catch (err: any) {
      setFormErrors({ amount: err?.message || 'Terjadi kesalahan sistem saat menghubungi database.' });
    }
  };

  // Submit Edit Invoice
  const handleSubmitEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingInvoice) return;
    if (!validateInvoiceForm(true, editingInvoice.id)) return;

    const cust = customers.find((c) => c.id === formCustomerId) || {
      name: editingInvoice.customerName,
      phone: editingInvoice.customerPhone,
    };

    // Calculate effective status
    let effectiveStatus = formStatus;
    if (effectiveStatus !== 'paid') {
      effectiveStatus = computeInvoiceStatus({ status: formStatus, dueDate: formDueDate });
    }

    const updatedInvoice: Invoice = {
      ...editingInvoice,
      invoiceNumber: formNumber.trim().toUpperCase(),
      packageName: formPackageName,
      amount: Number(formAmount),
      monthPeriod: formMonthPeriod.trim(),
      dueDate: formDueDate,
      status: effectiveStatus,
      customerName: cust.name,
      customerPhone: cust.phone,
      paidAt: effectiveStatus === 'paid' ? editingInvoice.paidAt || `${new Date().toISOString().split('T')[0]} 08:00` : undefined,
    };

    try {
      const res = await onEditInvoice(updatedInvoice);
      if (res && res.success === false) {
        setFormErrors({ amount: res.message || 'Gagal memperbarui tagihan di database.' });
        return;
      }
      setEditingInvoice(null);
      showToast(`Tagihan "${updatedInvoice.invoiceNumber}" berhasil diperbarui!`);
    } catch (err: any) {
      setFormErrors({ amount: err?.message || 'Terjadi kesalahan sistem saat menghubungi database.' });
    }
  };

  // Confirm Delete
  const handleConfirmDelete = async () => {
    if (!invoiceToDelete) return;
    const deletedNum = invoiceToDelete.invoiceNumber;
    const deletedCust = invoiceToDelete.customerName;

    try {
      const res = await onDeleteInvoice(invoiceToDelete.id);
      if (res && res.success === false) {
        showToast(res.message || 'Gagal menghapus tagihan dari database.');
        return;
      }
      setInvoiceToDelete(null);
      showToast(`Tagihan "${deletedNum}" (${deletedCust}) berhasil dihapus.`);
    } catch (err: any) {
      showToast(err?.message || 'Terjadi kesalahan sistem saat menghubungi database.');
    }
  };

  // Handle Pay Confirm from quick pay modal (menunggu COMMIT PostgreSQL)
  const handlePayConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedInvoiceToPay) return;
    try {
      const res = await onMarkAsPaid(selectedInvoiceToPay.id, payMethod, payNotes);
      if (res && res.success === false) {
        showToast(res.message || 'Gagal mencatat pelunasan di database PostgreSQL.');
        return;
      }
      setSelectedInvoiceToPay(null);
      showToast(`Pembayaran tagihan "${selectedInvoiceToPay.invoiceNumber}" berhasil dicatat di PostgreSQL.`);
    } catch (err: any) {
      showToast(err?.message || 'Terjadi kesalahan sistem saat memproses pembayaran.');
    }
  };

  // Unique list of periods for filter dropdown
  const uniquePeriods = useMemo(() => {
    const setP = new Set<string>();
    invoices.forEach((i) => {
      if (i.monthPeriod && i.monthPeriod.trim()) {
        setP.add(i.monthPeriod.trim());
      }
    });
    return Array.from(setP);
  }, [invoices]);

  // Compute updated invoice statuses based on current date
  const processedInvoices = useMemo(() => {
    return invoices.map((inv) => {
      const dynamicStatus = computeInvoiceStatus(inv);
      if (inv.status !== 'paid' && dynamicStatus !== inv.status) {
        return { ...inv, status: dynamicStatus };
      }
      return inv;
    });
  }, [invoices]);

  // Summary Metrics
  const totalInvoicesAmount = processedInvoices.reduce((sum, item) => sum + item.amount, 0);
  const paidInvoices = processedInvoices.filter((i) => i.status === 'paid');
  const totalPaidAmount = processedInvoices.reduce(
    (sum, item) => sum + (item.paidAmount !== undefined ? item.paidAmount : item.status === 'paid' ? item.amount : 0),
    0
  );

  const unpaidInvoices = processedInvoices.filter((i) => i.status === 'unpaid' || i.status === 'overdue');
  const totalUnpaidAmount = unpaidInvoices.reduce(
    (sum, item) => sum + (item.remainingAmount !== undefined ? item.remainingAmount : item.amount),
    0
  );
  const overdueCount = processedInvoices.filter((i) => i.status === 'overdue').length;

  // Filter & Search Logic
  const filteredInvoices = useMemo(() => {
    return processedInvoices.filter((inv) => {
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !q ||
        inv.invoiceNumber.toLowerCase().includes(q) ||
        inv.customerName.toLowerCase().includes(q) ||
        inv.customerId.toLowerCase().includes(q) ||
        inv.packageName.toLowerCase().includes(q) ||
        inv.customerPhone.includes(q);

      const matchesCustomer = customerFilter === 'all' || inv.customerId === customerFilter;
      const matchesPeriod = periodFilter === 'all' || inv.monthPeriod.toLowerCase() === periodFilter.toLowerCase();
      const matchesStatus = statusFilter === 'all' || inv.status === statusFilter;

      return matchesSearch && matchesCustomer && matchesPeriod && matchesStatus;
    });
  }, [processedInvoices, searchQuery, customerFilter, periodFilter, statusFilter]);

  const hasActiveFilters =
    searchQuery.trim() !== '' ||
    customerFilter !== 'all' ||
    periodFilter !== 'all' ||
    statusFilter !== 'all';

  const handleResetFilters = () => {
    setSearchQuery('');
    setCustomerFilter('all');
    setPeriodFilter('all');
    setStatusFilter('all');
  };

  // Memo: Log Pesan Notifikasi Terkait Tagihan (Requirements 10 & 11)
  const invoiceRelatedLogs = useMemo(() => {
    return waLogs.filter(
      (log) =>
        Boolean(log.referenceId && log.referenceId.startsWith('INV')) ||
        ['new_invoice', 'due_reminder', 'overdue_notice'].includes(log.notificationType)
    );
  }, [waLogs]);

  const totalWaSent = useMemo(() => {
    return invoiceRelatedLogs.filter((l) => l.status === 'sent').length;
  }, [invoiceRelatedLogs]);

  const totalWaFailed = useMemo(() => {
    return invoiceRelatedLogs.filter((l) => l.status === 'failed').length;
  }, [invoiceRelatedLogs]);

  // Filter Riwayat Notifikasi Tagihan (Requirement 11)
  const filteredWaLogs = useMemo(() => {
    return invoiceRelatedLogs.filter((log) => {
      // 1. Filter Pelanggan
      if (waLogCustomerFilter !== 'all') {
        const matchId = log.customerId === waLogCustomerFilter;
        const targetCust = customers.find((c) => c.id === waLogCustomerFilter);
        const matchName = targetCust && log.customerName.toLowerCase() === targetCust.name.toLowerCase();
        if (!matchId && !matchName) return false;
      }

      // 2. Filter Status
      if (waLogStatusFilter !== 'all' && log.status !== waLogStatusFilter) {
        return false;
      }

      // 3. Filter Periode Tagihan
      if (waLogPeriodFilter !== 'all') {
        const linkedInv = invoices.find((i) => i.invoiceNumber === log.referenceId);
        if (linkedInv) {
          if (linkedInv.monthPeriod.toLowerCase() !== waLogPeriodFilter.toLowerCase()) return false;
        } else {
          if (!log.timestamp.includes(waLogPeriodFilter)) return false;
        }
      }

      // 4. Pencarian
      if (waLogSearchQuery.trim()) {
        const q = waLogSearchQuery.toLowerCase();
        const matchNum = (log.referenceId || '').toLowerCase().includes(q);
        const matchName = log.customerName.toLowerCase().includes(q);
        const matchPhone = log.phone.toLowerCase().includes(q);
        const matchContent = log.messageContent.toLowerCase().includes(q);
        if (!matchNum && !matchName && !matchPhone && !matchContent) return false;
      }

      return true;
    });
  }, [invoiceRelatedLogs, waLogCustomerFilter, waLogStatusFilter, waLogPeriodFilter, waLogSearchQuery, customers, invoices]);

  const hasActiveWaLogFilters =
    waLogSearchQuery.trim() !== '' ||
    waLogCustomerFilter !== 'all' ||
    waLogPeriodFilter !== 'all' ||
    waLogStatusFilter !== 'all';

  const handleResetWaLogFilters = () => {
    setWaLogSearchQuery('');
    setWaLogCustomerFilter('all');
    setWaLogPeriodFilter('all');
    setWaLogStatusFilter('all');
  };

  return (
    <div className="space-y-5">
      {/* Toast Alert */}
      {toastMessage && (
        <div
          className={`fixed top-5 right-5 z-50 text-white text-xs sm:text-sm font-semibold px-4 py-3 rounded-xl shadow-xl flex items-center gap-2.5 border animate-in slide-in-from-top-4 duration-200 ${
            toastType === 'error'
              ? 'bg-rose-900 border-rose-700'
              : toastType === 'info'
              ? 'bg-blue-900 border-blue-700'
              : 'bg-slate-900 border-slate-700'
          }`}
        >
          {toastType === 'error' ? (
            <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
          ) : toastType === 'info' ? (
            <Info className="w-4 h-4 text-blue-400 shrink-0" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          )}
          <span>{toastMessage}</span>
          <button
            onClick={() => setToastMessage(null)}
            className="ml-2 text-slate-400 hover:text-white"
          >
            ✕
          </button>
        </div>
      )}

      {/* Sub-Tabs: Daftar Tagihan vs Riwayat WhatsApp (Requirements 10 & 11) */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200/90 pb-3">
        <div>
          <h2 className="text-lg sm:text-xl font-bold text-slate-900 flex items-center gap-2">
            <Receipt className="w-5 h-5 text-blue-600" />
            <span>Manajemen Tagihan & Notifikasi WhatsApp</span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Terbitkan tagihan pelanggan dan kirim pengingat WhatsApp resmi via gateway Wablas backend.
          </p>
        </div>

        <div className="flex items-center gap-1.5 p-1 bg-slate-200/70 rounded-xl shrink-0 self-start sm:self-auto text-xs">
          <button
            onClick={() => setActiveTab('invoices')}
            className={`px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 transition-all ${
              activeTab === 'invoices'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Receipt className="w-3.5 h-3.5" />
            <span>Daftar Tagihan</span>
            <span className="px-1.5 py-0.2 text-[10px] rounded-full bg-blue-100 text-blue-700 font-bold">
              {invoices.length}
            </span>
          </button>
          <button
            onClick={() => {
              setWaLogs(loadWAMessageLogs());
              setActiveTab('history');
            }}
            className={`px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 transition-all ${
              activeTab === 'history'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <History className="w-3.5 h-3.5 text-emerald-600" />
            <span>Riwayat WhatsApp Tagihan</span>
            <span className="px-1.5 py-0.2 text-[10px] rounded-full bg-emerald-100 text-emerald-800 font-bold">
              {invoiceRelatedLogs.length}
            </span>
          </button>
        </div>
      </div>

      {/* TAB 1: DAFTAR TAGIHAN */}
      {activeTab === 'invoices' && (
        <div className="space-y-5">
          {/* Notice Banner: Local Storage Persistence */}
          <div className="bg-blue-50/80 border border-blue-200/90 rounded-xl p-3.5 sm:p-4 text-xs text-blue-900 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-xs">
        <div className="flex items-start gap-2.5">
          <div className="p-1 rounded bg-blue-200/70 text-blue-800 shrink-0 mt-0.5">
            <Database className="w-3.5 h-3.5" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <strong className="font-bold text-blue-950">
                Data Tagihan (Database PostgreSQL)
              </strong>
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-200">
                adi_hotspot
              </span>
            </div>
            <p className="text-blue-800/90 text-[11px] mt-0.5">
              Seluruh data tagihan disimpan langsung di database PostgreSQL. Anda dapat menerbitkan
              tagihan baru, mengedit, melihat detail, dan mencatat pelunasan dengan integritas data terpusat.
            </p>
          </div>
        </div>
        <div className="text-[11px] font-semibold text-blue-700 bg-white px-2.5 py-1 rounded-lg border border-blue-200 shrink-0">
          Total: {invoices.length} Tagihan
        </div>
      </div>

      {/* 3 Summary Cards (Requirement 8) */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* 1. Total Tagihan */}
        <div className="bg-white rounded-xl p-4 sm:p-5 border border-slate-200/90 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Total Tagihan
            </span>
            <div className="w-9 h-9 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
              <Receipt className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 text-xl sm:text-2xl font-bold text-slate-900 tracking-tight truncate">
            {formatRupiah(totalInvoicesAmount)}
          </div>
          <div className="mt-1 text-xs text-slate-500 flex items-center gap-1.5">
            <span className="font-semibold text-slate-700">{processedInvoices.length} Invoice</span>
            <span>diterbitkan</span>
          </div>
        </div>

        {/* 2. Tagihan Lunas */}
        <div className="bg-white rounded-xl p-4 sm:p-5 border border-slate-200/90 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-emerald-600">
              Tagihan Lunas
            </span>
            <div className="w-9 h-9 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <CheckCircle2 className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 text-xl sm:text-2xl font-bold text-emerald-600 tracking-tight truncate">
            {formatRupiah(totalPaidAmount)}
          </div>
          <div className="mt-1 text-xs text-emerald-700 font-medium flex items-center gap-1.5">
            <span className="font-semibold">{paidInvoices.length} Invoice</span>
            <span>telah lunas</span>
          </div>
        </div>

        {/* 3. Tagihan Belum Dibayar */}
        <div className="bg-white rounded-xl p-4 sm:p-5 border border-slate-200/90 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-amber-600">
              Tagihan Belum Dibayar
            </span>
            <div className="w-9 h-9 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
              <AlertCircle className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 text-xl sm:text-2xl font-bold text-amber-600 tracking-tight truncate">
            {formatRupiah(totalUnpaidAmount)}
          </div>
          <div className="mt-1 text-xs text-slate-500 flex items-center gap-1.5 flex-wrap">
            <span className="font-semibold text-amber-800">{unpaidInvoices.length} Invoice</span>
            <span>tertunda</span>
            {overdueCount > 0 && (
              <span className="text-rose-600 font-semibold bg-rose-50 px-1.5 py-0.2 rounded text-[11px] border border-rose-200">
                {overdueCount} Terlambat
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Search, Filter Toolbar & Action */}
      <div className="bg-white rounded-xl p-4 border border-slate-200/90 shadow-xs space-y-3">
        <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
          {/* Search Input */}
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari nomor tagihan (INV/...), nama pelanggan, ID pelanggan, atau paket..."
              className="w-full pl-10 pr-9 py-2.5 text-xs sm:text-sm rounded-lg border border-slate-200 bg-slate-50/60 focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all placeholder:text-slate-400"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5"
                title="Hapus pencarian"
              >
                ✕
              </button>
            )}
          </div>

          {/* Actions: Export & Buat Tagihan */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setIsExportModalOpen(true)}
              className="px-3.5 py-2.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs sm:text-sm font-semibold flex items-center justify-center gap-1.5 transition-colors shadow-xs"
              title="Export data tagihan ke Excel / CSV"
            >
              <Download className="w-4 h-4 text-blue-600" />
              <span>Export Tagihan</span>
            </button>

            <button
              onClick={handleOpenCreateModal}
              className="px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs sm:text-sm font-semibold flex items-center justify-center gap-2 transition-colors shadow-xs"
            >
              <Plus className="w-4 h-4" />
              <span>Buat Tagihan</span>
            </button>
          </div>
        </div>

        {/* Filter Row: Pelanggan, Periode, Status (Requirement 7) */}
        <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2.5 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 text-slate-500 font-semibold text-[11px] uppercase tracking-wider mr-1">
              <Filter className="w-3.5 h-3.5 text-slate-400" />
              <span>Filter:</span>
            </div>

            {/* Filter Pelanggan */}
            <select
              value={customerFilter}
              onChange={(e) => setCustomerFilter(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-slate-700 font-medium focus:ring-1 focus:ring-blue-500 max-w-xs"
            >
              <option value="all">Semua Pelanggan</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.id})
                </option>
              ))}
            </select>

            {/* Filter Periode */}
            <select
              value={periodFilter}
              onChange={(e) => setPeriodFilter(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-slate-700 font-medium focus:ring-1 focus:ring-blue-500"
            >
              <option value="all">Semua Periode</option>
              {uniquePeriods.map((period) => (
                <option key={period} value={period}>
                  {period}
                </option>
              ))}
            </select>

            {/* Filter Status */}
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-slate-700 font-medium focus:ring-1 focus:ring-blue-500"
            >
              <option value="all">Semua Status</option>
              <option value="unpaid">Belum Dibayar</option>
              <option value="overdue">Terlambat</option>
              <option value="paid">Lunas</option>
            </select>

            {/* Reset Filter Button */}
            {hasActiveFilters && (
              <button
                onClick={handleResetFilters}
                className="px-2.5 py-1.5 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 flex items-center gap-1 transition-colors text-xs font-medium"
              >
                <RotateCcw className="w-3 h-3 text-slate-500" />
                <span>Reset</span>
              </button>
            )}
          </div>

          <div className="text-[11px] text-slate-500">
            Menampilkan <strong className="text-slate-800">{filteredInvoices.length}</strong> dari{' '}
            {invoices.length} data
          </div>
        </div>
      </div>

      {/* Table: All 8 Required Columns (Requirement 1) */}
      <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs sm:text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold text-[11px] uppercase tracking-wider">
              <tr>
                <th className="px-3.5 py-3.5 whitespace-nowrap">Nomor Tagihan</th>
                <th className="px-3.5 py-3.5 whitespace-nowrap">ID Pelanggan</th>
                <th className="px-3.5 py-3.5 whitespace-nowrap">Nama Pelanggan</th>
                <th className="px-3.5 py-3.5 whitespace-nowrap">Paket Internet</th>
                <th className="px-3.5 py-3.5 whitespace-nowrap">Periode Tagihan</th>
                <th className="px-3.5 py-3.5 whitespace-nowrap">Jatuh Tempo</th>
                <th className="px-3.5 py-3.5 whitespace-nowrap">Nominal Tagihan</th>
                <th className="px-3.5 py-3.5 whitespace-nowrap">Status</th>
                <th className="px-3.5 py-3.5 text-right whitespace-nowrap">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredInvoices.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center py-12 px-4 text-slate-500">
                    <div className="max-w-xs mx-auto">
                      <Receipt className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                      <p className="font-semibold text-slate-700 text-sm">
                        Tidak ada tagihan yang sesuai
                      </p>
                      <p className="text-xs text-slate-400 mt-1">
                        Sesuaikan kata kunci pencarian atau reset filter di atas.
                      </p>
                      {hasActiveFilters && (
                        <button
                          onClick={handleResetFilters}
                          className="mt-3 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold"
                        >
                          Reset Semua Filter
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                filteredInvoices.map((inv) => {
                  const statusStyle = getInvoiceStatusBadge(inv.status);
                  const isPaid = inv.status === 'paid';
                  const isOverdue = inv.status === 'overdue';

                  return (
                    <tr key={inv.id} className="hover:bg-slate-50/80 transition-colors">
                      {/* 1. Nomor Tagihan */}
                      <td className="px-3.5 py-3.5 whitespace-nowrap font-mono font-bold text-slate-900 text-xs">
                        <span className="bg-slate-100 text-slate-800 px-2 py-1 rounded-md border border-slate-200">
                          {inv.invoiceNumber}
                        </span>
                      </td>

                      {/* 2. ID Pelanggan */}
                      <td className="px-3.5 py-3.5 whitespace-nowrap font-mono text-xs text-slate-700 font-semibold">
                        {inv.customerId}
                      </td>

                      {/* 3. Nama Pelanggan */}
                      <td className="px-3.5 py-3.5 whitespace-nowrap">
                        <div className="font-bold text-slate-900">{inv.customerName}</div>
                        {inv.customerPhone && (
                          <div className="text-[11px] text-slate-400 mt-0.5">{inv.customerPhone}</div>
                        )}
                      </td>

                      {/* 4. Paket Internet */}
                      <td className="px-3.5 py-3.5 whitespace-nowrap font-medium text-slate-800">
                        {inv.packageName}
                      </td>

                      {/* 5. Periode Tagihan */}
                      <td className="px-3.5 py-3.5 whitespace-nowrap text-slate-700 font-medium">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span>{inv.monthPeriod}</span>
                          {inv.isProrata && (
                            <span
                              className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-800 border border-purple-200"
                              title={inv.prorataCalculationNote || 'Tagihan pertama dihitung secara prorata'}
                            >
                              PRORATA
                            </span>
                          )}
                        </div>
                      </td>

                      {/* 6. Tanggal Jatuh Tempo */}
                      <td className="px-3.5 py-3.5 whitespace-nowrap">
                        <div
                          className={`flex items-center gap-1 font-medium ${
                            isOverdue ? 'text-rose-600 font-bold' : 'text-slate-600'
                          }`}
                        >
                          <Calendar className={`w-3.5 h-3.5 ${isOverdue ? 'text-rose-500' : 'text-slate-400'}`} />
                          <span>{formatDateIndo(inv.dueDate)}</span>
                        </div>
                      </td>

                      {/* 7. Nominal Tagihan */}
                      <td className="px-3.5 py-3.5 whitespace-nowrap">
                        <span className="font-extrabold text-slate-900 text-sm">
                          {formatRupiah(inv.amount)}
                        </span>
                      </td>

                      {/* 8. Status (Belum Dibayar, Lunas, Terlambat) */}
                      <td className="px-3.5 py-3.5 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${statusStyle.bg}`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${statusStyle.dot}`} />
                          {statusStyle.label}
                        </span>
                        {inv.paidAt && (
                          <span className="block text-[10px] text-slate-400 mt-0.5">
                            Lunas: {inv.paidAt}
                          </span>
                        )}
                      </td>

                      {/* 9. Aksi: Detail, Edit, Hapus, Quick Pay & WA */}
                      <td className="px-3.5 py-3.5 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1">
                          {/* Detail Button (Requirement 2) */}
                          <button
                            onClick={() => setDetailInvoice(inv)}
                            className="p-1.5 rounded-lg text-slate-500 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                            title="Detail Tagihan"
                            aria-label="Detail"
                          >
                            <Eye className="w-4 h-4" />
                          </button>

                          {/* Edit Button (Requirement 2) */}
                          <button
                            onClick={() => handleOpenEditModal(inv)}
                            className="p-1.5 rounded-lg text-slate-500 hover:text-amber-600 hover:bg-amber-50 transition-colors"
                            title="Edit Tagihan"
                            aria-label="Edit"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>

                          {/* Hapus Button (Requirement 2) */}
                          <button
                            onClick={() => setInvoiceToDelete(inv)}
                            className="p-1.5 rounded-lg text-slate-500 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                            title="Hapus Tagihan"
                            aria-label="Hapus"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>

                          {/* Action Catat Bayar (jika belum lunas) */}
                          {!isPaid ? (
                            <button
                              onClick={() => {
                                setSelectedInvoiceToPay(inv);
                                setPayNotes(`Pelunasan tagihan ${inv.invoiceNumber}`);
                              }}
                              className="ml-1 px-2.5 py-1 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold flex items-center gap-1 transition-colors shadow-xs"
                              title="Catat Pelunasan"
                            >
                              <CreditCard className="w-3 h-3" />
                              <span className="hidden xl:inline">Bayar</span>
                            </button>
                          ) : (
                            <span className="ml-1 text-[11px] font-semibold text-emerald-600 px-2 py-0.5 rounded bg-emerald-50">
                              ✓ Lunas
                            </span>
                          )}

                          {/* Tombol WhatsApp Gateway Wablas (Requirements 1 & 2) */}
                          {(() => {
                            const rowCust = customers.find((c) => c.id === inv.customerId);
                            const rowPhone = inv.customerPhone || rowCust?.phone || '';
                            const hasValidPhone = Boolean(rowPhone && rowPhone.replace(/\D/g, '').length >= 8);
                            const canSendWa = hasValidPhone && !isPaid;

                            if (canSendWa) {
                              return (
                                <button
                                  onClick={() => handleOpenWhatsappModal(inv)}
                                  className="p-1.5 rounded-lg text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 bg-emerald-50/60 border border-emerald-200/80 transition-all flex items-center gap-1 shadow-2xs"
                                  title={`Kirim Pengingat WhatsApp via Wablas ke ${rowPhone}`}
                                  aria-label="Kirim WhatsApp"
                                >
                                  <MessageSquare className="w-4 h-4 text-emerald-600" />
                                  <span className="text-[11px] font-semibold text-emerald-700 hidden 2xl:inline">WA</span>
                                </button>
                              );
                            }

                            if (isPaid) {
                              return (
                                <button
                                  disabled
                                  className="p-1.5 rounded-lg text-slate-300 bg-slate-50 cursor-not-allowed border border-slate-200/40"
                                  title="Tagihan sudah lunas (Tidak perlu pengingat WhatsApp)"
                                  aria-label="WhatsApp Dinonaktifkan"
                                >
                                  <MessageSquare className="w-4 h-4" />
                                </button>
                              );
                            }

                            return (
                              <button
                                disabled
                                className="p-1.5 rounded-lg text-slate-300 bg-slate-50 cursor-not-allowed border border-slate-200/40"
                                title="Nomor WhatsApp pelanggan belum diisi / tidak valid"
                                aria-label="WhatsApp Dinonaktifkan"
                              >
                                <MessageSquare className="w-4 h-4" />
                              </button>
                            );
                          })()}
                        </div>
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

      {/* TAB 2: RIWAYAT NOTIFIKASI WHATSAPP TAGIHAN (Requirements 10 & 11) */}
      {activeTab === 'history' && (
        <div className="space-y-4 animate-in fade-in duration-150">
          {/* Summary Cards Riwayat */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white rounded-xl p-4 sm:p-5 border border-slate-200/90 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-emerald-600">
                  Notifikasi Terkirim
                </span>
                <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
                  <CheckCircle2 className="w-4 h-4" />
                </div>
              </div>
              <div className="mt-2 text-2xl font-bold text-slate-900">{totalWaSent}</div>
              <div className="mt-1 text-xs text-slate-500">Pesan WhatsApp berhasil terkirim</div>
            </div>

            <div className="bg-white rounded-xl p-4 sm:p-5 border border-slate-200/90 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-rose-600">
                  Notifikasi Gagal
                </span>
                <div className="w-8 h-8 rounded-lg bg-rose-50 text-rose-600 flex items-center justify-center">
                  <XCircle className="w-4 h-4" />
                </div>
              </div>
              <div className="mt-2 text-2xl font-bold text-rose-600">{totalWaFailed}</div>
              <div className="mt-1 text-xs text-slate-500">Pesan gagal dikirim</div>
            </div>

            <div className="bg-white rounded-xl p-4 sm:p-5 border border-slate-200/90 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-blue-600">
                  Total Riwayat Tagihan
                </span>
                <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
                  <MessageSquare className="w-4 h-4" />
                </div>
              </div>
              <div className="mt-2 text-2xl font-bold text-slate-900">{invoiceRelatedLogs.length}</div>
              <div className="mt-1 text-xs text-slate-500">Catatan notifikasi terkait invoice</div>
            </div>
          </div>

          {/* Filter Bar Riwayat (Requirement 11) */}
          <div className="bg-white rounded-xl p-4 border border-slate-200/90 shadow-xs space-y-3">
            <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={waLogSearchQuery}
                  onChange={(e) => setWaLogSearchQuery(e.target.value)}
                  placeholder="Cari nomor tagihan (INV/...), nama pelanggan, atau nomor HP..."
                  className="w-full pl-10 pr-9 py-2.5 text-xs sm:text-sm rounded-lg border border-slate-200 bg-slate-50/60 focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all placeholder:text-slate-400"
                />
                {waLogSearchQuery && (
                  <button
                    onClick={() => setWaLogSearchQuery('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5"
                  >
                    ✕
                  </button>
                )}
              </div>

              <button
                onClick={() => setActiveTab('invoices')}
                className="px-4 py-2.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs sm:text-sm font-semibold flex items-center justify-center gap-1.5 transition-colors shrink-0"
              >
                <Receipt className="w-4 h-4" />
                <span>Ke Daftar Tagihan</span>
              </button>
            </div>

            {/* Filter Row: Pelanggan, Periode, Status (Requirement 11) */}
            <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2.5 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1.5 text-slate-500 font-semibold text-[11px] uppercase tracking-wider mr-1">
                  <Filter className="w-3.5 h-3.5 text-slate-400" />
                  <span>Filter Riwayat:</span>
                </div>

                {/* Filter Pelanggan */}
                <select
                  value={waLogCustomerFilter}
                  onChange={(e) => setWaLogCustomerFilter(e.target.value)}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-slate-700 font-medium focus:ring-1 focus:ring-blue-500 max-w-xs"
                >
                  <option value="all">Semua Pelanggan</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.id})
                    </option>
                  ))}
                </select>

                {/* Filter Periode */}
                <select
                  value={waLogPeriodFilter}
                  onChange={(e) => setWaLogPeriodFilter(e.target.value)}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-slate-700 font-medium focus:ring-1 focus:ring-blue-500"
                >
                  <option value="all">Semua Periode</option>
                  {uniquePeriods.map((period) => (
                    <option key={period} value={period}>
                      {period}
                    </option>
                  ))}
                </select>

                {/* Filter Status */}
                <select
                  value={waLogStatusFilter}
                  onChange={(e) => setWaLogStatusFilter(e.target.value as any)}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-slate-700 font-medium focus:ring-1 focus:ring-blue-500"
                >
                  <option value="all">Semua Status</option>
                  <option value="sent">Terkirim (Sukses)</option>
                  <option value="failed">Gagal</option>
                  <option value="pending">Menunggu</option>
                </select>

                {/* Reset Filters */}
                {hasActiveWaLogFilters && (
                  <button
                    onClick={handleResetWaLogFilters}
                    className="px-2.5 py-1.5 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 flex items-center gap-1 transition-colors text-xs font-medium"
                  >
                    <RotateCcw className="w-3 h-3 text-slate-500" />
                    <span>Reset</span>
                  </button>
                )}
              </div>

              <div className="text-[11px] text-slate-500">
                Menampilkan <strong className="text-slate-800">{filteredWaLogs.length}</strong> dari{' '}
                {invoiceRelatedLogs.length} riwayat
              </div>
            </div>
          </div>

          {/* Table Riwayat Pesan WhatsApp */}
          <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs sm:text-sm">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold text-[11px] uppercase tracking-wider">
                  <tr>
                    <th className="px-3.5 py-3.5 whitespace-nowrap">Waktu Kirim</th>
                    <th className="px-3.5 py-3.5 whitespace-nowrap">Nomor Tagihan</th>
                    <th className="px-3.5 py-3.5 whitespace-nowrap">Pelanggan</th>
                    <th className="px-3.5 py-3.5 whitespace-nowrap">Nomor WhatsApp</th>
                    <th className="px-3.5 py-3.5 whitespace-nowrap">Jenis Pesan</th>
                    <th className="px-3.5 py-3.5 whitespace-nowrap">Status</th>
                    <th className="px-3.5 py-3.5 text-right whitespace-nowrap">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredWaLogs.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-center py-12 px-4 text-slate-500">
                        <div className="max-w-xs mx-auto">
                          <MessageSquare className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                          <p className="font-semibold text-slate-700 text-sm">
                            Belum ada riwayat notifikasi tagihan
                          </p>
                          <p className="text-xs text-slate-400 mt-1">
                            Kirim pengingat WhatsApp pada daftar tagihan untuk mulai mencatat riwayat.
                          </p>
                          {hasActiveWaLogFilters && (
                            <button
                              onClick={handleResetWaLogFilters}
                              className="mt-3 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold"
                            >
                              Reset Filter
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ) : (
                    filteredWaLogs.map((log) => {
                      const isSent = log.status === 'sent';
                      const isFailed = log.status === 'failed';

                      return (
                        <tr key={log.id} className="hover:bg-slate-50/80 transition-colors">
                          <td className="px-3.5 py-3.5 whitespace-nowrap text-slate-600 font-medium text-xs">
                            <div className="flex items-center gap-1.5">
                              <Clock className="w-3.5 h-3.5 text-slate-400" />
                              <span>{log.timestamp}</span>
                            </div>
                          </td>

                          <td className="px-3.5 py-3.5 whitespace-nowrap font-mono font-bold text-slate-900 text-xs">
                            <span className="bg-slate-100 text-slate-800 px-2 py-1 rounded-md border border-slate-200">
                              {log.referenceId || '-'}
                            </span>
                          </td>

                          <td className="px-3.5 py-3.5 whitespace-nowrap">
                            <div className="font-bold text-slate-900">{log.customerName}</div>
                            {log.customerId && (
                              <div className="text-[11px] text-slate-400 font-mono mt-0.5">
                                {log.customerId}
                              </div>
                            )}
                          </td>

                          <td className="px-3.5 py-3.5 whitespace-nowrap font-mono text-slate-700 text-xs">
                            {log.phone}
                          </td>

                          <td className="px-3.5 py-3.5 whitespace-nowrap">
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                              {log.notificationTypeName}
                            </span>
                          </td>

                          <td className="px-3.5 py-3.5 whitespace-nowrap">
                            <span
                              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${
                                isSent
                                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                  : isFailed
                                  ? 'bg-rose-50 text-rose-700 border-rose-200'
                                  : 'bg-amber-50 text-amber-700 border-amber-200'
                              }`}
                            >
                              <span
                                className={`w-1.5 h-1.5 rounded-full ${
                                  isSent ? 'bg-emerald-500' : isFailed ? 'bg-rose-500' : 'bg-amber-500'
                                }`}
                              />
                              {isSent ? 'Terkirim' : isFailed ? 'Gagal' : 'Menunggu'}
                            </span>
                            {log.errorMessage && (
                              <span
                                className="block text-[10px] text-rose-600 mt-0.5 max-w-xs truncate"
                                title={log.errorMessage}
                              >
                                {log.errorMessage}
                              </span>
                            )}
                          </td>

                          <td className="px-3.5 py-3.5 text-right whitespace-nowrap">
                            <button
                              onClick={() => setSelectedWaLogDetail(log)}
                              className="px-2.5 py-1 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold flex items-center gap-1 transition-colors ml-auto"
                              title="Lihat isi pesan lengkap"
                            >
                              <Eye className="w-3.5 h-3.5 text-slate-500" />
                              <span>Lihat Pesan</span>
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
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-xl w-full p-6 shadow-2xl border border-slate-200 relative my-8 animate-in fade-in duration-150">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div>
                <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <Receipt className="w-5 h-5 text-blue-600" />
                  Buat Tagihan Baru
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Nomor tagihan otomatis dan unik. Nominal default mengikuti harga paket.
                </p>
              </div>
              <button
                onClick={() => setIsCreateOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmitCreate} className="py-4 space-y-4 text-xs">
              {/* Duplicate Warning Banner (Requirement 6) */}
              {formErrors.duplicate && (
                <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-900 flex items-start gap-2.5 animate-in fade-in">
                  <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold text-rose-950 block">Pencegahan Tagihan Ganda:</span>
                    <p className="text-[11px] text-rose-800 leading-snug mt-0.5">
                      {formErrors.duplicate}
                    </p>
                  </div>
                </div>
              )}

              {/* Nomor Tagihan (Auto-Generated & Unique) */}
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 flex items-center justify-between">
                <div>
                  <span className="text-[11px] font-semibold text-slate-500 block">
                    Nomor Tagihan (Otomatis & Unik)
                  </span>
                  <span className="font-mono font-bold text-base text-blue-700">{formNumber}</span>
                </div>
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded bg-blue-100 text-blue-800">
                  <Hash className="w-3 h-3" />
                  Auto Generated
                </span>
              </div>

              {/* Pilih Pelanggan (Requirement 3) */}
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Pilih Pelanggan Terdaftar <span className="text-rose-500">*</span>
                </label>
                <select
                  value={formCustomerId}
                  onChange={(e) => handleCustomerSelectChange(e.target.value)}
                  className={`w-full px-3 py-2 rounded-lg border bg-white font-medium ${
                    formErrors.customerId ? 'border-rose-400 ring-2 ring-rose-200' : 'border-slate-200'
                  }`}
                >
                  <option value="">-- Pilih Pelanggan --</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.id}) • Paket: {c.packageName} ({formatRupiah(c.monthlyFee)})
                    </option>
                  ))}
                </select>
                {formErrors.customerId && (
                  <p className="text-rose-600 text-[11px] mt-1 font-medium">{formErrors.customerId}</p>
                )}
              </div>

              {/* Prorata / Anniversary Calculation Notice (Modul B & D) */}
              {formIsProrata && (
                <div className="p-3 bg-purple-50 border border-purple-200 rounded-xl text-purple-950 text-xs flex items-start gap-2.5 animate-in fade-in">
                  <div className="p-1.5 rounded-lg bg-purple-200 text-purple-800 shrink-0 mt-0.5">
                    <Calculator className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-purple-900">Perhitungan Prorata Tagihan Pertama Aktif</span>
                      <span className="text-[10px] bg-purple-200 px-2 py-0.2 rounded font-mono font-bold text-purple-900">
                        PRORATA
                      </span>
                    </div>
                    <p className="text-[11px] text-purple-800 mt-0.5 leading-relaxed">
                      Masa layanan: <strong>{formatDateIndo(formServicePeriodStart)} s/d {formatDateIndo(formServicePeriodEnd)}</strong> ({formProrataDays} hari layanan).
                      {formProrataCalculationNote && ` Rincian: ${formProrataCalculationNote}.`} Nominal disesuaikan otomatis (dapat diubah bila perlu).
                    </p>
                  </div>
                </div>
              )}

              {/* Paket Internet & Nominal Tagihan (Requirement 3 & 4) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Paket Internet Tagihan
                  </label>
                  <select
                    value={packages.find((p) => p.name === formPackageName)?.id || ''}
                    onChange={(e) => handlePackageSelectChange(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white font-medium"
                  >
                    {packages.map((pkg) => (
                      <option key={pkg.id} value={pkg.id}>
                        {pkg.name} ({formatRupiah(pkg.price)})
                      </option>
                    ))}
                  </select>
                  <span className="text-[10px] text-slate-400 block mt-1">
                    Pilihan paket otomatis menyesuaikan nominal tagihan
                  </span>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Nominal Tagihan (Rupiah) <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="1000"
                    value={formAmount}
                    onChange={(e) => {
                      setFormAmount(e.target.value);
                      if (formErrors.amount) setFormErrors((prev) => ({ ...prev, amount: undefined }));
                    }}
                    placeholder="Contoh: 165000"
                    className={`w-full px-3 py-2 rounded-lg border font-bold text-sm ${
                      formErrors.amount ? 'border-rose-400 ring-2 ring-rose-200' : 'border-slate-200'
                    }`}
                  />
                  {formErrors.amount ? (
                    <p className="text-rose-600 text-[11px] mt-1 font-medium">{formErrors.amount}</p>
                  ) : (
                    <span className="text-[10px] text-emerald-600 block mt-1">
                      Dapat disesuaikan admin (diskon/denda) tanpa mengubah harga master paket
                    </span>
                  )}
                </div>
              </div>

              {/* Periode Tagihan & Tanggal Jatuh Tempo */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Periode Tagihan <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formMonthPeriod}
                    onChange={(e) => {
                      setFormMonthPeriod(e.target.value);
                      if (formErrors.monthPeriod || formErrors.duplicate) {
                        setFormErrors((prev) => ({ ...prev, monthPeriod: undefined, duplicate: undefined }));
                      }
                    }}
                    placeholder="Contoh: Oktober 2026 atau November 2026"
                    className={`w-full px-3 py-2 rounded-lg border ${
                      formErrors.monthPeriod ? 'border-rose-400 ring-2 ring-rose-200' : 'border-slate-200'
                    }`}
                  />
                  {formErrors.monthPeriod && (
                    <p className="text-rose-600 text-[11px] mt-1 font-medium">{formErrors.monthPeriod}</p>
                  )}
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Tanggal Jatuh Tempo <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="date"
                    value={formDueDate}
                    onChange={(e) => {
                      setFormDueDate(e.target.value);
                      if (formErrors.dueDate) setFormErrors((prev) => ({ ...prev, dueDate: undefined }));
                    }}
                    className={`w-full px-3 py-2 rounded-lg border ${
                      formErrors.dueDate ? 'border-rose-400 ring-2 ring-rose-200' : 'border-slate-200'
                    }`}
                  />
                  {formErrors.dueDate && (
                    <p className="text-rose-600 text-[11px] mt-1 font-medium">{formErrors.dueDate}</p>
                  )}
                </div>
              </div>

              {/* Status Awal Tagihan */}
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Status Pembayaran Awal
                </label>
                <select
                  value={formStatus}
                  onChange={(e) => setFormStatus(e.target.value as InvoiceStatus)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white font-medium"
                >
                  <option value="unpaid">Belum Dibayar (Menunggu Pelunasan)</option>
                  <option value="paid">Lunas (Pelanggan Langsung Bayar di Muka)</option>
                </select>
                <span className="text-[10px] text-slate-400 block mt-1">
                  Status "Terlambat" otomatis dihitung bila belum dibayar dan melewati tanggal jatuh tempo.
                </span>
              </div>

              {/* Actions */}
              <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setIsCreateOpen(false)}
                  className="px-4 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold shadow-xs flex items-center gap-1.5"
                >
                  <Check className="w-4 h-4" />
                  <span>Terbitkan Tagihan</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: EDIT TAGIHAN (Requirements 2, 4, 6, 11) */}
      {editingInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-xl w-full p-6 shadow-2xl border border-slate-200 relative my-8 animate-in fade-in duration-150">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div>
                <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <Edit2 className="w-5 h-5 text-amber-600" />
                  Edit Tagihan ({editingInvoice.invoiceNumber})
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Pelanggan: {editingInvoice.customerName} ({editingInvoice.customerId})
                </p>
              </div>
              <button
                onClick={() => setEditingInvoice(null)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmitEdit} className="py-4 space-y-4 text-xs">
              {/* Duplicate Warning */}
              {formErrors.duplicate && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-900 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <p className="text-[11px] leading-snug">{formErrors.duplicate}</p>
                </div>
              )}

              {/* Nomor Tagihan */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Nomor Tagihan</label>
                  <input
                    type="text"
                    value={formNumber}
                    onChange={(e) => setFormNumber(e.target.value.toUpperCase())}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 font-mono text-xs uppercase"
                  />
                  {formErrors.invoiceNumber && (
                    <p className="text-rose-600 text-[11px] mt-1 font-medium">{formErrors.invoiceNumber}</p>
                  )}
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Paket Internet</label>
                  <select
                    value={packages.find((p) => p.name === formPackageName)?.id || ''}
                    onChange={(e) => handlePackageSelectChange(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white font-medium"
                  >
                    {packages.map((pkg) => (
                      <option key={pkg.id} value={pkg.id}>
                        {pkg.name} ({formatRupiah(pkg.price)})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Nominal Tagihan & Status */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Nominal Tagihan (Rupiah) <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="1000"
                    value={formAmount}
                    onChange={(e) => setFormAmount(e.target.value)}
                    className={`w-full px-3 py-2 rounded-lg border font-bold text-sm ${
                      formErrors.amount ? 'border-rose-400 ring-2 ring-rose-200' : 'border-slate-200'
                    }`}
                  />
                  {formErrors.amount && (
                    <p className="text-rose-600 text-[11px] mt-1 font-medium">{formErrors.amount}</p>
                  )}
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Status Tagihan</label>
                  <select
                    value={formStatus}
                    onChange={(e) => setFormStatus(e.target.value as InvoiceStatus)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white font-medium"
                  >
                    <option value="unpaid">Belum Dibayar</option>
                    <option value="paid">Lunas</option>
                    <option value="overdue">Terlambat</option>
                  </select>
                </div>
              </div>

              {/* Periode & Jatuh Tempo */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Periode Tagihan <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formMonthPeriod}
                    onChange={(e) => setFormMonthPeriod(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Tanggal Jatuh Tempo <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="date"
                    value={formDueDate}
                    onChange={(e) => setFormDueDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200"
                  />
                </div>
              </div>

              {/* Actions */}
              <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setEditingInvoice(null)}
                  className="px-4 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-semibold shadow-xs flex items-center gap-1.5"
                >
                  <Check className="w-4 h-4" />
                  <span>Simpan Perubahan</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: DETAIL TAGIHAN (Requirement 2) */}
      {detailInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 relative">
            <div className="flex items-start justify-between pb-4 border-b border-slate-100">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-xs bg-slate-100 text-slate-800 px-2 py-0.5 rounded">
                    {detailInvoice.invoiceNumber}
                  </span>
                  <span
                    className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold border ${
                      getInvoiceStatusBadge(detailInvoice.status).bg
                    }`}
                  >
                    {getInvoiceStatusBadge(detailInvoice.status).label}
                  </span>
                </div>
                <h3 className="text-base font-bold text-slate-900 mt-1">{detailInvoice.customerName}</h3>
                <p className="text-xs text-slate-500">ID Pelanggan: {detailInvoice.customerId}</p>
              </div>
              <button
                onClick={() => setDetailInvoice(null)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="py-4 space-y-4 text-xs">
              {/* Highlight Amount Card */}
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between">
                <div>
                  <span className="text-slate-500 font-medium block text-[11px]">Total Tagihan</span>
                  <span className="text-xl font-black text-slate-900">
                    {formatRupiah(detailInvoice.amount)}
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-slate-500 font-medium block text-[11px]">Periode</span>
                  <span className="text-xs font-bold text-slate-800">{detailInvoice.monthPeriod}</span>
                </div>
              </div>

              {/* Rincian Info */}
              <div className="grid grid-cols-2 gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs">
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-semibold">
                    Paket Internet
                  </span>
                  <span className="font-bold text-slate-800">{detailInvoice.packageName}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-semibold">
                    Batas Jatuh Tempo
                  </span>
                  <span className="font-bold text-slate-800">{formatDateIndo(detailInvoice.dueDate)}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-semibold">
                    Tanggal Terbit
                  </span>
                  <span className="text-slate-700">{formatDateIndo(detailInvoice.createdAt)}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-semibold">
                    Status Pelunasan
                  </span>
                  <span className="font-semibold text-slate-800">
                    {detailInvoice.status === 'paid'
                      ? `Lunas (${detailInvoice.paidAt || 'Tercatat'})`
                      : detailInvoice.status === 'overdue'
                      ? 'Terlambat (Lewat Jatuh Tempo)'
                      : 'Belum Dibayar'}
                  </span>
                </div>
              </div>

              {/* Prorata Detail Card (Requirement D.2 & D.6) */}
              {(detailInvoice.isProrata || detailInvoice.prorataCalculationNote) && (
                <div className="p-3 bg-purple-50 rounded-xl border border-purple-200 text-purple-950 text-xs space-y-1.5 animate-in fade-in">
                  <div className="flex items-center justify-between font-bold text-purple-900">
                    <span className="flex items-center gap-1.5">
                      <Calculator className="w-3.5 h-3.5" />
                      <span>Rincian Tagihan Prorata:</span>
                    </span>
                    <span className="text-[10px] bg-purple-200 px-2 py-0.5 rounded font-mono font-bold text-purple-900">
                      PRORATA
                    </span>
                  </div>
                  {detailInvoice.servicePeriodStart && detailInvoice.servicePeriodEnd && (
                    <div className="text-[11px] text-purple-800">
                      Masa Layanan: <strong>{formatDateIndo(detailInvoice.servicePeriodStart)} s/d {formatDateIndo(detailInvoice.servicePeriodEnd)}</strong>
                      {detailInvoice.prorataDays && ` (${detailInvoice.prorataDays} hari aktif)`}
                    </div>
                  )}
                  {detailInvoice.prorataCalculationNote && (
                    <p className="text-[11px] font-mono text-purple-900 bg-white/80 p-2 rounded-lg border border-purple-200/60 leading-relaxed">
                      {detailInvoice.prorataCalculationNote}
                    </p>
                  )}
                </div>
              )}

              {/* Customer Contact */}
              {detailInvoice.customerPhone && (
                <div className="flex items-center justify-between p-2.5 rounded-lg border border-slate-200 bg-white">
                  <div>
                    <span className="text-slate-400 text-[10px] block">No. WhatsApp Pelanggan</span>
                    <span className="font-semibold text-slate-800">{detailInvoice.customerPhone}</span>
                  </div>
                  <button
                    onClick={() => {
                      onSendWhatsappReminder(detailInvoice);
                    }}
                    className="px-2.5 py-1 rounded bg-emerald-50 text-emerald-700 hover:bg-emerald-100 font-semibold text-xs flex items-center gap-1 border border-emerald-200 transition-colors"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Kirim Pengingat WA</span>
                  </button>
                </div>
              )}
            </div>

            <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
              {/* Quick Pay Action inside detail */}
              {detailInvoice.status !== 'paid' ? (
                <button
                  onClick={() => {
                    const inv = detailInvoice;
                    setDetailInvoice(null);
                    setSelectedInvoiceToPay(inv);
                    setPayNotes(`Pelunasan tagihan ${inv.invoiceNumber}`);
                  }}
                  className="px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold flex items-center gap-1.5 shadow-xs"
                >
                  <CreditCard className="w-3.5 h-3.5" />
                  <span>Catat Pembayaran</span>
                </button>
              ) : (
                <span className="text-xs font-bold text-emerald-600 flex items-center gap-1">
                  <CheckCircle2 className="w-4 h-4" />
                  Tagihan Ini Sudah Lunas
                </span>
              )}

              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    const inv = detailInvoice;
                    setDetailInvoice(null);
                    handleOpenEditModal(inv);
                  }}
                  className="px-3.5 py-1.5 rounded-lg bg-slate-800 text-white text-xs font-semibold hover:bg-slate-900 flex items-center gap-1.5 shadow-xs"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                  <span>Edit</span>
                </button>
                <button
                  onClick={() => setDetailInvoice(null)}
                  className="px-4 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold"
                >
                  Tutup
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 4: KONFIRMASI HAPUS TAGIHAN (Requirement 2) */}
      {invoiceToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 relative">
            <div className="w-12 h-12 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center mb-4">
              <Trash2 className="w-6 h-6" />
            </div>

            <h3 className="text-base font-bold text-slate-900">Konfirmasi Hapus Tagihan</h3>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">
              Apakah Anda yakin ingin menghapus tagihan berikut dari sistem?
            </p>

            <div className="mt-3 p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-1.5">
              <div className="flex justify-between">
                <span className="text-slate-500">Nomor Tagihan:</span>
                <span className="font-mono font-bold text-slate-800">{invoiceToDelete.invoiceNumber}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Pelanggan:</span>
                <span className="font-bold text-slate-900">{invoiceToDelete.customerName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Periode:</span>
                <span className="text-slate-700">{invoiceToDelete.monthPeriod}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Nominal:</span>
                <span className="font-bold text-emerald-600">{formatRupiah(invoiceToDelete.amount)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Status:</span>
                <span className="font-semibold text-slate-800 capitalize">
                  {getInvoiceStatusBadge(invoiceToDelete.status).label}
                </span>
              </div>
            </div>

            {invoiceToDelete.status === 'paid' && (
              <div className="mt-3 p-2.5 rounded-lg bg-amber-50 text-amber-800 text-[11px] leading-relaxed border border-amber-200">
                <strong>Catatan:</strong> Tagihan ini sudah berstatus lunas. Menghapus tagihan ini
                akan mempengaruhi catatan keuangan yang bersangkutan.
              </div>
            )}

            <div className="pt-4 mt-2 border-t border-slate-100 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setInvoiceToDelete(null)}
                className="px-4 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold shadow-xs flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Ya, Hapus Tagihan</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 5: CATAT PEMBAYARAN KASIR */}
      {selectedInvoiceToPay && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div>
                <h3 className="text-base font-bold text-slate-900">Catat Pembayaran Tagihan</h3>
                <p className="text-xs text-slate-500">
                  {selectedInvoiceToPay.invoiceNumber} • {selectedInvoiceToPay.customerName}
                </p>
              </div>
              <button
                onClick={() => setSelectedInvoiceToPay(null)}
                className="text-slate-400 hover:text-slate-600"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handlePayConfirm} className="py-4 space-y-4 text-xs">
              <div className="bg-blue-50/70 p-3.5 rounded-xl border border-blue-100 flex items-center justify-between">
                <div>
                  <span className="text-[11px] text-blue-700 font-semibold block">
                    {selectedInvoiceToPay.paidAmount && selectedInvoiceToPay.paidAmount > 0
                      ? 'Sisa Tagihan Yang Harus Dibayar'
                      : 'Total Yang Harus Dibayar'}
                  </span>
                  <span className="text-xl font-extrabold text-blue-950">
                    {formatRupiah(
                      selectedInvoiceToPay.remainingAmount !== undefined
                        ? selectedInvoiceToPay.remainingAmount
                        : selectedInvoiceToPay.amount
                    )}
                  </span>
                  {selectedInvoiceToPay.paidAmount !== undefined && selectedInvoiceToPay.paidAmount > 0 && (
                    <span className="text-[10px] text-slate-500 block mt-0.5">
                      (Telah dibayar sebelumnya: {formatRupiah(selectedInvoiceToPay.paidAmount)})
                    </span>
                  )}
                </div>
                <span className="text-xs font-medium px-2 py-1 rounded bg-white text-blue-800 border border-blue-200">
                  {selectedInvoiceToPay.packageName}
                </span>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Metode Pembayaran *
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setPayMethod('cash')}
                    className={`py-2 px-3 rounded-lg border text-xs font-medium transition-all ${
                      payMethod === 'cash'
                        ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    💵 Tunai (Kasir)
                  </button>
                  <button
                    type="button"
                    onClick={() => setPayMethod('transfer')}
                    className={`py-2 px-3 rounded-lg border text-xs font-medium transition-all ${
                      payMethod === 'transfer'
                        ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    🏦 Transfer
                  </button>
                  <button
                    type="button"
                    onClick={() => setPayMethod('qris')}
                    className={`py-2 px-3 rounded-lg border text-xs font-medium transition-all ${
                      payMethod === 'qris'
                        ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    📱 QRIS
                  </button>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Catatan Transaksi</label>
                <input
                  type="text"
                  value={payNotes}
                  onChange={(e) => setPayNotes(e.target.value)}
                  placeholder="Contoh: Diterima lunas di pos kasir RT/RW"
                  className="w-full px-3 py-2 rounded-lg border border-slate-200"
                />
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedInvoiceToPay(null)}
                  className="px-4 py-2 rounded-lg bg-slate-100 text-slate-700 font-semibold"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold shadow-xs"
                >
                  Konfirmasi Lunas
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 6: PRATINJAU & KIRIM NOTIFIKASI WHATSAPP GATEWAY WABLAS (Requirements 3, 4, 5, 6, 7, 8, 9, 12, 13, 14, 16, 17) */}
      {waPreviewInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl border border-slate-200 relative max-h-[92vh] flex flex-col">
            {/* Header Modal */}
            <div className="flex items-start justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center border border-emerald-100">
                  <MessageSquare className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-slate-900">
                      Pratinjau Notifikasi WhatsApp
                    </h3>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200">
                      Wablas Gateway
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Kirim pesan ke {waPreviewInvoice.customerName} ({waPreviewInvoice.customerPhone || 'Tanpa No. HP'})
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={isSendingWA}
                onClick={() => setWaPreviewInvoice(null)}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 disabled:opacity-50"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content Scrollable */}
            <div className="py-4 space-y-4 text-xs overflow-y-auto flex-1 pr-1">
              {/* 9 Live Data Points Card (Requirement 4) */}
              <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wide flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5 text-blue-600" />
                    Data Tagihan & Pelanggan
                  </span>
                  <span
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold ${
                      waPreviewInvoice.status === 'overdue'
                        ? 'bg-rose-100 text-rose-800'
                        : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    {waPreviewInvoice.status === 'overdue' ? 'Lewat Jatuh Tempo' : 'Belum Lunas'}
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-[11px]">
                  {/* 1. Nama Pelanggan */}
                  <div className="p-2 bg-white rounded-lg border border-slate-200/80">
                    <span className="text-slate-400 block text-[10px]">1. Nama Pelanggan</span>
                    <span className="font-bold text-slate-900 truncate block">
                      {waPreviewInvoice.customerName}
                    </span>
                  </div>

                  {/* 2. ID Pelanggan */}
                  <div className="p-2 bg-white rounded-lg border border-slate-200/80">
                    <span className="text-slate-400 block text-[10px]">2. ID Pelanggan</span>
                    <span className="font-mono font-semibold text-slate-800 truncate block">
                      {waPreviewInvoice.customerId}
                    </span>
                  </div>

                  {/* 3. Nomor WhatsApp */}
                  <div className="p-2 bg-white rounded-lg border border-slate-200/80">
                    <span className="text-slate-400 block text-[10px]">3. WhatsApp Tujuan</span>
                    <span className="font-mono font-bold text-emerald-700 truncate block">
                      {waPreviewInvoice.customerPhone || '-'}
                    </span>
                  </div>

                  {/* 4. Nomor Tagihan */}
                  <div className="p-2 bg-white rounded-lg border border-slate-200/80">
                    <span className="text-slate-400 block text-[10px]">4. Nomor Tagihan</span>
                    <span className="font-mono font-bold text-blue-800 truncate block">
                      {waPreviewInvoice.invoiceNumber}
                    </span>
                  </div>

                  {/* 5. Nama Paket */}
                  <div className="p-2 bg-white rounded-lg border border-slate-200/80">
                    <span className="text-slate-400 block text-[10px]">5. Paket Internet</span>
                    <span className="font-semibold text-slate-800 truncate block">
                      {waPreviewInvoice.packageName}
                    </span>
                  </div>

                  {/* 6. Periode Tagihan */}
                  <div className="p-2 bg-white rounded-lg border border-slate-200/80">
                    <span className="text-slate-400 block text-[10px]">6. Periode</span>
                    <span className="font-semibold text-slate-800 truncate block">
                      {waPreviewInvoice.monthPeriod}
                    </span>
                  </div>

                  {/* 7. Nominal Tagihan */}
                  <div className="p-2 bg-white rounded-lg border border-slate-200/80">
                    <span className="text-slate-400 block text-[10px]">7. Nominal Tagihan</span>
                    <span className="font-bold text-slate-900 block">
                      {formatRupiah(waPreviewInvoice.amount)}
                    </span>
                  </div>

                  {/* 8. Jumlah Pembayaran */}
                  <div className="p-2 bg-white rounded-lg border border-slate-200/80">
                    <span className="text-slate-400 block text-[10px]">8. Sudah Dibayar</span>
                    <span className="font-bold text-emerald-600 block">
                      {formatRupiah(waPreviewInvoice.paidAmount || 0)}
                    </span>
                  </div>

                  {/* 9. Sisa Tagihan */}
                  <div className="p-2 bg-white rounded-lg border border-slate-200/80">
                    <span className="text-slate-400 block text-[10px]">9. Sisa Tagihan</span>
                    <span className="font-black text-rose-600 block">
                      {formatRupiah(
                        waPreviewInvoice.remainingAmount !== undefined
                          ? waPreviewInvoice.remainingAmount
                          : waPreviewInvoice.amount - (waPreviewInvoice.paidAmount || 0)
                      )}
                    </span>
                  </div>
                </div>

                <div className="mt-2.5 pt-2 border-t border-slate-200/60 flex items-center justify-between text-[11px] text-slate-600">
                  <div className="flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-slate-400" />
                    <span>Jatuh Tempo:</span>
                    <strong className="text-slate-800">{formatDateIndo(waPreviewInvoice.dueDate)}</strong>
                  </div>
                  <span className="text-[10px] text-slate-400">
                    Cluster: smg.wablas.com
                  </span>
                </div>
              </div>

              {/* Pemilihan Template Notifikasi (Requirement 5) */}
              <div>
                <label className="block font-semibold text-slate-800 mb-1.5 text-xs">
                  Pilih Template Notifikasi:
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {availableInvoiceTemplates.map((tpl) => (
                    <button
                      key={tpl.id}
                      type="button"
                      onClick={() => handleSelectTemplateKey(tpl.id)}
                      className={`p-2.5 rounded-xl border text-left transition-all ${
                        selectedWaTemplateKey === tpl.id
                          ? 'border-emerald-500 bg-emerald-50/70 text-emerald-900 shadow-xs ring-1 ring-emerald-500'
                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <div className="font-bold text-[11px]">{tpl.name}</div>
                      <div className="text-[10px] text-slate-400 mt-0.5 truncate">
                        ID: {tpl.id}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Editor & Pratinjau Pesan yang akan dikirim (Requirement 3 & 5) */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="font-semibold text-slate-800 text-xs flex items-center gap-1">
                    <span>Pratinjau & Edit Teks Pesan</span>
                    <span className="text-[10px] text-slate-400 font-normal">
                      (Dapat disesuaikan sebelum dikirim)
                    </span>
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(waCustomMessage);
                      setCopyFeedback(true);
                      setTimeout(() => setCopyFeedback(false), 2000);
                    }}
                    className="text-[11px] font-semibold text-slate-600 hover:text-emerald-700 flex items-center gap-1 px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200 transition-colors"
                  >
                    {copyFeedback ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-600" />
                        <span className="text-emerald-700">Tersalin!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        <span>Salin Teks</span>
                      </>
                    )}
                  </button>
                </div>

                <div className="relative">
                  <textarea
                    rows={7}
                    value={waCustomMessage}
                    onChange={(e) => setWaCustomMessage(e.target.value)}
                    className="w-full p-3 font-mono text-xs text-slate-800 bg-slate-50/70 border border-slate-300 rounded-xl focus:bg-white focus:ring-2 focus:ring-emerald-500 focus:outline-none transition-all leading-relaxed"
                    placeholder="Tulis pesan pengingat tagihan..."
                  />
                  <div className="absolute bottom-2.5 right-3 text-[10px] text-slate-400 bg-white/80 px-1.5 py-0.5 rounded">
                    {waCustomMessage.length} karakter
                  </div>
                </div>
              </div>

              {/* Keamanan & Informasi Gateway (Requirements 7, 8, 12, 13, 14, 17) */}
              <div className="p-3 bg-emerald-50/70 rounded-xl border border-emerald-100 text-[11px] text-emerald-900 space-y-1">
                <div className="flex items-center gap-1.5 font-bold text-emerald-800">
                  <Info className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>Koneksi Aman Gateway Wablas:</span>
                </div>
                <ul className="list-disc list-inside text-[10px] text-emerald-800/90 space-y-0.5 ml-1">
                  <li>Pesan dikirim melalui backend proxy resmi Wablas tanpa memaparkan token API ke frontend.</li>
                  <li>Status tagihan <strong>tidak akan otomatis lunas</strong> saat pesan terkirim.</li>
                  <li>Pengiriman dilakukan secara manual dengan persetujuan admin (tanpa pengiriman liar).</li>
                  <li>Jika pengiriman gagal, data tagihan tetap aman dan tidak terhapus.</li>
                </ul>
              </div>
            </div>

            {/* Footer Aksi Modal (Requirements 6 & 16) */}
            <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-3">
              <button
                type="button"
                disabled={isSendingWA}
                onClick={() => setWaPreviewInvoice(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition-colors disabled:opacity-50"
              >
                Batal
              </button>

              <button
                type="button"
                disabled={isSendingWA}
                onClick={handleSendWhatsappMessage}
                className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-md shadow-emerald-600/20 flex items-center gap-2 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isSendingWA ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Mengirim via Wablas...</span>
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" />
                    <span>Kirim WhatsApp Sekarang</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 7: DETAIL RIWAYAT LOG NOTIFIKASI WHATSAPP (Requirement 10 & 11) */}
      {selectedWaLogDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 relative">
            <div className="flex items-start justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div
                  className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                    selectedWaLogDetail.status === 'sent'
                      ? 'bg-emerald-50 text-emerald-600'
                      : 'bg-rose-50 text-rose-600'
                  }`}
                >
                  {selectedWaLogDetail.status === 'sent' ? (
                    <CheckCircle2 className="w-5 h-5" />
                  ) : (
                    <XCircle className="w-5 h-5" />
                  )}
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Detail Log WhatsApp</h3>
                  <p className="text-xs text-slate-500">ID Log: {selectedWaLogDetail.id}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedWaLogDetail(null)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="py-4 space-y-3 text-xs">
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80 space-y-2">
                <div className="flex justify-between">
                  <span className="text-slate-500">Waktu Pengiriman:</span>
                  <span className="font-semibold text-slate-800">{selectedWaLogDetail.timestamp}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Status Gateway:</span>
                  <span
                    className={`font-bold px-2 py-0.5 rounded text-[11px] ${
                      selectedWaLogDetail.status === 'sent'
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-rose-100 text-rose-800'
                    }`}
                  >
                    {selectedWaLogDetail.status === 'sent' ? 'Terkirim (Berhasil)' : 'Gagal Dikirim'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Pelanggan:</span>
                  <span className="font-bold text-slate-900">
                    {selectedWaLogDetail.customerName} ({selectedWaLogDetail.customerId})
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">No. WhatsApp Tujuan:</span>
                  <span className="font-mono font-bold text-emerald-700">
                    {selectedWaLogDetail.phone}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Nomor Tagihan Ref:</span>
                  <span className="font-mono font-bold text-blue-700">
                    {selectedWaLogDetail.referenceId || '-'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Jenis Pesan:</span>
                  <span className="text-slate-700 font-medium">
                    {selectedWaLogDetail.notificationTypeName} ({selectedWaLogDetail.notificationType})
                  </span>
                </div>
              </div>

              {/* Error message jika gagal */}
              {selectedWaLogDetail.status === 'failed' && selectedWaLogDetail.errorMessage && (
                <div className="p-3 bg-rose-50 rounded-xl border border-rose-200 text-rose-900">
                  <span className="text-[10px] font-bold uppercase tracking-wider block text-rose-700 mb-1">
                    Pesan Kesalahan dari Server Wablas:
                  </span>
                  <p className="font-mono text-xs leading-relaxed">
                    {selectedWaLogDetail.errorMessage}
                  </p>
                </div>
              )}

              {/* Isi Teks Pesan */}
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider block text-slate-400 mb-1">
                  Konten Pesan Terkirim:
                </span>
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 font-sans whitespace-pre-line text-slate-800 max-h-48 overflow-y-auto leading-relaxed">
                  {selectedWaLogDetail.messageContent}
                </div>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(selectedWaLogDetail.messageContent);
                  showToast('Teks pesan riwayat berhasil disalin!', 'success');
                }}
                className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold flex items-center gap-1.5"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>Salin Teks</span>
              </button>

              <button
                type="button"
                onClick={() => setSelectedWaLogDetail(null)}
                className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-900 text-white text-xs font-semibold"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL EXPORT TAGIHAN */}
      {isExportModalOpen && (
        <InvoiceExportModal
          invoices={invoices}
          customers={customers}
          onClose={() => setIsExportModalOpen(false)}
        />
      )}
    </div>
  );
};
