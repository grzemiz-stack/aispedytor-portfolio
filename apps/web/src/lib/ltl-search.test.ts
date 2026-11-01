import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { viewFromError, viewFromResponse } from './ltl-search';

const okResponse = {
  capacity: { freeMeters: 6.9 },
  matches: [{ offerId: 'a' }, { offerId: 'b' }],
  notices: [{ code: 'DETOUR_APPROXIMATE' }],
  incompatible: [{ offerId: 'x' }],
  awaitingLocation: [{ offerId: 'w' }],
  hiddenAwaitingLocation: 4,
  hiddenWithoutAmount: 3,
  unmeasurable: [],
};

describe('LTL search result on the screen', () => {
  it('a response becomes the whole view, error cleared', () => {
    expect(viewFromResponse(okResponse)).toEqual({
      capacity: { freeMeters: 6.9 },
      matches: [{ offerId: 'a' }, { offerId: 'b' }],
      notices: [{ code: 'DETOUR_APPROXIMATE' }],
      incompatible: [{ offerId: 'x' }],
      awaitingLocation: [{ offerId: 'w' }],
      hiddenAwaitingLocation: 4,
      hiddenWithoutAmount: 3,
      hiddenBlocked: 0,
      unmeasurable: [],
      unmeasurableTotal: 0,
      error: '',
    });
  });

  it('an error clears EVERY part of the previous result — no capacity, so no "Brak ofert…" (no offers) message either', () => {
    const view = viewFromError({ statusCode: 422, code: 'ROUTE_GEOCODING_FAILED', params: { places: 'Hamburgg' } });
    expect(view).toMatchObject({ capacity: null, matches: [], notices: [], incompatible: [], awaitingLocation: [], hiddenAwaitingLocation: 0, hiddenWithoutAmount: 0, unmeasurable: [], unmeasurableTotal: 0 });
    expect(view.error).toContain('Hamburgg');
  });

  it('an error with no body (network) still clears and says something', () => {
    expect(viewFromError(undefined)).toMatchObject({ capacity: null, matches: [], error: 'Błąd wyszukiwania' });
  });
});

describe('LTL screen applies the whole view on success and on error', () => {
  const PAGE = readFileSync(resolve(__dirname, '../app/(dashboard)/ltl-matching/page.tsx'), 'utf8');
  const handleSearch = PAGE.slice(PAGE.indexOf('async function handleSearch'), PAGE.indexOf('async function handleAccept'));

  it('success → showSearch(viewFromResponse(...)), error → showSearch(viewFromError(...))', () => {
    expect(handleSearch).toMatch(/showSearch\(viewFromResponse\(res\.data\)\)/);
    expect(handleSearch).toMatch(/catch[\s\S]*showSearch\(viewFromError\(err\.response\?\.data\)\)/);
  });

  it('showSearch sets every part of the result', () => {
    const show = PAGE.slice(PAGE.indexOf('function showSearch'), PAGE.indexOf('async function handleSearch'));
    for (const setter of ['setCapacity', 'setMatches', 'setNotices', 'setIncompatible', 'setAwaitingLocation', 'setHiddenAwaitingLocation', 'setHiddenWithoutAmount', 'setError']) {
      expect(show).toContain(`${setter}(view.`);
    }
  });

  it('offers awaiting location: a collapsed list with a count, reasons through the dictionary', () => {
    expect(PAGE).toMatch(/awaitingLocation\.length > 0 && \(\s*<details/);
    // The count in the header covers all waiting offers, including those hidden beyond the API limit.
    expect(PAGE).toContain('Czekają na lokalizację ({awaitingLocation.length + hiddenAwaitingLocation})');
    expect(PAGE).toMatch(/hiddenAwaitingLocation > 0 && \([\s\S]*?\+\{hiddenAwaitingLocation\} ukrytych/);
    expect(PAGE).toMatch(/awaitingLocation\.map\([\s\S]*?messageText\(r\)/);
  });

  it('the empty state needs a capacity from THIS search (cleared on error)', () => {
    expect(PAGE).toMatch(/!loading && capacity && matches\.length === 0/);
  });
});
