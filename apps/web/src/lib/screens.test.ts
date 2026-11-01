/**
 * Screens: LTL without weight/dimensions, the demand search result, the
 * dashboard recommendations.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { missingLoadText, moreUnmeasurable, viewFromResponse } from './ltl-search';
import { demandSearchView, DEMAND_RESULTS_SHOWN } from './demand-search';
import { recommendationPlannerHref, recommendationRoute } from './recommendation-link';

const read = (f: string) => readFileSync(resolve(__dirname, '..', f), 'utf8');

describe('LTL offers that cannot be measured', () => {
  const u = (id: string) => ({ offerId: id, pickupCity: 'A', pickupCountry: 'PL', deliveryCity: 'B', deliveryCountry: 'DE', pickupDate: '2030-10-01', missing: ['weightKg' as const] });

  it('the view keeps the API list and the full total', () => {
    const v = viewFromResponse({ capacity: {}, matches: [], unmeasurable: Array.from({ length: 20 }, (_, i) => u(`u${i}`)), unmeasurableTotal: 21 });
    expect([v.unmeasurable.length, v.unmeasurableTotal, moreUnmeasurable(v)]).toEqual([20, 21, 1]);
  });

  it('all shown → no "i jeszcze"', () => {
    expect(moreUnmeasurable({ unmeasurable: [u('a')], unmeasurableTotal: 1 })).toBe(0);
  });

  it('the missing data read as Polish', () => {
    expect([missingLoadText(['weightKg']), missingLoadText(['weightKg', 'dimensions'])])
      .toEqual(['Brak masy', 'Brak masy i wymiarów ani liczby palet']);
  });

  it('the screen: a collapsed section with the full number, the 20, "i jeszcze N", a link to each offer; the empty state names them', () => {
    const page = read('app/(dashboard)/ltl-matching/page.tsx');
    expect(page).toMatch(/<details[^>]*>\s*<summary[^>]*>\s*Nie da się zmierzyć — brak masy lub wymiarów \(\{unmeasurableTotal\}\)/);
    expect(page).toMatch(/unmeasurable\.map\(\(o\) =>[\s\S]{0,200}href=\{`\/offers\/\$\{o\.offerId\}`\}/);
    expect(page).toMatch(/i jeszcze \{moreUnmeasurable\(/);
    expect(page).toMatch(/\{unmeasurableTotal\} ofert czeka na masę lub wymiary/);
    expect(page).toMatch(/setUnmeasurable\(view\.unmeasurable\);/);
  });
});

describe('the demand search result under the demand', () => {
  const offer = (i: number, over: object = {}) => ({
    id: `o${i}`, pickupCity: 'Poznań', pickupCountry: 'PL', deliveryCity: 'Berlin', deliveryCountry: 'DE',
    pickupDate: '2030-10-12T00:00:00.000Z', price: '1200.00', currency: 'EUR', matchUnknownCriteria: [], ...over,
  });

  it('12 found: the first 10 in the API order, the total 12, 2 more', () => {
    const v = demandSearchView({ matchCount: 12, offers: Array.from({ length: 12 }, (_, i) => offer(i)), scanned: 80, scanLimitReached: false });
    expect([v.total, v.shown.map((o) => o.id), v.more, v.scanNote]).toEqual([12, ['o0', 'o1', 'o2', 'o3', 'o4', 'o5', 'o6', 'o7', 'o8', 'o9'], 2, null]);
    expect(DEMAND_RESULTS_SHOWN).toBe(10);
  });

  it('a row: the route, the price with its currency, the criteria that could not be judged', () => {
    const [row] = demandSearchView({ matchCount: 1, offers: [offer(1, { matchUnknownCriteria: ['weight', 'adr'] })], scanned: 1, scanLimitReached: false }).shown;
    expect([row.route, row.price, row.unknown]).toEqual(['Poznań, PL → Berlin, DE', `${(1200).toLocaleString('pl-PL')} EUR`, 'nie da się ocenić: masa, ADR']);
  });

  it('no price → none, not "0"', () => {
    expect(demandSearchView({ matchCount: 1, offers: [offer(1, { price: null })], scanned: 1, scanLimitReached: false }).shown[0].price).toBeNull();
  });

  it('the scan limit reached → a note with the number scanned', () => {
    expect(demandSearchView({ matchCount: 0, offers: [], scanned: 500, scanLimitReached: true }).scanNote).toMatch(/Przejrzano 500 najnowszych ofert/);
  });

  it('the screen: the result under the demand (table and cards), a list error is not "Brak zapotrzebowań", errors through apiErrorText', () => {
    const page = read('app/(dashboard)/demands/page.tsx');
    expect(page.match(/<DemandResults view=\{results\[d\.id\]\}/g)?.length).toBe(2);
    expect(page).toMatch(/setResults\(\(prev\) => \(\{ \.\.\.prev, \[id\]: demandSearchView\(r\.data\) \}\)\)/);
    expect(page).toMatch(/\.catch\(\(err\) => \{\s*setDemands\(\[\]\);\s*setListError\(apiErrorText\(/);
    expect(page).toMatch(/!loading && !listError && demands\.length === 0/);
    // Every error (create, search, notifications) — the API text, not a generic one.
    expect(page.match(/showToast\(apiErrorText\(err\?\.response\?\.data, /g)?.length).toBe(3);
    expect(page).not.toMatch(/showToast\('(Błąd|Nie udało)/);
  });
});

describe('the dashboard recommendation', () => {
  const R = { offerId: 'o1', pickupCity: 'Poznań', pickupCountry: 'PL', deliveryCity: 'Berlin', deliveryCountry: 'DE', price: 1800, currency: 'EUR' };

  it('"Planuj trasę": cities and countries, the price with its currency, the offer id — not "PL→DE"', () => {
    const q = new URLSearchParams(recommendationPlannerHref(R).split('?')[1]);
    expect([q.get('from'), q.get('to'), q.get('freight'), q.get('currency'), q.get('offerId')]).toEqual(['Poznań, PL', 'Berlin, DE', '1800', 'EUR', 'o1']);
  });

  it('no price → no freight in the link', () => {
    expect(new URLSearchParams(recommendationPlannerHref({ ...R, price: null }).split('?')[1]).get('freight')).toBeNull();
  });

  it('the route label shows the cities', () => {
    expect(recommendationRoute(R)).toBe('Poznań, PL → Berlin, DE');
  });

  it('the dashboard does not read the deprecated `route` any more', () => {
    const page = read('app/(dashboard)/page.tsx');
    expect(page).not.toMatch(/\br\.route\b/);
    expect(page).toMatch(/const planRouteHref = recommendationPlannerHref\(r\);/);
  });
});
