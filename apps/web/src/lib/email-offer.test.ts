/**
 * An offer from an e-mail without invented fields.
 *
 * The API refuses (400 EMAIL_OFFER_FIELDS_MISSING) when the e-mail does not
 * give the fields an offer requires — the screen says which ones.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { apiErrorText } from './api-error';
import { existingOfferFromError } from './email-offer';

const body = { statusCode: 400, code: 'EMAIL_OFFER_FIELDS_MISSING', params: { fields: 'pickupCity,pickupDate,currency' }, message: 'EMAIL_OFFER_FIELDS_MISSING' };

it('names the missing fields in Polish and English', () => {
  expect(apiErrorText(body, 'x')).toBe(
    'E-mail nie podaje: miasto załadunku, data załadunku, waluta ceny. Oferty nie utworzono — dodaj ją ręcznie z tymi danymi.',
  );
  expect(apiErrorText(body, 'x', 'en')).toBe(
    'The e-mail does not give: pickup city, pickup date, price currency. No offer was created — add it manually with these details.',
  );
});

it('the e-mail screen shows the API sentence, not a generic failure', () => {
  const src = readFileSync(resolve(__dirname, '..', 'app/(dashboard)/email/page.tsx'), 'utf8');
  const h = src.slice(src.indexOf('async function handleCreateOffer'), src.indexOf('async function handleSaveNotes'));
  expect(h).toMatch(/setOfferError\(apiErrorText\(err\?\.response\?\.data, /);
});

describe('second offer from the same e-mail — 409 EMAIL_OFFER_EXISTS', () => {
  const conflict = { statusCode: 409, code: 'EMAIL_OFFER_EXISTS', params: { offerId: 'off-1' }, message: 'EMAIL_OFFER_EXISTS' };

  it('gives the id of the existing offer for the link, and a sentence', () => {
    expect(existingOfferFromError(conflict)).toBe('off-1');
    expect(apiErrorText(conflict, 'x')).toBe('Z tego e-maila utworzono już ofertę — drugiej nie tworzymy.');
  });

  it('no link for other errors or without an id', () => {
    expect(existingOfferFromError(body)).toBeNull();
    expect(existingOfferFromError({ ...conflict, params: { offerId: '' } })).toBeNull();
    expect(existingOfferFromError(undefined)).toBeNull();
  });

  it('the e-mail screen links to the existing offer', () => {
    const src = readFileSync(resolve(__dirname, '..', 'app/(dashboard)/email/page.tsx'), 'utf8');
    expect(src).toMatch(/setExistingOfferId\(existingOfferFromError\(err\?\.response\?\.data\)\)/);
    expect(src).toMatch(/\{existingOfferId && \(\s*<Link href=\{`\/offers\/\$\{existingOfferId\}`\}/);
  });
});
