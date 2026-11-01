'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';
import { comparablePerKm, perKmLabel, type MoneySummary } from '@/lib/money';
import { apiErrorText } from '@/lib/api-error';
import { OFFER_RULES as RULES, validateOfferField as validate, offerFormErrors, offerPayload, economicsPreviewBody } from '@/lib/offer-form';
import { isUpperBound, marginText, UPPER_BOUND_HINT } from '@/lib/margin';
import { messagesToText, type PlanMessage } from '@/lib/plan-messages';
import { contractorOptionLabel, loadContractorOptions, type ContractorOption } from '@/lib/contractor-options';

interface RouteStats {
  avgPricePerKm: number | null;
  minPricePerKm: number | null;
  maxPricePerKm: number | null;
  avgPrice: number | null;
  totalOffers: number;
  trend: 'up' | 'down' | 'stable';
  /** The company currency in which the API gave the route rates. */
  money?: MoneySummary;
}

const TREND_LABEL = { up: '↑ Rosnący', down: '↓ Spadkowy', stable: '→ Stabilny' };
const TREND_COLOR = { up: 'text-green-600', down: 'text-red-500', stable: 'text-gray-500' };

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onChange}
      className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition ${
        checked ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
      }`}
    >
      <span className={`w-3 h-3 rounded-full border-2 ${checked ? 'bg-white border-white' : 'border-gray-400'}`} />
      {label}
    </button>
  );
}


/** The `POST /offers/economics-preview` answer. */
interface PreviewEconomics {
  totalCostEstimate: number | null;
  profitEstimate: number | null;
  profitMarginPercent: number | null;
  marginWithoutTolls: boolean | null;
  messages?: PlanMessage[];
}

export default function NewOfferPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [routeStats, setRouteStats] = useState<RouteStats | null>(null);
  const [statsError, setStatsError] = useState('');
  const [statsLoading, setStatsLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const [form, setForm] = useState({
    pickupCity: '',
    pickupCountry: 'PL',
    pickupPostal: '',
    pickupDate: '',
    deliveryCity: '',
    deliveryCountry: 'DE',
    deliveryPostal: '',
    deliveryDate: '',
    cargoType: '',
    weightKg: '',
    volumeM3: '',
    price: '',
    currency: 'EUR',
    distanceKm: '',
    tollCostEstimate: '',
    notes: '',
    clientName: '',
    contractorId: '',
    contactEmail: '',
    contactPhone: '',
    penaltyClauses: '',
    loadingTimeWindow: '',
    unloadingTimeWindow: '',
    palletExchangeType: '',
    palletCount: '',
    adrClass: '',
    temperatureMin: '',
    temperatureMax: '',
    requiredInsuranceMin: '',
    paymentTermDays: '',
    specialRequirements: '',
  });

  const [bools, setBools] = useState({
    palletExchange: false,
    isAdr: false,
    isFrigo: false,
  });

  function set(key: string, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
    // Clear error on change
    if (errors[key]) setErrors((prev) => { const n = { ...prev }; delete n[key]; return n; });
  }

  function handleBlur(key: string) {
    setTouched((prev) => ({ ...prev, [key]: true }));
    const err = validate(key, (form as any)[key]);
    if (err) setErrors((prev) => ({ ...prev, [key]: err }));
    else setErrors((prev) => { const n = { ...prev }; delete n[key]; return n; });
  }

  function toggle(key: keyof typeof bools) {
    setBools((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  // Check if form has any validation errors
  const hasErrors = useMemo(() => {
    for (const key of Object.keys(RULES)) {
      const r = RULES[key];
      if (r.required) {
        const err = validate(key, (form as any)[key]);
        if (err) return true;
      }
    }
    return Object.keys(errors).length > 0;
  }, [form, errors]);

  useEffect(() => {
    if (!form.pickupCountry || !form.deliveryCountry) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setStatsLoading(true);
      try {
        const params: Record<string, string> = {
          pickupCountry: form.pickupCountry,
          deliveryCountry: form.deliveryCountry,
        };
        if (form.pickupPostal) params.pickupPostal = form.pickupPostal;
        if (form.deliveryPostal) params.deliveryPostal = form.deliveryPostal;
        const r = await apiClient.get('/analytics/route-stats', { params });
        setRouteStats(r.data.totalOffers > 0 ? r.data : null);
        setStatsError('');
      } catch {
        // No history (the panel disappears) is not the same as an error — an error gets a sentence.
        setRouteStats(null);
        setStatsError('Nie udało się pobrać historii stawek dla tej trasy.');
      } finally {
        setStatsLoading(false);
      }
    }, 600);
  }, [form.pickupCountry, form.deliveryCountry, form.pickupPostal, form.deliveryPostal]);

  const calc = useMemo(() => {
    const price = parseFloat(form.price) || 0;
    const dist = parseFloat(form.distanceKm) || 0;
    const ppkm = price > 0 && dist > 0 ? price / dist : null;
    return { ppkm };
  }, [form.price, form.distanceKm]);

  // Cost, profit and margin from the API — the same rule as saving (company
  // rate × km + toll), not the form's own computation.
  // The company's contractors to choose (decisions §3b): without them the
  // contractor protection (blacklist, risk) did not work for form offers.
  const [contractors, setContractors] = useState<ContractorOption[]>([]);
  const [contractorsError, setContractorsError] = useState('');
  useEffect(() => {
    loadContractorOptions(async (page, limit) =>
      (await apiClient.get('/contractors', { params: { page, limit, sortBy: 'name', sortOrder: 'asc' } })).data,
    )
      .then(setContractors)
      .catch(() => setContractorsError('Nie udało się wczytać kontrahentów — oferta zapisze się bez kontrahenta.'));
  }, []);
  const chosenContractor = contractors.find((c) => c.id === form.contractorId);

  const [preview, setPreview] = useState<PreviewEconomics | null>(null);
  const [previewError, setPreviewError] = useState('');
  const previewRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const body = economicsPreviewBody(form);
    if (previewRef.current) clearTimeout(previewRef.current);
    if (!body) { setPreview(null); setPreviewError(''); return; }
    previewRef.current = setTimeout(async () => {
      try {
        const r = await apiClient.post('/offers/economics-preview', body);
        setPreview(r.data);
        setPreviewError('');
      } catch (err: any) {
        setPreview(null);
        setPreviewError(apiErrorText(err?.response?.data, 'Nie udało się policzyć podglądu marży.'));
      }
    }, 400);
  }, [form.price, form.currency, form.distanceKm, form.tollCostEstimate]); // eslint-disable-line react-hooks/exhaustive-deps
  const margin = preview?.profitMarginPercent != null ? Number(preview.profitMarginPercent) : null;

  function marginColor(m: number | null) {
    if (m === null) return 'text-gray-400';
    if (m >= 15) return 'text-green-600';
    if (m >= 5) return 'text-amber-600';
    return 'text-red-600';
  }

  function marginBg(m: number | null) {
    if (m === null) return 'bg-gray-50 border-gray-200';
    if (m >= 15) return 'bg-green-50 border-green-200';
    if (m >= 5) return 'bg-amber-50 border-amber-200';
    return 'bg-red-50 border-red-200';
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    // Every rule, the pickup date included.
    const newErrors = offerFormErrors(form);
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      setTouched(Object.fromEntries(Object.keys(newErrors).map((k) => [k, true])));
      return;
    }

    setError('');
    setLoading(true);
    try {
      // No computed fields — the API computes the rate per km.
      await apiClient.post('/offers', offerPayload(form, bools));
      router.push('/offers');
    } catch (err: any) {
      setError(apiErrorText(err?.response?.data, 'Błąd podczas tworzenia oferty'));
    } finally {
      setLoading(false);
    }
  }

  const field = (label: string, key: string, type = 'text', placeholder = '') => {
    const rule = RULES[key];
    const err = touched[key] ? errors[key] : undefined;
    return (
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
        <input
          type={type}
          value={(form as any)[key]}
          onChange={(e) => set(key, e.target.value)}
          onBlur={() => handleBlur(key)}
          placeholder={placeholder}
          {...(type === 'number' && rule?.min !== undefined ? { min: rule.min } : {})}
          {...(type === 'number' && rule?.max !== undefined ? { max: rule.max } : {})}
          className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 ${
            err ? 'border-red-400 ring-1 ring-red-200' : 'border-gray-300'
          }`}
        />
        {err && <p className="text-xs text-red-500 mt-1">{err}</p>}
      </div>
    );
  };

  // Compare only in the same currency — the route average is in the company currency.
  const compared = comparablePerKm(calc.ppkm, form.currency, routeStats?.avgPricePerKm ?? null, routeStats?.money?.currency);
  const enteredPpkm = compared?.entered ?? null;
  const avgPpkm = compared?.average ?? null;
  const statsCurrency = routeStats?.money?.currency;
  const priceAlert = (() => {
    if (!enteredPpkm || !avgPpkm) return null;
    const ratio = enteredPpkm / avgPpkm;
    if (ratio < 0.95) return 'below';
    if (ratio > 1.20) return 'above';
    return 'ok';
  })();

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Nowa oferta</h1>
        <p className="text-sm text-gray-500 mt-1">Utwórz nowe zlecenie transportowe</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Pickup */}
        <div className="bg-white rounded-xl border shadow-sm p-6 space-y-4">
          <h2 className="text-sm font-semibold text-gray-800">Załadunek</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {field('Miasto *', 'pickupCity')}
            {field('Kraj *', 'pickupCountry')}
          </div>
          {field('Kod pocztowy', 'pickupPostal')}
          {field('Data załadunku *', 'pickupDate', 'date')}
        </div>

        {/* Delivery */}
        <div className="bg-white rounded-xl border shadow-sm p-6 space-y-4">
          <h2 className="text-sm font-semibold text-gray-800">Rozładunek</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {field('Miasto *', 'deliveryCity')}
            {field('Kraj *', 'deliveryCountry')}
          </div>
          {field('Kod pocztowy', 'deliveryPostal')}
          {field('Data rozładunku', 'deliveryDate', 'date')}
        </div>

        {/* Price suggestion */}
        {statsError && !statsLoading && (
          <p className="text-xs text-red-600">{statsError}</p>
        )}
        {(statsLoading || routeStats) && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-5 space-y-3">
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
              <span className="text-sm font-semibold text-blue-800">
                Sugestia cenowa — {form.pickupCountry} → {form.deliveryCountry}
              </span>
            </div>

            {statsLoading ? (
              <p className="text-sm text-blue-600 animate-pulse">Pobieranie danych historycznych...</p>
            ) : routeStats && (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="bg-white rounded-lg p-3 border border-blue-100">
                    <p className="text-xs text-gray-500 mb-0.5">Średnia stawka/km</p>
                    <p className="text-base font-bold text-gray-900">
                      {perKmLabel(routeStats.avgPricePerKm, statsCurrency)}
                    </p>
                  </div>
                  <div className="bg-white rounded-lg p-3 border border-blue-100">
                    <p className="text-xs text-gray-500 mb-0.5">Zakres</p>
                    <p className="text-sm font-semibold text-gray-700">
                      {routeStats.minPricePerKm && routeStats.maxPricePerKm
                        ? `${routeStats.minPricePerKm.toFixed(2)} – ${perKmLabel(routeStats.maxPricePerKm, statsCurrency)}`
                        : '—'}
                    </p>
                  </div>
                  <div className="bg-white rounded-lg p-3 border border-blue-100">
                    <p className="text-xs text-gray-500 mb-0.5">Trend (30 dni)</p>
                    <p className={`text-sm font-semibold ${TREND_COLOR[routeStats.trend]}`}>
                      {TREND_LABEL[routeStats.trend]}
                    </p>
                  </div>
                </div>
                <p className="text-xs text-blue-600">
                  Na podstawie <span className="font-semibold">{routeStats.totalOffers} ofert</span> w Twojej historii
                </p>

                {priceAlert === 'below' && enteredPpkm && avgPpkm && (
                  <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    <svg className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <p className="text-xs text-amber-700">
                      <span className="font-semibold">Cena poniżej średniej rynkowej.</span>{' '}
                      Wpisano {perKmLabel(enteredPpkm, form.currency)} vs średnia {perKmLabel(avgPpkm, statsCurrency)}
                      ({(((enteredPpkm - avgPpkm) / avgPpkm) * 100).toFixed(0)}%)
                    </p>
                  </div>
                )}
                {priceAlert === 'above' && enteredPpkm && avgPpkm && (
                  <div className="flex items-start gap-2 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                    <svg className="w-4 h-4 text-green-500 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <p className="text-xs text-green-700">
                      <span className="font-semibold">Cena powyżej rynku — dobra marża!</span>{' '}
                      {perKmLabel(enteredPpkm, form.currency)} (+{(((enteredPpkm - avgPpkm) / avgPpkm) * 100).toFixed(0)}% ponad średnią)
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Cargo and freight */}
        <div className="bg-white rounded-xl border shadow-sm p-6 space-y-4">
          <h2 className="text-sm font-semibold text-gray-800">Ładunek i fracht</h2>
          {field('Typ ładunku', 'cargoType', 'text', 'np. Artykuły spożywcze')}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {field('Waga (kg)', 'weightKg', 'number')}
            {field('Objętość (m³)', 'volumeM3', 'number')}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Waluta</label>
              <select
                value={form.currency}
                onChange={(e) => set('currency', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                {['EUR', 'PLN', 'USD', 'GBP'].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {field('Fracht (kwota)', 'price', 'number', '0.00')}
            {field('Dystans (km)', 'distanceKm', 'number', 'np. 850')}
          </div>
        </div>

        {/* Profitability — the preview from the API (= what will be saved) */}
        <div className={`rounded-xl border p-6 space-y-4 ${marginBg(margin)}`}>
          <h2 className="text-sm font-semibold text-gray-800">Kalkulacja opłacalności</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {field('Opłaty drogowe (szacunek)', 'tollCostEstimate', 'number', '0.00')}
          </div>
          <p className="text-xs text-gray-500">Koszt = koszt kilometra firmy × km + opłaty drogowe — tak samo jak po zapisie oferty.</p>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
            <div className="bg-white rounded-lg border p-3">
              <p className="text-xs text-gray-500 mb-1">Koszt</p>
              <p className="text-base font-semibold text-gray-900">
                {preview?.totalCostEstimate != null ? `${Number(preview.totalCostEstimate).toLocaleString('pl-PL', { maximumFractionDigits: 2 })} ${form.currency}` : '—'}
              </p>
            </div>
            <div className="bg-white rounded-lg border p-3">
              <p className="text-xs text-gray-500 mb-1">Zysk</p>
              <p className={`text-base font-semibold ${preview?.profitEstimate != null ? (Number(preview.profitEstimate) >= 0 ? 'text-green-600' : 'text-red-600') : 'text-gray-400'}`}>
                {preview?.profitEstimate != null ? `${Number(preview.profitEstimate).toLocaleString('pl-PL', { maximumFractionDigits: 2 })} ${form.currency}` : '—'}
              </p>
            </div>
            <div className="bg-white rounded-lg border p-3">
              <p className="text-xs text-gray-500 mb-1">Marża</p>
              <p className={`text-base font-bold ${marginColor(margin)}`} title={preview && isUpperBound(preview) ? UPPER_BOUND_HINT : undefined}>
                {preview ? marginText(preview) : '—'}
              </p>
            </div>
            <div className="bg-white rounded-lg border p-3">
              <p className="text-xs text-gray-500 mb-1">Stawka/km</p>
              <p className="text-base font-semibold text-gray-900">
                {calc.ppkm !== null ? `${calc.ppkm.toFixed(2)} ${form.currency}/km` : '—'}
              </p>
            </div>
          </div>

          {preview && messagesToText(preview.messages ?? []).map((note) => (
            <p key={note} className="text-xs text-amber-700">{note}</p>
          ))}
          {previewError && <p className="text-xs text-red-600">{previewError}</p>}
        </div>

        {/* Warunki i ryzyka */}
        <div className="bg-white rounded-xl border shadow-sm p-6 space-y-5">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-gray-800">Warunki i ryzyka</h2>
            <span className="text-xs text-gray-400 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">Analiza ryzyka</span>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Kary umowne</label>
            <textarea
              value={form.penaltyClauses}
              onChange={(e) => set('penaltyClauses', e.target.value)}
              rows={2}
              placeholder="Wklej lub opisz kary umowne wynikające z warunków zlecenia..."
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
            />
            {form.penaltyClauses && (
              <p className="text-xs text-amber-600 mt-1">⚠ Oferta zawiera kary umowne — zostanie oznaczona jako ryzykowna.</p>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {field('Okienko załadunku (min)', 'loadingTimeWindow', 'number', 'np. 60')}
            {field('Okienko rozładunku (min)', 'unloadingTimeWindow', 'number', 'np. 60')}
          </div>

          <div className="space-y-3">
            <Toggle checked={bools.palletExchange} onChange={() => toggle('palletExchange')} label="Wymiana palet" />
            {bools.palletExchange && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pl-1">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Typ palet</label>
                  <select
                    value={form.palletExchangeType}
                    onChange={(e) => set('palletExchangeType', e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  >
                    <option value="">Wybierz typ</option>
                    {['EPAL', 'Jednorazowe', 'CP1', 'CP3', 'Inne'].map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </div>
                {field('Liczba palet', 'palletCount', 'number', 'np. 33')}
              </div>
            )}
          </div>

          <div className="space-y-3">
            <Toggle checked={bools.isAdr} onChange={() => toggle('isAdr')} label="Materiały niebezpieczne (ADR)" />
            {bools.isAdr && (
              <div className="pl-1 max-w-xs">
                <label className="block text-sm font-medium text-gray-700 mb-1">Klasa ADR</label>
                <select
                  value={form.adrClass}
                  onChange={(e) => set('adrClass', e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  <option value="">Wybierz klasę</option>
                  {['1','2','3','4.1','4.2','4.3','5.1','5.2','6.1','6.2','7','8','9'].map((c) => (
                    <option key={c} value={c}>Klasa {c}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="space-y-3">
            <Toggle checked={bools.isFrigo} onChange={() => toggle('isFrigo')} label="Ładunek chłodniczy (Frigo)" />
            {bools.isFrigo && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pl-1 sm:max-w-xs">
                {field('Temperatura min (°C)', 'temperatureMin', 'number', 'np. -18')}
                {field('Temperatura max (°C)', 'temperatureMax', 'number', 'np. 4')}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {field('Minimalne OCP (EUR)', 'requiredInsuranceMin', 'number', 'np. 100000')}
            {field('Termin płatności (dni)', 'paymentTermDays', 'number', 'np. 30')}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Wymagania specjalne</label>
            <textarea
              value={form.specialRequirements}
              onChange={(e) => set('specialRequirements', e.target.value)}
              rows={2}
              placeholder="Inne wymagania, certyfikaty, sprzęt specjalny..."
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
            />
          </div>
        </div>

        {/* Kontakt */}
        <div className="bg-white rounded-xl border shadow-sm p-6 space-y-4">
          <h2 className="text-sm font-semibold text-gray-800">Kontakt / klient</h2>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Kontrahent</label>
            <select
              value={form.contractorId}
              onChange={(e) => set('contractorId', e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option value="">— bez kontrahenta —</option>
              {contractors.map((c) => (
                <option key={c.id} value={c.id}>{contractorOptionLabel(c)}</option>
              ))}
            </select>
            {contractorsError && <p className="text-xs text-red-600 mt-1">{contractorsError}</p>}
            {chosenContractor?.isBlacklisted && (
              <p className="text-xs text-red-600 mt-1">Kontrahent na czarnej liście firmy — przyjąć ofertę może tylko administrator.</p>
            )}
          </div>
          {field('Nazwa klienta', 'clientName')}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {field('Email', 'contactEmail', 'email')}
            {field('Telefon', 'contactPhone', 'tel')}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notatki spedytora</label>
            <textarea
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
              rows={3}
              placeholder="Uwagi, warunki, wymagania..."
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
            />
          </div>
        </div>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
            {error}
          </p>
        )}

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={loading || hasErrors}
            className="bg-brand-600 text-white px-6 py-2.5 rounded-xl text-sm font-medium hover:bg-brand-700 transition disabled:opacity-50"
          >
            {loading ? 'Tworzenie...' : 'Utwórz ofertę'}
          </button>
          <button
            type="button"
            onClick={() => router.back()}
            className="px-6 py-2.5 rounded-xl text-sm font-medium border border-gray-300 hover:bg-gray-50 transition"
          >
            Anuluj
          </button>
        </div>
      </form>
    </div>
  );
}
