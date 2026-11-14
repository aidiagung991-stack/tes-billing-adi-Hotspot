import React, { useState, useMemo } from 'react';
import {
  Wifi,
  Plus,
  Search,
  Filter,
  Eye,
  Edit2,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  X,
  Tag,
  Users,
  Database,
  RotateCcw,
  ShieldAlert,
  ArrowDownUp,
  Activity,
  Layers,
  Check,
  Zap,
} from 'lucide-react';
import {
  InternetPackage,
  PackageConnectionType,
  PackageStatus,
  Customer,
} from '../types/index.ts';
import {
  formatRupiah,
  getPackageStatusBadge,
  getPackageConnectionBadge,
} from '../utils/formatters.ts';
import { generateUniquePackageCode } from '../utils/packageStorage.ts';

interface PackagesViewProps {
  packages: InternetPackage[];
  customers: Customer[];
  onAddPackage: (pkg: InternetPackage) => Promise<{ success: boolean; message?: string }> | { success: boolean; message?: string } | void;
  onEditPackage: (pkg: InternetPackage) => Promise<{ success: boolean; message?: string }> | { success: boolean; message?: string } | void;
  onDeletePackage: (packageId: string) => Promise<{ success: boolean; message?: string }> | { success: boolean; message?: string } | void;
}

interface PackageFormErrors {
  name?: string;
  code?: string;
  speed?: string;
  price?: string;
}

export const PackagesView: React.FC<PackagesViewProps> = ({
  packages,
  customers,
  onAddPackage,
  onEditPackage,
  onDeletePackage,
}) => {
  // Search & Filter
  const [searchQuery, setSearchQuery] = useState('');
  const [connectionFilter, setConnectionFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // Modals
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingPackage, setEditingPackage] = useState<InternetPackage | null>(null);
  const [detailPackage, setDetailPackage] = useState<InternetPackage | null>(null);
  const [packageToDelete, setPackageToDelete] = useState<InternetPackage | null>(null);

  // Toast Notification
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 3500);
  };

  // Form States
  const [formCode, setFormCode] = useState('');
  const [formName, setFormName] = useState('');
  const [formSpeed, setFormSpeed] = useState('10 Mbps');
  const [formDownloadSpeed, setFormDownloadSpeed] = useState('10 Mbps');
  const [formUploadSpeed, setFormUploadSpeed] = useState('5 Mbps');
  const [formPrice, setFormPrice] = useState<number | string>(100000);
  const [formDuration, setFormDuration] = useState('1 Bulan');
  const [formConnection, setFormConnection] = useState<PackageConnectionType>('pppoe');
  const [formPppoeProfile, setFormPppoeProfile] = useState('');
  const [formHotspotProfile, setFormHotspotProfile] = useState('');
  const [formStatus, setFormStatus] = useState<PackageStatus>('active');
  const [formDescription, setFormDescription] = useState('');
  const [formErrors, setFormErrors] = useState<PackageFormErrors>({});

  // Helper to calculate how many customers currently use a package
  const getSubscribersForPackage = (pkgId: string): Customer[] => {
    return customers.filter((c) => c.packageId === pkgId);
  };

  // Open Add Modal
  const handleOpenAddModal = () => {
    const suggestedCode = generateUniquePackageCode('10 Mbps', packages);
    setFormCode(suggestedCode);
    setFormName('');
    setFormSpeed('10 Mbps');
    setFormDownloadSpeed('10 Mbps');
    setFormUploadSpeed('5 Mbps');
    setFormPrice(100000);
    setFormDuration('1 Bulan');
    setFormConnection('pppoe');
    setFormPppoeProfile('');
    setFormHotspotProfile('');
    setFormStatus('active');
    setFormDescription('');
    setFormErrors({});
    setIsAddOpen(true);
  };

  // Open Edit Modal
  const handleOpenEditModal = (pkg: InternetPackage) => {
    setEditingPackage(pkg);
    setFormCode(pkg.code);
    setFormName(pkg.name);
    setFormSpeed(pkg.speed);
    setFormDownloadSpeed(pkg.downloadSpeed || pkg.speed);
    setFormUploadSpeed(pkg.uploadSpeed || '5 Mbps');
    setFormPrice(pkg.price);
    setFormDuration(pkg.duration || '1 Bulan');
    setFormConnection(pkg.supportedConnection || (pkg.type as any) || 'pppoe');
    setFormPppoeProfile(pkg.pppoeProfile || '');
    setFormHotspotProfile(pkg.hotspotProfile || '');
    setFormStatus(pkg.status || 'active');
    setFormDescription(pkg.description || '');
    setFormErrors({});
  };

  // Form Validation
  const validateForm = (isEditing: boolean, currentId?: string): boolean => {
    const errors: PackageFormErrors = {};

    // 1. Nama Paket
    if (!formName.trim()) {
      errors.name = 'Nama paket wajib diisi';
    } else if (formName.trim().length < 3) {
      errors.name = 'Nama paket minimal 3 karakter';
    }

    // 2. Kode Paket
    const cleanCode = formCode.trim().toUpperCase();
    if (!cleanCode) {
      errors.code = 'Kode paket wajib diisi';
    } else {
      const codeExists = packages.some((p) => {
        if (isEditing && currentId && p.id === currentId) {
          return false;
        }
        return p.code.toUpperCase() === cleanCode;
      });
      if (codeExists) {
        errors.code = 'Kode paket ini sudah digunakan paket lain';
      }
    }

    // 3. Kecepatan Internet
    if (!formSpeed.trim()) {
      errors.speed = 'Kecepatan internet wajib diisi (contoh: 10 Mbps)';
    }

    // 4. Harga Bulanan
    const numPrice = Number(formPrice);
    if (formPrice === '' || isNaN(numPrice)) {
      errors.price = 'Harga bulanan wajib diisi dengan angka';
    } else if (numPrice < 0) {
      errors.price = 'Harga tidak boleh bernilai negatif';
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // Submit Add Package
  const handleSubmitAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm(false)) return;

    const newId = `pkg-${Date.now().toString().slice(-6)}`;
    const newPackage: InternetPackage = {
      id: newId,
      code: formCode.trim().toUpperCase(),
      name: formName.trim(),
      speed: formSpeed.trim(),
      downloadSpeed: formDownloadSpeed.trim() || formSpeed.trim(),
      uploadSpeed: formUploadSpeed.trim() || '5 Mbps',
      price: Number(formPrice),
      duration: formDuration.trim() || '1 Bulan',
      type: formConnection === 'hotspot' ? 'hotspot' : 'pppoe',
      supportedConnection: formConnection,
      pppoeProfile: formPppoeProfile.trim() || undefined,
      hotspotProfile: formHotspotProfile.trim() || undefined,
      status: formStatus,
      activeUsersCount: 0,
      description:
        formDescription.trim() ||
        `Paket internet ${formSpeed.trim()} untuk layanan ${formConnection.toUpperCase()}`,
    };

    try {
      const res = await onAddPackage(newPackage);
      if (res && res.success === false) {
        setFormErrors({ name: res.message || 'Gagal menyimpan paket ke database.' });
        return;
      }
      setIsAddOpen(false);
      showToast(`Paket "${newPackage.name}" (${newPackage.code}) berhasil ditambahkan!`);
    } catch (err: any) {
      setFormErrors({ name: err?.message || 'Terjadi kesalahan sistem saat menghubungi database.' });
    }
  };

  // Submit Edit Package
  const handleSubmitEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPackage) return;
    if (!validateForm(true, editingPackage.id)) return;

    const currentSubscribers = getSubscribersForPackage(editingPackage.id);

    const updatedPackage: InternetPackage = {
      ...editingPackage,
      code: formCode.trim().toUpperCase(),
      name: formName.trim(),
      speed: formSpeed.trim(),
      downloadSpeed: formDownloadSpeed.trim() || formSpeed.trim(),
      uploadSpeed: formUploadSpeed.trim() || '5 Mbps',
      price: Number(formPrice),
      duration: formDuration.trim() || '1 Bulan',
      type: formConnection === 'hotspot' ? 'hotspot' : 'pppoe',
      supportedConnection: formConnection,
      pppoeProfile: formPppoeProfile.trim() || undefined,
      hotspotProfile: formHotspotProfile.trim() || undefined,
      status: formStatus,
      activeUsersCount: currentSubscribers.length,
      description: formDescription.trim(),
    };

    try {
      const res = await onEditPackage(updatedPackage);
      if (res && res.success === false) {
        setFormErrors({ name: res.message || 'Gagal memperbarui paket di database.' });
        return;
      }
      setEditingPackage(null);
      showToast(`Paket "${updatedPackage.name}" berhasil diperbarui!`);
    } catch (err: any) {
      setFormErrors({ name: err?.message || 'Terjadi kesalahan sistem saat menghubungi database.' });
    }
  };

  // Confirm Delete Handler (with safety check)
  const handleConfirmDelete = async () => {
    if (!packageToDelete) return;
    const subscribers = getSubscribersForPackage(packageToDelete.id);

    // Safety enforcement: Prevent deletion if any customer uses this package
    if (subscribers.length > 0) {
      alert(
        `Penghapusan ditolak: Paket "${packageToDelete.name}" sedang digunakan oleh ${subscribers.length} pelanggan.`
      );
      return;
    }

    const deletedName = packageToDelete.name;
    const deletedCode = packageToDelete.code;

    try {
      const res = await onDeletePackage(packageToDelete.id);
      if (res && res.success === false) {
        showToast(res.message || 'Gagal menghapus paket dari database.');
        return;
      }
      setPackageToDelete(null);
      showToast(`Paket "${deletedName}" (${deletedCode}) berhasil dihapus.`);
    } catch (err: any) {
      showToast(err?.message || 'Terjadi kesalahan sistem saat menghubungi database.');
    }
  };

  // Filtered packages
  const filteredPackages = useMemo(() => {
    return packages.filter((pkg) => {
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !q ||
        pkg.name.toLowerCase().includes(q) ||
        pkg.code.toLowerCase().includes(q) ||
        pkg.speed.toLowerCase().includes(q);

      const matchesConnection =
        connectionFilter === 'all' ||
        pkg.supportedConnection === connectionFilter ||
        (connectionFilter === 'pppoe' && pkg.type === 'pppoe') ||
        (connectionFilter === 'hotspot' && pkg.type === 'hotspot');

      const matchesStatus = statusFilter === 'all' || pkg.status === statusFilter;

      return matchesSearch && matchesConnection && matchesStatus;
    });
  }, [packages, searchQuery, connectionFilter, statusFilter]);

  const hasActiveFilters =
    searchQuery.trim() !== '' || connectionFilter !== 'all' || statusFilter !== 'all';

  const handleResetFilters = () => {
    setSearchQuery('');
    setConnectionFilter('all');
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
                Manajemen Paket Internet (Database PostgreSQL)
              </strong>
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-200">
                adi_hotspot
              </span>
            </div>
            <p className="text-blue-800/90 text-[11px] mt-0.5">
              Data paket internet tersimpan langsung di database PostgreSQL. Anda dapat menambah,
              mengedit, dan mengatur paket secara terpusat. Paket terlindungi dari penghapusan tidak
              disengaja jika masih digunakan oleh pelanggan aktif.
            </p>
          </div>
        </div>
        <div className="text-[11px] font-semibold text-blue-700 bg-white px-2.5 py-1 rounded-lg border border-blue-200 shrink-0">
          Total: {packages.length} Paket Terdaftar
        </div>
      </div>

      {/* Search, Filter & Action Toolbar */}
      <div className="bg-white rounded-xl p-4 border border-slate-200/90 shadow-xs space-y-3">
        <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
          {/* Search by name or package code */}
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari berdasarkan nama paket atau kode paket (contoh: PKT-10M, Home Basic)..."
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

          {/* Add Package Button */}
          <button
            onClick={handleOpenAddModal}
            className="px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs sm:text-sm font-semibold flex items-center justify-center gap-2 transition-colors shadow-xs shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>Tambah Paket</span>
          </button>
        </div>

        {/* Filters Row */}
        <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2.5 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 text-slate-500 font-semibold text-[11px] uppercase tracking-wider mr-1">
              <Filter className="w-3.5 h-3.5 text-slate-400" />
              <span>Filter:</span>
            </div>

            {/* Filter Connection Type */}
            <select
              value={connectionFilter}
              onChange={(e) => setConnectionFilter(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-slate-700 font-medium focus:ring-1 focus:ring-blue-500"
            >
              <option value="all">Semua Jenis Koneksi</option>
              <option value="pppoe">PPPoE Saja</option>
              <option value="hotspot">Hotspot Saja</option>
              <option value="both">PPPoE & Hotspot (Keduanya)</option>
            </select>

            {/* Filter Status */}
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-slate-700 font-medium focus:ring-1 focus:ring-blue-500"
            >
              <option value="all">Semua Status</option>
              <option value="active">Aktif</option>
              <option value="inactive">Nonaktif</option>
            </select>

            {/* Reset Filters */}
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
            Menampilkan <strong className="text-slate-800">{filteredPackages.length}</strong> dari{' '}
            {packages.length} paket
          </div>
        </div>
      </div>

      {/* Package Table View */}
      <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs sm:text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold text-[11px] uppercase tracking-wider">
              <tr>
                <th className="px-3.5 py-3.5 whitespace-nowrap">Kode Paket</th>
                <th className="px-3.5 py-3.5 whitespace-nowrap">Nama Paket</th>
                <th className="px-3.5 py-3.5 whitespace-nowrap">Kecepatan</th>
                <th className="px-3.5 py-3.5 whitespace-nowrap">Harga Bulanan</th>
                <th className="px-3.5 py-3.5 whitespace-nowrap">Jenis Koneksi</th>
                <th className="px-3.5 py-3.5 whitespace-nowrap">Pelanggan Aktif</th>
                <th className="px-3.5 py-3.5 whitespace-nowrap">Status</th>
                <th className="px-3.5 py-3.5 whitespace-nowrap">Deskripsi</th>
                <th className="px-3.5 py-3.5 text-right whitespace-nowrap">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredPackages.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center py-12 px-4 text-slate-500">
                    <div className="max-w-xs mx-auto">
                      <Wifi className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                      <p className="font-semibold text-slate-700 text-sm">
                        Tidak ada paket yang sesuai
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
                filteredPackages.map((pkg) => {
                  const statusBadge = getPackageStatusBadge(pkg.status || 'active');
                  const connBadge = getPackageConnectionBadge(
                    pkg.supportedConnection || (pkg.type as any) || 'pppoe'
                  );
                  const currentSubscribers = getSubscribersForPackage(pkg.id);
                  const subscriberCount = currentSubscribers.length;

                  return (
                    <tr key={pkg.id} className="hover:bg-slate-50/80 transition-colors">
                      {/* 1. Kode Paket */}
                      <td className="px-3.5 py-3.5 whitespace-nowrap font-mono font-bold text-slate-900 text-xs">
                        <span className="bg-slate-100 text-slate-800 px-2 py-1 rounded-md border border-slate-200">
                          {pkg.code}
                        </span>
                      </td>

                      {/* 2. Nama Paket */}
                      <td className="px-3.5 py-3.5 whitespace-nowrap">
                        <div className="font-bold text-slate-900">{pkg.name}</div>
                        <div className="text-[10px] text-slate-400 font-mono mt-0.5">ID: {pkg.id}</div>
                      </td>

                      {/* 3. Kecepatan */}
                      <td className="px-3.5 py-3.5 whitespace-nowrap">
                        <div className="flex items-center gap-1 font-bold text-slate-800">
                          <Zap className="w-3.5 h-3.5 text-amber-500" />
                          <span>{pkg.speed}</span>
                        </div>
                        <div className="text-[11px] text-slate-500 mt-0.5">
                          DL: {pkg.downloadSpeed || pkg.speed} | UL: {pkg.uploadSpeed || '5 Mbps'}
                        </div>
                      </td>

                      {/* 4. Harga Bulanan */}
                      <td className="px-3.5 py-3.5 whitespace-nowrap">
                        <span className="font-extrabold text-slate-900 text-sm">
                          {formatRupiah(pkg.price)}
                        </span>
                        <span className="text-[11px] text-slate-400 block font-normal">
                          / {pkg.duration || '1 Bulan'}
                        </span>
                      </td>

                      {/* 5. Jenis Koneksi & Profile MikroTik */}
                      <td className="px-3.5 py-3.5 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded border uppercase tracking-wider ${connBadge.bg}`}
                        >
                          <Wifi className="w-3 h-3" />
                          {connBadge.label}
                        </span>
                        <div className="mt-1 flex flex-col gap-0.5">
                          {pkg.pppoeProfile && (
                            <span className="text-[10px] font-mono font-semibold text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-200 inline-block w-fit">
                              PPP: {pkg.pppoeProfile}
                            </span>
                          )}
                          {pkg.hotspotProfile && (
                            <span className="text-[10px] font-mono font-semibold text-purple-700 bg-purple-50 px-1.5 py-0.5 rounded border border-purple-200 inline-block w-fit">
                              HS: {pkg.hotspotProfile}
                            </span>
                          )}
                          {!pkg.pppoeProfile && !pkg.hotspotProfile && (
                            <span className="text-[10px] text-amber-600 font-medium italic">
                              Profile belum diatur
                            </span>
                          )}
                        </div>
                      </td>

                      {/* 6. Pelanggan Aktif */}
                      <td className="px-3.5 py-3.5 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                            subscriberCount > 0
                              ? 'bg-blue-50 text-blue-700 border border-blue-200'
                              : 'bg-slate-100 text-slate-500'
                          }`}
                        >
                          <Users className="w-3.5 h-3.5" />
                          <span>{subscriberCount} Pelanggan</span>
                        </span>
                      </td>

                      {/* 7. Status */}
                      <td className="px-3.5 py-3.5 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${statusBadge.bg}`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${statusBadge.dot}`} />
                          {statusBadge.label}
                        </span>
                      </td>

                      {/* 8. Deskripsi */}
                      <td className="px-3.5 py-3.5 text-slate-600 max-w-xs truncate" title={pkg.description}>
                        <span className="truncate block text-xs">{pkg.description || '-'}</span>
                      </td>

                      {/* 9. Aksi: Detail, Edit, Hapus */}
                      <td className="px-3.5 py-3.5 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1">
                          {/* Detail Button */}
                          <button
                            onClick={() => setDetailPackage(pkg)}
                            className="p-1.5 rounded-lg text-slate-500 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                            title="Detail Paket & Pengguna"
                            aria-label="Detail"
                          >
                            <Eye className="w-4 h-4" />
                          </button>

                          {/* Edit Button */}
                          <button
                            onClick={() => handleOpenEditModal(pkg)}
                            className="p-1.5 rounded-lg text-slate-500 hover:text-amber-600 hover:bg-amber-50 transition-colors"
                            title="Edit Paket"
                            aria-label="Edit"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>

                          {/* Delete Button */}
                          <button
                            onClick={() => setPackageToDelete(pkg)}
                            className="p-1.5 rounded-lg text-slate-500 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                            title={
                              subscriberCount > 0
                                ? 'Paket sedang digunakan pelanggan (Penghapusan dicegah)'
                                : 'Hapus Paket'
                            }
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

      {/* MODAL 1: DETAIL PAKET */}
      {detailPackage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 relative">
            <div className="flex items-start justify-between pb-4 border-b border-slate-100">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-xs bg-slate-100 text-slate-800 px-2 py-0.5 rounded">
                    {detailPackage.code}
                  </span>
                  <h3 className="text-base font-bold text-slate-900">{detailPackage.name}</h3>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">ID Sistem: {detailPackage.id}</p>
              </div>
              <button
                onClick={() => setDetailPackage(null)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="py-4 space-y-4 text-xs">
              {/* Highlight Card */}
              <div className="grid grid-cols-2 gap-3 bg-slate-50 p-3.5 rounded-xl border border-slate-200/80">
                <div>
                  <span className="text-slate-400 block text-[11px] font-medium">Kecepatan Utama</span>
                  <span className="font-bold text-slate-800 text-sm flex items-center gap-1">
                    <Zap className="w-3.5 h-3.5 text-amber-500" />
                    {detailPackage.speed}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[11px] font-medium">Harga Bulanan</span>
                  <span className="font-bold text-emerald-600 text-sm">
                    {formatRupiah(detailPackage.price)} / {detailPackage.duration || '1 Bulan'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[11px] font-medium">Jenis Koneksi</span>
                  <span className="font-semibold text-slate-800 uppercase">
                    {getPackageConnectionBadge(
                      detailPackage.supportedConnection || (detailPackage.type as any) || 'pppoe'
                    ).label}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[11px] font-medium">Status Paket</span>
                  <span
                    className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-bold border mt-0.5 ${
                      getPackageStatusBadge(detailPackage.status || 'active').bg
                    }`}
                  >
                    {getPackageStatusBadge(detailPackage.status || 'active').label}
                  </span>
                </div>
              </div>

              {/* Bandwidth Limits */}
              <div className="grid grid-cols-2 gap-3 p-3 rounded-xl bg-slate-50 border border-slate-200/70">
                <div>
                  <span className="text-slate-400 block text-[10px] font-semibold uppercase">
                    Alokasi Download
                  </span>
                  <span className="font-bold text-slate-800 text-sm">
                    {detailPackage.downloadSpeed || detailPackage.speed}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] font-semibold uppercase">
                    Alokasi Upload
                  </span>
                  <span className="font-bold text-slate-800 text-sm">
                    {detailPackage.uploadSpeed || '5 Mbps'}
                  </span>
                </div>
              </div>

              {/* Pemetaan Profile MikroTik */}
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80">
                <span className="text-slate-500 font-bold text-[11px] block mb-2 flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-blue-600" />
                  <span>Pemetaan Profil Router MikroTik (RB4011)</span>
                </span>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <span className="text-slate-400 block text-[10px] font-semibold uppercase">
                      Profile PPPoE (PPP &gt; Profiles)
                    </span>
                    <span className="font-mono font-bold text-indigo-700 text-xs">
                      {detailPackage.pppoeProfile || (
                        <span className="text-slate-400 font-normal italic">Belum diatur</span>
                      )}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px] font-semibold uppercase">
                      Profile Hotspot (User Profiles)
                    </span>
                    <span className="font-mono font-bold text-purple-700 text-xs">
                      {detailPackage.hotspotProfile || (
                        <span className="text-slate-400 font-normal italic">Belum diatur</span>
                      )}
                    </span>
                  </div>
                </div>
              </div>

              {/* Description */}
              <div>
                <span className="text-slate-500 font-medium block">Deskripsi Layanan</span>
                <p className="mt-1 text-slate-700 bg-slate-50 p-2.5 rounded-lg border border-slate-200 leading-relaxed">
                  {detailPackage.description || 'Tidak ada deskripsi tambahan.'}
                </p>
              </div>

              {/* Customers using this package */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-slate-700 font-bold flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5 text-blue-600" />
                    Daftar Pelanggan Terdaftar ({getSubscribersForPackage(detailPackage.id).length})
                  </span>
                </div>

                <div className="max-h-40 overflow-y-auto divide-y divide-slate-100 rounded-lg border border-slate-200">
                  {getSubscribersForPackage(detailPackage.id).length === 0 ? (
                    <div className="p-3 text-center text-slate-400 italic">
                      Belum ada pelanggan yang berlangganan paket ini.
                    </div>
                  ) : (
                    getSubscribersForPackage(detailPackage.id).map((cust) => (
                      <div
                        key={cust.id}
                        className="p-2.5 flex items-center justify-between text-xs hover:bg-slate-50"
                      >
                        <div>
                          <span className="font-bold text-slate-800">{cust.name}</span>
                          <span className="text-[11px] text-slate-400 block">
                            {cust.id} • {cust.username}
                          </span>
                        </div>
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 capitalize">
                          {cust.status}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-2">
              <button
                onClick={() => {
                  const target = detailPackage;
                  setDetailPackage(null);
                  handleOpenEditModal(target);
                }}
                className="px-3.5 py-1.5 rounded-lg bg-slate-800 text-white text-xs font-semibold hover:bg-slate-900 flex items-center gap-1.5 shadow-xs"
              >
                <Edit2 className="w-3.5 h-3.5" />
                <span>Edit Paket</span>
              </button>
              <button
                onClick={() => setDetailPackage(null)}
                className="px-4 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: TAMBAH PAKET INTERNET */}
      {isAddOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-xl w-full p-6 shadow-2xl border border-slate-200 relative my-8 animate-in fade-in duration-150">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div>
                <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <Plus className="w-5 h-5 text-blue-600" />
                  Tambah Paket Internet Baru
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Konfigurasikan tarif dan parameter koneksi internet
                </p>
              </div>
              <button
                onClick={() => setIsAddOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmitAdd} className="py-4 space-y-4 text-xs">
              {/* Kode Paket & Nama Paket */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Kode Paket <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formCode}
                    onChange={(e) => {
                      setFormCode(e.target.value.toUpperCase());
                      if (formErrors.code) setFormErrors({ ...formErrors, code: undefined });
                    }}
                    placeholder="Contoh: PKT-15M"
                    className={`w-full px-3 py-2 rounded-lg border font-mono text-xs uppercase ${
                      formErrors.code
                        ? 'border-rose-400 ring-2 ring-rose-200 bg-rose-50/30'
                        : 'border-slate-200 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500'
                    }`}
                  />
                  {formErrors.code && (
                    <p className="text-rose-600 text-[11px] mt-1 font-medium">{formErrors.code}</p>
                  )}
                </div>

                <div className="sm:col-span-2">
                  <label className="block font-semibold text-slate-700 mb-1">
                    Nama Paket Internet <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formName}
                    onChange={(e) => {
                      setFormName(e.target.value);
                      if (formErrors.name) setFormErrors({ ...formErrors, name: undefined });
                    }}
                    placeholder="Contoh: Home Pro Gamer 25M"
                    className={`w-full px-3 py-2 rounded-lg border text-xs sm:text-sm ${
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
              </div>

              {/* Kecepatan Utama & Harga Bulanan */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Kecepatan Internet (Speed) <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formSpeed}
                    onChange={(e) => {
                      setFormSpeed(e.target.value);
                      if (!formDownloadSpeed || formDownloadSpeed === formSpeed) {
                        setFormDownloadSpeed(e.target.value);
                      }
                      if (formErrors.speed) setFormErrors({ ...formErrors, speed: undefined });
                    }}
                    placeholder="Contoh: 15 Mbps atau 20M"
                    className={`w-full px-3 py-2 rounded-lg border ${
                      formErrors.speed
                        ? 'border-rose-400 ring-2 ring-rose-200 bg-rose-50/30'
                        : 'border-slate-200 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500'
                    }`}
                  />
                  {formErrors.speed && (
                    <p className="text-rose-600 text-[11px] mt-1 font-medium">{formErrors.speed}</p>
                  )}
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Harga Bulanan (Rupiah) <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="1000"
                    value={formPrice}
                    onChange={(e) => {
                      setFormPrice(e.target.value);
                      if (formErrors.price) setFormErrors({ ...formErrors, price: undefined });
                    }}
                    placeholder="150000"
                    className={`w-full px-3 py-2 rounded-lg border font-semibold ${
                      formErrors.price
                        ? 'border-rose-400 ring-2 ring-rose-200 bg-rose-50/30'
                        : 'border-slate-200 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500'
                    }`}
                  />
                  {formErrors.price && (
                    <p className="text-rose-600 text-[11px] mt-1 font-medium flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" />
                      {formErrors.price}
                    </p>
                  )}
                </div>
              </div>

              {/* Rincian Bandwidth Download & Upload */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Kecepatan Download
                  </label>
                  <input
                    type="text"
                    value={formDownloadSpeed}
                    onChange={(e) => setFormDownloadSpeed(e.target.value)}
                    placeholder="Contoh: 15 Mbps"
                    className="w-full px-3 py-2 rounded-lg border border-slate-200"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Kecepatan Upload</label>
                  <input
                    type="text"
                    value={formUploadSpeed}
                    onChange={(e) => setFormUploadSpeed(e.target.value)}
                    placeholder="Contoh: 7 Mbps"
                    className="w-full px-3 py-2 rounded-lg border border-slate-200"
                  />
                </div>
              </div>

              {/* Jenis Koneksi & Status */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="sm:col-span-2">
                  <label className="block font-semibold text-slate-700 mb-1">
                    Jenis Koneksi yang Didukung
                  </label>
                  <select
                    value={formConnection}
                    onChange={(e) => setFormConnection(e.target.value as PackageConnectionType)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white font-medium"
                  >
                    <option value="pppoe">PPPoE (Kabel LAN / Fiber)</option>
                    <option value="hotspot">Hotspot (Voucher Wireless)</option>
                    <option value="both">PPPoE & Hotspot (Keduanya)</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Status Paket</label>
                  <select
                    value={formStatus}
                    onChange={(e) => setFormStatus(e.target.value as PackageStatus)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white font-medium"
                  >
                    <option value="active">Aktif</option>
                    <option value="inactive">Nonaktif</option>
                  </select>
                </div>
              </div>

              {/* Pemetaan Profile MikroTik (PPPoE / Hotspot) */}
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/90 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-800 text-[11px] flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5 text-blue-600" />
                    <span>Pemetaan Profile MikroTik (RB4011)</span>
                  </span>
                  <span className="text-[10px] text-slate-400">Harus sesuai nama di WinBox</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {(formConnection === 'pppoe' || formConnection === 'both') && (
                    <div>
                      <label className="block font-semibold text-slate-700 text-[11px] mb-1">
                        Profile PPPoE (PPP &gt; Profiles)
                      </label>
                      <input
                        type="text"
                        value={formPppoeProfile}
                        onChange={(e) => setFormPppoeProfile(e.target.value)}
                        placeholder="Contoh: 10M-pppoe"
                        className="w-full px-3 py-2 rounded-lg border border-slate-200 font-mono text-xs bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                      />
                      <span className="text-[10px] text-slate-500 block mt-0.5">Nama profile PPP pada router MikroTik</span>
                    </div>
                  )}

                  {(formConnection === 'hotspot' || formConnection === 'both') && (
                    <div>
                      <label className="block font-semibold text-slate-700 text-[11px] mb-1">
                        Profile Hotspot (IP &gt; Hotspot &gt; User Profiles)
                      </label>
                      <input
                        type="text"
                        value={formHotspotProfile}
                        onChange={(e) => setFormHotspotProfile(e.target.value)}
                        placeholder="Contoh: 10M-hotspot"
                        className="w-full px-3 py-2 rounded-lg border border-slate-200 font-mono text-xs bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                      />
                      <span className="text-[10px] text-slate-500 block mt-0.5">Nama user profile Hotspot pada router</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Deskripsi */}
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Deskripsi Paket</label>
                <textarea
                  rows={2}
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  placeholder="Keterangan peruntukan paket, batasan perangkat, atau keunggulan layanan..."
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
              </div>

              {/* Actions */}
              <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setIsAddOpen(false)}
                  className="px-4 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold shadow-xs flex items-center gap-1.5"
                >
                  <Check className="w-4 h-4" />
                  <span>Simpan Paket</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: EDIT PAKET INTERNET */}
      {editingPackage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-xl w-full p-6 shadow-2xl border border-slate-200 relative my-8 animate-in fade-in duration-150">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div>
                <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <Edit2 className="w-5 h-5 text-amber-600" />
                  Edit Paket ({editingPackage.code})
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">Perbarui tarif dan konfigurasi paket</p>
              </div>
              <button
                onClick={() => setEditingPackage(null)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmitEdit} className="py-4 space-y-4 text-xs">
              {/* Warning if package currently has subscribers */}
              {getSubscribersForPackage(editingPackage.id).length > 0 && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold">Paket Sedang Digunakan Pelanggan:</span>
                    <p className="mt-0.5 text-[11px] text-amber-800 leading-snug">
                      Saat ini ada {getSubscribersForPackage(editingPackage.id).length} pelanggan
                      terdaftar pada paket ini. Jika Anda menonaktifkan paket ini, paket tidak akan
                      bisa dipilih untuk pelanggan baru, tetapi pelanggan lama tetap aktif.
                    </p>
                  </div>
                </div>
              )}

              {/* Kode Paket & Nama Paket */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Kode Paket <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formCode}
                    onChange={(e) => {
                      setFormCode(e.target.value.toUpperCase());
                      if (formErrors.code) setFormErrors({ ...formErrors, code: undefined });
                    }}
                    className={`w-full px-3 py-2 rounded-lg border font-mono text-xs uppercase ${
                      formErrors.code ? 'border-rose-400 ring-2 ring-rose-200' : 'border-slate-200'
                    }`}
                  />
                  {formErrors.code && (
                    <p className="text-rose-600 text-[11px] mt-1 font-medium">{formErrors.code}</p>
                  )}
                </div>

                <div className="sm:col-span-2">
                  <label className="block font-semibold text-slate-700 mb-1">
                    Nama Paket Internet <span className="text-rose-500">*</span>
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
              </div>

              {/* Kecepatan Utama & Harga Bulanan */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Kecepatan Internet (Speed) <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formSpeed}
                    onChange={(e) => {
                      setFormSpeed(e.target.value);
                      if (formErrors.speed) setFormErrors({ ...formErrors, speed: undefined });
                    }}
                    className={`w-full px-3 py-2 rounded-lg border ${
                      formErrors.speed ? 'border-rose-400 ring-2 ring-rose-200' : 'border-slate-200'
                    }`}
                  />
                  {formErrors.speed && (
                    <p className="text-rose-600 text-[11px] mt-1 font-medium">{formErrors.speed}</p>
                  )}
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Harga Bulanan (Rupiah) <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="1000"
                    value={formPrice}
                    onChange={(e) => {
                      setFormPrice(e.target.value);
                      if (formErrors.price) setFormErrors({ ...formErrors, price: undefined });
                    }}
                    className={`w-full px-3 py-2 rounded-lg border font-semibold ${
                      formErrors.price ? 'border-rose-400 ring-2 ring-rose-200' : 'border-slate-200'
                    }`}
                  />
                  {formErrors.price && (
                    <p className="text-rose-600 text-[11px] mt-1 font-medium">{formErrors.price}</p>
                  )}
                </div>
              </div>

              {/* Rincian Bandwidth Download & Upload */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Kecepatan Download
                  </label>
                  <input
                    type="text"
                    value={formDownloadSpeed}
                    onChange={(e) => setFormDownloadSpeed(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Kecepatan Upload</label>
                  <input
                    type="text"
                    value={formUploadSpeed}
                    onChange={(e) => setFormUploadSpeed(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200"
                  />
                </div>
              </div>

              {/* Jenis Koneksi & Status */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="sm:col-span-2">
                  <label className="block font-semibold text-slate-700 mb-1">
                    Jenis Koneksi yang Didukung
                  </label>
                  <select
                    value={formConnection}
                    onChange={(e) => setFormConnection(e.target.value as PackageConnectionType)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white font-medium"
                  >
                    <option value="pppoe">PPPoE (Kabel LAN / Fiber)</option>
                    <option value="hotspot">Hotspot (Voucher Wireless)</option>
                    <option value="both">PPPoE & Hotspot (Keduanya)</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Status Paket</label>
                  <select
                    value={formStatus}
                    onChange={(e) => setFormStatus(e.target.value as PackageStatus)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white font-medium"
                  >
                    <option value="active">Aktif</option>
                    <option value="inactive">Nonaktif</option>
                  </select>
                </div>
              </div>

              {/* Pemetaan Profile MikroTik (PPPoE / Hotspot) */}
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/90 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-800 text-[11px] flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5 text-amber-600" />
                    <span>Pemetaan Profile MikroTik (RB4011)</span>
                  </span>
                  <span className="text-[10px] text-slate-400">Harus sesuai nama di WinBox</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {(formConnection === 'pppoe' || formConnection === 'both') && (
                    <div>
                      <label className="block font-semibold text-slate-700 text-[11px] mb-1">
                        Profile PPPoE (PPP &gt; Profiles)
                      </label>
                      <input
                        type="text"
                        value={formPppoeProfile}
                        onChange={(e) => setFormPppoeProfile(e.target.value)}
                        placeholder="Contoh: 10M-pppoe"
                        className="w-full px-3 py-2 rounded-lg border border-slate-200 font-mono text-xs bg-white focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                      />
                      <span className="text-[10px] text-slate-500 block mt-0.5">Nama profile PPP pada router MikroTik</span>
                    </div>
                  )}

                  {(formConnection === 'hotspot' || formConnection === 'both') && (
                    <div>
                      <label className="block font-semibold text-slate-700 text-[11px] mb-1">
                        Profile Hotspot (IP &gt; Hotspot &gt; User Profiles)
                      </label>
                      <input
                        type="text"
                        value={formHotspotProfile}
                        onChange={(e) => setFormHotspotProfile(e.target.value)}
                        placeholder="Contoh: 10M-hotspot"
                        className="w-full px-3 py-2 rounded-lg border border-slate-200 font-mono text-xs bg-white focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                      />
                      <span className="text-[10px] text-slate-500 block mt-0.5">Nama user profile Hotspot pada router</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Deskripsi */}
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Deskripsi Paket</label>
                <textarea
                  rows={2}
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200"
                />
              </div>

              {/* Actions */}
              <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setEditingPackage(null)}
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

      {/* MODAL 4: HAPUS PAKET (DENGAN PENGECEKAN KEAMANAN DAN PENCEGAHAN INKONSISTENSI DATA) */}
      {packageToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 relative">
            {getSubscribersForPackage(packageToDelete.id).length > 0 ? (
              /* KASUS A: PAKET SEDANG DIGUNAKAN - PENGHAPUSAN DICEGAH */
              <div>
                <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center mb-4">
                  <ShieldAlert className="w-6 h-6" />
                </div>

                <h3 className="text-base font-bold text-slate-900">
                  Penghapusan Paket Ditolak
                </h3>
                <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                  Paket <strong className="text-slate-900">"{packageToDelete.name}"</strong> ({packageToDelete.code}) saat ini sedang aktif digunakan oleh{' '}
                  <strong className="text-blue-700">
                    {getSubscribersForPackage(packageToDelete.id).length} pelanggan
                  </strong>.
                </p>

                <div className="mt-3 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 text-xs">
                  <span className="font-bold block mb-1">Perlindungan Integritas Data:</span>
                  <p className="text-[11px] leading-relaxed text-rose-800">
                    Untuk mencegah hilangnya data paket pada akun pelanggan yang sudah terdaftar,
                    paket ini <strong>tidak dapat dihapus</strong>. Silakan ubah paket pelanggan
                    terkait terlebih dahulu atau ubah status paket menjadi <strong>Nonaktif</strong>.
                  </p>
                </div>

                {/* Ringkasan pelanggan yang terdampak */}
                <div className="mt-3 text-xs">
                  <span className="text-slate-500 font-semibold block mb-1">
                    Contoh Pelanggan yang Menggunakan:
                  </span>
                  <div className="max-h-28 overflow-y-auto bg-slate-50 p-2 rounded-lg border border-slate-200 space-y-1">
                    {getSubscribersForPackage(packageToDelete.id).map((c) => (
                      <div key={c.id} className="flex justify-between text-[11px]">
                        <span className="font-medium text-slate-800">{c.name}</span>
                        <span className="font-mono text-slate-500">{c.id}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="pt-4 mt-3 border-t border-slate-100 flex items-center justify-end">
                  <button
                    onClick={() => setPackageToDelete(null)}
                    className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-900 text-white text-xs font-semibold"
                  >
                    Mengerti & Tutup
                  </button>
                </div>
              </div>
            ) : (
              /* KASUS B: PAKET TIDAK DIGUNAKAN - AMAN DIHAPUS */
              <div>
                <div className="w-12 h-12 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center mb-4">
                  <Trash2 className="w-6 h-6" />
                </div>

                <h3 className="text-base font-bold text-slate-900">Konfirmasi Hapus Paket</h3>
                <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                  Apakah Anda yakin ingin menghapus paket internet berikut?
                </p>

                <div className="mt-3 p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-1.5">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Kode Paket:</span>
                    <span className="font-mono font-bold text-slate-800">{packageToDelete.code}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Nama Paket:</span>
                    <span className="font-bold text-slate-900">{packageToDelete.name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Kecepatan:</span>
                    <span className="font-bold text-slate-800">{packageToDelete.speed}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Tarif Bulanan:</span>
                    <span className="font-bold text-emerald-600">
                      {formatRupiah(packageToDelete.price)}
                    </span>
                  </div>
                </div>

                <div className="mt-3 p-2.5 rounded-lg bg-emerald-50 text-emerald-800 text-[11px] leading-relaxed border border-emerald-200">
                  ✓ Tidak ada pelanggan yang menggunakan paket ini. Penghapusan aman dilakukan.
                </div>

                <div className="pt-4 mt-2 border-t border-slate-100 flex items-center justify-end gap-2.5">
                  <button
                    type="button"
                    onClick={() => setPackageToDelete(null)}
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
                    <span>Ya, Hapus Paket</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
