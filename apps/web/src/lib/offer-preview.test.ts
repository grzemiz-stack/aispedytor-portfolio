/**
 * The new-offer form: the margin preview from the API, not its own
 * computation, and the cost block on the offer page.
 *
 * Before: the form computed cost = fuel + toll and a 15 % / 5 % verdict
 * ("Dobra opłacalność"), while cost = company rate × km + toll was saved. The
 * offer page showed "Koszt paliwa", "Opłaty drogowe" and "Suma kosztów", which
 * was not the sum of those rows.
 * Now: `POST /offers/economics-preview` (the same function as saving), the
 * margin as on the list ("≤ X %" without a toll), the cost codes as sentences;
 * the fuel field removed from the form (the API still accepts it); the offer
 * page — the total labelled "rate × km + toll".
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { economicsPreviewBody, offerPayload } from './offer-form';

const read = (f: string) => readFileSync(resolve(__dirname, '..', 'app/(dashboard)', f), 'utf8');

describe('the preview request', () => {
  it('the same fields and conversions as the saved offer (price, currency, km, toll)', () => {
    const form = { price: '600', currency: 'EUR', distanceKm: '580', tollCostEstimate: '87' } as Record<string, string>;
    const saved = offerPayload(form, { palletExchange: false, isAdr: false, isFrigo: false });
    expect(economicsPreviewBody(form)).toEqual({ price: saved.price, currency: saved.currency, distanceKm: saved.distanceKm, tollCostEstimate: saved.tollCostEstimate });
  });

  it('no price → no request (nothing to preview)', () => {
    expect(economicsPreviewBody({ price: '', currency: 'EUR', distanceKm: '580', tollCostEstimate: '' })).toBeNull();
  });

  it('no toll typed in → no toll sent (the API answers with an upper bound)', () => {
    expect(economicsPreviewBody({ price: '1800', currency: 'EUR', distanceKm: '580', tollCostEstimate: '' })).toEqual({ price: 1800, currency: 'EUR', distanceKm: 580, tollCostEstimate: undefined });
  });
});

describe('the new offer form', () => {
  const page = read('offers/new/page.tsx');

  it('asks the API for the preview and shows the margin like the list (≤ for an upper bound) with the cost codes', () => {
    expect(page).toMatch(/apiClient\.post\('\/offers\/economics-preview', /);
    expect(page).toMatch(/marginText\(preview\)/);
    expect(page).toMatch(/messagesToText\(preview\.messages/);
  });

  it('computes no cost of its own: no fuel field, no fuel sum, no own verdict thresholds', () => {
    expect(page).not.toMatch(/fuelCostEstimate/);
    expect(page).not.toMatch(/fuel \+ toll/);
    expect(page).not.toMatch(/opłacalność \(>15%\)|opłacalność \(5–15%\)|opłacalność \(<5%\)/);
  });

  it('the saved body has no fuel field any more (the API still accepts it from other clients)', () => {
    const body = offerPayload({ price: '1', currency: 'EUR', fuelCostEstimate: '50' } as Record<string, string>, { palletExchange: false, isAdr: false, isFrigo: false });
    expect(body).not.toHaveProperty('fuelCostEstimate');
  });
});

describe('W13: the offer page cost block', () => {
  const page = read('offers/[id]/page.tsx');
  it('no fuel row; the total says what it is (rate × km + toll)', () => {
    expect(page).not.toMatch(/row\('Koszt paliwa'/);
    expect(page).toMatch(/Koszt \(stawka × km \+ myto\)/);
  });
});
