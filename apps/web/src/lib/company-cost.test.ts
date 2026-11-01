import { apiErrorText, costFromApi, costPatch, parseCostPerKm } from './company-cost';

describe('cost per km form', () => {
  it('reads the API value (Decimal as text)', () => {
    expect(costFromApi({ costPerKm: '4.2', costCurrency: 'PLN' })).toEqual({ costPerKm: 4.2, costCurrency: 'PLN' });
    expect(costFromApi({ costPerKm: null, costCurrency: 'GBP' })).toEqual({ costPerKm: null, costCurrency: 'GBP' });
  });

  it.each([
    ['4,20', 4.2],
    ['4.20', 4.2],
    [' 1.1 ', 1.1],
    ['', null],
    ['   ', null],
    ['abc', undefined],
    ['4,2,0', undefined],
  ])('parses %p → %p', (text, expected) => {
    expect(parseCostPerKm(text)).toBe(expected);
  });

  it('sends only what changed — a currency change alone goes without the cost', () => {
    const current = { costPerKm: 4.2, costCurrency: 'PLN' };
    expect(costPatch(current, { costPerKm: 4.2, costCurrency: 'GBP' })).toEqual({ costCurrency: 'GBP' });
    expect(costPatch(current, { costPerKm: 1.1, costCurrency: 'GBP' })).toEqual({ costPerKm: 1.1, costCurrency: 'GBP' });
    expect(costPatch(current, { costPerKm: null, costCurrency: 'PLN' })).toEqual({ costPerKm: null });
    expect(costPatch(current, current)).toBeNull();
  });

  it('API errors: message codes through the dictionary, DTO errors as sentences', () => {
    expect(apiErrorText({
      statusCode: 400,
      code: 'COMPANY_CURRENCY_CHANGE_WITHOUT_COST',
      params: { costPerKm: 4.2, fromCurrency: 'PLN', toCurrency: 'GBP' },
      message: 'COMPANY_CURRENCY_CHANGE_WITHOUT_COST',
    })).toBe('Koszt kilometra 4,2 PLN jest w starej walucie. Zmieniając walutę na GBP, podaj też koszt kilometra w GBP.');
    expect(apiErrorText({ statusCode: 400, message: ['Koszt kilometra musi być większy od zera'] }))
      .toBe('Koszt kilometra musi być większy od zera');
    expect(apiErrorText(undefined)).toBe('Nie udało się zapisać kosztu kilometra.');
  });
});
