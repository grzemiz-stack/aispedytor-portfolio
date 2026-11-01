/**
 * matchOfferToDemand — the pure predicate that matches an offer to a demand.
 * One source of truth for both product paths (see demands.parity.spec.ts).
 */
import {
  matchOfferToDemand,
  MatchResult,
  SUPPORTED_CRITERIA,
} from '../../src/demands/match-offer-to-demand';

const demandBase = {
  preferredCountries: [] as string[],
  maxWeight: null as number | null,
  adrRequired: false,
  temperatureRequired: false,
};

const offerBase = {
  pickupCountry: 'PL' as string | null,
  deliveryCountry: 'DE',
  weightKg: 12000 as number | null,
  isAdr: false as boolean | null,
  isFrigo: false as boolean | null,
};

const match = (offer: Partial<typeof offerBase>, demand: Partial<typeof demandBase>): MatchResult =>
  matchOfferToDemand({ ...offerBase, ...offer }, { ...demandBase, ...demand });

const OK: MatchResult = { matches: true, unknownCriteria: [], failedCriteria: [] };

describe('matchOfferToDemand — result shape', () => {
  it('returns all three fields', () => {
    expect(match({}, {})).toEqual(OK);
  });

  it('matches is always derived from failedCriteria', () => {
    expect(match({ pickupCountry: 'ES' }, { preferredCountries: ['PL'] })).toEqual({
      matches: false,
      unknownCriteria: [],
      failedCriteria: ['pickupCountry'],
    });
  });

  it('collects ALL failed criteria, does not stop at the first', () => {
    const r = match(
      { pickupCountry: 'ES', weightKg: 30000, isAdr: false, isFrigo: false },
      { preferredCountries: ['PL'], maxWeight: 24, adrRequired: true, temperatureRequired: true },
    );
    expect(r.failedCriteria).toEqual(['pickupCountry', 'weight', 'adr', 'temperature']);
    expect(r.matches).toBe(false);
  });

  it('supports exactly four criteria', () => {
    expect(SUPPORTED_CRITERIA).toEqual(['pickupCountry', 'weight', 'adr', 'temperature']);
  });
});

describe('matchOfferToDemand — no threshold in the demand skips the criterion', () => {
  it('maxWeight = null skips the weight criterion', () => {
    expect(match({ weightKg: 99999 }, { maxWeight: null })).toEqual(OK);
  });

  it('maxWeight = undefined skips the weight criterion', () => {
    expect(matchOfferToDemand({ weightKg: 99999 }, {})).toEqual(OK);
  });

  it('an empty country list skips the country criterion', () => {
    expect(match({ pickupCountry: 'ES' }, { preferredCountries: [] })).toEqual(OK);
  });

  it('no country list skips the country criterion', () => {
    expect(matchOfferToDemand({ pickupCountry: 'ES' }, { preferredCountries: null })).toEqual(OK);
  });

  it('adrRequired = false skips the ADR criterion', () => {
    expect(match({ isAdr: false }, { adrRequired: false })).toEqual(OK);
  });

  it('temperatureRequired = false skips the temperature criterion', () => {
    expect(match({ isFrigo: false }, { temperatureRequired: false })).toEqual(OK);
  });

  it('an ignored criterion goes into neither list', () => {
    const r = match({ weightKg: null }, { maxWeight: null });
    expect(r.unknownCriteria).toEqual([]);
    expect(r.failedCriteria).toEqual([]);
  });
});

describe('matchOfferToDemand — a missing value in the offer does not reject, it is reported', () => {
  it('no weight, limit set', () => {
    expect(match({ weightKg: null }, { maxWeight: 24 })).toEqual({
      matches: true,
      unknownCriteria: ['weight'],
      failedCriteria: [],
    });
  });

  it('no pickup country, country list set', () => {
    expect(match({ pickupCountry: null }, { preferredCountries: ['PL'] })).toEqual({
      matches: true,
      unknownCriteria: ['pickupCountry'],
      failedCriteria: [],
    });
  });

  it('no ADR flag, ADR required', () => {
    expect(match({ isAdr: null }, { adrRequired: true })).toEqual({
      matches: true,
      unknownCriteria: ['adr'],
      failedCriteria: [],
    });
  });

  it('no reefer flag, reefer required', () => {
    expect(match({ isFrigo: null }, { temperatureRequired: true })).toEqual({
      matches: true,
      unknownCriteria: ['temperature'],
      failedCriteria: [],
    });
  });

  it('several missing values are listed in criteria order', () => {
    const r = match(
      { pickupCountry: null, weightKg: null, isAdr: null, isFrigo: null },
      { preferredCountries: ['PL'], maxWeight: 24, adrRequired: true, temperatureRequired: true },
    );
    expect(r.unknownCriteria).toEqual(['pickupCountry', 'weight', 'adr', 'temperature']);
    expect(r.matches).toBe(true);
  });

  it('one missing value does not hide a real rejection on another', () => {
    const r = match(
      { weightKg: null, pickupCountry: 'ES' },
      { maxWeight: 24, preferredCountries: ['PL'] },
    );
    expect(r).toEqual({
      matches: false,
      unknownCriteria: ['weight'],
      failedCriteria: ['pickupCountry'],
    });
  });

  it('a field absent from the object counts as a missing value', () => {
    expect(matchOfferToDemand({}, { maxWeight: 24 })).toEqual({
      matches: true,
      unknownCriteria: ['weight'],
      failedCriteria: [],
    });
  });
});

describe('matchOfferToDemand — zero and false are values, not missing data', () => {
  it('weight 0 kg is evaluated, not reported as unknown', () => {
    expect(match({ weightKg: 0 }, { maxWeight: 24 })).toEqual(OK);
  });

  it('isAdr = false is evaluated and rejects when ADR is required', () => {
    expect(match({ isAdr: false }, { adrRequired: true })).toEqual({
      matches: false,
      unknownCriteria: [],
      failedCriteria: ['adr'],
    });
  });

  it('isFrigo = false is evaluated and rejects when a reefer is required', () => {
    expect(match({ isFrigo: false }, { temperatureRequired: true })).toEqual({
      matches: false,
      unknownCriteria: [],
      failedCriteria: ['temperature'],
    });
  });

  it('maxWeight = 0 is a zero threshold, not a missing one', () => {
    // A truthiness test (`if (demand.maxWeight)`) would treat 0 as "no limit" and let
    // everything through. 0 t = 0 kg, so every offer with a positive weight is rejected.
    // Not reachable through the API — CreateDemandDto has @Min(0.1) on maxWeight.
    expect(match({ weightKg: 100 }, { maxWeight: 0 })).toEqual({
      matches: false,
      unknownCriteria: [],
      failedCriteria: ['weight'],
    });
    expect(match({ weightKg: 0 }, { maxWeight: 0 })).toEqual(OK);
  });
});

describe('matchOfferToDemand — pickup country criterion', () => {
  it('accepts a country on the list', () => {
    expect(match({ pickupCountry: 'CZ' }, { preferredCountries: ['PL', 'CZ'] })).toEqual(OK);
  });

  it('rejects a country not on the list', () => {
    expect(match({ pickupCountry: 'ES' }, { preferredCountries: ['PL', 'CZ'] }).failedCriteria).toEqual([
      'pickupCountry',
    ]);
  });
});

describe('matchOfferToDemand — weight criterion (tonnes in the demand, kilograms in the offer)', () => {
  it.each([
    [20000, 24, true],
    [24000, 24, true],
    [24001, 24, false],
    [44000, 44, true],
  ])('weight %p kg with a limit of %p t -> %p', (weightKg, maxWeight, expected) => {
    expect(match({ weightKg }, { maxWeight }).matches).toBe(expected);
  });

  it('accepts a fractional tonne limit', () => {
    expect(match({ weightKg: 3500 }, { maxWeight: 3.5 })).toEqual(OK);
  });
});

describe('matchOfferToDemand — known limits (current behaviour pinned)', () => {
  it('known limit: the country criterion looks only at the pickup country', () => {
    expect(match({ pickupCountry: 'PL', deliveryCountry: 'PT' }, { preferredCountries: ['PL'] }).matches).toBe(true);
    expect(match({ pickupCountry: 'PT', deliveryCountry: 'PL' }, { preferredCountries: ['PL'] }).matches).toBe(false);
  });

  it('known limit: the country comparison is case-sensitive', () => {
    expect(match({ pickupCountry: 'pl' }, { preferredCountries: ['PL'] }).failedCriteria).toEqual(['pickupCountry']);
  });

  it('known limit: ADR and reefer are one-sided (an ADR/reefer offer matches a demand that does not require it)', () => {
    expect(match({ isAdr: true }, { adrRequired: false })).toEqual(OK);
    expect(match({ isFrigo: true }, { temperatureRequired: false })).toEqual(OK);
  });

  it('not connected on purpose: nine other DispatcherDemand fields do not filter', () => {
    const restrictiveDemandFields = {
      minPricePerKm: 999,
      minMarginPct: 99,
      vehicleType: 'MEGA',
      trailerType: 'CURTAIN',
      minLoadingMeters: 13.6,
      neededBy: new Date('2020-01-01'),
      regions: ['Skandynawia'],
      preferredDirections: ['PL-NO'],
      maxPickupRadiusKm: 1,
    };
    expect(matchOfferToDemand({ ...offerBase }, restrictiveDemandFields)).toEqual(OK);
    // The predicate is ready for these criteria (the CRITERIA array), but only the
    // four criteria in SUPPORTED_CRITERIA are connected.
  });
});

describe('matchOfferToDemand — purity', () => {
  it('does not modify its input', () => {
    const offer = { ...offerBase };
    const demand = { ...demandBase, maxWeight: 24, preferredCountries: ['PL'] };
    const offerSnapshot = JSON.stringify(offer);
    const demandSnapshot = JSON.stringify(demand);

    matchOfferToDemand(offer, demand);

    expect(JSON.stringify(offer)).toBe(offerSnapshot);
    expect(JSON.stringify(demand)).toBe(demandSnapshot);
  });

  it('the same input gives the same result', () => {
    const offer = { weightKg: 18000 };
    const demand = { maxWeight: 24, preferredCountries: ['PL'] };
    expect(match(offer, demand)).toEqual(match(offer, demand));
  });

  it('returns fresh arrays on every call', () => {
    const a = match({ weightKg: null }, { maxWeight: 24 });
    const b = match({ weightKg: null }, { maxWeight: 24 });
    expect(a.unknownCriteria).not.toBe(b.unknownCriteria);
  });
});
