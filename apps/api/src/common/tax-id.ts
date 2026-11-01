/**
 * Polish tax ID (NIP): 10 digits, the last is a check digit — weights
 * 6,5,7,2,3,4,5,6,7 on the first nine, the remainder of division by 11
 * (10 = never valid). Separators (hyphens, spaces) and a "PL" prefix are
 * ignored.
 *
 * Returns the digits, or null when it is not a valid NIP.
 */
const WEIGHTS = [6, 5, 7, 2, 3, 4, 5, 6, 7];

export function normalizePolishTaxId(value: string): string | null {
  const trimmed = value.trim().toUpperCase().replace(/^PL/, '');
  if (!/^[0-9\s-]+$/.test(trimmed)) return null;
  const digits = trimmed.replace(/[\s-]/g, '');
  if (!/^[0-9]{10}$/.test(digits)) return null;
  const sum = WEIGHTS.reduce((acc, w, i) => acc + w * Number(digits[i]), 0);
  const check = sum % 11;
  return check !== 10 && check === Number(digits[9]) ? digits : null;
}
