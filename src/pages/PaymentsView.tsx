import React, { useState, useMemo } from 'react';
import {
  CreditCard,
  Search,
  Filter,
  Printer,
  CheckCircle,
  Receipt,
  Building,
  User,
  Calendar,
  Plus,
  Eye,
  X,
  AlertTriangle,
  RotateCcw,
  CheckCircle2,
  Database,
  Hash,
  DollarSign,
  Send,
  FileText,
  Clock,
  ArrowRight,
  Loader2,
} from 'lucide-react';
import {
  Payment,
  PaymentMethod,
  Invoice,
  Customer,
  BusinessSettings,
} from '../types/index.ts';
import {
  formatRupiah,
  formatDateIndo,
  getPaymentMethodBadge,
  getInvoiceStatusBadge,
} from '../utils/formatters.ts';
import {
  generateUniqueTransactionNumber,
  getPaymentsTotalToday,
  getPaymentsTotalThisMonth,
} from '../utils/paymentStorage.ts';

interface PaymentsViewProps {
  payments: Payment[];
  invoices: Invoice[];
  customers: Customer[];
  settings: BusinessSettings;
  onRecordPayment: (params: {
    invoiceId: string;
    amount: number;
    method: PaymentMethod;
    notes?: string;
    receiverName?: string;
  }) => Promise<{ success: boolean; message?: string; payment?: Payment }> | { success: boolean; message?: string; payment?: Payment };
}

export const PaymentsView: React.FC<PaymentsViewProps> = ({
  payments,
  invoices,
  customers,
  settings,
  onRecordPayment,
}) => {
  // Filters & Search
  const [searchQuery, setSearchQuery] = useState('');
  const [customerFilter, setCustomerFilter] = useState('all');
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | 'this_month' | 'custom'>('all');
  const [customDate, setCustomDate] = useState('');
  const [methodFilter, setMethodFilter] = useState<'all' | PaymentMethod>('all');

  // Modals
  const [isRecordModalOpen, setIsRecordModalOpen] = useState(false);
  const [detailPayment, setDetailPayment] = useState<Payment | null>(null);
  const [receiptToPrint, setReceiptToPrint] = useState<Payment | null>(null);

  // Toast notification
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 4000);
  };

  // Form State: Catat Pembayaran
  const [selectedInvoiceId, setSelectedInvoiceId] = useState('');
  const [payAmount, setPayAmount] = useState<number | string>('');
  const [payMethod, setPayMethod] = useState<PaymentMethod>('cash');
  const [payNotes, setPayNotes] = useState('');
  const [payReceiver, setPayReceiver] = useState(settings.ownerName || 'Admin Kasir Adi');
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Unpaid or partially paid invoices (eligible for payment)
  const payableInvoices = useMemo(() => {
    return invoices.filter((inv) => {
      const remaining =
        inv.remainingAmount !== undefined
          ? inv.remainingAmount
          : inv.status === 'paid'
          ? 0
          : inv.amount - (inv.paidAmount || 0);
      return inv.status !== 'paid' && remaining > 0;
    });
  }, [invoices]);

  // Selected invoice object in form
  const selectedInvoice = useMemo(() => {
    return invoices.find((inv) => inv.id === selectedInvoiceId) || null;
  }, [invoices, selectedInvoiceId]);

  // Current remaining amount on selected invoice
  const currentRemaining = useMemo(() => {
    if (!selectedInvoice) return 0;
    const paid =
      selectedInvoice.paidAmount !== undefined
        ? selectedInvoice.paidAmount
        : selectedInvoice.status === 'paid'
        ? selectedInvoice.amount
        : 0;
    return selectedInvoice.remainingAmount !== undefined
      ? selectedInvoice.remainingAmount
      : Math.max(0, selectedInvoice.amount - paid);
  }, [selectedInvoice]);

  // Handle opening the "Catat Pembayaran" modal
  const handleOpenRecordModal = () => {
    const firstInvoice = payableInvoices[0] || null;
    const firstInvoiceId = firstInvoice ? firstInvoice.id : '';
    setSelectedInvoiceId(firstInvoiceId);

    if (firstInvoice) {
      const remaining =
        firstInvoice.remainingAmount !== undefined
          ? firstInvoice.remainingAmount
          : Math.max(0, firstInvoice.amount - (firstInvoice.paidAmount || 0));
      setPayAmount(remaining);
      setPayNotes(`Pelunasan tagihan ${firstInvoice.invoiceNumber}`);
    } else {
      setPayAmount('');
      setPayNotes('');
    }

    setPayMethod('cash');
    setPayReceiver(settings.ownerName || 'Admin Kasir Adi');
    setFormError(null);
    setIsRecordModalOpen(true);
  };

  // When admin picks an invoice in dropdown
  const handleInvoiceChange = (invId: string) => {
    setSelectedInvoiceId(invId);
    setFormError(null);
    const target = invoices.find((i) => i.id === invId);
    if (target) {
      const remaining =
        target.remainingAmount !== undefined
          ? target.remainingAmount
          : target.status === 'paid'
          ? 0
          : Math.max(0, target.amount - (target.paidAmount || 0));
      setPayAmount(remaining);
      setPayNotes(`Pembayaran tagihan ${target.invoiceNumber}`);
    } else {
      setPayAmount('');
      setPayNotes('');
    }
  };

  // Handle submitting the payment form (Menunggu konfirmasi COMMIT PostgreSQL)
  const handleSubmitPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return; // Cegah double submit
    setFormError(null);

    if (!selectedInvoice) {
      setFormError('Pilih tagihan yang belum lunas terlebih dahulu.');
      return;
    }

    const numericAmount = Number(payAmount);
    if (!payAmount || isNaN(numericAmount) || numericAmount <= 0) {
      setFormError('Nominal pembayaran wajib diisi angka lebih besar dari 0.');
      return;
    }

    if (numericAmount > currentRemaining) {
      setFormError(
        `Nominal pembayaran tidak boleh melebihi sisa tagihan (${formatRupiah(currentRemaining)}).`
      );
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await onRecordPayment({
        invoiceId: selectedInvoice.id,
        amount: numericAmount,
        method: payMethod,
        notes: payNotes,
        receiverName: payReceiver,
      });

      if (!result.success) {
        setFormError(result.message || 'Gagal memproses transaksi pembayaran di database.');
        return;
      }

      setIsRecordModalOpen(false);
      if (result.message) {
        showToast(result.message);
      }
      // Offer receipt preview right away
      if (result.payment) {
        setReceiptToPrint(result.payment);
      }
    } catch (err: any) {
      setFormError(err?.message || 'Terjadi kesalahan sistem saat menghubungi database.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Metrics (Requirement 12)
  const totalToday = useMemo(() => getPaymentsTotalToday(payments), [payments]);
  const totalThisMonth = useMemo(() => getPaymentsTotalThisMonth(payments), [payments]);
  const totalAllPayments = useMemo(
    () => payments.reduce((sum, p) => sum + p.amount, 0),
    [payments]
  );

  // Count metrics
  const todayStr = new Date().toISOString().split('T')[0];
  const countToday = payments.filter((p) => p.paidAt && p.paidAt.startsWith(todayStr)).length;
  const currentMonthStr = `${new Date().getFullYear()}-${String(
    new Date().getMonth() + 1
  ).padStart(2, '0')}`;
  const countThisMonth = payments.filter(
    (p) => p.paidAt && p.paidAt.startsWith(currentMonthStr)
  ).length;

  // Filtered payments list (Requirement 11)
  const filteredPayments = useMemo(() => {
    return payments.filter((p) => {
      // 1. Search Query (Nomor transaksi, nomor tagihan, nama pelanggan, ID pelanggan, catatan)
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !q ||
        (p.transactionNumber && p.transactionNumber.toLowerCase().includes(q)) ||
        (p.receiptNumber && p.receiptNumber.toLowerCase().includes(q)) ||
        p.invoiceNumber.toLowerCase().includes(q) ||
        p.customerName.toLowerCase().includes(q) ||
        (p.customerId && p.customerId.toLowerCase().includes(q)) ||
        (p.notes && p.notes.toLowerCase().includes(q));

      // 2. Customer Filter
      const matchesCustomer =
        customerFilter === 'all' ||
        p.customerId === customerFilter ||
        p.customerName === customerFilter;

      // 3. Date Filter
      let matchesDate = true;
      if (dateFilter === 'today') {
        matchesDate = Boolean(p.paidAt && p.paidAt.startsWith(todayStr));
      } else if (dateFilter === 'this_month') {
        matchesDate = Boolean(p.paidAt && p.paidAt.startsWith(currentMonthStr));
      } else if (dateFilter === 'custom' && customDate) {
        matchesDate = Boolean(p.paidAt && p.paidAt.startsWith(customDate));
      }

      // 4. Method Filter
      const matchesMethod = methodFilter === 'all' || p.method === methodFilter;

      return matchesSearch && matchesCustomer && matchesDate && matchesMethod;
    });
  }, [
    payments,
    searchQuery,
    customerFilter,
    dateFilter,
    customDate,
    methodFilter,
    todayStr,
    currentMonthStr,
  ]);

  const hasActiveFilters =
    searchQuery.trim() !== '' ||
    customerFilter !== 'all' ||
    dateFilter !== 'all' ||
    customDate !== '' ||
    methodFilter !== 'all';

  const handleResetFilters = () => {
    setSearchQuery('');
    setCustomerFilter('all');
    setDateFilter('all');
    setCustomDate('');
    setMethodFilter('all');
  };

  // Preview transaction number for new payment
  const previewNextTrxNum = useMemo(() => {
    return generateUniqueTransactionNumber(payments);
  }, [payments]);

  // Find invoice associated with a payment for receipt modal
  const getInvoiceForPayment = (payment: Payment | null): Invoice | undefined => {
    if (!payment) return undefined;
    return invoices.find((i) => i.id === payment.invoiceId || i.invoiceNumber === payment.invoiceNumber);
  };

  return (
    <div className="space-y-5">
      {/* Toast Alert */}
      {toastMessage && (
        <div className="fixed top-5 right-5 z-50 bg-slate-900 text-white text-xs sm:text-sm font-semibold px-4 py-3 rounded-xl shadow-xl flex items-center gap-2.5 border border-slate-700 animate-in slide-in-from-top-4 duration-200">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{toastMessage}</span>
          <button
            onClick={() => setToastMessage(null)}
            className="ml-2 text-slate-400 hover:text-white"
          >
            ✕
          </button>
        </div>
      )}

      {/* Persistence Notice (Requirement 13) */}
      <div className="bg-blue-50/80 border border-blue-200/90 rounded-xl p-3.5 sm:p-4 text-xs text-blue-900 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-xs">
        <div className="flex items-start gap-2.5">
          <div className="p-1 rounded bg-blue-200/70 text-blue-800 shrink-0 mt-0.5">
            <Database className="w-3.5 h-3.5" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <strong className="font-bold text-blue-950">
                Data Pembayaran (Database PostgreSQL)
              </strong>
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-200">
                adi_hotspot
              </span>
            </div>
            <p className="text-blue-800/90 text-[11px] mt-0.5">
              Riwayat transaksi kasir dan status pelunasan tersinkronisasi otomatis dengan database
              PostgreSQL dan data tagihan secara konsisten.
            </p>
          </div>
        </div>
        <div className="text-[11px] font-semibold text-blue-700 bg-white px-2.5 py-1 rounded-lg border border-blue-200 shrink-0">
          Total Transaksi: {payments.length} Struk
        </div>
      </div>

      {/* 3 Summary Cards (Requirement 12) */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* 1. Pembayaran Hari Ini */}
        <div className="bg-white rounded-xl p-4 sm:p-5 border border-slate-200/90 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Total Pembayaran Hari Ini
            </span>
            <div className="w-9 h-9 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 text-xl sm:text-2xl font-bold text-emerald-600 tracking-tight truncate">
            {formatRupiah(totalToday)}
          </div>
          <div className="mt-1 text-xs text-slate-500 flex items-center gap-1.5">
            <span className="font-semibold text-emerald-700">{countToday} Transaksi</span>
            <span>hari ini ({formatDateIndo(todayStr)})</span>
          </div>
        </div>

        {/* 2. Pembayaran Bulan Ini */}
        <div className="bg-white rounded-xl p-4 sm:p-5 border border-slate-200/90 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-blue-600">
              Total Pembayaran Bulan Ini
            </span>
            <div className="w-9 h-9 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
              <Calendar className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 text-xl sm:text-2xl font-bold text-blue-600 tracking-tight truncate">
            {formatRupiah(totalThisMonth)}
          </div>
          <div className="mt-1 text-xs text-slate-500 flex items-center gap-1.5">
            <span className="font-semibold text-blue-700">{countThisMonth} Transaksi</span>
            <span>di bulan berjalan</span>
          </div>
        </div>

        {/* 3. Total Keseluruhan Pembayaran */}
        <div className="bg-white rounded-xl p-4 sm:p-5 border border-slate-200/90 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Total Keseluruhan Penerimaan
            </span>
            <div className="w-9 h-9 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
              <DollarSign className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 text-xl sm:text-2xl font-bold text-slate-900 tracking-tight truncate">
            {formatRupiah(totalAllPayments)}
          </div>
          <div className="mt-1 text-xs text-slate-500 flex items-center gap-1.5">
            <span className="font-semibold text-slate-700">{payments.length} Riwayat</span>
            <span>seluruh transaksi</span>
          </div>
        </div>
      </div>

      {/* Search & Filter Toolbar + Action Button (Requirement 11 & 2) */}
      <div className="bg-white rounded-xl p-4 border border-slate-200/90 shadow-xs space-y-3">
        <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
          {/* Search Input */}
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari no. transaksi (TRX-...), no. tagihan, nama pelanggan, ID, atau catatan..."
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

          {/* Catat Pembayaran Button (Requirement 2) */}
          <button
            onClick={handleOpenRecordModal}
            className="px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-sm font-semibold flex items-center justify-center gap-2 transition-colors shadow-xs shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>Catat Pembayaran</span>
          </button>
        </div>

        {/* Filter Row: Pelanggan, Tanggal, Metode Pembayaran (Requirement 11) */}
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

            {/* Filter Tanggal */}
            <select
              value={dateFilter}
              onChange={(e) => {
                const val = e.target.value as any;
                setDateFilter(val);
                if (val !== 'custom') setCustomDate('');
              }}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-slate-700 font-medium focus:ring-1 focus:ring-blue-500"
            >
              <option value="all">Semua Tanggal</option>
              <option value="today">Hari Ini</option>
              <option value="this_month">Bulan Ini</option>
              <option value="custom">Pilih Tanggal Spesifik...</option>
            </select>

            {dateFilter === 'custom' && (
              <input
                type="date"
                value={customDate}
                onChange={(e) => setCustomDate(e.target.value)}
                className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 font-medium text-xs focus:ring-1 focus:ring-blue-500"
              />
            )}

            {/* Filter Metode Pembayaran */}
            <select
              value={methodFilter}
              onChange={(e) => setMethodFilter(e.target.value as any)}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-slate-700 font-medium focus:ring-1 focus:ring-blue-500"
            >
              <option value="all">Semua Metode</option>
              <option value="cash">Tunai</option>
              <option value="transfer">Transfer Bank</option>
              <option value="qris">QRIS</option>
            </select>

            {/* Reset Button */}
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
            Menampilkan <strong className="text-slate-800">{filteredPayments.length}</strong> dari{' '}
            {payments.length} transaksi
          </div>
        </div>
      </div>

      {/* Payments Table (Requirement 1) */}
      <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs sm:text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold text-[11px] uppercase tracking-wider">
              <tr>
                {/* 1. Nomor transaksi */}
                <th className="px-3.5 py-3.5 whitespace-nowrap">Nomor Transaksi</th>
                {/* 2. Nomor tagihan */}
                <th className="px-3.5 py-3.5 whitespace-nowrap">Nomor Tagihan</th>
                {/* 3. ID pelanggan */}
                <th className="px-3.5 py-3.5 whitespace-nowrap">ID Pelanggan</th>
                {/* 4. Nama pelanggan */}
                <th className="px-3.5 py-3.5 whitespace-nowrap">Nama Pelanggan</th>
                {/* 5. Tanggal pembayaran */}
                <th className="px-3.5 py-3.5 whitespace-nowrap">Tanggal Pembayaran</th>
                {/* 6. Nominal pembayaran */}
                <th className="px-3.5 py-3.5 whitespace-nowrap">Nominal Pembayaran</th>
                {/* 7. Metode pembayaran */}
                <th className="px-3.5 py-3.5 whitespace-nowrap">Metode Pembayaran</th>
                {/* 8. Keterangan */}
                <th className="px-3.5 py-3.5">Keterangan</th>
                {/* Aksi */}
                <th className="px-3.5 py-3.5 text-right whitespace-nowrap">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredPayments.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center py-12 px-4 text-slate-500">
                    <div className="max-w-xs mx-auto">
                      <CreditCard className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                      <p className="font-semibold text-slate-700 text-sm">
                        Tidak ada transaksi pembayaran yang ditemukan
                      </p>
                      <p className="text-xs text-slate-400 mt-1">
                        Gunakan tombol "Catat Pembayaran" untuk menerima pembayaran tagihan pelanggan.
                      </p>
                      {hasActiveFilters && (
                        <button
                          onClick={handleResetFilters}
                          className="mt-3 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold"
                        >
                          Reset Filter
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                filteredPayments.map((p) => {
                  const badge = getPaymentMethodBadge(p.method);
                  const trxDisplay = p.transactionNumber || p.receiptNumber || 'TRX-DEFAULT';

                  return (
                    <tr key={p.id} className="hover:bg-slate-50/80 transition-colors">
                      {/* 1. Nomor Transaksi */}
                      <td className="px-3.5 py-3.5 whitespace-nowrap font-mono font-bold text-xs text-slate-900">
                        <span className="bg-slate-100 text-slate-800 px-2 py-1 rounded-md border border-slate-200">
                          {trxDisplay}
                        </span>
                      </td>

                      {/* 2. Nomor Tagihan */}
                      <td className="px-3.5 py-3.5 whitespace-nowrap font-mono text-xs font-semibold text-blue-700">
                        {p.invoiceNumber}
                      </td>

                      {/* 3. ID Pelanggan */}
                      <td className="px-3.5 py-3.5 whitespace-nowrap font-mono text-xs text-slate-700 font-semibold">
                        {p.customerId || '-'}
                      </td>

                      {/* 4. Nama Pelanggan */}
                      <td className="px-3.5 py-3.5 whitespace-nowrap font-bold text-slate-900">
                        {p.customerName}
                      </td>

                      {/* 5. Tanggal Pembayaran */}
                      <td className="px-3.5 py-3.5 whitespace-nowrap text-xs text-slate-600">
                        <div className="flex items-center gap-1 font-medium">
                          <Calendar className="w-3.5 h-3.5 text-slate-400" />
                          <span>{p.paidAt}</span>
                        </div>
                      </td>

                      {/* 6. Nominal Pembayaran */}
                      <td className="px-3.5 py-3.5 whitespace-nowrap font-extrabold text-emerald-600 text-xs sm:text-sm">
                        {formatRupiah(p.amount)}
                      </td>

                      {/* 7. Metode Pembayaran */}
                      <td className="px-3.5 py-3.5 whitespace-nowrap">
                        <span
                          className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold border ${badge.bg}`}
                        >
                          {badge.label}
                        </span>
                      </td>

                      {/* 8. Keterangan */}
                      <td className="px-3.5 py-3.5 max-w-xs text-xs text-slate-600">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {p.isPartial && (
                            <span className="px-1.5 py-0.2 rounded bg-amber-100 text-amber-800 text-[10px] font-bold border border-amber-200">
                              Sebagian
                            </span>
                          )}
                          <span className="truncate" title={p.notes || '-'}>
                            {p.notes || '-'}
                          </span>
                        </div>
                      </td>

                      {/* Aksi: Detail & Cetak Bukti Pembayaran (Requirement 2) */}
                      <td className="px-3.5 py-3.5 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* Tombol Detail */}
                          <button
                            onClick={() => setDetailPayment(p)}
                            className="p-1.5 rounded-lg text-slate-600 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                            title="Detail Transaksi"
                            aria-label="Detail Transaksi"
                          >
                            <Eye className="w-4 h-4" />
                          </button>

                          {/* Tombol Cetak Bukti Pembayaran */}
                          <button
                            onClick={() => setReceiptToPrint(p)}
                            className="px-2.5 py-1 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold flex items-center gap-1 transition-colors border border-slate-200"
                            title="Cetak Bukti Pembayaran"
                          >
                            <Printer className="w-3.5 h-3.5 text-slate-600" />
                            <span>Cetak</span>
                          </button>
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

      {/* MODAL 1: CATAT PEMBAYARAN (Requirements 2, 3, 4, 5, 6, 7, 8, 9, 10) */}
      {isRecordModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 relative my-8 animate-in fade-in duration-150">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div>
                <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <CreditCard className="w-5 h-5 text-emerald-600" />
                  Catat Transaksi Pembayaran
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Pilih tagihan belum lunas, otomatis terisi data pelanggan dan sisa tagihan.
                </p>
              </div>
              <button
                onClick={() => setIsRecordModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {payableInvoices.length === 0 ? (
              <div className="py-8 text-center space-y-3">
                <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto" />
                <h4 className="font-bold text-slate-800 text-sm">Semua Tagihan Sudah Lunas!</h4>
                <p className="text-xs text-slate-500 max-w-xs mx-auto">
                  Saat ini tidak ada tagihan pelanggan yang berstatus belum dibayar atau tertunda.
                </p>
                <button
                  onClick={() => setIsRecordModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold"
                >
                  Tutup
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmitPayment} className="py-4 space-y-4 text-xs">
                {/* Error Banner */}
                {formError && (
                  <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-900 flex items-start gap-2.5 animate-in fade-in">
                    <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                    <div>
                      <strong className="font-bold text-rose-950 block">Peringatan:</strong>
                      <p className="text-[11px] text-rose-800 mt-0.5 leading-snug">{formError}</p>
                    </div>
                  </div>
                )}

                {/* Auto Transaction Number Preview (Requirement 6) */}
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 flex items-center justify-between">
                  <div>
                    <span className="text-[10px] font-semibold text-slate-500 uppercase block">
                      Nomor Transaksi (Otomatis & Unik)
                    </span>
                    <span className="font-mono font-bold text-sm text-emerald-700">
                      {previewNextTrxNum}
                    </span>
                  </div>
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-200">
                    Auto-Generated
                  </span>
                </div>

                {/* 1. Pilih Tagihan Belum Lunas (Requirement 3) */}
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Pilih Tagihan Yang Belum Lunas <span className="text-rose-500">*</span>
                  </label>
                  <select
                    value={selectedInvoiceId}
                    onChange={(e) => handleInvoiceChange(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white font-medium text-xs focus:ring-1 focus:ring-blue-500"
                  >
                    {payableInvoices.map((inv) => {
                      const rem =
                        inv.remainingAmount !== undefined
                          ? inv.remainingAmount
                          : Math.max(0, inv.amount - (inv.paidAmount || 0));
                      return (
                        <option key={inv.id} value={inv.id}>
                          {inv.invoiceNumber} • {inv.customerName} ({inv.customerId}) • Sisa:{' '}
                          {formatRupiah(rem)}
                        </option>
                      );
                    })}
                  </select>
                </div>

                {/* 2. Informasi Otomatis Tagihan & Pelanggan (Requirement 4) */}
                {selectedInvoice && (
                  <div className="bg-blue-50/70 p-3.5 rounded-xl border border-blue-200/90 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-blue-950 text-xs">
                        {selectedInvoice.customerName}
                      </span>
                      <span className="font-mono text-[11px] font-semibold text-blue-800 bg-blue-100/80 px-2 py-0.5 rounded">
                        {selectedInvoice.customerId}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-[11px] pt-1 border-t border-blue-200/60">
                      <div>
                        <span className="text-blue-700 block">Paket & Periode:</span>
                        <span className="font-semibold text-blue-950">
                          {selectedInvoice.packageName} ({selectedInvoice.monthPeriod})
                        </span>
                      </div>
                      <div>
                        <span className="text-blue-700 block">Jatuh Tempo:</span>
                        <span className="font-semibold text-blue-950">
                          {formatDateIndo(selectedInvoice.dueDate)}
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2 pt-2 border-t border-blue-200/60 text-center">
                      <div className="bg-white/80 p-2 rounded-lg border border-blue-100">
                        <span className="text-[10px] text-slate-500 block">Total Tagihan</span>
                        <span className="font-bold text-slate-800 text-xs">
                          {formatRupiah(selectedInvoice.amount)}
                        </span>
                      </div>
                      <div className="bg-white/80 p-2 rounded-lg border border-blue-100">
                        <span className="text-[10px] text-slate-500 block">Sudah Dibayar</span>
                        <span className="font-bold text-emerald-600 text-xs">
                          {formatRupiah(selectedInvoice.paidAmount || 0)}
                        </span>
                      </div>
                      <div className="bg-white p-2 rounded-lg border border-blue-200 shadow-xs">
                        <span className="text-[10px] text-blue-700 font-semibold block">Sisa Tagihan</span>
                        <span className="font-extrabold text-blue-900 text-xs">
                          {formatRupiah(currentRemaining)}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* 3. Input Nominal Pembayaran (Requirements 9 & 10) */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="font-semibold text-slate-700">
                      Nominal Pembayaran (Rp) <span className="text-rose-500">*</span>
                    </label>
                    {selectedInvoice && (
                      <button
                        type="button"
                        onClick={() => setPayAmount(currentRemaining)}
                        className="text-[10px] font-semibold text-blue-600 hover:text-blue-800 underline"
                      >
                        Bayar Penuh ({formatRupiah(currentRemaining)})
                      </button>
                    )}
                  </div>
                  <input
                    type="number"
                    min="1"
                    max={currentRemaining}
                    step="1000"
                    value={payAmount}
                    onChange={(e) => {
                      setPayAmount(e.target.value);
                      setFormError(null);
                    }}
                    placeholder={`Contoh: ${currentRemaining || 100000}`}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 font-extrabold text-sm focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                  />

                  {/* Realtime Status Indicator (Penuh vs Sebagian) */}
                  {selectedInvoice && Number(payAmount) > 0 && (
                    <div className="mt-2 text-[11px]">
                      {Number(payAmount) === currentRemaining ? (
                        <div className="p-2 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 flex items-center gap-1.5 font-medium">
                          <CheckCircle className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                          <span>
                            <strong>Pelunasan Penuh:</strong> Tagihan akan otomatis berubah status
                            menjadi <strong>Lunas</strong>.
                          </span>
                        </div>
                      ) : Number(payAmount) < currentRemaining ? (
                        <div className="p-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 flex items-start gap-1.5 font-medium">
                          <Clock className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                          <div>
                            <strong>Pembayaran Sebagian (Cicilan):</strong>
                            <p className="text-[10px] text-amber-800 mt-0.5">
                              Tagihan tetap berstatus Belum Dibayar dengan sisa tagihan berikutnya:{' '}
                              <strong>{formatRupiah(currentRemaining - Number(payAmount))}</strong>.
                            </p>
                          </div>
                        </div>
                      ) : (
                        <div className="p-2 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 font-semibold">
                          Nominal melebihi sisa tagihan ({formatRupiah(currentRemaining)})!
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* 4. Metode Pembayaran (Requirement 5) */}
                <div>
                  <label className="block font-semibold text-slate-700 mb-1.5">
                    Metode Pembayaran <span className="text-rose-500">*</span>
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => setPayMethod('cash')}
                      className={`p-2.5 rounded-xl border text-center transition-all ${
                        payMethod === 'cash'
                          ? 'border-emerald-600 bg-emerald-50/70 text-emerald-900 font-bold ring-2 ring-emerald-500/20'
                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <div className="text-base mb-0.5">💵</div>
                      <div className="text-xs">Tunai</div>
                      <div className="text-[10px] text-slate-400">Kasir Loket</div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setPayMethod('transfer')}
                      className={`p-2.5 rounded-xl border text-center transition-all ${
                        payMethod === 'transfer'
                          ? 'border-blue-600 bg-blue-50/70 text-blue-900 font-bold ring-2 ring-blue-500/20'
                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <div className="text-base mb-0.5">🏦</div>
                      <div className="text-xs">Transfer Bank</div>
                      <div className="text-[10px] text-slate-400">BCA / Mandiri / dll</div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setPayMethod('qris')}
                      className={`p-2.5 rounded-xl border text-center transition-all ${
                        payMethod === 'qris'
                          ? 'border-purple-600 bg-purple-50/70 text-purple-900 font-bold ring-2 ring-purple-500/20'
                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <div className="text-base mb-0.5">📱</div>
                      <div className="text-xs">QRIS</div>
                      <div className="text-[10px] text-slate-400">Scan Barcode Kasir</div>
                    </button>
                  </div>
                  <span className="text-[10px] text-slate-400 block mt-1">
                    *Pencatatan kasir manual — konfirmasi mutasi rekening atau struk scan QRIS dilakukan oleh admin.
                  </span>
                </div>

                {/* 5. Kasir Penerima & Keterangan Transaksi */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Nama Kasir / Penerima
                    </label>
                    <input
                      type="text"
                      value={payReceiver}
                      onChange={(e) => setPayReceiver(e.target.value)}
                      placeholder="Nama admin penerima"
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white font-medium"
                    />
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Keterangan / Catatan
                    </label>
                    <input
                      type="text"
                      value={payNotes}
                      onChange={(e) => setPayNotes(e.target.value)}
                      placeholder="Contoh: Diterima lunas di pos kasir"
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white"
                    />
                  </div>
                </div>

                {/* Modal Footer Actions */}
                <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2.5">
                  <button
                    type="button"
                    onClick={() => setIsRecordModalOpen(false)}
                    className="px-4 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold"
                  >
                    Batal
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-semibold shadow-xs flex items-center gap-1.5"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Menyimpan ke PostgreSQL...</span>
                      </>
                    ) : (
                      <>
                        <CheckCircle className="w-4 h-4" />
                        <span>Konfirmasi Pembayaran</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* MODAL 2: DETAIL PEMBAYARAN (Requirement 2) */}
      {detailPayment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 relative">
            <div className="flex items-start justify-between pb-4 border-b border-slate-100">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-xs bg-slate-100 text-slate-800 px-2 py-0.5 rounded">
                    {detailPayment.transactionNumber || detailPayment.receiptNumber}
                  </span>
                  <span
                    className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold border ${
                      getPaymentMethodBadge(detailPayment.method).bg
                    }`}
                  >
                    {getPaymentMethodBadge(detailPayment.method).label}
                  </span>
                  {detailPayment.isPartial && (
                    <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-200">
                      Sebagian
                    </span>
                  )}
                </div>
                <h3 className="text-base font-bold text-slate-900 mt-1">
                  {detailPayment.customerName}
                </h3>
                <p className="text-xs text-slate-500">ID Pelanggan: {detailPayment.customerId || '-'}</p>
              </div>
              <button
                onClick={() => setDetailPayment(null)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="py-4 space-y-4 text-xs">
              {/* Highlight Nominal */}
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between">
                <div>
                  <span className="text-slate-500 font-medium block text-[11px]">
                    Nominal Pembayaran Diterima
                  </span>
                  <span className="text-2xl font-black text-emerald-600">
                    {formatRupiah(detailPayment.amount)}
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-slate-500 font-medium block text-[11px]">Waktu Transaksi</span>
                  <span className="text-xs font-bold text-slate-800">{detailPayment.paidAt}</span>
                </div>
              </div>

              {/* Rincian Transaksi */}
              <div className="grid grid-cols-2 gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs">
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-semibold">
                    No. Tagihan Terkait
                  </span>
                  <span className="font-mono font-bold text-blue-700">
                    {detailPayment.invoiceNumber}
                  </span>
                </div>

                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-semibold">
                    Metode Pembayaran
                  </span>
                  <span className="font-semibold text-slate-800 uppercase">
                    {detailPayment.method}
                  </span>
                </div>

                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-semibold">
                    Kasir Penerima
                  </span>
                  <span className="font-semibold text-slate-800">{detailPayment.receiverName}</span>
                </div>

                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-semibold">
                    Jenis Transaksi
                  </span>
                  <span className="font-semibold text-slate-800">
                    {detailPayment.isPartial ? 'Pembayaran Sebagian (Cicilan)' : 'Pelunasan Penuh'}
                  </span>
                </div>
              </div>

              {/* Catatan Transaksi */}
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                <span className="text-slate-400 block text-[10px] uppercase font-semibold mb-1">
                  Keterangan / Catatan
                </span>
                <p className="text-slate-800 italic">{detailPayment.notes || 'Tidak ada catatan.'}</p>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
              <button
                onClick={() => {
                  const p = detailPayment;
                  setDetailPayment(null);
                  setReceiptToPrint(p);
                }}
                className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold flex items-center gap-1.5 shadow-xs"
              >
                <Printer className="w-4 h-4" />
                <span>Cetak Bukti Pembayaran</span>
              </button>

              <button
                onClick={() => setDetailPayment(null)}
                className="px-4 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: CETAK BUKTI PEMBAYARAN / STRUK SAH (Requirements 2 & 15) */}
      {receiptToPrint && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 relative my-6 animate-in fade-in duration-150">
            {/* Action Bar (Top) */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 print:hidden">
              <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                <FileText className="w-4 h-4 text-blue-600" />
                Pratinjau Bukti Pembayaran
              </span>
              <button
                onClick={() => setReceiptToPrint(null)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Printable Receipt Paper Container */}
            <div id="receipt-paper" className="p-4 bg-slate-50/50 rounded-xl border border-slate-200 my-3 font-mono text-xs text-slate-800">
              {/* Receipt Header */}
              <div className="text-center pb-3 border-b border-dashed border-slate-300">
                <h2 className="font-extrabold text-base tracking-wide text-slate-900 uppercase">
                  {settings.businessName || 'ADI_HOTSPOT BILLING'}
                </h2>
                <p className="text-[11px] text-slate-600 mt-0.5">
                  Layanan Internet RT/RW Net Berkah & Handal
                </p>
                <p className="text-[10px] text-slate-500">
                  {settings.address || 'Kompleks RT 01 - RW 04'}, {settings.village || 'Desa Sukamaju'}
                </p>
                <p className="text-[10px] text-slate-500">
                  WhatsApp: {settings.phone || '0812-3456-7890'}
                </p>
                <div className="mt-2 inline-block px-2.5 py-0.5 bg-slate-200 text-slate-800 font-bold text-[10px] rounded uppercase tracking-wider">
                  BUKTI PEMBAYARAN SAH
                </div>
              </div>

              {/* Receipt Info Rows */}
              <div className="py-3 space-y-2 border-b border-dashed border-slate-300 text-[11px]">
                <div className="flex justify-between">
                  <span className="text-slate-500">No. Transaksi:</span>
                  <span className="font-bold text-slate-900">
                    {receiptToPrint.transactionNumber || receiptToPrint.receiptNumber}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">No. Tagihan:</span>
                  <span className="font-bold text-blue-700">{receiptToPrint.invoiceNumber}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Waktu Bayar:</span>
                  <span className="text-slate-800">{receiptToPrint.paidAt}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">ID Pelanggan:</span>
                  <span className="font-bold text-slate-800">{receiptToPrint.customerId || '-'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Nama Pelanggan:</span>
                  <span className="font-bold text-slate-900">{receiptToPrint.customerName}</span>
                </div>
                {getInvoiceForPayment(receiptToPrint) && (
                  <>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Paket Internet:</span>
                      <span className="text-slate-800">
                        {getInvoiceForPayment(receiptToPrint)?.packageName}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Periode Tagihan:</span>
                      <span className="text-slate-800">
                        {getInvoiceForPayment(receiptToPrint)?.monthPeriod}
                      </span>
                    </div>
                  </>
                )}
                <div className="flex justify-between">
                  <span className="text-slate-500">Metode Bayar:</span>
                  <span className="font-bold text-slate-800 uppercase">
                    {receiptToPrint.method === 'cash'
                      ? 'TUNAI (LOKET)'
                      : receiptToPrint.method === 'transfer'
                      ? 'TRANSFER BANK'
                      : 'QRIS (BARCODE)'}
                  </span>
                </div>
                {receiptToPrint.notes && (
                  <div className="flex justify-between">
                    <span className="text-slate-500">Catatan:</span>
                    <span className="text-slate-700 italic max-w-[200px] text-right truncate">
                      {receiptToPrint.notes}
                    </span>
                  </div>
                )}
              </div>

              {/* Financial Summary */}
              <div className="py-3 space-y-1.5 border-b border-dashed border-slate-300">
                <div className="flex justify-between items-baseline text-xs">
                  <span className="font-bold text-slate-700">NOMINAL DIBAYAR:</span>
                  <span className="font-black text-sm text-emerald-700">
                    {formatRupiah(receiptToPrint.amount)}
                  </span>
                </div>

                {receiptToPrint.isPartial ? (
                  <div className="flex justify-between text-[11px] text-amber-800 pt-1">
                    <span>Status Transaksi:</span>
                    <span className="font-bold">PEMBAYARAN SEBAGIAN (CICILAN)</span>
                  </div>
                ) : (
                  <div className="flex justify-between text-[11px] text-emerald-700 pt-1">
                    <span>Status Transaksi:</span>
                    <span className="font-extrabold uppercase">✓ LUNAS PENUH</span>
                  </div>
                )}
              </div>

              {/* Receipt Footer & Signatures */}
              <div className="pt-3 text-center space-y-1 text-[10px] text-slate-500">
                <p>Kasir / Penerima: <strong className="text-slate-800">{receiptToPrint.receiverName}</strong></p>
                <p className="mt-1">
                  Struk ini merupakan bukti pembayaran sah yang dikeluarkan oleh manajemen Adi_Hotspot Billing.
                </p>
                <p className="font-semibold text-slate-600">
                  Terima kasih atas kerja sama dan pembayaran tepat waktu!
                </p>
              </div>
            </div>

            {/* Receipt Modal Controls */}
            <div className="pt-3 flex items-center justify-between gap-2 print:hidden">
              <button
                type="button"
                onClick={() => setReceiptToPrint(null)}
                className="px-4 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold"
              >
                Tutup
              </button>

              <button
                type="button"
                onClick={() => {
                  window.print();
                }}
                className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold flex items-center gap-1.5 shadow-xs"
              >
                <Printer className="w-4 h-4" />
                <span>Cetak Struk Sekarang</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
