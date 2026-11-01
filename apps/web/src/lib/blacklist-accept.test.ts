/**
 * The blacklist on the screens: the accept button. LTL, the offer list and
 * the offer page — not an ADMIN: disabled with OFFER_CONTRACTOR_BLACKLISTED;
 * an ADMIN: active with a warning.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { acceptBlock, BLACKLIST_ADMIN_WARNING } from './blacklist-accept';
import { messageText } from './plan-messages';
import { viewFromResponse } from './ltl-search';

const read = (f: string) => readFileSync(resolve(__dirname, '..', f), 'utf8');

it('not blacklisted → active, no note, for every role', () => {
  expect([acceptBlock(false, 'DISPATCHER'), acceptBlock(false, 'ADMIN')]).toEqual([{ disabled: false, note: null }, { disabled: false, note: null }]);
});

it('blacklisted, DISPATCHER (or no role) → disabled with the sentence of the API code', () => {
  const sentence = messageText({ code: 'OFFER_CONTRACTOR_BLACKLISTED' });
  expect(sentence).toMatch(/czarnej liście firmy — nie przyjmuj bez decyzji kierownika/);
  expect([acceptBlock(true, 'DISPATCHER'), acceptBlock(true, undefined)]).toEqual([{ disabled: true, note: sentence }, { disabled: true, note: sentence }]);
});

it('blacklisted, ADMIN → active with a warning that the log records it', () => {
  expect(acceptBlock(true, 'ADMIN')).toEqual({ disabled: false, note: BLACKLIST_ADMIN_WARNING });
  expect(BLACKLIST_ADMIN_WARNING).toMatch(/administrator.*logu/);
});

it('the LTL view keeps hiddenBlocked', () => {
  expect(viewFromResponse({ capacity: {}, matches: [], hiddenBlocked: 3 }).hiddenBlocked).toBe(3);
});

it.each([
  ['LTL', 'app/(dashboard)/ltl-matching/page.tsx', /disabled=\{acceptBlock\(m\.blockedBy\.length > 0, role\)\.disabled\}/],
  ['the offer list', 'app/(dashboard)/offers/page.tsx', /disabled=\{a\.status === 'ACCEPTED' && block\.disabled\}/],
  ['the offer page', 'app/(dashboard)/offers/[id]/page.tsx', /\(a\.status === 'ACCEPTED' && acceptBlock\(offer\.contractorBlacklisted === true, role\)\.disabled\)/],
])('%s: the accept button goes through acceptBlock with the logged-in role and shows the note', (_n, file, disabledRule) => {
  const src = read(file);
  expect(src).toMatch(disabledRule);
  expect(src).toMatch(/useAuthStore\(\(s\) => s\.user\?\.role\)/);
  expect(src).toMatch(/block\.note/);
});

it('LTL says how many blocked offers are hidden over the limit', () => {
  expect(read('app/(dashboard)/ltl-matching/page.tsx')).toMatch(/\+\{hiddenBlocked\} ukrytych ofert od kontrahentów z czarnej listy/);
});
