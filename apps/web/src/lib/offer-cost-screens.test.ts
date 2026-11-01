/**
 * Offer-cost screens: cost = the company cost per km × km + toll. The planner
 * has no fuel fields any more (removed from the API), the negotiation panel
 * shows neither "Paliwo" nor "Inne" (0.5 PLN/km from a constant).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { messagesToText } from './plan-messages';

const read = (f: string) => readFileSync(resolve(__dirname, '..', f), 'utf8');

it('the route planner sends no fuel fields and has no fuel inputs', () => {
  const page = read('app/(dashboard)/route-planner/page.tsx');
  expect(page).not.toMatch(/fuelConsumption|fuelPrice|Zużycie paliwa|Cena paliwa|costs\.fuel/);
  expect(page).toMatch(/Koszt kilometra firmy/);
});

it('the negotiation panel shows the company cost per km, not fuel and "other"', () => {
  const panel = read('components/negotiation-panel.tsx');
  expect(panel).not.toMatch(/fuelPLN|otherPLN|Inne \(kierowca/);
  expect(panel).toMatch(/Koszt kilometra firmy × km/);
  expect(panel).toMatch(/a\.code === 'set_cost_per_km'[\s\S]{0,200}href="\/settings"/);
});

it('the cost codes read as sentences', () => {
  expect(messagesToText([{ code: 'OFFER_COST_RATE_MISSING' }])).toEqual([
    'Firma nie ma kosztu kilometra — koszt oferty nieznany. Administrator ustawia go w ustawieniach firmy.',
  ]);
});
