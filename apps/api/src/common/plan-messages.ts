/**
 * Messages for the dispatcher as STRUCTURE, not sentences.
 *
 * The server returns `{ code, params }`; the sentence is built by the front
 * end, from a dictionary, in the user's language.
 *
 * The reason is practical. A sentence glued together on the server costs
 * three things at once: it cannot be translated, it cannot be formatted for
 * the reader's locale, and every value pasted into it (an axle label from the
 * vehicle record, a number, a unit) reaches the user exactly as it is stored
 * in the database.
 *
 * Contract:
 *   - `code` says WHAT happened — this is a stable API,
 *   - `params` carries the numbers and identifiers the sentence needs.
 *
 * Every code must have a Polish and an English translation — a dictionary
 * test in the front end reads the list of codes directly from this file.
 */

export const PLAN_MESSAGE_CODES = [
  // ── Load plan ──────────────────────────────────────────────────────────
  /** Total length of the loads exceeds the cargo space. */
  'LOAD_PLAN_LENGTH_EXCEEDED',
  /** Total weight of the loads exceeds the payload. */
  'LOAD_PLAN_WEIGHT_EXCEEDED',
  /** Curb weight plus cargo exceeds the gross vehicle weight of the combination. */
  'GVW_EXCEEDED',

  // ── Part loads (LTL) ──────────────────────────────────────────────────
  /** Result computed from a straight line × a factor (`roadFactor`), not from a route. Info, once above the list. */
  'DETOUR_APPROXIMATE',
  /**
   * Offer without coordinates — not ranked, waiting for geocoding
   * (the `awaitingLocation` list). No detour is guessed for it.
   */
  'OFFER_AWAITING_LOCATION',

  // ── Offer ↔ vehicle compatibility (LTL) — reasons for rejection ──────────
  /** Pickup (`pickupDate`) before the day the vehicle is free (`availableFrom`). */
  'OFFER_PICKUP_BEFORE_VEHICLE_AVAILABLE',
  /** ADR offer, vehicle without ADR certification. */
  'OFFER_ADR_VEHICLE_NOT_CERTIFIED',
  // ── Vehicle ↔ offer matching — a vehicle that cannot take the load ──
  /** Reefer cargo; neither the vehicle nor its trailer is a reefer. */
  'MATCH_VEHICLE_NOT_REEFER',
  /** The known payload (`maxWeightKg`) is below the known cargo weight (`weightKg`). */
  'MATCH_VEHICLE_CAPACITY_EXCEEDED',
  /** Inspection, insurance or tachograph calibration not valid on the day of loading (no date: today). */
  'MATCH_VEHICLE_DOCUMENTS_EXPIRED',
  /** Matching: a score component cannot be computed — data missing in `fields` (e.g. weightKg,maxWeightKg,currentCountry,insuranceTo); 0 points for it, no block. */
  'MATCH_DATA_UNKNOWN',
  /** An offer opened directly is not live: `reason` = EXPIRED | TOO_OLD | PICKUP_PASSED. */
  'MATCH_OFFER_NOT_LIVE',
  /** Offer classes (`offerClasses`) outside the vehicle's classes (`vehicleClasses`). */
  'OFFER_ADR_CLASS_NOT_ALLOWED',
  /** Vehicle has ADR but no classes recorded; the offer gives classes (`offerClasses`). */
  'OFFER_ADR_CLASSES_UNKNOWN',
  /** The offer's ADR class cannot be read (`adrClass` — the text from the offer). */
  'OFFER_ADR_CLASS_UNRECOGNIZED',
  /** Temperature-controlled load (`temperatureMin/Max`), the vehicle is not a reefer. */
  'OFFER_REQUIRES_REEFER',

  // ── Compatibility — warnings on the card of a compatible offer ───────────
  /** ADR offer without a class — to be confirmed before accepting. */
  'OFFER_ADR_CLASS_NOT_GIVEN',
  /** Reefer without a temperature range in its record — unknown whether it holds `temperatureMin/Max`. */
  'OFFER_TEMPERATURE_UNVERIFIED',
  /** Pickup country (`pickupCountry`, may be absent) not in the zone map — the day is counted in `timeZone`. */
  'OFFER_PICKUP_TIMEZONE_ASSUMED',

  // ── Fleet: attaching semi-trailers and trailers (common/vehicle-category.ts) ─
  /** The record being attached (`childCategory`) is neither a semi-trailer nor a trailer. */
  'VEHICLE_ATTACH_NOT_TOWED',
  /** Wrong pair: `childCategory` under `parentCategory`; allowed under `allowedParents`. */
  'VEHICLE_ATTACH_WRONG_PARENT',
  /** The parent vehicle is not in this company. */
  'VEHICLE_ATTACH_PARENT_NOT_FOUND',
  /**
   * The vehicle's new category (`parentCategory`) does not fit an attached record
   * (`childPlate`, `childCategory`); that one may be attached only under `allowedParents`.
   */
  'VEHICLE_CATEGORY_BREAKS_ATTACHMENT',

  // ── Company: cost per km (docs/decisions.md §3) ──────────────────────────
  /**
   * Currency change (`fromCurrency` → `toCurrency`) while a cost is set
   * (`costPerKm`) without the cost in the same request — the amount would
   * change currency without being converted.
   */
  'COMPANY_CURRENCY_CHANGE_WITHOUT_COST',

  // ── User account (auth.service.ts changePassword) ───────────────────────
  /** The current password given for a password change is wrong. */
  'PASSWORD_CURRENT_INVALID',
  /** The new password is the same as the current one. */
  'PASSWORD_UNCHANGED',
  /** Registration: an account with this e-mail address already exists. 409. */
  'REGISTER_EMAIL_TAKEN',
  /** Registration: the tax ID of a company in PL is not valid (10 digits with the check digit). 400. */
  'REGISTER_TAX_ID_INVALID',
  /** 403: registration is off in this installation (`REGISTRATION_ENABLED`); the first company — the `company:create` script. */
  'REGISTRATION_DISABLED',
  /** Offer import, row `row` (from 0): field `field` is missing, has the wrong type or is outside the schema (`field` null = the row is not an object). The row is not saved. */
  'IMPORT_ROW_FIELD_INVALID',
  /** Offer import, row `row`: the date in `field` cannot be read (e.g. 32.13.2026). The row is not saved. */
  'IMPORT_ROW_DATE_INVALID',
  /** The amount in `field` is outside the column range (DECIMAL(10,2): 0 … 99,999,999.99) — an import row or an offer from an e-mail is not saved. */
  'OFFER_VALUE_OUT_OF_RANGE',
  // ── Offer cost (common/offer-cost.ts) ────────────────────────────────────
  /** A cost without a planner route — offer km × the company rate; an estimate. */
  'OFFER_COST_ESTIMATED',
  /** A cost without tolls (no toll quote and no manual toll) — a margin from it is an upper bound. */
  'OFFER_COST_WITHOUT_TOLLS',
  /** No distance (neither a route nor offer km) — there is no cost. */
  'OFFER_COST_NO_DISTANCE',
  /** The company has no cost per km (`costPerKm`) — there is no cost; an ADMIN sets it in the company settings. */
  'OFFER_COST_RATE_MISSING',
  /** Negotiation: too few offers on similar routes to compare the contractor with the market (`contractorOffers` / `minContractorOffers`, `marketOffers` / `minMarketOffers`) — no comparison. */
  'NEGOTIATION_SAMPLE_TOO_SMALL',
  /** Deactivating the last active ADMIN of the company — refused (409). */
  'LAST_ACTIVE_ADMIN',
  /** A concurrent change of the same data (serialization conflict) — retry the request (409). */
  'CONCURRENT_CHANGE_RETRY',

  // ── Offer from an e-mail (email-agent.service.ts createOfferFromEmail) ───
  /** The e-mail lacks fields the offer requires (`fields`, comma-separated) — no offer was created. */
  'EMAIL_OFFER_FIELDS_MISSING',
  /** An offer `offerId` was already created from this e-mail — a second one is not created. */
  'EMAIL_OFFER_EXISTS',

  // ── Exchange rates (common/fx.ts, docs/decisions.md §4) ──────────────────
  /** Amount converted from `from` to `to` at the static rate `rate` (not a live rate). */
  'FX_RATE_STATIC',
  /** No rate for the pair `from` → `to` — the amount is not converted. */
  'CURRENCY_CONVERSION_UNAVAILABLE',

  // ── Toll provider (src/tolls) ─────────────────────────────────────────────
  /** No TollProvider registered — toll is not computed, costs are incomplete. */
  'TOLL_PROVIDER_NOT_CONFIGURED',
  /** The registered TollProvider failed (`reason`) — nothing computed or saved. */
  'TOLL_PROVIDER_UNAVAILABLE',
  /** Sum/average without `count` offers in the currencies `from` (a list) — no rate to `to`. */
  'TOTAL_EXCLUDES_UNCONVERTED',

  // ── LTL ranking by profit (ltl-matching/offer-value.ts, docs/decisions.md §3) ─
  /** The company has no cost per km — ranking by revenue, not by profit. */
  'DETOUR_COST_UNKNOWN',
  /** Detour toll estimated from the per-km rate of the offer's route (`rateEurPerKm`) for class `axleClass`. */
  'DETOUR_TOLL_ESTIMATED',
  /**
   * Detour toll not included in the cost (`reason`): VEHICLE_AXLE_CLASS_UNKNOWN
   * or ROUTE_NOT_CALCULATED (provider registered, offer route not calculated).
   */
  'DETOUR_TOLL_NOT_INCLUDED',
  /** Negative profit: a loss of `loss` in `currency`. */
  'LOAD_DOES_NOT_COVER_DETOUR',
  /** Offer without a price — no amount can be computed, the offer goes to the end of the list. */
  'OFFER_PRICE_MISSING',
  /** Threshold price `amount` `currency` = the detour cost including toll. */
  'OFFER_THRESHOLD_PRICE',
  /**
   * Counterparty risk (common/counterparty-risk.ts): `criteria` — a comma-separated
   * list of BLACKLIST, PAYMENT, RELIABILITY.
   */
  'COUNTERPARTY_RISK',
  /**
   * An end of the search route could not be located (`places` — the form
   * entries that failed, separated by " · "). Response 422.
   */
  'ROUTE_GEOCODING_FAILED',
  /** Planner: an estimated route from the hub table (the routing service or geocoding failed) — for viewing, not saved with the offer. */
  'ROUTE_ESTIMATED',
  /** Planner: neither a route nor a hub estimate — 503, no guessed distance. */
  'ROUTE_UNAVAILABLE',
  /**
   * Front end, load plan: an offer without weight or dimensions does not enter
   * the plan (`missing` — comma-separated: weightKg, dimensions). No made-up 0 kg / 2.4 m.
   */
  'LOAD_PLAN_OFFER_INCOMPLETE',

  // ── References only within the company ──────────────────────────────────
  /** Offer assignment: the user is not in this company (or inactive). 404. */
  'OFFER_ASSIGNEE_NOT_FOUND',
  'OFFER_ASSIGN_VIA_ASSIGN',
  /** Offer from a contractor on the company blacklist: only an ADMIN may accept it (400); in LTL — the card is blocked. */
  'OFFER_CONTRACTOR_BLACKLISTED',
  /** Restoring (EXPIRED/REJECTED → NEW) a dead offer: `reason` = PICKUP_PASSED | EXPIRED | TOO_OLD. */
  'OFFER_STILL_DEAD',
  /** Offer: the contractor is not in this company. 400. */
  'OFFER_CONTRACTOR_NOT_FOUND',
  /** 403: only an ADMIN changes a contractor's blacklist flag (and a blacklisted contractor on an offer) (decisions §3b). */
  'CONTRACTOR_BLACKLIST_ADMIN_ONLY',
  /** 409: the contractor has offers (`offers` = how many) — deleting would clear the link and the blacklist block; deactivate instead. */
  'CONTRACTOR_HAS_OFFERS',
  /** 403: an accepted / in-transit / completed offer — money, dates and places (`fields`) are changed by an ADMIN only (decisions §3a). */
  'OFFER_FIELDS_ADMIN_ONLY',
  /** 400: offer fields an edit does not change (`field`: source | externalId — the origin and the import key) (decisions §3a). */
  'OFFER_FIELD_NOT_EDITABLE',
  /** Vehicle: the dispatcher is not in this company. 400. */
  'VEHICLE_DISPATCHER_NOT_FOUND',

  // ── Fleet planning (src/fleet-planning) — driver state ──────────────────
  /** A value missing from the driver status was taken as the worst case (`field`, `value`). */
  'DRIVER_STATE_ASSUMED',
  /** The driver status is older than 7 days (`asOf`); its counters may be out of date. */
  'DRIVER_STATUS_STALE',

  // ── Fleet planning — rules on a timeline (rules/tracker.ts) ─────────────
  /** Violation 561 art. 7: more than 4.5 h of driving without a 45-min break (or 15 + 30). */
  'BREAK_MISSING',
  /** Violation 561 art. 6(1): daily driving over `limitMinutes` (9 h, or 10 h at most twice a week). */
  'DAILY_DRIVING_EXCEEDED',
  /** Violation 561 art. 6(2): more than 56 h of driving in a fixed week. */
  'WEEKLY_DRIVING_EXCEEDED',
  /** Violation 561 art. 6(3): more than 90 h of driving in two consecutive weeks. */
  'FORTNIGHT_DRIVING_EXCEEDED',
  /** Violation 561 art. 8(2): the daily rest does not fit in the 24 h after the previous rest; it had to start by `at`. */
  'DAILY_REST_LATE',
  /** Violation 561 art. 8(4): more than three reduced daily rests between two weekly rests. */
  'REDUCED_DAILY_RESTS_EXCEEDED',
  /** Violation 561 art. 8(6): the weekly rest had to start by `at` (six 24-h periods after the previous one). */
  'WEEKLY_REST_LATE',
  /** Violation 561 art. 8(6): two reduced weekly rests in a row without the international exception. */
  'CONSECUTIVE_REDUCED_WEEKLY_RESTS',
  /** Notice: two consecutive reduced weekly rests abroad, allowed by art. 8(6) third subparagraph. */
  'WEEKLY_REST_EXCEPTION_APPLIED',
  /** Notice: the exception for two reduced rests abroad cannot be checked — the status has no list of recent weekly rests. */
  'WEEKLY_REST_EXCEPTION_UNVERIFIABLE',
  /** Violation 561 art. 8(7): the compensation for a reduced weekly rest was not taken by `at`. */
  'COMPENSATION_OVERDUE',
  /** Violation 561 art. 8(7): compensation attached to a rest shorter than 9 h. */
  'COMPENSATION_INVALID',
  /** Violation 561 art. 8(6): after two reduced rests abroad, the next weekly rest must be preceded by their compensation. */
  'COMPENSATION_NOT_BEFORE_WEEKLY_REST',
  /** Violation 561 art. 8(8): a regular weekly rest (or one over 45 h with compensation) planned in the cab. */
  'WEEKLY_REST_IN_CAB',
  /** Notice: a regular weekly rest (or over 45 h) away from home — accommodation outside the cab is a cost (`hours`). */
  'WEEKLY_REST_ACCOMMODATION_REQUIRED',
  /** Warning 561 art. 8(8a): the company must enable the driver to start a home rest by `at` (4 weeks, 3 after two reduced). */
  'HOME_RETURN_LATE',
  /** Notice: the home rest was due by `at`; the driver chose to stay away (status flag). */
  'HOME_RETURN_DECLINED',
  /** Violation 2002/15 art. 5 (`rule`): CONSECUTIVE — over 6 h of work without a break; OVER_6H — under 30 min of breaks; OVER_9H — under 45 min. */
  'WTD_BREAK_MISSING',

  // ── Fleet planning — planner (rules/plan-timeline.ts) ────────────────────
  /** A WORK or AVAILABILITY task (`taskIndex`) cannot be placed legally (too long for one duty or one work run); placed anyway at `at`. */
  'TASK_CANNOT_FIT_LEGALLY',

  // ── Fleet planning — drivers API (drivers.service.ts) ──────────────────
  /** 404: no such driver in the caller's company. */
  'DRIVER_NOT_FOUND',
  /** 404: assignment — no such vehicle in the caller's company. */
  'DRIVER_VEHICLE_NOT_FOUND',
  /** 422: assignment — the vehicle is a trailer or semi-trailer (`vehicleCategory`); a driver drives a power unit. */
  'DRIVER_VEHICLE_NOT_A_POWER_UNIT',
  /** 409: assignment — another driver (`driverId`, when known) already has this vehicle (single crew). */
  'DRIVER_VEHICLE_ALREADY_ASSIGNED',
  /** 400: the manual status is inconsistent in `field` (e.g. compensation without its deadline, shift counters without the end of the daily rest). */
  'DRIVER_STATUS_INVALID',
  /** 409: availability — no status has been entered for the driver yet. */
  'DRIVER_STATUS_MISSING',
  /** 409: availability — the provider's status lacks a required value (`field`, e.g. the compensation deadline). */
  'DRIVER_STATUS_INCOMPLETE',
  /** 502: availability — the driver activity provider failed for its source (`reason`, e.g. timeout). */
  'DRIVER_ACTIVITY_PROVIDER_FAILED',

  // ── Publishing on freight exchanges ──────────────────────────────────────
  /** Publish result: Timocom has no implementation in this installation (no adapter) — nothing was sent. */
  'TIMOCOM_NOT_IMPLEMENTED',
] as const;

export type PlanMessageCode = (typeof PLAN_MESSAGE_CODES)[number];

/** Values inserted into the sentence. No nesting — the front end only substitutes them. */
export type PlanMessageParams = Record<string, string | number | boolean>;

export interface PlanMessage {
  code: PlanMessageCode;
  params?: PlanMessageParams;
}

export const msg = (
  code: PlanMessageCode,
  params?: PlanMessageParams,
): PlanMessage => ({
  code,
  ...(params && Object.keys(params).length > 0 ? { params } : {}),
});

/**
 * The same message with the same values is shown once.
 *
 * Comparison is by the CONTENT of the structure, not by reference — otherwise
 * two separately created objects with identical content would pass as
 * different and the user would see the same sentence twice.
 */
export function dedupeMessages(messages: PlanMessage[]): PlanMessage[] {
  const seen = new Set<string>();
  const result: PlanMessage[] = [];
  for (const m of messages) {
    const key = JSON.stringify([m.code, m.params ?? null]);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(m);
  }
  return result;
}
