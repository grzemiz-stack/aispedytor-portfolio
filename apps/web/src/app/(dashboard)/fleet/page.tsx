'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';
import { apiErrorText } from '@/lib/api-error';
import Pagination from '@/components/pagination';
import { vehicleCategoryIcon, vehicleCategoryLabel, VEHICLE_CATEGORIES } from '@/lib/vehicle-categories';

interface Vehicle {
  id: string;
  plateNumber: string;
  brand: string | null;
  model: string | null;
  vehicleType: string;
  vehicleCategory: string;
  status: string;
  currentCity: string | null;
  currentCountry: string | null;
  technicalInspectionTo: string | null;
  insuranceTo: string | null;
  tachographLegalizationTo: string | null;
  plannedMaintenanceDate: string | null;
  fuelCardExpiry: string | null;
  hasAdr: boolean;
  hasGps: boolean;
  parentVehicleId: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  AVAILABLE: 'Dostępny',
  IN_TRANSIT: 'W trasie',
  LOADING: 'Załadunek',
  RETURNING: 'Powrót',
};

const STATUS_COLOR: Record<string, string> = {
  AVAILABLE: 'bg-green-100 text-green-700',
  IN_TRANSIT: 'bg-blue-100 text-blue-700',
  LOADING: 'bg-amber-100 text-amber-700',
  RETURNING: 'bg-purple-100 text-purple-700',
};

const ALL_CATEGORIES = [
  { value: '', label: 'Wszystkie' },
  ...VEHICLE_CATEGORIES.map((c) => ({ value: c, label: `${vehicleCategoryIcon(c)} ${vehicleCategoryLabel(c)}` })),
];

function daysLabel(d: string | null): { text: string; cls: string } | null {
  if (!d) return null;
  const days = Math.ceil((new Date(d).getTime() - Date.now()) / 86400000);
  if (days > 30) return null;
  if (days <= 0) return { text: 'WYGASŁE', cls: 'text-red-700 font-bold' };
  if (days <= 7) return { text: `${days}d`, cls: 'text-red-600 font-semibold' };
  return { text: `${days}d`, cls: 'text-amber-600 font-semibold' };
}

function VehicleCard({ v }: { v: Vehicle }) {
  const warnings: { label: string; date: string; days: number; cls: string }[] = [];
  const checks = [
    { label: 'Przegląd', date: v.technicalInspectionTo },
    { label: 'OC/AC', date: v.insuranceTo },
    { label: 'Tachograf', date: v.tachographLegalizationTo },
    { label: 'Serwis', date: v.plannedMaintenanceDate },
    { label: 'Karta paliw.', date: v.fuelCardExpiry },
  ];
  for (const c of checks) {
    const info = daysLabel(c.date);
    if (info) warnings.push({ label: c.label, date: c.date!, days: Math.ceil((new Date(c.date!).getTime() - Date.now()) / 86400000), cls: info.cls });
  }

  const cardBorder = warnings.some((w) => w.days <= 7)
    ? 'border-red-300'
    : warnings.some((w) => w.days <= 30)
    ? 'border-amber-300'
    : 'border-gray-200';

  const icon = vehicleCategoryIcon(v.vehicleCategory);

  return (
    <Link href={`/fleet/${v.id}`}>
      <div className={`bg-white rounded-xl border shadow-sm p-5 hover:border-brand-400 transition cursor-pointer ${cardBorder}`}>
        <div className="flex items-start justify-between mb-2">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl">{icon}</span>
              <p className="font-bold text-gray-900 text-lg">{v.plateNumber}</p>
            </div>
            <p className="text-sm text-gray-500 ml-7">
              {[v.brand, v.model].filter(Boolean).join(' ') || v.vehicleType}
            </p>
          </div>
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_COLOR[v.status] ?? 'bg-gray-100 text-gray-600'}`}>
            {STATUS_LABEL[v.status] ?? v.status}
          </span>
        </div>

        <div className="flex items-center gap-2 flex-wrap mt-2">
          <span className="text-xs px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded">
            {vehicleCategoryLabel(v.vehicleCategory)}
          </span>
          {v.hasAdr && <span className="text-xs px-1.5 py-0.5 bg-orange-100 text-orange-700 rounded font-medium">ADR</span>}
          {v.hasGps && <span className="text-xs px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded">GPS</span>}
        </div>

        {(v.currentCity || v.currentCountry) && (
          <p className="text-xs text-gray-400 mt-2">
            📍 {[v.currentCity, v.currentCountry].filter(Boolean).join(', ')}
          </p>
        )}
        {warnings.length > 0 && (
          <div className="mt-3 pt-3 border-t border-gray-100 space-y-1">
            {warnings.map((w) => (
              <div key={w.label} className="flex items-center justify-between text-xs">
                <span className="text-gray-500">{w.label}</span>
                <span className={w.cls}>
                  {w.days <= 0 ? 'WYGASŁE' : `${w.days} dni`}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Link>
  );
}

export default function FleetPage() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState(searchParams.get('vehicleCategory') ?? '');
  const [page, setPage] = useState(parseInt(searchParams.get('page') ?? '1'));
  const [limit, setLimit] = useState(parseInt(searchParams.get('limit') ?? '20'));
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  function updateUrl(p: number, l: number, cat: string) {
    const params = new URLSearchParams();
    if (p > 1) params.set('page', String(p));
    if (l !== 20) params.set('limit', String(l));
    if (cat) params.set('vehicleCategory', cat);
    const qs = params.toString();
    router.replace(qs ? `?${qs}` : '/fleet', { scroll: false });
  }

  const [loadError, setLoadError] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setLoadError('');
    const params: Record<string, string> = { page: String(page), limit: String(limit) };
    if (categoryFilter) params.vehicleCategory = categoryFilter;
    apiClient
      .get('/vehicles', { params })
      .then((r) => {
        setVehicles(r.data.data);
        setTotalPages(r.data.meta.totalPages);
        setTotal(r.data.meta.total);
      })
      .catch((err) => setLoadError(apiErrorText(err?.response?.data, 'Nie udało się wczytać floty.')))
      .finally(() => setLoading(false));
  }, [page, limit, categoryFilter]);

  useEffect(() => { load(); }, [load]);

  const expiring = vehicles.filter((v) => {
    const checks = [v.technicalInspectionTo, v.insuranceTo, v.tachographLegalizationTo, v.plannedMaintenanceDate, v.fuelCardExpiry];
    return checks.some((d) => d && daysLabel(d) !== null);
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Flota</h1>
          <p className="text-sm text-gray-500 mt-1">Zarządzaj pojazdami ({total})</p>
        </div>
        <Link
          href="/fleet/new"
          className="bg-brand-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-brand-700 transition text-center w-full sm:w-auto"
        >
          + Dodaj pojazd
        </Link>
      </div>

      {/* Category filter */}
      <div className="flex gap-2 flex-wrap">
        {ALL_CATEGORIES.map((c) => (
          <button
            key={c.value}
            onClick={() => { setCategoryFilter(c.value); setPage(1); updateUrl(1, limit, c.value); }}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition border ${
              categoryFilter === c.value
                ? 'bg-brand-600 text-white border-brand-600'
                : 'bg-white text-gray-600 border-gray-200 hover:border-brand-400'
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* Expiry banner */}
      {expiring.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-center gap-3">
          <span className="text-amber-600 text-lg">⚠️</span>
          <div>
            <p className="text-sm font-semibold text-amber-800">
              {expiring.length} {expiring.length === 1 ? 'pojazd ma' : 'pojazdów ma'} kończące się terminy
            </p>
            <p className="text-xs text-amber-600">Czerwony = &lt;7 dni, Żółty = &lt;30 dni</p>
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="flex gap-4 text-xs text-gray-500">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400 inline-block" /> Termin &lt;7 dni</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block" /> Termin &lt;30 dni</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-gray-300 inline-block" /> OK</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {loading && <p className="text-sm text-gray-400 col-span-3 text-center py-12">Ładowanie...</p>}
        {!loading && loadError && <p className="text-sm text-red-600 col-span-3 text-center py-12">{loadError}</p>}
        {!loading && !loadError && vehicles.length === 0 && (
          <p className="text-sm text-gray-400 col-span-3 text-center py-12">Brak pojazdów</p>
        )}
        {vehicles.map((v) => <VehicleCard key={v.id} v={v} />)}
      </div>

      {!loading && total > 0 && (
        <Pagination
          page={page}
          totalPages={totalPages}
          total={total}
          limit={limit}
          onPageChange={(p) => { setPage(p); updateUrl(p, limit, categoryFilter); }}
          onLimitChange={(l) => { setLimit(l); setPage(1); updateUrl(1, l, categoryFilter); }}
        />
      )}
    </div>
  );
}
