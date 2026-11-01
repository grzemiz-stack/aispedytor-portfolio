'use client';

import { useState, useEffect, useCallback, Fragment } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';
import { apiErrorText } from '@/lib/api-error';
import { demandSearchView, type DemandSearchView } from '@/lib/demand-search';
import Pagination from '@/components/pagination';

interface Demand {
  id: string;
  title: string;
  description: string | null;
  priority: string;
  status: string;
  neededBy: string | null;
  vehicleType: string | null;
  trailerType: string | null;
  minLoadingMeters: number | null;
  maxWeight: number | null;
  temperatureRequired: boolean;
  temperatureMin: number | null;
  temperatureMax: number | null;
  adrRequired: boolean;
  adrClass: string | null;
  preferredCountries: string[];
  autoNotify: boolean;
  matchCount: number;
  lastSearchAt: string | null;
  createdAt: string;
}

const PRIORITY_COLOR: Record<string, string> = {
  LOW: 'bg-gray-100 text-gray-600',
  MEDIUM: 'bg-blue-100 text-blue-700',
  HIGH: 'bg-amber-100 text-amber-700',
  URGENT: 'bg-red-100 text-red-700',
};

const STATUS_LABEL: Record<string, string> = {
  OPEN: 'Otwarte',
  IN_PROGRESS: 'W toku',
  FULFILLED: 'Zrealizowane',
  CANCELLED: 'Anulowane',
};

const STATUS_COLOR: Record<string, string> = {
  OPEN: 'bg-blue-100 text-blue-700',
  IN_PROGRESS: 'bg-indigo-100 text-indigo-700',
  FULFILLED: 'bg-green-100 text-green-700',
  CANCELLED: 'bg-gray-100 text-gray-500',
};

const VEHICLE_TYPES = [
  { value: 'CURTAINSIDER', label: 'Firanka', icon: '\u{1F6A8}' },
  { value: 'REEFER', label: 'Chłodnia', icon: '\u2744\uFE0F' },
  { value: 'MEGA', label: 'Mega', icon: '\u{1F69B}' },
  { value: 'BOX', label: 'Furgon', icon: '\u{1F4E6}' },
  { value: 'TANKER', label: 'Cysterna', icon: '\u{1F6E2}\uFE0F' },
  { value: 'FLATBED', label: 'Platforma', icon: '\u{1F6FB}' },
  { value: 'LOWLOADER', label: 'Niskopodwozie', icon: '\u{1F3D7}\uFE0F' },
  { value: 'BUS', label: 'Bus', icon: '\u{1F690}' },
  { value: 'OTHER', label: 'Inny', icon: '\u{1F69A}' },
];

const TRAILER_TYPES = [
  { value: 'STANDARD', label: 'Standard' },
  { value: 'MEGA', label: 'Mega' },
  { value: 'REEFER', label: 'Chłodnia' },
  { value: 'CURTAINSIDER', label: 'Firanka' },
];

const ADR_CLASSES = ['1', '2', '3', '4.1', '4.2', '4.3', '5.1', '5.2', '6.1', '6.2', '7', '8', '9'];

const EU_COUNTRIES = [
  { code: 'DE', label: 'Niemcy' }, { code: 'PL', label: 'Polska' },
  { code: 'NL', label: 'Holandia' }, { code: 'FR', label: 'Francja' },
  { code: 'BE', label: 'Belgia' }, { code: 'CZ', label: 'Czechy' },
  { code: 'AT', label: 'Austria' }, { code: 'IT', label: 'Włochy' },
  { code: 'ES', label: 'Hiszpania' }, { code: 'SE', label: 'Szwecja' },
  { code: 'DK', label: 'Dania' }, { code: 'HU', label: 'Węgry' },
  { code: 'SK', label: 'Słowacja' }, { code: 'RO', label: 'Rumunia' },
  { code: 'LT', label: 'Litwa' }, { code: 'LV', label: 'Łotwa' },
  { code: 'EE', label: 'Estonia' }, { code: 'BG', label: 'Bułgaria' },
];

const inputCls = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500';

const defaultForm = {
  title: '', description: '', priority: 'MEDIUM', neededBy: '',
  vehicleType: '', trailerType: '', minLoadingMeters: '', maxWeight: '',
  temperatureRequired: false, temperatureMin: '', temperatureMax: '',
  adrRequired: false, adrClass: '', preferredCountries: [] as string[],
};

export default function DemandsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [demands, setDemands] = useState<Demand[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...defaultForm });
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');
  const [searchingId, setSearchingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  /** A list load error — not "Brak zapotrzebowań" (no demands). */
  const [listError, setListError] = useState('');
  /** The last "Szukaj" (search) result of each demand, shown under it. */
  const [results, setResults] = useState<Record<string, DemandSearchView>>({});

  // Pagination
  const [page, setPage] = useState(parseInt(searchParams.get('page') ?? '1'));
  const [limit, setLimit] = useState(parseInt(searchParams.get('limit') ?? '20'));
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  function updateUrl(p: number, l: number) {
    const params = new URLSearchParams();
    if (p > 1) params.set('page', String(p));
    if (l !== 20) params.set('limit', String(l));
    const qs = params.toString();
    router.replace(qs ? `?${qs}` : '/demands', { scroll: false });
  }

  const loadDemands = useCallback(() => {
    setLoading(true);
    setListError('');
    apiClient
      .get('/demands', { params: { page: String(page), limit: String(limit) } })
      .then((r) => {
        setDemands(r.data.data);
        setTotalPages(r.data.meta.totalPages);
        setTotal(r.data.meta.total);
      })
      .catch((err) => {
        setDemands([]);
        setListError(apiErrorText(err?.response?.data, 'Nie udało się wczytać zapotrzebowań.'));
      })
      .finally(() => setLoading(false));
  }, [page, limit]);

  useEffect(() => { loadDemands(); }, [loadDemands]);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(''), 4000);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const payload: Record<string, any> = {
        title: form.title,
        description: form.description || undefined,
        priority: form.priority,
        neededBy: form.neededBy || undefined,
        vehicleType: form.vehicleType || undefined,
        trailerType: form.trailerType || undefined,
        minLoadingMeters: form.minLoadingMeters ? parseFloat(form.minLoadingMeters) : undefined,
        maxWeight: form.maxWeight ? parseFloat(form.maxWeight) : undefined,
        temperatureRequired: form.temperatureRequired,
        temperatureMin: form.temperatureMin ? parseFloat(form.temperatureMin) : undefined,
        temperatureMax: form.temperatureMax ? parseFloat(form.temperatureMax) : undefined,
        adrRequired: form.adrRequired,
        adrClass: form.adrClass || undefined,
        preferredCountries: form.preferredCountries.length > 0 ? form.preferredCountries : undefined,
      };
      await apiClient.post('/demands', payload);
      setShowForm(false);
      setForm({ ...defaultForm });
      showToast('Zapotrzebowanie utworzone');
      loadDemands();
    } catch (err: any) {
      showToast(apiErrorText(err?.response?.data, 'Nie udało się utworzyć zapotrzebowania'));
    } finally {
      setSaving(false);
    }
  }

  async function handleSearch(id: string) {
    setSearchingId(id);
    try {
      const r = await apiClient.post(`/demands/${id}/search`);
      setResults((prev) => ({ ...prev, [id]: demandSearchView(r.data) }));
      loadDemands();
    } catch (err: any) {
      showToast(apiErrorText(err?.response?.data, 'Błąd wyszukiwania'));
    } finally {
      setSearchingId(null);
    }
  }

  async function handleToggleNotify(id: string) {
    setTogglingId(id);
    try {
      const r = await apiClient.post(`/demands/${id}/subscribe`);
      showToast(r.data.autoNotify ? 'Auto-powiadomienia wlaczone' : 'Auto-powiadomienia wylaczone');
      loadDemands();
    } catch (err: any) {
      showToast(apiErrorText(err?.response?.data, 'Błąd zmiany powiadomień'));
    } finally {
      setTogglingId(null);
    }
  }

  function toggleCountry(code: string) {
    setForm((f) => ({
      ...f,
      preferredCountries: f.preferredCountries.includes(code)
        ? f.preferredCountries.filter((c) => c !== code)
        : [...f.preferredCountries, code],
    }));
  }

  function handlePageChange(p: number) { setPage(p); updateUrl(p, limit); }
  function handleLimitChange(l: number) { setLimit(l); setPage(1); updateUrl(1, l); }

  const vehicleLabel = (type: string | null) => VEHICLE_TYPES.find((v) => v.value === type);

  return (
    <div className="space-y-6">
      {/* Toast */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-gray-900 text-white px-4 py-2.5 rounded-xl text-sm shadow-lg animate-fade-in">
          {toast}
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Zapotrzebowania</h1>
          <p className="text-sm text-gray-500 mt-1">Zarządzaj zapotrzebowaniami na pojazdy</p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="bg-brand-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-brand-700 transition w-full sm:w-auto"
        >
          + Nowe zapotrzebowanie
        </button>
      </div>

      {/* ── Create Form ── */}
      {showForm && (
        <form onSubmit={handleCreate} className="bg-white rounded-xl border shadow-sm p-6 space-y-5">
          <h2 className="text-sm font-semibold text-gray-800">Nowe zapotrzebowanie</h2>

          {/* Row 1: Title + Priority + NeededBy */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Tytuł *</label>
              <input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
                className={inputCls} placeholder="np. Pojazd do Niemiec — 15.03" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Priorytet</label>
              <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} className={inputCls}>
                <option value="LOW">Niski</option>
                <option value="MEDIUM">Średni</option>
                <option value="HIGH">Wysoki</option>
                <option value="URGENT">Pilny</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Potrzebne do</label>
              <input type="date" value={form.neededBy} onChange={(e) => setForm({ ...form, neededBy: e.target.value })} className={inputCls} />
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Opis</label>
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={2} className={inputCls} />
          </div>

          {/* Row 2: Vehicle params */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Typ pojazdu</label>
              <select value={form.vehicleType} onChange={(e) => setForm({ ...form, vehicleType: e.target.value })} className={inputCls}>
                <option value="">— Dowolny —</option>
                {VEHICLE_TYPES.map((v) => (
                  <option key={v.value} value={v.value}>{v.icon} {v.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Typ naczepy</label>
              <select value={form.trailerType} onChange={(e) => setForm({ ...form, trailerType: e.target.value })} className={inputCls}>
                <option value="">— Dowolny —</option>
                {TRAILER_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Min. metry ładunkowe</label>
              <input type="number" step="0.5" min="1" max="16" value={form.minLoadingMeters}
                onChange={(e) => setForm({ ...form, minLoadingMeters: e.target.value })}
                className={inputCls} placeholder="np. 13.6" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Max. waga (tony)</label>
              <input type="number" step="0.1" min="0.1" max="44" value={form.maxWeight}
                onChange={(e) => setForm({ ...form, maxWeight: e.target.value })}
                className={inputCls} placeholder="np. 24" />
            </div>
          </div>

          {/* Row 3: Temperature + ADR */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-3">
              <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                <input type="checkbox" checked={form.temperatureRequired}
                  onChange={(e) => setForm({ ...form, temperatureRequired: e.target.checked })}
                  className="w-4 h-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500" />
                Wymagana temperatura (chłodnia)
              </label>
              {form.temperatureRequired && (
                <div className="flex gap-3 pl-6">
                  <div className="flex-1">
                    <label className="block text-xs text-gray-500 mb-1">Min °C</label>
                    <input type="number" min="-30" max="30" value={form.temperatureMin}
                      onChange={(e) => setForm({ ...form, temperatureMin: e.target.value })}
                      className={inputCls} placeholder="-18" />
                  </div>
                  <div className="flex-1">
                    <label className="block text-xs text-gray-500 mb-1">Max °C</label>
                    <input type="number" min="-30" max="30" value={form.temperatureMax}
                      onChange={(e) => setForm({ ...form, temperatureMax: e.target.value })}
                      className={inputCls} placeholder="4" />
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-3">
              <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                <input type="checkbox" checked={form.adrRequired}
                  onChange={(e) => setForm({ ...form, adrRequired: e.target.checked })}
                  className="w-4 h-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500" />
                Wymagany ADR
              </label>
              {form.adrRequired && (
                <div className="pl-6">
                  <label className="block text-xs text-gray-500 mb-1">Klasa ADR</label>
                  <select value={form.adrClass} onChange={(e) => setForm({ ...form, adrClass: e.target.value })} className={inputCls}>
                    <option value="">— Dowolna —</option>
                    {ADR_CLASSES.map((c) => (
                      <option key={c} value={c}>Klasa {c}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </div>

          {/* Row 4: Preferred countries */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Preferowane kraje</label>
            <div className="flex flex-wrap gap-1.5">
              {EU_COUNTRIES.map((c) => (
                <button key={c.code} type="button" onClick={() => toggleCountry(c.code)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition ${
                    form.preferredCountries.includes(c.code)
                      ? 'bg-brand-600 text-white border-brand-600'
                      : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                  }`}>
                  {c.code}
                </button>
              ))}
            </div>
          </div>

          {/* Buttons */}
          <div className="flex gap-3">
            <button type="submit" disabled={saving}
              className="bg-brand-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-brand-700 transition disabled:opacity-50">
              {saving ? 'Zapisywanie...' : 'Utwórz'}
            </button>
            <button type="button" onClick={() => setShowForm(false)}
              className="px-4 py-2 rounded-xl text-sm font-medium border border-gray-300 hover:bg-gray-50 transition">
              Anuluj
            </button>
          </div>
        </form>
      )}

      {/* ── Demands List ── */}
      <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
        {loading && <p className="text-sm text-gray-400 text-center py-12">Ładowanie...</p>}
        {!loading && listError && <p className="text-sm text-red-600 text-center py-12">{listError}</p>}
        {!loading && !listError && demands.length === 0 && <p className="text-sm text-gray-400 text-center py-12">Brak zapotrzebowań</p>}
        {demands.length > 0 && (<>
          {/* Desktop table — xl+ */}
          <div className="hidden xl:block">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Priorytet</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Tytuł</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Pojazd</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide hidden lg:table-cell">Waga / Metry</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide hidden xl:table-cell">Kraje</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide hidden lg:table-cell">Dopasowania</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Akcje</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {demands.map((d) => {
                const vt = vehicleLabel(d.vehicleType);
                return (
                  <Fragment key={d.id}>
                  <tr className="hover:bg-gray-50 transition">
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${PRIORITY_COLOR[d.priority] ?? 'bg-gray-100 text-gray-600'}`}>
                        {d.priority}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div>
                        <p className="font-medium text-gray-900">{d.title}</p>
                        {d.description && <p className="text-xs text-gray-500 mt-0.5 truncate max-w-xs">{d.description}</p>}
                        {d.neededBy && <p className="text-xs text-gray-400 mt-0.5">Do: {new Date(d.neededBy).toLocaleDateString('pl-PL')}</p>}
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex flex-col gap-0.5">
                        {vt ? (
                          <span className="text-sm">{vt.icon} {vt.label}</span>
                        ) : (
                          <span className="text-gray-400 text-xs">Dowolny</span>
                        )}
                        {d.trailerType && <span className="text-xs text-gray-500">{d.trailerType}</span>}
                        <div className="flex gap-1.5 mt-0.5">
                          {d.temperatureRequired && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-bold bg-cyan-100 text-cyan-700 border border-cyan-200" title="Chłodnia">
                              {d.temperatureMin != null && d.temperatureMax != null
                                ? `${d.temperatureMin}°/${d.temperatureMax}°`
                                : 'FRIGO'}
                            </span>
                          )}
                          {d.adrRequired && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-bold bg-orange-100 text-orange-700 border border-orange-200" title="ADR">
                              ADR{d.adrClass ? ` ${d.adrClass}` : ''}
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-600 text-xs hidden lg:table-cell">
                      <div className="space-y-0.5">
                        {d.maxWeight && <div>{d.maxWeight} t</div>}
                        {d.minLoadingMeters && <div>{d.minLoadingMeters} m</div>}
                        {!d.maxWeight && !d.minLoadingMeters && <span className="text-gray-400">—</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden xl:table-cell">
                      {d.preferredCountries?.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {d.preferredCountries.map((c) => (
                            <span key={c} className="inline-flex px-1.5 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">{c}</span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-gray-400 text-xs">Wszystkie</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_COLOR[d.status] ?? 'bg-gray-100 text-gray-600'}`}>
                          {STATUS_LABEL[d.status] ?? d.status}
                        </span>
                        {d.autoNotify && (
                          <span className="inline-flex px-1.5 py-0.5 rounded text-xs font-bold bg-emerald-100 text-emerald-700 border border-emerald-200" title="Auto-powiadomienia włączone">
                            Auto
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center hidden lg:table-cell">
                      {d.matchCount > 0 ? (
                        <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-bold bg-brand-100 text-brand-700">
                          {d.matchCount}
                        </span>
                      ) : (
                        <span className="text-gray-400 text-xs">0</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => handleSearch(d.id)}
                          disabled={searchingId === d.id}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-brand-50 text-brand-700 hover:bg-brand-100 border border-brand-200 transition disabled:opacity-50"
                          title="Szukaj pasujących ofert"
                        >
                          {searchingId === d.id ? (
                            <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                            </svg>
                          ) : (
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                            </svg>
                          )}
                          Szukaj
                        </button>
                        <button
                          onClick={() => handleToggleNotify(d.id)}
                          disabled={togglingId === d.id}
                          className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition disabled:opacity-50 ${
                            d.autoNotify
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                              : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
                          }`}
                          title={d.autoNotify ? 'Wyłącz auto-powiadomienia' : 'Włącz auto-powiadomienia'}
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                          </svg>
                          {d.autoNotify ? 'Wył.' : 'Wł.'}
                        </button>
                      </div>
                    </td>
                  </tr>
                  {results[d.id] && (
                    <tr>
                      <td colSpan={8} className="px-4 pb-4">
                        <DemandResults view={results[d.id]} onClose={() => setResults((p) => { const n = { ...p }; delete n[d.id]; return n; })} />
                      </td>
                    </tr>
                  )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          </div>
          {/* Cards — mobile/tablet/laptop */}
          <div className="xl:hidden divide-y">
            {demands.map((d) => {
              const vt = vehicleLabel(d.vehicleType);
              return (
                <div key={d.id} className="p-4 hover:bg-gray-50 transition">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-gray-900 text-sm">{d.title}</p>
                      {d.description && <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{d.description}</p>}
                      {d.neededBy && <p className="text-xs text-gray-400 mt-0.5">Do: {new Date(d.neededBy).toLocaleDateString('pl-PL')}</p>}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${PRIORITY_COLOR[d.priority] ?? 'bg-gray-100 text-gray-600'}`}>
                        {d.priority}
                      </span>
                      <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_COLOR[d.status] ?? 'bg-gray-100 text-gray-600'}`}>
                        {STATUS_LABEL[d.status] ?? d.status}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap mb-3 text-xs">
                    {vt ? (
                      <span className="text-sm">{vt.icon} {vt.label}</span>
                    ) : (
                      <span className="text-gray-400">Dowolny pojazd</span>
                    )}
                    {d.trailerType && <span className="text-gray-500">{d.trailerType}</span>}
                    {d.maxWeight && <span className="bg-gray-100 px-1.5 py-0.5 rounded">{d.maxWeight} t</span>}
                    {d.minLoadingMeters && <span className="bg-gray-100 px-1.5 py-0.5 rounded">{d.minLoadingMeters} m</span>}
                    {d.temperatureRequired && (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-bold bg-cyan-100 text-cyan-700 border border-cyan-200">
                        {d.temperatureMin != null && d.temperatureMax != null ? `${d.temperatureMin}°/${d.temperatureMax}°` : 'FRIGO'}
                      </span>
                    )}
                    {d.adrRequired && (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-bold bg-orange-100 text-orange-700 border border-orange-200">
                        ADR{d.adrClass ? ` ${d.adrClass}` : ''}
                      </span>
                    )}
                    {d.preferredCountries?.length > 0 && d.preferredCountries.map((c) => (
                      <span key={c} className="inline-flex px-1.5 py-0.5 rounded font-medium bg-gray-100 text-gray-600">{c}</span>
                    ))}
                    {d.matchCount > 0 && (
                      <span className="inline-flex px-2 py-0.5 rounded-full font-bold bg-brand-100 text-brand-700">
                        {d.matchCount} dopasowań
                      </span>
                    )}
                    {d.autoNotify && (
                      <span className="inline-flex px-1.5 py-0.5 rounded font-bold bg-emerald-100 text-emerald-700 border border-emerald-200">Auto</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleSearch(d.id)}
                      disabled={searchingId === d.id}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-brand-50 text-brand-700 hover:bg-brand-100 border border-brand-200 transition disabled:opacity-50"
                    >
                      {searchingId === d.id ? '...' : 'Szukaj'}
                    </button>
                    <button
                      onClick={() => handleToggleNotify(d.id)}
                      disabled={togglingId === d.id}
                      className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition disabled:opacity-50 ${
                        d.autoNotify
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                          : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
                      }`}
                    >
                      {d.autoNotify ? 'Wył. powiadomienia' : 'Wł. powiadomienia'}
                    </button>
                  </div>
                  {results[d.id] && (
                    <div className="mt-3">
                      <DemandResults view={results[d.id]} onClose={() => setResults((p) => { const n = { ...p }; delete n[d.id]; return n; })} />
                    </div>
                  )}
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
    </div>
  );
}

/** The search result under a demand: the first 10, the total, the scan limit. */
function DemandResults({ view, onClose }: { view: DemandSearchView; onClose: () => void }) {
  return (
    <div className="bg-gray-50 border rounded-lg p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium text-gray-800">Znalezione oferty: {view.total}</p>
        <button type="button" onClick={onClose} className="text-xs text-gray-500 hover:text-gray-700">Zamknij</button>
      </div>
      {view.total === 0 && <p className="text-xs text-gray-500 mt-1">Żadna oferta nie spełnia kryteriów.</p>}
      {view.shown.length > 0 && (
        <ul className="mt-2 divide-y">
          {view.shown.map((o) => (
            <li key={o.id} className="py-1.5">
              <Link href={`/offers/${o.id}`} className="text-gray-800 hover:text-brand-600">{o.route}</Link>
              <span className="text-xs text-gray-500 ml-2">
                {[o.pickupDate && `załadunek ${o.pickupDate}`, o.price ?? 'bez ceny'].filter(Boolean).join(' · ')}
              </span>
              {o.unknown && <p className="text-xs text-amber-700">{o.unknown}</p>}
            </li>
          ))}
        </ul>
      )}
      {view.more > 0 && <p className="text-xs text-gray-500 mt-1">i jeszcze {view.more} — pokazujemy {view.shown.length} pierwszych.</p>}
      {view.scanNote && <p className="text-xs text-amber-700 mt-1">{view.scanNote}</p>}
    </div>
  );
}
