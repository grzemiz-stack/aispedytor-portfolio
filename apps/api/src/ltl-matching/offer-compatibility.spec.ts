import { calendarDate, pickupTimeZone } from '../common/country-timezone';
import {
  checkCompatibility,
  isDeadOffer,
  isReefer,
  parseAdrClasses,
  pickupDateLowerBound,
  requiresReefer,
} from './offer-compatibility';

const D = (iso: string) => new Date(iso);
const codes = (r: { code: string }[]) => r.map(m => m.code);

describe('calendarDate / pickupTimeZone', () => {
  it('the same instant is a different day in Warsaw and in London', () => {
    const t = D('2026-10-05T22:30:00Z');
    expect(calendarDate(t, 'Europe/Warsaw')).toBe('2026-10-06');
    expect(calendarDate(t, 'Europe/London')).toBe('2026-10-05');
  });

  it('pickup country first, company country as fallback, Warsaw last', () => {
    expect(pickupTimeZone('GB', 'PL')).toBe('Europe/London');
    expect(pickupTimeZone('gb ', 'PL')).toBe('Europe/London');
    expect(pickupTimeZone('XX', 'GB')).toBe('Europe/London');
    expect(pickupTimeZone(null, 'GB')).toBe('Europe/London');
    expect(pickupTimeZone('XX', 'YY')).toBe('Europe/Warsaw');
  });
});

describe('isDeadOffer — pickup date', () => {
  // 22:30 UTC: already 6.10 in Warsaw, still 5.10 in London.
  const now = D('2026-10-05T22:30:00Z');

  it('an offer from GB for "today" is judged in Europe/London — still alive', () => {
    expect(isDeadOffer({ pickupCountry: 'GB', pickupDate: D('2026-10-05T00:00:00Z') }, { now })).toBe(false);
  });

  it('the same date loading in PL is judged in Europe/Warsaw — already yesterday', () => {
    expect(isDeadOffer({ pickupCountry: 'PL', pickupDate: D('2026-10-05T00:00:00Z') }, { now })).toBe(true);
  });

  it('an import date (UTC midnight) for today is alive all day, also late evening', () => {
    const lateEvening = D('2026-10-05T21:30:00Z'); // 23:30 in Warsaw
    expect(isDeadOffer({ pickupCountry: 'PL', pickupDate: D('2026-10-05T00:00:00Z') }, { now: lateEvening })).toBe(false);
  });

  it('a form date (local midnight in Warsaw) for today is alive', () => {
    const noon = D('2026-10-05T10:00:00Z');
    expect(isDeadOffer({ pickupCountry: 'PL', pickupDate: D('2026-10-04T22:00:00Z') }, { now: noon })).toBe(false);
  });

  it('unknown pickup country falls back to the company country', () => {
    const offer = { pickupCountry: 'XX', pickupDate: D('2026-10-05T00:00:00Z') };
    expect(isDeadOffer(offer, { now, companyCountry: 'GB' })).toBe(false);
    expect(isDeadOffer(offer, { now, companyCountry: 'PL' })).toBe(true);
  });

  it('the query bound keeps a margin of two days', () => {
    expect(pickupDateLowerBound(now).toISOString()).toBe('2026-10-03T22:30:00.000Z');
  });
});

describe('isDeadOffer — expiry and age', () => {
  const now = D('2026-10-05T12:00:00Z');
  const alive = { pickupCountry: 'PL', pickupDate: D('2026-10-06T00:00:00Z') };

  it.each([
    ['expiresAt in the past', { expiresAt: D('2026-10-05T11:59:00Z') }, true],
    ['expiresAt exactly now', { expiresAt: now }, true],
    ['expiresAt in the future', { expiresAt: D('2026-10-05T12:01:00Z') }, false],
    ['no expiresAt', { expiresAt: null }, false],
    ['created 7 days minus a minute ago', { createdAt: D('2026-09-28T12:01:00Z') }, false],
    ['created 7 days plus a minute ago', { createdAt: D('2026-09-28T11:59:00Z') }, true],
  ])('%s → dead=%p', (_label, over, dead) => {
    expect(isDeadOffer({ ...alive, ...over }, { now })).toBe(dead);
  });
});

describe('parseAdrClasses', () => {
  it.each([
    ['3', ['3'], []],
    ['Klasa 3', ['3'], []],
    ['kl. 4.1', ['4.1'], []],
    ['4,1', ['4.1'], []],
    ['3, 8', ['3', '8'], []],
    ['3,8', ['3', '8'], []],
    ['3/8', ['3', '8'], []],
    ['3 i 8', ['3', '8'], []],
    ['1.4', ['1'], []],
    ['2.1', ['2'], []],
    ['ADR 9', ['9'], []],
  ])('%p → %p', (text, classes, unrecognized) => {
    expect(parseAdrClasses(text)).toEqual({ classes, unrecognized });
  });

  it.each(['4', '5', '6', '10', 'UN1203', 'benzyna', '1,3', '2,3'])('%p is not recognized', text => {
    expect(parseAdrClasses(text).unrecognized.length).toBeGreaterThan(0);
  });

  it('empty text gives nothing, not an error', () => {
    expect(parseAdrClasses('')).toEqual({ classes: [], unrecognized: [] });
    expect(parseAdrClasses(null)).toEqual({ classes: [], unrecognized: [] });
  });
});

describe('checkCompatibility — ADR', () => {
  const now = D('2026-10-05T12:00:00Z');
  const adrVehicle = { hasAdr: true, adrClasses: ['3', '8'] };
  const check = (offer: object, vehicle: object) => checkCompatibility(offer, vehicle, { now });

  it('non-ADR offer: nothing to check', () => {
    expect(check({ isAdr: false }, { hasAdr: false })).toEqual({ reasons: [], warnings: [] });
  });

  it('vehicle without hasAdr → rejected, whatever its class list says', () => {
    expect(codes(check({ isAdr: true, adrClass: '3' }, { hasAdr: false, adrClasses: ['3'] }).reasons))
      .toEqual(['OFFER_ADR_VEHICLE_NOT_CERTIFIED']);
  });

  it('a class given with isAdr=false still counts as ADR', () => {
    expect(codes(check({ isAdr: false, adrClass: '3' }, { hasAdr: false }).reasons))
      .toEqual(['OFFER_ADR_VEHICLE_NOT_CERTIFIED']);
  });

  it('"Klasa 3" matches the vehicle class "3"', () => {
    expect(check({ isAdr: true, adrClass: 'Klasa 3' }, adrVehicle)).toEqual({ reasons: [], warnings: [] });
  });

  it('"3, 9" on a 3+8 vehicle → rejected, both lists in the params', () => {
    expect(check({ isAdr: true, adrClass: '3, 9' }, adrVehicle).reasons).toEqual([
      { code: 'OFFER_ADR_CLASS_NOT_ALLOWED', params: { offerClasses: '3, 9', vehicleClasses: '3, 8' } },
    ]);
  });

  it('vehicle with ADR but no classes listed + offer with a class → rejected', () => {
    expect(check({ isAdr: true, adrClass: '3' }, { hasAdr: true, adrClasses: [] }).reasons).toEqual([
      { code: 'OFFER_ADR_CLASSES_UNKNOWN', params: { offerClasses: '3' } },
    ]);
  });

  it('vehicle classes that cannot be read grant nothing', () => {
    expect(codes(check({ isAdr: true, adrClass: '3' }, { hasAdr: true, adrClasses: ['???'] }).reasons))
      .toEqual(['OFFER_ADR_CLASSES_UNKNOWN']);
  });

  it('offer class that cannot be read → rejected, not waved through', () => {
    expect(check({ isAdr: true, adrClass: 'UN1203' }, adrVehicle).reasons).toEqual([
      { code: 'OFFER_ADR_CLASS_UNRECOGNIZED', params: { adrClass: 'UN1203' } },
    ]);
  });

  it('ADR offer without a class on an ADR vehicle → passes with a warning', () => {
    expect(check({ isAdr: true, adrClass: null }, adrVehicle)).toEqual({
      reasons: [],
      warnings: [{ code: 'OFFER_ADR_CLASS_NOT_GIVEN' }],
    });
  });
});

describe('checkCompatibility — reefer', () => {
  const now = D('2026-10-05T12:00:00Z');
  const check = (offer: object, vehicle: object) => checkCompatibility(offer, vehicle, { now });

  it.each([
    ['REEFER trailer type on the record', { trailerType: 'REEFER' }, true],
    ['REFRIGERATED vehicle type', { vehicleType: 'REFRIGERATED' }, true],
    ['reefer only on an attached trailer', { trailerType: null, trailers: [{ trailerType: 'REEFER' }] }, true],
    ['curtain', { trailerType: 'CURTAIN' }, false],
    ['no trailer type at all — missing data is not a reefer', { trailerType: null }, false],
  ])('isReefer: %s → %p', (_l, vehicle, expected) => {
    expect(isReefer(vehicle)).toBe(expected);
  });

  it('a temperature alone makes it a reefer load', () => {
    expect(requiresReefer({ isFrigo: false, temperatureMin: 2 })).toBe(true);
    expect(requiresReefer({ isFrigo: false })).toBe(false);
  });

  it('reefer load on a curtain → rejected, with the temperatures', () => {
    expect(check({ isFrigo: true, temperatureMin: -20, temperatureMax: -18 }, { trailerType: 'CURTAIN' }).reasons)
      .toEqual([{ code: 'OFFER_REQUIRES_REEFER', params: { temperatureMin: -20, temperatureMax: -18 } }]);
  });

  it('temperature 0 °C is a temperature, not a missing value', () => {
    expect(check({ temperatureMin: 0 }, { trailerType: 'CURTAIN' }).reasons)
      .toEqual([{ code: 'OFFER_REQUIRES_REEFER', params: { temperatureMin: 0 } }]);
  });

  it('on a reefer with a temperature given → passes, "temperature unverified"', () => {
    expect(check({ isFrigo: true, temperatureMin: -20 }, { trailerType: 'REEFER' })).toEqual({
      reasons: [],
      warnings: [{ code: 'OFFER_TEMPERATURE_UNVERIFIED', params: { temperatureMin: -20 } }],
    });
  });

  it('on a reefer without a temperature → passes, no warning', () => {
    expect(check({ isFrigo: true }, { trailerType: 'REEFER' })).toEqual({ reasons: [], warnings: [] });
  });
});

describe('checkCompatibility — vehicle availability', () => {
  const now = D('2026-10-05T12:00:00Z');
  const offer = { pickupCountry: 'PL', pickupDate: D('2026-10-07T00:00:00Z') };

  it('vehicle free only after the pickup day → rejected with both days', () => {
    expect(checkCompatibility(offer, { availableFrom: D('2026-10-08T06:00:00Z') }, { now }).reasons).toEqual([
      { code: 'OFFER_PICKUP_BEFORE_VEHICLE_AVAILABLE', params: { pickupDate: '2026-10-07', availableFrom: '2026-10-08' } },
    ]);
  });

  it('vehicle free on the pickup day itself → passes (the hour is unknown)', () => {
    expect(checkCompatibility(offer, { availableFrom: D('2026-10-07T15:00:00Z') }, { now }).reasons).toEqual([]);
  });

  it('no availableFrom → passes', () => {
    expect(checkCompatibility(offer, { availableFrom: null }, { now }).reasons).toEqual([]);
  });
});

describe('checkCompatibility — all reasons at once', () => {
  it('an ADR reefer load on a plain late vehicle lists every reason', () => {
    const r = checkCompatibility(
      { pickupCountry: 'PL', pickupDate: D('2026-10-07T00:00:00Z'), isAdr: true, adrClass: '3', isFrigo: true },
      { hasAdr: false, trailerType: 'CURTAIN', availableFrom: D('2026-10-09T00:00:00Z') },
      { now: D('2026-10-05T12:00:00Z') },
    );
    expect(codes(r.reasons)).toEqual([
      'OFFER_PICKUP_BEFORE_VEHICLE_AVAILABLE',
      'OFFER_ADR_VEHICLE_NOT_CERTIFIED',
      'OFFER_REQUIRES_REEFER',
    ]);
  });
});

describe('checkCompatibility — assumed time zone', () => {
  const now = D('2026-10-05T12:00:00Z');
  const pickupDate = D('2026-10-07T00:00:00Z');

  it('pickup country outside the map → warning with the country and the zone used (company country)', () => {
    expect(checkCompatibility({ pickupCountry: 'xx ', pickupDate }, {}, { now, companyCountry: 'GB' }).warnings)
      .toEqual([{ code: 'OFFER_PICKUP_TIMEZONE_ASSUMED', params: { timeZone: 'Europe/London', pickupCountry: 'XX' } }]);
  });

  it('no pickup country and no company country → Warsaw, said out loud', () => {
    expect(checkCompatibility({ pickupCountry: null, pickupDate }, {}, { now }).warnings)
      .toEqual([{ code: 'OFFER_PICKUP_TIMEZONE_ASSUMED', params: { timeZone: 'Europe/Warsaw' } }]);
  });

  it('a country from the map → no warning', () => {
    expect(checkCompatibility({ pickupCountry: 'GB', pickupDate }, {}, { now }).warnings).toEqual([]);
  });

  it('the warning does not make the offer incompatible', () => {
    expect(checkCompatibility({ pickupCountry: 'XX', pickupDate }, {}, { now }).reasons).toEqual([]);
  });
});
