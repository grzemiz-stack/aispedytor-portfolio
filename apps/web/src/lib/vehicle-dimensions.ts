/**
 * A vehicle dimension from a form field.
 *
 * An empty field → `null`: the API treats `null` as "clear" and a missing
 * field (`undefined`) as "no change", so an emptied field removes the saved
 * dimension.
 */export function dimensionValue(text: string): number | null {
  const trimmed = text.trim();
  return trimmed === '' ? null : parseFloat(trimmed);
}
