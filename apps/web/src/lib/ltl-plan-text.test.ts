/**
 * The LTL plan dialog says only what the API checked. It
 * said "Wszystkie osie w normie" (all axle loads OK) although nothing
 * computes axle loads: `isValid` covers length, weight and gross weight.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const page = readFileSync(resolve(__dirname, '..', 'app/(dashboard)/ltl-matching/page.tsx'), 'utf8');

it('no claim about axle loads', () => {
  expect(page).not.toMatch(/osie w normie/i);
  expect(page).not.toMatch(/nacisk\w* osi\w* w normie/i);
});

it('the valid plan says what was checked and what was not', () => {
  expect(page).toMatch(/Długość, masa i DMC w normie — naciski osi nie są liczone/);
});
