'use client';

import { vehicleOptionLabel } from '@/lib/vehicle-label';
import { missingSpaceText, vehicleSpace } from '@/lib/vehicle-space';
import Link from 'next/link';
import { useState, useEffect, useMemo, useCallback } from 'react';
import { apiClient } from '@/lib/api-client';
import { apiErrorText } from '@/lib/api-error';
import { messageText, type PlanMessage } from '@/lib/plan-messages';
import { formatMoney } from '@/lib/formatting';
import { ltlCarriers } from '@/lib/vehicle-categories';
import { acceptBlock } from '@/lib/blacklist-accept';
import { useAuthStore } from '@/store/auth.store';
import { viewFromError, viewFromResponse, missingLoadText, moreUnmeasurable, type LtlSearchView, type UnmeasurableOffer } from '@/lib/ltl-search';
import { loadPlanItem } from '@/lib/load-plan';

// ─── Types ──────────────────────────────────────────────────────────────────

interface Vehicle {
  id: string;
  plateNumber: string;
  vehicleType: string;
  trailerType: string | null;
  maxWeightKg: number | null;
  maxLoadingMeters: number | null;
  maxPalletCount: number | null;
  status: string;
  brand: string | null;
  model: string | null;
  axleCount: number | null;
  vehicleCategory: string | null;
  parentVehicleId: string | null;
}


interface Capacity {
  vehicleId: string;
  plateNumber: string;
  maxLoadingMeters: number;
  maxWeightKg: number;
  maxPalletCount: number;
  currentLoadMeters: number;
  currentLoadWeightKg: number;
  freeMeters: number;
  freeWeightKg: number;
  freePallets: number;
  utilizationMetersPercent: number;
  utilizationWeightPercent: number;
}

/** Offer value from the API (ltl-matching/offer-value.ts) — the list is ordered by it. */
interface OfferValue {
  /** Profit or revenue in the company currency; `null` = cannot be calculated (the offer goes last). */
  amount: number | null;
  currency: string;
  basis: 'PROFIT' | 'REVENUE';
  detourKm: number;
  detourCost: number | null;
  detourToll: number | null;
  thresholdPrice: number | null;
  codes: PlanMessage[];
}

interface LtlMatch {
  offerId: string;
  /** How well the load fits the vehicle, 0–100 — information only, not the order. */
  fitScore: number;
  externalId: string | null;
  source: string;
  pickupCity: string;
  pickupCountry: string;
  deliveryCity: string;
  deliveryCountry: string;
  pickupDate: string;
  cargoType: string | null;
  weightKg: number | null;
  lengthM: number | null;
  palletCount: number | null;
  price: number | null;
  currency: string;
  contractorName: string | null;
  contractorReliability: number | null;
  detourKm: number;
  detourPercent: number;
  metersNeeded: number;
  /** Where the detour figure comes from — e.g. "approximate route". */
  warnings: PlanMessage[];
  scoring: Record<string, number>;
  value: OfferValue;
  /** COUNTERPARTY_RISK or null — shown next to the amount, does not change the order. */
  counterpartyRisk: PlanMessage | null;
  /** OFFER_CONTRACTOR_BLACKLISTED — the offer last, acceptance blocked. */
  blockedBy: PlanMessage[];
}

/** A live offer that does not fit the vehicle — with the reasons (ADR, reefer, availability). */
interface IncompatibleOffer {
  offerId: string;
  pickupCity: string;
  pickupCountry: string;
  deliveryCity: string;
  deliveryCountry: string;
  pickupDate: string;
  reasons: PlanMessage[];
}

interface AcceptedOffer {
  id: string;
  pickupCity: string;
  pickupCountry: string;
  deliveryCity: string;
  deliveryCountry: string;
  weightKg: number | null;
  lengthM: number | null;
  palletCount: number | null;
  cargoType: string | null;
  clientName: string | null;
  price: number | null;
  currency: string;
}

interface LoadPlanOffer {
  offerId: string;
  weight: number;
  meters: number;
  description: string;
  loadingCity: string;
  unloadingCity: string;
  position: number;
}

interface LoadPlanPosition {
  position: number;
  offerId: string;
  description: string;
  loadingCity: string;
  unloadingCity: string;
  weightKg: number;
  meters: number;
  startM: number;
  endM: number;
  cumulativeWeightKg: number;
  cumulativeMeters: number;
  warnings: PlanMessage[];
}

interface LoadPlanResult {
  vehicleId: string;
  maxMeters: number;
  maxWeightKg: number;
  totalWeightKg: number;
  totalMeters: number;
  freeMeters: number;
  freeWeightKg: number;
  positions: LoadPlanPosition[];
  isValid: boolean;
  warnings: PlanMessage[];
}

const LOAD_COLORS = ['#3b82f6', '#22c55e', '#f97316', '#8b5cf6', '#eab308', '#ec4899'];

const FLAGS: Record<string, string> = {
  DE: '\u{1F1E9}\u{1F1EA}', PL: '\u{1F1F5}\u{1F1F1}', NL: '\u{1F1F3}\u{1F1F1}',
  FR: '\u{1F1EB}\u{1F1F7}', BE: '\u{1F1E7}\u{1F1EA}', CZ: '\u{1F1E8}\u{1F1FF}',
  AT: '\u{1F1E6}\u{1F1F9}', IT: '\u{1F1EE}\u{1F1F9}', ES: '\u{1F1EA}\u{1F1F8}',
  SE: '\u{1F1F8}\u{1F1EA}', DK: '\u{1F1E9}\u{1F1F0}', HU: '\u{1F1ED}\u{1F1FA}',
  SK: '\u{1F1F8}\u{1F1F0}', RO: '\u{1F1F7}\u{1F1F4}', LT: '\u{1F1F1}\u{1F1F9}',
  CH: '\u{1F1E8}\u{1F1ED}', HR: '\u{1F1ED}\u{1F1F7}',
};

const VEHICLE_ICON: Record<string, string> = {
  TRUCK: '\u{1F69B}', SEMI_TRAILER: '\u{1F69B}', CURTAINSIDER: '\u{1F6A8}',
  REEFER: '\u2744\uFE0F', MEGA: '\u{1F69B}', BOX: '\u{1F4E6}',
  TANKER: '\u{1F6E2}\uFE0F', FLATBED: '\u{1F6FB}', VAN: '\u{1F690}',
};

/** The offer-value code that is about the company (no cost per km) — shown once above the list. */
const COMPANY_LEVEL_CODE = 'DETOUR_COST_UNKNOWN';

function scoreColor(s: number) {
  if (s >= 70) return 'bg-green-100 text-green-700 border-green-300';
  if (s >= 40) return 'bg-amber-100 text-amber-700 border-amber-300';
  return 'bg-red-100 text-red-700 border-red-300';
}

function pctColor(pct: number) {
  if (pct >= 90) return 'text-red-400';
  if (pct >= 70) return 'text-amber-400';
  return 'text-green-400';
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function LtlMatchingPage() {
  // Vehicle list
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [vehiclesLoading, setVehiclesLoading] = useState(true);
  const [selectedVehicleId, setSelectedVehicleId] = useState('');

  // Form
  const [loadMeters, setLoadMeters] = useState(0);
  const [loadWeight, setLoadWeight] = useState(0);
  const [routeFrom, setRouteFrom] = useState('');
  const [routeTo, setRouteTo] = useState('');
  const [maxDetour, setMaxDetour] = useState(100);

  // Results
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [capacity, setCapacity] = useState<Capacity | null>(null);
  const [matches, setMatches] = useState<LtlMatch[]>([]);
  /** Notes about the whole result (e.g. "approximate route") — once above the list. */
  const [notices, setNotices] = useState<PlanMessage[]>([]);
  /** Offers without an amount (no price / exchange rate) beyond the API limit — a count only. */
  const [hiddenWithoutAmount, setHiddenWithoutAmount] = useState(0);
  /** Blacklisted offers over the API limit (10) — the count only. */
  const [hiddenBlocked, setHiddenBlocked] = useState(0);
  const role = useAuthStore((s) => s.user?.role);
  const [incompatible, setIncompatible] = useState<IncompatibleOffer[]>([]);
  /** Offers without coordinates — not ranked, waiting for geocoding. */
  const [awaitingLocation, setAwaitingLocation] = useState<IncompatibleOffer[]>([]);
  const [hiddenAwaitingLocation, setHiddenAwaitingLocation] = useState(0);
  /** Offers without weight or dimensions — outside the capacity computation. */
  const [unmeasurable, setUnmeasurable] = useState<UnmeasurableOffer[]>([]);
  const [unmeasurableTotal, setUnmeasurableTotal] = useState(0);
  const [hoveredOffer, setHoveredOffer] = useState<string | null>(null);
  const [simulatedOffer, setSimulatedOffer] = useState<string | null>(null);

  // Load planning state
  const [acceptedOffers, setAcceptedOffers] = useState<AcceptedOffer[]>([]);
  const [loadPlanOffers, setLoadPlanOffers] = useState<LoadPlanOffer[]>([]);
  const [loadPlanResult, setLoadPlanResult] = useState<LoadPlanResult | null>(null);
  const [loadPlanLoading, setLoadPlanLoading] = useState(false);
  const [loadPlanError, setLoadPlanError] = useState('');
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [loadPlanConfirmModal, setLoadPlanConfirmModal] = useState(false);

  const selectedVehicle = vehicles.find((v) => v.id === selectedVehicleId);
  // Only from the vehicle record: missing = a notice to complete it in Fleet, not an invented 13.6 m / 24 t.
  const space = selectedVehicle ? vehicleSpace(selectedVehicle) : null;
  const spaceKnown = space?.known === true;
  const maxMeters = space?.known ? space.maxMeters : 0;
  const maxWeight = space?.known ? space.maxWeightT : 0;

  // Load vehicles on mount — fetch all (limit=200) and use paginated response format
  useEffect(() => {
    setVehiclesLoading(true);
    apiClient
      .get('/vehicles', { params: { limit: '100' } })
      .then((r) => {
        const list = Array.isArray(r.data) ? r.data : r.data.data ?? [];
        // Only units that carry a load (lib/vehicle-categories: ltlCarriers) —
        // by category, not by vehicleType; a semi-trailer on its own is not a choice.
        setVehicles(ltlCarriers<Vehicle>(list));
      })
      .catch((err) => setError(apiErrorText(err?.response?.data, 'Nie udało się wczytać pojazdów.')))
      .finally(() => setVehiclesLoading(false));
  }, []);

  // Simulated overlay
  const hoveredMatch = useMemo(() => {
    const id = simulatedOffer || hoveredOffer;
    return id ? matches.find((m) => m.offerId === id) : null;
  }, [hoveredOffer, simulatedOffer, matches]);

  // Derived calculations
  const freeMeters = maxMeters - loadMeters;
  const freeWeight = maxWeight - loadWeight;
  const freePallets = Math.floor(freeMeters / 0.4);
  const metersPct = maxMeters > 0 ? (loadMeters / maxMeters) * 100 : 0;
  const weightPct = maxWeight > 0 ? (loadWeight / maxWeight) * 100 : 0;

  /** The whole result at once — no field is left over from the previous search. */
  function showSearch(view: LtlSearchView<Capacity, LtlMatch, IncompatibleOffer>) {
    setCapacity(view.capacity);
    setMatches(view.matches);
    setNotices(view.notices);
    setIncompatible(view.incompatible);
    setAwaitingLocation(view.awaitingLocation);
    setHiddenAwaitingLocation(view.hiddenAwaitingLocation);
    setHiddenWithoutAmount(view.hiddenWithoutAmount);
    setHiddenBlocked(view.hiddenBlocked);
    setUnmeasurable(view.unmeasurable);
    setUnmeasurableTotal(view.unmeasurableTotal);
    setError(view.error);
  }

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedVehicleId) { setError('Wybierz pojazd'); return; }
    if (!routeFrom || !routeTo) { setError('Podaj trasę'); return; }
    setError('');
    setLoading(true);
    try {
      const res = await apiClient.post('/ltl/search', {
        vehicleId: selectedVehicleId,
        currentLoadMeters: loadMeters,
        currentLoadWeight: loadWeight,
        routeFrom,
        routeTo,
        maxDetourKm: maxDetour,
      });
      showSearch(viewFromResponse(res.data));
    } catch (err: any) {
      // An error clears the previous result (lib/ltl-search.ts); API codes
      // (e.g. ROUTE_GEOCODING_FAILED) go through the dictionary, not as raw text.
      showSearch(viewFromError(err.response?.data));
    } finally {
      setLoading(false);
    }
  }

  async function handleAccept(offerId: string) {
    try {
      await apiClient.patch(`/offers/${offerId}/status`, { status: 'ACCEPTED' });
      setMatches((prev) => prev.filter((m) => m.offerId !== offerId));
      // Refresh accepted offers list for load planning
      apiClient
        .get('/offers', { params: { status: 'ACCEPTED', limit: '50' } })
        .then((r) => {
          const list = Array.isArray(r.data) ? r.data : r.data.data ?? [];
          setAcceptedOffers(list);
        })
        .catch((err) => setError(apiErrorText(err?.response?.data, 'Oferta przyjęta, ale nie udało się odświeżyć listy przyjętych.')));
    } catch (err: any) {
      setError(apiErrorText(err?.response?.data, 'Nie udało się przyjąć oferty.'));
    }
  }

  // Fetch accepted offers when vehicle selected
  useEffect(() => {
    if (!selectedVehicleId) { setAcceptedOffers([]); return; }
    apiClient
      .get('/offers', { params: { status: 'ACCEPTED', limit: '50' } })
      .then((r) => {
        const list = Array.isArray(r.data) ? r.data : r.data.data ?? [];
        setAcceptedOffers(list);
      })
      .catch((err) => console.error('Failed to fetch accepted offers:', err?.response?.status, err?.response?.data));
  }, [selectedVehicleId]);

  // Add an offer to the load plan — no invented values (lib/load-plan.ts):
  // an offer without weight or dimensions does not enter the plan.
  function addToLoadPlan(offer: AcceptedOffer) {
    if (loadPlanOffers.some((l) => l.offerId === offer.id)) return;
    const result = loadPlanItem(offer, loadPlanOffers.length + 1);
    if (!result.ok) return;
    const newItem: LoadPlanOffer = result.item;
    const updated = [...loadPlanOffers, newItem];
    setLoadPlanOffers(updated);
    simulateLoadPlan(updated);
  }

  function removeFromLoadPlan(offerId: string) {
    const updated = loadPlanOffers
      .filter((l) => l.offerId !== offerId)
      .map((l, i) => ({ ...l, position: i + 1 }));
    setLoadPlanOffers(updated);
    if (updated.length > 0) {
      simulateLoadPlan(updated);
    } else {
      setLoadPlanResult(null);
    }
  }

  // Simulate load plan (auto-called on changes)
  const simulateLoadPlan = useCallback(async (loads: LoadPlanOffer[]) => {
    if (!selectedVehicleId || loads.length === 0) return;
    setLoadPlanLoading(true);
    try {
      const res = await apiClient.post('/ltl/load-plan/simulate', {
        vehicleId: selectedVehicleId,
        loads: loads.map((l) => ({
          offerId: l.offerId,
          weight: l.weight,
          meters: l.meters,
          description: l.description,
          loadingCity: l.loadingCity,
          unloadingCity: l.unloadingCity,
          position: l.position,
        })),
      });
      setLoadPlanResult(res.data);
      setLoadPlanError('');
    } catch (err: any) {
      setLoadPlanError(apiErrorText(err?.response?.data, 'Nie udało się przeliczyć planu załadunku.'));
    }
    setLoadPlanLoading(false);
  }, [selectedVehicleId]);

  // Drag & drop handlers
  function handleDragStart(index: number) {
    setDraggedIndex(index);
  }

  function handleDragOver(e: React.DragEvent, index: number) {
    e.preventDefault();
    setDragOverIndex(index);
  }

  function handleDrop(index: number) {
    if (draggedIndex === null || draggedIndex === index) {
      setDraggedIndex(null);
      setDragOverIndex(null);
      return;
    }
    const updated = [...loadPlanOffers];
    const [dragged] = updated.splice(draggedIndex, 1);
    updated.splice(index, 0, dragged);
    const reindexed = updated.map((l, i) => ({ ...l, position: i + 1 }));
    setLoadPlanOffers(reindexed);
    setDraggedIndex(null);
    setDragOverIndex(null);
    simulateLoadPlan(reindexed);
  }

  function handleDragEnd() {
    setDraggedIndex(null);
    setDragOverIndex(null);
  }

  // Optimize load plan
  async function handleOptimize() {
    if (!selectedVehicleId || loadPlanOffers.length === 0) return;
    setLoadPlanLoading(true);
    try {
      const res = await apiClient.post('/ltl/load-plan/optimize', {
        vehicleId: selectedVehicleId,
        loads: loadPlanOffers.map((l) => ({
          offerId: l.offerId,
          weight: l.weight,
          meters: l.meters,
          description: l.description,
          loadingCity: l.loadingCity,
          unloadingCity: l.unloadingCity,
          position: l.position,
        })),
      });
      setLoadPlanResult(res.data);
      // Update local order from optimized result
      const optimized = res.data.positions.map((p: LoadPlanPosition) => ({
        offerId: p.offerId,
        weight: p.weightKg,
        meters: p.meters,
        description: p.description,
        loadingCity: p.loadingCity,
        unloadingCity: p.unloadingCity,
        position: p.position,
      }));
      setLoadPlanOffers(optimized);
      setLoadPlanError('');
    } catch (err: any) {
      setLoadPlanError(apiErrorText(err?.response?.data, 'Nie udało się zoptymalizować kolejności.'));
    }
    setLoadPlanLoading(false);
  }

  // Confirm load plan
  async function handleConfirmLoadPlan() {
    if (!selectedVehicleId || loadPlanOffers.length === 0) return;
    setLoadPlanLoading(true);
    try {
      const res = await apiClient.post('/ltl/load-plan', {
        vehicleId: selectedVehicleId,
        loads: loadPlanOffers.map((l) => ({
          offerId: l.offerId,
          weight: l.weight,
          meters: l.meters,
          description: l.description,
          loadingCity: l.loadingCity,
          unloadingCity: l.unloadingCity,
          position: l.position,
        })),
      });
      setLoadPlanResult(res.data);
      setLoadPlanConfirmModal(true);
      setLoadPlanError('');
    } catch (err: any) {
      setLoadPlanError(apiErrorText(err?.response?.data, 'Nie udało się zatwierdzić planu załadunku.'));
    }
    setLoadPlanLoading(false);
  }

  // ─── SVG: Top-down view ─────────────────────────────────────────────────

  function TrailerTopView() {
    const svgW = 560;
    const svgH = 140;
    const trailerW = 500;
    const trailerH = 80;
    const x0 = 40;
    const y0 = 30;
    const mScale = trailerW / maxMeters;
    const occupiedW = loadMeters * mScale;
    const freeW = trailerW - occupiedW;

    const hoveredW = hoveredMatch ? hoveredMatch.metersNeeded * mScale : 0;

    return (
      <svg viewBox={`0 0 ${svgW} ${svgH}`} className="w-full" style={{ maxHeight: '120px' }}>
        {/* Trailer outline */}
        <rect x={x0} y={y0} width={trailerW} height={trailerH} rx={3}
          fill="#1e293b" stroke="#475569" strokeWidth={1.5} />

        {/* Occupied zone (from rear = right side) */}
        {occupiedW > 0 && (
          <>
            <rect x={x0 + freeW} y={y0 + 2} width={occupiedW - 2} height={trailerH - 4} rx={2}
              fill="#334155" />
            <defs>
              <pattern id="hatch" patternUnits="userSpaceOnUse" width="8" height="8">
                <path d="M-1,1 l2,-2 M0,8 l8,-8 M7,9 l2,-2" stroke="#475569" strokeWidth={0.7} />
              </pattern>
            </defs>
            <rect x={x0 + freeW} y={y0 + 2} width={occupiedW - 2} height={trailerH - 4} rx={2}
              fill="url(#hatch)" opacity={0.5} />
          </>
        )}

        {/* Hovered offer preview (yellow zone) */}
        {hoveredW > 0 && freeW > 0 && (
          <rect x={x0 + freeW - hoveredW} y={y0 + 2} width={Math.min(hoveredW, freeW)} height={trailerH - 4} rx={2}
            fill="#facc15" opacity={0.35} stroke="#eab308" strokeWidth={1} strokeDasharray="4 2" />
        )}

        {/* Free zone (green tint) */}
        {freeW > 2 && (
          <rect x={x0 + 2} y={y0 + 2} width={freeW - 2} height={trailerH - 4} rx={2}
            fill="#22c55e" opacity={0.12} />
        )}

        {/* Meter markings */}
        {Array.from({ length: Math.ceil(maxMeters) + 1 }, (_, i) => {
          const mx = x0 + i * mScale;
          return (
            <g key={i}>
              <line x1={mx} y1={y0} x2={mx} y2={y0 + trailerH} stroke="#64748b" strokeWidth={0.5} opacity={0.3} />
              {i % 2 === 0 && (
                <text x={mx} y={y0 + trailerH + 13} textAnchor="middle" fill="#94a3b8" fontSize={9}>{i}m</text>
              )}
            </g>
          );
        })}

        {/* Rear doors indicator */}
        <rect x={x0 + trailerW - 3} y={y0 - 3} width={6} height={trailerH + 6} rx={1}
          fill="none" stroke="#f59e0b" strokeWidth={1.5} />
        <text x={x0 + trailerW + 8} y={y0 + trailerH / 2 + 4} fill="#f59e0b" fontSize={9} fontWeight="bold">{'\u25B6'}</text>

        {/* Labels */}
        {freeW > 40 && (
          <text x={x0 + freeW / 2} y={y0 + trailerH / 2 + 4} textAnchor="middle"
            fill="#4ade80" fontSize={11} fontWeight="bold">
            WOLNE: {(maxMeters - loadMeters).toFixed(1)}m
          </text>
        )}
        {occupiedW > 40 && (
          <text x={x0 + freeW + occupiedW / 2} y={y0 + trailerH / 2 + 4} textAnchor="middle"
            fill="#94a3b8" fontSize={11} fontWeight="bold">
            ZAJĘTE: {loadMeters.toFixed(1)}m
          </text>
        )}

        {/* Arrow direction */}
        <text x={x0 - 5} y={y0 + trailerH / 2 + 4} textAnchor="end" fill="#64748b" fontSize={9}>Przód</text>
      </svg>
    );
  }



  // ─── Render ─────────────────────────────────────────────────────────────

  return (
    <div>
      {/* Header */}
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-gray-900">{'\u{1F4E6}'} Doładunki LTL</h1>
        <p className="text-sm text-gray-500 mt-1">
          Znajdź ładunki częściowe pasujące do wolnej przestrzeni pojazdu
        </p>
      </div>

      {/* Form */}
      <form onSubmit={handleSearch} className="bg-white rounded-xl border shadow-sm p-5 mb-4">
        {/* Row 1: Vehicle + Route */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-gray-600 mb-1">Pojazd</label>
            <select
              value={selectedVehicleId}
              onChange={(e) => {
                setSelectedVehicleId(e.target.value);
                setLoadMeters(0);
                setLoadWeight(0);
                setCapacity(null);
                setMatches([]);
                setNotices([]);
                setHiddenWithoutAmount(0);
                setIncompatible([]);
                setAwaitingLocation([]);
                setHiddenAwaitingLocation(0);
              }}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white"
            >
              <option value="">
                {vehiclesLoading ? 'Ładowanie pojazdów...' : '— Wybierz pojazd —'}
              </option>
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {VEHICLE_ICON[v.vehicleType] || '\u{1F69A}'} {vehicleOptionLabel(v)}
                </option>
              ))}
            </select>
            {!vehiclesLoading && vehicles.length === 0 && (
              <p className="text-xs text-amber-600 mt-1">Brak pojazdów — dodaj pojazdy w zakładce Flota</p>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Trasa z</label>
            <input type="text" value={routeFrom} onChange={(e) => setRouteFrom(e.target.value)}
              placeholder="np. Poznań" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Trasa do</label>
            <input type="text" value={routeTo} onChange={(e) => setRouteTo(e.target.value)}
              placeholder="np. Hamburg" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
          </div>
        </div>

        {/* ── Vehicle parameters panel (shown after vehicle selected) ── */}
        {selectedVehicle && (
          <div className="mt-5 border-t pt-5">
            {/* Vehicle info badge */}
            <div className="flex items-center gap-3 mb-4">
              <span className="text-2xl">{VEHICLE_ICON[selectedVehicle.vehicleType] || '\u{1F69A}'}</span>
              <div>
                <p className="text-sm font-bold text-gray-900">
                  {selectedVehicle.plateNumber}
                  <span className="font-normal text-gray-500 ml-2">{selectedVehicle.brand} {selectedVehicle.model}</span>
                </p>
                <p className="text-xs text-gray-500">
                  {selectedVehicle.vehicleType}
                  {selectedVehicle.trailerType && ` / ${selectedVehicle.trailerType}`}
                  {spaceKnown && <>{' '}&middot; {maxMeters}m &middot; {maxWeight.toFixed(0)}t</>}
                  {selectedVehicle.maxPalletCount && ` \u00B7 ${selectedVehicle.maxPalletCount} palet`}
                  {selectedVehicle.axleCount && ` \u00B7 ${selectedVehicle.axleCount} osi`}
                </p>
              </div>
            </div>

            {/* Sliders + Capacity indicators in a 2-column layout */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Left: Sliders */}
              <div className="space-y-5">
                {space && !space.known && (
                  <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    {missingSpaceText(space.missing)}{' '}
                    <Link href={`/fleet/${selectedVehicle.id}`} className="underline font-medium">Otwórz kartę pojazdu</Link>
                  </p>
                )}
                {spaceKnown && (<>
                {/* Meters slider */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
                      Zajęte metry ładunkowe
                    </label>
                    <span className="text-sm font-bold text-gray-900 tabular-nums">
                      {loadMeters.toFixed(1)}m <span className="text-gray-400 font-normal">/ {maxMeters}m</span>
                    </span>
                  </div>
                  <input type="range" min={0} max={maxMeters} step={0.1} value={loadMeters}
                    onChange={(e) => setLoadMeters(parseFloat(e.target.value))}
                    className="w-full h-2.5 rounded-lg appearance-none bg-gray-200 accent-brand-600 cursor-pointer" />
                  <div className="flex justify-between text-xs text-gray-400 mt-1">
                    <span>0m (pusty)</span>
                    <span>{maxMeters}m (pełny)</span>
                  </div>
                  {/* Visual meter bar */}
                  <div className="mt-2 h-4 bg-gray-100 rounded-full overflow-hidden border border-gray-200">
                    <div className="h-full rounded-full transition-all duration-200 flex items-center justify-end pr-1"
                      style={{ width: `${metersPct}%`, backgroundColor: metersPct > 90 ? '#ef4444' : metersPct > 70 ? '#f59e0b' : '#22c55e' }}>
                      {metersPct > 20 && <span className="text-[9px] font-bold text-white">{metersPct.toFixed(0)}%</span>}
                    </div>
                  </div>
                </div>

                {/* Weight slider */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
                      Załadowana masa
                    </label>
                    <span className="text-sm font-bold text-gray-900 tabular-nums">
                      {loadWeight.toFixed(1)}t <span className="text-gray-400 font-normal">/ {maxWeight.toFixed(0)}t</span>
                    </span>
                  </div>
                  <input type="range" min={0} max={maxWeight} step={0.1} value={loadWeight}
                    onChange={(e) => setLoadWeight(parseFloat(e.target.value))}
                    className="w-full h-2.5 rounded-lg appearance-none bg-gray-200 accent-brand-600 cursor-pointer" />
                  <div className="flex justify-between text-xs text-gray-400 mt-1">
                    <span>0t (pusty)</span>
                    <span>{maxWeight.toFixed(0)}t (DMC)</span>
                  </div>
                  <div className="mt-2 h-4 bg-gray-100 rounded-full overflow-hidden border border-gray-200">
                    <div className="h-full rounded-full transition-all duration-200 flex items-center justify-end pr-1"
                      style={{ width: `${weightPct}%`, backgroundColor: weightPct > 90 ? '#ef4444' : weightPct > 70 ? '#f59e0b' : '#22c55e' }}>
                      {weightPct > 20 && <span className="text-[9px] font-bold text-white">{weightPct.toFixed(0)}%</span>}
                    </div>
                  </div>
                </div>
                </>)}

                {/* Max detour */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
                      Max objazd
                    </label>
                    <span className="text-sm font-bold text-gray-900 tabular-nums">{maxDetour} km</span>
                  </div>
                  <input type="range" min={10} max={500} step={10} value={maxDetour}
                    onChange={(e) => setMaxDetour(parseInt(e.target.value))}
                    className="w-full h-2.5 rounded-lg appearance-none bg-gray-200 accent-brand-600 cursor-pointer" />
                  <div className="flex justify-between text-xs text-gray-400 mt-1">
                    <span>10 km</span>
                    <span>500 km</span>
                  </div>
                </div>
              </div>

              {/* Right: Capacity summary cards */}
              <div className="space-y-4">
                {/* Free capacity cards */}
                {spaceKnown && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="bg-gray-50 rounded-xl border p-3 text-center">
                    <p className={`text-2xl font-bold ${pctColor(metersPct)}`} style={{ color: metersPct > 90 ? '#ef4444' : metersPct > 70 ? '#f59e0b' : '#22c55e' }}>
                      {freeMeters.toFixed(1)}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">metrów wolnych</p>
                  </div>
                  <div className="bg-gray-50 rounded-xl border p-3 text-center">
                    <p className="text-2xl font-bold" style={{ color: weightPct > 90 ? '#ef4444' : weightPct > 70 ? '#f59e0b' : '#3b82f6' }}>
                      {freeWeight.toFixed(1)}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">ton wolnych</p>
                  </div>
                  <div className="bg-gray-50 rounded-xl border p-3 text-center">
                    <p className="text-2xl font-bold text-amber-500">{freePallets}</p>
                    <p className="text-xs text-gray-500 mt-0.5">palet wolnych</p>
                  </div>
                </div>
                )}

              </div>
            </div>
          </div>
        )}

        <button type="submit" disabled={loading || !selectedVehicleId}
          className="mt-5 bg-brand-600 text-white px-6 py-2.5 rounded-xl text-sm font-semibold hover:bg-brand-700 transition disabled:opacity-50 w-full sm:w-auto">
          {loading ? '\u23F3 Szukam doładunków...' : '\u{1F50D} Szukaj doładunków'}
        </button>
      </form>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-600 mb-4">{error}</div>
      )}

      {/* Vehicle visualization — full SVG panel */}
      {selectedVehicle && spaceKnown && (
        <div className="bg-slate-900 rounded-xl border border-slate-700 p-5 mb-4">
          <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wide mb-4">
            Wizualizacja naczepy — {selectedVehicle.plateNumber}
            {hoveredMatch && (
              <span className="ml-2 text-amber-400 font-normal normal-case">
                (podgląd: +{hoveredMatch.metersNeeded}m / +{hoveredMatch.weightKg ? (hoveredMatch.weightKg / 1000).toFixed(1) : '?'}t)
              </span>
            )}
          </h2>

          <div className="grid grid-cols-1 gap-4">
            <div>
              <p className="text-xs text-slate-400 mb-1 uppercase font-semibold">Widok z góry</p>
              <div className="bg-slate-800/50 rounded-lg p-2">
                <TrailerTopView />
              </div>
            </div>
          </div>

        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-white rounded-xl border shadow-sm p-5 animate-pulse">
              <div className="h-4 bg-gray-200 rounded w-1/4 mb-3" />
              <div className="h-3 bg-gray-200 rounded w-3/4 mb-2" />
              <div className="h-3 bg-gray-200 rounded w-1/2" />
            </div>
          ))}
        </div>
      )}

      {/* Results */}
      {!loading && matches.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">
            Dopasowane oferty ({matches.length})
          </h2>

          {notices.map((n, i) => (
            <p key={i} className="text-xs text-blue-700 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 mb-3">
              {'\u2139\uFE0F'} {messageText(n)}
            </p>
          ))}
          {/* A missing cost per km is about the company, not the offer — once above the list. */}
          {matches.some(m => m.value.codes.some(c => c.code === COMPANY_LEVEL_CODE)) && (
            <p className="text-xs text-blue-700 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 mb-3">
              {'\u2139\uFE0F'} {messageText({ code: COMPANY_LEVEL_CODE })}
            </p>
          )}

          <div className="space-y-3">
            {matches.map((m) => (
              <div
                key={m.offerId}
                onMouseEnter={() => setHoveredOffer(m.offerId)}
                onMouseLeave={() => setHoveredOffer(null)}
                className={`bg-white rounded-xl border shadow-sm p-5 transition ${
                  simulatedOffer === m.offerId ? 'ring-2 ring-amber-400 border-amber-300' : 'hover:border-gray-300'
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                  {/* Left: route + cargo info */}
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <span
                        className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-bold border ${scoreColor(m.fitScore)}`}
                        title="Dopasowanie ładunku do auta: metry, masa, nadłożenie, kontrahent. Kolejność listy idzie po kwocie."
                      >
                        dopasowanie {m.fitScore} pkt
                      </span>
                      <span className="text-sm font-semibold text-gray-900">
                        {FLAGS[m.pickupCountry] || ''} {m.pickupCity} {'\u2192'} {FLAGS[m.deliveryCountry] || ''} {m.deliveryCity}
                      </span>
                      {m.externalId && (
                        <span className="text-xs text-gray-400">{m.source}: {m.externalId}</span>
                      )}
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 text-sm">
                      <div>
                        <p className="text-xs text-gray-400">Waga</p>
                        <p className="font-medium text-gray-800">{m.weightKg ? `${(m.weightKg / 1000).toFixed(1)}t` : '—'}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-400">Metry</p>
                        <p className="font-medium text-gray-800">{m.metersNeeded}m</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-400">Objazd</p>
                        <p className="font-medium text-gray-800">+{m.detourKm} km <span className="text-gray-400 text-xs">({m.detourPercent}%)</span></p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-400">{m.value.basis === 'PROFIT' ? 'Zysk' : 'Przychód'}</p>
                        <p className={`font-semibold ${m.value.amount != null && m.value.amount < 0 ? 'text-red-600' : 'text-green-700'}`}>
                          {m.value.amount != null ? formatMoney(m.value.amount, m.value.currency) : '—'}
                        </p>
                        <p className="text-xs text-gray-400">
                          cena {m.price != null ? formatMoney(m.price, m.currency) : '—'}
                          {m.value.detourCost != null && (
                            <> · koszt {formatMoney(m.value.detourCost + (m.value.detourToll ?? 0), m.value.currency)}</>
                          )}
                        </p>
                        {m.counterpartyRisk && (
                          <p className="text-xs font-medium text-red-600 mt-0.5">
                            {'\u26A0\uFE0F'} {messageText(m.counterpartyRisk)}
                          </p>
                        )}
                      </div>
                      <div>
                        <p className="text-xs text-gray-400">Kontrahent</p>
                        <p className="font-medium text-gray-800 truncate" title={m.contractorName || ''}>
                          {m.contractorName || '—'}
                          {m.contractorReliability != null && (
                            <span className="ml-1 text-xs text-amber-500">
                              {'\u2605'.repeat(Math.round((m.contractorReliability / 100) * 5))}
                            </span>
                          )}
                        </p>
                      </div>
                    </div>

                    {m.cargoType && (
                      <p className="text-xs text-gray-400 mt-1">Ładunek: {m.cargoType}</p>
                    )}
                    {(() => {
                      // The blacklist: a block for a non-ADMIN, a warning for an ADMIN.
                      const block = acceptBlock(m.blockedBy.length > 0, role);
                      return block.note && (
                        <p className={`text-xs font-medium mt-1 ${block.disabled ? 'text-red-700' : 'text-amber-700'}`}>
                          {'\u26D4'} {block.note}
                        </p>
                      );
                    })()}
                    {m.warnings.map((w, i) => (
                      <p key={i} className="text-xs text-amber-700 mt-1">
                        {'\u26A0\uFE0F'} {messageText(w)}
                      </p>
                    ))}
                    {m.value.codes.filter(c => c.code !== COMPANY_LEVEL_CODE).map((c, i) => (
                      <p key={`v${i}`} className="text-xs text-gray-500 mt-1">
                        {'\u2139\uFE0F'} {messageText(c)}
                      </p>
                    ))}
                  </div>

                  {/* Right: actions */}
                  <div className="flex sm:flex-col gap-2">
                    <button
                      onClick={() => handleAccept(m.offerId)}
                      disabled={acceptBlock(m.blockedBy.length > 0, role).disabled}
                      title={acceptBlock(m.blockedBy.length > 0, role).note ?? undefined}
                      className="bg-green-600 text-white px-4 py-1.5 rounded-lg text-xs font-semibold hover:bg-green-700 transition disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {'\u2713'} Przyjmij
                    </button>
                    <button
                      onClick={() => setSimulatedOffer(simulatedOffer === m.offerId ? null : m.offerId)}
                      className={`px-4 py-1.5 rounded-lg text-xs font-medium transition ${
                        simulatedOffer === m.offerId
                          ? 'bg-amber-100 text-amber-700 border border-amber-300'
                          : 'border border-gray-300 text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      {simulatedOffer === m.offerId ? '\u2715 Anuluj' : '\u{1F441} Symuluj'}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
          {hiddenWithoutAmount > 0 && (
            <p className="text-xs text-gray-500 mt-3 text-center">
              +{hiddenWithoutAmount} ukrytych ofert bez ceny lub bez kursu waluty
            </p>
          )}
          {hiddenBlocked > 0 && (
            <p className="text-xs text-gray-500 mt-1 text-center">
              +{hiddenBlocked} ukrytych ofert od kontrahentów z czarnej listy
            </p>
          )}
        </div>
      )}

      {/* No results */}
      {/* Incompatible with the vehicle — collapsed, with the reasons (docs/decisions.md §6) */}
      {!loading && incompatible.length > 0 && (
        <details className="bg-white rounded-xl border shadow-sm p-4">
          <summary className="cursor-pointer text-sm font-semibold text-gray-700">
            Niezgodne z pojazdem ({incompatible.length})
          </summary>
          <ul className="mt-3 space-y-2">
            {incompatible.map((o) => (
              <li key={o.offerId} className="text-sm border-t pt-2">
                <p className="font-medium text-gray-800">
                  {FLAGS[o.pickupCountry] || ''} {o.pickupCity} {'\u2192'} {FLAGS[o.deliveryCountry] || ''} {o.deliveryCity}
                </p>
                {o.reasons.map((r, i) => (
                  <p key={i} className="text-xs text-red-700 mt-0.5">{messageText(r)}</p>
                ))}
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* Without weight or dimensions — not computed, collapsed, the 20 nearest */}
      {!loading && unmeasurableTotal > 0 && (
        <details className="bg-white rounded-xl border shadow-sm p-4">
          <summary className="cursor-pointer text-sm font-semibold text-gray-700">
            Nie da się zmierzyć — brak masy lub wymiarów ({unmeasurableTotal})
          </summary>
          <ul className="mt-3 space-y-2">
            {unmeasurable.map((o) => (
              <li key={o.offerId} className="text-sm border-t pt-2">
                <Link href={`/offers/${o.offerId}`} className="font-medium text-gray-800 hover:text-brand-600">
                  {FLAGS[o.pickupCountry] || ''} {o.pickupCity} {'\u2192'} {FLAGS[o.deliveryCountry] || ''} {o.deliveryCity}
                </Link>
                <p className="text-xs text-gray-500 mt-0.5">
                  Załadunek {new Date(o.pickupDate).toLocaleDateString('pl-PL')} · {missingLoadText(o.missing)} — uzupełnij w ofercie
                </p>
              </li>
            ))}
          </ul>
          {moreUnmeasurable({ unmeasurable, unmeasurableTotal }) > 0 && (
            <p className="text-xs text-gray-500 mt-3">
              i jeszcze {moreUnmeasurable({ unmeasurable, unmeasurableTotal })} (pokazujemy 20 z najbliższym załadunkiem)
            </p>
          )}
        </details>
      )}

      {/* Without coordinates — not ranked, collapsed (docs/decisions.md §2) */}
      {!loading && awaitingLocation.length > 0 && (
        <details className="bg-white rounded-xl border shadow-sm p-4">
          <summary className="cursor-pointer text-sm font-semibold text-gray-700">
            Czekają na lokalizację ({awaitingLocation.length + hiddenAwaitingLocation})
          </summary>
          <ul className="mt-3 space-y-2">
            {awaitingLocation.map((o) => (
              <li key={o.offerId} className="text-sm border-t pt-2">
                <p className="font-medium text-gray-800">
                  {FLAGS[o.pickupCountry] || ''} {o.pickupCity} {'\u2192'} {FLAGS[o.deliveryCountry] || ''} {o.deliveryCity}
                </p>
                {o.reasons.map((r, i) => (
                  <p key={i} className="text-xs text-gray-500 mt-0.5">{messageText(r)}</p>
                ))}
              </li>
            ))}
          </ul>
          {hiddenAwaitingLocation > 0 && (
            <p className="text-xs text-gray-500 mt-3">
              +{hiddenAwaitingLocation} ukrytych (pokazujemy 10 z najbliższym załadunkiem)
            </p>
          )}
        </details>
      )}

      {!loading && capacity && matches.length === 0 && (
        <div className="bg-white rounded-xl border shadow-sm p-8 text-center">
          <p className="text-4xl mb-3">{'\u{1F4ED}'}</p>
          <p className="text-sm font-medium text-gray-600">Brak ofert pasujących do wolnej przestrzeni</p>
          <p className="text-xs text-gray-400 mt-1">Spróbuj zwiększyć max objazd lub zmienić trasę</p>
          {unmeasurableTotal > 0 && (
            <p className="text-xs text-amber-700 mt-2">
              {unmeasurableTotal} ofert czeka na masę lub wymiary — lista „Nie da się zmierzyć” wyżej.
            </p>
          )}
        </div>
      )}

      {/* ─── Load Planning Section ───────────────────────────────────────── */}
      {selectedVehicle && (
        <div className="mt-6">
          <h2 className="text-lg font-bold text-gray-900 mb-4">Planowanie załadunku</h2>

          {/* Accepted offers to add */}
          {acceptedOffers.length > 0 && (
            <div className="bg-white rounded-xl border shadow-sm p-4 mb-4">
              <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">
                Dostępne oferty ({acceptedOffers.length})
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                {acceptedOffers.map((o) => {
                  const isAdded = loadPlanOffers.some((l) => l.offerId === o.id);
                  // Without weight or dimensions the offer cannot be placed on the plan — nothing is guessed.
                  const check = loadPlanItem(o, 0);
                  const incomplete = check.ok ? null : check.message;
                  return (
                    <div
                      key={o.id}
                      className={`border rounded-lg p-3 transition text-sm ${
                        incomplete
                          ? 'bg-gray-50 border-gray-200 opacity-70 cursor-not-allowed'
                          : isAdded
                            ? 'bg-blue-50 border-blue-300 cursor-pointer'
                            : 'bg-white border-gray-200 hover:border-gray-400 cursor-pointer'
                      }`}
                      aria-disabled={incomplete ? true : undefined}
                      onClick={() => { if (incomplete) return; if (isAdded) removeFromLoadPlan(o.id); else addToLoadPlan(o); }}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-gray-900">
                          {FLAGS[o.pickupCountry] || ''} {o.pickupCity} {'\u2192'} {FLAGS[o.deliveryCountry] || ''} {o.deliveryCity}
                        </span>
                        <span className={`text-xs font-bold ${isAdded ? 'text-blue-600' : 'text-gray-400'}`}>
                          {isAdded ? '\u2713' : '+'}
                        </span>
                      </div>
                      <div className="flex gap-3 mt-1 text-xs text-gray-500">
                        <span>{o.weightKg != null ? `${(o.weightKg / 1000).toFixed(1)}t` : '?t'}</span>
                        <span>{o.lengthM != null ? `${o.lengthM}m` : o.palletCount != null ? `${o.palletCount} pal` : '?m'}</span>
                        {o.price != null && <span className="text-green-600">{o.price} {o.currency}</span>}
                      </div>
                      {incomplete && (
                        <p className="text-xs text-amber-700 mt-1">{'\u26A0\uFE0F'} {messageText(incomplete)}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Load plan list with drag & drop */}
          {loadPlanOffers.length > 0 && (
            <>
              {/* SVG Trailer visualization for load plan */}
              <div className="bg-slate-900 rounded-xl border border-slate-700 p-5 mb-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wide">
                    Plan załadunku — widok naczepy
                  </h3>
                  <span className="text-xs text-slate-500">
                    {'\u2190'} ZAŁADUNEK (od drzwi)
                  </span>
                </div>

                {spaceKnown && (<>
                {/* Load plan trailer SVG */}
                <div className="bg-slate-800/50 rounded-lg p-3">
                  <svg viewBox="0 0 600 140" className="w-full" style={{ maxHeight: '130px' }}>
                    {/* Trailer outline */}
                    <rect x={30} y={20} width={520} height={80} rx={3}
                      fill="#1e293b" stroke="#475569" strokeWidth={1.5} />

                    {/* Load blocks — placed from right (rear) to left (front) */}
                    {loadPlanResult?.positions.map((pos, idx) => {
                      const mScale = 520 / maxMeters;
                      const blockW = pos.meters * mScale;
                      const blockX = 30 + 520 - pos.endM * mScale;
                      const color = LOAD_COLORS[idx % LOAD_COLORS.length];
                      const hasWarning = pos.warnings.length > 0;
                      return (
                        <g key={pos.offerId}>
                          <rect
                            x={blockX} y={22} width={Math.max(blockW - 2, 2)} height={76} rx={2}
                            fill={color} opacity={0.6}
                            stroke={hasWarning ? '#ef4444' : color} strokeWidth={hasWarning ? 2 : 1}
                          />
                          {blockW > 30 && (
                            <>
                              <text x={blockX + blockW / 2} y={55} textAnchor="middle"
                                fill="#fff" fontSize={12} fontWeight="bold">
                                #{pos.position}
                              </text>
                              <text x={blockX + blockW / 2} y={72} textAnchor="middle"
                                fill="#e2e8f0" fontSize={9}>
                                {(pos.weightKg / 1000).toFixed(1)}t
                              </text>
                            </>
                          )}
                        </g>
                      );
                    })}

                    {/* Free space */}
                    {loadPlanResult && loadPlanResult.freeMeters > 0 && (() => {
                      const mScale = 520 / maxMeters;
                      const freeW = loadPlanResult.freeMeters * mScale;
                      return (
                        <rect x={32} y={22} width={freeW - 2} height={76} rx={2}
                          fill="#22c55e" opacity={0.1} />
                      );
                    })()}

                    {/* Meter markings */}
                    {Array.from({ length: Math.ceil(maxMeters) + 1 }, (_, i) => {
                      const mx = 30 + (i / maxMeters) * 520;
                      return (
                        <g key={i}>
                          <line x1={mx} y1={20} x2={mx} y2={100} stroke="#64748b" strokeWidth={0.3} opacity={0.3} />
                          {i % 2 === 0 && (
                            <text x={mx} y={115} textAnchor="middle" fill="#94a3b8" fontSize={8}>{i}m</text>
                          )}
                        </g>
                      );
                    })}

                    {/* Rear doors */}
                    <rect x={547} y={17} width={6} height={86} rx={1}
                      fill="none" stroke="#f59e0b" strokeWidth={1.5} />
                    <text x={558} y={65} fill="#f59e0b" fontSize={9} fontWeight="bold">{'\u25B6'}</text>

                    {/* Front label */}
                    <text x={25} y={65} textAnchor="end" fill="#64748b" fontSize={9}>Przód</text>
                  </svg>
                </div>
                </>)}


                {loadPlanError && (
                  <div className="mt-3 bg-red-900/30 border border-red-800 rounded-lg px-3 py-2 text-xs text-red-300">
                    {loadPlanError}
                  </div>
                )}

                {/* Overall warnings */}
                {loadPlanResult && loadPlanResult.warnings.length > 0 && (
                  <div className="mt-3 space-y-1">
                    {loadPlanResult.warnings.map((w, i) => (
                      <div key={i} className="bg-red-900/30 border border-red-800 rounded-lg px-3 py-2 text-xs text-red-300 flex items-center gap-2">
                        <span>{'\u26A0\uFE0F'}</span> {messageText(w)}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Drag & drop sequence list */}
              <div className="bg-white rounded-xl border shadow-sm p-4 mb-4">
                <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">
                  Kolejność załadunku (przeciągnij aby zmienić)
                </h3>

                <div className="space-y-2">
                  {loadPlanOffers.map((load, idx) => {
                    const posResult = loadPlanResult?.positions.find((p) => p.position === idx + 1);
                    const hasWarning = posResult && posResult.warnings.length > 0;
                    return (
                      <div
                        key={load.offerId}
                        draggable
                        onDragStart={() => handleDragStart(idx)}
                        onDragOver={(e) => handleDragOver(e, idx)}
                        onDrop={() => handleDrop(idx)}
                        onDragEnd={handleDragEnd}
                        className={`border rounded-lg p-3 flex items-center gap-3 cursor-grab active:cursor-grabbing transition ${
                          dragOverIndex === idx
                            ? 'border-blue-400 bg-blue-50'
                            : hasWarning
                              ? 'border-red-300 bg-red-50'
                              : 'border-gray-200 hover:border-gray-300'
                        } ${draggedIndex === idx ? 'opacity-50' : ''}`}
                      >
                        {/* Grip handle */}
                        <span className="text-gray-400 text-lg select-none">{'\u2801\u2802\u2803\u2804\u2805\u2806'}</span>

                        {/* Position badge */}
                        <span
                          className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                          style={{ backgroundColor: LOAD_COLORS[idx % LOAD_COLORS.length] }}
                        >
                          {idx + 1}
                        </span>

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">
                            {load.loadingCity} {'\u2192'} {load.unloadingCity}
                          </p>
                          <p className="text-xs text-gray-500">
                            {(load.weight / 1000).toFixed(1)}t &middot; {load.meters.toFixed(1)}m
                            {posResult && (
                              <span className="ml-2 text-gray-400">
                                | kum: {(posResult.cumulativeWeightKg / 1000).toFixed(1)}t, {posResult.cumulativeMeters}m
                              </span>
                            )}
                          </p>
                        </div>

                        {/* Status */}
                        <span className={`text-sm flex-shrink-0 ${hasWarning ? 'text-red-500' : 'text-green-500'}`}>
                          {hasWarning ? '\u26A0\uFE0F' : '\u2705'}
                        </span>

                        {/* Remove */}
                        <button
                          onClick={(e) => { e.stopPropagation(); removeFromLoadPlan(load.offerId); }}
                          className="text-gray-400 hover:text-red-500 text-sm flex-shrink-0 transition"
                          title="Usuń"
                        >
                          {'\u2715'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Load sequence table */}
              {loadPlanResult && (
                <div className="bg-white rounded-xl border shadow-sm p-4 mb-4">
                  <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">
                    Tabela załadunku
                  </h3>
                  <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-xs text-gray-500 uppercase">
                        <th className="text-left py-2 px-2">#</th>
                        <th className="text-left py-2 px-2">Ładunek</th>
                        <th className="text-left py-2 px-2">Skąd → Dokąd</th>
                        <th className="text-right py-2 px-2">Waga</th>
                        <th className="text-right py-2 px-2">Metry</th>
                        <th className="text-right py-2 px-2">Waga kum.</th>
                        <th className="text-center py-2 px-2">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {loadPlanResult.positions.map((pos) => {
                        const hasWarning = pos.warnings.length > 0;
                        return (
                          <tr
                            key={pos.position}
                            className={`border-b ${hasWarning ? 'bg-red-50' : ''}`}
                          >
                            <td className="py-2 px-2">
                              <span
                                className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold"
                                style={{ backgroundColor: LOAD_COLORS[(pos.position - 1) % LOAD_COLORS.length] }}
                              >
                                {pos.position}
                              </span>
                            </td>
                            <td className="py-2 px-2 text-gray-900 font-medium">{pos.description}</td>
                            <td className="py-2 px-2 text-gray-700">{pos.loadingCity} {'\u2192'} {pos.unloadingCity}</td>
                            <td className="py-2 px-2 text-right text-gray-800">{(pos.weightKg / 1000).toFixed(1)}t</td>
                            <td className="py-2 px-2 text-right text-gray-800">{pos.meters.toFixed(1)}m</td>
                            <td className="py-2 px-2 text-right font-medium text-gray-900">{(pos.cumulativeWeightKg / 1000).toFixed(1)}t</td>
                            <td className="py-2 px-2 text-center">
                              {hasWarning
                                ? <span className="text-red-500 text-xs font-medium">{'\u26A0\uFE0F'} Przeciążenie</span>
                                : <span className="text-green-500 text-xs font-medium">{'\u2705'} OK</span>
                              }
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 font-semibold">
                        <td colSpan={3} className="py-2 px-2 text-gray-700">RAZEM</td>
                        <td className="py-2 px-2 text-right text-gray-900">{(loadPlanResult.totalWeightKg / 1000).toFixed(1)}t</td>
                        <td className="py-2 px-2 text-right text-gray-900">{loadPlanResult.totalMeters}m</td>
                        <td colSpan={3}></td>
                      </tr>
                    </tfoot>
                  </table>
                  </div>
                </div>
              )}

              {/* Action buttons */}
              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  onClick={handleOptimize}
                  disabled={loadPlanLoading}
                  className="bg-amber-500 text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-amber-600 transition disabled:opacity-50"
                >
                  {loadPlanLoading ? '\u23F3 Optymalizuję...' : 'Optymalizuj automatycznie'}
                </button>
                <button
                  onClick={handleConfirmLoadPlan}
                  disabled={loadPlanLoading}
                  className="bg-green-600 text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-green-700 transition disabled:opacity-50"
                >
                  Zatwierdź plan załadunku
                </button>
              </div>
            </>
          )}

          {/* Empty state for load planning */}
          {loadPlanOffers.length === 0 && acceptedOffers.length === 0 && (
            <div className="bg-white rounded-xl border shadow-sm p-8 text-center">
              <p className="text-3xl mb-2">{'\u{1F4CB}'}</p>
              <p className="text-sm font-medium text-gray-600">Brak zaakceptowanych ofert do planowania</p>
              <p className="text-xs text-gray-400 mt-1">Najpierw zaakceptuj oferty z wyników wyszukiwania</p>
            </div>
          )}
        </div>
      )}

      {/* Confirm modal */}
      {loadPlanConfirmModal && loadPlanResult && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setLoadPlanConfirmModal(false)}>
          <div className="bg-white rounded-2xl shadow-xl p-6 max-w-md w-full mx-4" onClick={(e) => e.stopPropagation()}>
            {loadPlanResult.isValid ? (
              <>
                <div className="text-center mb-4">
                  <p className="text-4xl mb-2">{'\u2705'}</p>
                  <h3 className="text-lg font-bold text-gray-900">Plan OK</h3>
                  <p className="text-sm text-green-600 mt-1">Długość, masa i DMC w normie — naciski osi nie są liczone</p>
                </div>
                <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-800 mb-4">
                  <p>Ładunków: {loadPlanResult.positions.length}</p>
                  <p>Łączna waga: {(loadPlanResult.totalWeightKg / 1000).toFixed(1)}t / {(loadPlanResult.maxWeightKg / 1000).toFixed(0)}t</p>
                  <p>Łączna długość: {loadPlanResult.totalMeters}m / {loadPlanResult.maxMeters}m</p>
                </div>
              </>
            ) : (
              <>
                <div className="text-center mb-4">
                  <p className="text-4xl mb-2">{'\u26A0\uFE0F'}</p>
                  <h3 className="text-lg font-bold text-gray-900">Uwaga</h3>
                  <p className="text-sm text-red-600 mt-1">Zmień kolejność — wykryto przeciążenia</p>
                </div>
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800 mb-4 space-y-1">
                  {loadPlanResult.warnings.map((w, i) => (
                    <p key={i}>{'\u26A0\uFE0F'} {messageText(w)}</p>
                  ))}
                </div>
              </>
            )}
            <button
              onClick={() => setLoadPlanConfirmModal(false)}
              className="w-full bg-gray-900 text-white py-2.5 rounded-xl text-sm font-semibold hover:bg-gray-800 transition"
            >
              Zamknij
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
