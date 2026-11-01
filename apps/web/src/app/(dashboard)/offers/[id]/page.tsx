'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';
import { apiErrorText } from '@/lib/api-error';
import { offerStatusRequest } from '@/lib/offer-status';
import { acceptBlock } from '@/lib/blacklist-accept';
import { isUpperBound, marginText } from '@/lib/margin';
import { cardWarnings, offerNotLiveNotice } from '@/lib/matching-notice';
import { useAuthStore } from '@/store/auth.store';
import { messagesToText, messageText, type PlanMessage } from '@/lib/plan-messages';
import { routePlannerHref } from '@/lib/route-planner-link';

interface OfferDetail {
  id: string;
  /** This company's contractor is blacklisted (from the API). */
  contractorBlacklisted?: boolean;
  externalId: string | null;
  source: string;
  status: string;
  pickupCity: string;
  pickupCountry: string;
  pickupPostal: string | null;
  pickupDate: string;
  deliveryCity: string;
  deliveryCountry: string;
  deliveryPostal: string | null;
  deliveryDate: string | null;
  cargoType: string | null;
  weightKg: number | null;
  volumeM3: number | null;
  isAdr: boolean;
  isFrigo: boolean;
  temperatureMin: number | null;
  temperatureMax: number | null;
  price: number | null;
  currency: string;
  pricePerKm: number | null;
  distanceKm: number | null;
  fuelCostEstimate: number | null;
  tollCostEstimate: number | null;
  totalCostEstimate: number | null;
  profitEstimate: number | null;
  profitMarginPercent: number | null;
  /** A margin without a toll = an upper bound. */
  marginWithoutTolls?: boolean | null;
  notes: string | null;
  clientName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  contractor: { name: string; country: string | null } | null;
  assignedTo: { id: string } | null;
}

interface RiskItem {
  type: string;
  level: 'HIGH' | 'MEDIUM' | 'LOW';
  message: string;
  details?: string;
}

interface RiskResult {
  offerId: string;
  totalRiskScore: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  risks: RiskItem[];
  safeToAccept: boolean;
  analyzedAt: string;
}

interface MatchDetails {
  typeMatch: number;
  available: number;
  capacityOk: number;
  locationMatch: number;
  docsValid: number;
}

interface VehicleMatch {
  vehicleId: string;
  vehicleName: string;
  licensePlate: string;
  matchScore: number;
  matchDetails: MatchDetails;
  recommendation: string;
  /** ADR: reasons for incompatibility (score 0) and warnings — codes from the API. */
  blockedBy?: PlanMessage[];
  warnings?: PlanMessage[];
}

interface EvaluationResult {
  offerId: string;
  route: string;
  score: number;
  priceVsMarket: number | null;
  marginRating: string;
  pricePerKmRating: string;
  routePopularity: number;
  recommendation: string;
  calculatedAt: string;
  /** Exchange rates used for the history average (FX_RATE_STATIC) and rates left out for lack of a rate. */
  messages?: PlanMessage[];
}

const STATUS_LABEL: Record<string, string> = {
  NEW: 'Nowa',
  ASSIGNED: 'Przypisana',
  ACCEPTED: 'Zaakceptowana',
  REJECTED: 'Odrzucona',
  EXPIRED: 'Wygasła',
};

const STATUS_COLOR: Record<string, string> = {
  NEW: 'bg-blue-100 text-blue-700',
  ASSIGNED: 'bg-indigo-100 text-indigo-700',
  ACCEPTED: 'bg-green-100 text-green-700',
  REJECTED: 'bg-red-100 text-red-700',
  EXPIRED: 'bg-gray-100 text-gray-500',
};

// Which actions are available per status
const STATUS_ACTIONS: Record<string, Array<{ label: string; status: string; cls: string }>> = {
  NEW: [
    { label: 'Przypisz do mnie', status: 'ASSIGNED', cls: 'bg-indigo-600 hover:bg-indigo-700 text-white' },
    { label: 'Zaakceptuj', status: 'ACCEPTED', cls: 'bg-green-600 hover:bg-green-700 text-white' },
    { label: 'Odrzuć', status: 'REJECTED', cls: 'bg-red-600 hover:bg-red-700 text-white' },
    { label: 'Oznacz jako wygasła', status: 'EXPIRED', cls: 'bg-gray-500 hover:bg-gray-600 text-white' },
  ],
  ASSIGNED: [
    { label: 'Zaakceptuj', status: 'ACCEPTED', cls: 'bg-green-600 hover:bg-green-700 text-white' },
    { label: 'Odrzuć', status: 'REJECTED', cls: 'bg-red-600 hover:bg-red-700 text-white' },
    { label: 'Oznacz jako wygasła', status: 'EXPIRED', cls: 'bg-gray-500 hover:bg-gray-600 text-white' },
  ],
  ACCEPTED: [
    { label: 'Odrzuć', status: 'REJECTED', cls: 'bg-red-600 hover:bg-red-700 text-white' },
    { label: 'Oznacz jako wygasła', status: 'EXPIRED', cls: 'bg-gray-500 hover:bg-gray-600 text-white' },
  ],
  REJECTED: [
    { label: 'Przywróć (Nowa)', status: 'NEW', cls: 'bg-blue-600 hover:bg-blue-700 text-white' },
  ],
  EXPIRED: [
    { label: 'Przywróć (Nowa)', status: 'NEW', cls: 'bg-blue-600 hover:bg-blue-700 text-white' },
  ],
};

function marginColor(m: number | null) {
  if (m === null) return '';
  const v = Number(m);
  if (v >= 15) return 'text-green-700';
  if (v >= 5) return 'text-amber-700';
  return 'text-red-700';
}

function marginBg(m: number | null) {
  if (m === null) return 'bg-gray-50 border-gray-200';
  const v = Number(m);
  if (v >= 15) return 'bg-green-50 border-green-200';
  if (v >= 5) return 'bg-amber-50 border-amber-200';
  return 'bg-red-50 border-red-200';
}

function scoreColor(s: number) {
  if (s >= 8) return 'text-green-700';
  if (s >= 5) return 'text-amber-600';
  return 'text-red-700';
}
function scoreBg(s: number) {
  if (s >= 8) return 'bg-green-50 border-green-200';
  if (s >= 5) return 'bg-amber-50 border-amber-200';
  return 'bg-red-50 border-red-200';
}

const MARGIN_RATING_LABEL: Record<string, string> = {
  excellent: 'Doskonała marża', good: 'Dobra marża', fair: 'Przeciętna marża', poor: 'Słaba marża',
};
const PPK_RATING_LABEL: Record<string, string> = {
  above: 'Powyżej rynku', at: 'Na poziomie rynku', below: 'Poniżej rynku', unknown: 'Brak danych rynkowych',
};

export default function OfferDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [offer, setOffer] = useState<OfferDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  const role = useAuthStore((s) => s.user?.role);
  const [aiEval, setAiEval] = useState<EvaluationResult | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const [vehicleMatches, setVehicleMatches] = useState<VehicleMatch[] | null>(null);
  const [matchLoading, setMatchLoading] = useState(false);
  const [matchError, setMatchError] = useState('');
  const [riskResult, setRiskResult] = useState<RiskResult | null>(null);
  const [riskLoading, setRiskLoading] = useState(false);
  const [riskError, setRiskError] = useState('');

  const autoRanRef = useRef(false);

  const load = useCallback(() => {
    return apiClient
      .get(`/offers/${id}`)
      .then((r) => setOffer(r.data))
      .catch(() => router.push('/offers'))
      .finally(() => setLoading(false));
  }, [id, router]);

  useEffect(() => { load(); }, [load]);

  // Heuristic score (ai-evaluation) and risk analysis when the offer is first loaded
  useEffect(() => {
    if (!offer || autoRanRef.current) return;
    autoRanRef.current = true;

    setAiLoading(true);
    apiClient
      .post(`/ai-evaluation/evaluate/${id}`)
      .then((r) => setAiEval(r.data))
      .catch(() => setAiError('Nie udało się wykonać oceny oferty'))
      .finally(() => setAiLoading(false));

    setRiskLoading(true);
    apiClient
      .post(`/risk-analysis/analyze/${id}`)
      .then((r) => setRiskResult(r.data))
      .catch(() => setRiskError('Nie udało się wykonać analizy ryzyka'))
      .finally(() => setRiskLoading(false));
  }, [offer, id]);

  async function changeStatus(status: string) {
    if (!offer) return;
    setActionError('');
    // "Przypisz do mnie" = assigning the person, not just the status.
    const req = offerStatusRequest(offer.id, status, useAuthStore.getState().user?.id);
    if (!req) {
      setActionError('Nie wiadomo, kim jesteś — zaloguj się ponownie, żeby przypisać ofertę.');
      return;
    }
    setActionLoading(status);
    try {
      await apiClient.patch(req.url, req.body);
      // Refresh offer data
      const r = await apiClient.get(`/offers/${offer.id}`);
      setOffer(r.data);
    } catch (err: any) {
      setActionError(apiErrorText(err?.response?.data, 'Błąd podczas zmiany statusu'));
    } finally {
      setActionLoading(null);
    }
  }

  async function handleAnalyzeRisk() {
    setRiskLoading(true);
    setRiskError('');
    try {
      const r = await apiClient.post(`/risk-analysis/analyze/${id}`);
      setRiskResult(r.data);
    } catch {
      setRiskError('Nie udało się wykonać analizy ryzyka');
    } finally {
      setRiskLoading(false);
    }
  }

  async function handleFindVehicles() {
    setMatchLoading(true);
    setMatchError('');
    try {
      const r = await apiClient.get(`/matching/vehicle-for-offer/${id}`);
      setVehicleMatches(r.data);
    } catch {
      setMatchError('Nie udało się pobrać dopasowanych pojazdów');
    } finally {
      setMatchLoading(false);
    }
  }

  async function handleAiEvaluate() {
    setAiLoading(true);
    setAiError('');
    try {
      const r = await apiClient.post(`/ai-evaluation/evaluate/${id}`);
      setAiEval(r.data);
    } catch {
      setAiError('Nie udało się wykonać oceny oferty');
    } finally {
      setAiLoading(false);
    }
  }

  if (loading) return <p className="text-sm text-gray-400 py-12 text-center">Ładowanie...</p>;
  if (!offer) return null;

  const actions = STATUS_ACTIONS[offer.status] ?? [];
  // `!= null`: a 0 % margin is a margin, not a missing one.
  const margin = offer.profitMarginPercent != null ? Number(offer.profitMarginPercent) : null;
  const marginBound = isUpperBound(offer);
  const fmt = (v: number | null, suffix = '') =>
    v !== null ? `${Number(v).toLocaleString('pl-PL', { maximumFractionDigits: 2 })}${suffix}` : null;

  const row = (label: string, value: React.ReactNode) => (
    <div className="flex flex-col sm:flex-row sm:gap-2">
      <span className="text-sm text-gray-500 sm:w-44 sm:shrink-0">{label}</span>
      <span className="text-sm text-gray-900 font-medium">{value ?? '—'}</span>
    </div>
  );

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div>
          <button onClick={() => router.back()} className="text-xs text-gray-400 hover:text-gray-700 mb-1">
            ← Wróć
          </button>
          <h1 className="text-2xl font-bold text-gray-900">
            {offer.externalId ?? offer.id.slice(0, 8)}
          </h1>
          <p className="text-xs text-gray-400 mt-0.5">Źródło: {offer.source}</p>
        </div>
        <div className="flex flex-col items-start sm:items-end gap-2">
          <span className={`px-3 py-1 rounded-full text-sm font-medium ${STATUS_COLOR[offer.status] ?? 'bg-gray-100 text-gray-600'}`}>
            {STATUS_LABEL[offer.status] ?? offer.status}
          </span>
        </div>
      </div>

      {/* Status actions */}
      {actions.length > 0 && (
        <div className="bg-white rounded-xl border shadow-sm p-4">
          <p className="text-xs font-semibold text-gray-500 uppercase mb-3">Zmień status</p>
          <div className="flex flex-wrap gap-2">
            {actions.map((a) => (
              <button
                key={a.status}
                onClick={() => changeStatus(a.status)}
                disabled={actionLoading !== null || (a.status === 'ACCEPTED' && acceptBlock(offer.contractorBlacklisted === true, role).disabled)}
                title={a.status === 'ACCEPTED' ? acceptBlock(offer.contractorBlacklisted === true, role).note ?? undefined : undefined}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition disabled:opacity-50 ${a.cls}`}
              >
                {actionLoading === a.status ? 'Zapisywanie...' : a.label}
              </button>
            ))}
          </div>
          {(() => {
            // The blacklist at "Zaakceptuj" (accept): a sentence under the buttons.
            const block = acceptBlock(offer.contractorBlacklisted === true, role);
            return block.note && actions.some((a) => a.status === 'ACCEPTED') && (
              <p className={`text-xs mt-2 ${block.disabled ? 'text-red-600' : 'text-amber-700'}`}>{'\u26D4'} {block.note}</p>
            );
          })()}
          {actionError && (
            <p className="text-xs text-red-600 mt-2">{actionError}</p>
          )}
        </div>
      )}

      {/* Route */}
      <div className="bg-white rounded-xl border shadow-sm p-6 space-y-3">
        <h2 className="text-sm font-semibold text-gray-800 mb-4">Trasa</h2>
        {row('Załadunek', `${offer.pickupCity}, ${offer.pickupCountry}`)}
        {row('Kod pocztowy (zał.)', offer.pickupPostal)}
        {row('Data załadunku', new Date(offer.pickupDate).toLocaleDateString('pl-PL'))}
        {row('Rozładunek', `${offer.deliveryCity}, ${offer.deliveryCountry}`)}
        {row('Kod pocztowy (rozł.)', offer.deliveryPostal)}
        {offer.deliveryDate && row('Data rozładunku', new Date(offer.deliveryDate).toLocaleDateString('pl-PL'))}
        {row('Dystans', offer.distanceKm ? `${offer.distanceKm} km` : null)}
        <div className="pt-2">
          <Link
            href={routePlannerHref({ from: `${offer.pickupCity}, ${offer.pickupCountry}`, to: `${offer.deliveryCity}, ${offer.deliveryCountry}`, price: offer.price, currency: offer.currency, offerId: offer.id })}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-brand-600 text-white hover:bg-brand-700 transition"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
            </svg>
            Planuj trasę
          </Link>
          <Link
            href={`/offers/${offer.id}/edit`}
            className="ml-2 inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border border-gray-300 text-gray-700 hover:bg-gray-50 transition"
          >
            Edytuj ofertę
          </Link>
        </div>
      </div>

      {/* Cargo & freight */}
      <div className="bg-white rounded-xl border shadow-sm p-6 space-y-3">
        <h2 className="text-sm font-semibold text-gray-800 mb-4">Ładunek i fracht</h2>
        {row('Typ ładunku', offer.cargoType)}
        {row('Waga', offer.weightKg ? `${offer.weightKg} kg` : null)}
        {row('Objętość', offer.volumeM3 ? `${offer.volumeM3} m³` : null)}
        {row('Fracht', offer.price ? `${Number(offer.price).toLocaleString('pl-PL')} ${offer.currency}` : null)}
        {row('Stawka/km', offer.pricePerKm ? `${Number(offer.pricePerKm).toFixed(2)} ${offer.currency}/km` : null)}
        {offer.isAdr && row('ADR', 'Tak')}
        {offer.isFrigo && row('Frigo', `${offer.temperatureMin ?? '?'}°C / ${offer.temperatureMax ?? '?'}°C`)}
      </div>

      {/* Profitability */}
      {(offer.tollCostEstimate || offer.totalCostEstimate || offer.profitMarginPercent) && (
        <div className={`rounded-xl border p-6 space-y-3 ${marginBg(margin)}`}>
          <h2 className={`text-sm font-semibold mb-4 ${margin !== null ? marginColor(margin) : 'text-gray-800'}`}>
            Kalkulacja opłacalności
          </h2>
          {/* The cost is the company rate × km + toll (offerCost), not a sum of form fields — no fuel row. */}
          {row('Opłaty drogowe (wpisane)', fmt(offer.tollCostEstimate !== null ? Number(offer.tollCostEstimate) : null, ` ${offer.currency}`))}
          {row('Koszt (stawka × km + myto)', fmt(offer.totalCostEstimate !== null ? Number(offer.totalCostEstimate) : null, ` ${offer.currency}`))}
          {offer.profitEstimate !== null && (
            <div className="flex flex-col sm:flex-row sm:gap-2">
              <span className="text-sm text-gray-500 sm:w-44 sm:shrink-0">Zysk</span>
              <span className={`text-sm font-semibold ${Number(offer.profitEstimate) >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                {Number(offer.profitEstimate).toLocaleString('pl-PL', { maximumFractionDigits: 2 })} {offer.currency}
              </span>
            </div>
          )}
          {margin !== null && (
            <div className="flex flex-col sm:flex-row sm:gap-2">
              <span className="text-sm text-gray-500 sm:w-44 sm:shrink-0">Marża</span>
              <span className={`text-sm font-bold ${marginColor(margin)}`}>
                {marginText(offer)}{' '}
                <span className="font-normal">
                  {marginBound ? '(górna granica — koszt bez myta)' : margin >= 15 ? '(dobra)' : margin >= 5 ? '(przeciętna)' : '(słaba)'}
                </span>
              </span>
            </div>
          )}
        </div>
      )}

      {/* Contact */}
      <div className="bg-white rounded-xl border shadow-sm p-6 space-y-3">
        <h2 className="text-sm font-semibold text-gray-800 mb-4">Kontrahent i kontakt</h2>
        {row('Kontrahent', offer.contractor ? `${offer.contractor.name}${offer.contractor.country ? ` (${offer.contractor.country})` : ''}` : null)}
        {row('Klient', offer.clientName)}
        {row('Email', offer.contactEmail)}
        {row('Telefon', offer.contactPhone)}
        {row('Przypisana', offer.assignedTo ? 'Tak' : 'Nie')}
      </div>

      {/* Notes */}
      {offer.notes && (
        <div className="bg-white rounded-xl border shadow-sm p-6">
          <h2 className="text-sm font-semibold text-gray-800 mb-2">Notatki spedytora</h2>
          <p className="text-sm text-gray-700 whitespace-pre-wrap">{offer.notes}</p>
        </div>
      )}

      {/* Risk Analysis */}
      <div className="bg-white rounded-xl border shadow-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-800">Analiza ryzyka</h2>
          <button
            onClick={handleAnalyzeRisk}
            disabled={riskLoading}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-500 text-white hover:bg-amber-600 transition disabled:opacity-50"
          >
            {riskLoading ? 'Analizuję...' : riskResult ? 'Przelicz ponownie' : 'Analizuj ryzyko'}
          </button>
        </div>
        {riskError && <p className="text-xs text-red-600 mb-3">{riskError}</p>}
        {!riskResult && !riskLoading && (
          <p className="text-xs text-gray-400">Kliknij „Analizuj ryzyko” aby wykryć potencjalne zagrożenia w warunkach oferty.</p>
        )}
        {riskResult && (() => {
          const scoreConfig: Record<string, { bg: string; text: string; label: string; pulse: boolean }> = {
            CRITICAL: { bg: 'bg-red-100 border-red-300', text: 'text-red-800', label: 'KRYTYCZNE', pulse: true },
            HIGH:     { bg: 'bg-red-50 border-red-200',  text: 'text-red-700',  label: 'WYSOKIE',   pulse: false },
            MEDIUM:   { bg: 'bg-amber-50 border-amber-200', text: 'text-amber-700', label: 'ŚREDNIE', pulse: false },
            LOW:      { bg: 'bg-green-50 border-green-200', text: 'text-green-700', label: 'NISKIE',  pulse: false },
          };
          const cfg = scoreConfig[riskResult.totalRiskScore];
          return (
            <div className="space-y-4">
              {/* Total score badge */}
              <div className="flex items-center gap-3">
                <span className={`inline-flex px-3 py-1.5 rounded-full text-sm font-bold border ${cfg.bg} ${cfg.text} ${cfg.pulse ? 'animate-pulse' : ''}`}>
                  Ryzyko: {cfg.label}
                </span>
                <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-semibold border ${riskResult.safeToAccept ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
                  {riskResult.safeToAccept ? '✓ Bezpieczna do akceptacji' : '⚠ Wymaga uwagi'}
                </span>
              </div>

              {/* No risks */}
              {riskResult.risks.length === 0 && (
                <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-4 py-3">
                  Nie wykryto żadnych ryzyk. Oferta wygląda bezpiecznie.
                </p>
              )}

              {/* Risk list */}
              {riskResult.risks.map((risk, i) => {
                const icon = risk.level === 'HIGH' ? '⚠️' : risk.level === 'MEDIUM' ? '⚡' : 'ℹ️';
                const itemBg = risk.level === 'HIGH'
                  ? 'border-red-200 bg-red-50'
                  : risk.level === 'MEDIUM'
                  ? 'border-amber-200 bg-amber-50'
                  : 'border-blue-200 bg-blue-50';
                const itemText = risk.level === 'HIGH' ? 'text-red-800' : risk.level === 'MEDIUM' ? 'text-amber-800' : 'text-blue-800';
                return (
                  <div key={i} className={`border rounded-xl p-4 ${itemBg}`}>
                    <div className="flex items-start gap-2">
                      <span className="text-base leading-snug">{icon}</span>
                      <div className="flex-1">
                        <p className={`text-sm font-semibold ${itemText}`}>{risk.message}</p>
                        {risk.details && (
                          <p className="text-xs text-gray-600 mt-1 italic">{risk.details}</p>
                        )}
                      </div>
                      <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${
                        risk.level === 'HIGH' ? 'bg-red-200 text-red-800' :
                        risk.level === 'MEDIUM' ? 'bg-amber-200 text-amber-800' :
                        'bg-blue-200 text-blue-800'
                      }`}>{risk.level}</span>
                    </div>
                  </div>
                );
              })}

              <p className="text-xs text-gray-400">
                Przeanalizowano: {new Date(riskResult.analyzedAt).toLocaleString('pl-PL')}
              </p>
            </div>
          );
        })()}
      </div>

      {/* Vehicle Matching */}
      <div className="bg-white rounded-xl border shadow-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-800">Dopasowanie pojazdów</h2>
          <button
            onClick={handleFindVehicles}
            disabled={matchLoading}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-brand-600 text-white hover:bg-brand-700 transition disabled:opacity-50"
          >
            {matchLoading ? 'Szukam...' : vehicleMatches ? 'Odśwież' : 'Znajdź pojazd'}
          </button>
        </div>
        {matchError && <p className="text-xs text-red-600 mb-3">{matchError}</p>}
        {!vehicleMatches && !matchLoading && (
          <p className="text-xs text-gray-400">Kliknij „Znajdź pojazd” aby zobaczyć najlepiej pasujące pojazdy z floty.</p>
        )}
        {vehicleMatches && vehicleMatches.length === 0 && (
          <p className="text-xs text-gray-400">Brak pojazdów w flocie firmy.</p>
        )}
        {/* The offer is not live (loading day passed, expired, too old) — once, above the list. */}
        {offerNotLiveNotice(vehicleMatches) && (
          <p className="text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
            {'\u26A0\uFE0F'} {messageText(offerNotLiveNotice(vehicleMatches)!)}
          </p>
        )}
        {vehicleMatches && vehicleMatches.length > 0 && (
          <div className="space-y-3">
            {vehicleMatches.slice(0, 5).map((vm) => {
              const pct = vm.matchScore;
              const barColor = pct >= 80 ? 'bg-green-500' : pct >= 50 ? 'bg-amber-400' : 'bg-red-400';
              const scoreText = pct >= 80 ? 'text-green-700' : pct >= 50 ? 'text-amber-600' : 'text-red-600';
              const d = vm.matchDetails;
              return (
                <div key={vm.vehicleId} className="border rounded-xl p-4 space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{vm.vehicleName}</p>
                      <p className="text-xs text-gray-400">{vm.licensePlate}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className={`text-lg font-bold ${scoreText}`}>{pct}%</p>
                    </div>
                  </div>
                  {/* Score bar */}
                  <div className="w-full bg-gray-100 rounded-full h-1.5">
                    <div className={`${barColor} h-1.5 rounded-full transition-all`} style={{ width: `${pct}%` }} />
                  </div>
                  {/* Detail icons */}
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                    <span className={d.typeMatch >= 30 ? 'text-green-600' : d.typeMatch > 0 ? 'text-amber-500' : 'text-red-500'}>
                      {d.typeMatch >= 30 ? '✓' : d.typeMatch > 0 ? '~' : '✗'} Typ
                    </span>
                    <span className={d.available >= 25 ? 'text-green-600' : d.available > 0 ? 'text-amber-500' : 'text-red-500'}>
                      {d.available >= 25 ? '✓' : d.available > 0 ? '~' : '✗'} Dostępny
                    </span>
                    <span className={d.capacityOk >= 20 ? 'text-green-600' : d.capacityOk > 0 ? 'text-amber-500' : 'text-red-500'}>
                      {d.capacityOk >= 20 ? '✓' : d.capacityOk > 0 ? '~' : '✗'} Ładowność
                    </span>
                    <span className={d.locationMatch >= 15 ? 'text-green-600' : d.locationMatch > 0 ? 'text-amber-500' : 'text-red-500'}>
                      {d.locationMatch >= 15 ? '✓' : d.locationMatch > 0 ? '~' : '✗'} Lokalizacja
                    </span>
                    <span className={d.docsValid >= 10 ? 'text-green-600' : d.docsValid > 0 ? 'text-amber-500' : 'text-red-500'}>
                      {d.docsValid >= 10 ? '✓' : d.docsValid > 0 ? '~' : '✗'} Dokumenty
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 italic">{vm.recommendation}</p>
                  {messagesToText([...(vm.blockedBy ?? []), ...cardWarnings(vm.warnings)]).map((note) => (
                    <p key={note} className={`text-xs ${vm.blockedBy?.length ? 'text-red-600' : 'text-amber-600'}`}>{note}</p>
                  ))}
                  <div className="pt-1">
                    <a
                      href={`/fleet/${vm.vehicleId}`}
                      className="text-xs text-brand-600 hover:underline"
                    >
                      Przypisz / Zobacz pojazd →
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Heuristic score (ai-evaluation) */}
      <div className="bg-white rounded-xl border shadow-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-800">Ocena oferty <span className="text-xs font-normal text-gray-400">(heurystyka: marża i stawka wobec Twoich ofert na tej trasie — bez modelu AI)</span></h2>
          <button
            onClick={handleAiEvaluate}
            disabled={aiLoading}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-brand-600 text-white hover:bg-brand-700 transition disabled:opacity-50"
          >
            {aiLoading ? 'Analizuję...' : aiEval ? 'Przelicz ponownie' : 'Oceń ofertę'}
          </button>
        </div>
        {aiError && <p className="text-xs text-red-600 mb-3">{aiError}</p>}
        {!aiEval && !aiLoading && (
          <p className="text-xs text-gray-400">Kliknij „Oceń ofertę” aby uruchomić heurystyczną analizę opłacalności.</p>
        )}
        {aiEval && (
          <div className={`rounded-xl border p-4 space-y-3 ${scoreBg(aiEval.score)}`}>
            <div className="flex items-center gap-3">
              <span className={`text-5xl font-bold ${scoreColor(aiEval.score)}`}>{aiEval.score}</span>
              <span className="text-sm text-gray-400 font-medium">/10</span>
              <div className="ml-auto flex flex-wrap gap-2">
                <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-semibold bg-white border border-gray-200 text-gray-600">
                  {MARGIN_RATING_LABEL[aiEval.marginRating] ?? aiEval.marginRating}
                </span>
                <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-semibold bg-white border border-gray-200 text-gray-600">
                  {PPK_RATING_LABEL[aiEval.pricePerKmRating] ?? aiEval.pricePerKmRating}
                </span>
              </div>
            </div>
            <p className="text-sm text-gray-700 leading-relaxed">{aiEval.recommendation}</p>
            {messagesToText(aiEval.messages ?? []).map((note) => (
              <p key={note} className="text-xs text-gray-400">{note}</p>
            ))}
            <p className="text-xs text-gray-400">
              Obliczono: {new Date(aiEval.calculatedAt).toLocaleString('pl-PL')}
              {aiEval.routePopularity > 0 && ` · ${aiEval.routePopularity} ofert hist. na tej trasie`}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
