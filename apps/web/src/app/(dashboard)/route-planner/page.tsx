'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { apiClient } from '@/lib/api-client';
import { apiErrorText } from '@/lib/api-error';
import { messagesToText, type PlanMessage } from '@/lib/plan-messages';
import { freightFromQuery } from '@/lib/route-planner-link';

// Dynamic import — pure Leaflet, no SSR
const RouteMap = dynamic(() => import('./route-map-client'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-gray-50 rounded-xl">
      <div className="text-center text-gray-400">
        <div className="h-8 w-8 mx-auto mb-3 animate-spin rounded-full border-4 border-gray-200 border-t-blue-600" />
        <p className="text-sm">Ładowanie mapy...</p>
      </div>
    </div>
  ),
});

// ─── Country flag emoji map ─────────────────────────────────────────────────

const FLAGS: Record<string, string> = {
  DE: '🇩🇪', PL: '🇵🇱', NL: '🇳🇱', FR: '🇫🇷', BE: '🇧🇪', CZ: '🇨🇿',
  AT: '🇦🇹', IT: '🇮🇹', ES: '🇪🇸', SE: '🇸🇪', DK: '🇩🇰', HU: '🇭🇺',
  SK: '🇸🇰', RO: '🇷🇴', LT: '🇱🇹', CH: '🇨🇭', BG: '🇧🇬', SI: '🇸🇮',
  HR: '🇭🇷', LV: '🇱🇻', GB: '🇬🇧', IE: '🇮🇪', PT: '🇵🇹', FI: '🇫🇮',
  NO: '🇳🇴', EE: '🇪🇪', LU: '🇱🇺',
};

// ─── Geocoding (Nominatim) ──────────────────────────────────────────────────

async function geocode(query: string): Promise<{ lat: number; lng: number } | null> {
  if (!query.trim()) return null;
  // null = the service answered but does not know the place. A network or
  // service error propagates as an exception, so it is never shown as "not found".
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`,
    { headers: { 'Accept-Language': 'pl' } },
  );
  if (!res.ok) throw new Error(`Usługa wyszukiwania miejsc odpowiedziała błędem ${res.status}.`);
  const data = await res.json();
  if (data.length > 0) {
    return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
  }
  return null;
}

// ─── Types ──────────────────────────────────────────────────────────────────

interface RouteResult {
  index: number;
  label: string;
  distanceKm: number;
  durationMin: number;
  durationFormatted: string;
  polyline: string;
  sections: any[];
  costs: {
    /** The company cost per km × km (without tolls); `null` — the company has no cost per km (OFFER_COST_RATE_MISSING). */
    perKm: { rate: number; currency: string; amount: number; amountPLN: number; amountEUR: number } | null;
    tolls: {
      /** Toll provider name; `null` = no provider connected (toll not computed). */
      source: string | null;
      complete: boolean;
      /** `null` without a provider — never 0. */
      totalEUR: number | null;
      totalPLN: number | null;
      breakdown: {
        country: string;
        countryCode: string;
        system: string;
        distanceKm: number;
        amount: number;
        currency: string;
        costEUR: number;
      }[];
    };
    /** The per-km part + toll; `null` without a company cost per km. */
    totalCostPLN: number | null;
    totalCostEUR: number | null;
    costPerKmPLN: number | null;
    costPerKmEUR: number | null;
    /** false = total without toll (no provider, or an amount without a rate). */
    complete: boolean;
    /** TOLL_PROVIDER_NOT_CONFIGURED, FX_RATE_STATIC, OFFER_COST_RATE_MISSING… */
    messages?: PlanMessage[];
  };
  margin?: {
    freightRate: number;
    currency: string;
    /** `null` — the freight currency has no exchange rate; the reason is in `messages`. */
    totalCostInCurrency: number | null;
    marginValue: number | null;
    marginPercent: number | null;
    pricePerKm: number;
    /** false = margin on a cost without toll. */
    complete?: boolean;
    messages?: PlanMessage[];
  };
}

interface ApiResponse {
  routes: RouteResult[];
  recommendation: {
    recommendedIndex: number;
    reason: string;
  };
  countryRestrictions: any[];
}

// ─── Label badge colors ─────────────────────────────────────────────────────

function labelColor(label: string): string {
  if (label.includes('Najtańsza')) return 'bg-green-100 text-green-700 border-green-200';
  if (label.includes('Najszybsza')) return 'bg-blue-100 text-blue-700 border-blue-200';
  if (label.includes('Najkrótsza')) return 'bg-amber-100 text-amber-700 border-amber-200';
  return 'bg-gray-100 text-gray-600 border-gray-200';
}

function marginColor(pct: number): string {
  if (pct >= 20) return 'text-green-600';
  if (pct >= 10) return 'text-amber-600';
  return 'text-red-600';
}

function routeBorderColor(index: number): string {
  const colors = ['border-green-500', 'border-blue-500', 'border-orange-500', 'border-purple-500', 'border-amber-500', 'border-rose-500'];
  return colors[index] || 'border-gray-300';
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function RoutePlannerPage() {
  const searchParams = useSearchParams();
  const [offerId, setOfferId] = useState<string | null>(null);

  // Form state
  const [originText, setOriginText] = useState('');
  const [destText, setDestText] = useState('');
  const [waypoints, setWaypoints] = useState<string[]>([]);

  const [grossWeight, setGrossWeight] = useState(40);
  const [height, setHeight] = useState(4.0);
  const [width, setWidth] = useState(2.55);
  const [length, setLength] = useState(16.5);
  // Empty = the forwarder did not choose. The server then assumes 5+ and records
  // that the class was assumed, not chosen — that is why '5' is not filled in here.
  const [axleCount, setAxleCount] = useState('');
  const [euroClass, setEuroClass] = useState('Euro6');
  const [hasAdr, setHasAdr] = useState(false);
  const [adrClass, setAdrClass] = useState('3');

  const [freightRate, setFreightRate] = useState('');
  const [currency, setCurrency] = useState<'PLN' | 'EUR'>('PLN');
  const [freightNotice, setFreightNotice] = useState<string | null>(null);

  // Validation
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | null>>({});
  const [fieldTouched, setFieldTouched] = useState<Record<string, boolean>>({});

  const LIMITS: Record<string, { min: number; max: number; label: string }> = {
    grossWeight: { min: 3.5, max: 44, label: 'Masa' },
    height: { min: 2.0, max: 4.5, label: 'Wysokość' },
    width: { min: 2.0, max: 2.6, label: 'Szerokość' },
    length: { min: 5, max: 18.75, label: 'Długość' },
    freightRate: { min: 1, max: 500000, label: 'Stawka frachtu' },
  };

  function validateNum(key: string, value: number | string): string | null {
    const lim = LIMITS[key];
    if (!lim) return null;
    const n = typeof value === 'string' ? parseFloat(value) : value;
    if (isNaN(n) || value === '') return null; // optional or empty
    if (n < lim.min) return `Min. ${lim.min}`;
    if (n > lim.max) return `Max. ${lim.max}`;
    return null;
  }

  function blurNum(key: string, value: number | string) {
    setFieldTouched((p) => ({ ...p, [key]: true }));
    setFieldErrors((p) => ({ ...p, [key]: validateNum(key, value) }));
  }

  const hasFormErrors = Object.values(fieldErrors).some((e) => e !== null && e !== undefined);

  // Results state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ApiResponse | null>(null);
  const [activeRoute, setActiveRoute] = useState(0);

  // Coordinates (resolved from geocoding)
  const [originCoords, setOriginCoords] = useState<[number, number] | null>(null);
  const [destCoords, setDestCoords] = useState<[number, number] | null>(null);

  // Toll breakdown expand
  const [expandedTolls, setExpandedTolls] = useState<Record<number, boolean>>({});

  // ─── Auto-fill from URL params (from offer detail "Planuj trase") ─────
  useEffect(() => {
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    if (from) setOriginText(from);
    if (to) setDestText(to);
    // The rate only together with its currency — never a EUR price as PLN.
    const linked = freightFromQuery(searchParams);
    if (linked.freight) setFreightRate(linked.freight);
    setCurrency(linked.currency);
    setFreightNotice(linked.notice);
    // Without it the backend does not know which offer the route is for, and the
    // result is lost once the response is sent. No parameter = the planner as a standalone tool.
    setOfferId(searchParams.get('offerId'));
  }, [searchParams]);

  // ─── Waypoints ──────────────────────────────────────────────────────────

  function addWaypoint() {
    if (waypoints.length < 3) setWaypoints([...waypoints, '']);
  }

  function removeWaypoint(i: number) {
    setWaypoints(waypoints.filter((_, idx) => idx !== i));
  }

  function updateWaypoint(i: number, val: string) {
    const copy = [...waypoints];
    copy[i] = val;
    setWaypoints(copy);
  }

  // ─── Submit ─────────────────────────────────────────────────────────────

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!originText.trim() || !destText.trim()) {
      setError('Podaj punkt A i punkt B');
      return;
    }

    setLoading(true);
    try {
      // Geocode origin and destination
      const [originGeo, destGeo] = await Promise.all([
        geocode(originText),
        geocode(destText),
      ]);

      if (!originGeo) {
        setError(`Nie znaleziono lokalizacji: "${originText}"`);
        return;
      }
      if (!destGeo) {
        setError(`Nie znaleziono lokalizacji: "${destText}"`);
        return;
      }

      setOriginCoords([originGeo.lat, originGeo.lng]);
      setDestCoords([destGeo.lat, destGeo.lng]);

      // Geocode waypoints
      const waypointCoords: { lat: number; lng: number }[] = [];
      for (const wp of waypoints) {
        if (wp.trim()) {
          const geo = await geocode(wp);
          // An unknown waypoint is an error, not a route without it.
          if (!geo) {
            setError(`Nie znaleziono punktu pośredniego: "${wp}"`);
            return;
          }
          waypointCoords.push(geo);
        }
      }

      // Build request
      const payload: any = {
        origin: { lat: originGeo.lat, lng: originGeo.lng, address: originText },
        destination: { lat: destGeo.lat, lng: destGeo.lng, address: destText },
        vehicle: {
          grossWeight: grossWeight * 1000, // t → kg
          height,
          width,
          length,
          ...(axleCount && { axleCount: parseInt(axleCount) }),
          euroClass,
          hasAdr,
          ...(hasAdr && { adrClass }),
        },
        maxAlternatives: 3,
      };

      if (waypointCoords.length > 0) {
        payload.waypoints = waypointCoords;
      }

      const rate = parseFloat(freightRate);
      if (rate > 0) {
        payload.freightRate = rate;
        payload.currency = currency;
      }

      // When the route is for a specific offer, the backend saves the result with it (only with a complete toll from a provider).
      if (offerId) {
        payload.offerId = offerId;
      }

      const res = await apiClient.post('/route-planner/calculate', payload);
      setResult(res.data);
      setActiveRoute(0);
      setExpandedTolls({});
    } catch (err: any) {
      // API response → a sentence from the dictionary; no response (network, place lookup) → the error text.
      setError(err.response
        ? apiErrorText(err.response.data, 'Błąd obliczania trasy')
        : `Błąd połączenia: ${err.message ?? 'brak odpowiedzi'}`);
    } finally {
      setLoading(false);
    }
  }

  // ─── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="lg:h-[calc(100vh-3rem)]">
      {/* Header */}
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-gray-900">Planowanie trasy</h1>
        <p className="text-sm text-gray-500 mt-1">
          Kalkulacja trasy dla ciężarówki z mytem, kosztem kilometra firmy i marżą
        </p>
      </div>

      <div className="flex flex-col lg:flex-row gap-4 lg:h-[calc(100%-4rem)]">
        {/* ─── Left panel: Form + Results ─────────────────────────────── */}
        <div className="w-full lg:w-1/2 lg:overflow-y-auto lg:pr-2 space-y-4">
          <form onSubmit={handleSubmit}>
            {/* Route points */}
            <div className="bg-white rounded-xl border shadow-sm p-5 space-y-3">
              <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Trasa</h2>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  🟢 Punkt A (załadunek)
                </label>
                <input
                  type="text"
                  value={originText}
                  onChange={(e) => setOriginText(e.target.value)}
                  placeholder="np. Poznań, Polska"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>

              {waypoints.map((wp, i) => (
                <div key={i} className="flex gap-2">
                  <div className="flex-1">
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      📍 Przystanek {i + 1}
                    </label>
                    <input
                      type="text"
                      value={wp}
                      onChange={(e) => updateWaypoint(i, e.target.value)}
                      placeholder="np. Berlin, Niemcy"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeWaypoint(i)}
                    className="self-end mb-0.5 text-red-400 hover:text-red-600 text-sm px-2 py-2"
                  >
                    ✕
                  </button>
                </div>
              ))}

              {waypoints.length < 3 && (
                <button
                  type="button"
                  onClick={addWaypoint}
                  className="text-brand-600 hover:text-brand-700 text-xs font-medium"
                >
                  + Dodaj przystanek
                </button>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  🔴 Punkt B (rozładunek)
                </label>
                <input
                  type="text"
                  value={destText}
                  onChange={(e) => setDestText(e.target.value)}
                  placeholder="np. Hamburg, Niemcy"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>
            </div>

            {/* Vehicle */}
            <div className="bg-white rounded-xl border shadow-sm p-5 space-y-3 mt-4">
              <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Pojazd</h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Masa całkowita (t)</label>
                  <input
                    type="number"
                    value={grossWeight}
                    onChange={(e) => { setGrossWeight(parseFloat(e.target.value) || 0); if (fieldTouched.grossWeight) setFieldErrors((p) => ({ ...p, grossWeight: validateNum('grossWeight', e.target.value) })); }}
                    onBlur={() => blurNum('grossWeight', grossWeight)}
                    min={3.5} max={44} step="0.5"
                    className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 ${fieldErrors.grossWeight && fieldTouched.grossWeight ? 'border-red-400 ring-1 ring-red-200' : 'border-gray-300'}`}
                  />
                  {fieldErrors.grossWeight && fieldTouched.grossWeight && <p className="text-xs text-red-500 mt-1">{fieldErrors.grossWeight}</p>}
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Wysokość (m)</label>
                  <input
                    type="number"
                    value={height}
                    onChange={(e) => { setHeight(parseFloat(e.target.value) || 0); if (fieldTouched.height) setFieldErrors((p) => ({ ...p, height: validateNum('height', e.target.value) })); }}
                    onBlur={() => blurNum('height', height)}
                    min={2.0} max={4.5} step="0.05"
                    className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 ${fieldErrors.height && fieldTouched.height ? 'border-red-400 ring-1 ring-red-200' : 'border-gray-300'}`}
                  />
                  {fieldErrors.height && fieldTouched.height && <p className="text-xs text-red-500 mt-1">{fieldErrors.height}</p>}
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Szerokość (m)</label>
                  <input
                    type="number"
                    value={width}
                    onChange={(e) => { setWidth(parseFloat(e.target.value) || 0); if (fieldTouched.width) setFieldErrors((p) => ({ ...p, width: validateNum('width', e.target.value) })); }}
                    onBlur={() => blurNum('width', width)}
                    min={2.0} max={2.6} step="0.05"
                    className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 ${fieldErrors.width && fieldTouched.width ? 'border-red-400 ring-1 ring-red-200' : 'border-gray-300'}`}
                  />
                  {fieldErrors.width && fieldTouched.width && <p className="text-xs text-red-500 mt-1">{fieldErrors.width}</p>}
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Długość (m)</label>
                  <input
                    type="number"
                    value={length}
                    onChange={(e) => { setLength(parseFloat(e.target.value) || 0); if (fieldTouched.length) setFieldErrors((p) => ({ ...p, length: validateNum('length', e.target.value) })); }}
                    onBlur={() => blurNum('length', length)}
                    min={5} max={18.75} step="0.5"
                    className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 ${fieldErrors.length && fieldTouched.length ? 'border-red-400 ring-1 ring-red-200' : 'border-gray-300'}`}
                  />
                  {fieldErrors.length && fieldTouched.length && <p className="text-xs text-red-500 mt-1">{fieldErrors.length}</p>}
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Liczba osi zestawu</label>
                  <select
                    value={axleCount}
                    onChange={(e) => setAxleCount(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white"
                  >
                    <option value="">5+ (domyślnie)</option>
                    <option value="2">2 osie</option>
                    <option value="3">3 osie</option>
                    <option value="4">4 osie</option>
                    <option value="5">5+ osi</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Klasa Euro</label>
                  <select
                    value={euroClass}
                    onChange={(e) => setEuroClass(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white"
                  >
                    <option value="Euro6">Euro 6</option>
                    <option value="Euro5">Euro 5</option>
                    <option value="Euro4">Euro 4</option>
                    <option value="Euro3">Euro 3</option>
                  </select>
                </div>
              </div>

              <label className="flex items-center gap-3 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={hasAdr}
                  onChange={(e) => setHasAdr(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                />
                <span className="text-sm font-medium text-gray-700">Ładunek ADR (materiały niebezpieczne)</span>
              </label>

              {hasAdr && (
                <div className="ml-7">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Klasa ADR</label>
                  <select
                    value={adrClass}
                    onChange={(e) => setAdrClass(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white"
                  >
                    <option value="1">1 — Materiały wybuchowe</option>
                    <option value="2">2 — Gazy</option>
                    <option value="3">3 — Ciecze zapalne</option>
                    <option value="4">4 — Ciała stałe zapalne</option>
                    <option value="5">5 — Materiały utleniające</option>
                    <option value="6">6 — Materiały trujące</option>
                    <option value="7">7 — Materiały promieniotwórcze</option>
                    <option value="8">8 — Materiały żrące</option>
                    <option value="9">9 — Inne materiały niebezpieczne</option>
                  </select>
                </div>
              )}
            </div>

            {/* Costs */}
            <div className="bg-white rounded-xl border shadow-sm p-5 space-y-3 mt-4">
              <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Koszty i stawka</h2>

              {/* The route cost = the company cost per km × km + toll — no fuel is entered here. */}
              <p className="text-xs text-gray-500">
                Koszt liczony z kosztu kilometra firmy (bez myta) × km trasy + myto.{' '}
                <a href="/settings" className="text-brand-600 hover:underline">Koszt kilometra ustawia administrator w ustawieniach firmy.</a>
              </p>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Stawka frachtu ({currency}) — opcjonalne
                </label>
                {freightNotice && <p className="text-xs text-amber-700 mb-1">{freightNotice}</p>}
                <input
                  type="number"
                  value={freightRate}
                  onChange={(e) => { setFreightRate(e.target.value); if (fieldTouched.freightRate) setFieldErrors((p) => ({ ...p, freightRate: validateNum('freightRate', e.target.value) })); }}
                  onBlur={() => blurNum('freightRate', freightRate)}
                  placeholder="np. 5800"
                  min={1} max={500000} step="1"
                  className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 ${fieldErrors.freightRate && fieldTouched.freightRate ? 'border-red-400 ring-1 ring-red-200' : 'border-gray-300'}`}
                />
                {fieldErrors.freightRate && fieldTouched.freightRate && <p className="text-xs text-red-500 mt-1">{fieldErrors.freightRate}</p>}
                <p className="text-xs text-gray-400 mt-1">Jeśli podasz stawkę, system wyliczy marżę na każdej trasie</p>
              </div>

              {/* Currency toggle */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Waluta wyświetlania</label>
                <div className="inline-flex rounded-lg border border-gray-300 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setCurrency('PLN')}
                    className={`px-4 py-2 text-sm font-medium transition ${currency === 'PLN' ? 'bg-brand-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                  >
                    PLN
                  </button>
                  <button
                    type="button"
                    onClick={() => setCurrency('EUR')}
                    className={`px-4 py-2 text-sm font-medium transition ${currency === 'EUR' ? 'bg-brand-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                  >
                    EUR
                  </button>
                </div>
              </div>
            </div>

            {/* Submit button */}
            <button
              type="submit"
              disabled={loading || hasFormErrors}
              className="w-full mt-4 bg-brand-600 text-white px-6 py-3 rounded-xl text-sm font-semibold hover:bg-brand-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? '⏳ Obliczanie trasy...' : '🗺️ Oblicz trasę'}
            </button>
          </form>

          {/* Error */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-600">
              {error}
            </div>
          )}

          {/* Loading skeleton */}
          {loading && (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="bg-white rounded-xl border shadow-sm p-5 animate-pulse">
                  <div className="h-4 bg-gray-200 rounded w-1/3 mb-3" />
                  <div className="h-3 bg-gray-200 rounded w-2/3 mb-2" />
                  <div className="h-3 bg-gray-200 rounded w-1/2" />
                </div>
              ))}
            </div>
          )}

          {/* Results */}
          {result && !loading && (
            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
                Znalezione trasy ({result.routes.length})
              </h2>

              {result.routes.map((route, i) => (
                <div
                  key={i}
                  onClick={() => setActiveRoute(i)}
                  className={`bg-white rounded-xl border-2 shadow-sm p-5 cursor-pointer transition ${
                    activeRoute === i
                      ? `${routeBorderColor(i)} ring-1 ring-offset-1`
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  {/* Header with label */}
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold border ${labelColor(route.label)}`}>
                        {route.label}
                      </span>
                      {i === result.recommendation.recommendedIndex && (
                        <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-brand-100 text-brand-700 border border-brand-200">
                          ⭐ Rekomendowana
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Stats */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
                    <div>
                      <p className="text-xs text-gray-500">Dystans</p>
                      <p className="text-lg font-bold text-gray-900">{route.distanceKm} km</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Czas jazdy</p>
                      <p className="text-lg font-bold text-gray-900">{route.durationFormatted}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Łączny koszt{route.costs.complete ? '' : ' (bez myta — niepełny)'}</p>
                      <p className={`text-lg font-bold ${route.costs.complete ? 'text-gray-900' : 'text-amber-700'}`}>
                        {(currency === 'PLN' ? route.costs.totalCostPLN : route.costs.totalCostEUR) ?? '—'} {currency}
                      </p>
                    </div>
                  </div>

                  {/* Cost breakdown */}
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="bg-gray-50 rounded-lg px-3 py-2">
                      <p className="text-xs text-gray-500">🚚 Koszt kilometra firmy</p>
                      {route.costs.perKm ? (
                        <p className="font-medium text-gray-800">
                          {currency === 'PLN' ? route.costs.perKm.amountPLN : route.costs.perKm.amountEUR} {currency}
                          <span className="text-xs text-gray-400 ml-1">
                            ({route.costs.perKm.rate} {route.costs.perKm.currency}/km × {route.distanceKm} km)
                          </span>
                        </p>
                      ) : (
                        <p className="text-xs text-amber-700">
                          brak — <a href="/settings" className="underline">ustaw w ustawieniach firmy</a>
                        </p>
                      )}
                    </div>
                    <div className="bg-gray-50 rounded-lg px-3 py-2">
                      <p className="text-xs text-gray-500">🛣️ Myto</p>
                      <p className="font-medium text-gray-800">
                        {route.costs.tolls.totalEUR === null
                          ? <span className="text-amber-700">— nie policzono</span>
                          : <>{currency === 'PLN' ? route.costs.tolls.totalPLN : route.costs.tolls.totalEUR} {currency}</>}
                      </p>
                      {route.costs.tolls.source && (
                        <p className="text-[10px] text-gray-400">źródło: {route.costs.tolls.source}</p>
                      )}
                    </div>
                  </div>
                  {messagesToText(route.costs.messages ?? []).map((note) => (
                    <p key={note} className="text-xs text-gray-400 mt-1">{note}</p>
                  ))}

                  {/* Toll breakdown */}
                  {route.costs.tolls.breakdown.length > 0 && (
                    <div className="mt-2">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setExpandedTolls((prev) => ({ ...prev, [i]: !prev[i] }));
                        }}
                        className="text-xs text-brand-600 hover:text-brand-700 font-medium"
                      >
                        {expandedTolls[i] ? '▾ Ukryj szczegóły myta' : '▸ Pokaż szczegóły myta'}
                      </button>

                      {expandedTolls[i] && (
                        <div className="mt-2 space-y-1">
                          {route.costs.tolls.breakdown.map((toll, ti) => (
                            <div
                              key={ti}
                              className="flex items-center justify-between text-xs bg-gray-50 rounded-lg px-3 py-1.5"
                            >
                              <div className="flex items-center gap-2">
                                <span>{FLAGS[toll.countryCode] || '🏳️'}</span>
                                <span className="font-medium text-gray-700">{toll.country}</span>
                                <span className="text-gray-400">({toll.system})</span>
                              </div>
                              <div className="text-right">
                                <span className="font-semibold text-gray-800">{toll.amount} {toll.currency}</span>
                                {toll.currency !== 'EUR' && <span className="text-gray-400 ml-1">({toll.costEUR} EUR)</span>}
                                {toll.distanceKm > 0 && (
                                  <span className="text-gray-400 ml-1">/ {toll.distanceKm} km</span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Margin */}
                  {route.margin && (
                    <div className="mt-3 bg-gray-50 rounded-lg px-3 py-2 flex items-center justify-between">
                      <div>
                        <p className="text-xs text-gray-500">📈 Marża{route.margin.complete === false ? ' (bez myta — niepełna)' : ''}</p>
                        {route.margin.marginPercent !== null ? (
                          <p className={`text-lg font-bold ${marginColor(route.margin.marginPercent)}`}>
                            {route.margin.marginPercent}%
                            <span className="text-sm font-medium ml-1">
                              ({route.margin.marginValue} {route.margin.currency})
                            </span>
                          </p>
                        ) : (
                          <p className="text-lg font-bold text-gray-400">—</p>
                        )}
                        {messagesToText(route.margin.messages ?? []).map((note) => (
                          <p key={note} className="text-xs text-gray-400">{note}</p>
                        ))}
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-gray-500">Stawka/km</p>
                        <p className="text-sm font-semibold text-gray-700">
                          {route.margin.pricePerKm} {route.margin.currency}/km
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Per km cost */}
                  <div className="mt-2 text-xs text-gray-400 text-right">
                    Koszt/km: {(currency === 'PLN' ? route.costs.costPerKmPLN : route.costs.costPerKmEUR) ?? '—'} {currency}/km
                  </div>
                </div>
              ))}

              {/* Recommendation */}
              {result.recommendation && (
                <div className="bg-brand-50 border border-brand-200 rounded-xl px-4 py-3">
                  <p className="text-xs font-semibold text-brand-700 uppercase mb-1">💡 Rekomendacja</p>
                  <p className="text-sm text-brand-800">{result.recommendation.reason}</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ─── Right panel: Map ───────────────────────────────────────── */}
        <div className="w-full lg:w-1/2 h-[400px] lg:h-auto bg-white rounded-xl border shadow-sm overflow-hidden">
          {result ? (
            <RouteMap
              routes={result.routes}
              activeIndex={activeRoute}
              onSelectRoute={setActiveRoute}
              originCoords={originCoords}
              destCoords={destCoords}
              originLabel={originText}
              destLabel={destText}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-gray-50">
              <div className="text-center text-gray-400">
                <p className="text-4xl mb-3">🗺️</p>
                <p className="text-sm font-medium">Wprowadź trasę i kliknij &quot;Oblicz trasę&quot;</p>
                <p className="text-xs mt-1">Mapa z alternatywnymi trasami pojawi się tutaj</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
