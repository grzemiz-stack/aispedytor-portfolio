'use client';

import { upperBoundNote } from '@/lib/margin';
import { useState, useEffect } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { apiClient } from '@/lib/api-client';
import { apiErrorText } from '@/lib/api-error';
import { amountLabel, moneyNotes, perKmLabel, type MoneySummary } from '@/lib/money';

interface TopRoute {
  pickupCountry: string;
  deliveryCountry: string;
  offerCount: number;
  avgPricePerKm: number | null;
}

interface MonthlyPoint {
  month: string;
  revenue: number;
  offers: number;
}

interface MarketOverview {
  topRoutes: TopRoute[];
  avgMargin: number | null;
  /** Offers with only an upper-bound margin — outside the average. */
  marginUpperBoundOffers?: number;
  totalRevenue: number;
  offersThisMonth: number;
  offersLastMonth: number;
  monthlyRevenue: MonthlyPoint[];
  /** The company currency the API converted the amounts to, and the exchange-rate codes. */
  money?: MoneySummary;
}

function StatCard({ label, value, sub, color = 'text-gray-900' }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="bg-white rounded-xl border shadow-sm p-5">
      <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="bg-white rounded-xl border shadow-sm p-5 animate-pulse">
      <div className="h-3 bg-gray-100 rounded w-24 mb-3" />
      <div className="h-8 bg-gray-100 rounded w-20" />
    </div>
  );
}

export default function AnalyticsPage() {
  const [overview, setOverview] = useState<MarketOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    apiClient.get('/analytics/market-overview')
      .then((r) => setOverview(r.data))
      .catch((err) => setLoadError(apiErrorText(err?.response?.data, 'Nie udało się wczytać analityki.')))
      .finally(() => setLoading(false));
  }, []);

  const monthDiff = overview
    ? overview.offersLastMonth > 0
      ? (((overview.offersThisMonth - overview.offersLastMonth) / overview.offersLastMonth) * 100).toFixed(0)
      : null
    : null;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Analityka</h1>
        <p className="text-sm text-gray-500 mt-1">Statystyki i trendy Twojej działalności</p>
      </div>

      {loadError && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{loadError}</div>
      )}

      {/* KPI row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
        ) : overview ? (
          <>
            <StatCard
              label="Średnia marża"
              value={overview.avgMargin !== null ? `${overview.avgMargin.toFixed(1)}%` : '—'}
              sub={upperBoundNote(overview.marginUpperBoundOffers) ?? undefined}
              color={overview.avgMargin && overview.avgMargin >= 15 ? 'text-green-600' : 'text-amber-600'}
            />
            <StatCard
              label="Przychód (przyjęte zlecenia)"
              value={overview.totalRevenue > 0 ? amountLabel(overview.totalRevenue, overview.money?.currency) : '—'}
            />
            <StatCard
              label="Oferty — ten miesiąc"
              value={String(overview.offersThisMonth)}
              sub={monthDiff !== null ? `${Number(monthDiff) >= 0 ? '+' : ''}${monthDiff}% vs poprzedni` : undefined}
              color={monthDiff !== null && Number(monthDiff) >= 0 ? 'text-green-600' : 'text-red-500'}
            />
            <StatCard
              label="Oferty — poprzedni miesiąc"
              value={String(overview.offersLastMonth)}
            />
          </>
        ) : null}
      </div>
      {!loading && moneyNotes(overview?.money).map((note) => (
        <p key={note} className="text-xs text-gray-500 -mt-6">{note}</p>
      ))}

      {/* Monthly revenue chart */}
      <div className="bg-white rounded-xl border shadow-sm p-6">
        <h2 className="text-sm font-semibold text-gray-800 mb-6">Przychód miesięczny (ostatnie 6 miesięcy)</h2>
        {loading ? (
          <div className="h-48 flex items-center justify-center">
            <p className="text-sm text-gray-400 animate-pulse">Ładowanie wykresu...</p>
          </div>
        ) : overview && overview.monthlyRevenue.length > 0 ? (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={overview.monthlyRevenue} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
              <YAxis
                tick={{ fontSize: 11, fill: '#9ca3af' }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)}
              />
              <Tooltip
                contentStyle={{ borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 12 }}
                formatter={(value: number) => [amountLabel(value, overview.money?.currency), 'Przychód']}
              />
              <Bar dataKey="revenue" fill="#2563eb" radius={[4, 4, 0, 0]} maxBarSize={48} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-48 flex items-center justify-center">
            <p className="text-sm text-gray-400">Brak danych o przychodach</p>
          </div>
        )}
      </div>

      {/* Top routes */}
      <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b">
          <h2 className="text-sm font-semibold text-gray-800">Top 5 tras</h2>
          <p className="text-xs text-gray-400 mt-0.5">Najczęściej obsługiwane kierunki</p>
        </div>
        {loading ? (
          <p className="text-sm text-gray-400 text-center py-8 animate-pulse">Ładowanie...</p>
        ) : !overview?.topRoutes?.length ? (
          <p className="text-sm text-gray-400 text-center py-8">Brak danych</p>
        ) : (<>
          <div className="hidden xl:block">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                {['#', 'Trasa', 'Liczba ofert', 'Śr. stawka/km', 'Udział'].map((h) => (
                  <th key={h} className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {overview.topRoutes.map((r, i) => {
                const totalOffers = overview.topRoutes.reduce((s, x) => s + x.offerCount, 0);
                const share = totalOffers > 0 ? (r.offerCount / totalOffers) * 100 : 0;
                return (
                  <tr key={i} className="hover:bg-gray-50 transition">
                    <td className="px-5 py-3">
                      <span className={`w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center text-white ${i === 0 ? 'bg-amber-400' : i === 1 ? 'bg-gray-400' : i === 2 ? 'bg-orange-400' : 'bg-gray-200 text-gray-500'}`}>
                        {i + 1}
                      </span>
                    </td>
                    <td className="px-5 py-3 font-semibold text-gray-900">
                      {r.pickupCountry} → {r.deliveryCountry}
                    </td>
                    <td className="px-5 py-3 text-gray-700">{r.offerCount}</td>
                    <td className="px-5 py-3">
                      {r.avgPricePerKm !== null ? (
                        <span className="font-medium text-gray-900">{perKmLabel(r.avgPricePerKm, overview.money?.currency)}</span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 bg-gray-100 rounded-full h-1.5 max-w-[80px]">
                          <div
                            className="bg-brand-500 h-1.5 rounded-full"
                            style={{ width: `${share}%` }}
                          />
                        </div>
                        <span className="text-xs text-gray-500">{share.toFixed(0)}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
          {/* Cards — mobile/tablet/laptop */}
          <div className="xl:hidden divide-y">
            {overview.topRoutes.map((r, i) => {
              const totalOffers = overview.topRoutes.reduce((s, x) => s + x.offerCount, 0);
              const share = totalOffers > 0 ? (r.offerCount / totalOffers) * 100 : 0;
              return (
                <div key={i} className="px-4 py-3 hover:bg-gray-50 transition">
                  <div className="flex items-center gap-3">
                    <span className={`w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center text-white shrink-0 ${i === 0 ? 'bg-amber-400' : i === 1 ? 'bg-gray-400' : i === 2 ? 'bg-orange-400' : 'bg-gray-200 text-gray-500'}`}>
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-gray-900">{r.pickupCountry} → {r.deliveryCountry}</span>
                        <span className="text-xs text-gray-500">{r.offerCount} ofert</span>
                      </div>
                      <div className="flex items-center gap-3 mt-1">
                        {r.avgPricePerKm !== null && (
                          <span className="text-xs font-medium text-gray-700">{perKmLabel(r.avgPricePerKm, overview.money?.currency)}</span>
                        )}
                        <div className="flex items-center gap-2 flex-1">
                          <div className="flex-1 bg-gray-100 rounded-full h-1.5 max-w-[80px]">
                            <div className="bg-brand-500 h-1.5 rounded-full" style={{ width: `${share}%` }} />
                          </div>
                          <span className="text-xs text-gray-500">{share.toFixed(0)}%</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>)}
      </div>

      {/* Offers per month mini-chart */}
      <div className="bg-white rounded-xl border shadow-sm p-6">
        <h2 className="text-sm font-semibold text-gray-800 mb-6">Liczba ofert miesięcznie</h2>
        {loading ? (
          <div className="h-36 flex items-center justify-center">
            <p className="text-sm text-gray-400 animate-pulse">Ładowanie...</p>
          </div>
        ) : overview && overview.monthlyRevenue.length > 0 ? (
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={overview.monthlyRevenue} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip
                contentStyle={{ borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 12 }}
                formatter={(value: number) => [value, 'Oferty']}
              />
              <Bar dataKey="offers" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={40} />
            </BarChart>
          </ResponsiveContainer>
        ) : null}
      </div>
    </div>
  );
}
