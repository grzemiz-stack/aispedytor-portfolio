/**
 * ADR classes in the vehicle form (decisions §7): the same list as the API,
 * sent the way matching reads them; cleared in edit → null.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ADR_CLASSES, otherAdrEntries, toggleAdrClass } from './adr-classes';
import { vehiclePayload } from './vehicle-payload';

const read = (f: string) => readFileSync(resolve(__dirname, f), 'utf8');

it('the class list equals the API source (common/adr.ts)', () => {
  const m = read('../../../api/src/common/adr.ts').match(/export const ADR_CLASSES = \[([^\]]*)\]/);
  if (!m) throw new Error('ADR_CLASSES not found in the API source');
  expect([...ADR_CLASSES]).toEqual((m[1].match(/'([\d.]+)'/g) ?? []).map((s) => s.slice(1, -1)));
});

it('ticking keeps the list order; unticking removes; entries from outside the list stay', () => {
  expect(toggleAdrClass(['8'], '3', true)).toEqual(['3', '8']);
  expect(toggleAdrClass(['3', '8'], '3', false)).toEqual(['8']);
  expect(toggleAdrClass(['Klasa 3'], '8', true)).toEqual(['8', 'Klasa 3']);
  expect(otherAdrEntries(['3', 'Klasa 3'])).toEqual(['Klasa 3']);
});

describe('the body', () => {
  const FORM = { plateNumber: 'PO 1', vehicleType: 'TRUCK', hasAdr: true, lengthM: '', heightM: '', widthM: '' };

  it.each([
    ['edit, classes chosen', 'edit', ['3', '8'], ['3', '8']],
    ['edit, cleared → null (the API stores an empty list)', 'edit', [], null],
    ['new, classes chosen', 'new', ['2'], ['2']],
    ['new, none → left out', 'new', [], undefined],
  ] as const)('%s', (_n, mode, classes, sent) => {
    expect(vehiclePayload({ ...FORM, adrClasses: [...classes] }, mode).adrClasses).toEqual(sent);
  });
});

it('the edit page loads the saved classes into the form, the form shows them when ADR is ticked', () => {
  expect(read('../app/(dashboard)/fleet/[id]/edit/page.tsx')).toMatch(/adrClasses: Array\.isArray\(v\.adrClasses\) \? v\.adrClasses : \[\]/);
  const form = read('../app/(dashboard)/fleet/_components/vehicle-form.tsx');
  expect(form).toMatch(/\{form\.hasAdr && \(/);
  expect(form).toMatch(/set\('adrClasses', toggleAdrClass\(form\.adrClasses, c, e\.target\.checked\)\)/);
});
