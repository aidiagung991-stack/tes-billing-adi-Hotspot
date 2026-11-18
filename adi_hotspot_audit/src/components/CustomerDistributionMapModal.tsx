import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  MapPin,
  X,
  Users,
  Search,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Eye,
  Filter,
  Navigation,
  MessageSquare,
  HelpCircle,
} from 'lucide-react';
import L from 'leaflet';
import { Customer, CustomerStatus } from '../types/index.ts';
import { formatRupiah } from '../utils/formatters.ts';

interface CustomerDistributionMapModalProps {
  customers: Customer[];
  focusCustomerId?: string;
  onClose: () => void;
  onSetLocationForCustomer?: (customer: Customer) => void;
  onSelectCustomerDetail?: (customer: Customer) => void;
}

export const CustomerDistributionMapModal: React.FC<CustomerDistributionMapModalProps> = ({
  customers,
  focusCustomerId,
  onClose,
  onSetLocationForCustomer,
  onSelectCustomerDetail,
}) => {
  const [statusFilter, setStatusFilter] = useState<'all' | CustomerStatus>('all');
  const [typeFilter, setTypeFilter] = useState<'all' | 'pppoe' | 'hotspot'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showUnpinnedDrawer, setShowUnpinnedDrawer] = useState(false);

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);

  // Separate pinned and unpinned customers
  const pinnedCustomers = useMemo(() => {
    return customers.filter(
      (c) =>
        c.latitude !== undefined &&
        c.longitude !== undefined &&
        !isNaN(c.latitude) &&
        !isNaN(c.longitude)
    );
  }, [customers]);

  const unpinnedCustomers = useMemo(() => {
    return customers.filter(
      (c) =>
        c.latitude === undefined ||
        c.longitude === undefined ||
        isNaN(c.latitude) ||
        isNaN(c.longitude)
    );
  }, [customers]);

  // Filtered pinned list
  const filteredPinned = useMemo(() => {
    return pinnedCustomers.filter((c) => {
      if (statusFilter !== 'all' && c.status !== statusFilter) return false;
      if (typeFilter !== 'all' && c.type !== typeFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const match =
          c.name.toLowerCase().includes(q) ||
          c.id.toLowerCase().includes(q) ||
          c.address.toLowerCase().includes(q) ||
          c.packageName.toLowerCase().includes(q);
        if (!match) return false;
      }
      return true;
    });
  }, [pinnedCustomers, statusFilter, typeFilter, searchQuery]);

  // Status Pin Icons
  const createMarkerIcon = (status: CustomerStatus, name: string) => {
    let bgColor = '#10b981'; // green for active
    if (status === 'isolated') bgColor = '#f59e0b'; // amber
    if (status === 'inactive') bgColor = '#64748b'; // slate

    return L.divIcon({
      className: 'custom-customer-pin',
      html: `
        <div style="
          width: 32px;
          height: 32px;
          background-color: ${bgColor};
          border: 2.5px solid #ffffff;
          border-radius: 50% 50% 50% 0;
          transform: rotate(-45deg);
          box-shadow: 0 4px 8px rgba(0,0,0,0.28);
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
        ">
          <div style="
            width: 8px;
            height: 8px;
            background-color: #ffffff;
            border-radius: 50%;
            transform: rotate(45deg);
          "></div>
        </div>
      `,
      iconSize: [32, 32],
      iconAnchor: [16, 32],
      popupAnchor: [0, -32],
    });
  };

  // Initialize Map
  useEffect(() => {
    if (!mapContainerRef.current) return;

    // Find initial center: focused customer or average of pinned, or fallback
    let initialCenter: [number, number] = [-6.4825, 106.8535];
    let initialZoom = 14;

    const focused = focusCustomerId
      ? pinnedCustomers.find((c) => c.id === focusCustomerId)
      : undefined;

    if (focused && focused.latitude && focused.longitude) {
      initialCenter = [focused.latitude, focused.longitude];
      initialZoom = 17;
    } else if (pinnedCustomers.length > 0) {
      initialCenter = [pinnedCustomers[0].latitude!, pinnedCustomers[0].longitude!];
    }

    const map = L.map(mapContainerRef.current, {
      center: initialCenter,
      zoom: initialZoom,
      zoomControl: true,
    });

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap contributors',
    }).addTo(map);

    const layerGroup = L.layerGroup().addTo(map);
    mapRef.current = map;
    markersLayerRef.current = layerGroup;

    const timer = setTimeout(() => {
      map.invalidateSize();
    }, 250);

    return () => {
      clearTimeout(timer);
      map.remove();
      mapRef.current = null;
      markersLayerRef.current = null;
    };
  }, []);

  // Update Markers when filter changes
  useEffect(() => {
    if (!mapRef.current || !markersLayerRef.current) return;

    markersLayerRef.current.clearLayers();

    const bounds = L.latLngBounds([]);

    filteredPinned.forEach((cust) => {
      if (cust.latitude && cust.longitude) {
        const marker = L.marker([cust.latitude, cust.longitude], {
          icon: createMarkerIcon(cust.status, cust.name),
        });

        const statusBadge =
          cust.status === 'active'
            ? '<span style="color:#059669; font-weight:bold; background:#d1fae5; padding:2px 6px; border-radius:4px; font-size:11px;">Aktif</span>'
            : cust.status === 'isolated'
            ? '<span style="color:#d97706; font-weight:bold; background:#fef3c7; padding:2px 6px; border-radius:4px; font-size:11px;">Terisolir</span>'
            : '<span style="color:#475569; font-weight:bold; background:#e2e8f0; padding:2px 6px; border-radius:4px; font-size:11px;">Nonaktif</span>';

        const popupContent = `
          <div style="font-family: system-ui, sans-serif; font-size: 12px; min-width: 200px; color: #1e293b;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 4px;">
              <strong style="font-size: 13px; color: #0f172a;">${cust.name}</strong>
              ${statusBadge}
            </div>
            <div style="color: #64748b; font-size: 11px; margin-bottom: 6px;">ID: ${cust.id} • ${cust.type.toUpperCase()}</div>
            <div style="margin-bottom: 4px;"><strong>Paket:</strong> ${cust.packageName} (${formatRupiah(cust.monthlyFee)})</div>
            <div style="margin-bottom: 4px;"><strong>Alamat:</strong> ${cust.installationAddress || cust.address}</div>
            <div style="color: #64748b; font-size: 11px;"><strong>WA:</strong> ${cust.phone}</div>
          </div>
        `;

        marker.bindPopup(popupContent);
        markersLayerRef.current?.addLayer(marker);
        bounds.extend([cust.latitude, cust.longitude]);

        // Auto open popup if focused customer
        if (focusCustomerId && cust.id === focusCustomerId) {
          marker.openPopup();
        }
      }
    });

    // If no specific customer focused and markers exist, fit bounds smoothly
    if (!focusCustomerId && filteredPinned.length > 0 && bounds.isValid()) {
      mapRef.current.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 });
    }
  }, [filteredPinned, focusCustomerId]);

  const handleCenterOnCustomer = (cust: Customer) => {
    if (cust.latitude && cust.longitude && mapRef.current) {
      mapRef.current.setView([cust.latitude, cust.longitude], 17);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-900/60 backdrop-blur-xs">
      <div className="bg-white rounded-2xl max-w-5xl w-full flex flex-col h-[92vh] shadow-2xl overflow-hidden border border-slate-200">
        {/* Top Header */}
        <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-blue-600 text-white flex items-center justify-center shadow-xs">
              <MapPin className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
                <span>Peta Persebaran Pelanggan</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 font-semibold">
                  {pinnedCustomers.length} Terpasang Titik
                </span>
              </h3>
              <p className="text-xs text-slate-500">
                Visualisasi lokasi instalasi jaringan PPPoE dan Hotspot pelanggan
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Toolbar & Filters */}
        <div className="p-3 border-b border-slate-100 bg-white flex flex-wrap items-center justify-between gap-2.5 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            {/* Search */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Cari pelanggan / paket..."
                className="pl-8 pr-2.5 py-1.5 rounded-lg border border-slate-200 text-xs w-44 sm:w-56"
              />
            </div>

            {/* Filter Status */}
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-medium"
            >
              <option value="all">Semua Status</option>
              <option value="active">Aktif (Hijau)</option>
              <option value="isolated">Terisolir (Oranye)</option>
              <option value="inactive">Nonaktif (Abu-abu)</option>
            </select>

            {/* Filter Tipe */}
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as any)}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-medium"
            >
              <option value="all">Semua Koneksi</option>
              <option value="pppoe">PPPoE</option>
              <option value="hotspot">Hotspot</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            {/* Unpinned Drawer Toggle */}
            <button
              onClick={() => setShowUnpinnedDrawer(!showUnpinnedDrawer)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors border ${
                unpinnedCustomers.length > 0
                  ? 'bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100'
                  : 'bg-slate-50 text-slate-600 border-slate-200'
              }`}
            >
              <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
              <span>Belum Ditentukan ({unpinnedCustomers.length})</span>
            </button>
          </div>
        </div>

        {/* Map Body and Drawer */}
        <div className="relative flex-1 w-full bg-slate-100 overflow-hidden flex">
          {/* Main Leaflet Map */}
          <div ref={mapContainerRef} className="flex-1 w-full h-full" style={{ minHeight: '400px' }} />

          {/* Map Legend Overlay */}
          <div className="absolute bottom-4 left-4 z-[1000] bg-white/95 backdrop-blur-xs p-3 rounded-xl border border-slate-200 shadow-md text-xs space-y-1.5 pointer-events-auto">
            <span className="text-[10px] font-bold uppercase text-slate-500 block mb-1">
              Keterangan Pin:
            </span>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-emerald-500 inline-block border border-white shadow-xs" />
              <span className="text-slate-700 font-medium">Pelanggan Aktif</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-amber-500 inline-block border border-white shadow-xs" />
              <span className="text-slate-700 font-medium">Layanan Terisolir</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-slate-500 inline-block border border-white shadow-xs" />
              <span className="text-slate-700 font-medium">Pelanggan Nonaktif</span>
            </div>
          </div>

          {/* Side Drawer: Unpinned Customers */}
          {showUnpinnedDrawer && (
            <div className="absolute top-0 right-0 bottom-0 w-80 bg-white border-l border-slate-200 z-[1001] shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
              <div className="p-3.5 border-b border-slate-100 flex items-center justify-between bg-slate-50">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600" />
                  <span className="font-bold text-slate-900 text-xs">
                    Pelanggan Tanpa Koordinat ({unpinnedCustomers.length})
                  </span>
                </div>
                <button
                  onClick={() => setShowUnpinnedDrawer(false)}
                  className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-200"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-3 space-y-2.5 text-xs">
                {unpinnedCustomers.length === 0 ? (
                  <div className="text-center py-8 text-slate-500">
                    <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
                    <p className="font-semibold text-slate-800">Semua Terpasang Titik!</p>
                    <p className="text-[11px] text-slate-400 mt-1">
                      Seluruh pelanggan telah memiliki koordinat latitude & longitude.
                    </p>
                  </div>
                ) : (
                  unpinnedCustomers.map((cust) => (
                    <div
                      key={cust.id}
                      className="p-3 rounded-xl border border-slate-200 hover:border-amber-300 bg-slate-50/70 hover:bg-white transition-all space-y-1.5"
                    >
                      <div className="flex items-center justify-between">
                        <strong className="text-slate-900 font-bold">{cust.name}</strong>
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-800 border border-amber-200">
                          Lokasi belum ditentukan
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 line-clamp-1">{cust.address}</p>
                      <div className="flex items-center justify-between pt-1">
                        <span className="text-[11px] font-mono text-slate-600">{cust.id}</span>
                        {onSetLocationForCustomer && (
                          <button
                            onClick={() => {
                              onSetLocationForCustomer(cust);
                            }}
                            className="px-2 py-1 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-semibold flex items-center gap-1"
                          >
                            <MapPin className="w-3 h-3" />
                            <span>Atur Titik</span>
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
