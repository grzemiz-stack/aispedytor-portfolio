import { apiErrorText } from './api-error';

describe('apiErrorText', () => {
  it('route not geocoded: a sentence naming the place, not the raw code', () => {
    const data = { statusCode: 422, code: 'ROUTE_GEOCODING_FAILED', params: { places: 'Hamburgg' }, message: 'ROUTE_GEOCODING_FAILED' };
    const text = apiErrorText(data, 'Błąd wyszukiwania');
    expect(text).toBe(
      'Nie udało się ustalić położenia: Hamburgg. Sprawdź pisownię (np. „Poznań, PL”) albo spróbuj ponownie za chwilę — to nie znaczy, że nie ma ofert.',
    );
    expect(text).not.toContain('ROUTE_GEOCODING_FAILED');
  });

  it('DTO validation: the sentences; plain message: as is; nothing: the fallback', () => {
    expect(apiErrorText({ message: ['Max objazd min. 10 km'] }, 'x')).toBe('Max objazd min. 10 km');
    expect(apiErrorText({ message: 'Kartoteka pojazdu X jest niekompletna' }, 'x')).toBe('Kartoteka pojazdu X jest niekompletna');
    expect(apiErrorText(undefined, 'Błąd wyszukiwania')).toBe('Błąd wyszukiwania');
  });

});
