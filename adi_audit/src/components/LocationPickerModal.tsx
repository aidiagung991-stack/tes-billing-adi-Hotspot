import React, { useState, useEffect, useRef } from 'react';
import {
  MapPin,
  Search,
  Crosshair,
  Check,
  X,
  AlertCircle,
  Loader2,
  Navigation,
} from 'lucide-react';
import L from 'leaflet';

interface LocationPickerModalProps {
  initialLat?: number;
  initialLng?: number;
  initialAddress?: string;
  customerName?: string;
  onSave: (coords: { latitude: number; longitude: number }) => void;
  onClose: () => void;
}

export const LocationPickerModal: React.FC<LocationPickerModalProps> = ({
  initialLat,
  initialLng,
  initialAddress,
  customerName,
  onSave,
  onClose,
}) => {
  // Default coordinates: center of Cibinong / Jabodetabek if none provided
  const defaultLat = -6.4825;
  const defaultLng = 106.8535;

  const [lat, setLat] = useState<number>(initialLat ?? defaultLat);
  const [lng, setLng] = useState<number>(initialLng ?? defaultLng);
  const [searchQuery, setSearchQuery] = useState(initialAddress || '');
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);

  // Initialize Leaflet Map
  useEffect(() => {
    if (!mapContainerRef.current) return;

    // Create custom pin icon
    const customPinIcon = L.divIcon({
      className: 'custom-leaflet-marker',
      html: `
        <div style="
          width: 34px;
          height: 34px;
          background-color: #2563eb;
          border: 3px solid #ffffff;
          border-radius: 50% 50% 50% 0;
          transform: rotate(-45deg);
          box-shadow: 0 4px 10px rgba(0,0,0,0.3);
          display: flex;
          align-items: center;
          justify-content: center;
        ">
          <div style="
            width: 10px;
            height: 10px;
            background-color: #ffffff;
            border-radius: 50%;
            transform: rotate(45deg);
          "></div>
        </div>
      `,
      iconSize: [34, 34],
      iconAnchor: [17, 34],
    });

    const map = L.map(mapContainerRef.current, {
      center: [lat, lng],
      zoom: 16,
      zoomControl: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap contributors',
    }).addTo(map);

    const marker = L.marker([lat, lng], {
      draggable: true,
      icon: customPinIcon,
    }).addTo(map);

    marker.on('dragend', () => {
      const pos = marker.getLatLng();
      const roundedLat = parseFloat(pos.lat.toFixed(6));
      const roundedLng = parseFloat(pos.lng.toFixed(6));
      setLat(roundedLat);
      setLng(roundedLng);
    });

    map.on('click', (e) => {
      const roundedLat = parseFloat(e.latlng.lat.toFixed(6));
      const roundedLng = parseFloat(e.latlng.lng.toFixed(6));
      setLat(roundedLat);
      setLng(roundedLng);
      marker.setLatLng([roundedLat, roundedLng]);
    });

    mapRef.current = map;
    markerRef.current = marker;

    // Delay resize invalidate to ensure container size in modal is accurately computed
    const timer = setTimeout(() => {
      map.invalidateSize();
    }, 200);

    return () => {
      clearTimeout(timer);
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, []);

  // Update marker position when inputs change
  const handleUpdateCoords = (newLat: number, newLng: number) => {
    setLat(newLat);
    setLng(newLng);
    if (markerRef.current) {
      markerRef.current.setLatLng([newLat, newLng]);
    }
    if (mapRef.current) {
      mapRef.current.panTo([newLat, newLng]);
    }
  };

  // Search location using OpenStreetMap Nominatim (Free, no API key needed)
  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!searchQuery.trim()) return;

    setIsSearching(true);
    setSearchError(null);

    try {
      const query = encodeURIComponent(searchQuery.trim() + ', Indonesia');
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${query}&limit=1`
      );
      const data = await res.json();

      if (data && data.length > 0) {
        const foundLat = parseFloat(parseFloat(data[0].lat).toFixed(6));
        const foundLng = parseFloat(parseFloat(data[0].lon).toFixed(6));
        handleUpdateCoords(foundLat, foundLng);
        if (mapRef.current) {
          mapRef.current.setView([foundLat, foundLng], 17);
        }
      } else {
        setSearchError('Lokasi tidak ditemukan. Coba geser pin secara manual pada peta.');
      }
    } catch (err) {
      setSearchError('Gagal melakukan pencarian alamat. Silakan geser pin manual.');
    } finally {
      setIsSearching(false);
    }
  };

  // Use browser GPS location
  const handleGetCurrentLocation = () => {
    if (!navigator.geolocation) {
      alert('Browser Anda tidak mendukung deteksi lokasi GPS.');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const userLat = parseFloat(pos.coords.latitude.toFixed(6));
        const userLng = parseFloat(pos.coords.longitude.toFixed(6));
        handleUpdateCoords(userLat, userLng);
        if (mapRef.current) {
          mapRef.current.setView([userLat, userLng], 17);
        }
      },
      () => {
        alert('Gagal mengambil lokasi GPS saat ini. Pastikan izin lokasi diaktifkan.');
      }
    );
  };

  const handleConfirm = () => {
    onSave({ latitude: lat, longitude: lng });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs">
      <div className="bg-white rounded-2xl max-w-3xl w-full flex flex-col max-h-[92vh] shadow-2xl overflow-hidden border border-slate-200">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center">
              <MapPin className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-sm sm:text-base">
                Tentukan Titik Koordinat Lokasi
              </h3>
              <p className="text-xs text-slate-500">
                {customerName ? `Pelanggan: ${customerName}` : 'Klik pada peta atau geser pin ke posisi rumah pelanggan'}
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

        {/* Search bar & quick action */}
        <div className="p-3 sm:p-4 border-b border-slate-100 space-y-2.5 bg-white">
          <form onSubmit={handleSearch} className="flex gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Cari nama jalan, desa, perumahan, atau kelurahan..."
                className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              />
            </div>
            <button
              type="submit"
              disabled={isSearching}
              className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-900 text-white text-xs font-semibold flex items-center gap-1.5 shrink-0 transition-colors disabled:opacity-50"
            >
              {isSearching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
              <span>Cari</span>
            </button>
            <button
              type="button"
              onClick={handleGetCurrentLocation}
              title="Gunakan Lokasi GPS Saat Ini"
              className="px-3 py-2 rounded-xl border border-slate-200 hover:bg-slate-100 text-slate-700 text-xs font-semibold flex items-center gap-1.5 shrink-0 transition-colors"
            >
              <Navigation className="w-3.5 h-3.5 text-blue-600" />
              <span className="hidden sm:inline">GPS Saya</span>
            </button>
          </form>

          {searchError && (
            <div className="text-[11px] text-amber-700 bg-amber-50 px-3 py-1.5 rounded-lg border border-amber-200 flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span>{searchError}</span>
            </div>
          )}
        </div>

        {/* Map Container */}
        <div className="relative flex-1 min-h-[320px] sm:min-h-[400px] w-full bg-slate-100">
          <div ref={mapContainerRef} className="w-full h-full" style={{ minHeight: '340px' }} />

          {/* Quick Helper Overlay */}
          <div className="absolute bottom-3 left-3 z-[1000] bg-white/90 backdrop-blur-xs px-3 py-1.5 rounded-lg border border-slate-200 text-[11px] text-slate-700 shadow-sm flex items-center gap-1.5 pointer-events-none">
            <Crosshair className="w-3.5 h-3.5 text-blue-600" />
            <span>Klik peta atau geser pin biru untuk menyesuaikan titik</span>
          </div>
        </div>

        {/* Footer with coordinate inputs and confirmation */}
        <div className="p-4 border-t border-slate-100 bg-slate-50 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <label className="text-[10px] font-semibold text-slate-500 uppercase block">Latitude</label>
              <input
                type="number"
                step="any"
                value={lat}
                onChange={(e) => handleUpdateCoords(parseFloat(e.target.value) || 0, lng)}
                className="w-full font-mono font-medium px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white"
              />
            </div>
            <div>
              <label className="text-[10px] font-semibold text-slate-500 uppercase block">Longitude</label>
              <input
                type="number"
                step="any"
                value={lng}
                onChange={(e) => handleUpdateCoords(lat, parseFloat(e.target.value) || 0)}
                className="w-full font-mono font-medium px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white"
              />
            </div>
          </div>

          <div className="flex items-center gap-2 justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-slate-200 hover:bg-slate-200 text-slate-700 text-xs font-semibold"
            >
              Batal
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold flex items-center gap-1.5 shadow-xs transition-colors"
            >
              <Check className="w-4 h-4" />
              <span>Simpan Koordinat</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
