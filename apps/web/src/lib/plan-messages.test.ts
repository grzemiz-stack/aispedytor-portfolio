import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  MESSAGES, messageText, messagesToText, type Language, type PlanMessage,
} from './plan-messages';

/**
 * The code list is read STRAIGHT from the API source, not copied here.
 *
 * A copy would silently drift at the first code added on the server. Read
 * this way, a missing translation fails the test exactly when it appears.
 */
function codesFromApi(): string[] {
  const path = resolve(__dirname, '../../../api/src/common/plan-messages.ts');
  const source = readFileSync(path, 'utf8');
  const block = source.match(/PLAN_MESSAGE_CODES = \[([\s\S]*?)\] as const/);
  if (!block) throw new Error(`PLAN_MESSAGE_CODES not found in ${path}`);
  return (block[1].match(/'[A-Z_0-9]+'/g) ?? []).map(m => m.slice(1, -1));
}

const LANGUAGES: Language[] = ['pl', 'en'];

describe('message dictionary', () => {
  const codes = codesFromApi();

  it('reads the codes from the API source at all', () => {
    expect(codes.length).toBeGreaterThan(0);
  });

  it.each(LANGUAGES)('%s: every code from the API has a translation', language => {
    expect(codes.filter(c => !MESSAGES[language][c])).toEqual([]);
  });

  it.each(LANGUAGES)('%s: no translation is left behind for a code the API dropped', language => {
    expect(Object.keys(MESSAGES[language]).filter(c => !codes.includes(c))).toEqual([]);
  });

  it.each(LANGUAGES)('%s: no sentence is empty', language => {
    for (const code of codes) {
      expect(messageText({ code }, language).trim().length).toBeGreaterThan(0);
    }
  });

  it('PL and EN are actually different — catches a forgotten translation', () => {
    const identical = codes.filter(c => messageText({ code: c }, 'pl') === messageText({ code: c }, 'en'));
    expect(identical).toEqual([]);
  });
});

describe('filling in the values', () => {
  it('puts the numbers into the sentence', () => {
    const text = messageText({
      code: 'LOAD_PLAN_WEIGHT_EXCEEDED',
      params: { usedKg: 26000, maxKg: 24000 },
    });
    expect(text).toContain('26 000 kg');
    expect(text).toContain('24 000 kg');
  });

  it('formats the same numbers the English way in English', () => {
    const text = messageText({
      code: 'LOAD_PLAN_WEIGHT_EXCEEDED',
      params: { usedKg: 26000, maxKg: 24000 },
    }, 'en');
    expect(text).toContain('26,000 kg');
  });

  it('breaks the gross weight down the way the warning promises', () => {
    const text = messageText({
      code: 'GVW_EXCEEDED',
      params: { grossKg: 40500, maxGvwKg: 40000, curbKg: 16500, cargoKg: 24000 },
    });
    expect(text).toContain('40,5 t');
    expect(text).toContain('40,0 t');
    expect(text).toContain('16,5 t');
    expect(text).toContain('24,0 t');
  });

  it('uses a dot for tonnes in English', () => {
    const text = messageText({
      code: 'GVW_EXCEEDED',
      params: { grossKg: 40500, maxGvwKg: 40000, curbKg: 16500, cargoKg: 24000 },
    }, 'en');
    expect(text).toContain('40.5 t');
  });

  it('an unknown code shows the code itself rather than nothing', () => {
    expect(messageText({ code: 'NO_SUCH_CODE' })).toBe('NO_SUCH_CODE');
  });

  it('an unknown language falls back to Polish instead of blanking the screen', () => {
    expect(messageText({ code: 'GVW_EXCEEDED', params: { grossKg: 40500 } }, 'de' as Language))
      .toBe(messageText({ code: 'GVW_EXCEEDED', params: { grossKg: 40500 } }, 'pl'));
  });
});

describe('rendering a list of warnings', () => {
  /**
   * These tests exist because of a specific regression, not for symmetry.
   *
   * The API returns objects. If someone puts them into JSX directly — `{w}`
   * instead of `{messageText(w)}` — React prints "[object Object]". Nothing
   * fails, nothing turns red, and the forwarder sees it on the screen.
   */
  const FROM_API: PlanMessage[] = [
    { code: 'LOAD_PLAN_WEIGHT_EXCEEDED', params: { usedKg: 26000, maxKg: 24000 } },
    { code: 'GVW_EXCEEDED', params: { grossKg: 40500, maxGvwKg: 40000, curbKg: 16500, cargoKg: 24000 } },
  ];

  it('shows what raw interpolation would produce — the hazard these tests guard', () => {
    // Proof that the hazard is real, not imagined.
    expect(String(FROM_API[0])).toBe('[object Object]');
  });

  it.each(['pl', 'en'] as const)('%s: renders every warning as a readable sentence', language => {
    const lines = messagesToText(FROM_API, language);

    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(line).not.toContain('[object Object]');
      expect(line.trim().length).toBeGreaterThan(10);
    }
  });

  it('PL and EN give different text for the same warnings', () => {
    expect(messagesToText(FROM_API, 'pl')).not.toEqual(messagesToText(FROM_API, 'en'));
  });

  it('an unknown code falls back to the code itself, not an empty line', () => {
    const lines = messagesToText([{ code: 'SOMETHING_NEW' }], 'pl');

    expect(lines).toEqual(['SOMETHING_NEW']);
  });

  it('an unknown code does not throw', () => {
    expect(() => messagesToText([{ code: 'SOMETHING_NEW' }], 'en')).not.toThrow();
  });

  it('a known code with missing params still renders without throwing', () => {
    // The server may one day stop sending some field; the screen must survive that.
    expect(() => messagesToText([{ code: 'GVW_EXCEEDED' }], 'pl')).not.toThrow();
    expect(messagesToText([{ code: 'GVW_EXCEEDED' }], 'pl')[0]).not.toContain('[object Object]');
  });

  it('an empty list gives an empty list', () => {
    expect(messagesToText([], 'pl')).toEqual([]);
  });
});

describe('LTL detour warnings', () => {
  it('approximate route names the factor with the decimal separator of the language', () => {
    const w = { code: 'DETOUR_APPROXIMATE', params: { roadFactor: 1.25 } };
    expect(messageText(w, 'pl')).toContain('× 1,25');
    expect(messageText(w, 'en')).toContain('× 1.25');
  });

  it('no coordinates: the offer waits for its location — no guessed kilometres', () => {
    const w = { code: 'OFFER_AWAITING_LOCATION' };
    expect(messageText(w, 'pl')).toContain('nie da się policzyć objazdu');
    expect(messageText(w, 'pl')).not.toMatch(/\d+ km/);
    expect(messageText(w, 'en')).toContain('the detour cannot be calculated');
  });
});

describe('LTL compatibility messages', () => {
  it('reefer requirement shows the range with a real minus sign and the language decimal', () => {
    const w = { code: 'OFFER_REQUIRES_REEFER', params: { temperatureMin: -20.5, temperatureMax: -18 } };
    expect(messageText(w, 'pl')).toContain('od −20,5 °C do −18 °C');
    expect(messageText(w, 'en')).toContain('from −20.5 °C to −18 °C');
  });

  it('reefer requirement without a temperature does not print empty brackets', () => {
    const text = messageText({ code: 'OFFER_REQUIRES_REEFER' }, 'pl');
    expect(text).not.toContain('()');
    expect(text).toContain('nie jest chłodnią');
  });

  it('temperature 0 °C is printed, not dropped', () => {
    expect(messageText({ code: 'OFFER_TEMPERATURE_UNVERIFIED', params: { temperatureMin: 0 } }, 'pl'))
      .toContain('od 0 °C');
  });

  it('ADR classes appear as sent by the API', () => {
    const w = { code: 'OFFER_ADR_CLASS_NOT_ALLOWED', params: { offerClasses: '3, 9', vehicleClasses: '3, 8' } };
    expect(messageText(w, 'pl')).toContain('(3, 9)');
    expect(messageText(w, 'pl')).toContain('(3, 8)');
  });

  it('vehicle availability shows both days formatted per language', () => {
    const w = { code: 'OFFER_PICKUP_BEFORE_VEHICLE_AVAILABLE', params: { pickupDate: '2026-10-07', availableFrom: '2026-10-08' } };
    expect(messageText(w, 'pl')).toContain('07.10.2026');
    expect(messageText(w, 'pl')).toContain('08.10.2026');
    expect(messageText(w, 'en')).toContain('07/10/2026');
  });
});

describe('assumed time zone warning', () => {
  it('names the country when there is one, and says there is none otherwise', () => {
    expect(messageText({ code: 'OFFER_PICKUP_TIMEZONE_ASSUMED', params: { pickupCountry: 'XX', timeZone: 'Europe/London' } }, 'pl'))
      .toContain('Nieznany kraj załadunku „XX"');
    expect(messageText({ code: 'OFFER_PICKUP_TIMEZONE_ASSUMED', params: { timeZone: 'Europe/Warsaw' } }, 'en'))
      .toContain('No loading country — the loading day is judged in Europe/Warsaw');
  });
});

describe('fleet attachment messages', () => {
  it('names categories by their labels, not codes', () => {
    const w = { code: 'VEHICLE_ATTACH_WRONG_PARENT', params: { childCategory: 'TRAILER', parentCategory: 'TRUCK', allowedParents: 'RIGID, VAN' } };
    expect(messageText(w, 'pl')).toBe(
      'Przyczepa nie może być podpięta pod: Ciągnik siodłowy. Dozwolone: Solówka, Bus / dostawczy.',
    );
    expect(messageText(w, 'en')).toContain('Allowed: Rigid truck, Van.');
  });
});

describe('parent category change message', () => {
  it('says which attached unit blocks the change and where it may go', () => {
    const w = {
      code: 'VEHICLE_CATEGORY_BREAKS_ATTACHMENT',
      params: { parentCategory: 'VAN', childCategory: 'SEMI_TRAILER', childPlate: 'PO 1N', allowedParents: 'TRUCK' },
    };
    expect(messageText(w, 'pl')).toBe(
      'Nie można zmienić kategorii na: Bus / dostawczy — podpięta naczepa PO 1N może być tylko pod: Ciągnik siodłowy. Najpierw ją odepnij.',
    );
  });
});

describe('LTL ranking by value — messages', () => {
  it('threshold price: whole units, thousands grouped per language', () => {
    const w = { code: 'OFFER_THRESHOLD_PRICE', params: { amount: 12546.09, currency: 'PLN' } };
    expect(messageText(w, 'pl')).toBe('Poniżej 12 546 PLN doładunek jest na minusie.');
    expect(messageText(w, 'en')).toBe('Below 12,546 PLN the extra load runs at a loss.');
  });

  it('loss and static rate', () => {
    expect(messageText({ code: 'LOAD_DOES_NOT_COVER_DETOUR', params: { loss: 1307.36, currency: 'PLN' } }, 'pl'))
      .toBe('Doładunek nie pokrywa kosztu nadłożenia — strata 1307 PLN.');
    expect(messageText({ code: 'FX_RATE_STATIC', params: { from: 'EUR', to: 'PLN', rate: 4.3478 } }, 'pl'))
      .toBe('Przeliczono z EUR na PLN kursem stałym 4,3478 (nie z NBP).');
  });

  it.each([
    [{ reason: 'VEHICLE_AXLE_CLASS_UNKNOWN' }, 'nie znamy klasy osi zestawu'],
    [{ reason: 'ROUTE_NOT_CALCULATED' }, 'trasa oferty nie była policzona w planerze'],
  ])('toll not included — one sentence per reason %p', (params, fragment) => {
    expect(messageText({ code: 'DETOUR_TOLL_NOT_INCLUDED', params }, 'pl')).toContain(fragment);
  });
});

describe('counterparty risk message', () => {
  it('lists every criterion that fired, in the user language', () => {
    const w = { code: 'COUNTERPARTY_RISK', params: { criteria: 'BLACKLIST,RELIABILITY' } };
    expect(messageText(w, 'pl')).toBe('Ryzyko kontrahenta: na czarnej liście, niska rzetelność.');
    expect(messageText(w, 'en')).toBe('Counterparty risk: blacklisted, low reliability.');
  });
});
