/**
 * The offer edit screen (decisions §3a): the lock as in the API, the body only
 * from changes (cleared → null), the preview with `offerId`, API refusals shown
 * as sentences.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  editFormFrom, moneyAndDatesLocked, offerEditErrors, offerEditPayload, offerEditPreviewBody, type EditableOffer,
} from './offer-edit';
import { apiErrorText } from './api-error';

const read = (f: string) => readFileSync(resolve(__dirname, f), 'utf8');
const OFFER: EditableOffer = {
  status: 'NEW', pickupDate: '2030-03-10T00:00:00.000Z', expiresAt: null, price: '1000.00', currency: 'EUR',
  distanceKm: 280, tollCostEstimate: null, contractorId: 'k1', notes: null,
};

it.each([
  ['NEW', 'DISPATCHER', false], ['ASSIGNED', 'DISPATCHER', false], ['EXPIRED', 'DISPATCHER', false], ['REJECTED', 'DISPATCHER', false],
  ['ACCEPTED', 'DISPATCHER', true], ['IN_TRANSIT', 'DISPATCHER', true], ['COMPLETED', undefined, true],
  ['ACCEPTED', 'ADMIN', false], ['COMPLETED', 'ADMIN', false],
])('%s, role %s → money and dates locked: %s (as the API)', (status, role, locked) => {
  expect(moneyAndDatesLocked(status, role)).toBe(locked);
});

it('the form from the offer: the date part, numbers without trailing zeros, empty for none', () => {
  expect(editFormFrom(OFFER)).toEqual({
    pickupDate: '2030-03-10', expiresAt: '', price: '1000', currency: 'EUR', distanceKm: '280', tollCostEstimate: '', contractorId: 'k1', notes: '',
  });
});

describe('the PATCH body', () => {
  const initial = editFormFrom(OFFER);

  it('nothing changed → empty (nothing sent)', () => {
    expect(offerEditPayload(initial, initial, false)).toEqual({});
  });

  it('only the changed fields; cleared → null; numbers as numbers', () => {
    const body = offerEditPayload({ ...initial, price: '1200', distanceKm: '', contractorId: '', notes: 'rampa 3' }, initial, false);
    expect(body).toEqual({ price: 1200, distanceKm: null, contractorId: null, notes: 'rampa 3' });
  });

  it('the validity date is sent as an ISO moment; cleared → null', () => {
    const withExpiry = editFormFrom({ ...OFFER, expiresAt: '2030-03-08T12:00:00.000Z' });
    expect(offerEditPayload({ ...withExpiry, expiresAt: '' }, withExpiry, false)).toEqual({ expiresAt: null });
    const set = offerEditPayload({ ...initial, expiresAt: '2030-03-09T10:00' }, initial, false);
    expect(new Date(String(set.expiresAt)).getTime()).toBe(new Date('2030-03-09T10:00').getTime());
  });

  it('locked: money and dates are left out, notes and the contractor go', () => {
    const changed = { ...initial, price: '1200', currency: 'PLN', distanceKm: '300', tollCostEstimate: '50', pickupDate: '2030-03-11', expiresAt: '2030-03-09T10:00', contractorId: 'k2', notes: 'x' };
    expect(offerEditPayload(changed, initial, true)).toEqual({ contractorId: 'k2', notes: 'x' });
  });
});

it('the preview body carries offerId and the form values (cleared → null), so the API computes as the save', () => {
  expect(offerEditPreviewBody('o1', { ...editFormFrom(OFFER), price: '', tollCostEstimate: '80' }))
    .toEqual({ offerId: 'o1', price: null, currency: 'EUR', distanceKm: 280, tollCostEstimate: 80 });
});

it('the loading date is required', () => {
  expect(offerEditErrors({ ...editFormFrom(OFFER), pickupDate: '' })).toHaveProperty('pickupDate');
  expect(offerEditErrors(editFormFrom(OFFER))).toEqual({});
});

it('the API refusals read as sentences (fields named in Polish)', () => {
  expect(apiErrorText({ code: 'OFFER_FIELDS_ADMIN_ONLY', params: { fields: 'price, pickupDate' } }, 'x')).toMatch(/administrator: cena, data załadunku\./);
  expect(apiErrorText({ code: 'CONTRACTOR_BLACKLIST_ADMIN_ONLY' }, 'x')).toMatch(/tylko administrator/);
});

it('the page: PATCH with the changed fields, the preview with offerId, locked inputs disabled; the offer page links to it', () => {
  const page = read('../app/(dashboard)/offers/[id]/edit/page.tsx');
  expect(page).toMatch(/const body = offerEditPayload\(form, initial, locked\);/);
  expect(page).toMatch(/apiClient\.patch\(`\/offers\/\$\{id\}`, body\)/);
  expect(page).toMatch(/apiClient\.post\('\/offers\/economics-preview', offerEditPreviewBody\(id, form\)\)/);
  expect(page).toMatch(/const locked = moneyAndDatesLocked\(offer\.status, role\);/);
  for (const key of ['pickupDate', 'expiresAt', 'price', 'distanceKm', 'tollCostEstimate']) expect(page).toMatch(new RegExp(`input\\('${key}', '[a-z-]+', locked\\)`));
  expect(page).toMatch(/setError\(apiErrorText\(err\?\.response\?\.data, /);
  expect(read('../app/(dashboard)/offers/[id]/page.tsx')).toMatch(/href=\{`\/offers\/\$\{offer\.id\}\/edit`\}/);
});
