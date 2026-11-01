'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';
import { messagesToText, type PlanMessage } from '@/lib/plan-messages';
import { canHaveAttachments, isTowed, vehicleCategoryIcon, vehicleCategoryLabel } from '@/lib/vehicle-categories';

interface VehicleDetail {
  id: string;
  plateNumber: string;
  licensePlate: string | null;
  ocrNumber: string | null;
  brand: string | null;
  model: string | null;
  vin: string | null;
  year: number | null;
  vehicleType: string;
  vehicleCategory: string;
  trailerType: string | null;
  status: string;
  maxWeightKg: number | null;
  maxVolumeM3: number | null;
  maxLoadingMeters: number | null;
  maxPalletCount: number | null;
  lengthM: number | null;
  heightM: number | null;
  widthM: number | null;
  axleCount: number | null;
  hasAdr: boolean;
  hasGps: boolean;
  adrClasses: string[];
  currentCity: string | null;
  currentCountry: string | null;
  currentDirection: string | null;
  availableFrom: string | null;
  freeMeters: number | null;
  freeWeightKg: number | null;
  technicalInspectionFrom: string | null;
  technicalInspectionTo: string | null;
  insuranceFrom: string | null;
  insuranceTo: string | null;
  tachographLegalizationFrom: string | null;
  tachographLegalizationTo: string | null;
  plannedMaintenanceDate: string | null;
  plannedMaintenanceNotes: string | null;
  fuelCardType: string | null;
  fuelCardLast4: string | null;
  fuelCardExpiry: string | null;
  notes: string | null;
  parentVehicle: { id: string; plateNumber: string; brand: string | null; model: string | null } | null;
  trailers: { id: string; plateNumber: string; vehicleCategory: string; status: string; brand: string | null; model: string | null }[];
}

interface OfferMatch {
  offerId: string;
  route: string;
  price: number | null;
  currency: string;
  matchScore: number;
  recommendation: string;
  /** ADR: reasons for incompatibility (score 0) and warnings — codes from the API. */
  blockedBy?: PlanMessage[];
  warnings?: PlanMessage[];
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

const VEHICLE_TYPE_LABEL: Record<string, string> = {
  TRUCK: 'Ciężarówka',
  VAN: 'Van',
  MEGA: 'Mega',
  STANDARD: 'Standard',
  REFRIGERATED: 'Chłodnia',
};

const TRAILER_TYPE_LABEL: Record<string, string> = {
  CURTAIN: 'Firanka',
  BOX: 'Skrzynia',
  REEFER: 'Chłodnia',
  FLATBED: 'Platforma',
  TANKER: 'Cysterna',
};

function fmt(d: string | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('pl-PL');
}

function daysLeft(d: string | null): number | null {
  if (!d) return null;
  return Math.ceil((new Date(d).getTime() - Date.now()) / 86400000);
}

// Color-coded document row with timeline bar
function DocRow({
  label,
  from,
  to,
  isPlanned = false,
}: {
  label: string;
  from: string | null;
  to: string | null;
  isPlanned?: boolean;
}) {
  const days = daysLeft(to);
  const expired = days !== null && days <= 0;
  const critical = days !== null && days > 0 && days <= 7;
  const warning = days !== null && days > 7 && days <= 30;
  const noData = days === null;

  const dotColor = noData
    ? 'bg-gray-300'
    : expired
    ? 'bg-red-500'
    : critical
    ? 'bg-red-400'
    : warning
    ? 'bg-amber-400'
    : 'bg-green-500';

  const badge = noData
    ? { text: 'Brak danych', cls: 'bg-gray-100 text-gray-400' }
    : expired
    ? { text: 'WYGASŁE', cls: 'bg-red-100 text-red-700' }
    : critical
    ? { text: `${days} dni`, cls: 'bg-red-100 text-red-700' }
    : warning
    ? { text: `${days} dni`, cls: 'bg-amber-100 text-amber-700' }
    : { text: `${days} dni`, cls: 'bg-green-100 text-green-700' };

  return (
    <div className="flex items-center gap-3 py-2">
      <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${dotColor}`} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-800">{label}</p>
        <p className="text-xs text-gray-500">
          {isPlanned
            ? (to ? `Zaplanowany na: ${fmt(to)}` : '—')
            : `${fmt(from)} → ${fmt(to)}`}
        </p>
      </div>
      <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${badge.cls}`}>
        {badge.text}
      </span>
      {!noData && !expired && (
        <div className="w-24 bg-gray-100 rounded-full h-1.5 shrink-0 hidden sm:block">
          <div
            className={`h-1.5 rounded-full ${dotColor}`}
            style={{ width: `${Math.min(100, Math.max(0, ((days ?? 0) / 365) * 100))}%` }}
          />
        </div>
      )}
    </div>
  );
}

export default function VehicleDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [vehicle, setVehicle] = useState<VehicleDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [offerMatches, setOfferMatches] = useState<OfferMatch[] | null>(null);
  const [matchLoading, setMatchLoading] = useState(false);
  const [matchError, setMatchError] = useState('');

  useEffect(() => {
    apiClient
      .get(`/vehicles/${id}`)
      .then((r) => setVehicle(r.data))
      .catch(() => router.push('/fleet'))
      .finally(() => setLoading(false));
  }, [id, router]);

  async function handleFindOffers() {
    setMatchLoading(true);
    setMatchError('');
    try {
      const r = await apiClient.get(`/matching/offers-for-vehicle/${id}`);
      setOfferMatches(r.data);
    } catch {
      setMatchError('Nie udało się pobrać pasujących ofert');
    } finally {
      setMatchLoading(false);
    }
  }

  if (loading) return <p className="text-sm text-gray-400 py-12 text-center">Ładowanie...</p>;
  if (!vehicle) return null;

  const row = (label: string, value: React.ReactNode) =>
    value ? (
      <div className="flex flex-col sm:flex-row sm:gap-2">
        <span className="text-sm text-gray-500 sm:w-44 sm:shrink-0">{label}</span>
        <span className="text-sm text-gray-900 font-medium">{value}</span>
      </div>
    ) : null;

  // Tractor, rigid, van — units something can be attached to (rule from the API).
  const hasAttachmentSlot = canHaveAttachments(vehicle.vehicleCategory);
  const isTrailer = isTowed(vehicle.vehicleCategory);

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <button onClick={() => router.back()} className="text-xs text-gray-400 hover:text-gray-700 mb-1">
            ← Wróć
          </button>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <span>{vehicleCategoryIcon(vehicle.vehicleCategory)}</span>
            {vehicle.plateNumber}
          </h1>
          <p className="text-sm text-gray-500">{vehicleCategoryLabel(vehicle.vehicleCategory)}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`px-3 py-1 rounded-full text-sm font-medium ${STATUS_COLOR[vehicle.status] ?? 'bg-gray-100 text-gray-500'}`}>
            {STATUS_LABEL[vehicle.status] ?? vehicle.status}
          </span>
          <Link
            href={`/fleet/${id}/edit`}
            className="px-3 py-1.5 rounded-lg text-sm font-medium border border-gray-300 hover:bg-gray-50 transition"
          >
            Edytuj
          </Link>
        </div>
      </div>

      {/* The unit this trailer is attached to (only for towed units) */}
      {isTrailer && vehicle.parentVehicle && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 flex items-center gap-3">
          <span className="text-blue-600">🚛</span>
          <div>
            <p className="text-xs text-blue-600 font-medium">Przypisany ciągnik</p>
            <Link href={`/fleet/${vehicle.parentVehicle.id}`} className="text-sm font-bold text-blue-800 hover:underline">
              {vehicle.parentVehicle.plateNumber}
              {vehicle.parentVehicle.brand && ` — ${vehicle.parentVehicle.brand} ${vehicle.parentVehicle.model ?? ''}`}
            </Link>
          </div>
        </div>
      )}

      {/* Dane pojazdu */}
      <div className="bg-white rounded-xl border shadow-sm p-6 space-y-3">
        <h2 className="text-sm font-semibold text-gray-800 mb-4">Dane pojazdu</h2>
        <div className="space-y-2">
          {row('Marka / Model', [vehicle.brand, vehicle.model].filter(Boolean).join(' ') || null)}
          {row('Typ pojazdu', VEHICLE_TYPE_LABEL[vehicle.vehicleType] ?? vehicle.vehicleType)}
          {row('Typ nadwozia', vehicle.trailerType ? (TRAILER_TYPE_LABEL[vehicle.trailerType] ?? vehicle.trailerType) : null)}
          {row('VIN', vehicle.vin)}
          {row('Nr dowodu rej.', vehicle.ocrNumber)}
          {row('Nr rej. dodatkowy', vehicle.licensePlate)}
          {row('Rok produkcji', vehicle.year?.toString())}
          {row('Liczba osi', vehicle.axleCount?.toString())}
        </div>

        <div className="border-t border-gray-100 pt-3 mt-3">
          <p className="text-xs font-semibold text-gray-400 uppercase mb-2">Ładowność</p>
          <div className="space-y-2">
            {row('Max masa', vehicle.maxWeightKg ? `${vehicle.maxWeightKg.toLocaleString('pl-PL')} kg` : null)}
            {row('Max objętość', vehicle.maxVolumeM3 ? `${vehicle.maxVolumeM3} m³` : null)}
            {row('Metry ładunkowe', vehicle.maxLoadingMeters ? `${vehicle.maxLoadingMeters} m` : null)}
            {row('Max liczba palet', vehicle.maxPalletCount?.toString())}
            {row('Długość', vehicle.lengthM ? `${vehicle.lengthM} m` : null)}
            {row('Wysokość', vehicle.heightM ? `${vehicle.heightM} m` : null)}
            {row('Szerokość', vehicle.widthM ? `${vehicle.widthM} m` : null)}
          </div>
        </div>

        <div className="border-t border-gray-100 pt-3 mt-3 flex flex-wrap gap-2">
          {vehicle.hasAdr && (
            <span className="text-xs px-2 py-1 bg-orange-100 text-orange-700 rounded font-medium">
              ⚠️ ADR{vehicle.adrClasses.length > 0 ? `: ${vehicle.adrClasses.join(', ')}` : ''}
            </span>
          )}
          {vehicle.hasGps && (
            <span className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded font-medium">📡 GPS</span>
          )}
          {!vehicle.hasAdr && !vehicle.hasGps && (
            <span className="text-xs text-gray-400">Brak certyfikatów</span>
          )}
        </div>
      </div>

      {/* Lokalizacja */}
      {(vehicle.currentCity || vehicle.currentCountry || vehicle.currentDirection) && (
        <div className="bg-white rounded-xl border shadow-sm p-6 space-y-2">
          <h2 className="text-sm font-semibold text-gray-800 mb-4">Lokalizacja</h2>
          {row('Miasto', vehicle.currentCity)}
          {row('Kraj', vehicle.currentCountry)}
          {row('Kierunek', vehicle.currentDirection)}
          {row('Wolne od', vehicle.availableFrom ? fmt(vehicle.availableFrom) : null)}
          {row('Wolna masa', vehicle.freeWeightKg ? `${vehicle.freeWeightKg.toLocaleString('pl-PL')} kg` : null)}
          {row('Wolne metry', vehicle.freeMeters ? `${vehicle.freeMeters} m` : null)}
        </div>
      )}

      {/* Dokumenty i terminy — timeline */}
      <div className="bg-white rounded-xl border shadow-sm p-6">
        <h2 className="text-sm font-semibold text-gray-800 mb-1">Dokumenty i terminy</h2>
        <p className="text-xs text-gray-400 mb-4">Kolory: 🔴 &lt;7 dni · 🟡 &lt;30 dni · 🟢 OK · ⚫ brak danych</p>
        <div className="divide-y divide-gray-50">
          <DocRow
            label="Przegląd techniczny"
            from={vehicle.technicalInspectionFrom}
            to={vehicle.technicalInspectionTo}
          />
          <DocRow
            label="Ubezpieczenie OC/AC"
            from={vehicle.insuranceFrom}
            to={vehicle.insuranceTo}
          />
          <DocRow
            label="Legalizacja tachografu"
            from={vehicle.tachographLegalizationFrom}
            to={vehicle.tachographLegalizationTo}
          />
          <DocRow
            label="Planowany serwis"
            from={null}
            to={vehicle.plannedMaintenanceDate}
            isPlanned
          />
        </div>
        {vehicle.plannedMaintenanceNotes && (
          <div className="mt-3 pt-3 border-t border-gray-100">
            <p className="text-xs text-gray-500 font-medium mb-1">Opis planowanego serwisu:</p>
            <p className="text-sm text-gray-700">{vehicle.plannedMaintenanceNotes}</p>
          </div>
        )}
      </div>

      {/* Fuel card */}
      {(vehicle.fuelCardType || vehicle.fuelCardLast4 || vehicle.fuelCardExpiry) && (
        <div className="bg-white rounded-xl border shadow-sm p-6 space-y-2">
          <h2 className="text-sm font-semibold text-gray-800 mb-4">Karta paliwowa</h2>
          <div className="divide-y divide-gray-50">
            <DocRow
              label={`${vehicle.fuelCardType ?? 'Karta paliwowa'}${vehicle.fuelCardLast4 ? ` ···${vehicle.fuelCardLast4}` : ''}`}
              from={null}
              to={vehicle.fuelCardExpiry}
              isPlanned
            />
          </div>
        </div>
      )}

      {/* Uwagi */}
      {vehicle.notes && (
        <div className="bg-white rounded-xl border shadow-sm p-6">
          <h2 className="text-sm font-semibold text-gray-800 mb-2">Uwagi</h2>
          <p className="text-sm text-gray-600">{vehicle.notes}</p>
        </div>
      )}

      {/* Attached semi-trailers / trailers (only for units that can have attachments) */}
      {hasAttachmentSlot && vehicle.trailers.length > 0 && (
        <div className="bg-white rounded-xl border shadow-sm p-6">
          <h2 className="text-sm font-semibold text-gray-800 mb-4">Przypisane naczepy / przyczepy</h2>
          <div className="space-y-2">
            {vehicle.trailers.map((t) => (
              <Link key={t.id} href={`/fleet/${t.id}`}>
                <div className="flex items-center justify-between rounded-lg border border-gray-100 px-4 py-3 hover:border-brand-300 transition">
                  <div className="flex items-center gap-3">
                    <span>{vehicleCategoryIcon(t.vehicleCategory)}</span>
                    <div>
                      <p className="text-sm font-bold text-gray-900">{t.plateNumber}</p>
                      <p className="text-xs text-gray-500">{[t.brand, t.model].filter(Boolean).join(' ') || t.vehicleCategory}</p>
                    </div>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOR[t.status] ?? 'bg-gray-100 text-gray-600'}`}>
                    {STATUS_LABEL[t.status] ?? t.status}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Matching offers */}
      <div className="bg-white rounded-xl border shadow-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-800">Pasujące oferty</h2>
          <button
            onClick={handleFindOffers}
            disabled={matchLoading}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-brand-600 text-white hover:bg-brand-700 transition disabled:opacity-50"
          >
            {matchLoading ? 'Szukam...' : offerMatches ? 'Odśwież' : 'Znajdź oferty'}
          </button>
        </div>
        {matchError && <p className="text-xs text-red-600 mb-3">{matchError}</p>}
        {!offerMatches && !matchLoading && (
          <p className="text-xs text-gray-400">Kliknij „Znajdź oferty” aby zobaczyć pasujące zlecenia transportowe.</p>
        )}
        {offerMatches && offerMatches.length === 0 && (
          <p className="text-xs text-gray-400">Brak nowych ofert do dopasowania.</p>
        )}
        {offerMatches && offerMatches.length > 0 && (
          <div className="space-y-2">
            {offerMatches.slice(0, 5).map((om) => {
              const pct = om.matchScore;
              const barColor = pct >= 80 ? 'bg-green-500' : pct >= 50 ? 'bg-amber-400' : 'bg-red-400';
              const scoreText = pct >= 80 ? 'text-green-700' : pct >= 50 ? 'text-amber-600' : 'text-red-600';
              return (
                <div key={om.offerId} className="border rounded-xl p-4 space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-gray-900 font-mono">{om.route}</p>
                      {om.price && (
                        <p className="text-xs text-gray-500">{om.price.toLocaleString('pl-PL')} {om.currency}</p>
                      )}
                    </div>
                    <span className={`text-lg font-bold ${scoreText} shrink-0`}>{pct}%</span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-1.5">
                    <div className={`${barColor} h-1.5 rounded-full`} style={{ width: `${pct}%` }} />
                  </div>
                  <p className="text-xs text-gray-500 italic">{om.recommendation}</p>
                  {messagesToText([...(om.blockedBy ?? []), ...(om.warnings ?? [])]).map((note) => (
                    <p key={note} className={`text-xs ${om.blockedBy?.length ? 'text-red-600' : 'text-amber-600'}`}>{note}</p>
                  ))}
                  <Link href={`/offers/${om.offerId}`} className="text-xs text-brand-600 hover:underline">
                    Zobacz ofertę →
                  </Link>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
