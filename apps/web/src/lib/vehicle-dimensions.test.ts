/**
 * Clearing a vehicle dimension: an empty form field sends `null` (API: clear),
 * a filled one the number. `undefined` would mean "no change" and a saved
 * dimension could never be removed.
 */import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { dimensionValue } from './vehicle-dimensions';

describe('dimensionValue', () => {
  it('an empty field is null (clear), not undefined (no change)', () => {
    expect(dimensionValue('')).toBeNull();
    expect(dimensionValue('   ')).toBeNull();
  });

  it('a filled field is the number', () => {
    expect(dimensionValue('13.6')).toBe(13.6);
    expect(dimensionValue(' 2.48 ')).toBe(2.48);
  });
});

it('the vehicle form sends the three dimensions through dimensionValue', () => {
  // The vehicle form's request body is in lib/vehicle-payload.ts.
  const form = readFileSync(resolve(__dirname, 'vehicle-payload.ts'), 'utf8');
  for (const field of ['lengthM', 'heightM', 'widthM']) {
    expect([field, form.includes(`${field}: dimensionValue(form.${field})`)]).toEqual([field, true]);
  }
});
