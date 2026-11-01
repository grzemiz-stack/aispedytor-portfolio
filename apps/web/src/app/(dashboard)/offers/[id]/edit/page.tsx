'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';
import { apiErrorText } from '@/lib/api-error';
import { useAuthStore } from '@/store/auth.store';
import { isUpperBound, marginText, UPPER_BOUND_HINT } from '@/lib/margin';
import { messagesToText, type PlanMessage } from '@/lib/plan-messages';
import { contractorOptionLabel, loadContractorOptions, type ContractorOption } from '@/lib/contractor-options';
import {
  editFormFrom, moneyAndDatesLocked, offerEditErrors, offerEditPayload, offerEditPreviewBody,
  type EditableOffer, type OfferEditForm,
} from '@/lib/offer-edit';

const OFFER_CURRENCIES = ['EUR', 'PLN', 'USD', 'GBP'];

interface PreviewEconomics {
  totalCostEstimate: number | null;
  profitEstimate: number | null;
  profitMarginPercent: number | null;
  marginWithoutTolls: boolean | null;
  messages?: PlanMessage[];
}

/** Editing an offer (decisions §3a): the rules from the API, the margin preview = the save. */
export default function EditOfferPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const role = useAuthStore((s) => s.user?.role);
  const [offer, setOffer] = useState<(EditableOffer & { id: string; pickupCity: string; deliveryCity: string }) | null>(null);
  const [initial, setInitial] = useState<OfferEditForm | null>(null);
  const [form, setForm] = useState<OfferEditForm | null>(null);
  const [contractors, setContractors] = useState<ContractorOption[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<PreviewEconomics | null>(null);
  const [previewError, setPreviewError] = useState('');
  const previewRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    apiClient.get(`/offers/${id}`)
      .then((r) => {
        setOffer(r.data);
        const f = editFormFrom(r.data);
        setInitial(f);
        setForm(f);
      })
      .catch(() => router.push('/offers'));
    loadContractorOptions(async (page, limit) =>
      (await apiClient.get('/contractors', { params: { page, limit, sortBy: 'name', sortOrder: 'asc' } })).data,
    ).then(setContractors).catch(() => setContractors([]));
  }, [id, router]);

  useEffect(() => {
    if (!form) return;
    if (previewRef.current) clearTimeout(previewRef.current);
    previewRef.current = setTimeout(async () => {
      try {
        const r = await apiClient.post('/offers/economics-preview', offerEditPreviewBody(id, form));
        setPreview(r.data);
        setPreviewError('');
      } catch (err: any) {
        setPreview(null);
        setPreviewError(apiErrorText(err?.response?.data, 'Nie udało się policzyć podglądu marży.'));
      }
    }, 400);
  }, [form?.price, form?.currency, form?.distanceKm, form?.tollCostEstimate]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!offer || !form || !initial) return <p className="text-sm text-gray-400 py-12 text-center">Ładowanie...</p>;
  const locked = moneyAndDatesLocked(offer.status, role);
  // A contractor outside the active list (e.g. deactivated) stays selectable — otherwise it would vanish from the field.
  const options = form.contractorId && !contractors.some((c) => c.id === form.contractorId)
    ? [...contractors, { id: form.contractorId, name: 'obecny kontrahent', isBlacklisted: false }]
    : contractors;

  function set(key: keyof OfferEditForm, v: string) {
    setForm((prev) => (prev ? { ...prev, [key]: v } : prev));
    setErrors((prev) => { const n = { ...prev }; delete n[key]; return n; });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form || !initial) return;
    const errs = offerEditErrors(form);
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    const body = offerEditPayload(form, initial, locked);
    if (Object.keys(body).length === 0) { router.push(`/offers/${id}`); return; }
    setSaving(true);
    setError('');
    try {
      await apiClient.patch(`/offers/${id}`, body);
      router.push(`/offers/${id}`);
    } catch (err: any) {
      setError(apiErrorText(err?.response?.data, 'Nie udało się zapisać zmian.'));
    } finally {
      setSaving(false);
    }
  }

  const input = (key: keyof OfferEditForm, type = 'text', disabled = false) => (
    <div>
      <input
        type={type}
        value={form[key]}
        disabled={disabled}
        onChange={(e) => set(key, e.target.value)}
        className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:bg-gray-100 disabled:text-gray-500 ${errors[key] ? 'border-red-400' : 'border-gray-300'}`}
      />
      {errors[key] && <p className="text-xs text-red-500 mt-1">{errors[key]}</p>}
    </div>
  );
  const label = (text: string) => <label className="block text-sm font-medium text-gray-700 mb-1">{text}</label>;
  const money = (v: number | null) => (v != null ? `${Number(v).toLocaleString('pl-PL', { maximumFractionDigits: 2 })} ${form.currency}` : '—');

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-3xl mx-auto">
      <div>
        <Link href={`/offers/${id}`} className="text-xs text-gray-400 hover:text-gray-700">← Wróć do oferty</Link>
        <h1 className="text-2xl font-bold text-gray-900">Edycja oferty: {offer.pickupCity} → {offer.deliveryCity}</h1>
      </div>

      {locked && (
        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">
          Oferta jest przyjęta, w drodze albo zakończona — cenę, walutę, dystans, opłaty drogowe i daty zmienia tylko administrator.
        </p>
      )}

      <div className="bg-white rounded-xl border shadow-sm p-6 space-y-4">
        <h2 className="text-sm font-semibold text-gray-800">Daty</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>{label('Data załadunku *')}{input('pickupDate', 'date', locked)}</div>
          <div>{label('Ważna do (puste = bez terminu)')}{input('expiresAt', 'datetime-local', locked)}</div>
        </div>
      </div>

      <div className="bg-white rounded-xl border shadow-sm p-6 space-y-4">
        <h2 className="text-sm font-semibold text-gray-800">Fracht i koszt</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>{label('Cena')}{input('price', 'number', locked)}</div>
          <div>
            {label('Waluta')}
            <select
              value={form.currency}
              disabled={locked}
              onChange={(e) => set('currency', e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm disabled:bg-gray-100 disabled:text-gray-500"
            >
              {/* The same list as the new-offer form; the current currency from outside the list stays selectable. */}
              {(OFFER_CURRENCIES.includes(form.currency) ? OFFER_CURRENCIES : [form.currency, ...OFFER_CURRENCIES]).map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div>{label('Dystans (km)')}{input('distanceKm', 'number', locked)}</div>
          <div>{label('Opłaty drogowe (ręcznie)')}{input('tollCostEstimate', 'number', locked)}</div>
        </div>
        <p className="text-xs text-gray-500">Koszt = koszt kilometra firmy × km + opłaty drogowe; z trasą z planera, jeśli jest — tak samo jak po zapisie.</p>
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-gray-50 rounded-lg border p-3"><p className="text-xs text-gray-500 mb-1">Koszt</p><p className="font-semibold">{money(preview?.totalCostEstimate ?? null)}</p></div>
          <div className="bg-gray-50 rounded-lg border p-3"><p className="text-xs text-gray-500 mb-1">Zysk</p><p className="font-semibold">{money(preview?.profitEstimate ?? null)}</p></div>
          <div className="bg-gray-50 rounded-lg border p-3">
            <p className="text-xs text-gray-500 mb-1">Marża</p>
            <p className="font-bold" title={preview && isUpperBound(preview) ? UPPER_BOUND_HINT : undefined}>{preview ? marginText(preview) : '—'}</p>
          </div>
        </div>
        {preview && messagesToText(preview.messages ?? []).map((note) => <p key={note} className="text-xs text-amber-700">{note}</p>)}
        {previewError && <p className="text-xs text-red-600">{previewError}</p>}
      </div>

      <div className="bg-white rounded-xl border shadow-sm p-6 space-y-4">
        <h2 className="text-sm font-semibold text-gray-800">Kontrahent i notatki</h2>
        <div>
          {label('Kontrahent')}
          <select
            value={form.contractorId}
            onChange={(e) => set('contractorId', e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
          >
            <option value="">— bez kontrahenta —</option>
            {options.map((c) => <option key={c.id} value={c.id}>{contractorOptionLabel(c)}</option>)}
          </select>
        </div>
        <div>
          {label('Notatki spedytora')}
          <textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={3}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-3">
        <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg text-sm font-medium bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50">
          {saving ? 'Zapisywanie...' : 'Zapisz zmiany'}
        </button>
        <Link href={`/offers/${id}`} className="px-4 py-2 rounded-lg text-sm font-medium border border-gray-300 text-gray-700">Anuluj</Link>
      </div>
    </form>
  );
}
