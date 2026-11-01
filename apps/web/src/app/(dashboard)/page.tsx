'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';
import { amountLabel, moneyNotes, perKmLabel, type MoneySummary } from '@/lib/money';
import { pageItems } from '@/lib/paginated';
import { apiErrorText } from '@/lib/api-error';
import MarginBadge from '@/components/margin-badge';
import { byMarginDesc, upperBoundNote } from '@/lib/margin';
import { recommendationPlannerHref, recommendationRoute, type RecommendationPlaces } from '@/lib/recommendation-link';

/** How many of the newest offers the "most profitable" section looks at (API limit: 100). */
const TOP_OFFERS_FROM = 100;

interface Stats {
  totalOffers: number;
  newOffers: number;
  assignedOffers: number;
  acceptedOffers: number;
  rejectedOffers: number;
  totalRevenue: number | null;
  acceptedCount: number;
  avgPricePerKm: number | null;
  avgMarginPercent: number | null;
  /** Offers with only an upper-bound margin — outside the average. */
  marginUpperBoundOffers?: number;
  recentOffers: RecentOffer[];
  /** The company currency the API converted the amounts above to, and the exchange-rate codes. */
  money?: MoneySummary;
}

interface RecentOffer {
  id: string;
  externalId: string | null;
  status: string;
  pickupCity: string;
  pickupCountry: string;
  pickupPostal: string | null;
  deliveryCity: string;
  deliveryCountry: string;
  deliveryPostal: string | null;
  pickupDate: string;
  price: number | null;
  currency: string;
  pricePerKm: number | null;
  profitMarginPercent: number | null;
  marginWithoutTolls?: boolean | null;
}

interface AiReco extends RecommendationPlaces {
  score: number;
  marginRating: string;
  recommendation: string;
}

interface MatchSuggestion {
  offer: { id: string; route: string; price: number | null; currency: string };
  vehicle: { id: string; name: string; licensePlate: string };
  matchScore: number;
  recommendation: string;
}

interface EmailStats {
  total: number;
  unread: number;
  offersToReview: number;
  byCategory: Record<string, number>;
}

interface TopOffer {
  id: string;
  externalId: string | null;
  pickupCity: string;
  pickupCountry: string;
  deliveryCity: string;
  deliveryCountry: string;
  price: number | null;
  currency: string;
  distanceKm: number | null;
  profitMarginPercent: number | null;
  marginWithoutTolls?: boolean | null;
  pricePerKm: number | null;
  status: string;
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


// ── SVG icons (no emoji — reliable cross-platform rendering) ────────────────

function IconBox() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10" />
    </svg>
  );
}
function IconStar() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
    </svg>
  );
}
function IconCheck() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}
function IconTrending() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
    </svg>
  );
}
function IconRoad() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
    </svg>
  );
}
function IconEuro() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M14.121 15.536c-1.171 1.952-3.07 1.952-4.242 0-1.172-1.953-1.172-5.119 0-7.072 1.171-1.952 3.07-1.952 4.242 0M8 10.5h4m-4 3h4m9-1.5a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

// ── Skeleton card ────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="bg-white rounded-xl border shadow-sm p-5 animate-pulse">
      <div className="w-10 h-10 bg-gray-100 rounded-lg mb-3" />
      <div className="h-7 bg-gray-100 rounded w-16 mb-2" />
      <div className="h-4 bg-gray-100 rounded w-28" />
    </div>
  );
}

// ── KPI definitions ──────────────────────────────────────────────────────────

function buildKpis(stats: Stats) {
  return [
    {
      label: 'Wszystkie oferty',
      value: String(stats.totalOffers),
      icon: <IconBox />,
      bg: 'bg-blue-50',
      text: 'text-blue-600',
    },
    {
      label: 'Nowe oferty',
      value: String(stats.newOffers),
      icon: <IconStar />,
      bg: 'bg-indigo-50',
      text: 'text-indigo-600',
    },
    {
      label: 'Zaakceptowane',
      value: String(stats.acceptedOffers),
      icon: <IconCheck />,
      bg: 'bg-green-50',
      text: 'text-green-600',
    },
    {
      label: 'Śr. marża',
      value: stats.avgMarginPercent !== null ? `${Number(stats.avgMarginPercent).toFixed(1)}%` : '—',
      note: upperBoundNote(stats.marginUpperBoundOffers),
      icon: <IconTrending />,
      bg: 'bg-amber-50',
      text: 'text-amber-600',
    },
    {
      label: 'Śr. stawka / km',
      value: perKmLabel(stats.avgPricePerKm, stats.money?.currency),
      icon: <IconRoad />,
      bg: 'bg-purple-50',
      text: 'text-purple-600',
    },
    {
      label: 'Przychód (przyjęte zlecenia)',
      value: stats.totalRevenue ? amountLabel(stats.totalRevenue, stats.money?.currency) : '—',
      icon: <IconEuro />,
      bg: 'bg-emerald-50',
      text: 'text-emerald-600',
    },
  ];
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [topOffers, setTopOffers] = useState<TopOffer[]>([]);
  const [aiRecos, setAiRecos] = useState<AiReco[]>([]);
  const [matchSuggestions, setMatchSuggestions] = useState<MatchSuggestion[]>([]);
  const [emailStats, setEmailStats] = useState<EmailStats | null>(null);
  const [offersMap, setOffersMap] = useState<Record<string, TopOffer>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** Sections that could not be loaded — the rest of the dashboard works but says what is missing. */
  const [failedSections, setFailedSections] = useState<string[]>([]);

  useEffect(() => {
    const failed: string[] = [];
    const optional = <T,>(section: string, empty: T) => () => {
      failed.push(section);
      return { data: empty };
    };
    Promise.all([
      apiClient.get('/offers/stats'),
      apiClient.get('/offers', { params: { limit: TOP_OFFERS_FROM } }),
      apiClient.get('/ai-evaluation/batch').catch(optional('rekomendacje (ocena heurystyczna)', [])),
      apiClient.get('/matching/suggestions').catch(optional('dopasowania pojazdów', [])),
      apiClient.get('/email-agent/stats').catch(optional('statystyki poczty', null)),
    ])
      .then(([statsRes, offersRes, batchRes, suggestionsRes, emailRes]) => {
        setStats(statsRes.data);
        // /offers returns { data, meta } — not a bare array.
        const all = pageItems<TopOffer>(offersRes.data);
        const top = [...all]
          .filter((o) => o.profitMarginPercent !== null)
          // Full margins before upper bounds (no toll) — as the API sorts.
          .sort(byMarginDesc)
          .slice(0, 3);
        setTopOffers(top);
        setAiRecos((batchRes.data as AiReco[]).slice(0, 5));
        // Offer lookup for the recommendations (heuristic score, ai-evaluation)
        const offersMap: Record<string, TopOffer> = {};
        for (const o of all) offersMap[o.id] = o;
        setOffersMap(offersMap);
        setMatchSuggestions((suggestionsRes.data as MatchSuggestion[]).slice(0, 3));
        setEmailStats(emailRes.data);
        setFailedSections(failed);
      })
      .catch((err) => setLoadError(apiErrorText(err?.response?.data, 'Nie udało się wczytać danych dashboardu.')))
      .finally(() => setLoading(false));
  }, []);

  const kpis = stats ? buildKpis(stats) : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500 mt-1">Przegląd działalności spedycyjnej</p>
      </div>

      {loadError && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{loadError}</div>
      )}
      {failedSections.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg px-4 py-3">
          Nie udało się wczytać: {failedSections.join(', ')}.
        </div>
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {loading
          ? Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)
          : kpis
          ? kpis.map((kpi) => (
              <div key={kpi.label} className="bg-white rounded-xl border shadow-sm p-5">
                <div className={`inline-flex items-center justify-center w-10 h-10 rounded-lg ${kpi.bg} ${kpi.text} mb-3`}>
                  {kpi.icon}
                </div>
                <p className="text-2xl font-bold text-gray-900">{kpi.value}</p>
                <p className="text-sm text-gray-500 mt-1">{kpi.label}</p>
                {'note' in kpi && kpi.note && <p className="text-xs text-gray-400 mt-1">{kpi.note}</p>}
              </div>
            ))
          : Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="bg-white rounded-xl border shadow-sm p-5">
                <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-gray-100 text-gray-400 mb-3">
                  <IconBox />
                </div>
                <p className="text-2xl font-bold text-gray-400">—</p>
                <p className="text-sm text-gray-400 mt-1">Brak danych</p>
              </div>
            ))}
      </div>
      {!loading && moneyNotes(stats?.money).map((note) => (
        <p key={note} className="text-xs text-gray-500 -mt-3">{note}</p>
      ))}

      {/* Top profitable offers */}
      {!loading && topOffers.length > 0 && (
        <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
              <h2 className="text-base font-semibold text-gray-800">Najbardziej opłacalne oferty</h2>
              <span className="text-xs text-gray-400">spośród {TOP_OFFERS_FROM} najnowszych</span>
            </div>
            <Link href="/offers" className="text-xs text-brand-600 hover:underline">
              Wszystkie →
            </Link>
          </div>
          <div className="hidden xl:block">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                {[
                  { label: 'Trasa' },
                  { label: 'Dystans', cls: 'hidden lg:table-cell' },
                  { label: 'Fracht' },
                  { label: 'Stawka/km', cls: 'hidden lg:table-cell' },
                  { label: 'Marża' },
                  { label: 'Status' },
                ].map((h) => (
                  <th key={h.label} className={`px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide ${h.cls ?? ''}`}>
                    {h.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {topOffers.map((o, i) => (
                <tr key={o.id} className="hover:bg-gray-50 transition">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className={`w-5 h-5 rounded-full text-xs font-bold flex items-center justify-center text-white ${i === 0 ? 'bg-amber-400' : i === 1 ? 'bg-gray-400' : 'bg-orange-400'}`}>
                        {i + 1}
                      </span>
                      <Link href={`/offers/${o.id}`} className="font-mono text-xs text-gray-700 hover:text-brand-600">
                        {o.pickupCity}, {o.pickupCountry} → {o.deliveryCity}, {o.deliveryCountry}
                      </Link>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs hidden lg:table-cell">
                    {o.distanceKm ? `${o.distanceKm} km` : '—'}
                  </td>
                  <td className="px-4 py-3 font-medium text-gray-900">
                    {o.price ? `${Number(o.price).toLocaleString('pl-PL')} ${o.currency}` : '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-600 hidden lg:table-cell">
                    {perKmLabel(o.pricePerKm, o.currency)}
                  </td>
                  <td className="px-4 py-3">
                    <MarginBadge offer={o} />
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_COLOR[o.status] ?? 'bg-gray-100 text-gray-600'}`}>
                      {STATUS_LABEL[o.status] ?? o.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          {/* Cards — mobile/tablet/laptop */}
          <div className="xl:hidden divide-y">
            {topOffers.map((o, i) => (
              <div key={o.id} className="px-4 py-3 hover:bg-gray-50 transition">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`w-5 h-5 rounded-full text-xs font-bold flex items-center justify-center text-white shrink-0 ${i === 0 ? 'bg-amber-400' : i === 1 ? 'bg-gray-400' : 'bg-orange-400'}`}>
                      {i + 1}
                    </span>
                    <Link href={`/offers/${o.id}`} className="text-sm font-semibold text-gray-900 hover:text-brand-600">
                      {o.pickupCity}, {o.pickupCountry} → {o.deliveryCity}, {o.deliveryCountry}
                    </Link>
                  </div>
                  <span className={`shrink-0 inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_COLOR[o.status] ?? 'bg-gray-100 text-gray-600'}`}>
                    {STATUS_LABEL[o.status] ?? o.status}
                  </span>
                </div>
                <div className="flex items-baseline gap-3 flex-wrap ml-7 text-xs">
                  <span className="font-medium text-gray-900">
                    {o.price ? `${Number(o.price).toLocaleString('pl-PL')} ${o.currency}` : '—'}
                  </span>
                  {o.distanceKm && <span className="text-gray-500">{o.distanceKm} km</span>}
                  {o.pricePerKm && <span className="text-gray-500">{perKmLabel(o.pricePerKm, o.currency)}</span>}
                  <MarginBadge offer={o} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recommendations — heuristic score (ai-evaluation), no AI model */}
      {!loading && aiRecos.length > 0 && (
        <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-brand-500 inline-block" />
              <h2 className="text-base font-semibold text-gray-800">Rekomendacje na dziś</h2>
              <span className="text-xs text-gray-400">Top 5 oceny heurystycznej</span>
            </div>
            <Link href="/offers" className="text-xs text-brand-600 hover:underline">
              Wszystkie →
            </Link>
          </div>
          <div className="divide-y">
            {aiRecos.map((r) => {
              const offer = offersMap[r.offerId];
              const scoreBg = r.score >= 8 ? 'bg-green-600' : r.score >= 5 ? 'bg-amber-500' : 'bg-red-500';
              const marginRatingLabel: Record<string, { text: string; cls: string }> = {
                excellent: { text: 'Doskonała', cls: 'bg-green-100 text-green-700' },
                // A margin without a toll ≥ 10 % — an upper bound, the real one unknown.
                uncertain: { text: 'Niepewna (bez myta)', cls: 'bg-gray-100 text-gray-700' },
                good: { text: 'Dobra', cls: 'bg-blue-100 text-blue-700' },
                fair: { text: 'Przeciętna', cls: 'bg-amber-100 text-amber-700' },
                poor: { text: 'Słaba', cls: 'bg-red-100 text-red-700' },
              };
              const mr = marginRatingLabel[r.marginRating];
              // Places and price from the evaluation result, not from `route` ("PL→DE").
              const planRouteHref = recommendationPlannerHref(r);

              return (
                <div key={r.offerId} className="px-6 py-4 hover:bg-gray-50 transition">
                  <div className="flex items-start gap-4">
                    <span className={`mt-0.5 w-8 h-8 rounded-full text-sm font-bold flex items-center justify-center text-white shrink-0 ${scoreBg}`}>
                      {r.score}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Link href={`/offers/${r.offerId}`} className="text-sm font-semibold text-gray-900 hover:text-brand-600 font-mono">
                          {recommendationRoute(r)}
                        </Link>
                        {mr && (
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${mr.cls}`}>
                            {mr.text}
                          </span>
                        )}
                      </div>
                      {r.price != null && (
                        <p className="text-xs text-gray-600 mt-1 font-medium">
                          {Number(r.price).toLocaleString('pl-PL')} {r.currency}
                          {offer?.pricePerKm ? ` (${Number(offer.pricePerKm).toFixed(2)} ${r.currency}/km)` : ''}
                        </p>
                      )}
                      <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{r.recommendation}</p>
                      <div className="flex items-center gap-2 mt-2">
                        <Link
                          href={`/offers/${r.offerId}`}
                          className="inline-flex items-center px-3 py-1 rounded-lg text-xs font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 transition"
                        >
                          Szczegóły
                        </Link>
                        <Link
                          href={planRouteHref}
                          className="inline-flex items-center px-3 py-1 rounded-lg text-xs font-medium bg-brand-50 text-brand-700 hover:bg-brand-100 transition"
                        >
                          Planuj trasę
                        </Link>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Matching suggestions */}
      {!loading && matchSuggestions.length > 0 && (
        <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-indigo-500 inline-block" />
              <h2 className="text-base font-semibold text-gray-800">Sugestie dopasowań</h2>
              <span className="text-xs text-gray-400">Oferty i pojazdy z najwyższym score</span>
            </div>
            <Link href="/fleet" className="text-xs text-brand-600 hover:underline">
              Flota →
            </Link>
          </div>
          <div className="divide-y">
            {matchSuggestions.map((s, i) => {
              const barColor = s.matchScore >= 80 ? 'bg-green-500' : s.matchScore >= 50 ? 'bg-amber-400' : 'bg-red-400';
              const scoreText = s.matchScore >= 80 ? 'text-green-700' : s.matchScore >= 50 ? 'text-amber-600' : 'text-red-600';
              return (
                <div key={i} className="px-6 py-4 space-y-2 hover:bg-gray-50 transition">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Link href={`/offers/${s.offer.id}`} className="text-sm font-semibold text-gray-900 hover:text-brand-600 font-mono">
                          {s.offer.route}
                        </Link>
                        <span className="text-xs text-gray-400">→</span>
                        <Link href={`/fleet/${s.vehicle.id}`} className="text-sm text-brand-600 hover:underline">
                          {s.vehicle.name} ({s.vehicle.licensePlate})
                        </Link>
                      </div>
                      {s.offer.price && (
                        <p className="text-xs text-gray-400 mt-0.5">
                          {s.offer.price.toLocaleString('pl-PL')} {s.offer.currency}
                        </p>
                      )}
                    </div>
                    <span className={`text-lg font-bold shrink-0 ${scoreText}`}>{s.matchScore}%</span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-1">
                    <div className={`${barColor} h-1 rounded-full`} style={{ width: `${s.matchScore}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Email AI widget */}
      {!loading && emailStats && emailStats.total > 0 && (
        <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-cyan-500 inline-block" />
              <h2 className="text-base font-semibold text-gray-800">Poczta AI</h2>
              {emailStats.unread > 0 && (
                <span className="ml-1 bg-brand-600 text-white text-xs font-bold px-2 py-0.5 rounded-full">
                  {emailStats.unread} nowych
                </span>
              )}
            </div>
            <Link href="/email" className="text-xs text-brand-600 hover:underline">
              Skrzynka →
            </Link>
          </div>
          <div className="px-6 py-4 flex items-center gap-8 flex-wrap">
            <div className="text-center">
              <p className="text-2xl font-bold text-gray-900">{emailStats.total}</p>
              <p className="text-xs text-gray-500">Wszystkie</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-brand-600">{emailStats.unread}</p>
              <p className="text-xs text-gray-500">Nieprzeczytane</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-amber-600">{emailStats.offersToReview}</p>
              <p className="text-xs text-gray-500">Oferty do przyjęcia</p>
            </div>
            <div className="flex gap-3 flex-wrap">
              {Object.entries(emailStats.byCategory).map(([cat, count]) => (
                <div key={cat} className="flex items-center gap-1.5">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    cat === 'OFFER' ? 'bg-blue-100 text-blue-700' :
                    cat === 'INQUIRY' ? 'bg-purple-100 text-purple-700' :
                    cat === 'COMPLAINT' ? 'bg-red-100 text-red-700' :
                    cat === 'INVOICE' ? 'bg-amber-100 text-amber-700' :
                    'bg-gray-100 text-gray-600'
                  }`}>
                    {cat === 'OFFER' ? 'Oferty' : cat === 'INQUIRY' ? 'Zapytania' : cat === 'COMPLAINT' ? 'Reklamacje' : cat === 'INVOICE' ? 'Faktury' : 'Inne'}: {count}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Recent offers */}
      <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-800">Ostatnie oferty</h2>
          <Link href="/offers" className="text-xs text-brand-600 hover:underline">
            Wszystkie →
          </Link>
        </div>
        {loading && <p className="text-sm text-gray-400 text-center py-8">Ładowanie...</p>}
        {!loading && !stats?.recentOffers?.length && (
          <p className="text-sm text-gray-400 text-center py-8">Brak ofert</p>
        )}
        {!loading && stats?.recentOffers && stats.recentOffers.length > 0 && (<>
          <div className="hidden xl:block">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                {[
                  { label: 'ID' },
                  { label: 'Trasa' },
                  { label: 'Data załadunku', cls: 'hidden lg:table-cell' },
                  { label: 'Fracht' },
                  { label: 'Stawka/km', cls: 'hidden lg:table-cell' },
                  { label: 'Marża' },
                  { label: 'Status' },
                ].map((h) => (
                  <th key={h.label} className={`px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide ${h.cls ?? ''}`}>
                    {h.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {stats.recentOffers.map((o) => (
                <tr key={o.id} className="hover:bg-gray-50 transition">
                  <td className="px-4 py-3 font-medium text-gray-900">
                    <Link href={`/offers/${o.id}`} className="hover:text-brand-600">
                      {o.externalId ?? o.id.slice(0, 8)}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-gray-600 font-mono text-xs">
                    {o.pickupPostal ? `${o.pickupCountry} ${o.pickupPostal}` : `${o.pickupCity}, ${o.pickupCountry}`}
                    {' → '}
                    {o.deliveryPostal ? `${o.deliveryCountry} ${o.deliveryPostal}` : `${o.deliveryCity}, ${o.deliveryCountry}`}
                  </td>
                  <td className="px-4 py-3 text-gray-600 hidden lg:table-cell">
                    {new Date(o.pickupDate).toLocaleDateString('pl-PL')}
                  </td>
                  <td className="px-4 py-3 text-gray-900 font-medium">
                    {o.price ? `${Number(o.price).toLocaleString('pl-PL')} ${o.currency}` : '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-600 hidden lg:table-cell">
                    {perKmLabel(o.pricePerKm, o.currency)}
                  </td>
                  <td className="px-4 py-3"><MarginBadge offer={o} /></td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_COLOR[o.status] ?? 'bg-gray-100 text-gray-600'}`}>
                      {STATUS_LABEL[o.status] ?? o.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          {/* Cards — mobile/tablet/laptop */}
          <div className="xl:hidden divide-y">
            {stats.recentOffers.map((o) => (
              <div key={o.id} className="px-4 py-3 hover:bg-gray-50 transition">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <div className="min-w-0 flex-1">
                    <Link href={`/offers/${o.id}`} className="text-sm font-semibold text-gray-900 hover:text-brand-600">
                      {o.pickupPostal ? `${o.pickupCountry} ${o.pickupPostal}` : `${o.pickupCity}, ${o.pickupCountry}`}
                      {' → '}
                      {o.deliveryPostal ? `${o.deliveryCountry} ${o.deliveryPostal}` : `${o.deliveryCity}, ${o.deliveryCountry}`}
                    </Link>
                    <p className="text-xs text-gray-400 mt-0.5">{new Date(o.pickupDate).toLocaleDateString('pl-PL')}</p>
                  </div>
                  <span className={`shrink-0 inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_COLOR[o.status] ?? 'bg-gray-100 text-gray-600'}`}>
                    {STATUS_LABEL[o.status] ?? o.status}
                  </span>
                </div>
                <div className="flex items-baseline gap-3 flex-wrap text-xs">
                  <span className="font-medium text-gray-900">
                    {o.price ? `${Number(o.price).toLocaleString('pl-PL')} ${o.currency}` : '—'}
                  </span>
                  {o.pricePerKm && <span className="text-gray-500">{perKmLabel(o.pricePerKm, o.currency)}</span>}
                  <MarginBadge offer={o} />
                </div>
              </div>
            ))}
          </div>
        </>)}
      </div>
    </div>
  );
}
