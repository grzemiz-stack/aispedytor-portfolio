/**
 * The regex e-mail classifier keeps the currency of the price.
 *
 * The price comes back with the currency matched next to it (EUR/€/PLN/zł);
 * createOfferFromEmail uses it when the LLM gave none, so an offer from an
 * e-mail never gets a hard-coded EUR.
 */
import { EmailClassifierService } from '../../src/email-agent/email-classifier.service';

const c = new EmailClassifierService();
const run = (body: string) => c.classify('Zlecenie transportowe', body, 'a@b.example.com');

it.each([
  ['Fracht: 2 850 EUR, załadunek jutro', 2850, 'EUR'],
  ['Stawka 1 200 € za całość', 1200, 'EUR'],
  ['Cena: 4 300 PLN netto', 4300, 'PLN'],
  ['Płacimy 3 500 zł', 3500, 'PLN'],
])('%s → %d %s', (body, price, currency) => {
  const r = run(body);
  expect([r.extractedPrice, r.extractedCurrency]).toEqual([price, currency]);
});

it('no price, no currency — 33 europalety is not euros', () => {
  const r = run('33 europalety, 24 t');
  expect([r.extractedPrice, r.extractedCurrency]).toEqual([undefined, undefined]);
});
