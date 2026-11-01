/**
 * 561/2006 scope (art. 2(1)): over 3.5 t always; from 1 July 2026 also over
 * 2.5 t in international transport or cabotage.
 */
import { LIGHT_VEHICLES_FROM, rulesApply } from '../../../src/fleet-planning/rules/applicability';

const before = LIGHT_VEHICLES_FROM - 1;
const from = LIGHT_VEHICLES_FROM;

it('the date is 1 July 2026 00:00 UTC', () => {
  expect(new Date(LIGHT_VEHICLES_FROM).toISOString()).toBe('2026-07-01T00:00:00.000Z');
});

it.each([
  ['40 t national', 40000, false, before, true],
  ['3.5 t national (not over 3.5 t)', 3500, false, from, false],
  ['3501 kg national', 3501, false, before, true],
  ['3 t international before 1 July 2026', 3000, true, before, false],
  ['3 t international from 1 July 2026', 3000, true, from, true],
  ['3 t national from 1 July 2026', 3000, false, from, false],
  ['2.5 t international (not over 2.5 t)', 2500, true, from, false],
  ['2501 kg international', 2501, true, from, true],
])('%s', (_name, permissibleMassKg, international, at, expected) => {
  expect(rulesApply({ permissibleMassKg, international, at })).toBe(expected);
});
