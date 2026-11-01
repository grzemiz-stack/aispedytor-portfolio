/**
 * Numbers in an e-mail are read whole.
 *
 * A match must not start in the middle of a number without a thousands
 * separator: "1200 €" must not give a price of 200, "3500 zł" not 500, and
 * "24000 kg" must give a weight. Such a price would go into an offer created
 * from the e-mail.
 */
import { EmailClassifierService } from '../../src/email-agent/email-classifier.service';

const c = new EmailClassifierService();
const run = (body: string) => c.classify('Zlecenie transportowe', body, 'a@b.example.com');

it.each([
  ['Stawka 1200 € za całość', 1200, 'EUR'],
  ['Płacimy 3500 zł', 3500, 'PLN'],
  ['Fracht: 1850 EUR', 1850, 'EUR'],
  ['Fracht: 2 850 EUR', 2850, 'EUR'],
  ['Cena 1.850,50 PLN', 1850.5, 'PLN'],
  ['Kwota 12500 PLN netto', 12500, 'PLN'],
  ['Cena 950 EUR', 950, 'EUR'],
])('price: %s → %d %s', (body, price, currency) => {
  const r = run(body);
  expect([r.extractedPrice, r.extractedCurrency]).toEqual([price, currency]);
});

it.each([
  ['Ładunek 24000 kg', 24000],
  ['Ładunek 24 000 kg', 24000],
  ['Waga 18.000 kg', 18000],
  ['24,5 t stali', 24500],
  ['Masa 1500 kg', 1500],
])('weight: %s → %d kg', (body, kg) => {
  expect(run(body).extractedWeight).toBe(kg);
});

it('never starts inside a number: "1,999 EUR" gives no price, not 999', () => {
  // An English thousands comma — the pattern does not know it. No price is better than 999.
  expect(run('Freight 1,999 EUR').extractedPrice).toBeUndefined();
});
