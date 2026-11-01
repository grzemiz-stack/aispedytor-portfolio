/**
 * The vehicle's space on the LTL screen — no invented 13.6 m / 24 t.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { missingSpaceText, vehicleSpace } from './vehicle-space';

describe('vehicleSpace', () => {
  it('both values in the record: known, payload in tonnes', () => {
    expect(vehicleSpace({ maxLoadingMeters: 13.6, maxWeightKg: 24000 })).toEqual({ known: true, maxMeters: 13.6, maxWeightT: 24 });
  });

  it.each([
    [{ maxLoadingMeters: null, maxWeightKg: 24000 }, ['maxLoadingMeters']],
    [{ maxLoadingMeters: 13.6, maxWeightKg: null }, ['maxWeightKg']],
    [{ maxLoadingMeters: null, maxWeightKg: null }, ['maxLoadingMeters', 'maxWeightKg']],
  ])('a missing value is missing, not invented: %p', (v, missing) => {
    expect(vehicleSpace(v)).toEqual({ known: false, missing });
  });

  it('zero is a value', () => {
    expect(vehicleSpace({ maxLoadingMeters: 0, maxWeightKg: 0 })).toEqual({ known: true, maxMeters: 0, maxWeightT: 0 });
  });
});

describe('missingSpaceText', () => {
  it('names what is missing and where to complete it', () => {
    expect(missingSpaceText(['maxLoadingMeters', 'maxWeightKg'])).toBe(
      'Kartoteka pojazdu nie ma długości przestrzeni ładunkowej i ładowności — uzupełnij we Flocie, żeby liczyć wolne miejsce.',
    );
    expect(missingSpaceText(['maxWeightKg'])).toContain('nie ma ładowności — uzupełnij we Flocie');
  });
});

describe('the LTL screen uses it', () => {
  const page = readFileSync(resolve(__dirname, '../app/(dashboard)/ltl-matching/page.tsx'), 'utf8');

  it('no invented length or payload left in the screen', () => {
    expect(page).not.toMatch(/maxLoadingMeters\s*\|\|/);
    expect(page).not.toMatch(/maxWeightKg\s*\|\|/);
  });

  it('the space comes from vehicleSpace and the notice from missingSpaceText', () => {
    expect([page.includes('vehicleSpace(selectedVehicle)'), page.includes('missingSpaceText(')]).toEqual([true, true]);
  });

  it('the trailer drawing is shown only when the space is known', () => {
    expect(page).toContain('{selectedVehicle && spaceKnown && (');
  });
});
