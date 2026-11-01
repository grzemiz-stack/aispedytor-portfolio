/**
 * The blacklist switch on the contractor page (decisions §3b).
 *
 * The same rule as the API (`PATCH /contractors/:id`, `isBlacklisted`): only
 * an ADMIN changes it (there is no other manager role); the others see the
 * state, without the button. The change is logged by the API.
 */
export function blacklistToggle(
  isBlacklisted: boolean,
  role: string | null | undefined,
): { canChange: boolean; label: string; next: boolean; confirm: string } {
  return {
    canChange: role === 'ADMIN',
    label: isBlacklisted ? 'Zdejmij z czarnej listy' : 'Dodaj do czarnej listy',
    next: !isBlacklisted,
    confirm: isBlacklisted
      ? 'Zdjąć kontrahenta z czarnej listy? Jego oferty będzie mógł przyjąć każdy.'
      : 'Dodać kontrahenta do czarnej listy? Jego oferty przyjmie tylko administrator.',
  };
}
