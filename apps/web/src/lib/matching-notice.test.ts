/**
 * A dead offer on the offer page: a bar above the match list, not on every
 * card.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cardWarnings, offerNotLiveNotice } from './matching-notice';
import { messageText } from './plan-messages';

const NOT_LIVE = { code: 'MATCH_OFFER_NOT_LIVE', params: { reason: 'PICKUP_PASSED' } };
const OTHER = { code: 'MATCH_DATA_UNKNOWN', params: { fields: 'weightKg' } };

it('the notice comes from the matches; none when no match carries the code', () => {
  expect(offerNotLiveNotice([{ warnings: [OTHER] }, { warnings: [OTHER, NOT_LIVE] }])).toEqual(NOT_LIVE);
  expect([offerNotLiveNotice([{ warnings: [OTHER] }]), offerNotLiveNotice(null), offerNotLiveNotice([])]).toEqual([null, null, null]);
});

it('a card keeps its other notes, without the code that is on the bar', () => {
  expect(cardWarnings([OTHER, NOT_LIVE])).toEqual([OTHER]);
  expect(cardWarnings(undefined)).toEqual([]);
});

it.each([
  ['PICKUP_PASSED', 'termin załadunku minął'],
  ['EXPIRED', 'oferta wygasła'],
  ['TOO_OLD', 'oferta jest starsza niż 7 dni'],
])('the sentence names the reason: %s', (reason, words) => {
  expect(messageText({ code: 'MATCH_OFFER_NOT_LIVE', params: { reason } })).toContain(words);
});

it('the offer page shows the bar above the list and filters the code out of the cards', () => {
  const page = readFileSync(resolve(__dirname, '..', 'app/(dashboard)/offers/[id]/page.tsx'), 'utf8');
  expect(page).toMatch(/\{offerNotLiveNotice\(vehicleMatches\) && \(/);
  expect(page).toMatch(/\.\.\.cardWarnings\(vm\.warnings\)/);
});
