import React, { useState, useMemo } from 'react';
import {
  Users,
  Search,
  Plus,
  Filter,
  Phone,
  MapPin,
  Wifi,
  Eye,
  EyeOff,
  Edit2,
  Trash2,
  UserPlus,
  CheckCircle2,
  AlertTriangle,
  X,
  MessageCircle,
  Calendar,
  Layers,
  Database,
  RotateCcw,
  ShieldAlert,
  Hash,
  Activity,
  Check,
  RefreshCw,
  Key,
  Lock,
} from 'lucide-react';
import { Customer, CustomerType, CustomerStatus, InternetPackage } from '../types/index.ts';
import {
  formatRupiah,
  formatDateIndo,
  getCustomerStatusBadge,
  generateUniqueCustomerId,
} from '../utils/formatters.ts';
import { CustomerExportModal } from '../components/CustomerExportModal.tsx';
import { CustomerImportModal } from '../components/CustomerImportModal.tsx';
import { LocationPickerModal } from '../components/LocationPickerModal.tsx';
import { CustomerDistributionMapModal } from '../components/CustomerDistributionMapModal.tsx';
import { Download, Upload, Navigation, Compass } from 'lucide-react';
import { syncCustomerToRouterApi } from '../services/apiService.ts';

interface CustomersViewProps {
  customers: Customer[];
  packages: InternetPackage[];
  onAddCustomer: (customer: Customer) => Promise<{ success: boolean; message?: string }> | { success: boolean; message?: string } | void;
  onEditCustomer: (customer: Customer) => Promise<{ success: boolean; message?: string }> | { success: boolean; message?: string } | void;
  onDeleteCustomer: (customerId: string) => Promise<{ success: boolean; message?: string }> | { success: boolean; message?: string } | void;
  onToggleStatus: (customerId: string, nextStatus: CustomerStatus) => Promise<{ success: boolean; message?: string }> | { success: boolean; message?: string } | void;
  onCustomerSyncUpdate?: (customer: Customer) => void;
}

interface FormErrors {
  name?: string;
  phone?: string;
  address?: string;
  username?: string;
  password?: string;
  packageId?: string;
  registeredAt?: string;
}

export const CustomersView: React.FC<CustomersViewProps> = ({
  customers,
  packages,
  onAddCustomer,
  onEditCustomer,
  onDeleteCustomer,
  onToggleStatus,
  onCustomerSyncUpdate,
}) => {
  // Filters & Search
  const [searchQuery, setSearchQuery] = useState('');
  const [packageFilter, setPackageFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<'all' | CustomerType>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | CustomerStatus>('all');

  // Modals
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [detailCustomer, setDetailCustomer] = useState<Customer | null>(null);
  const [customerToDelete, setCustomerToDelete] = useState<Customer | null>(null);

  // Toast Notification
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 3500);
  };

  // Modals for Export, Import, and Map
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isDistributionMapOpen, setIsDistributionMapOpen] = useState(false);
  const [focusedMapCustomerId, setFocusedMapCustomerId] = useState<string | undefined>(undefined);
  const [isLocationPickerOpen, setIsLocationPickerOpen] = useState(false);
  const [locationPickerContext, setLocationPickerContext] = useState<{
    lat?: number;
    lng?: number;
    address?: string;
    customerName?: string;
    onSave: (coords: { latitude: number; longitude: number }) => void;
  } | null>(null);

  // Form States (used for both Add and Edit)
  const [formId, setFormId] = useState('');
  const [formName, setFormName] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formAddress, setFormAddress] = useState('');
  const [formInstallationAddress, setFormInstallationAddress] = useState('');
  const [formLatitude, setFormLatitude] = useState<number | ''>('');
  const [formLongitude, setFormLongitude] = useState<number | ''>('');
  const [formPackageId, setFormPackageId] = useState('');
  const [formType, setFormType] = useState<CustomerType>('pppoe');
  const [formUsername, setFormUsername] = useState('');
  const [formPassword, setFormPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [syncingCustomerId, setSyncingCustomerId] = useState<string | null>(null);
  const [formIpAddress, setFormIpAddress] = useState('');
  const [formStatus, setFormStatus] = useState<CustomerStatus>('active');
  const [formRegisteredAt, setFormRegisteredAt] = useState('');
  const [formDueDateDay, setFormDueDateDay] = useState(10);
  const [formErrors, setFormErrors] = useState<FormErrors>({});

  // Sinkronisasi manual akun pelanggan ke router MikroTik
  const handleSyncToRouter = async (customer: Customer) => {
    setSyncingCustomerId(customer.id);
    try {
      const res = await syncCustomerToRouterApi(customer.id);
      const syncStatus = res.success ? 'synced' : 'failed';
      const syncMsg = res.data?.routerLastSyncMessage || res.message;
      const syncAt = res.data?.routerLastSyncAt || (res.success ? new Date().toISOString() : customer.routerLastSyncAt);

      const updatedFields: Customer = {
        ...customer,
        routerSyncStatus: syncStatus,
        routerLastSyncAt: syncAt,
        routerLastSyncMessage: syncMsg,
      };

      if (onCustomerSyncUpdate) {
        onCustomerSyncUpdate(updatedFields);
      }

      if (detailCustomer && detailCustomer.id === customer.id) {
        setDetailCustomer(updatedFields);
      }

      showToast(
        res.message ||
          (res.success
            ? `Akun ${customer.username} berhasil disinkronkan ke router!`
            : 'Gagal melakukan sinkronisasi ke router.')
      );
    } catch (err: any) {
      showToast(err?.message || 'Terjadi kesalahan sistem saat menghubungi server.');
    } finally {
      setSyncingCustomerId(null);
    }
  };

  // Open Add Modal
  const handleOpenAddModal = () => {
    const autoId = generateUniqueCustomerId(customers);
    const defaultPackage = packages[0]?.id || '';
    const today = new Date().toISOString().split('T')[0];

    setFormId(autoId);
    setFormName('');
    setFormPhone('');
    setFormAddress('');
    setFormInstallationAddress('');
    setFormLatitude('');
    setFormLongitude('');
    setFormPackageId(defaultPackage);
    setFormType('pppoe');
    setFormUsername('');
    setFormPassword('');
    setShowPassword(false);
    setFormIpAddress('');
    setFormStatus('active');
    setFormRegisteredAt(today);
    setFormDueDateDay(10);
    setFormErrors({});
    setIsAddModalOpen(true);
  };

  // Open Edit Modal
  const handleOpenEditModal = (cust: Customer) => {
    setEditingCustomer(cust);
    setFormId(cust.id);
    setFormName(cust.name);
    setFormPhone(cust.phone);
    setFormAddress(cust.address);
    setFormInstallationAddress(cust.installationAddress || cust.address);
    setFormLatitude(cust.latitude !== undefined ? cust.latitude : '');
    setFormLongitude(cust.longitude !== undefined ? cust.longitude : '');
    setFormPackageId(cust.packageId);
    setFormType(cust.type);
    setFormUsername(cust.username);
    setFormPassword('');
    setShowPassword(false);
    setFormIpAddress(cust.ipAddress || '');
    setFormStatus(cust.status);
    setFormRegisteredAt(cust.registeredAt);
    setFormDueDateDay(cust.dueDateDay);
    setFormErrors({});
  };

  // Validation function
  const validateForm = (isEditing: boolean, currentId?: string): boolean => {
    const errors: FormErrors = {};

    // 1. Nama
    if (!formName.trim()) {
      errors.name = 'Nama pelanggan wajib diisi';
    } else if (formName.trim().length < 3) {
      errors.name = 'Nama pelanggan minimal 3 karakter';
    }

    // 2. Nomor WhatsApp
    const phoneDigits = formPhone.replace(/[^0-9]/g, '');
    if (!formPhone.trim()) {
      errors.phone = 'Nomor WhatsApp wajib diisi';
    } else if (phoneDigits.length < 9 || phoneDigits.length > 15) {
      errors.phone = 'Nomor WhatsApp tidak valid (minimal 9-15 digit angka)';
    }

    // 3. Alamat
    if (!formAddress.trim()) {
      errors.address = 'Alamat pemasangan wajib diisi';
    } else if (formAddress.trim().length < 5) {
      errors.address = 'Alamat pemasangan minimal 5 karakter';
    }

    // 4. Username koneksi
    const trimmedUsername = formUsername.trim();
    if (!trimmedUsername) {
      errors.username = 'Username koneksi wajib diisi';
    } else if (trimmedUsername.length < 3) {
      errors.username = 'Username minimal 3 karakter';
    } else if (!/^[a-zA-Z0-9_.-]+$/.test(trimmedUsername)) {
      errors.username = 'Username hanya boleh huruf, angka, titik, underscore (_) dan strip (-)';
    } else {
      // Check username uniqueness
      const usernameExists = customers.some((c) => {
        if (isEditing && currentId && c.id === currentId) {
          return false;
        }
        return c.username.toLowerCase() === trimmedUsername.toLowerCase();
      });

      if (usernameExists) {
        errors.username = 'Username ini sudah digunakan oleh pelanggan lain';
      }
    }

    // 5. Password Pelanggan (Wajib minimal 6 karakter untuk pelanggan baru)
    if (!isEditing) {
      if (!formPassword.trim()) {
        errors.password = 'Password akun router wajib diisi untuk pelanggan baru';
      } else if (formPassword.trim().length < 6) {
        errors.password = 'Password minimal 6 karakter';
      }
    } else {
      if (formPassword && formPassword !== '••••••••' && formPassword.trim().length < 6) {
        errors.password = 'Password baru minimal 6 karakter';
      }
    }

    // 6. Paket
    if (!formPackageId) {
      errors.packageId = 'Pilih paket internet pelanggan';
    }

    // 7. Tanggal pemasangan
    if (!formRegisteredAt) {
      errors.registeredAt = 'Tanggal pemasangan wajib diisi';
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // Submit Add
  const handleSubmitAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm(false)) return;

    const selectedPkg = packages.find((p) => p.id === formPackageId) || packages[0];

    const newCustomer: Customer = {
      id: formId,
      name: formName.trim(),
      phone: formPhone.trim(),
      address: formAddress.trim(),
      installationAddress: formInstallationAddress.trim() || formAddress.trim(),
      latitude: formLatitude !== '' ? Number(formLatitude) : undefined,
      longitude: formLongitude !== '' ? Number(formLongitude) : undefined,
      packageId: selectedPkg.id,
      packageName: selectedPkg.name,
      type: formType,
      username: formUsername.trim(),
      password: formPassword.trim(),
      isPasswordConfigured: true,
      maskedPassword: '••••••••',
      ipAddress: formIpAddress.trim() || (formType === 'pppoe' ? '192.168.10.x' : '10.20.0.x'),
      status: formStatus,
      routerSyncStatus: 'pending',
      registeredAt: formRegisteredAt,
      installationDate: formRegisteredAt,
      dueDateDay: Number(formDueDateDay),
      monthlyFee: selectedPkg.price,
    };

    try {
      const res = await onAddCustomer(newCustomer);
      if (res && res.success === false) {
        setFormErrors({ name: res.message || 'Gagal menyimpan pelanggan ke database.' });
        return;
      }
      setIsAddModalOpen(false);
      showToast(`Pelanggan "${newCustomer.name}" (${newCustomer.id}) berhasil ditambahkan!`);
    } catch (err: any) {
      setFormErrors({ name: err?.message || 'Terjadi kesalahan sistem saat menghubungi database.' });
    }
  };

  // Submit Edit
  const handleSubmitEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCustomer) return;
    if (!validateForm(true, editingCustomer.id)) return;

    const selectedPkg = packages.find((p) => p.id === formPackageId) || packages[0];

    const updatedCustomer: Customer = {
      ...editingCustomer,
      name: formName.trim(),
      phone: formPhone.trim(),
      address: formAddress.trim(),
      installationAddress: formInstallationAddress.trim() || formAddress.trim(),
      latitude: formLatitude !== '' ? Number(formLatitude) : undefined,
      longitude: formLongitude !== '' ? Number(formLongitude) : undefined,
      packageId: selectedPkg.id,
      packageName: selectedPkg.name,
      type: formType,
      username: formUsername.trim(),
      password: formPassword && formPassword !== '••••••••' ? formPassword.trim() : undefined,
      ipAddress: formIpAddress.trim() || editingCustomer.ipAddress,
      status: formStatus,
      registeredAt: formRegisteredAt,
      installationDate: formRegisteredAt,
      dueDateDay: Number(formDueDateDay),
      monthlyFee: selectedPkg.price,
    };

    try {
      const res = await onEditCustomer(updatedCustomer);
      if (res && res.success === false) {
        setFormErrors({ name: res.message || 'Gagal memperbarui data pelanggan di database.' });
        return;
      }
      setEditingCustomer(null);
      showToast(`Data pelanggan "${updatedCustomer.name}" berhasil diperbarui!`);
    } catch (err: any) {
      setFormErrors({ name: err?.message || 'Terjadi kesalahan sistem saat menghubungi database.' });
    }
  };

  // Confirm Delete
  const handleConfirmDelete = async () => {
    if (!customerToDelete) return;
    const deletedName = customerToDelete.name;
    const deletedId = customerToDelete.id;

    try {
      const res = await onDeleteCustomer(customerToDelete.id);
      if (res && res.success === false) {
        showToast(res.message || 'Gagal menghapus pelanggan dari database.');
        return;
      }
      setCustomerToDelete(null);
      showToast(`Pelanggan "${deletedName}" (${deletedId}) berhasil dihapus.`);
    } catch (err: any) {
      showToast(err?.message || 'Terjadi kesalahan sistem saat menghubungi database.');
    }
  };

  // Filter & Search Logic
  const filteredCustomers = useMemo(() => {
    return customers.filter((cust) => {
      // Search: name, id, username
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !q ||
        cust.name.toLowerCase().includes(q) ||
        cust.id.toLowerCase().includes(q) ||
        cust.username.toLowerCase().includes(q);

      // Filter Package
      const matchesPackage = packageFilter === 'all' || cust.packageId === packageFilter;

      // Filter Type
      const matchesType = typeFilter === 'all' || cust.type === typeFilter;

      // Filter Status
      const matchesStatus = statusFilter === 'all' || cust.status === statusFilter;

      return matchesSearch && matchesPackage && matchesType && matchesStatus;
    });
  }, [customers, searchQuery, packageFilter, typeFilter, statusFilter]);

  const hasActiveFilters =
    searchQuery.trim() !== '' ||
    packageFilter !== 'all' ||
    typeFilter !== 'all' ||
    statusFilter !== 'all';

  const handleResetFilters = () => {
    setSearchQuery('');
    setPackageFilter('all');
    setTypeFilter('all');
    setStatusFilter('all');
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

      {/* Notice Banner: Local Storage Persistence */}
      <div className="bg-blue-50/80 border border-blue-200/90 rounded-xl p-3.5 sm:p-4 text-xs text-blue-900 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-xs">
        <div className="flex items-start gap-2.5">
          <div className="p-1 rounded bg-blue-200/70 text-blue-800 shrink-0 mt-0.5">
            <Database className="w-3.5 h-3.5" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <strong className="font-bold text-blue-950">
                Data Pelanggan (Database PostgreSQL)
              </strong>
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-200">
                adi_hotspot
              </span>
            </div>
            <p className="text-blue-800/90 text-[11px] mt-0.5">
              Data pelanggan dikelola langsung dari server database PostgreSQL. Pelanggan baru,
              perubahan paket, atau pembaruan status tersimpan secara terpusat dan aman di database.
            </p>
          </div>
        </div>
        <div className="text-[11px] font-semibold text-blue-700 bg-white px-2.5 py-1 rounded-lg border border-blue-200 shrink-0">
          Total: {customers.length} Pelanggan
        </div>
      </div>

      {/* Search & Filter Toolbar */}
      <div className="bg-white rounded-xl p-4 border border-slate-200/90 shadow-xs space-y-3">
        <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
          {/* Search Input: name, ID, username */}
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari berdasarkan nama pelanggan, ID (contoh: ADI-0101), atau username..."
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

          {/* Actions: Map, Export, Import, Add */}
          <div className="flex items-center gap-2 flex-wrap shrink-0">
            <button
              onClick={() => {
                setFocusedMapCustomerId(undefined);
                setIsDistributionMapOpen(true);
              }}
              className="px-3 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-sm font-semibold flex items-center justify-center gap-1.5 transition-colors shadow-xs"
              title="Lihat Peta Persebaran Pelanggan"
            >
              <MapPin className="w-4 h-4" />
              <span>Peta Persebaran</span>
            </button>

            <button
              onClick={() => setIsExportOpen(true)}
              className="px-3 py-2.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs sm:text-sm font-semibold flex items-center justify-center gap-1.5 transition-colors shadow-xs"
              title="Export Pelanggan ke Excel atau CSV"
            >
              <Download className="w-4 h-4 text-blue-600" />
              <span>Export</span>
            </button>

            <button
              onClick={() => setIsImportOpen(true)}
              className="px-3 py-2.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs sm:text-sm font-semibold flex items-center justify-center gap-1.5 transition-colors shadow-xs"
              title="Import Pelanggan dari Excel / CSV"
            >
              <Upload className="w-4 h-4 text-emerald-600" />
              <span>Import</span>
            </button>

            <button
              onClick={handleOpenAddModal}
              className="px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs sm:text-sm font-semibold flex items-center justify-center gap-2 transition-colors shadow-xs shrink-0"
            >
              <UserPlus className="w-4 h-4" />
              <span>Tambah Pelanggan</span>
            </button>
          </div>
        </div>

        {/* Filters Row: Paket, Jenis Koneksi, Status */}
        <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2.5 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 text-slate-500 font-semibold text-[11px] uppercase tracking-wider mr-1">
              <Filter className="w-3.5 h-3.5 text-slate-400" />
              <span>Filter:</span>
            </div>

            {/* Filter Paket */}
            <select
              value={packageFilter}
              onChange={(e) => setPackageFilter(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-slate-700 font-medium focus:ring-1 focus:ring-blue-500"
            >
              <option value="all">Semua Paket Internet</option>
              {packages.map((pkg) => (
                <option key={pkg.id} value={pkg.id}>
                  {pkg.name} ({pkg.speed})
                </option>
              ))}
            </select>

            {/* Filter Jenis Koneksi */}
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as any)}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-slate-700 font-medium focus:ring-1 focus:ring-blue-500"
            >
              <option value="all">Semua Jenis Koneksi</option>
              <option value="pppoe">PPPoE (Rumahan / Kabel)</option>
              <option value="hotspot">Hotspot (Voucher)</option>
            </select>

            {/* Filter Status Pelanggan */}
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-slate-700 font-medium focus:ring-1 focus:ring-blue-500"
            >
              <option value="all">Semua Status Pelanggan</option>
              <option value="active">Aktif</option>
              <option value="isolated">Isolir</option>
              <option value="inactive">Nonaktif</option>
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
            Menampilkan <strong className="text-slate-800">{filteredCustomers.length}</strong> dari{' '}
            {customers.length} data
          </div>
        </div>
      </div>

      {/* Customer Table with All 10 Required Columns */}
      <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs sm:text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold text-[11px] uppercase tracking-wider">
              <tr>
                <th className="px-3.5 py-3.5 whitespace-nowrap">ID Pelanggan</th>
                <th className="px-3.5 py-3.5 whitespace-nowrap">Nama Pelanggan</th>
                <th className="px-3.5 py-3.5 whitespace-nowrap">Nomor WhatsApp</th>
                <th className="px-3.5 py-3.5 whitespace-nowrap">Alamat</th>
                <th className="px-3.5 py-3.5 whitespace-nowrap">Paket Internet</th>
                <th className="px-3.5 py-3.5 whitespace-nowrap">Jenis Koneksi</th>
                <th className="px-3.5 py-3.5 whitespace-nowrap">Username Koneksi</th>
                <th className="px-3.5 py-3.5 whitespace-nowrap">Status</th>
                <th className="px-3.5 py-3.5 whitespace-nowrap">Tanggal Pasang</th>
                <th className="px-3.5 py-3.5 text-right whitespace-nowrap">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredCustomers.length === 0 ? (
                <tr>
                  <td colSpan={10} className="text-center py-12 px-4 text-slate-500">
                    <div className="max-w-xs mx-auto">
                      <Users className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                      <p className="font-semibold text-slate-700 text-sm">
                        Tidak ada pelanggan yang cocok
                      </p>
                      <p className="text-xs text-slate-400 mt-1">
                        Coba sesuaikan kata kunci pencarian atau reset filter di atas.
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
                filteredCustomers.map((cust) => {
                  const statusBadge = getCustomerStatusBadge(cust.status);
                  const isPppoe = cust.type === 'pppoe';

                  return (
                    <tr key={cust.id} className="hover:bg-slate-50/80 transition-colors">
                      {/* 1. ID Pelanggan */}
                      <td className="px-3.5 py-3.5 font-mono font-bold text-slate-900 whitespace-nowrap text-xs">
                        <span className="bg-slate-100 text-slate-800 px-2 py-1 rounded-md border border-slate-200/80">
                          {cust.id}
                        </span>
                      </td>

                      {/* 2. Nama Pelanggan */}
                      <td className="px-3.5 py-3.5 whitespace-nowrap font-bold text-slate-900">
                        {cust.name}
                      </td>

                      {/* 3. Nomor WhatsApp */}
                      <td className="px-3.5 py-3.5 whitespace-nowrap">
                        <a
                          href={`https://wa.me/${cust.phone.replace(/[^0-9]/g, '')}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-slate-700 hover:text-emerald-700 font-medium group transition-colors"
                          title="Hubungi via WhatsApp"
                        >
                          <Phone className="w-3.5 h-3.5 text-slate-400 group-hover:text-emerald-600 shrink-0" />
                          <span>{cust.phone}</span>
                        </a>
                      </td>

                      {/* 4. Alamat & Titik Lokasi */}
                      <td className="px-3.5 py-3.5 text-slate-600 max-w-xs">
                        <div className="flex items-center gap-1 truncate text-xs" title={cust.installationAddress || cust.address}>
                          <MapPin className="w-3 h-3 text-slate-400 shrink-0" />
                          <span className="truncate">{cust.address}</span>
                        </div>
                        {cust.latitude !== undefined && cust.longitude !== undefined ? (
                          <button
                            onClick={() => {
                              setFocusedMapCustomerId(cust.id);
                              setIsDistributionMapOpen(true);
                            }}
                            className="mt-1 inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 px-1.5 py-0.5 rounded border border-emerald-200 transition-colors"
                            title={`Titik: ${cust.latitude}, ${cust.longitude}`}
                          >
                            <MapPin className="w-2.5 h-2.5 text-emerald-600" />
                            <span>Titik Terpasang</span>
                          </button>
                        ) : (
                          <button
                            onClick={() => {
                              setLocationPickerContext({
                                lat: cust.latitude,
                                lng: cust.longitude,
                                address: cust.installationAddress || cust.address,
                                customerName: cust.name,
                                onSave: (coords) => {
                                  const updated = { ...cust, latitude: coords.latitude, longitude: coords.longitude };
                                  onEditCustomer(updated);
                                  showToast(`Titik koordinat untuk ${cust.name} berhasil disimpan!`);
                                },
                              });
                              setIsLocationPickerOpen(true);
                            }}
                            className="mt-1 inline-flex items-center gap-1 text-[10px] font-semibold text-amber-800 bg-amber-50 hover:bg-amber-100 px-1.5 py-0.5 rounded border border-amber-200 transition-colors"
                            title="Klik untuk menentukan titik di peta"
                          >
                            <MapPin className="w-2.5 h-2.5 text-amber-600" />
                            <span>Lokasi belum ditentukan</span>
                          </button>
                        )}
                      </td>

                      {/* 5. Paket Internet */}
                      <td className="px-3.5 py-3.5 whitespace-nowrap">
                        <div className="font-semibold text-slate-800 text-xs">{cust.packageName}</div>
                        <div className="text-[11px] text-slate-500 font-medium">
                          {formatRupiah(cust.monthlyFee)}
                        </div>
                      </td>

                      {/* 6. Jenis Koneksi */}
                      <td className="px-3.5 py-3.5 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded uppercase tracking-wider ${
                            isPppoe
                              ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                              : 'bg-purple-50 text-purple-700 border border-purple-200'
                          }`}
                        >
                          <Wifi className="w-3 h-3" />
                          {cust.type}
                        </span>
                      </td>

                      {/* 7. Username Koneksi & Status Router */}
                      <td className="px-3.5 py-3.5 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <code className="text-xs font-mono font-bold text-slate-800 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
                            {cust.username}
                          </code>
                          {cust.isPasswordConfigured && (
                            <span title="Password akun tersimpan aman (AES-256-GCM)">
                              <Lock className="w-3 h-3 text-emerald-600" />
                            </span>
                          )}
                        </div>

                        {/* Router Sync Badge */}
                        <div className="mt-1 flex items-center gap-1">
                          {cust.routerSyncStatus === 'synced' ? (
                            <span
                              className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200"
                              title={cust.routerLastSyncMessage || 'Akun tersinkron dengan router MikroTik'}
                            >
                              <Check className="w-2.5 h-2.5 text-emerald-600" />
                              <span>Tersinkron</span>
                            </span>
                          ) : cust.routerSyncStatus === 'failed' ? (
                            <span
                              className="inline-flex items-center gap-1 text-[10px] font-semibold text-rose-700 bg-rose-50 px-1.5 py-0.5 rounded border border-rose-200 cursor-help"
                              title={cust.routerLastSyncMessage || 'Sinkronisasi router gagal'}
                            >
                              <AlertTriangle className="w-2.5 h-2.5 text-rose-600" />
                              <span>Gagal Sync</span>
                            </span>
                          ) : (
                            <span
                              className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200"
                              title="Menunggu sinkronisasi ke router"
                            >
                              <Activity className="w-2.5 h-2.5 text-amber-600" />
                              <span>Pending</span>
                            </span>
                          )}
                        </div>
                      </td>

                      {/* 8. Status Pelanggan */}
                      <td className="px-3.5 py-3.5 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${statusBadge.bg}`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${statusBadge.dot}`} />
                          {statusBadge.label}
                        </span>
                      </td>

                      {/* 9. Tanggal Pemasangan */}
                      <td className="px-3.5 py-3.5 whitespace-nowrap text-slate-600 text-xs">
                        <div className="flex items-center gap-1">
                          <Calendar className="w-3 h-3 text-slate-400" />
                          <span>{formatDateIndo(cust.registeredAt)}</span>
                        </div>
                      </td>

                      {/* 10. Aksi: Sync, Detail, Peta, Edit, Hapus */}
                      <td className="px-3.5 py-3.5 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1">
                          {/* Sync to Router Action */}
                          <button
                            onClick={() => handleSyncToRouter(cust)}
                            disabled={syncingCustomerId === cust.id}
                            className="p-1.5 rounded-lg text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 transition-colors disabled:opacity-50"
                            title="Sinkronkan Akun ke Router MikroTik"
                            aria-label="Sinkronkan ke Router"
                          >
                            <RefreshCw className={`w-4 h-4 ${syncingCustomerId === cust.id ? 'animate-spin text-indigo-600' : ''}`} />
                          </button>

                          {/* Map Pin Action */}
                          <button
                            onClick={() => {
                              if (cust.latitude !== undefined && cust.longitude !== undefined) {
                                setFocusedMapCustomerId(cust.id);
                                setIsDistributionMapOpen(true);
                              } else {
                                setLocationPickerContext({
                                  lat: cust.latitude,
                                  lng: cust.longitude,
                                  address: cust.installationAddress || cust.address,
                                  customerName: cust.name,
                                  onSave: (coords) => {
                                    const updated = { ...cust, latitude: coords.latitude, longitude: coords.longitude };
                                    onEditCustomer(updated);
                                    showToast(`Titik koordinat untuk ${cust.name} berhasil disimpan!`);
                                  },
                                });
                                setIsLocationPickerOpen(true);
                              }
                            }}
                            className="p-1.5 rounded-lg text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 transition-colors"
                            title={cust.latitude !== undefined && cust.longitude !== undefined ? 'Lihat di Peta Persebaran' : 'Atur Titik Lokasi'}
                          >
                            <MapPin className="w-4 h-4 text-emerald-600" />
                          </button>

                          {/* Detail Button */}
                          <button
                            onClick={() => setDetailCustomer(cust)}
                            className="p-1.5 rounded-lg text-slate-500 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                            title="Detail Lengkap Pelanggan"
                            aria-label="Detail"
                          >
                            <Eye className="w-4 h-4" />
                          </button>

                          {/* Edit Button */}
                          <button
                            onClick={() => handleOpenEditModal(cust)}
                            className="p-1.5 rounded-lg text-slate-500 hover:text-amber-600 hover:bg-amber-50 transition-colors"
                            title="Edit Data Pelanggan"
                            aria-label="Edit"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>

                          {/* Delete Button */}
                          <button
                            onClick={() => setCustomerToDelete(cust)}
                            className="p-1.5 rounded-lg text-slate-500 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                            title="Hapus Pelanggan"
                            aria-label="Hapus"
                          >
                            <Trash2 className="w-4 h-4" />
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

      {/* MODAL 1: DETAIL PELANGGAN */}
      {detailCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 relative">
            <div className="flex items-start justify-between pb-4 border-b border-slate-100">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-xs bg-slate-100 text-slate-800 px-2 py-0.5 rounded">
                    {detailCustomer.id}
                  </span>
                  <h3 className="text-base font-bold text-slate-900">{detailCustomer.name}</h3>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Terdaftar sejak {formatDateIndo(detailCustomer.registeredAt)}
                </p>
              </div>
              <button
                onClick={() => setDetailCustomer(null)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="py-4 space-y-3.5 text-xs">
              {/* Highlight Card */}
              <div className="grid grid-cols-2 gap-3 bg-slate-50 p-3.5 rounded-xl border border-slate-200/80">
                <div>
                  <span className="text-slate-400 block text-[11px] font-medium">Jenis Koneksi</span>
                  <span className="font-bold text-slate-800 uppercase text-sm">
                    {detailCustomer.type}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[11px] font-medium">Status Akun</span>
                  <span
                    className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-bold border mt-0.5 ${
                      getCustomerStatusBadge(detailCustomer.status).bg
                    }`}
                  >
                    {getCustomerStatusBadge(detailCustomer.status).label}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[11px] font-medium">Username Koneksi</span>
                  <span className="font-mono font-bold text-slate-800 text-sm">
                    {detailCustomer.username}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[11px] font-medium">IP Address / Host</span>
                  <span className="font-mono font-semibold text-slate-700 text-xs">
                    {detailCustomer.ipAddress || 'Otomatis via DHCP'}
                  </span>
                </div>
              </div>

              <div>
                <span className="text-slate-500 font-medium block">Nomor WhatsApp</span>
                <div className="flex items-center justify-between mt-0.5">
                  <span className="text-slate-900 font-bold text-sm">{detailCustomer.phone}</span>
                  <a
                    href={`https://wa.me/${detailCustomer.phone.replace(/[^0-9]/g, '')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-2.5 py-1 rounded bg-emerald-50 text-emerald-700 hover:bg-emerald-100 font-semibold text-xs flex items-center gap-1 border border-emerald-200 transition-colors"
                  >
                    <MessageCircle className="w-3.5 h-3.5" />
                    <span>Chat WhatsApp</span>
                  </a>
                </div>
              </div>

              <div>
                <span className="text-slate-500 font-medium block">Alamat Pemasangan</span>
                <span className="text-slate-800 font-medium block mt-0.5 bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                  {detailCustomer.installationAddress || detailCustomer.address}
                </span>
              </div>

              {/* Titik Koordinat Lokasi */}
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 flex items-center justify-between">
                <div>
                  <span className="text-slate-500 font-semibold text-[11px] block">Titik Koordinat Peta:</span>
                  {detailCustomer.latitude !== undefined && detailCustomer.longitude !== undefined ? (
                    <span className="font-mono text-xs text-slate-800 font-bold block mt-0.5">
                      Lat: {detailCustomer.latitude}, Long: {detailCustomer.longitude}
                    </span>
                  ) : (
                    <span className="text-[11px] font-semibold text-amber-700 bg-amber-100/80 px-2 py-0.5 rounded inline-block mt-0.5">
                      Lokasi belum ditentukan
                    </span>
                  )}
                </div>

                {detailCustomer.latitude !== undefined && detailCustomer.longitude !== undefined ? (
                  <button
                    onClick={() => {
                      const cId = detailCustomer.id;
                      setDetailCustomer(null);
                      setFocusedMapCustomerId(cId);
                      setIsDistributionMapOpen(true);
                    }}
                    className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs flex items-center gap-1.5 shadow-xs"
                  >
                    <MapPin className="w-3.5 h-3.5" />
                    <span>Lihat di Peta</span>
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      const target = detailCustomer;
                      setLocationPickerContext({
                        lat: target.latitude,
                        lng: target.longitude,
                        address: target.installationAddress || target.address,
                        customerName: target.name,
                        onSave: (coords) => {
                          const updated = { ...target, latitude: coords.latitude, longitude: coords.longitude };
                          onEditCustomer(updated);
                          setDetailCustomer(updated);
                          showToast(`Titik koordinat untuk ${target.name} berhasil disimpan!`);
                        },
                      });
                      setIsLocationPickerOpen(true);
                    }}
                    className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs flex items-center gap-1.5 shadow-xs"
                  >
                    <MapPin className="w-3.5 h-3.5" />
                    <span>Atur Titik Peta</span>
                  </button>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3 pt-1">
                <div>
                  <span className="text-slate-500 font-medium block">Paket Berlangganan</span>
                  <span className="font-bold text-slate-900 text-sm">{detailCustomer.packageName}</span>
                </div>
                <div>
                  <span className="text-slate-500 font-medium block">Tarif & Jatuh Tempo</span>
                  <span className="font-bold text-slate-900 text-sm">
                    {formatRupiah(detailCustomer.monthlyFee)}{' '}
                    <span className="font-normal text-xs text-slate-500 block">
                      Tiap tanggal {detailCustomer.dueDateDay}
                    </span>
                  </span>
                </div>
              </div>

              {/* Integrasi MikroTik Router */}
              <div className="bg-slate-50 rounded-xl p-3.5 border border-slate-200/80 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-slate-700 font-bold text-xs">
                    <Activity className="w-3.5 h-3.5 text-blue-600" />
                    <span>Status Router MikroTik ({detailCustomer.type.toUpperCase()})</span>
                  </div>
                  <span
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                      detailCustomer.routerSyncStatus === 'synced'
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : detailCustomer.routerSyncStatus === 'failed'
                        ? 'bg-rose-50 text-rose-700 border-rose-200'
                        : 'bg-amber-50 text-amber-700 border-amber-200'
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        detailCustomer.routerSyncStatus === 'synced'
                          ? 'bg-emerald-500'
                          : detailCustomer.routerSyncStatus === 'failed'
                          ? 'bg-rose-500'
                          : 'bg-amber-500 animate-pulse'
                      }`}
                    />
                    {detailCustomer.routerSyncStatus === 'synced'
                      ? 'Tersinkron'
                      : detailCustomer.routerSyncStatus === 'failed'
                      ? 'Gagal Sinkron'
                      : 'Belum Tersinkron'}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-[11px] pt-1 border-t border-slate-200/60">
                  <div>
                    <span className="text-slate-400 block font-medium">Kredensial Akun</span>
                    <span className="font-mono text-slate-700 font-semibold flex items-center gap-1 mt-0.5">
                      <Lock className="w-3 h-3 text-slate-400" />
                      {detailCustomer.maskedPassword || '••••••••'} (AES-256-GCM)
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block font-medium">Terakhir Sinkron</span>
                    <span className="text-slate-700 font-semibold block mt-0.5">
                      {detailCustomer.routerLastSyncAt
                        ? formatDateIndo(detailCustomer.routerLastSyncAt)
                        : 'Belum pernah'}
                    </span>
                  </div>
                </div>

                {detailCustomer.routerLastSyncMessage && (
                  <div className="text-[10px] bg-white p-2 rounded border border-slate-200 text-slate-600 font-mono truncate">
                    Catatan: {detailCustomer.routerLastSyncMessage}
                  </div>
                )}

                <div className="pt-1 flex justify-end">
                  <button
                    type="button"
                    onClick={() => handleSyncToRouter(detailCustomer)}
                    disabled={syncingCustomerId === detailCustomer.id}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-100 hover:text-blue-700 disabled:opacity-50 transition-colors shadow-2xs"
                  >
                    <RefreshCw
                      className={`w-3.5 h-3.5 text-blue-600 ${
                        syncingCustomerId === detailCustomer.id ? 'animate-spin' : ''
                      }`}
                    />
                    <span>
                      {syncingCustomerId === detailCustomer.id
                        ? 'Menghubungi Router...'
                        : 'Sinkronkan Ulang ke Router'}
                    </span>
                  </button>
                </div>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
              {/* Quick Status Toggle */}
              {detailCustomer.status === 'active' ? (
                <button
                  onClick={async () => {
                    const res = await onToggleStatus(detailCustomer.id, 'isolated');
                    if (res && res.success === false) {
                      showToast(res.message || 'Gagal mengubah status di database.');
                      return;
                    }
                    setDetailCustomer({ ...detailCustomer, status: 'isolated' });
                    showToast(`Status pelanggan ${detailCustomer.name} diubah menjadi Terisolir`);
                  }}
                  className="px-3 py-1.5 rounded-lg bg-amber-50 text-amber-800 border border-amber-200 text-xs font-semibold hover:bg-amber-100"
                >
                  Ubah ke Isolir
                </button>
              ) : (
                <button
                  onClick={async () => {
                    const res = await onToggleStatus(detailCustomer.id, 'active');
                    if (res && res.success === false) {
                      showToast(res.message || 'Gagal mengubah status di database.');
                      return;
                    }
                    setDetailCustomer({ ...detailCustomer, status: 'active' });
                    showToast(`Status pelanggan ${detailCustomer.name} diubah menjadi Aktif`);
                  }}
                  className="px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-200 text-xs font-semibold hover:bg-emerald-100"
                >
                  Aktifkan Layanan
                </button>
              )}

              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    const target = detailCustomer;
                    setDetailCustomer(null);
                    handleOpenEditModal(target);
                  }}
                  className="px-3.5 py-1.5 rounded-lg bg-slate-800 text-white text-xs font-semibold hover:bg-slate-900 flex items-center gap-1.5 shadow-xs"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                  <span>Edit</span>
                </button>
                <button
                  onClick={() => setDetailCustomer(null)}
                  className="px-4 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold"
                >
                  Tutup
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: TAMBAH PELANGGAN BARU (DENGAN VALIDASI) */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-xl w-full p-6 shadow-2xl border border-slate-200 relative my-8 animate-in fade-in duration-150">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div>
                <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <UserPlus className="w-5 h-5 text-blue-600" />
                  Tambah Pelanggan Baru
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  ID pelanggan dibuat secara otomatis dan unik oleh sistem
                </p>
              </div>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmitAdd} className="py-4 space-y-4 text-xs">
              {/* Auto ID Display */}
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 flex items-center justify-between">
                <div>
                  <span className="text-[11px] font-semibold text-slate-500 block">
                    ID Pelanggan (Otomatis & Unik)
                  </span>
                  <span className="font-mono font-bold text-base text-blue-700">{formId}</span>
                </div>
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded bg-blue-100 text-blue-800">
                  <Hash className="w-3 h-3" />
                  Auto Generated
                </span>
              </div>

              {/* Nama Pelanggan */}
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Nama Lengkap Pelanggan <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => {
                    setFormName(e.target.value);
                    if (formErrors.name) setFormErrors({ ...formErrors, name: undefined });
                  }}
                  placeholder="Contoh: Budi Santoso"
                  className={`w-full px-3 py-2 rounded-lg border text-xs sm:text-sm transition-all ${
                    formErrors.name
                      ? 'border-rose-400 ring-2 ring-rose-200 bg-rose-50/30'
                      : 'border-slate-200 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500'
                  }`}
                />
                {formErrors.name && (
                  <p className="text-rose-600 text-[11px] mt-1 font-medium flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    {formErrors.name}
                  </p>
                )}
              </div>

              {/* Nomor WhatsApp & Jenis Koneksi */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Nomor WhatsApp / HP <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formPhone}
                    onChange={(e) => {
                      setFormPhone(e.target.value);
                      if (formErrors.phone) setFormErrors({ ...formErrors, phone: undefined });
                    }}
                    placeholder="Contoh: 081234567890"
                    className={`w-full px-3 py-2 rounded-lg border text-xs sm:text-sm transition-all ${
                      formErrors.phone
                        ? 'border-rose-400 ring-2 ring-rose-200 bg-rose-50/30'
                        : 'border-slate-200 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500'
                    }`}
                  />
                  {formErrors.phone && (
                    <p className="text-rose-600 text-[11px] mt-1 font-medium flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" />
                      {formErrors.phone}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Jenis Koneksi <span className="text-rose-500">*</span>
                  </label>
                  <select
                    value={formType}
                    onChange={(e) => setFormType(e.target.value as CustomerType)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white font-medium focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  >
                    <option value="pppoe">PPPoE (Rumahan / Kabel)</option>
                    <option value="hotspot">Hotspot (Voucher / Wireless)</option>
                  </select>
                </div>
              </div>

              {/* Username Koneksi & Password Akun */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Username Koneksi <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formUsername}
                    onChange={(e) => {
                      setFormUsername(e.target.value);
                      if (formErrors.username)
                        setFormErrors({ ...formErrors, username: undefined });
                    }}
                    placeholder="Contoh: budi_rt01"
                    className={`w-full px-3 py-2 rounded-lg border font-mono text-xs transition-all ${
                      formErrors.username
                        ? 'border-rose-400 ring-2 ring-rose-200 bg-rose-50/30'
                        : 'border-slate-200 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500'
                    }`}
                  />
                  {formErrors.username ? (
                    <p className="text-rose-600 text-[11px] mt-1 font-medium flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" />
                      {formErrors.username}
                    </p>
                  ) : (
                    <span className="text-[10px] text-slate-400 block mt-1">
                      Akun login PPPoE / voucher Hotspot
                    </span>
                  )}
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Password Akun <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={formPassword}
                      onChange={(e) => {
                        setFormPassword(e.target.value);
                        if (formErrors.password)
                          setFormErrors({ ...formErrors, password: undefined });
                      }}
                      placeholder="Minimal 6 karakter"
                      className={`w-full px-3 py-2 pr-10 rounded-lg border font-mono text-xs transition-all ${
                        formErrors.password
                          ? 'border-rose-400 ring-2 ring-rose-200 bg-rose-50/30'
                          : 'border-slate-200 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500'
                      }`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
                      title={showPassword ? 'Sembunyikan' : 'Tampilkan'}
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  {formErrors.password ? (
                    <p className="text-rose-600 text-[11px] mt-1 font-medium flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" />
                      {formErrors.password}
                    </p>
                  ) : (
                    <span className="text-[10px] text-slate-400 block mt-1">
                      Dienkripsi AES-256-GCM (tidak disimpan plaintext)
                    </span>
                  )}
                </div>
              </div>

              {/* Alamat IP (Opsional) */}
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Alamat IP (Opsional)
                </label>
                <input
                  type="text"
                  value={formIpAddress}
                  onChange={(e) => setFormIpAddress(e.target.value)}
                  placeholder={formType === 'pppoe' ? '192.168.10.x' : '10.20.0.x'}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 font-mono text-xs focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
                <span className="text-[10px] text-slate-400 block mt-1">
                  Otomatis dialokasikan pool router jika kosong
                </span>
              </div>

              {/* Paket Internet & Tanggal Pasang */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Paket Internet <span className="text-rose-500">*</span>
                  </label>
                  <select
                    value={formPackageId}
                    onChange={(e) => {
                      setFormPackageId(e.target.value);
                      if (formErrors.packageId)
                        setFormErrors({ ...formErrors, packageId: undefined });
                    }}
                    className={`w-full px-3 py-2 rounded-lg border bg-white font-medium ${
                      formErrors.packageId ? 'border-rose-400' : 'border-slate-200'
                    }`}
                  >
                    {packages.map((pkg) => (
                      <option key={pkg.id} value={pkg.id}>
                        {pkg.name} ({pkg.speed} - {formatRupiah(pkg.price)})
                        {pkg.status === 'inactive' ? ' [Nonaktif]' : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Tanggal Pemasangan <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="date"
                    value={formRegisteredAt}
                    onChange={(e) => {
                      setFormRegisteredAt(e.target.value);
                      if (formErrors.registeredAt)
                        setFormErrors({ ...formErrors, registeredAt: undefined });
                    }}
                    className={`w-full px-3 py-2 rounded-lg border ${
                      formErrors.registeredAt ? 'border-rose-400' : 'border-slate-200'
                    }`}
                  />
                  {formErrors.registeredAt && (
                    <p className="text-rose-600 text-[11px] mt-1 font-medium">
                      {formErrors.registeredAt}
                    </p>
                  )}
                </div>
              </div>

              {/* Status & Jatuh Tempo */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Status Pelanggan
                  </label>
                  <select
                    value={formStatus}
                    onChange={(e) => setFormStatus(e.target.value as CustomerStatus)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white font-medium"
                  >
                    <option value="active">Aktif (Layanan Berjalan)</option>
                    <option value="isolated">Isolir (Blokir Akses)</option>
                    <option value="inactive">Nonaktif</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Tanggal Jatuh Tempo Bulanan
                  </label>
                  <select
                    value={formDueDateDay}
                    onChange={(e) => setFormDueDateDay(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white font-medium"
                  >
                    {[1, 5, 10, 15, 20, 25, 28].map((day) => (
                      <option key={day} value={day}>
                        Setiap Tanggal {day}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Alamat KTP / Domisili */}
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Alamat KTP / Domisili <span className="text-rose-500">*</span>
                </label>
                <textarea
                  rows={2}
                  value={formAddress}
                  onChange={(e) => {
                    setFormAddress(e.target.value);
                    if (formErrors.address) setFormErrors({ ...formErrors, address: undefined });
                  }}
                  placeholder="Contoh: Gang Cendrawasih No. 12, RT 02 / RW 04"
                  className={`w-full px-3 py-2 rounded-lg border transition-all ${
                    formErrors.address
                      ? 'border-rose-400 ring-2 ring-rose-200 bg-rose-50/30'
                      : 'border-slate-200 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500'
                  }`}
                />
                {formErrors.address && (
                  <p className="text-rose-600 text-[11px] mt-1 font-medium flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    {formErrors.address}
                  </p>
                )}
              </div>

              {/* Alamat Pemasangan Fisik */}
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Alamat Pemasangan Fisik (Jika Berbeda / Patokan Rumah)
                </label>
                <input
                  type="text"
                  value={formInstallationAddress}
                  onChange={(e) => setFormInstallationAddress(e.target.value)}
                  placeholder="Contoh: Samping Pos Ronda RW 04 (Rumah pagar hitam)"
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
              </div>

              {/* Titik Koordinat Peta (Latitude & Longitude) */}
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/90 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-800 text-[11px] flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-blue-600" />
                    <span>Titik Koordinat Lokasi Peta (Opsional)</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setLocationPickerContext({
                        lat: formLatitude !== '' ? Number(formLatitude) : undefined,
                        lng: formLongitude !== '' ? Number(formLongitude) : undefined,
                        address: formInstallationAddress || formAddress,
                        customerName: formName || 'Pelanggan Baru',
                        onSave: (coords) => {
                          setFormLatitude(coords.latitude);
                          setFormLongitude(coords.longitude);
                        },
                      });
                      setIsLocationPickerOpen(true);
                    }}
                    className="px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold text-[11px] flex items-center gap-1 shadow-xs transition-colors"
                  >
                    <Compass className="w-3.5 h-3.5" />
                    <span>Pilih di Peta</span>
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] uppercase font-semibold text-slate-500 block mb-0.5">Latitude</label>
                    <input
                      type="number"
                      step="any"
                      value={formLatitude}
                      onChange={(e) => setFormLatitude(e.target.value === '' ? '' : parseFloat(e.target.value))}
                      placeholder="-6.4825"
                      className="w-full font-mono text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] uppercase font-semibold text-slate-500 block mb-0.5">Longitude</label>
                    <input
                      type="number"
                      step="any"
                      value={formLongitude}
                      onChange={(e) => setFormLongitude(e.target.value === '' ? '' : parseFloat(e.target.value))}
                      placeholder="106.8535"
                      className="w-full font-mono text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white"
                    />
                  </div>
                </div>
              </div>

              {/* Buttons */}
              <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold shadow-xs flex items-center gap-1.5"
                >
                  <Check className="w-4 h-4" />
                  <span>Simpan Pelanggan</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: EDIT PELANGGAN (DENGAN VALIDASI) */}
      {editingCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-xl w-full p-6 shadow-2xl border border-slate-200 relative my-8 animate-in fade-in duration-150">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div>
                <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <Edit2 className="w-5 h-5 text-amber-600" />
                  Edit Pelanggan ({editingCustomer.id})
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Perbarui data pelanggan yang telah terdaftar
                </p>
              </div>
              <button
                onClick={() => setEditingCustomer(null)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmitEdit} className="py-4 space-y-4 text-xs">
              {/* ID Readonly */}
              <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-200 flex items-center justify-between">
                <span className="text-slate-500 font-medium">ID Pelanggan (Permanen):</span>
                <span className="font-mono font-bold text-slate-900 text-sm">{formId}</span>
              </div>

              {/* Nama Pelanggan */}
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Nama Lengkap Pelanggan <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => {
                    setFormName(e.target.value);
                    if (formErrors.name) setFormErrors({ ...formErrors, name: undefined });
                  }}
                  className={`w-full px-3 py-2 rounded-lg border text-xs sm:text-sm ${
                    formErrors.name ? 'border-rose-400 ring-2 ring-rose-200' : 'border-slate-200'
                  }`}
                />
                {formErrors.name && (
                  <p className="text-rose-600 text-[11px] mt-1 font-medium">{formErrors.name}</p>
                )}
              </div>

              {/* Nomor WhatsApp & Jenis Koneksi */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Nomor WhatsApp / HP <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formPhone}
                    onChange={(e) => {
                      setFormPhone(e.target.value);
                      if (formErrors.phone) setFormErrors({ ...formErrors, phone: undefined });
                    }}
                    className={`w-full px-3 py-2 rounded-lg border text-xs sm:text-sm ${
                      formErrors.phone ? 'border-rose-400 ring-2 ring-rose-200' : 'border-slate-200'
                    }`}
                  />
                  {formErrors.phone && (
                    <p className="text-rose-600 text-[11px] mt-1 font-medium">{formErrors.phone}</p>
                  )}
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Jenis Koneksi</label>
                  <select
                    value={formType}
                    onChange={(e) => setFormType(e.target.value as CustomerType)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white font-medium"
                  >
                    <option value="pppoe">PPPoE (Rumahan / Kabel)</option>
                    <option value="hotspot">Hotspot (Voucher / Wireless)</option>
                  </select>
                </div>
              </div>

              {/* Username Koneksi & Password Akun (Opsional) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Username Koneksi <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formUsername}
                    onChange={(e) => {
                      setFormUsername(e.target.value);
                      if (formErrors.username)
                        setFormErrors({ ...formErrors, username: undefined });
                    }}
                    className={`w-full px-3 py-2 rounded-lg border font-mono text-xs ${
                      formErrors.username ? 'border-rose-400 ring-2 ring-rose-200' : 'border-slate-200'
                    }`}
                  />
                  {formErrors.username && (
                    <p className="text-rose-600 text-[11px] mt-1 font-medium">
                      {formErrors.username}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Password Akun Baru (Opsional)
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={formPassword}
                      onChange={(e) => {
                        setFormPassword(e.target.value);
                        if (formErrors.password)
                          setFormErrors({ ...formErrors, password: undefined });
                      }}
                      placeholder="Kosongkan jika tidak diubah"
                      className={`w-full px-3 py-2 pr-10 rounded-lg border font-mono text-xs transition-all ${
                        formErrors.password
                          ? 'border-rose-400 ring-2 ring-rose-200 bg-rose-50/30'
                          : 'border-slate-200 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500'
                      }`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
                      title={showPassword ? 'Sembunyikan' : 'Tampilkan'}
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  {formErrors.password ? (
                    <p className="text-rose-600 text-[11px] mt-1 font-medium flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" />
                      {formErrors.password}
                    </p>
                  ) : (
                    <span className="text-[10px] text-slate-400 block mt-1">
                      Biarkan kosong jika tidak ingin mengubah password di database & router
                    </span>
                  )}
                </div>
              </div>

              {/* Alamat IP (Opsional) */}
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Alamat IP (Opsional)</label>
                <input
                  type="text"
                  value={formIpAddress}
                  onChange={(e) => setFormIpAddress(e.target.value)}
                  placeholder={formType === 'pppoe' ? '192.168.10.x' : '10.20.0.x'}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 font-mono text-xs"
                />
              </div>

              {/* Paket Internet & Tanggal Pasang */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Paket Internet</label>
                  <select
                    value={formPackageId}
                    onChange={(e) => setFormPackageId(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white font-medium"
                  >
                    {packages.map((pkg) => (
                      <option key={pkg.id} value={pkg.id}>
                        {pkg.name} ({pkg.speed} - {formatRupiah(pkg.price)})
                        {pkg.status === 'inactive' ? ' [Nonaktif]' : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Tanggal Pemasangan <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="date"
                    value={formRegisteredAt}
                    onChange={(e) => setFormRegisteredAt(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200"
                  />
                </div>
              </div>

              {/* Status & Jatuh Tempo */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Status Pelanggan
                  </label>
                  <select
                    value={formStatus}
                    onChange={(e) => setFormStatus(e.target.value as CustomerStatus)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white font-medium"
                  >
                    <option value="active">Aktif</option>
                    <option value="isolated">Isolir</option>
                    <option value="inactive">Nonaktif</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Tanggal Jatuh Tempo
                  </label>
                  <select
                    value={formDueDateDay}
                    onChange={(e) => setFormDueDateDay(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white font-medium"
                  >
                    {[1, 5, 10, 15, 20, 25, 28].map((day) => (
                      <option key={day} value={day}>
                        Setiap Tanggal {day}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Alamat KTP / Domisili */}
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Alamat KTP / Domisili <span className="text-rose-500">*</span>
                </label>
                <textarea
                  rows={2}
                  value={formAddress}
                  onChange={(e) => {
                    setFormAddress(e.target.value);
                    if (formErrors.address) setFormErrors({ ...formErrors, address: undefined });
                  }}
                  className={`w-full px-3 py-2 rounded-lg border ${
                    formErrors.address ? 'border-rose-400 ring-2 ring-rose-200' : 'border-slate-200'
                  }`}
                />
                {formErrors.address && (
                  <p className="text-rose-600 text-[11px] mt-1 font-medium">
                    {formErrors.address}
                  </p>
                )}
              </div>

              {/* Alamat Pemasangan Fisik */}
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Alamat Pemasangan Fisik (Patokan Rumah)
                </label>
                <input
                  type="text"
                  value={formInstallationAddress}
                  onChange={(e) => setFormInstallationAddress(e.target.value)}
                  placeholder="Contoh: Samping Pos Ronda RW 04"
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
              </div>

              {/* Titik Koordinat Peta (Latitude & Longitude) */}
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/90 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-800 text-[11px] flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-blue-600" />
                    <span>Titik Koordinat Lokasi Peta (Opsional)</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setLocationPickerContext({
                        lat: formLatitude !== '' ? Number(formLatitude) : undefined,
                        lng: formLongitude !== '' ? Number(formLongitude) : undefined,
                        address: formInstallationAddress || formAddress,
                        customerName: formName,
                        onSave: (coords) => {
                          setFormLatitude(coords.latitude);
                          setFormLongitude(coords.longitude);
                        },
                      });
                      setIsLocationPickerOpen(true);
                    }}
                    className="px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold text-[11px] flex items-center gap-1 shadow-xs transition-colors"
                  >
                    <Compass className="w-3.5 h-3.5" />
                    <span>Pilih di Peta</span>
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] uppercase font-semibold text-slate-500 block mb-0.5">Latitude</label>
                    <input
                      type="number"
                      step="any"
                      value={formLatitude}
                      onChange={(e) => setFormLatitude(e.target.value === '' ? '' : parseFloat(e.target.value))}
                      placeholder="-6.4825"
                      className="w-full font-mono text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] uppercase font-semibold text-slate-500 block mb-0.5">Longitude</label>
                    <input
                      type="number"
                      step="any"
                      value={formLongitude}
                      onChange={(e) => setFormLongitude(e.target.value === '' ? '' : parseFloat(e.target.value))}
                      placeholder="106.8535"
                      className="w-full font-mono text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white"
                    />
                  </div>
                </div>
              </div>

              {/* Buttons */}
              <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setEditingCustomer(null)}
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

      {/* MODAL 4: KONFIRMASI HAPUS PELANGGAN */}
      {customerToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 relative">
            <div className="w-12 h-12 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center mb-4">
              <ShieldAlert className="w-6 h-6" />
            </div>

            <h3 className="text-base font-bold text-slate-900">Konfirmasi Hapus Pelanggan</h3>
            <p className="text-xs text-slate-500 mt-1">
              Apakah Anda yakin ingin menghapus data pelanggan berikut dari sesi aktif?
            </p>

            <div className="mt-3 p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-1.5">
              <div className="flex justify-between">
                <span className="text-slate-500">ID Pelanggan:</span>
                <span className="font-mono font-bold text-slate-800">{customerToDelete.id}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Nama:</span>
                <span className="font-bold text-slate-900">{customerToDelete.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Username:</span>
                <span className="font-mono text-slate-700">{customerToDelete.username}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Paket:</span>
                <span className="text-slate-800">{customerToDelete.packageName}</span>
              </div>
            </div>

            <div className="mt-4 p-2.5 rounded-lg bg-amber-50 text-amber-800 text-[11px] leading-relaxed border border-amber-200">
              <strong>Pemberitahuan:</strong> Penghapusan ini langsung mempengaruhi tabel dan
              jumlah pelanggan aktif.
            </div>

            <div className="pt-4 mt-2 border-t border-slate-100 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setCustomerToDelete(null)}
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
                <span>Ya, Hapus Pelanggan</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 5: EXPORT PELANGGAN */}
      {isExportOpen && (
        <CustomerExportModal
          customers={customers}
          packages={packages}
          onClose={() => setIsExportOpen(false)}
        />
      )}

      {/* MODAL 6: IMPORT PELANGGAN */}
      {isImportOpen && (
        <CustomerImportModal
          existingCustomers={customers}
          packages={packages}
          onImportSuccess={(imported) => {
            imported.forEach((c) => onAddCustomer(c));
            showToast(`${imported.length} pelanggan baru berhasil diimpor ke sistem!`);
          }}
          onClose={() => setIsImportOpen(false)}
        />
      )}

      {/* MODAL 7: PETA PERSEBARAN PELANGGAN */}
      {isDistributionMapOpen && (
        <CustomerDistributionMapModal
          customers={customers}
          focusCustomerId={focusedMapCustomerId}
          onClose={() => {
            setIsDistributionMapOpen(false);
            setFocusedMapCustomerId(undefined);
          }}
          onSetLocationForCustomer={(cust) => {
            setLocationPickerContext({
              lat: cust.latitude,
              lng: cust.longitude,
              address: cust.installationAddress || cust.address,
              customerName: cust.name,
              onSave: (coords) => {
                const updated = { ...cust, latitude: coords.latitude, longitude: coords.longitude };
                onEditCustomer(updated);
                showToast(`Titik koordinat untuk ${cust.name} berhasil disimpan!`);
              },
            });
            setIsLocationPickerOpen(true);
          }}
          onSelectCustomerDetail={(cust) => {
            setIsDistributionMapOpen(false);
            setDetailCustomer(cust);
          }}
        />
      )}

      {/* MODAL 8: LOCATION PICKER MAP */}
      {isLocationPickerOpen && locationPickerContext && (
        <LocationPickerModal
          initialLat={locationPickerContext.lat}
          initialLng={locationPickerContext.lng}
          initialAddress={locationPickerContext.address}
          customerName={locationPickerContext.customerName}
          onSave={locationPickerContext.onSave}
          onClose={() => {
            setIsLocationPickerOpen(false);
            setLocationPickerContext(null);
          }}
        />
      )}
    </div>
  );
};
