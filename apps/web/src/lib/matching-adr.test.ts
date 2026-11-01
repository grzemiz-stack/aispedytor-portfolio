/**
 * Matching shows why a vehicle and an offer do not fit on ADR (docs/decisions.md §6).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { messagesToText } from './plan-messages';

const read = (f: string) => readFileSync(resolve(__dirname, '..', 'app/(dashboard)', f), 'utf8');

it('vehicle and offer match cards show the ADR reason and warnings from the API', () => {
  // The card leaves out MATCH_OFFER_NOT_LIVE (it is shown once, in the bar above the list) — cardWarnings.
  expect(read('offers/[id]/page.tsx')).toMatch(/messagesToText\(\[\.\.\.\(vm\.blockedBy \?\? \[\]\), \.\.\.cardWarnings\(vm\.warnings\)\]\)/);
  expect(read('fleet/[id]/page.tsx')).toMatch(/messagesToText\(\[\.\.\.\(om\.blockedBy \?\? \[\]\), \.\.\.\(om\.warnings \?\? \[\]\)\]\)/);
});

it('the reason reads as a sentence', () => {
  expect(messagesToText([{ code: 'OFFER_ADR_VEHICLE_NOT_CERTIFIED' }])).toEqual(['Ładunek ADR — pojazd nie ma uprawnień ADR.']);
});

it('MATCH_DATA_UNKNOWN names the missing data', () => {
  expect(messagesToText([{ code: 'MATCH_DATA_UNKNOWN', params: { fields: 'weightKg,currentCountry,insuranceTo' } }])).toEqual([
    'Brak danych: masa ładunku, kraj, w którym jest pojazd, termin ubezpieczenia — bez punktów za tę część oceny.',
  ]);
});
