/**
 * Matching an offer to a dispatcher's demand — one source of truth.
 *
 * The function is pure: no I/O, no Prisma, no clock.
 * Both product paths use it:
 *   - auto-notification (DemandsService.checkNewOfferAgainstDemands)
 *   - manual search     (DemandsService.searchOffers)
 * so the same (offer, demand) pair always gives the same result.
 *
 * Each criterion is in one of three states:
 *   IGNORED   — the demand sets no threshold (threshold === null).
 *               The criterion goes into neither list.
 *   UNKNOWN   — there is a threshold, but the offer has no value (value === null).
 *               Does NOT reject the offer; goes into `unknownCriteria`, so the
 *               dispatcher knows the match rests on incomplete data.
 *   EVALUATED — threshold and value are both there; the criterion goes into
 *               `failedCriteria` or nowhere.
 *
 * Missing-data checks use `!= null`, never `if (value)` — zero and `false` are
 * meaningful values, not missing data (docs/decisions.md §2).
 */

/** Criterion name. A new criterion = a new entry here and in the CRITERIA array. */
export type MatchCriterionName = 'pickupCountry' | 'weight' | 'adr' | 'temperature';

export interface MatchResult {
  /** true when no evaluated criterion failed. Unknown criteria do not reject. */
  matches: boolean;
  /** Criteria with a threshold that could not be evaluated — the offer lacks the data. */
  unknownCriteria: MatchCriterionName[];
  /** Criteria evaluated as failed. A non-empty list means matches === false. */
  failedCriteria: MatchCriterionName[];
}

/**
 * Definition of one criterion.
 *
 * `threshold` returns null when the demand does not set this criterion.
 * `value` returns null when the offer does not carry the needed data.
 * `isSatisfied` receives only non-null values.
 */
interface CriterionDefinition<TThreshold, TValue> {
  name: MatchCriterionName;
  threshold: (demand: DemandLike) => TThreshold | null;
  value: (offer: OfferLike) => TValue | null;
  isSatisfied: (value: TValue, threshold: TThreshold) => boolean;
}

/** The minimal demand shape the predicate needs. */
export interface DemandLike {
  preferredCountries?: string[] | null;
  maxWeight?: number | null;
  adrRequired?: boolean | null;
  temperatureRequired?: boolean | null;
  [key: string]: unknown;
}

/** The minimal offer shape the predicate needs. */
export interface OfferLike {
  pickupCountry?: string | null;
  weightKg?: number | null;
  isAdr?: boolean | null;
  isFrigo?: boolean | null;
  [key: string]: unknown;
}

/** Kilograms per tonne — `maxWeight` is in tonnes, `weightKg` in kilograms. */
const KG_PER_TONNE = 1000;

/**
 * The full set of criteria in the product's scope.
 *
 * EXTENDING: a new criterion is one entry in this array plus a variant of
 * `MatchCriterionName`. The structure is ready for the other DispatcherDemand
 * fields (minPricePerKm, minMarginPct, vehicleType, trailerType,
 * minLoadingMeters, neededBy, regions, preferredDirections, maxPickupRadiusKm),
 * but NONE of them is connected here — deliberately out of scope
 * (docs/known-issues.md, "demands").
 */
/** The outcome of one criterion: not set, no data, satisfied, failed. */
type CriterionOutcome = 'unset' | 'unknown' | 'satisfied' | 'failed';

/** A criterion with its threshold and value types closed over (each has its own). */
interface Criterion {
  name: MatchCriterionName;
  evaluate: (offer: OfferLike, demand: DemandLike) => CriterionOutcome;
}

/**
 * Definition → criterion. The threshold and value types are checked inside
 * the definition, and the list of criteria needs no `any`.
 */
function criterion<TThreshold, TValue>(def: CriterionDefinition<TThreshold, TValue>): Criterion {
  return {
    name: def.name,
    evaluate: (offer, demand) => {
      const threshold = def.threshold(demand);
      if (threshold === null) return 'unset'; // criterion not set — skipped
      const value = def.value(offer);
      if (value === null) return 'unknown'; // missing data does not reject
      return def.isSatisfied(value, threshold) ? 'satisfied' : 'failed';
    },
  };
}

const CRITERIA: Criterion[] = [
  criterion({
    name: 'pickupCountry',
    threshold: (demand) => {
      const countries = demand.preferredCountries;
      // An empty list = the dispatcher did not narrow the countries, not "no country".
      return Array.isArray(countries) && countries.length > 0 ? countries : null;
    },
    value: (offer) => (offer.pickupCountry != null ? offer.pickupCountry : null),
    isSatisfied: (value: string, threshold: string[]) => threshold.includes(value),
  }),
  criterion({
    name: 'weight',
    threshold: (demand) => (demand.maxWeight != null ? demand.maxWeight * KG_PER_TONNE : null),
    value: (offer) => (offer.weightKg != null ? Number(offer.weightKg) : null),
    isSatisfied: (value: number, threshold: number) => value <= threshold,
  }),
  criterion({
    name: 'adr',
    threshold: (demand) => (demand.adrRequired === true ? true : null),
    value: (offer) => (offer.isAdr != null ? Boolean(offer.isAdr) : null),
    isSatisfied: (value: boolean) => value === true,
  }),
  criterion({
    name: 'temperature',
    threshold: (demand) => (demand.temperatureRequired === true ? true : null),
    value: (offer) => (offer.isFrigo != null ? Boolean(offer.isFrigo) : null),
    isSatisfied: (value: boolean) => value === true,
  }),
];

/**
 * Evaluates an offer against a demand.
 *
 * Always goes through every criterion — does not stop at the first failure —
 * so that `failedCriteria` and `unknownCriteria` are complete.
 */
export function matchOfferToDemand(offer: OfferLike, demand: DemandLike): MatchResult {
  const unknownCriteria: MatchCriterionName[] = [];
  const failedCriteria: MatchCriterionName[] = [];

  for (const c of CRITERIA) {
    const outcome = c.evaluate(offer, demand);
    if (outcome === 'unknown') unknownCriteria.push(c.name);
    else if (outcome === 'failed') failedCriteria.push(c.name);
  }

  return {
    matches: failedCriteria.length === 0,
    unknownCriteria,
    failedCriteria,
  };
}

/** Names of the criteria the predicate supports — for documentation and tests. */
export const SUPPORTED_CRITERIA: readonly MatchCriterionName[] = CRITERIA.map((c) => c.name);
