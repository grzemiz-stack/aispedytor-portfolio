'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';
import { ratingFromForm, reliabilityError } from '@/lib/contractor-ratings';
import { apiErrorText } from '@/lib/api-error';
import Pagination from '@/components/pagination';

interface Contractor {
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
  isActive: boolean;
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
  paymentRating: '',
  reliabilityScore: '',
  notes: '',
};

export default function ContractorsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [contractors, setContractors] = useState<Contractor[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [page, setPage] = useState(parseInt(searchParams.get('page') ?? '1'));
  const [limit, setLimit] = useState(parseInt(searchParams.get('limit') ?? '20'));
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [sortBy, setSortBy] = useState(searchParams.get('sortBy') ?? 'name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>((searchParams.get('sortOrder') as 'asc' | 'desc') ?? 'asc');

  function updateUrl(p: number, l: number, sb: string, so: string) {
    const params = new URLSearchParams();
    if (p > 1) params.set('page', String(p));
    if (l !== 20) params.set('limit', String(l));
    if (sb !== 'name') params.set('sortBy', sb);
    if (so !== 'asc') params.set('sortOrder', so);
    const qs = params.toString();
    router.replace(qs ? `?${qs}` : '/contractors', { scroll: false });
  }

  const [loadError, setLoadError] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setLoadError('');
    return apiClient
      .get('/contractors', { params: { page, limit, sortBy, sortOrder } })
      .then((r) => {
        setContractors(r.data.data);
        setTotalPages(r.data.meta.totalPages);
        setTotal(r.data.meta.total);
      })
      .catch((err) => setLoadError(apiErrorText(err?.response?.data, 'Nie udało się wczytać kontrahentów.')))
      .finally(() => setLoading(false));
  }, [page, limit, sortBy, sortOrder]);

  useEffect(() => { load(); }, [load]);

  function set(key: string, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const reliability = reliabilityError(form.reliabilityScore);
    if (reliability) { setError(reliability); return; }
    setError('');
    setSaving(true);
    try {
      await apiClient.post('/contractors', {
        name: form.name,
        taxId: form.taxId || undefined,
        country: form.country || undefined,
        city: form.city || undefined,
        address: form.address || undefined,
        contactPerson: form.contactPerson || undefined,
        contactEmail: form.contactEmail || undefined,
        contactPhone: form.contactPhone || undefined,
        rating: form.rating ? parseInt(form.rating) : undefined,
        // Risk ratings (common/counterparty-risk.ts) — as in the edit form; an empty field = no rating.
        paymentRating: ratingFromForm(form.paymentRating) ?? undefined,
        reliabilityScore: ratingFromForm(form.reliabilityScore) ?? undefined,
        notes: form.notes || undefined,
      });
      setForm(emptyForm);
      setShowForm(false);
      setLoading(true);
      load();
    } catch (err: any) {
      setError(apiErrorText(err.response?.data, 'Błąd podczas dodawania kontrahenta'));
    } finally {
      setSaving(false);
    }
  }

  const filtered = contractors.filter(
    (c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.taxId?.includes(search) ||
      c.city?.toLowerCase().includes(search.toLowerCase()),
  );

  const field = (label: string, key: string, type = 'text', placeholder = '') => (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      <input
        type={type}
        value={(form as any)[key]}
        onChange={(e) => set(key, e.target.value)}
        placeholder={placeholder}
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
      />
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Kontrahenci</h1>
          <p className="text-sm text-gray-500 mt-1">Baza kontrahentów i partnerów</p>
        </div>
        <button
          onClick={() => { setShowForm(!showForm); setError(''); }}
          className="bg-brand-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-brand-700 transition w-full sm:w-auto"
        >
          {showForm ? '✕ Anuluj' : '+ Dodaj kontrahenta'}
        </button>
      </div>

      {/* Add contractor form */}
      {showForm && (
        <div className="bg-white rounded-xl border shadow-sm p-6">
          <h2 className="text-sm font-semibold text-gray-800 mb-4">Nowy kontrahent</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {field('Nazwa firmy *', 'name')}
              {field('NIP / Tax ID', 'taxId')}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {field('Kraj', 'country', 'text', 'np. PL')}
              {field('Miasto', 'city')}
              {field('Adres', 'address')}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {field('Osoba kontaktowa', 'contactPerson')}
              {field('Email', 'contactEmail', 'email')}
              {field('Telefon', 'contactPhone', 'tel')}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Ocena (1–5)</label>
                <select
                  value={form.rating}
                  onChange={(e) => set('rating', e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  <option value="">— brak —</option>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>{n} {'⭐'.repeat(n)}</option>
                  ))}
                </select>
              </div>
              {field('Notatki', 'notes')}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Ocena płatności (1–5, 1–2 = ryzyko płatności)</label>
                <select
                  value={form.paymentRating}
                  onChange={(e) => set('paymentRating', e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
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
                  onChange={(e) => set('reliabilityScore', e.target.value)}
                  min={0}
                  max={100}
                  step={1}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>
            </div>
            {error && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
            )}
            <div className="flex gap-3">
              <button
                type="submit"
                disabled={saving || !form.name}
                className="bg-brand-600 text-white px-5 py-2 rounded-xl text-sm font-medium hover:bg-brand-700 transition disabled:opacity-50"
              >
                {saving ? 'Zapisywanie...' : 'Dodaj kontrahenta'}
              </button>
              <button
                type="button"
                onClick={() => { setShowForm(false); setForm(emptyForm); setError(''); }}
                className="px-5 py-2 rounded-xl text-sm font-medium border border-gray-300 hover:bg-gray-50 transition"
              >
                Anuluj
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Search */}
      <div>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Szukaj po nazwie, NIP lub mieście..."
          className="w-full max-w-md border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
        {loading && <p className="text-sm text-gray-400 text-center py-12">Ładowanie...</p>}
        {!loading && loadError && <p className="text-sm text-red-600 text-center py-12">{loadError}</p>}
        {!loading && !loadError && filtered.length === 0 && (
          <p className="text-sm text-gray-400 text-center py-12">Brak kontrahentów</p>
        )}
        {filtered.length > 0 && (<>
          {/* Desktop table — xl+ */}
          <div className="hidden xl:block">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                {[
                  { label: 'Nazwa', sort: 'name' },
                  { label: 'NIP' },
                  { label: 'Lokalizacja' },
                  { label: 'Osoba kontaktowa', cls: 'hidden lg:table-cell' },
                  { label: 'Kontakt', cls: 'hidden lg:table-cell' },
                  { label: 'Ocena', sort: 'rating' },
                  { label: 'Status' },
                ].map((h) => (
                  <th
                    key={h.label}
                    onClick={h.sort ? () => {
                      const newOrder = sortBy === h.sort ? (sortOrder === 'asc' ? 'desc' : 'asc') : 'asc';
                      setSortBy(h.sort!); setSortOrder(newOrder); setPage(1);
                      updateUrl(1, limit, h.sort!, newOrder);
                    } : undefined}
                    className={`px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide ${h.sort ? 'cursor-pointer hover:text-gray-800 select-none' : ''} ${(h as any).cls ?? ''}`}
                  >
                    {h.label}
                    {h.sort && sortBy === h.sort && (
                      <span className="ml-1 text-brand-600">{sortOrder === 'asc' ? '▲' : '▼'}</span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map((c) => (
                <tr key={c.id} className="hover:bg-gray-50 transition">
                  <td className="px-4 py-3 font-medium text-gray-900">
                    <Link href={`/contractors/${c.id}`} className="hover:text-brand-600 transition">
                      {c.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-gray-500">{c.taxId ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-600">
                    {[c.city, c.country].filter(Boolean).join(', ') || '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-500 hidden lg:table-cell">{c.contactPerson ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-500 hidden lg:table-cell">
                    {c.contactEmail
                      ? <a href={`mailto:${c.contactEmail}`} className="hover:text-brand-600">{c.contactEmail}</a>
                      : c.contactPhone ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-900">
                    {c.rating ? '⭐'.repeat(Math.min(c.rating, 5)) : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${c.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {c.isActive ? 'Aktywny' : 'Nieaktywny'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          {/* Cards — mobile/tablet/laptop */}
          <div className="xl:hidden divide-y">
            {filtered.map((c) => (
              <div key={c.id} className="p-4 hover:bg-gray-50 transition">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="min-w-0 flex-1">
                    <Link href={`/contractors/${c.id}`} className="font-semibold text-gray-900 hover:text-brand-600 transition text-sm">
                      {c.name}
                    </Link>
                    <p className="text-xs text-gray-500 mt-0.5">{c.taxId ?? 'Brak NIP'}</p>
                  </div>
                  <span className={`shrink-0 inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${c.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    {c.isActive ? 'Aktywny' : 'Nieaktywny'}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs text-gray-600 mb-2 flex-wrap">
                  <span>{[c.city, c.country].filter(Boolean).join(', ') || '—'}</span>
                  {c.contactPerson && <span>• {c.contactPerson}</span>}
                  {c.contactEmail && (
                    <a href={`mailto:${c.contactEmail}`} className="text-brand-600 hover:underline">{c.contactEmail}</a>
                  )}
                  {!c.contactEmail && c.contactPhone && <span>{c.contactPhone}</span>}
                </div>
                <div className="text-sm">
                  {c.rating ? '⭐'.repeat(Math.min(c.rating, 5)) : <span className="text-gray-400 text-xs">Brak oceny</span>}
                </div>
              </div>
            ))}
          </div>
        </>)}
      </div>

      {!loading && total > 0 && (
        <Pagination
          page={page}
          totalPages={totalPages}
          total={total}
          limit={limit}
          onPageChange={(p) => { setPage(p); updateUrl(p, limit, sortBy, sortOrder); }}
          onLimitChange={(l) => { setLimit(l); setPage(1); updateUrl(1, l, sortBy, sortOrder); }}
        />
      )}
    </div>
  );
}
