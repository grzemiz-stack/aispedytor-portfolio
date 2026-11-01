/**
 * Contractor risk ratings in the edit and new-contractor forms.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ratingFromForm, ratingToForm, reliabilityError } from './contractor-ratings';

it('0 is a rating, not an empty field — both ways', () => {
  expect(ratingToForm(0)).toBe('0');
  expect(ratingToForm(null)).toBe('');
  expect(ratingFromForm('0')).toBe(0);
  expect(ratingFromForm('')).toBeNull();
  expect(ratingFromForm(' 35 ')).toBe(35);
});

it('the edit form sends both ratings and reads API errors as sentences', () => {
  const src = readFileSync(resolve(__dirname, '..', 'app/(dashboard)/contractors/[id]/page.tsx'), 'utf8');
  const save = src.slice(src.indexOf('async function handleSave'), src.indexOf('async function toggleActive'));
  expect(save).toMatch(/paymentRating: ratingFromForm\(form\.paymentRating\)/);
  expect(save).toMatch(/reliabilityScore: ratingFromForm\(form\.reliabilityScore\)/);
  expect(save).toMatch(/setError\(apiErrorText\(err\.response\?\.data, /);
  expect(src).toMatch(/value=\{form\.paymentRating\}/);
  expect(src).toMatch(/value=\{form\.reliabilityScore\}/);
});

it('reliability must be a whole number 0–100 (empty = no rating)', () => {
  expect(reliabilityError('')).toBeNull();
  expect(reliabilityError('0')).toBeNull();
  expect(reliabilityError('100')).toBeNull();
  expect(reliabilityError('101')).toMatch(/0–100/);
  expect(reliabilityError('-1')).toMatch(/0–100/);
  expect(reliabilityError('40.5')).toMatch(/całkowita/);
});

it('the new-contractor form has both rating fields and sends them like the edit form', () => {
  const src = readFileSync(resolve(__dirname, '..', 'app/(dashboard)/contractors/page.tsx'), 'utf8');
  const submit = src.slice(src.indexOf('async function handleSubmit'), src.indexOf('const filtered'));
  expect(submit).toMatch(/paymentRating: ratingFromForm\(form\.paymentRating\) \?\? undefined/);
  expect(submit).toMatch(/reliabilityScore: ratingFromForm\(form\.reliabilityScore\) \?\? undefined/);
  expect(submit).toMatch(/const reliability = reliabilityError\(form\.reliabilityScore\);\s*if \(reliability\) \{ setError\(reliability\); return; \}/);
  expect(src).toMatch(/value=\{form\.paymentRating\}/);
  expect(src).toMatch(/value=\{form\.reliabilityScore\}/);
});
