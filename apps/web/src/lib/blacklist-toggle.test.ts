/**
 * The blacklist switch: only an ADMIN changes it, as in the API.
 */
import { blacklistToggle } from './blacklist-toggle';

it.each([
  ['ADMIN', true],
  ['DISPATCHER', false],
  [undefined, false],
])('role %s → can change: %s', (role, can) => {
  expect(blacklistToggle(false, role).canChange).toBe(can);
});

it('the button sets the opposite value', () => {
  expect([blacklistToggle(false, 'ADMIN').next, blacklistToggle(true, 'ADMIN').next]).toEqual([true, false]);
  expect(blacklistToggle(true, 'ADMIN').label).toBe('Zdejmij z czarnej listy');
});
