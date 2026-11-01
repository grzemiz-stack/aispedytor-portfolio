/**
 * The margin on the screens: the upper bound without a toll, the order, the
 * average.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { byMarginDesc, isUpperBound, marginText, upperBoundNote } from './margin';

const read = (f: string) => readFileSync(resolve(__dirname, '..', f), 'utf8');

it('the text: full "71.0%", upper bound "≤ 71.0%", none "—"; 0 % is a margin', () => {
  expect([
    marginText({ profitMarginPercent: 71.02, marginWithoutTolls: false }),
    marginText({ profitMarginPercent: '71.02', marginWithoutTolls: true }),
    marginText({ profitMarginPercent: null, marginWithoutTolls: null }),
    marginText({ profitMarginPercent: 0, marginWithoutTolls: false }),
  ]).toEqual(['71.0%', '≤ 71.0%', '—', '0.0%']);
});

it('an upper bound only with a margin and the flag true', () => {
  expect([isUpperBound({ profitMarginPercent: 5, marginWithoutTolls: true }), isUpperBound({ profitMarginPercent: null, marginWithoutTolls: true }), isUpperBound({ profitMarginPercent: 5 })])
    .toEqual([true, false, false]);
});

it('the order: full (highest first), then upper bounds, empty last — like the API', () => {
  const rows = [
    { id: 'bound-90', profitMarginPercent: 90, marginWithoutTolls: true },
    { id: 'none', profitMarginPercent: null, marginWithoutTolls: null },
    { id: 'full-10', profitMarginPercent: 10, marginWithoutTolls: false },
    { id: 'full-30', profitMarginPercent: 30, marginWithoutTolls: false },
    { id: 'bound-20', profitMarginPercent: 20, marginWithoutTolls: true },
  ];
  expect([...rows].sort(byMarginDesc).map((r) => r.id)).toEqual(['full-30', 'full-10', 'bound-90', 'bound-20', 'none']);
});

it('the note under an average names the upper-bound count, none when 0', () => {
  expect([upperBoundNote(3), upperBoundNote(0), upperBoundNote(undefined)]).toEqual(['bez 3 ofert z marżą tylko jako górną granicą (bez myta)', null, null]);
});

it('the screens use the shared badge and the note (list, dashboard, offer page, analytics)', () => {
  expect(read('app/(dashboard)/offers/page.tsx')).toMatch(/<MarginBadge offer=\{o\} \/>/);
  const dash = read('app/(dashboard)/page.tsx');
  expect(dash).toMatch(/<MarginBadge offer=\{o\} \/>/);
  expect(dash).toMatch(/note: upperBoundNote\(stats\.marginUpperBoundOffers\)/);
  expect(dash).toMatch(/\.sort\(byMarginDesc\)/);
  expect(dash).toMatch(/uncertain: \{ text: 'Niepewna \(bez myta\)'/);
  expect(read('app/(dashboard)/offers/[id]/page.tsx')).toMatch(/marginBound \? '\(górna granica — koszt bez myta\)'/);
  expect(read('app/(dashboard)/analytics/page.tsx')).toMatch(/sub=\{upperBoundNote\(overview\.marginUpperBoundOffers\) \?\? undefined\}/);
  for (const f of ['app/(dashboard)/offers/page.tsx', 'app/(dashboard)/page.tsx']) expect(read(f)).not.toMatch(/function marginBadge/);
});
