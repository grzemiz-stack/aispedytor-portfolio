'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';
import { apiErrorText } from '@/lib/api-error';
import { offerStatusRequest } from '@/lib/offer-status';
import { acceptBlock } from '@/lib/blacklist-accept';
import { useAuthStore } from '@/store/auth.store';
import { NegotiationPanel } from '@/components/negotiation-panel';
import Pagination from '@/components/pagination';
import MarginBadge from '@/components/margin-badge';

interface Offer {
  id: string;
  /** This company's contractor is blacklisted (from the API). */
  contractorBlacklisted?: boolean;
  externalId: string | null;
  status: string;
  source: string;
  pickupCity: string;
  pickupCountry: string;
  pickupPostal: string | null;
  deliveryCity: string;
  deliveryCountry: string;
  deliveryPostal: string | null;
  pickupDate: string;
  price: number | null;
  currency: string;
  cargoType: string | null;
  pricePerKm: number | null;
  profitMarginPercent: number | null;
  /** A margin without a toll = an upper bound. */
  marginWithoutTolls?: boolean | null;
  distanceKm: number | null;
  contractor: { name: string } | null;
  isAdr: boolean;
  penaltyClauses: string | null;
  publishStatus?: string;
}

type SortKey = 'price' | 'pricePerKm' | 'profitMarginPercent' | 'pickupDate';

interface EvaluationResult {
  offerId: string;
  score: number;
}

function routeLabel(o: Offer): string {
  const pickup = o.pickupPostal
    ? `${o.pickupCountry} ${o.pickupPostal}`
    : `${o.pickupCity}, ${o.pickupCountry}`;
  const delivery = o.deliveryPostal
    ? `${o.deliveryCountry} ${o.deliveryPostal}`
    : `${o.deliveryCity}, ${o.deliveryCountry}`;
  return `${pickup} → ${delivery}`;
}

const STATUS_LABEL: Record<string, string> = {
  NEW: 'Nowa',
  ASSIGNED: 'Przypisana',
  ACCEPTED: 'Zaakceptowana',
  REJECTED: 'Odrzucona',
  EXPIRED: 'Wygasła',
  IN_TRANSIT: 'W transporcie',
  COMPLETED: 'Zakończona',
};

const STATUS_COLOR: Record<string, string> = {
  NEW: 'bg-blue-100 text-blue-700',
  ASSIGNED: 'bg-indigo-100 text-indigo-700',
  ACCEPTED: 'bg-green-100 text-green-700',
  REJECTED: 'bg-red-100 text-red-700',
  EXPIRED: 'bg-gray-100 text-gray-500',
  IN_TRANSIT: 'bg-cyan-100 text-cyan-700',
  COMPLETED: 'bg-emerald-100 text-emerald-700',
};

const PUBLISH_STATUS_LABEL: Record<string, string> = {
  draft: 'Wersja robocza',
  published: 'Opublikowana',
  failed: 'Błąd publikacji',
  none: '',
};

const PUBLISH_STATUS_COLOR: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-500',
  published: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
};

const SOURCE_LABEL: Record<string, string> = {
  MANUAL: 'Manual',
  TRANS_EU: 'Trans.eu',
  TIMOCOM: 'TimoCom',
  TELEROUTE: 'Teleroute',
  GENERIC: 'Generic',
  API: 'API',
  EMAIL: 'Email',
};

const SOURCE_COLOR: Record<string, string> = {
  MANUAL: 'bg-gray-100 text-gray-500',
  TRANS_EU: 'bg-blue-100 text-blue-700',
  TIMOCOM: 'bg-emerald-100 text-emerald-700',
  TELEROUTE: 'bg-orange-100 text-orange-700',
  GENERIC: 'bg-purple-100 text-purple-700',
  API: 'bg-indigo-100 text-indigo-700',
  EMAIL: 'bg-yellow-100 text-yellow-700',
};

const STATUS_ACTIONS: Record<string, Array<{ label: string; status: string }>> = {
  NEW: [
    { label: 'Przypisz do mnie', status: 'ASSIGNED' },
    { label: 'Zaakceptuj', status: 'ACCEPTED' },
    { label: 'Odrzuć', status: 'REJECTED' },
    { label: 'Oznacz jako wygasła', status: 'EXPIRED' },
  ],
  ASSIGNED: [
    { label: 'Zaakceptuj', status: 'ACCEPTED' },
    { label: 'Odrzuć', status: 'REJECTED' },
    { label: 'Oznacz jako wygasła', status: 'EXPIRED' },
  ],
  ACCEPTED: [
    { label: 'W transporcie', status: 'IN_TRANSIT' },
    { label: 'Odrzuć', status: 'REJECTED' },
    { label: 'Oznacz jako wygasła', status: 'EXPIRED' },
  ],
  IN_TRANSIT: [
    { label: 'Zakończ transport', status: 'COMPLETED' },
  ],
  COMPLETED: [],
  REJECTED: [{ label: 'Przywróć (Nowa)', status: 'NEW' }],
  EXPIRED: [{ label: 'Przywróć (Nowa)', status: 'NEW' }],
};


function SortIcon({ active, dir }: { active: boolean; dir: 'asc' | 'desc' }) {
  if (!active) {
    return (
      <svg className="w-3 h-3 text-gray-300 ml-1 inline" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4" />
      </svg>
    );
  }
  return dir === 'desc' ? (
    <svg className="w-3 h-3 text-brand-600 ml-1 inline" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  ) : (
    <svg className="w-3 h-3 text-brand-600 ml-1 inline" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
    </svg>
  );
}

function ActionMenu({
  offer,
  onStatusChange,
}: {
  offer: Offer;
  onStatusChange: (id: string, status: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const actions = STATUS_ACTIONS[offer.status] ?? [];
  // The blacklist: "Zaakceptuj" disabled for a non-ADMIN, with a warning for an ADMIN.
  const role = useAuthStore((s) => s.user?.role);
  const block = acceptBlock(offer.contractorBlacklisted === true, role);
  if (actions.length === 0) return null;

  async function handleAction(status: string) {
    setLoading(status);
    setOpen(false);
    await onStatusChange(offer.id, status);
    setLoading(null);
  }

  return (
    <div ref={ref} className="relative flex justify-end">
      <button
        onClick={(e) => { e.preventDefault(); setOpen((v) => !v); }}
        disabled={loading !== null}
        className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition disabled:opacity-40"
        title="Akcje"
      >
        {loading ? (
          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
          </svg>
        ) : (
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <circle cx="10" cy="4" r="1.5" />
            <circle cx="10" cy="10" r="1.5" />
            <circle cx="10" cy="16" r="1.5" />
          </svg>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-8 z-20 bg-white border border-gray-200 rounded-xl shadow-lg py-1 min-w-[180px]">
          {actions.map((a) => (
            <button
              key={a.status}
              onClick={() => handleAction(a.status)}
              disabled={a.status === 'ACCEPTED' && block.disabled}
              title={a.status === 'ACCEPTED' ? block.note ?? undefined : undefined}
              className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {a.label}
              {a.status === 'ACCEPTED' && block.note && (
                <span className={`block text-xs ${block.disabled ? 'text-red-600' : 'text-amber-700'}`}>{block.note}</span>
              )}
            </button>
          ))}
          <div className="border-t border-gray-100 mt-1 pt-1">
            <Link
              href={`/offers/${offer.id}`}
              className="block px-4 py-2 text-sm text-brand-600 hover:bg-gray-50 transition"
              onClick={() => setOpen(false)}
            >
              Otwórz szczegóły →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

const SOURCE_FILTERS = ['', 'MANUAL', 'TRANS_EU', 'TIMOCOM', 'TELEROUTE', 'GENERIC'];

export default function OffersPage() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [offers, setOffers] = useState<Offer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  /** Error of an action on the list (status, offer score) — the list stays visible. */
  const [actionError, setActionError] = useState('');
  const [statusFilter, setStatusFilter] = useState(searchParams.get('status') ?? '');
  const [sourceFilter, setSourceFilter] = useState(searchParams.get('source') ?? '');
  const [sortBy, setSortBy] = useState<SortKey>((searchParams.get('sortBy') as SortKey) ?? 'createdAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>((searchParams.get('sortOrder') as 'asc' | 'desc') ?? 'desc');
  const [page, setPage] = useState(parseInt(searchParams.get('page') ?? '1'));
  const [limit, setLimit] = useState(parseInt(searchParams.get('limit') ?? '20'));
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [aiScores, setAiScores] = useState<Record<string, number>>({});
  const [aiLoadingId, setAiLoadingId] = useState<string | null>(null);
  const [negotiateOfferId, setNegotiateOfferId] = useState<string | null>(null);

  function updateUrl(p: number, l: number, sb: string, so: string, st: string, src: string) {
    const params = new URLSearchParams();
    if (p > 1) params.set('page', String(p));
    if (l !== 20) params.set('limit', String(l));
    if (sb !== 'createdAt') params.set('sortBy', sb);
    if (so !== 'desc') params.set('sortOrder', so);
    if (st) params.set('status', st);
    if (src) params.set('source', src);
    const qs = params.toString();
    router.replace(qs ? `?${qs}` : '/offers', { scroll: false });
  }

  const load = useCallback(() => {
    setLoading(true);
    const params: Record<string, string> = {
      page: String(page),
      limit: String(limit),
      sortBy,
      sortOrder: sortDir,
    };
    if (statusFilter) params.status = statusFilter;
    if (sourceFilter) params.source = sourceFilter;
    return Promise.all([
      apiClient.get('/offers', { params }),
      // Scores (heuristic, ai-evaluation) are an extra column — the list works without them but says they are missing.
      apiClient.get('/ai-evaluation/batch').catch((err) => {
        setActionError(apiErrorText(err?.response?.data, 'Nie udało się wczytać ocen ofert.'));
        return { data: [] };
      }),
    ])
      .then(([offersRes, batchRes]) => {
        setOffers(offersRes.data.data);
        setTotalPages(offersRes.data.meta.totalPages);
        setTotal(offersRes.data.meta.total);
        const map: Record<string, number> = {};
        (batchRes.data as EvaluationResult[]).forEach((r) => { map[r.offerId] = r.score; });
        setAiScores((prev) => ({ ...prev, ...map }));
      })
      .catch(() => setError('Nie udało się załadować ofert'))
      .finally(() => setLoading(false));
  }, [statusFilter, sourceFilter, page, limit, sortBy, sortDir]);

  useEffect(() => { load(); }, [load]);

  async function handleStatusChange(id: string, status: string) {
    setActionError('');
    // "Przypisz do mnie" = assigning the person, not just the status.
    const req = offerStatusRequest(id, status, useAuthStore.getState().user?.id);
    if (!req) {
      setActionError('Nie wiadomo, kim jesteś — zaloguj się ponownie, żeby przypisać ofertę.');
      return;
    }
    try {
      await apiClient.patch(req.url, req.body);
      await load();
    } catch (err: any) {
      setActionError(apiErrorText(err?.response?.data, 'Nie udało się zmienić statusu oferty.'));
    }
  }

  async function handleAiScore(offerId: string) {
    setAiLoadingId(offerId);
    try {
      const r = await apiClient.post(`/ai-evaluation/evaluate/${offerId}`);
      setAiScores((prev) => ({ ...prev, [offerId]: r.data.score }));
    } catch (err: any) {
      setActionError(apiErrorText(err?.response?.data, 'Nie udało się wykonać oceny oferty.'));
    }
    setAiLoadingId(null);
  }

  function handleSort(key: SortKey) {
    const newDir = sortBy === key ? (sortDir === 'asc' ? 'desc' : 'asc') : 'desc';
    setSortBy(key);
    setSortDir(newDir);
    setPage(1);
    updateUrl(1, limit, key, newDir, statusFilter, sourceFilter);
  }

  function handlePageChange(p: number) {
    setPage(p);
    updateUrl(p, limit, sortBy, sortDir, statusFilter, sourceFilter);
  }

  function handleLimitChange(l: number) {
    setLimit(l);
    setPage(1);
    updateUrl(1, l, sortBy, sortDir, statusFilter, sourceFilter);
  }

  type HeaderCol = { label: string; sortKey?: SortKey; hiddenClass?: string };
  const headers: HeaderCol[] = [
    { label: 'ID / Zewnętrzny' },
    { label: 'Trasa' },
    { label: 'Data', sortKey: 'pickupDate' },
    { label: 'Kontrahent', hiddenClass: 'hidden lg:table-cell' },
    { label: 'Fracht', sortKey: 'price' },
    { label: '€/km', sortKey: 'pricePerKm' },
    { label: 'Marża', sortKey: 'profitMarginPercent' },
    { label: 'Status' },
    { label: 'Źródło', hiddenClass: 'hidden xl:table-cell' },
    { label: 'Publikacja', hiddenClass: 'hidden xl:table-cell' },
    { label: 'Ocena' },
    { label: 'Negocjuj' },
    { label: '' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Oferty</h1>
          <p className="text-sm text-gray-500 mt-1">Zarządzaj zleceniami transportowymi</p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/offers/new"
            className="bg-brand-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-brand-700 transition text-center"
          >
            + Nowa oferta
          </Link>
        </div>
      </div>

      {/* Status filters */}
      <div className="flex gap-2 flex-wrap">
        {['', 'NEW', 'ASSIGNED', 'ACCEPTED', 'IN_TRANSIT', 'COMPLETED', 'REJECTED', 'EXPIRED'].map((s) => (
          <button
            key={s}
            onClick={() => { setStatusFilter(s); setPage(1); updateUrl(1, limit, sortBy, sortDir, s, sourceFilter); }}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition ${statusFilter === s ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}
          >
            {s === '' ? 'Wszystkie statusy' : STATUS_LABEL[s]}
          </button>
        ))}
      </div>

      {/* Source filters */}
      <div className="flex gap-2 flex-wrap">
        {SOURCE_FILTERS.map((s) => (
          <button
            key={s}
            onClick={() => { setSourceFilter(s); setPage(1); updateUrl(1, limit, sortBy, sortDir, statusFilter, s); }}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition ${sourceFilter === s ? 'bg-gray-800 text-white border-gray-800' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'}`}
          >
            {s === '' ? 'Wszystkie źródła' : SOURCE_LABEL[s] ?? s}
          </button>
        ))}
      </div>

      {actionError && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{actionError}</div>
      )}

      <div className="bg-white rounded-xl border shadow-sm overflow-visible">
        {loading && <p className="text-sm text-gray-400 text-center py-12">Ładowanie...</p>}
        {error && <p className="text-sm text-red-500 text-center py-12">{error}</p>}
        {!loading && !error && offers.length === 0 && (
          <p className="text-sm text-gray-400 text-center py-12">Brak ofert</p>
        )}
        {offers.length > 0 && (<>
          {/* Desktop table — xl+ */}
          <div className="hidden xl:block">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                {headers.map((h, i) => (
                  <th
                    key={i}
                    onClick={h.sortKey ? () => handleSort(h.sortKey!) : undefined}
                    className={`px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap ${h.sortKey ? 'cursor-pointer hover:text-gray-800 select-none' : ''} ${h.hiddenClass ?? ''}`}
                  >
                    {h.label}
                    {h.sortKey && (
                      <SortIcon active={sortBy === h.sortKey} dir={sortDir} />
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {offers.map((o) => {
                const isTop = o.profitMarginPercent !== null && Number(o.profitMarginPercent) >= 15;
                return (
                  <tr key={o.id} className="hover:bg-gray-50 transition">
                    <td className="px-4 py-3 font-medium text-gray-900">
                      <Link href={`/offers/${o.id}`} className="hover:text-brand-600">
                        {o.externalId ?? o.id.slice(0, 8)}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-gray-600 font-mono text-xs">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span>{routeLabel(o)}</span>
                        {o.isAdr && (
                          <span title="Ładunek ADR" className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-bold bg-orange-100 text-orange-700 border border-orange-200">
                            ADR
                          </span>
                        )}
                        {o.penaltyClauses && (
                          <span title="Kary umowne" className="text-amber-500 text-sm leading-none">⚠</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {new Date(o.pickupDate).toLocaleDateString('pl-PL')}
                    </td>
                    <td className="px-4 py-3 text-gray-500 hidden lg:table-cell">
                      {o.contractor?.name ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-900 font-medium">
                      {o.price ? `${Number(o.price).toLocaleString('pl-PL')} ${o.currency}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {o.pricePerKm ? `${Number(o.pricePerKm).toFixed(2)}` : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <MarginBadge offer={o} />
                        {isTop && (
                          <span className="inline-flex px-1.5 py-0.5 rounded text-xs font-bold bg-amber-400 text-white tracking-wide">
                            TOP
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_COLOR[o.status] ?? 'bg-gray-100 text-gray-600'}`}>
                        {STATUS_LABEL[o.status] ?? o.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 hidden xl:table-cell">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${SOURCE_COLOR[o.source] ?? 'bg-gray-100 text-gray-500'}`}>
                        {SOURCE_LABEL[o.source] ?? o.source}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap hidden xl:table-cell">
                      {o.publishStatus && o.publishStatus !== 'none' && (
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${PUBLISH_STATUS_COLOR[o.publishStatus] ?? ''}`}>
                          {PUBLISH_STATUS_LABEL[o.publishStatus] ?? o.publishStatus}
                        </span>
                      )}
                      {o.publishStatus === 'failed' && (
                        <button
                          onClick={async (e) => { e.preventDefault(); /* placeholder — Trans.eu publish retry */ }}
                          className="ml-1 text-xs text-red-600 hover:underline"
                        >
                          Ponów
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {aiScores[o.id] !== undefined ? (
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-bold ${
                          aiScores[o.id] >= 8 ? 'bg-green-100 text-green-700' :
                          aiScores[o.id] >= 5 ? 'bg-amber-100 text-amber-700' :
                          'bg-red-100 text-red-700'
                        }`}>
                          {aiScores[o.id]}/10
                        </span>
                      ) : (
                        <button
                          onClick={() => handleAiScore(o.id)}
                          disabled={aiLoadingId === o.id}
                          className="text-xs text-brand-600 hover:underline disabled:opacity-50"
                        >
                          {aiLoadingId === o.id ? '...' : 'Oceń'}
                        </button>
                      )}
                    </td>
                    <td className="px-2 py-3">
                      <button
                        onClick={(e) => { e.preventDefault(); setNegotiateOfferId(o.id); }}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-brand-50 text-brand-700 hover:bg-brand-100 border border-brand-200 transition"
                        title="Analiza negocjacyjna"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M7 11.5V14m0-2.5v-6a1.5 1.5 0 113 0m-3 6a1.5 1.5 0 00-3 0v2a7.5 7.5 0 0015 0v-5a1.5 1.5 0 00-3 0m-6-3V11m0-5.5v-1a1.5 1.5 0 013 0v1m0 0V11m0-5.5a1.5 1.5 0 013 0v3m0 0V11" />
                        </svg>
                        Negocjuj
                      </button>
                    </td>
                    <td className="px-2 py-3 w-10">
                      <ActionMenu offer={o} onStatusChange={handleStatusChange} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
          {/* Cards — mobile/tablet/laptop */}
          <div className="xl:hidden divide-y">
            {offers.map((o) => {
              const isTop = o.profitMarginPercent !== null && Number(o.profitMarginPercent) >= 15;
              return (
                <div key={o.id} className="p-4 hover:bg-gray-50 transition">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="min-w-0 flex-1">
                      <Link href={`/offers/${o.id}`} className="font-semibold text-gray-900 hover:text-brand-600 text-sm">
                        {routeLabel(o)}
                      </Link>
                      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                        {o.isAdr && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-bold bg-orange-100 text-orange-700 border border-orange-200">ADR</span>
                        )}
                        {o.penaltyClauses && <span className="text-amber-500 text-sm leading-none">⚠</span>}
                        <span className="text-xs text-gray-400">{new Date(o.pickupDate).toLocaleDateString('pl-PL')}</span>
                        {o.contractor?.name && <span className="text-xs text-gray-400">• {o.contractor.name}</span>}
                      </div>
                    </div>
                    <span className={`shrink-0 inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_COLOR[o.status] ?? 'bg-gray-100 text-gray-600'}`}>
                      {STATUS_LABEL[o.status] ?? o.status}
                    </span>
                  </div>
                  <div className="flex items-baseline gap-3 flex-wrap mb-3">
                    <span className="text-lg font-bold text-gray-900">
                      {o.price ? `${Number(o.price).toLocaleString('pl-PL')} ${o.currency}` : '—'}
                    </span>
                    {o.distanceKm && <span className="text-xs text-gray-500">{o.distanceKm} km</span>}
                    {o.pricePerKm && <span className="text-xs text-gray-500">{Number(o.pricePerKm).toFixed(2)} €/km</span>}
                    <MarginBadge offer={o} />
                    {isTop && (
                      <span className="inline-flex px-1.5 py-0.5 rounded text-xs font-bold bg-amber-400 text-white">TOP</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Link href={`/offers/${o.id}`} className="inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 transition">
                      Szczegóły
                    </Link>
                    <button
                      onClick={(e) => { e.preventDefault(); setNegotiateOfferId(o.id); }}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-brand-50 text-brand-700 hover:bg-brand-100 border border-brand-200 transition"
                    >
                      Negocjuj
                    </button>
                    {aiScores[o.id] !== undefined ? (
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-bold ${
                        aiScores[o.id] >= 8 ? 'bg-green-100 text-green-700' :
                        aiScores[o.id] >= 5 ? 'bg-amber-100 text-amber-700' :
                        'bg-red-100 text-red-700'
                      }`}>
                        Ocena {aiScores[o.id]}/10
                      </span>
                    ) : (
                      <button
                        onClick={() => handleAiScore(o.id)}
                        disabled={aiLoadingId === o.id}
                        className="text-xs text-brand-600 hover:underline disabled:opacity-50"
                      >
                        {aiLoadingId === o.id ? '...' : 'Oceń'}
                      </button>
                    )}
                    <ActionMenu offer={o} onStatusChange={handleStatusChange} />
                  </div>
                </div>
              );
            })}
          </div>
        </>)}
      </div>

      {!loading && total > 0 && (
        <Pagination
          page={page}
          totalPages={totalPages}
          total={total}
          limit={limit}
          onPageChange={handlePageChange}
          onLimitChange={handleLimitChange}
        />
      )}

      {negotiateOfferId && (
        <NegotiationPanel
          offerId={negotiateOfferId}
          isOpen={!!negotiateOfferId}
          onClose={() => setNegotiateOfferId(null)}
        />
      )}
    </div>
  );
}
