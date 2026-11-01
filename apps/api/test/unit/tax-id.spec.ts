/**
 * Polish tax ID (NIP): 10 digits, check digit (weights 6,5,7,2,3,4,5,6,7, mod 11).
 */
import { normalizePolishTaxId } from '../../src/common/tax-id';

it.each([
  ['digits only', '1234563218', '1234563218'],
  ['with hyphens', '123-456-32-18', '1234563218'],
  ['with spaces', '123 456 32 18', '1234563218'],
  ['with the PL prefix', 'PL1234563218', '1234563218'],
  ['lower-case pl and surrounding spaces', ' pl5260250274 ', '5260250274'],
])('valid — %s', (_n, input, expected) => {
  expect(normalizePolishTaxId(input)).toBe(expected);
});

it.each([
  ['wrong check digit', '1234563219'],
  ['remainder 10 (never valid)', '1234567890'],
  ['9 digits', '123456321'],
  ['11 digits', '12345632181'],
  ['letters inside', '12345A3218'],
  ['the short "123"', '123'],
  ['empty', ''],
  ['another country’s VAT number', 'DE123456789'],
])('invalid — %s', (_n, input) => {
  expect(normalizePolishTaxId(input)).toBeNull();
});
