/**
 * "Przywróć (Nowa)" of a dead offer: the sentence for 400 OFFER_STILL_DEAD.
 * The loading date and the validity are changed on the "Edytuj ofertę" screen
 * (decisions §3a) — PICKUP_PASSED and EXPIRED point there, not to "only
 * through the API".
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { messageText } from './plan-messages';
import { apiErrorText } from './api-error';

const text = (reason: string, language: 'pl' | 'en' = 'pl') => messageText({ code: 'OFFER_STILL_DEAD', params: { reason } }, language);

it.each([
  ['PICKUP_PASSED', 'Termin załadunku minął — zmień datę załadunku („Edytuj ofertę” na stronie oferty) i przywróć ofertę; albo dodaj ją od nowa.'],
  ['EXPIRED', 'Ważność oferty minęła — zmień ważność („Edytuj ofertę” na stronie oferty) i przywróć ofertę; albo dodaj ją od nowa.'],
  ['TOO_OLD', 'Oferta starsza niż 7 dni — dodaj ją od nowa.'],
])('PL %s', (reason, sentence) => {
  expect(text(reason)).toBe(sentence);
});

it('EN names the reason too; a fixable reason points to "Edytuj ofertę", none says "only through the API"', () => {
  expect(text('PICKUP_PASSED', 'en')).toContain('loading date has passed');
  expect(text('TOO_OLD', 'en')).toBe('The offer is older than 7 days — add it again.');
  for (const r of ['PICKUP_PASSED', 'EXPIRED']) for (const l of ['pl', 'en'] as const) expect(text(r, l)).toContain('Edytuj ofertę');
  for (const r of ['PICKUP_PASSED', 'EXPIRED', 'TOO_OLD']) for (const l of ['pl', 'en'] as const) expect(text(r, l)).not.toMatch(/przez API|through the API/);
});

it('the screen the sentence points to exists: "Edytuj ofertę" on the offer page links to the edit page', () => {
  const page = readFileSync(resolve(__dirname, '../app/(dashboard)/offers/[id]/page.tsx'), 'utf8');
  expect(page).toMatch(/href=\{`\/offers\/\$\{offer\.id\}\/edit`\}[\s\S]{0,300}Edytuj ofertę/);
});

it('the 400 body from the API becomes the sentence on the screen (apiErrorText)', () => {
  expect(apiErrorText({ statusCode: 400, code: 'OFFER_STILL_DEAD', params: { reason: 'TOO_OLD' }, message: 'OFFER_STILL_DEAD' }, 'x'))
    .toBe('Oferta starsza niż 7 dni — dodaj ją od nowa.');
});
