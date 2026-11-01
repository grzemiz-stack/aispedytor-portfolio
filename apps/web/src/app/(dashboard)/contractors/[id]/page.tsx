'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';
import { apiErrorText } from '@/lib/api-error';
import { ratingFromForm, ratingToForm } from '@/lib/contractor-ratings';
import { blacklistToggle } from '@/lib/blacklist-toggle';
import { useAuthStore } from '@/store/auth.store';

interface ContractorDetail {
  id: string;
  name: string;
  taxId: string | null;
  country: string | null;
  city: string | null;
  address: string | null;
  contactPerson: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  rating: number | null;
  avgPaymentDays: number | null;
  /** 1–5; ≤ 2 = payment risk (api/src/common/counterparty-risk.ts). */
  paymentRating: number | null;
  /** 0–100; < 40 = reliability risk. */
  reliabilityScore: number | null;
  notes: string | null;
  isActive: boolean;
  /** The company blacklist — only an ADMIN changes it (decisions §3b). */
  isBlacklisted: boolean;
  createdAt: string;
}

function Stars({ rating }: { rating: number | null }) {
  if (!rating) return <span className="text-gray-400">—</span>;
  return (
    <span className="text-amber-500">
      {'★'.repeat(Math.min(rating, 5))}
      <span className="text-gray-300">{'★'.repeat(Math.max(0, 5 - rating))}</span>
    </span>
  );
}

const emptyForm = {
  name: '',
  taxId: '',
  country: '',
  city: '',
  address: '',
  contactPerson: '',
  contactEmail: '',
  contactPhone: '',
  rating: '',
  avgPaymentDays: '',
  paymentRating: '',
  reliabilityScore: '',
  notes: '',
};

type Rules = Record<string, { required?: boolean; minLen?: number; maxLen?: number; min?: number; max?: number }>;

const RULES: Rules = {
  name: { required: true, minLen: 2, maxLen: 200 },
  taxId: { minLen: 5, maxLen: 20 },
  country: { minLen: 2, maxLen: 3 },
  city: { maxLen: 100 },
  address: { maxLen: 200 },
  contactPerson: { maxLen: 100 },
  contactEmail: { maxLen: 100 },
  contactPhone: { maxLen: 30 },
  avgPaymentDays: { min: 0, max: 365 },
  reliabilityScore: { min: 0, max: 100 },
};

function validateField(key: string, value: string): string | null {
  const r = RULES[key];
  if (!r) return null;
  if (r.required && !value.trim()) return 'Pole wymagane';
  if (value && r.minLen && value.length < r.minLen) return `Min. ${r.minLen} znaków`;
  if (value && r.maxLen && value.length > r.maxLen) return `Max. ${r.maxLen} znaków`;
  if (value && r.min !== undefined) {
    const n = parseFloat(value);
    if (!isNaN(n) && n < r.min) return `Min. wartość: ${r.min}`;
  }
  if (value && r.max !== undefined) {
    const n = parseFloat(value);
    if (!isNaN(n) && n > r.max) return `Max. wartość: ${r.max}`;
  }
  return null;
}

export default function ContractorDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [contractor, setContractor] = useState<ContractorDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [toggleError, setToggleError] = useState('');
  const role = useAuthStore((s) => s.user?.role);
  const [error, setError] = useState('');
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const load = useCallback(() => {
    return apiClient
      .get(`/contractors/${id}`)
      .then((r) => {
        const c: ContractorDetail = r.data;
        setContractor(c);
        setForm({
          name: c.name,
          taxId: c.taxId ?? '',
          country: c.country ?? '',
          city: c.city ?? '',
          address: c.address ?? '',
          contactPerson: c.contactPerson ?? '',
          contactEmail: c.contactEmail ?? '',
          contactPhone: c.contactPhone ?? '',
          rating: c.rating ? String(c.rating) : '',
          avgPaymentDays: c.avgPaymentDays ? String(c.avgPaymentDays) : '',
          paymentRating: ratingToForm(c.paymentRating),
          reliabilityScore: ratingToForm(c.reliabilityScore),
          notes: c.notes ?? '',
        });
      })
      .catch(() => router.push('/contractors'))
      .finally(() => setLoading(false));
  }, [id, router]);

  useEffect(() => { load(); }, [load]);

  function setF(key: string, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (touched[key]) {
      setErrors((prev) => ({ ...prev, [key]: validateField(key, value) }));
    }
  }

  function handleBlur(key: string) {
    setTouched((prev) => ({ ...prev, [key]: true }));
    setErrors((prev) => ({ ...prev, [key]: validateField(key, (form as any)[key]) }));
  }

  const hasErrors = Object.values(errors).some((e) => e !== null && e !== undefined) || !form.name;

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!contractor) return;
    // Validate all fields
    const allErrors: Record<string, string | null> = {};
    for (const key of Object.keys(RULES)) {
      allErrors[key] = validateField(key, (form as any)[key]);
    }
    setErrors(allErrors);
    setTouched(Object.keys(RULES).reduce((a, k) => ({ ...a, [k]: true }), {}));
    if (Object.values(allErrors).some((e) => e !== null)) return;
    setError('');
    setSaving(true);
    try {
      await apiClient.patch(`/contractors/${contractor.id}`, {
        name: form.name,
        taxId: form.taxId || null,
        country: form.country || null,
        city: form.city || null,
        address: form.address || null,
        contactPerson: form.contactPerson || null,
        contactEmail: form.contactEmail || null,
        contactPhone: form.contactPhone || null,
        rating: form.rating ? parseInt(form.rating) : null,
        avgPaymentDays: form.avgPaymentDays ? parseInt(form.avgPaymentDays) : null,
        paymentRating: ratingFromForm(form.paymentRating),
        reliabilityScore: ratingFromForm(form.reliabilityScore),
        notes: form.notes || null,
      });
      setEditing(false);
      await load();
    } catch (err: any) {
      setError(apiErrorText(err.response?.data, 'Błąd podczas zapisywania'));
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive() {
    if (!contractor) return;
    setToggling(true);
    setToggleError('');
    try {
      await apiClient.patch(`/contractors/${contractor.id}`, { isActive: !contractor.isActive });
      await load();
    } catch (err: any) {
      setToggleError(apiErrorText(err?.response?.data, 'Nie udało się zmienić statusu kontrahenta.'));
    } finally {
      setToggling(false);
    }
  }

  async function toggleBlacklist() {
    if (!contractor) return;
    const t = blacklistToggle(contractor.isBlacklisted, role);
    if (!window.confirm(t.confirm)) return;
    setToggling(true);
    setToggleError('');
    try {
      await apiClient.patch(`/contractors/${contractor.id}`, { isBlacklisted: t.next });
      await load();
    } catch (err: any) {
      setToggleError(apiErrorText(err?.response?.data, 'Nie udało się zmienić czarnej listy.'));
    } finally {
      setToggling(false);
    }
  }

  if (loading) return <p className="text-sm text-gray-400 py-12 text-center">Ładowanie...</p>;
  if (!contractor) return null;
  const blacklist = blacklistToggle(contractor.isBlacklisted, role);

  const row = (label: string, value: React.ReactNode) => (
    <div className="flex flex-col sm:flex-row sm:gap-2">
      <span className="text-sm text-gray-500 sm:w-44 sm:shrink-0">{label}</span>
      <span className="text-sm text-gray-900 font-medium">{value ?? '—'}</span>
    </div>
  );

  const inputCls = (key: string) =>
    `w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 ${
      errors[key] && touched[key] ? 'border-red-400 ring-1 ring-red-200' : 'border-gray-300'
    }`;

  const field = (label: string, key: string, type = 'text', placeholder = '') => (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      <input
        type={type}
        value={(form as any)[key]}
        onChange={(e) => setF(key, e.target.value)}
        onBlur={() => handleBlur(key)}
        placeholder={placeholder}
        className={inputCls(key)}
        {...(RULES[key]?.min !== undefined && type === 'number' ? { min: RULES[key].min } : {})}
        {...(RULES[key]?.max !== undefined && type === 'number' ? { max: RULES[key].max } : {})}
      />
      {errors[key] && touched[key] && (
        <p className="text-xs text-red-500 mt-1">{errors[key]}</p>
      )}
    </div>
  );

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <button onClick={() => router.back()} className="text-xs text-gray-400 hover:text-gray-700 mb-1">
            ← Wróć
          </button>
          <h1 className="text-2xl font-bold text-gray-900">{contractor.name}</h1>
          {contractor.taxId && <p className="text-xs text-gray-400 mt-0.5">NIP: {contractor.taxId}</p>}
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <span className={`px-3 py-1 rounded-full text-sm font-medium ${contractor.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
            {contractor.isActive ? 'Aktywny' : 'Nieaktywny'}
          </span>
          <button
            onClick={toggleActive}
            disabled={toggling}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition disabled:opacity-50 ${contractor.isActive ? 'border-red-300 text-red-600 hover:bg-red-50' : 'border-green-300 text-green-700 hover:bg-green-50'}`}
          >
            {toggling ? '...' : contractor.isActive ? 'Dezaktywuj' : 'Aktywuj'}
          </button>
          {contractor.isBlacklisted && (
            <span className="px-3 py-1 rounded-full text-sm font-medium bg-red-100 text-red-700">Czarna lista</span>
          )}
          {blacklist.canChange && (
            <button
              onClick={toggleBlacklist}
              disabled={toggling}
              className="px-3 py-1.5 rounded-lg text-sm font-medium border border-red-300 text-red-700 hover:bg-red-50 transition disabled:opacity-50"
            >
              {blacklist.label}
            </button>
          )}
          {toggleError && <span className="text-sm text-red-600">{toggleError}</span>}
          <button
            onClick={() => { setEditing((v) => !v); setError(''); }}
            className="px-3 py-1.5 rounded-lg text-sm font-medium border border-gray-300 text-gray-700 hover:bg-gray-50 transition"
          >
            {editing ? '✕ Anuluj' : 'Edytuj'}
          </button>
        </div>
      </div>

      {/* View mode */}
      {!editing && (
        <>
          <div className="bg-white rounded-xl border shadow-sm p-6 space-y-3">
            <h2 className="text-sm font-semibold text-gray-800 mb-4">Dane firmy</h2>
            {row('Nazwa', contractor.name)}
            {row('NIP / Tax ID', contractor.taxId)}
            {row('Kraj', contractor.country)}
            {row('Miasto', contractor.city)}
            {row('Adres', contractor.address)}
          </div>

          <div className="bg-white rounded-xl border shadow-sm p-6 space-y-3">
            <h2 className="text-sm font-semibold text-gray-800 mb-4">Kontakt</h2>
            {row('Osoba kontaktowa', contractor.contactPerson)}
            {row('Email', contractor.contactEmail
              ? <a href={`mailto:${contractor.contactEmail}`} className="text-brand-600 hover:underline">{contractor.contactEmail}</a>
              : null)}
            {row('Telefon', contractor.contactPhone
              ? <a href={`tel:${contractor.contactPhone}`} className="text-brand-600 hover:underline">{contractor.contactPhone}</a>
              : null)}
          </div>

          <div className="bg-white rounded-xl border shadow-sm p-6 space-y-3">
            <h2 className="text-sm font-semibold text-gray-800 mb-4">Ocena i warunki</h2>
            {row('Ocena', <Stars rating={contractor.rating} />)}
            {row('Średni czas płatności', contractor.avgPaymentDays ? `${contractor.avgPaymentDays} dni` : null)}
            {row('Ocena płatności', contractor.paymentRating != null ? `${contractor.paymentRating}/5` : null)}
            {row('Rzetelność', contractor.reliabilityScore != null ? `${contractor.reliabilityScore}/100` : null)}
          </div>

          {contractor.notes && (
            <div className="bg-white rounded-xl border shadow-sm p-6">
              <h2 className="text-sm font-semibold text-gray-800 mb-2">Notatki</h2>
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{contractor.notes}</p>
            </div>
          )}
        </>
      )}

      {/* Edit mode */}
      {editing && (
        <form onSubmit={handleSave} className="space-y-6">
          <div className="bg-white rounded-xl border shadow-sm p-6 space-y-4">
            <h2 className="text-sm font-semibold text-gray-800">Dane firmy</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {field('Nazwa firmy *', 'name')}
              {field('NIP / Tax ID', 'taxId')}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {field('Kraj', 'country', 'text', 'np. PL')}
              {field('Miasto', 'city')}
              {field('Adres', 'address')}
            </div>
          </div>

          <div className="bg-white rounded-xl border shadow-sm p-6 space-y-4">
            <h2 className="text-sm font-semibold text-gray-800">Kontakt</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {field('Osoba kontaktowa', 'contactPerson')}
              {field('Email', 'contactEmail', 'email')}
              {field('Telefon', 'contactPhone', 'tel')}
            </div>
          </div>

          <div className="bg-white rounded-xl border shadow-sm p-6 space-y-4">
            <h2 className="text-sm font-semibold text-gray-800">Ocena i warunki</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Ocena (1–5)</label>
                <select
                  value={form.rating}
                  onChange={(e) => setF('rating', e.target.value)}
                  className={inputCls('rating')}
                >
                  <option value="">— brak —</option>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>{n} {'★'.repeat(n)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Średni czas płatności (dni)</label>
                <input
                  type="number"
                  value={form.avgPaymentDays}
                  onChange={(e) => setF('avgPaymentDays', e.target.value)}
                  onBlur={() => handleBlur('avgPaymentDays')}
                  min={0}
                  max={365}
                  className={inputCls('avgPaymentDays')}
                />
                {errors.avgPaymentDays && touched.avgPaymentDays && (
                  <p className="text-xs text-red-500 mt-1">{errors.avgPaymentDays}</p>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Ocena płatności (1–5, 1–2 = ryzyko płatności)</label>
                <select
                  value={form.paymentRating}
                  onChange={(e) => setF('paymentRating', e.target.value)}
                  className={inputCls('paymentRating')}
                >
                  <option value="">— brak —</option>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Rzetelność (0–100, poniżej 40 = ryzyko)</label>
                <input
                  type="number"
                  value={form.reliabilityScore}
                  onChange={(e) => setF('reliabilityScore', e.target.value)}
                  onBlur={() => handleBlur('reliabilityScore')}
                  min={0}
                  max={100}
                  step={1}
                  className={inputCls('reliabilityScore')}
                />
                {errors.reliabilityScore && touched.reliabilityScore && (
                  <p className="text-xs text-red-500 mt-1">{errors.reliabilityScore}</p>
                )}
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Notatki</label>
              <textarea
                value={form.notes}
                onChange={(e) => setF('notes', e.target.value)}
                rows={3}
                className={inputCls('notes')}
              />
            </div>
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">{error}</p>
          )}

          <div className="flex gap-3">
            <button
              type="submit"
              disabled={saving || hasErrors}
              className="bg-brand-600 text-white px-6 py-2.5 rounded-xl text-sm font-medium hover:bg-brand-700 transition disabled:opacity-50"
            >
              {saving ? 'Zapisywanie...' : 'Zapisz zmiany'}
            </button>
            <button
              type="button"
              onClick={() => { setEditing(false); setError(''); }}
              className="px-6 py-2.5 rounded-xl text-sm font-medium border border-gray-300 hover:bg-gray-50 transition"
            >
              Anuluj
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
