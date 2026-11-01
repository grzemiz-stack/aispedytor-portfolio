/**
 * The route from an e-mail — the rule-based classifier.
 *
 * The city used to be the text after a label up to the first comma or
 * parenthesis, the country only ", CC": "Poznań 60-001 (PL)" gave the city
 * "Poznań 60-001" and no country (offer from the e-mail → 400), "Polska,
 * Poznań" the city "Polska". The country name was looked up in dictionary
 * order, not text order, and always as the pickup country. Now the text after
 * a label is taken apart into a country and a city; a country never becomes
 * the city.
 */
import { EmailClassifierService } from '../../src/email-agent/email-classifier.service';

const classifier = new EmailClassifierService();
const route = (body: string, subject = 'Zlecenie transportowe') => {
  const r = classifier.classify(subject, body, 'spedycja@firma.example.com');
  return [r.extractedPickupCity, r.extractedPickupCountry, r.extractedDeliveryCity, r.extractedDeliveryCountry];
};

describe('labels załadunek / rozładunek', () => {
  it.each([
    ['"City, CC" (as before)', 'Załadunek: Poznań, PL\nRozładunek: Berlin, DE'],
    ['"City CODE (CC)" on one line', 'załadunek Poznań 60-001 (PL), rozładunek Berlin 10115 (DE), 22 t, cena 1200 EUR'],
    ['"Country, City"', 'Załadunek: Polska, Poznań; Rozładunek: Niemcy, Berlin'],
    ['"City, Country"', 'Załadunek: Poznań, Polska\nRozładunek: Berlin, Niemcy'],
    ['a country prefix on the postal code', 'Loading: PL-60-001 Poznań\nUnloading: DE-10115 Berlin'],
    ['postal code before the city, country in parentheses', 'Załadunek: 60-001 Poznań (PL)\nRozładunek: 10115 Berlin (DE)'],
    ['country name in parentheses', 'Załadunek: Poznań (Polska)\nRozładunek: Berlin (Niemcy)'],
    ['lower-case country code in parentheses', 'Załadunek: Poznań (pl)\nRozładunek: Berlin (de)'],
    ['a date and other data after the place', 'Załadunek: Poznań, PL, 12.10.2026\nRozładunek: Berlin, DE, 14.10.2026'],
  ])('%s → Poznań PL / Berlin DE', (_n, body) => {
    expect(route(body)).toEqual(['Poznań', 'PL', 'Berlin', 'DE']);
  });

  it('a city of several words', () => {
    expect(route('Załadunek: Gorzów Wielkopolski 66-400 (PL)\nRozładunek: Frankfurt nad Odrą, DE')).toEqual(['Gorzów Wielkopolski', 'PL', 'Frankfurt nad Odrą', 'DE']);
  });

  it('a Dutch postal code "1012 AB" does not stay in the city name', () => {
    expect(route('Załadunek: Poznań, PL\nRozładunek: Amsterdam 1012 AB, NL')).toEqual(['Poznań', 'PL', 'Amsterdam', 'NL']);
  });

  it('a country only: no city, the country set — a country is never the city', () => {
    expect(route('Załadunek: Polska\nRozładunek: Niemcy')).toEqual([undefined, 'PL', undefined, 'DE']);
  });

  it('an unknown country code: the city stays, no country (no guessing)', () => {
    expect(route('Załadunek: Poznań (XX)\nRozładunek: Berlin, DE')).toEqual(['Poznań', undefined, 'Berlin', 'DE']);
  });

  it('the delivery country does not move to the pickup when the pickup has none', () => {
    expect(route('Załadunek: Poznań\nRozładunek: Niemcy, Berlin')).toEqual(['Poznań', undefined, 'Berlin', 'DE']);
  });

  it('an "Unloading" label alone is not read as "loading"', () => {
    expect(route('Unloading: Berlin, DE')).toEqual([undefined, undefined, 'Berlin', 'DE']);
  });
});

describe('without labels', () => {
  it('"z Polski do Niemiec": countries, not the cities "Polski"/"Niemiec"', () => {
    expect(route('Mamy transport z Polski do Niemiec, 22 t.')).toEqual([undefined, 'PL', undefined, 'DE']);
  });

  it('"from Poland to Germany": countries, not cities', () => {
    expect(route('Transport from Poland to Germany, 22 t.', 'Freight')).toEqual([undefined, 'PL', undefined, 'DE']);
  });

  it('"z Poznania do Berlina": cities as before (inflected form)', () => {
    expect(route('Ładunek z Poznania do Berlina, 22 t.')).toEqual(['Poznania', undefined, 'Berlina', undefined]);
  });

  it('a country name in the text: the first one → the pickup country; the delivery country is not guessed', () => {
    expect(route('Ładunek: Francja, potem Niemcy. 22 t.', 'Transport')[1]).toBe('FR');
    expect(route('Transport, ładunek 22 t — Niemcy, Polska')).toEqual([undefined, 'DE', undefined, undefined]);
  });

  it('an arrow between codes "PL → NL"', () => {
    expect(route('Trasa PL → NL, 22 t')).toEqual([undefined, 'PL', undefined, 'NL']);
  });
});
