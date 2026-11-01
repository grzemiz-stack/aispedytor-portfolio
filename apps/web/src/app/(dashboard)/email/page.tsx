'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';
import { apiErrorText } from '@/lib/api-error';
import { pageItems } from '@/lib/paginated';
import { existingOfferFromError, emailPriceLabel } from '@/lib/email-offer';
import Pagination from '@/components/pagination';

// ── Types ────────────────────────────────────────────────────────────────────

interface EmailItem {
  id: string;
  subject: string;
  fromName: string | null;
  fromEmail: string;
  receivedAt: string;
  category: string;
  priority: string;
  isRead: boolean;
  isStarred: boolean;
  tags: string[];
  extractedPickupCity: string | null;
  extractedDeliveryCity: string | null;
  extractedPrice: number | null;
  /** The price currency from the API (null = cannot be told). */
  extractedCurrency: string | null;
  createdOfferId: string | null;
}

interface EmailDetail {
  id: string;
  subject: string;
  fromName: string | null;
  fromEmail: string;
  toEmail: string;
  body: string;
  receivedAt: string;
  category: string;
  priority: string;
  isRead: boolean;
  isStarred: boolean;
  tags: string[];
  extractedPickupCity: string | null;
  extractedPickupCountry: string | null;
  extractedDeliveryCity: string | null;
  extractedDeliveryCountry: string | null;
  extractedWeight: number | null;
  extractedPrice: number | null;
  extractedCurrency: string | null;
  extractedDate: string | null;
  createdOfferId: string | null;
  llmSummary: string | null;
  llmCategory: string | null;
  notes: string | null;
}

interface ExtractedData {
  pickupCity?: string | null;
  pickupCountry?: string | null;
  pickupPostal?: string | null;
  deliveryCity?: string | null;
  deliveryCountry?: string | null;
  deliveryPostal?: string | null;
  pickupDate?: string | null;
  deliveryDate?: string | null;
  weight?: number | null;
  price?: number | null;
  currency?: string | null;
  vehicleType?: string | null;
  palletCount?: number | null;
  palletExchange?: boolean;
  isAdr?: boolean;
  adrClass?: string | null;
  temperatureMin?: number | null;
  temperatureMax?: number | null;
  paymentTermDays?: number | null;
  contactName?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  companyName?: string | null;
  nip?: string | null;
}

interface Classification {
  method: 'llm' | 'regex';
  category: string;
  priority: string;
  tags: string[];
  extractedPickupCity?: string;
  extractedPickupCountry?: string;
  extractedDeliveryCity?: string;
  extractedDeliveryCountry?: string;
  extractedWeight?: number;
  extractedPrice?: number;
  /** The currency next to the price the regex found. */
  extractedCurrency?: string;
  extractedDate?: string;
  confidence: number;
  reasoning?: string;
  summary?: string;
  llmCategory?: string;
  inputTokens?: number;
  outputTokens?: number;
  extractedData?: ExtractedData;
}

interface Stats {
  total: number;
  unread: number;
  offersToReview: number;
  byCategory: Record<string, number>;
  byPriority: Record<string, number>;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const CATEGORIES = [
  { key: 'ALL', label: 'Wszystkie' },
  { key: 'OFFER', label: 'Oferty' },
  { key: 'INQUIRY', label: 'Zapytania' },
  { key: 'COMPLAINT', label: 'Reklamacje' },
  { key: 'INVOICE', label: 'Faktury' },
  { key: 'OTHER', label: 'Inne' },
];

const CAT_COLOR: Record<string, string> = {
  OFFER: 'bg-blue-100 text-blue-700',
  INQUIRY: 'bg-purple-100 text-purple-700',
  COMPLAINT: 'bg-red-100 text-red-700',
  INVOICE: 'bg-amber-100 text-amber-700',
  OTHER: 'bg-gray-100 text-gray-600',
};

const PRIO_COLOR: Record<string, string> = {
  HIGH: 'text-red-600',
  MEDIUM: 'text-amber-500',
  LOW: 'text-gray-400',
};

const PRIO_LABEL: Record<string, string> = {
  HIGH: 'Pilny',
  MEDIUM: 'Normalny',
  LOW: 'Niski',
};

const CAT_LABEL: Record<string, string> = {
  OFFER: 'Oferta',
  INQUIRY: 'Zapytanie',
  COMPLAINT: 'Reklamacja',
  INVOICE: 'Faktura',
  OTHER: 'Inne',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(dt: string) {
  const d = new Date(dt);
  return d.toLocaleDateString('pl-PL') + ' ' + d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
}

function ConfidenceBadge({ v }: { v: number }) {
  const color = v >= 70 ? 'bg-green-100 text-green-700' : v >= 40 ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600';
  return <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${color}`}>{v}% pewność</span>;
}

function MethodBadge({ method }: { method?: string }) {
  if (method === 'llm') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
        </svg>
        Analizowano: LLM
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">
      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
      </svg>
      Analizowano: Regex
    </span>
  );
}

// ── Test Panel ────────────────────────────────────────────────────────────────

function TestPanel({ onProcessed }: { onProcessed: () => void }) {
  const [subject, setSubject] = useState('');
  const [fromEmail, setFromEmail] = useState('spedycja@firma.example.com');
  const [body, setBody] = useState('');
  const [result, setResult] = useState<{ classification: Classification } | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const SAMPLES = [
    {
      label: 'Zlecenie transport PL→DE',
      subject: 'Pilne zlecenie transportowe',
      body: 'Dzień dobry,\n\nProszę o wycenę transportu z Warszawy do Berlina.\nZaładunek: 15.03.2026\nTowary: palety, 24 t\nFracht: 1200 EUR\n\nPozdrawiam,\nJan Kowalski',
    },
    {
      label: 'Reklamacja – uszkodzenie',
      subject: 'Reklamacja nr 123/2026',
      body: 'Szanowni Państwo,\n\nSkładamy reklamację w związku z uszkodzeniem towaru podczas transportu z Gdańska do Frankfurtu. Domagamy się odszkodowania w kwocie 850 EUR.\n\nZ poważaniem,\nABC Sp. z o.o.',
    },
    {
      label: 'Faktura VAT',
      subject: 'Faktura VAT/2026/03/0042',
      body: 'W załączniku przesyłamy fakturę VAT za usługi transportowe.\nKwota: 3.400,00 EUR\nTermin płatności: 30 dni\n\nPozdrawiam,\nKsięgowość',
    },
  ];

  async function handleSimulate() {
    if (!subject || !body) return;
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const r = await apiClient.post('/email-agent/simulate', { subject, fromEmail, body });
      setResult(r.data);
    } catch {
      setError('Błąd klasyfikacji');
    } finally {
      setLoading(false);
    }
  }

  async function handleProcess() {
    if (!subject || !body) return;
    setSaving(true);
    setError('');
    try {
      await apiClient.post('/email-agent/process', {
        subject,
        fromEmail,
        toEmail: 'biuro@spedytor.example.com',
        body,
        receivedAt: new Date().toISOString(),
      });
      setSubject('');
      setBody('');
      setResult(null);
      onProcessed();
    } catch {
      setError('Błąd zapisu emaila');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-white rounded-xl border shadow-sm p-5 space-y-4">
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-brand-500 inline-block" />
        <h2 className="text-base font-semibold text-gray-800">Panel testowy — symulacja klasyfikacji</h2>
      </div>

      {/* Sample buttons */}
      <div className="flex flex-wrap gap-2">
        {SAMPLES.map((s) => (
          <button
            key={s.label}
            onClick={() => { setSubject(s.subject); setBody(s.body); setResult(null); }}
            className="text-xs px-3 py-1 bg-gray-100 hover:bg-gray-200 rounded-full text-gray-700 transition"
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Temat</label>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Temat e-maila"
            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Od (e-mail)</label>
          <input
            value={fromEmail}
            onChange={(e) => setFromEmail(e.target.value)}
            placeholder="nadawca@firma.example.com"
            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
          />
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Treść e-maila</label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={5}
          placeholder="Wklej treść e-maila..."
          className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 resize-none"
        />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-3">
        <button
          onClick={handleSimulate}
          disabled={loading || !subject || !body}
          className="flex-1 bg-brand-600 text-white rounded-lg px-4 py-2 text-sm font-semibold hover:bg-brand-700 disabled:opacity-50 transition"
        >
          {loading ? 'Klasyfikuję...' : 'Symuluj klasyfikację'}
        </button>
        <button
          onClick={handleProcess}
          disabled={saving || !subject || !body}
          className="flex-1 bg-green-600 text-white rounded-lg px-4 py-2 text-sm font-semibold hover:bg-green-700 disabled:opacity-50 transition"
        >
          {saving ? 'Zapisuję...' : 'Zapisz w aplikacji'}
        </button>
      </div>

      {/* Classification result */}
      {result && (
        <div className="bg-gray-50 rounded-lg p-4 space-y-3 border border-gray-200">
          {/* Method + category + priority row */}
          <div className="flex items-center gap-3 flex-wrap">
            <MethodBadge method={result.classification.method} />
            <span className={`px-3 py-1 rounded-full text-xs font-bold ${CAT_COLOR[result.classification.category] ?? 'bg-gray-100 text-gray-600'}`}>
              {CAT_LABEL[result.classification.category] ?? result.classification.category}
              {result.classification.llmCategory && result.classification.llmCategory !== result.classification.category && (
                <span className="ml-1 opacity-60">({result.classification.llmCategory})</span>
              )}
            </span>
            <span className={`text-sm font-semibold ${PRIO_COLOR[result.classification.priority]}`}>
              {PRIO_LABEL[result.classification.priority] ?? result.classification.priority}
            </span>
            <ConfidenceBadge v={result.classification.confidence} />
            {result.classification.inputTokens !== undefined && (
              <span className="text-xs text-gray-400">
                {result.classification.inputTokens}+{result.classification.outputTokens} tokenów
              </span>
            )}
          </div>

          {/* Summary (LLM only) */}
          {result.classification.summary && (
            <p className="text-sm text-gray-700 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 italic">
              {result.classification.summary}
            </p>
          )}

          {/* Tags */}
          {result.classification.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {result.classification.tags.map((t) => (
                <span key={t} className="bg-indigo-50 text-indigo-700 text-xs px-2 py-0.5 rounded-full font-medium">{t}</span>
              ))}
            </div>
          )}

          {/* Extracted fields */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-sm">
            {(result.classification.extractedPickupCity ?? result.classification.extractedData?.pickupCity) && (
              <div className="text-gray-600">
                <span className="font-medium">Załadunek:</span>{' '}
                {result.classification.extractedPickupCity ?? result.classification.extractedData?.pickupCity}
                {(result.classification.extractedPickupCountry ?? result.classification.extractedData?.pickupCountry) &&
                  ` (${result.classification.extractedPickupCountry ?? result.classification.extractedData?.pickupCountry})`}
                {result.classification.extractedData?.pickupPostal && ` ${result.classification.extractedData.pickupPostal}`}
              </div>
            )}
            {(result.classification.extractedDeliveryCity ?? result.classification.extractedData?.deliveryCity) && (
              <div className="text-gray-600">
                <span className="font-medium">Rozładunek:</span>{' '}
                {result.classification.extractedDeliveryCity ?? result.classification.extractedData?.deliveryCity}
                {(result.classification.extractedDeliveryCountry ?? result.classification.extractedData?.deliveryCountry) &&
                  ` (${result.classification.extractedDeliveryCountry ?? result.classification.extractedData?.deliveryCountry})`}
                {result.classification.extractedData?.deliveryPostal && ` ${result.classification.extractedData.deliveryPostal}`}
              </div>
            )}
            {(result.classification.extractedWeight ?? result.classification.extractedData?.weight) && (
              <div className="text-gray-600">
                <span className="font-medium">Waga:</span>{' '}
                {(((result.classification.extractedWeight ?? result.classification.extractedData?.weight) as number) / 1000).toFixed(1)} t
              </div>
            )}
            {(result.classification.extractedPrice ?? result.classification.extractedData?.price) && (
              <div className="text-gray-600">
                <span className="font-medium">Cena:</span>{' '}
                {emailPriceLabel(
                  (result.classification.extractedPrice ?? result.classification.extractedData?.price) as number,
                  result.classification.extractedData?.currency ?? result.classification.extractedCurrency,
                )}
              </div>
            )}
            {(result.classification.extractedDate ?? result.classification.extractedData?.pickupDate) && (
              <div className="text-gray-600">
                <span className="font-medium">Data załadunku:</span>{' '}
                {new Date(result.classification.extractedDate ?? result.classification.extractedData?.pickupDate ?? '').toLocaleDateString('pl-PL')}
              </div>
            )}
            {result.classification.extractedData?.deliveryDate && (
              <div className="text-gray-600">
                <span className="font-medium">Data rozładunku:</span>{' '}
                {new Date(result.classification.extractedData.deliveryDate).toLocaleDateString('pl-PL')}
              </div>
            )}
            {result.classification.extractedData?.vehicleType && (
              <div className="text-gray-600">
                <span className="font-medium">Pojazd:</span> {result.classification.extractedData.vehicleType}
              </div>
            )}
            {result.classification.extractedData?.palletCount && (
              <div className="text-gray-600">
                <span className="font-medium">Palety:</span> {result.classification.extractedData.palletCount} szt.
                {result.classification.extractedData.palletExchange && ' (wymiana)'}
              </div>
            )}
            {result.classification.extractedData?.paymentTermDays && (
              <div className="text-gray-600">
                <span className="font-medium">Termin płatności:</span> {result.classification.extractedData.paymentTermDays} dni
              </div>
            )}
            {result.classification.extractedData?.contactName && (
              <div className="text-gray-600">
                <span className="font-medium">Kontakt:</span> {result.classification.extractedData.contactName}
                {result.classification.extractedData.contactPhone && ` · ${result.classification.extractedData.contactPhone}`}
              </div>
            )}
            {result.classification.extractedData?.companyName && (
              <div className="text-gray-600">
                <span className="font-medium">Firma:</span> {result.classification.extractedData.companyName}
                {result.classification.extractedData.nip && ` (NIP: ${result.classification.extractedData.nip})`}
              </div>
            )}
            {result.classification.extractedData?.isAdr && (
              <div className="text-gray-600">
                <span className="font-medium text-orange-600">ADR:</span>{' '}
                klasa {result.classification.extractedData.adrClass ?? '?'}
              </div>
            )}
            {(result.classification.extractedData?.temperatureMin != null || result.classification.extractedData?.temperatureMax != null) && (
              <div className="text-gray-600">
                <span className="font-medium">Temperatura:</span>{' '}
                {result.classification.extractedData.temperatureMin}°C / {result.classification.extractedData.temperatureMax}°C
              </div>
            )}
          </div>

          {result.classification.reasoning && !result.classification.summary && (
            <p className="text-xs text-gray-500 italic">Uzasadnienie: {result.classification.reasoning}</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Email detail panel ────────────────────────────────────────────────────────

function EmailDetailPanel({
  email,
  onClose,
  onRefresh,
}: {
  email: EmailDetail;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const router = useRouter();
  const [creatingOffer, setCreatingOffer] = useState(false);
  const [offerError, setOfferError] = useState('');
  /** Offer id when the API answered 409 EMAIL_OFFER_EXISTS — a link instead of a second offer. */
  const [existingOfferId, setExistingOfferId] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  const [notes, setNotes] = useState(email.notes ?? '');
  const [savingNotes, setSavingNotes] = useState(false);

  async function handleCreateOffer() {
    setCreatingOffer(true);
    setOfferError('');
    setExistingOfferId(null);
    try {
      const r = await apiClient.post(`/email-agent/${email.id}/create-offer`);
      // Go to the new offer — its page runs the heuristic score and the risk analysis by itself
      router.push(`/offers/${r.data.offer.id}`);
    } catch (err: any) {
      // EMAIL_OFFER_FIELDS_MISSING says which fields are missing — a sentence from the dictionary.
      setOfferError(apiErrorText(err?.response?.data, 'Nie udało się utworzyć oferty'));
      setExistingOfferId(existingOfferFromError(err?.response?.data));
      setCreatingOffer(false);
    }
  }

  async function handleSaveNotes() {
    setSavingNotes(true);
    setActionError('');
    try {
      await apiClient.patch(`/email-agent/${email.id}`, { notes });
    } catch (err: any) {
      setActionError(apiErrorText(err?.response?.data, 'Nie udało się zapisać notatki.'));
    } finally {
      setSavingNotes(false);
    }
  }

  async function handleStar() {
    setActionError('');
    try {
      await apiClient.patch(`/email-agent/${email.id}/star`);
      onRefresh();
    } catch (err: any) {
      setActionError(apiErrorText(err?.response?.data, 'Nie udało się oznaczyć gwiazdką.'));
    }
  }

  return (
    <div className="bg-white rounded-xl border shadow-sm flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold text-gray-900 truncate">{email.subject}</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Od: {email.fromName ? `${email.fromName} <${email.fromEmail}>` : email.fromEmail}
            {' · '}
            {fmt(email.receivedAt)}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleStar}
            className={`text-lg ${email.isStarred ? 'text-amber-400' : 'text-gray-300 hover:text-amber-400'} transition`}
            title="Oznacz gwiazdką"
          >
            ★
          </button>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg" title="Zamknij">
            ×
          </button>
        </div>
      </div>

      {/* Badges */}
      <div className="px-5 py-3 border-b flex flex-wrap gap-2">
        <MethodBadge method={email.llmCategory ? 'llm' : 'regex'} />
        <span className={`px-3 py-1 rounded-full text-xs font-bold ${CAT_COLOR[email.category] ?? 'bg-gray-100 text-gray-600'}`}>
          {CAT_LABEL[email.category] ?? email.category}
          {email.llmCategory && email.llmCategory !== email.category && (
            <span className="ml-1 opacity-60">({email.llmCategory})</span>
          )}
        </span>
        <span className={`text-xs font-semibold ${PRIO_COLOR[email.priority]}`}>
          {PRIO_LABEL[email.priority]}
        </span>
        {email.tags.map((t) => (
          <span key={t} className="bg-indigo-50 text-indigo-700 text-xs px-2 py-0.5 rounded-full font-medium">{t}</span>
        ))}
        {email.createdOfferId && (
          <Link href={`/offers/${email.createdOfferId}`} className="bg-green-100 text-green-700 text-xs px-2 py-0.5 rounded-full font-medium hover:underline">
            Oferta utworzona →
          </Link>
        )}
      </div>

      {/* LLM summary */}
      {email.llmSummary && (
        <div className="px-5 py-3 border-b bg-blue-50/60">
          <p className="text-xs font-semibold text-blue-700 mb-1">Podsumowanie AI</p>
          <p className="text-sm text-gray-700 italic">{email.llmSummary}</p>
        </div>
      )}

      {/* Extracted data */}
      {(email.extractedPickupCity || email.extractedDeliveryCity || email.extractedWeight || email.extractedPrice || email.extractedDate) && (
        <div className="px-5 py-3 border-b bg-blue-50/60">
          <p className="text-xs font-semibold text-blue-700 mb-2">Wyodrębnione dane</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-xs text-gray-700">
            {email.extractedPickupCity && (
              <div><span className="font-medium">Załadunek:</span> {email.extractedPickupCity}{email.extractedPickupCountry && ` (${email.extractedPickupCountry})`}</div>
            )}
            {email.extractedDeliveryCity && (
              <div><span className="font-medium">Rozładunek:</span> {email.extractedDeliveryCity}{email.extractedDeliveryCountry && ` (${email.extractedDeliveryCountry})`}</div>
            )}
            {email.extractedWeight && (
              <div><span className="font-medium">Waga:</span> {(email.extractedWeight / 1000).toFixed(1)} t</div>
            )}
            {email.extractedPrice != null && (
              <div><span className="font-medium">Cena:</span> {emailPriceLabel(email.extractedPrice, email.extractedCurrency)}</div>
            )}
            {email.extractedDate && (
              <div><span className="font-medium">Data:</span> {new Date(email.extractedDate).toLocaleDateString('pl-PL')}</div>
            )}
          </div>
          {/* Create offer button */}
          {!email.createdOfferId && (
            <div className="mt-3">
              <button
                onClick={handleCreateOffer}
                disabled={creatingOffer}
                className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-50 transition"
              >
                {creatingOffer ? 'Tworzę i przekierowuję...' : 'Utwórz ofertę z e-maila'}
              </button>
              {offerError && <p className="text-xs text-red-600 mt-1">{offerError}</p>}
              {existingOfferId && (
                <Link href={`/offers/${existingOfferId}`} className="text-xs text-brand-600 hover:underline">
                  Otwórz istniejącą ofertę →
                </Link>
              )}
              {actionError && <p className="text-xs text-red-600 mt-1">{actionError}</p>}
            </div>
          )}
        </div>
      )}

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        <pre className="text-sm text-gray-700 whitespace-pre-wrap font-sans leading-relaxed">{email.body}</pre>
      </div>

      {/* Notes */}
      <div className="px-5 py-3 border-t bg-gray-50">
        <label className="block text-xs font-medium text-gray-600 mb-1">Notatki dyspozytora</label>
        <div className="flex gap-2">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="flex-1 border rounded-lg px-3 py-2 text-xs resize-none focus:outline-none focus:ring-2 focus:ring-brand-400"
            placeholder="Dodaj notatkę..."
          />
          <button
            onClick={handleSaveNotes}
            disabled={savingNotes}
            className="self-end text-xs bg-gray-700 text-white px-3 py-2 rounded-lg hover:bg-gray-900 disabled:opacity-50 transition"
          >
            {savingNotes ? '...' : 'Zapisz'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function EmailPage() {
  const [emails, setEmails] = useState<EmailItem[]>([]);
  const [total, setTotal] = useState(0);
  // Pages, as in offers and contractors.
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [totalPages, setTotalPages] = useState(1);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [inboxError, setInboxError] = useState<string | null>(null);
  /** Error opening an e-mail or loading the statistics — the e-mail list stays visible. */
  const [pageError, setPageError] = useState('');
  const [activeCategory, setActiveCategory] = useState('ALL');
  const [search, setSearch] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [selectedEmail, setSelectedEmail] = useState<EmailDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [activeTab, setActiveTab] = useState<'inbox' | 'test'>('inbox');

  const loadInbox = useCallback(async () => {
    setLoading(true);
    setInboxError(null);
    try {
      const params: Record<string, string> = {};
      if (activeCategory !== 'ALL') params.category = activeCategory;
      if (unreadOnly) params.unreadOnly = 'true';
      if (search) params.search = search;
      params.page = String(page);
      params.limit = String(limit);
      const [inboxRes, statsRes] = await Promise.all([
        apiClient.get('/email-agent/inbox', { params }),
        apiClient.get('/email-agent/stats').catch((err) => {
          setPageError(apiErrorText(err?.response?.data, 'Nie udało się wczytać liczników e-maili.'));
          return { data: null };
        }),
      ]);
      // /email-agent/inbox zwraca { data, meta } (buildPaginatedResponse).
      setEmails(pageItems<EmailItem>(inboxRes.data));
      setTotal(inboxRes.data.meta.total);
      setTotalPages(Math.max(1, inboxRes.data.meta.totalPages ?? 1));
      setStats(statsRes.data);
    } catch (err: any) {
      setEmails([]);
      setInboxError(apiErrorText(err?.response?.data, 'Nie udało się wczytać listy e-maili.'));
    } finally {
      setLoading(false);
    }
  }, [activeCategory, unreadOnly, search, page, limit]);

  useEffect(() => { loadInbox(); }, [loadInbox]);

  async function openEmail(id: string) {
    setLoadingDetail(true);
    setPageError('');
    try {
      const r = await apiClient.get(`/email-agent/${id}`);
      setSelectedEmail(r.data);
      // Mark read
      await apiClient.patch(`/email-agent/${id}/read`).catch((err) =>
        setPageError(apiErrorText(err?.response?.data, 'E-mail otwarty, ale nie udało się oznaczyć go jako przeczytany.')));
      // Refresh unread counts
      loadInbox();
    } catch (err: any) {
      setPageError(apiErrorText(err?.response?.data, 'Nie udało się otworzyć e-maila.'));
    } finally {
      setLoadingDetail(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Poczta AI</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Klasyfikuje e-maile wklejone w panelu testowym albo przesłane przez API. Aplikacja nie łączy się
            ze skrzynką pocztową — konektor skrzynki (IMAP, Gmail) jest poza zakresem produktu.
          </p>
          {pageError && <p className="text-sm text-red-600 mt-1">{pageError}</p>}
        </div>
        {stats && (
          <div className="flex items-center gap-3 flex-wrap text-sm">
            {stats.unread > 0 && (
              <span className="bg-brand-600 text-white px-3 py-1 rounded-full text-xs font-bold">
                {stats.unread} nieprzeczytanych
              </span>
            )}
            {stats.offersToReview > 0 && (
              <span className="bg-amber-500 text-white px-3 py-1 rounded-full text-xs font-bold">
                {stats.offersToReview} ofert do przyjęcia
              </span>
            )}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b">
        {(['inbox', 'test'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition ${
              activeTab === tab
                ? 'border-brand-600 text-brand-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab === 'inbox' ? 'E-maile w aplikacji' : 'Panel testowy'}
          </button>
        ))}
      </div>

      {activeTab === 'test' && <TestPanel onProcessed={() => { setActiveTab('inbox'); loadInbox(); }} />}

      {activeTab === 'inbox' && (
        <div className="flex flex-col lg:flex-row gap-4" style={{ minHeight: '70vh' }}>
          {/* Left panel: list */}
          <div className={`flex flex-col gap-3 w-full ${selectedEmail ? 'lg:w-[42%]' : ''} ${selectedEmail ? 'hidden lg:flex' : ''}`}>
            {/* Category filter */}
            <div className="bg-white rounded-xl border shadow-sm">
              <div className="flex overflow-x-auto">
                {CATEGORIES.map((cat) => {
                  const count = cat.key === 'ALL' ? total : (stats?.byCategory[cat.key] ?? 0);
                  return (
                    <button
                      key={cat.key}
                      onClick={() => { setActiveCategory(cat.key); setPage(1); setSelectedEmail(null); }}
                      className={`flex items-center gap-1.5 px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition ${
                        activeCategory === cat.key
                          ? 'border-brand-600 text-brand-700'
                          : 'border-transparent text-gray-500 hover:text-gray-700'
                      }`}
                    >
                      {cat.label}
                      {count > 0 && (
                        <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${
                          activeCategory === cat.key ? 'bg-brand-100 text-brand-700' : 'bg-gray-100 text-gray-600'
                        }`}>
                          {count}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Search + filters */}
              <div className="px-4 py-3 border-t flex flex-col sm:flex-row gap-3">
                <input
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                  placeholder="Szukaj w skrzynce..."
                  className="flex-1 border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
                />
                <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={unreadOnly}
                    onChange={(e) => { setUnreadOnly(e.target.checked); setPage(1); }}
                    className="rounded"
                  />
                  Tylko nieprzeczytane
                </label>
              </div>
            </div>

            {/* Email list */}
            <div className="bg-white rounded-xl border shadow-sm overflow-hidden flex-1">
              {loading && (
                <div className="text-center py-12 text-gray-400 text-sm">Ładowanie...</div>
              )}
              {!loading && inboxError && (
                <div className="text-center py-12 text-red-600 text-sm">{inboxError}</div>
              )}
              {!loading && !inboxError && emails.length === 0 && (
                <div className="text-center py-12 text-gray-400 text-sm">
                  Brak e-maili w tej kategorii.<br />
                  <button
                    onClick={() => setActiveTab('test')}
                    className="mt-2 text-brand-600 hover:underline text-xs"
                  >
                    Dodaj testowy e-mail →
                  </button>
                </div>
              )}
              {!loading && emails.length > 0 && (
                <div className="divide-y">
                  {emails.map((email) => (
                    <button
                      key={email.id}
                      onClick={() => openEmail(email.id)}
                      className={`w-full text-left px-4 py-3 hover:bg-gray-50 transition ${
                        selectedEmail?.id === email.id ? 'bg-brand-50 border-l-2 border-brand-600' : ''
                      } ${!email.isRead ? 'bg-blue-50/40' : ''}`}
                    >
                      <div className="flex items-start gap-3">
                        {/* Unread dot */}
                        <div className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${!email.isRead ? 'bg-brand-600' : 'bg-transparent'}`} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className={`text-sm truncate ${!email.isRead ? 'font-semibold text-gray-900' : 'font-medium text-gray-700'}`}>
                              {email.fromName ?? email.fromEmail}
                            </span>
                            <span className="text-xs text-gray-400 shrink-0">
                              {new Date(email.receivedAt).toLocaleDateString('pl-PL')}
                            </span>
                          </div>
                          <p className={`text-sm truncate ${!email.isRead ? 'text-gray-800' : 'text-gray-600'}`}>
                            {email.subject}
                          </p>
                          <div className="flex items-center gap-2 mt-1 flex-wrap">
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${CAT_COLOR[email.category] ?? 'bg-gray-100 text-gray-600'}`}>
                              {CAT_LABEL[email.category] ?? email.category}
                            </span>
                            {email.priority === 'HIGH' && (
                              <span className="text-xs text-red-600 font-semibold">Pilny</span>
                            )}
                            {email.isStarred && <span className="text-amber-400 text-xs">★</span>}
                            {email.createdOfferId && (
                              <span className="text-xs text-green-600 font-medium">Oferta OK</span>
                            )}
                            {(email.extractedPickupCity || email.extractedDeliveryCity) && (
                              <span className="text-xs text-gray-500 font-mono">
                                {email.extractedPickupCity}{email.extractedPickupCity && email.extractedDeliveryCity ? '→' : ''}{email.extractedDeliveryCity}
                              </span>
                            )}
                            {email.extractedPrice != null && (
                              <span className="text-xs text-gray-500">{emailPriceLabel(email.extractedPrice, email.extractedCurrency)}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {total > 0 && (
              <Pagination
                page={page}
                totalPages={totalPages}
                total={total}
                limit={limit}
                onPageChange={(p) => { setPage(p); setSelectedEmail(null); }}
                onLimitChange={(l) => { setLimit(l); setPage(1); }}
              />
            )}
          </div>

          {/* Right panel: detail */}
          {selectedEmail && (
            <div className="flex-1 w-full lg:w-auto">
              {/* Mobile back button */}
              <button
                onClick={() => setSelectedEmail(null)}
                className="lg:hidden mb-2 text-sm text-brand-600 flex items-center gap-1"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
                Powrót do listy
              </button>
              {loadingDetail ? (
                <div className="bg-white rounded-xl border shadow-sm flex items-center justify-center h-64">
                  <p className="text-gray-400 text-sm">Ładowanie...</p>
                </div>
              ) : (
                <EmailDetailPanel
                  email={selectedEmail}
                  onClose={() => setSelectedEmail(null)}
                  onRefresh={() => {
                    loadInbox();
                    if (selectedEmail) openEmail(selectedEmail.id);
                  }}
                />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
