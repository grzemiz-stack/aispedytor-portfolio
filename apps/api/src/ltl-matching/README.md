# ltl-matching — part loads along a vehicle's route

Finds offers that fit the free space of a vehicle already on a trip, ranks
them by what they are worth to the company, and checks a load plan
(length, capacity, gross weight).

## Files

| File | What it does |
|---|---|
| `ltl-matching.service.ts` | Search (`findMatchingOffers`), capacity, load plan and its ordering. |
| `offer-value.ts` | Value of one offer: profit or revenue in the company's currency, detour toll, ranking order (`compareByValue`). Pure functions. |
| `offer-compatibility.ts` | Dead offers and offer ↔ vehicle compatibility (ADR, reefer, availability, pickup time zone). Pure functions. |
| `ltl-matching.controller.ts` | HTTP routes, all behind login (`JwtAuthGuard`), always scoped to the caller's company. |
| `dto/` | Request bodies, validated by the global `ValidationPipe`. |

## Endpoints

| Route | Body / query | Returns |
|---|---|---|
| `POST /api/ltl/search` | `LtlSearchDto`: `vehicleId`, `currentLoadMeters` (0–16), `currentLoadWeight` in tonnes (0–44), `routeFrom`, `routeTo` (city names), optional `maxDetourKm` (10–500, default 100) | `capacity`, `matches` (ranked), `incompatible`, `unmeasurable` (at most 20), `unmeasurableTotal`, `awaitingLocation`, `notices`, `hiddenWithoutAmount`, `hiddenBlocked`, `hiddenAwaitingLocation` |
| `GET /api/ltl/capacity/:vehicleId` | `loadMeters`, `loadWeight` (t) | Free metres, kilograms, pallets and utilisation |
| `POST /api/ltl/load-plan` | `CreateLoadPlanDto`: `vehicleId`, `loads[]` (`offerId`, `weight` kg, `meters`, cities, optional `position`) | Positions with cumulative weight/metres, warnings, `isValid` |
| `POST /api/ltl/load-plan/simulate` | as above | the same as `load-plan` |
| `POST /api/ltl/load-plan/optimize` | as above | the plan with loads reordered (heaviest towards the middle) |

Errors: `404` unknown vehicle; `422 IncompleteVehicleRecord` when the vehicle
record lacks `maxWeightKg`, `maxLoadingMeters`, `grossVehicleWeightKg` or
`curbWeightKg` (the response names the missing fields — nothing is guessed);
`422 ROUTE_GEOCODING_FAILED { places }` when a route end cannot be geocoded.

## How the search works

1. **Capacity** of the vehicle minus what is already loaded.
2. **Dead offers drop out** — pickup day passed (in the pickup country's time
   zone), past `expiresAt`, or older than 7 days. Already in the query, before
   the 200-offer limit.
3. **Incompatible offers are listed with reasons** (`incompatible`): ADR
   (`common/adr.ts`), reefer (`common/reefer.ts`), vehicle available only after
   the pickup day. All reasons at once.
4. **Missing weight or dimensions** → `unmeasurable`: at most 20 offers with the
   nearest loading (the same day — by id), each with the route, the loading
   date and the missing fields (`weightKg`, `dimensions`); `unmeasurableTotal`
   is the full number. The screen shows a collapsed section with that number,
   the 20 with a link to each offer, and "i jeszcze N" (and N more). Expired
   offers never get here — they are dropped earlier as dead offers.
   Never treated as 0 kg or a default length; `0` is a value.
5. **Too heavy or too long** for the free space → left out.
6. **No coordinates** → `awaitingLocation` (`OFFER_AWAITING_LOCATION`): not
   ranked, no guessed detour. Earliest pickup first, at most 10, the rest
   counted.
7. **Detour** = (start → pickup → delivery → end) − (start → end), straight
   line × 1.25 (`ROAD_FACTOR`); offers above `maxDetourKm` are left out. The
   result says once that distances are approximate (`DETOUR_APPROXIMATE`).
8. **Value** (`offer-value.ts`) in the company's currency (`Company.costCurrency`):
   - with `Company.costPerKm`: **profit** = price − detour km × costPerKm −
     detour toll;
   - without it: **revenue** = price (`DETOUR_COST_UNKNOWN`).
   Prices are converted only through `common/fx.ts` (`FX_RATE_STATIC`); a
   currency without a rate gives no amount.
9. **Detour toll** = detour km × the EUR/km rate of the offer's own route, from
   a `route_calculations` row computed by a toll provider for the axle class of
   this combination. Otherwise it is not included and the code says why:
   `TOLL_PROVIDER_NOT_CONFIGURED` (no provider; also once in `notices`),
   `DETOUR_TOLL_NOT_INCLUDED { reason: ROUTE_NOT_CALCULATED | VEHICLE_AXLE_CLASS_UNKNOWN }`.
10. **Order**: offers with an amount by amount (exact, unrounded), ties → fewer
    detour km, then id; at most 20. Then offers without an amount (no price or
    rate) by detour km, then id; at most 10, the rest counted in
    `hiddenWithoutAmount`. Last, offers from a contractor on this company's
    blacklist: outside the ranking, each with `blockedBy`
    `[OFFER_CONTRACTOR_BLACKLISTED]`, at most 10 of their own (they take no
    place from the other lists), the rest counted in `hiddenBlocked`. The
    screen disables "Przyjmij" (accept) on them for a non-ADMIN and warns an
    ADMIN (the API refuses the acceptance the same way).

`fitScore` (0–100: metres, weight, detour, contractor rating) and
`counterpartyRisk` (`COUNTERPARTY_RISK`, `common/counterparty-risk.ts` —
payment and reliability; the blacklist is carried by `blockedBy`, not
repeated here) are shown on the card; neither changes the order.

## Message codes

Returned as `{ code, params }`; the web app turns them into text
(`apps/web/src/lib/plan-messages.ts`).

- Result: `DETOUR_APPROXIMATE`, `TOLL_PROVIDER_NOT_CONFIGURED`,
  `ROUTE_GEOCODING_FAILED`.
- Value: `OFFER_PRICE_MISSING`, `OFFER_THRESHOLD_PRICE`, `DETOUR_COST_UNKNOWN`,
  `LOAD_DOES_NOT_COVER_DETOUR`, `DETOUR_TOLL_ESTIMATED`,
  `DETOUR_TOLL_NOT_INCLUDED`, `FX_RATE_STATIC`,
  `CURRENCY_CONVERSION_UNAVAILABLE`, `COUNTERPARTY_RISK`,
  `OFFER_CONTRACTOR_BLACKLISTED` (in `blockedBy`).
- Compatibility: `OFFER_ADR_VEHICLE_NOT_CERTIFIED`,
  `OFFER_ADR_CLASS_NOT_ALLOWED`, `OFFER_ADR_CLASS_NOT_GIVEN`,
  `OFFER_ADR_CLASS_UNRECOGNIZED`, `OFFER_ADR_CLASSES_UNKNOWN`,
  `OFFER_REQUIRES_REEFER`, `OFFER_TEMPERATURE_UNVERIFIED`,
  `OFFER_PICKUP_BEFORE_VEHICLE_AVAILABLE`, `OFFER_PICKUP_TIMEZONE_ASSUMED`,
  `OFFER_AWAITING_LOCATION`.
- Load plan: `LOAD_PLAN_LENGTH_EXCEEDED`, `LOAD_PLAN_WEIGHT_EXCEEDED`,
  `GVW_EXCEEDED` (curb weight + cargo above the gross vehicle weight).

## Tests

```bash
cd apps/api
npx jest src/ltl-matching test/unit/ltl- test/unit/toll-provider-flow
```

| Test | Covers |
|---|---|
| `src/ltl-matching/offer-compatibility.spec.ts` | Dead offers, time zones, ADR, reefer, availability |
| `test/unit/screens.spec.ts` | `unmeasurable`: 21 offers → the total 21, the 20 nearest by loading date, the route and date in each, the id order on the same day |
| `test/unit/ltl-compat.spec.ts` | The same rules through the service; what reaches the result |
| `test/unit/ltl-offer-value.spec.ts` | Profit/revenue, detour toll rules, ranking order |
| `test/unit/ltl-ranking.spec.ts` | Characterization: order and amount of every offer, with and without cost per km |
| `test/unit/ltl-detour.spec.ts` | Detour numbers, offers without coordinates, notices, the detour limit |
| `test/unit/ltl-capacity.spec.ts`, `ltl-vehicle-spec.spec.ts`, `ltl-dmc.spec.ts` | Missing weight/dimensions, incomplete vehicle records, gross weight |
| `test/unit/ltl-search-dto.spec.ts` | The request body the screen sends |
| `test/unit/toll-provider-flow.spec.ts` | Detour toll with a registered (fake) toll provider |
| `test/integration/demo-ltl*.int-spec.ts` | The demo scenario on a real PostgreSQL (run by `tools/demo-test.sh`) |

## Known limits

See also [docs/known-issues.md](../../../../docs/known-issues.md) ("LTL").

- Detour distance is straight line × 1.25; the detour toll uses the average
  EUR/km of the offer's own route.
- Without a toll provider, or without a calculated route for the offer, profit
  excludes the detour toll — such an offer can rank above an identical one
  whose toll is known. The card says so.
- An offer heavier or longer than the free space disappears without a reason
  (unlike incompatible offers).
- `awaitingLocation` is not filtered by country.
- Cargo space and capacity are read from the vehicle record itself, not from an
  attached semi-trailer.
- `load-plan` and `load-plan/simulate` do the same thing and save nothing.
- `load-plan/optimize` only reorders loads by weight (heaviest towards the
  middle); it does not compute axle loads.
- `GET /ltl/capacity/:vehicleId` has no caller in the web app.
- Validation messages (`dto/`) and the `IncompleteVehicleRecord` message are
  Polish text, not codes.
