'use client';

import { useState, useEffect, useRef } from 'react';
import { useAuthStore } from '@/store/auth.store';
import { apiClient } from '@/lib/api-client';
import { apiErrorText as errorText } from '@/lib/api-error';
import {
  COMPANY_CURRENCIES, apiErrorText, costFromApi, costPatch, parseCostPerKm, type CompanyCost,
} from '@/lib/company-cost';

interface Company {
  name: string;
  taxId: string | null;
  logoBase64: string | null;
  /** The API sends a Decimal as a string. */
  costPerKm: string | number | null;
  costCurrency: string;
}

/**
 * `Section` (below) is defined outside the component: defined inside it, it
 * would be a new type on every render and React would remount its content —
 * the text field would lose focus after every character.
 */
const TRANS_EU_LABEL: Record<IntegrationStatus['transEu'], string> = {
  connected: 'Połączono',
  expired: 'Sesja wygasła — połącz ponownie',
  not_connected: 'Nie połączono',
  not_configured: 'Nie skonfigurowano',
};

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="bg-white rounded-xl border shadow-sm p-6">
    <h2 className="text-sm font-semibold text-gray-800 mb-4">{title}</h2>
    {children}
  </div>
);

interface IntegrationStatus {
  database: 'ok' | 'error';
  /** This company's Trans.eu connection (from the database). */
  transEu: 'not_configured' | 'not_connected' | 'connected' | 'expired';
  uptime: number;
  version: string;
  cache?: { size: number; hits: number; misses: number; hitRate: string };
  queue?: { pending: number; active: number; processed: number; failed: number };
}

export default function SettingsPage() {
  const { user } = useAuthStore();
  const [company, setCompany] = useState<Company | null>(null);
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [saving, setSaving] = useState(false);
  const [logoSaving, setLogoSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [logoMsg, setLogoMsg] = useState('');
  const [logoError, setLogoError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [integrations, setIntegrations] = useState<IntegrationStatus | null>(null);
  const [integrationsLoading, setIntegrationsLoading] = useState(false);
  const [integrationsError, setIntegrationsError] = useState('');
  const [loadError, setLoadError] = useState('');
  // Cost per km: the field as text (comma or dot), the currency from a list.
  const [costText, setCostText] = useState('');
  const [costCurrency, setCostCurrency] = useState('PLN');
  const [costSaving, setCostSaving] = useState(false);
  const [costMsg, setCostMsg] = useState('');
  const [costError, setCostError] = useState('');
  const isAdmin = user?.role === 'ADMIN';

  function loadCost(c: Company) {
    const cost = costFromApi(c);
    setCostText(cost.costPerKm != null ? String(cost.costPerKm).replace('.', ',') : '');
    setCostCurrency(cost.costCurrency);
  }

  useEffect(() => {
    apiClient.get('/companies/me')
      .then((r) => { setCompany(r.data); loadCost(r.data); })
      .catch((err) => setLoadError(errorText(err?.response?.data, 'Nie udało się wczytać danych firmy.')));
    fetchIntegrations();
  }, []);

  async function fetchIntegrations() {
    setIntegrationsLoading(true);
    setIntegrationsError('');
    try {
      const r = await apiClient.get('/health/integrations');
      setIntegrations(r.data);
    } catch (err: any) {
      setIntegrationsError(errorText(err?.response?.data, 'Nie udało się sprawdzić statusu systemu.'));
    }
    setIntegrationsLoading(false);
  }

  async function handlePasswordChange(e: React.FormEvent) {
    e.preventDefault();
    if (passwordForm.newPassword !== passwordForm.confirm) {
      setError('Hasła nie są identyczne');
      return;
    }
    if (passwordForm.newPassword.length < 8) {
      setError('Nowe hasło musi mieć co najmniej 8 znaków');
      return;
    }
    setError('');
    setSaving(true);
    try {
      const r = await apiClient.patch('/users/me/password', {
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword,
      });
      // The API ends all sessions and returns new tokens for this one — without them
      // the screen would log out at the next token refresh.
      useAuthStore.setState({ accessToken: r.data.accessToken, refreshToken: r.data.refreshToken });
      setMsg('Hasło zostało zmienione. Inne sesje zostały wylogowane.');
      setPasswordForm({ currentPassword: '', newPassword: '', confirm: '' });
    } catch (err: any) {
      setError(errorText(err.response?.data, 'Błąd podczas zmiany hasła'));
    } finally {
      setSaving(false);
    }
  }

  function handleLogoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 500_000) {
      setLogoError('Plik jest zbyt duży (max 500 KB)');
      return;
    }
    if (!file.type.startsWith('image/')) {
      setLogoError('Dozwolone tylko pliki graficzne (PNG, JPG, SVG, WebP)');
      return;
    }
    setLogoError('');
    const reader = new FileReader();
    reader.onload = async () => {
      const b64 = reader.result as string;
      setLogoSaving(true);
      try {
        const r = await apiClient.patch('/companies/me/logo', { logoBase64: b64 });
        setCompany((prev) => prev ? { ...prev, logoBase64: r.data.logoBase64 } : prev);
        setLogoMsg('Logo zostało zaktualizowane');
      } catch (err: any) {
        setLogoError(err.response?.data?.message ?? 'Błąd podczas zapisywania logo');
      } finally {
        setLogoSaving(false);
      }
    };
    reader.readAsDataURL(file);
  }

  async function handleCostSave(e: React.FormEvent) {
    e.preventDefault();
    if (!company) return;
    setCostMsg('');
    setCostError('');
    const costPerKm = parseCostPerKm(costText);
    if (costPerKm === undefined) {
      setCostError('Koszt kilometra: wpisz liczbę, np. 4,20 — albo zostaw puste.');
      return;
    }
    const current: CompanyCost = costFromApi(company);
    const body = costPatch(current, { costPerKm, costCurrency });
    if (!body) {
      setCostMsg('Bez zmian.');
      return;
    }
    setCostSaving(true);
    try {
      const r = await apiClient.patch('/companies/me', body);
      setCompany(r.data);
      loadCost(r.data);
      setCostMsg('Zapisano. Ranking doładunków liczy teraz ' + (costPerKm != null ? 'zysk.' : 'przychód.'));
    } catch (err: any) {
      setCostError(apiErrorText(err.response?.data));
    } finally {
      setCostSaving(false);
    }
  }

  async function handleLogoRemove() {
    setLogoSaving(true);
    try {
      await apiClient.delete('/companies/me/logo');
      setCompany((prev) => prev ? { ...prev, logoBase64: null } : prev);
      setLogoMsg('Logo zostało usunięte');
    } catch {
      setLogoError('Błąd podczas usuwania logo');
    } finally {
      setLogoSaving(false);
    }
  }

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Ustawienia</h1>
        <p className="text-sm text-gray-500 mt-1">Zarządzaj kontem i firmą</p>
      </div>

      {loadError && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{loadError}</div>
      )}

      <Section title="Twoje konto">
        <div className="space-y-2 text-sm">
          <div className="flex gap-2">
            <span className="text-gray-500 w-32">Imię i nazwisko</span>
            <span className="text-gray-900 font-medium">{user?.firstName} {user?.lastName}</span>
          </div>
          <div className="flex gap-2">
            <span className="text-gray-500 w-32">Email</span>
            <span className="text-gray-900 font-medium">{user?.email}</span>
          </div>
          <div className="flex gap-2">
            <span className="text-gray-500 w-32">Rola</span>
            <span className="text-gray-900 font-medium">{user?.role}</span>
          </div>
        </div>
      </Section>

      {company && (
        <Section title="Firma">
          <div className="space-y-2 text-sm">
            <div className="flex gap-2">
              <span className="text-gray-500 w-32">Nazwa firmy</span>
              <span className="text-gray-900 font-medium">{company.name}</span>
            </div>
            {company.taxId && (
              <div className="flex gap-2">
                <span className="text-gray-500 w-32">NIP</span>
                <span className="text-gray-900 font-medium">{company.taxId}</span>
              </div>
            )}
          </div>
        </Section>
      )}

      {company && (
        <Section title="Koszt kilometra">
          <form onSubmit={handleCostSave} className="space-y-4">
            <p className="text-xs text-gray-500">
              Z kosztem ranking doładunków (LTL) liczy zysk: cena − km nadłożenia × koszt − myto.
              Bez kosztu — sam przychód. W tej walucie pokazywane są też kwoty rankingu.
            </p>
            <div className="flex gap-3 items-end">
              <div className="flex-1">
                <label htmlFor="costPerKm" className="block text-sm font-medium text-gray-700 mb-1">
                  Koszt kilometra
                </label>
                <input
                  id="costPerKm"
                  inputMode="decimal"
                  placeholder="np. 4,20 — puste = brak"
                  value={costText}
                  onChange={(e) => setCostText(e.target.value)}
                  disabled={!isAdmin || costSaving}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:bg-gray-50"
                />
              </div>
              <div>
                <label htmlFor="costCurrency" className="block text-sm font-medium text-gray-700 mb-1">
                  Waluta firmy
                </label>
                <select
                  id="costCurrency"
                  value={costCurrency}
                  onChange={(e) => setCostCurrency(e.target.value)}
                  disabled={!isAdmin || costSaving}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:bg-gray-50"
                >
                  {COMPANY_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            {costError && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{costError}</p>}
            {costMsg && <p className="text-sm text-green-600 bg-green-50 border border-green-200 rounded-lg px-3 py-2">{costMsg}</p>}
            {isAdmin ? (
              <button
                type="submit"
                disabled={costSaving}
                className="bg-brand-600 text-white px-5 py-2 rounded-xl text-sm font-medium hover:bg-brand-700 transition disabled:opacity-50"
              >
                {costSaving ? 'Zapisywanie...' : 'Zapisz koszt'}
              </button>
            ) : (
              <p className="text-xs text-gray-400">Koszt zmienia administrator firmy.</p>
            )}
          </form>
        </Section>
      )}

      {/* Logo upload */}
      <Section title="Logo firmy">
        <div className="space-y-4">
          {company?.logoBase64 && (
            <div className="flex items-center gap-4">
              <img
                src={company.logoBase64}
                alt="Logo firmy"
                className="h-16 w-auto rounded-lg border border-gray-200 object-contain bg-gray-50 p-1"
              />
              <button
                onClick={handleLogoRemove}
                disabled={logoSaving}
                className="text-xs text-red-500 hover:text-red-700 border border-red-200 px-3 py-1.5 rounded-lg transition hover:bg-red-50 disabled:opacity-50"
              >
                Usuń logo
              </button>
            </div>
          )}
          <div className="flex items-center gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleLogoFile}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => { setLogoMsg(''); setLogoError(''); fileInputRef.current?.click(); }}
              disabled={logoSaving}
              className="bg-brand-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-brand-700 transition disabled:opacity-50"
            >
              {logoSaving ? 'Zapisywanie...' : company?.logoBase64 ? 'Zmień logo' : 'Wgraj logo'}
            </button>
            <span className="text-xs text-gray-400">PNG, JPG, SVG, WebP — max 500 KB</span>
          </div>
          {logoError && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{logoError}</p>}
          {logoMsg && <p className="text-sm text-green-600 bg-green-50 border border-green-200 rounded-lg px-3 py-2">{logoMsg}</p>}
        </div>
      </Section>

      <Section title="Zmień hasło">
        <form onSubmit={handlePasswordChange} className="space-y-4">
          {(['currentPassword', 'newPassword', 'confirm'] as const).map((key) => {
            const labels: Record<string, string> = {
              currentPassword: 'Aktualne hasło',
              newPassword: 'Nowe hasło',
              confirm: 'Powtórz nowe hasło',
            };
            return (
              <div key={key}>
                <label className="block text-sm font-medium text-gray-700 mb-1">{labels[key]}</label>
                <input
                  type="password"
                  value={passwordForm[key]}
                  onChange={(e) => setPasswordForm({ ...passwordForm, [key]: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>
            );
          })}
          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
          {msg && <p className="text-sm text-green-600 bg-green-50 border border-green-200 rounded-lg px-3 py-2">{msg}</p>}
          <button
            type="submit"
            disabled={saving}
            className="bg-brand-600 text-white px-5 py-2 rounded-xl text-sm font-medium hover:bg-brand-700 transition disabled:opacity-50"
          >
            {saving ? 'Zapisywanie...' : 'Zmień hasło'}
          </button>
        </form>
      </Section>

      {/* System Status */}
      <Section title="Status systemu">
        {integrationsError && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">{integrationsError}</p>
        )}
        {integrationsLoading && !integrations ? (
          <p className="text-sm text-gray-400">Sprawdzanie...</p>
        ) : integrations ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
              {/* Database */}
              <div className={`rounded-xl border p-4 text-center ${
                integrations.database === 'ok' ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'
              }`}>
                <p className="text-2xl mb-1">{integrations.database === 'ok' ? '\u2705' : '\u274C'}</p>
                <p className="text-sm font-semibold text-gray-900">Baza danych</p>
                <p className={`text-xs mt-0.5 ${integrations.database === 'ok' ? 'text-green-600' : 'text-red-600'}`}>
                  {integrations.database === 'ok' ? 'Po\u0142\u0105czono' : 'B\u0142\u0105d po\u0142\u0105czenia'}
                </p>
              </div>

              {/* Trans.eu — this company's connection */}
              <div className={`rounded-xl border p-4 text-center ${
                integrations.transEu === 'connected' ? 'bg-green-50 border-green-200'
                : integrations.transEu === 'expired' ? 'bg-red-50 border-red-200'
                : 'bg-amber-50 border-amber-200'
              }`}>
                <p className="text-2xl mb-1">
                  {integrations.transEu === 'connected' ? '\u2705' : integrations.transEu === 'expired' ? '\u274C' : '\u26A0\uFE0F'}
                </p>
                <p className="text-sm font-semibold text-gray-900">Trans.eu</p>
                <p className={`text-xs mt-0.5 ${
                  integrations.transEu === 'connected' ? 'text-green-600'
                  : integrations.transEu === 'expired' ? 'text-red-600'
                  : 'text-amber-600'
                }`}>
                  {TRANS_EU_LABEL[integrations.transEu]}
                </p>
              </div>

              {/* Cache */}
              {integrations.cache && (() => {
                const hitPct = parseFloat(integrations.cache!.hitRate);
                const cacheOk = hitPct >= 50 || integrations.cache!.size === 0;
                return (
                  <div className={`rounded-xl border p-4 text-center ${
                    cacheOk ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'
                  }`}>
                    <p className="text-2xl mb-1">{'\u{1F4BE}'}</p>
                    <p className="text-sm font-semibold text-gray-900">Cache</p>
                    <p className={`text-xs mt-0.5 ${cacheOk ? 'text-green-600' : 'text-amber-600'}`}>
                      {integrations.cache!.size} wpis{integrations.cache!.size === 1 ? '' : integrations.cache!.size < 5 ? 'y' : '\u00F3w'} &middot; {integrations.cache!.hitRate}
                    </p>
                  </div>
                );
              })()}

              {/* Queue */}
              {integrations.queue && (() => {
                const p = integrations.queue!.pending;
                const queueOk = p < 10;
                const queueWarn = p >= 10 && p < 50;
                return (
                  <div className={`rounded-xl border p-4 text-center ${
                    queueOk ? 'bg-green-50 border-green-200'
                    : queueWarn ? 'bg-amber-50 border-amber-200'
                    : 'bg-red-50 border-red-200'
                  }`}>
                    <p className="text-2xl mb-1">{'\u{1F4CB}'}</p>
                    <p className="text-sm font-semibold text-gray-900">Kolejka</p>
                    <p className={`text-xs mt-0.5 ${
                      queueOk ? 'text-green-600' : queueWarn ? 'text-amber-600' : 'text-red-600'
                    }`}>
                      {integrations.queue!.pending} oczek. &middot; {integrations.queue!.active} akt.
                    </p>
                  </div>
                );
              })()}
            </div>

            <div className="flex items-center justify-between text-xs text-gray-500">
              <div className="flex gap-4">
                <span>Uptime: {Math.floor(integrations.uptime / 3600)}h {Math.floor((integrations.uptime % 3600) / 60)}m</span>
                <span>Wersja: {integrations.version}</span>
              </div>
              <button
                onClick={fetchIntegrations}
                disabled={integrationsLoading}
                className="text-brand-600 hover:underline disabled:opacity-50"
              >
                {integrationsLoading ? 'Sprawdzanie...' : 'Sprawdź ponownie'}
              </button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-gray-400">Nie udało się pobrać statusu</p>
        )}
      </Section>
    </div>
  );
}
