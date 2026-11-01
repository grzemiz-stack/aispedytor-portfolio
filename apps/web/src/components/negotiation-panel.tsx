'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';
import { apiErrorText } from '@/lib/api-error';
import { messagesToText, type PlanMessage } from '@/lib/plan-messages';

// ─── Types ──────────────────────────────────────────────────────────────────

interface PriceSuggestion {
  minPrice: number;
  maxPrice: number;
  avgPrice: number;
  medianPrice: number;
  optimalPrice: number;
  avgPricePerKm: number;
  marketTrend: 'rising' | 'falling' | 'stable';
  trendPercentChange: number;
  historicalCount: number;
  percentiles: { p25: number; p50: number; p75: number };
  currency: string;
  /** Exchange rates used in the history; prices without a rate left out (TOTAL_EXCLUDES_UNCONVERTED). */
  messages?: PlanMessage[];
}

interface ContractorProfile {
  name: string;
  totalOrders: number;
  recentOrders30d: number;
  recentOrders90d: number;
  avgRate: number | null;
  paymentRating: number | null;
  reliabilityScore: number | null;
  avgPaymentDays: number | null;
  isRegular: boolean;
  /** The rate per km vs the market on similar routes; `null` — too small a sample (NEGOTIATION_SAMPLE_TOO_SMALL in `messages`). */
  priceVsMarket: 'above' | 'below' | 'market' | null;
  priceVsMarketPct: number | null;
  messages?: PlanMessage[];
}

interface NegotiationArgument {
  icon: string;
  type: string;
  title: string;
  text: string;
  strength: number;
}

interface PriceScenario {
  label: string;
  price: number;
  pricePerKm: number;
  marginPLN: number;
  marginPct: number;
  /** `uncertain` — a cost without tolls: the margin is an upper bound. */
  verdict: 'excellent' | 'good' | 'acceptable' | 'low' | 'loss' | 'uncertain';
  color: string;
}

interface NegotiationSimulation {
  available: boolean;
  scenarios: PriceScenario[];
  unavailable: {
    reason: string;
    message: string;
    actions: Array<{ code: string; label: string; offerId: string }>;
  } | null;
  /** PLN per 1 unit of the offer currency — the rate from the API (common/fx); `null` without a simulation. */
  rateToPLN?: number | null;
  breakEvenPrice: number | null;
  sweetSpotRange: { min: number | null; max: number | null };
  /** The offer cost from the API (the company cost per km × km + toll). */
  estimatedCosts: {
    perKmPLN: number | null;
    /** `null` — a cost without tolls, or no cost. */
    tollPLN: number | null;
    totalPLN: number | null;
    source: 'route' | 'company_rate' | null;
    withoutTolls: boolean;
    messages: PlanMessage[];
  };
  /** A cost without tolls: the cost and the break-even are lower bounds, the margins upper bounds. */
  costIsLowerBound?: boolean;
}

/** One item of the per-country toll breakdown — as the route planner saved it. */
interface TollBreakdownItem {
  countryCode: string;
  country?: string;
  distanceKm?: number;
  rateEurPerKm?: number | null;
  costEUR?: number;
}

/**
 * Toll cost in the analysis. Three states, in the order of precedence set by
 * the backend: manual correction > route planner calculation > none.
 */
interface NegotiationTollCost {
  source: 'manual' | 'calculated' | 'unknown';
  amountPLN: number | null;
  enteredByUser: boolean;
  breakdown: TollBreakdownItem[] | null;
  unresolved: Array<{ countryCode: string; reason?: string }> | null;
  calculatedAt: string | null;
  needsVerification: boolean;
  calculatedAmountPLN: number | null;
  differencePLN: number | null;
}

interface NegotiationAnalysis {
  offer: {
    id: string;
    route: string;
    distanceKm: number | null;
    currentPrice: number | null;
    currency: string;
    pricePerKm: number | null;
    pickupDate: string;
    cargoType: string | null;
    isAdr: boolean;
    weightKg: number | null;
  };
  priceSuggestion: PriceSuggestion;
  contractorProfile: ContractorProfile | null;
  arguments: NegotiationArgument[];
  simulation: NegotiationSimulation;
  marketPosition: 'above' | 'below' | 'market';
  marketPositionPct: number;
  tollCost: NegotiationTollCost;
}

interface Props {
  offerId: string;
  isOpen: boolean;
  onClose: () => void;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const VERDICT_LABELS: Record<string, string> = {
  excellent: 'Swietna',
  good: 'Dobra',
  acceptable: 'Akceptowalna',
  low: 'Niska',
  loss: 'Strata',
  uncertain: 'Niepewna (bez myta)',
};

const MARKET_BADGE: Record<string, { label: string; className: string }> = {
  above: { label: 'Powyzej rynku', className: 'bg-green-100 text-green-700 border-green-200' },
  below: { label: 'Ponizej rynku', className: 'bg-red-100 text-red-700 border-red-200' },
  market: { label: 'Rynkowa', className: 'bg-blue-100 text-blue-700 border-blue-200' },
};

const TREND_ICON: Record<string, string> = {
  rising: '↑',
  falling: '↓',
  stable: '→',
};

const TREND_COLOR: Record<string, string> = {
  rising: 'text-green-600',
  falling: 'text-red-600',
  stable: 'text-gray-500',
};

function fmt(n: number | null | undefined, currency?: string): string {
  if (n === null || n === undefined) return '—';
  return n.toLocaleString('pl-PL') + (currency ? ` ${currency}` : '');
}

function stars(rating: number | null): string {
  if (rating === null) return '—';
  return '★'.repeat(Math.max(0, Math.min(5, rating))) +
    '☆'.repeat(Math.max(0, 5 - Math.min(5, rating)));
}

// ─── Collapsible Section ────────────────────────────────────────────────────

function Section({
  title,
  icon,
  children,
  defaultOpen = true,
}: {
  title: string;
  icon: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-4 py-3 bg-gray-50 hover:bg-gray-100 transition text-left"
      >
        <span className="text-base">{icon}</span>
        <span className="font-semibold text-sm text-gray-800 flex-1">{title}</span>
        <svg
          className={`w-4 h-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && <div className="p-4">{children}</div>}
    </div>
  );
}

// ─── Price Gauge ────────────────────────────────────────────────────────────

function PriceGauge({
  min,
  max,
  optimal,
  current,
  currency,
}: {
  min: number;
  max: number;
  optimal: number;
  current: number | null;
  currency: string;
}) {
  const range = max - min || 1;
  const optPct = Math.max(0, Math.min(100, ((optimal - min) / range) * 100));
  const curPct =
    current !== null
      ? Math.max(0, Math.min(100, ((current - min) / range) * 100))
      : null;

  return (
    <div className="space-y-2">
      <div className="relative h-6 bg-gradient-to-r from-red-200 via-yellow-200 to-green-200 rounded-full overflow-visible">
        {/* Optimal marker */}
        <div
          className="absolute top-0 h-full flex flex-col items-center"
          style={{ left: `${optPct}%`, transform: 'translateX(-50%)' }}
        >
          <div className="w-3 h-3 rounded-full bg-green-600 border-2 border-white shadow mt-1.5" />
        </div>
        {/* Current price marker */}
        {curPct !== null && (
          <div
            className="absolute top-0 h-full flex flex-col items-center"
            style={{ left: `${curPct}%`, transform: 'translateX(-50%)' }}
          >
            <div className="w-3 h-3 rounded-full bg-brand-600 border-2 border-white shadow mt-1.5" />
          </div>
        )}
      </div>
      <div className="flex justify-between text-xs text-gray-500">
        <span className="text-red-600 font-medium">{fmt(min, currency)}</span>
        <span className="text-green-600 font-medium">Opt: {fmt(optimal, currency)}</span>
        <span className="text-blue-600 font-medium">{fmt(max, currency)}</span>
      </div>
    </div>
  );
}

// ─── Percentile Chart ───────────────────────────────────────────────────────

function PercentileChart({ percentiles, currency }: { percentiles: { p25: number; p50: number; p75: number }; currency: string }) {
  const max = percentiles.p75 * 1.1 || 1;
  return (
    <div className="flex items-end gap-2 h-16">
      {(['p25', 'p50', 'p75'] as const).map((k) => {
        const v = percentiles[k];
        const h = Math.max(10, (v / max) * 100);
        const colors = { p25: 'bg-amber-400', p50: 'bg-blue-500', p75: 'bg-green-500' };
        const labels = { p25: 'P25', p50: 'P50', p75: 'P75' };
        return (
          <div key={k} className="flex-1 flex flex-col items-center gap-1">
            <span className="text-[10px] text-gray-500 font-medium">{fmt(v, currency)}</span>
            <div className={`w-full rounded-t ${colors[k]}`} style={{ height: `${h}%` }} />
            <span className="text-[10px] text-gray-400">{labels[k]}</span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export function NegotiationPanel({ offerId, isOpen, onClose }: Props) {
  const [data, setData] = useState<NegotiationAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sliderPrice, setSliderPrice] = useState<number | null>(null);
  const [simResult, setSimResult] = useState<NegotiationSimulation | null>(null);
  /** Error of the price simulation / copying an argument — the analysis stays visible. */
  const [actionError, setActionError] = useState('');
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const fetchAnalysis = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiClient.post(`/negotiation/analyze/${offerId}`);
      setData(res.data);
      if (res.data.offer.currentPrice) {
        setSliderPrice(res.data.offer.currentPrice);
      }
      setSimResult(res.data.simulation);
    } catch {
      setError('Nie udało się załadować analizy negocjacyjnej');
    } finally {
      setLoading(false);
    }
  }, [offerId]);

  useEffect(() => {
    if (isOpen && offerId) {
      fetchAnalysis();
    }
    return () => {
      setData(null);
      setSimResult(null);
      setSliderPrice(null);
    };
  }, [isOpen, offerId, fetchAnalysis]);

  // Simulate on slider change (debounced)
  useEffect(() => {
    if (!data || sliderPrice === null) return;
    const timer = setTimeout(async () => {
      try {
        const res = await apiClient.post('/negotiation/simulate', {
          offerId,
          proposedPrice: sliderPrice,
        });
        setSimResult(res.data);
        setActionError('');
      } catch (err: any) {
        setActionError(apiErrorText(err?.response?.data, 'Nie udało się przeliczyć symulacji dla tej ceny.'));
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [sliderPrice, offerId, data]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  async function copyArgument(text: string, idx: number) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(null), 2000);
    } catch {
      setActionError('Nie udało się skopiować — przeglądarka nie pozwoliła na dostęp do schowka.');
    }
  }

  if (!isOpen) return null;

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black/30 z-40 transition-opacity"
        onClick={onClose}
      />

      {/* Panel */}
      <div
        ref={panelRef}
        className="fixed right-0 top-0 h-full w-full sm:max-w-lg bg-white shadow-2xl z-50 flex flex-col animate-slide-in-right"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-start justify-between shrink-0">
          <div>
            {data ? (
              <>
                <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-1">
                  Analiza negocjacyjna
                </p>
                <h2 className="text-lg font-bold text-gray-900">{data.offer.route}</h2>
                <div className="flex items-center gap-3 mt-2">
                  <span className="text-2xl font-bold text-gray-900">
                    {fmt(data.offer.currentPrice, data.offer.currency)}
                  </span>
                  {data.marketPosition && (
                    <span
                      className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold border ${MARKET_BADGE[data.marketPosition].className}`}
                    >
                      {MARKET_BADGE[data.marketPosition].label}
                      {data.marketPositionPct !== 0 && (
                        <span className="ml-1">({data.marketPositionPct > 0 ? '+' : ''}{data.marketPositionPct}%)</span>
                      )}
                    </span>
                  )}
                </div>
              </>
            ) : (
              <div className="space-y-2">
                <div className="h-4 w-40 bg-gray-200 rounded animate-pulse" />
                <div className="h-6 w-56 bg-gray-200 rounded animate-pulse" />
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {loading && (
            <div className="flex flex-col items-center justify-center py-20 text-gray-400">
              <svg className="w-8 h-8 animate-spin mb-3" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
              </svg>
              <p className="text-sm">Analizuje oferte...</p>
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
              {error}
              <button onClick={fetchAnalysis} className="ml-2 underline">
                Sprobuj ponownie
              </button>
            </div>
          )}

          {data && !loading && (
            <>
              {/* ── Price Suggestion ─────────────────────────────────── */}
              <Section title="Sugestia cenowa" icon="💹" defaultOpen={true}>
                <PriceGauge
                  min={data.priceSuggestion.minPrice}
                  max={data.priceSuggestion.maxPrice}
                  optimal={data.priceSuggestion.optimalPrice}
                  current={data.offer.currentPrice}
                  currency={data.priceSuggestion.currency}
                />

                <div className="grid grid-cols-3 gap-3 mt-4">
                  <div className="bg-red-50 rounded-lg p-3 text-center">
                    <p className="text-[10px] text-red-500 uppercase font-semibold">Min</p>
                    <p className="text-sm font-bold text-red-700">{fmt(data.priceSuggestion.minPrice)}</p>
                  </div>
                  <div className="bg-green-50 rounded-lg p-3 text-center">
                    <p className="text-[10px] text-green-600 uppercase font-semibold">Optymalna</p>
                    <p className="text-sm font-bold text-green-700">{fmt(data.priceSuggestion.optimalPrice)}</p>
                  </div>
                  <div className="bg-blue-50 rounded-lg p-3 text-center">
                    <p className="text-[10px] text-blue-500 uppercase font-semibold">Max</p>
                    <p className="text-sm font-bold text-blue-700">{fmt(data.priceSuggestion.maxPrice)}</p>
                  </div>
                </div>

                <div className="flex items-center justify-between mt-3 text-sm">
                  <span className="text-gray-500">
                    Srednia/km:{' '}
                    <strong>{data.priceSuggestion.avgPricePerKm.toFixed(2)} {data.priceSuggestion.currency}/km</strong>
                  </span>
                  <span className={`font-semibold ${TREND_COLOR[data.priceSuggestion.marketTrend]}`}>
                    {TREND_ICON[data.priceSuggestion.marketTrend]}{' '}
                    {data.priceSuggestion.marketTrend === 'rising'
                      ? 'Rośnie'
                      : data.priceSuggestion.marketTrend === 'falling'
                        ? 'Spada'
                        : 'Stabilny'}
                    {data.priceSuggestion.trendPercentChange !== 0 && (
                      <span className="ml-1">({data.priceSuggestion.trendPercentChange > 0 ? '+' : ''}{data.priceSuggestion.trendPercentChange}%)</span>
                    )}
                  </span>
                </div>

                <p className="text-xs text-gray-400 mt-2">
                  Na podstawie {data.priceSuggestion.historicalCount} podobnych ofert z ostatnich 90 dni
                </p>
                {messagesToText(data.priceSuggestion.messages ?? []).map((note) => (
                  <p key={note} className="text-[10px] text-gray-400">{note}</p>
                ))}

                <div className="mt-3">
                  <p className="text-xs text-gray-500 mb-1 font-medium">Rozklad cenowy (percentyle)</p>
                  <PercentileChart
                    percentiles={data.priceSuggestion.percentiles}
                    currency={data.priceSuggestion.currency}
                  />
                </div>
              </Section>

              {/* ── Contractor Analysis ──────────────────────────────── */}
              {data.contractorProfile && (
                <Section title="Analiza kontrahenta" icon="🏢" defaultOpen={true}>
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <h4 className="font-semibold text-gray-900">{data.contractorProfile.name}</h4>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {data.contractorProfile.reliabilityScore !== null && (
                          <span className="text-amber-500">{stars(Math.round(data.contractorProfile.reliabilityScore / 20))}</span>
                        )}
                      </p>
                    </div>
                    <span
                      className={`inline-flex px-2.5 py-1 rounded-full text-xs font-semibold ${
                        data.contractorProfile.isRegular
                          ? 'bg-green-100 text-green-700'
                          : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {data.contractorProfile.isRegular ? 'Staly partner' : 'Nowy kontrahent'}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-gray-50 rounded-lg p-3">
                      <p className="text-[10px] text-gray-500 uppercase font-semibold">Zlecen razem</p>
                      <p className="text-lg font-bold text-gray-900">{data.contractorProfile.totalOrders}</p>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-3">
                      <p className="text-[10px] text-gray-500 uppercase font-semibold">Ostatnie 30 dni</p>
                      <p className="text-lg font-bold text-gray-900">{data.contractorProfile.recentOrders30d}</p>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-3">
                      <p className="text-[10px] text-gray-500 uppercase font-semibold">Rating platnosci</p>
                      <p className="text-sm font-bold text-gray-900">
                        {data.contractorProfile.paymentRating !== null ? (
                          <>
                            <span className="text-amber-500">{stars(data.contractorProfile.paymentRating)}</span>
                            <span className="text-gray-500 text-xs ml-1">
                              {data.contractorProfile.paymentRating}/5
                            </span>
                          </>
                        ) : (
                          <span className="text-gray-400">Brak danych</span>
                        )}
                      </p>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-3">
                      <p className="text-[10px] text-gray-500 uppercase font-semibold">Srednia stawka/km</p>
                      <p className="text-sm font-bold text-gray-900">
                        {data.contractorProfile.avgRate !== null
                          ? `${data.contractorProfile.avgRate.toFixed(2)} PLN/km`
                          : '—'}
                      </p>
                      {messagesToText(data.contractorProfile.messages ?? []).map((note) => (
                        <p key={note} className="text-[10px] text-gray-400">{note}</p>
                      ))}
                      {data.contractorProfile.priceVsMarket !== null && data.contractorProfile.priceVsMarketPct !== null && data.contractorProfile.priceVsMarket !== 'market' && (
                        <p className={`text-[10px] mt-0.5 ${
                          data.contractorProfile.priceVsMarket === 'above' ? 'text-green-600' : 'text-red-600'
                        }`}>
                          {data.contractorProfile.priceVsMarketPct > 0 ? '+' : ''}
                          {data.contractorProfile.priceVsMarketPct}% stawki/km vs rynek (podobne trasy)
                        </p>
                      )}
                    </div>
                  </div>

                  {data.contractorProfile.avgPaymentDays !== null && (
                    <p className="text-xs text-gray-500 mt-3">
                      Sredni termin platnosci: <strong>{data.contractorProfile.avgPaymentDays} dni</strong>
                    </p>
                  )}
                </Section>
              )}

              {/* ── Negotiation Arguments ────────────────────────────── */}
              {data.arguments.length > 0 && (
                <Section title="Argumenty negocjacyjne" icon="💬" defaultOpen={true}>
                  <div className="space-y-3">
                    {data.arguments.map((arg, i) => (
                      <div
                        key={i}
                        className="bg-gray-50 rounded-xl p-3 border border-gray-100 relative group"
                      >
                        <div className="flex items-start gap-2">
                          <span className="text-lg mt-0.5">{arg.icon}</span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <h5 className="text-sm font-semibold text-gray-800">{arg.title}</h5>
                              <div className="flex gap-0.5">
                                {Array.from({ length: 5 }, (_, j) => (
                                  <div
                                    key={j}
                                    className={`w-1.5 h-3 rounded-sm ${
                                      j < Math.ceil(arg.strength / 2)
                                        ? 'bg-brand-500'
                                        : 'bg-gray-200'
                                    }`}
                                  />
                                ))}
                              </div>
                            </div>
                            <p className="text-xs text-gray-600 leading-relaxed">{arg.text}</p>
                          </div>
                          <button
                            onClick={() => copyArgument(arg.text, i)}
                            className="shrink-0 p-1.5 rounded-lg hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition opacity-0 group-hover:opacity-100"
                            title="Kopiuj"
                          >
                            {copiedIdx === i ? (
                              <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                              </svg>
                            ) : (
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                              </svg>
                            )}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              {/* ── Toll cost ────────────────────────────────────────── */}
              <Section title="Koszt myta" icon="🛣️" defaultOpen={true}>
                {data.tollCost.source === 'unknown' ? (
                  /* Same rule as for the margin: without data no number is shown,
                     only an explicit state and a way out. */
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                    <p className="text-sm font-semibold text-amber-900 mb-1">
                      Trasa nie policzona
                    </p>
                    <p className="text-xs text-amber-800">
                      Koszt myta dla tej oferty nie jest znany, więc marża nie została oszacowana.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Link
                        href={`/route-planner?from=${encodeURIComponent(data.offer.route.split('→')[0]?.trim() ?? '')}&to=${encodeURIComponent(data.offer.route.split('→')[1]?.trim() ?? '')}&offerId=${data.offer.id}`}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-600 text-white hover:bg-amber-700 transition"
                      >
                        Policz trasę w planerze
                      </Link>
                      <Link
                        href={`/offers/${data.offer.id}`}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium border border-amber-300 text-amber-900 hover:bg-amber-100 transition"
                      >
                        Wpisz opłaty drogowe ręcznie
                      </Link>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {/* The amount used in the calculations + where it comes from */}
                    <div className="flex items-baseline justify-between gap-3">
                      <div>
                        <p className="text-xl font-bold text-gray-900">
                          {fmt(data.tollCost.amountPLN)} PLN
                        </p>
                        <p className="text-[11px] text-gray-500 mt-0.5">
                          {data.tollCost.enteredByUser
                            ? 'Wpisane ręcznie w karcie oferty'
                            : `Policzone przez planer trasy${
                                data.tollCost.calculatedAt
                                  ? ` · ${data.tollCost.calculatedAt.slice(0, 10)}`
                                  : ''
                              }`}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                          data.tollCost.enteredByUser
                            ? 'bg-blue-50 text-blue-700 border border-blue-200'
                            : 'bg-green-50 text-green-700 border border-green-200'
                        }`}
                      >
                        {data.tollCost.enteredByUser ? 'Twoja korekta' : 'Z planera'}
                      </span>
                    </div>

                    {/* Both numbers at once — information, not an error */}
                    {data.tollCost.calculatedAmountPLN !== null && data.tollCost.differencePLN !== null && (
                      <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
                        <div className="flex items-baseline justify-between text-xs">
                          <span className="text-blue-900 font-medium">Planer policzył</span>
                          <span className="font-bold text-blue-900">
                            {fmt(data.tollCost.calculatedAmountPLN)} PLN
                          </span>
                        </div>
                        <div className="flex items-baseline justify-between text-xs mt-1">
                          <span className="text-blue-800">
                            Twoja korekta jest {data.tollCost.differencePLN > 0 ? 'wyższa' : 'niższa'} o
                          </span>
                          <span className="font-semibold text-blue-900">
                            {fmt(Math.abs(data.tollCost.differencePLN))} PLN
                          </span>
                        </div>
                        <p className="text-[11px] text-blue-800 mt-2 leading-relaxed">
                          W wyliczeniach użyto <strong>Twojej korekty</strong> — wyliczenie planera jej nie
                          zastępuje. Jeśli korekta pochodzi z faktury, zostaw ją. Jeśli była wpisana
                          orientacyjnie, rozważ aktualizację w{' '}
                          <Link href={`/offers/${data.offer.id}`} className="underline font-medium">
                            karcie oferty
                          </Link>
                          .
                        </p>
                      </div>
                    )}

                    {/* Wiek stawek */}
                    {data.tollCost.needsVerification && (
                      <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                        Użyte stawki myta są starsze niż 12 miesięcy — kwota może być nieaktualna.
                      </p>
                    )}

                    {/* Rozbicie per kraj */}
                    {data.tollCost.breakdown && data.tollCost.breakdown.length > 0 && (
                      <div>
                        <p className="text-[11px] text-gray-500 font-semibold uppercase tracking-wide mb-1.5">
                          Rozbicie per kraj
                        </p>
                        <div className="space-y-1">
                          {data.tollCost.breakdown.map((b) => (
                            <div key={b.countryCode} className="flex justify-between text-xs">
                              <span className="text-gray-600">
                                {b.countryCode}
                                {b.distanceKm !== undefined && (
                                  <span className="text-gray-400"> · {Math.round(b.distanceKm)} km</span>
                                )}
                              </span>
                              <span className="font-medium text-gray-800">
                                {b.costEUR !== undefined ? `${fmt(Math.round(b.costEUR))} EUR` : '—'}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Countries without a rate — missing data told apart from no toll */}
                    {data.tollCost.unresolved && data.tollCost.unresolved.length > 0 && (
                      <p className="text-xs text-gray-500">
                        Bez stawki:{' '}
                        {data.tollCost.unresolved.map((u) => u.countryCode).join(', ')}
                      </p>
                    )}
                  </div>
                )}
              </Section>

              {/* ── Negotiation Simulation ───────────────────────────── */}
              {actionError && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700">{actionError}</div>
              )}
              {simResult && simResult.available === false && (
                <Section title="Symulacja negocjacji" icon="🎯" defaultOpen={true}>
                  {/* Route cost unknown — no scenarios are calculated.
                      A left-out toll would inflate the margin, so instead of
                      a number we show the reason and a way out. */}
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                    <p className="text-sm font-semibold text-amber-900 mb-1">
                      Scenariusze cenowe niedostępne
                    </p>
                    <p className="text-xs text-amber-800">
                      {simResult.unavailable?.message ??
                        'Koszt trasy nie jest znany, więc marża nie została wyliczona.'}
                    </p>
                    {simResult.unavailable?.actions?.length ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {simResult.unavailable.actions.map((a) =>
                          a.code === 'set_cost_per_km' ? (
                            <Link
                              key={a.code}
                              href="/settings"
                              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-600 text-white hover:bg-amber-700 transition"
                            >
                              {a.label}
                            </Link>
                          ) : a.code === 'calculate_route' ? (
                            <Link
                              key={a.code}
                              href={`/route-planner?from=${encodeURIComponent(data.offer.route.split('→')[0]?.trim() ?? '')}&to=${encodeURIComponent(data.offer.route.split('→')[1]?.trim() ?? '')}&offerId=${a.offerId}`}
                              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-600 text-white hover:bg-amber-700 transition"
                            >
                              {a.label}
                            </Link>
                          ) : (
                            <Link
                              key={a.code}
                              href={`/offers/${a.offerId}`}
                              className="px-3 py-1.5 rounded-lg text-xs font-medium border border-amber-300 text-amber-900 hover:bg-amber-100 transition"
                            >
                              {a.label}
                            </Link>
                          ),
                        )}
                      </div>
                    ) : null}
                  </div>
                </Section>
              )}

              {simResult && simResult.available !== false && (
                <Section title="Symulacja negocjacji" icon="🎯" defaultOpen={true}>
                  {/* Slider */}
                  {data.offer.currentPrice !== null && simResult.breakEvenPrice !== null && (
                    <div className="mb-4">
                      <div className="flex items-center justify-between mb-2">
                        <label className="text-xs text-gray-500 font-medium">Proponowana cena</label>
                        <span className="text-sm font-bold text-gray-900">
                          {fmt(sliderPrice, data.offer.currency)}
                        </span>
                      </div>

                      {/* Slider track with sweet spot */}
                      <div className="relative">
                        <input
                          type="range"
                          min={simResult.breakEvenPrice}
                          max={Math.round(data.offer.currentPrice * 1.2)}
                          step={Math.max(1, Math.round(data.offer.currentPrice / 200))}
                          value={sliderPrice ?? data.offer.currentPrice}
                          onChange={(e) => setSliderPrice(Number(e.target.value))}
                          className="w-full h-2 rounded-lg appearance-none cursor-pointer accent-brand-600"
                          style={{
                            // The "sweet spot" band is drawn only when both ends are known.
                            // Otherwise `null` in the arithmetic gives 0% and the band disappears
                            // silently while looking calculated.
                            background: (() => {
                              const be = simResult.breakEvenPrice;
                              const lo = simResult.sweetSpotRange.min;
                              const hi = simResult.sweetSpotRange.max;
                              if (be === null || lo === null || hi === null) {
                                return '#e5e7eb';
                              }
                              const sliderSpan = data.offer.currentPrice! * 1.2 - be;
                              const pct = (v: number) => ((v - be) / sliderSpan) * 100;
                              return `linear-gradient(to right,
                                #ef4444 0%,
                                #f97316 ${pct(lo)}%,
                                #22c55e ${pct(lo)}%,
                                #22c55e ${pct(hi)}%,
                                #3b82f6 100%)`;
                            })(),
                          }}
                        />
                        <div className="flex justify-between mt-1 text-[10px] text-gray-400">
                          <span>Break-even: {simResult.costIsLowerBound ? '≥ ' : ''}{fmt(simResult.breakEvenPrice)}</span>
                          <span className="text-green-600 font-medium">
                            Sweet spot: {fmt(simResult.sweetSpotRange.min)} – {fmt(simResult.sweetSpotRange.max)}
                          </span>
                        </div>
                      </div>

                      {/* Real-time margin display */}
                      {sliderPrice !== null && (
                        <div className="mt-3 grid grid-cols-3 gap-2">
                          {(() => {
                            const costs = simResult.estimatedCosts;
                            // The margin is NOT shown when ANY cost component is unknown.
                            // It is not set to zero or skipped silently: `pricePLN - null` is
                            // `pricePLN` in JS, i.e. a 100% margin in green for a cost nobody
                            // knows. The error must go the safe way — no number, rather than a
                            // number that encourages taking the order.
                            // The exchange rate comes from the API (common/fx); there is no fixed
                            // rate here (a hardcoded EUR rate would also treat other currencies
                            // such as GBP as PLN).
                            const rateToPLN = simResult.rateToPLN ?? null;
                            // A cost without tolls (`withoutTolls`) is known as a lower
                            // bound — the margin is shown as "≤", without a verdict colour.
                            const costPartMissing = rateToPLN === null || costs.totalPLN === null;
                            const upperBound = costs.withoutTolls;

                            const pricePLN = sliderPrice * (rateToPLN ?? 0);
                            const pricePerKm = data.offer.distanceKm && data.offer.distanceKm > 0
                              ? sliderPrice / data.offer.distanceKm
                              : null;

                            if (costPartMissing) {
                              return (
                                <>
                                  <div className="bg-gray-50 rounded-lg p-2 text-center">
                                    <p className="text-[10px] text-gray-500">Marza</p>
                                    <p className="text-sm font-bold text-gray-400">—</p>
                                  </div>
                                  <div className="bg-gray-50 rounded-lg p-2 text-center">
                                    <p className="text-[10px] text-gray-500">Marza %</p>
                                    <p className="text-sm font-bold text-gray-400">—</p>
                                  </div>
                                  <div className="bg-gray-50 rounded-lg p-2 text-center">
                                    <p className="text-[10px] text-gray-500">Stawka/km</p>
                                    <p className="text-sm font-bold text-gray-900">
                                      {pricePerKm !== null ? pricePerKm.toFixed(2) : '—'}
                                    </p>
                                  </div>
                                </>
                              );
                            }

                            const marginPLN = pricePLN - costs.totalPLN!;
                            const marginPct = pricePLN > 0 ? (marginPLN / pricePLN) * 100 : -100;
                            const color = upperBound && marginPct >= 8 ? 'text-gray-500' : marginPct >= 20 ? 'text-green-600' : marginPct >= 12 ? 'text-lime-600' : marginPct >= 8 ? 'text-amber-600' : marginPct >= 0 ? 'text-orange-600' : 'text-red-600';
                            const le = upperBound ? '≤ ' : '';
                            return (
                              <>
                                <div className="bg-gray-50 rounded-lg p-2 text-center">
                                  <p className="text-[10px] text-gray-500">Marza</p>
                                  <p className={`text-sm font-bold ${color}`}>{le}{marginPLN.toLocaleString('pl-PL')} PLN</p>
                                </div>
                                <div className="bg-gray-50 rounded-lg p-2 text-center">
                                  <p className="text-[10px] text-gray-500">Marza %</p>
                                  <p className={`text-sm font-bold ${color}`}>{le}{marginPct.toFixed(1)}%</p>
                                </div>
                                <div className="bg-gray-50 rounded-lg p-2 text-center">
                                  <p className="text-[10px] text-gray-500">Stawka/km</p>
                                  <p className="text-sm font-bold text-gray-900">
                                    {pricePerKm !== null ? pricePerKm.toFixed(2) : '—'}
                                  </p>
                                </div>
                              </>
                            );
                          })()}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Costs breakdown */}
                  <div className="bg-gray-50 rounded-lg p-3 mb-4">
                    <p className="text-xs text-gray-500 font-semibold mb-2">Koszt oferty</p>
                    <div className="space-y-1.5 text-xs">
                      <div className="flex justify-between">
                        <span className="text-gray-500">Koszt kilometra firmy × km</span>
                        <span className="font-medium">{fmt(simResult.estimatedCosts.perKmPLN)} PLN</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Myto</span>
                        <span className="font-medium">
                          {simResult.estimatedCosts.tollPLN !== null ? `${fmt(simResult.estimatedCosts.tollPLN)} PLN` : 'nieznane'}
                        </span>
                      </div>
                      <div className="flex justify-between border-t border-gray-200 pt-1.5 font-semibold">
                        <span className="text-gray-700">Razem</span>
                        <span>{simResult.costIsLowerBound ? '≥ ' : ''}{fmt(simResult.estimatedCosts.totalPLN)} PLN</span>
                      </div>
                    </div>
                    {messagesToText(simResult.estimatedCosts.messages ?? []).map((note) => (
                      <p key={note} className="text-[10px] text-amber-700 mt-1">{note}</p>
                    ))}
                  </div>

                  {/* Scenarios table */}
                  <div className="overflow-hidden rounded-lg border border-gray-200">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-3 py-2 text-left text-gray-500 font-semibold">Scenariusz</th>
                          <th className="px-3 py-2 text-right text-gray-500 font-semibold">Cena</th>
                          <th className="px-3 py-2 text-right text-gray-500 font-semibold">Marza</th>
                          <th className="px-3 py-2 text-right text-gray-500 font-semibold">Ocena</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {simResult.scenarios.map((s, i) => (
                          <tr key={i} className="hover:bg-gray-50">
                            <td className="px-3 py-2 font-medium text-gray-700">{s.label}</td>
                            <td className="px-3 py-2 text-right font-medium">{fmt(s.price, data.offer.currency)}</td>
                            <td className="px-3 py-2 text-right">
                              <span style={{ color: s.color }} className="font-semibold">
                                {simResult.costIsLowerBound ? '≤ ' : ''}{s.marginPct}%
                              </span>
                              <span className="text-gray-400 ml-1">({fmt(s.marginPLN)} PLN)</span>
                            </td>
                            <td className="px-3 py-2 text-right">
                              <span
                                className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold"
                                style={{
                                  backgroundColor: s.color + '20',
                                  color: s.color,
                                }}
                              >
                                {VERDICT_LABELS[s.verdict] ?? s.verdict}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Future button */}
                  <button
                    disabled
                    className="w-full mt-4 py-2.5 rounded-xl bg-brand-600 text-white text-sm font-medium opacity-50 cursor-not-allowed"
                  >
                    Zaproponuj te cene (wkrotce)
                  </button>
                </Section>
              )}
            </>
          )}
        </div>
      </div>

      {/* Slide-in animation */}
      <style jsx>{`
        @keyframes slide-in-right {
          from {
            transform: translateX(100%);
          }
          to {
            transform: translateX(0);
          }
        }
        .animate-slide-in-right {
          animation: slide-in-right 0.3s ease-out;
        }
      `}</style>
    </>
  );
}
