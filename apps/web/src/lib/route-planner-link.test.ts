/**
 * "Planuj trasę" carries the offer's currency to the route planner. Before, the link had only the price: the planner started in PLN,
 * so an offer of 1800 EUR was priced as 1800 PLN and the margin came out
 * about four times too low, with no warning.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { freightFromQuery, routePlannerHref } from './route-planner-link';

const read = (f: string) => readFileSync(resolve(__dirname, '..', 'app/(dashboard)', f), 'utf8');

describe('routePlannerHref', () => {
  it('price and currency together; the offer id when known', () => {
    expect(routePlannerHref({ from: 'Poznań, PL', to: 'Berlin, DE', price: 1800, currency: 'EUR', offerId: 'o1' }))
      .toBe('/route-planner?from=Pozna%C5%84%2C%20PL&to=Berlin%2C%20DE&freight=1800&currency=EUR&offerId=o1');
  });

  it('no price → no freight and no currency', () => {
    expect(routePlannerHref({ from: 'A', to: 'B', price: null, currency: 'EUR' })).toBe('/route-planner?from=A&to=B');
  });
});

describe('freightFromQuery', () => {
  const q = (s: string) => freightFromQuery(new URLSearchParams(s));

  it('EUR offer → freight in EUR', () => {
    expect(q('freight=1800&currency=EUR')).toEqual({ freight: '1800', currency: 'EUR', notice: null });
  });

  it('PLN offer → freight in PLN', () => {
    expect(q('freight=7000&currency=PLN')).toEqual({ freight: '7000', currency: 'PLN', notice: null });
  });

  it('a currency the planner does not compute in → no freight, said so (never priced as PLN)', () => {
    expect(q('freight=900&currency=GBP')).toEqual({
      freight: null,
      currency: 'PLN',
      notice: 'Stawka oferty jest w GBP — planer liczy w PLN albo EUR. Wpisz stawkę ręcznie.',
    });
  });

  it('freight without a currency (an old link) → not used, said so', () => {
    expect(q('freight=1800')).toEqual({
      freight: null,
      currency: 'PLN',
      notice: 'Link nie podaje waluty stawki — wpisz stawkę ręcznie.',
    });
  });

  it('no freight → planner as a standalone tool, PLN, no notice', () => {
    expect(q('from=A&to=B')).toEqual({ freight: null, currency: 'PLN', notice: null });
  });
});

it('the offer page, the dashboard and the planner use these helpers', () => {
  expect(read('offers/[id]/page.tsx')).toMatch(/routePlannerHref\(/);
  // The dashboard: through recommendationPlannerHref, which calls routePlannerHref.
  expect(read('page.tsx')).toMatch(/recommendationPlannerHref\(r\)/);
  expect(readFileSync(resolve(__dirname, 'recommendation-link.ts'), 'utf8')).toMatch(/return routePlannerHref\(/);
  expect(read('route-planner/page.tsx')).toMatch(/freightFromQuery\(searchParams\)/);
  expect(read('offers/[id]/page.tsx')).not.toMatch(/&freight=\$\{/);
  expect(read('page.tsx')).not.toMatch(/&freight=\$\{/);
});
