/**
 * Currencies of amounts on the screens come from the API (dashboard, analytics,
 * new offer, route planner, negotiation panel).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { amountLabel, comparablePerKm, moneyNotes, perKmLabel, type MoneySummary } from './money';

const money: MoneySummary = {
  currency: 'PLN',
  unconverted: 1,
  codes: [
    { code: 'FX_RATE_STATIC', params: { from: 'EUR', to: 'PLN', rate: 4.3478 } },
    { code: 'TOTAL_EXCLUDES_UNCONVERTED', params: { count: 1, from: 'USD', to: 'PLN' } },
  ],
};

it('labels carry the currency given, not a fixed EUR', () => {
  expect(perKmLabel(8.1413, 'PLN')).toBe('8.14 PLN/km');
  expect(perKmLabel(null, 'PLN')).toBe('—');
  expect(perKmLabel(2, undefined)).toBe('—');
  expect(amountLabel(1500, 'GBP')).toMatch(/^1.?500 GBP$/);
  expect(amountLabel(null, 'GBP')).toBe('—');
});

it('notes say the rate is fixed and how many offers were left out', () => {
  expect(moneyNotes(money)).toEqual([
    'Przeliczono z EUR na PLN kursem stałym 4,3478 (nie z NBP).',
    'Bez 1 ofert(y) w USD — brak kursu na PLN, kwot nie doliczono.',
  ]);
  expect(moneyNotes(undefined)).toEqual([]);
});

it('the entered rate is compared with the route average only in the same currency', () => {
  expect(comparablePerKm(2.1, 'PLN', 8.14, 'PLN')).toEqual({ entered: 2.1, average: 8.14 });
  expect(comparablePerKm(2.1, 'EUR', 8.14, 'PLN')).toBeNull();
  expect(comparablePerKm(2.1, 'PLN', null, 'PLN')).toBeNull();
});

it('dashboard, analytics and new-offer screens do not hardcode € or EUR next to amounts', () => {
  const hits = ['app/(dashboard)/page.tsx', 'app/(dashboard)/analytics/page.tsx', 'app/(dashboard)/offers/new/page.tsx'].flatMap(f =>
    readFileSync(resolve(__dirname, '..', f), 'utf8').split('\n')
      .map((line, i) => `${f}:${i + 1}: ${line.trim()}`)
      .filter(line => /€|[} ]EUR[`'"]/.test(line)),
  );
  expect(hits).toEqual([]);
});

it('route planner shows the rate note under the costs', () => {
  const src = readFileSync(resolve(__dirname, '..', 'app/(dashboard)/route-planner/page.tsx'), 'utf8');
  expect(src).toMatch(/messagesToText\(route\.costs\.messages \?\? \[\]\)/);
});

it('route planner: a margin without a rate shows a dash and the reason, not "null%"', () => {
  const src = readFileSync(resolve(__dirname, '..', 'app/(dashboard)/route-planner/page.tsx'), 'utf8');
  expect(src).toMatch(/route\.margin\.marginPercent !== null \?/);
  expect(src).toMatch(/messagesToText\(route\.margin\.messages \?\? \[\]\)/);
});

it('negotiation panel shows the rate notes and left-out prices for history and contractor', () => {
  const src = readFileSync(resolve(__dirname, '..', 'components/negotiation-panel.tsx'), 'utf8');
  expect(src).toMatch(/messagesToText\(data\.priceSuggestion\.messages \?\? \[\]\)/);
  expect(src).toMatch(/messagesToText\(data\.contractorProfile\.messages \?\? \[\]\)/);
});

it('negotiation panel has no rate of its own: slider margin uses rateToPLN from the API', () => {
  const src = readFileSync(resolve(__dirname, '..', 'components/negotiation-panel.tsx'), 'utf8');
  expect(src).not.toMatch(/\*\s*4[.,]3\b/);
  expect(src).toMatch(/const pricePLN = sliderPrice \* \(rateToPLN \?\? 0\);/);
  expect(src).toMatch(/rateToPLN === null \|\|/);
});
