# route-planner — route, toll, cost and margin

Calculates a truck route between points, its toll, its cost (the company cost per km × km + toll) and the
margin against a freight rate, and returns per-country road rules. Routing
comes from OSRM. Toll amounts come only from a toll provider
(`TollProvider`, `src/tolls`, docs/decisions.md §5). This module does not
estimate toll and holds no toll amounts.

## Files

| File | What it does |
|---|---|
| `route-planner.service.ts` | `calculateRoute`: route from the adapter, toll from the provider, the cost through `common/offer-cost.ts`, margin, labels, recommendation, saving to `route_calculations`. Also the country restriction lookups. |
| `osrm-adapter.service.ts` | Turns the `RouteCalculatorService` result into `PlannedRoute` (one route, one section, km per country). |
| `osrm-calculator.service.ts` | `RouteCalculatorService`: geocoding (Nominatim, max ~1 request/s), OSRM routing, country detection, an in-memory cache (7 days), a circuit breaker, and a hub-distance fallback. |
| `route-types.ts` | `RouteRequest`, `PlannedRoute`, `RouteSection`. |
| `hub-distances.data.ts` | 30 transport hubs and a table of road distances between them; haversine × 1.3 for pairs not in the table. Used only by the fallback. |
| `truck-restrictions.data.ts` | Road rules for 20 countries: weight and size limits, weekend bans, low-emission zones, cabotage, ADR notes, and a text description of the toll system (no amounts). Texts are Polish. |
| `vignette-requirements.data.ts` | Which countries need a vignette or an OBU registration (19 countries, `lastVerified` 2025-01-15). No amounts. |
| `dto/calculate-route.dto.ts` | Request body, validated by the global `ValidationPipe`. |

## Endpoints

All behind login (`JwtAuthGuard`), at most 20 requests per minute.

| Route | Body / params | Returns |
|---|---|---|
| `POST /api/route-planner/calculate` | `CalculateRouteDto`: `origin`, `destination` (`lat`, `lng`, optional `address`), optional `waypoints[]`, `vehicle` (`grossWeight` kg, `height`, `width`, `length`, optional `axleCount` 2–7, `hasAdr`, optional `adrClass`, `euroClass` Euro3–Euro6), optional `freightRate`, `currency` (PLN/EUR), `maxAlternatives`, `offerId` | `routes` (alternatives with `costs` and optional `margin`), `recommendation` (`recommendedIndex`, `reason`), `countryRestrictions` for the countries on the route |
| `GET /api/route-planner/restrictions/:country` | ISO 3166-1 alpha-2 code, any letter case | The restrictions of that country |
| `GET /api/route-planner/restrictions` | — | An array with the restrictions of all 20 countries |

Errors: `400` validation; `404` for an unknown country code, and when
`offerId` is not an offer of the caller's company **and** the route would be
saved for it — that is, only with a complete toll from a toll provider;
without one nothing is saved and a foreign `offerId` gets the plain `200`
result;
`502 TOLL_PROVIDER_UNAVAILABLE { reason }` when the toll provider fails;
`503 ROUTE_UNAVAILABLE` when there is neither an OSRM route nor a hub
estimate (no guessed distance — the flat 500 km default is gone).

**Estimated routes.** When geocoding or OSRM fails, the planner falls back to
the hub-table distance and marks the route `estimated` with
`ROUTE_ESTIMATED` in its cost codes. Such a route (and a 0 km one) is shown
but never saved with the offer, so it never changes the offer's cost or
margin. For an offer (`offerId`) the cost uses the offer's manual toll first,
as the saved margin and negotiation do.

## How a calculation works

1. **Defaults**: Euro 6, currency PLN. With no
   `axleCount` the axle class is 5+ and flagged as assumed
   (`common/axle-class.ts`).
2. **Route**: the adapter sends `"lat,lng"` strings to
   `RouteCalculatorService`. That service geocodes them with Nominatim, asks
   OSRM (public server, car profile) for one route, and finds km per country
   by the driven distance: it reverse-geocodes a probe at the start, at the
   end and in the middle of every ~50 km piece of the route; where two
   neighbouring probes are in different countries, the stretch between them
   is halved down to 6.25 km and the border goes in its middle (about
   ±3 km). A third country found while halving (a narrow strip) gets its own
   km ([decisions §5a](../../../../docs/decisions.md)). Results are cached by
   origin, destination and the whole `options` object.
3. **Fallback**: if geocoding or OSRM fails, or the circuit breaker is open
   (3 failures, 5 minutes), the distance comes from the nearest hubs
   (table, or haversine × 1.3) and the route is marked estimated (see
   "Estimated routes"). Without a hub distance, or with both ends at the same
   hub, there is no route (`503 ROUTE_UNAVAILABLE`); the same when the
   adapter itself throws.
4. **Toll**: for each route the planner sends the toll provider the points,
   the geometry, km per country, the axle class, the emission class and the
   gross weight in tonnes. Each quoted item is converted to EUR through
   `common/fx`. An item in a currency without a rate goes to `unresolved`
   (`CURRENCY_CONVERSION_UNAVAILABLE`), and then the toll is `complete: false`.
   - With no provider registered: toll totals are `null`, `source` is `null`,
     `TOLL_PROVIDER_NOT_CONFIGURED`, and cost and margin are `complete: false`.
   - If the provider fails, the request ends with a 502 and nothing is saved.
     The planner does not fall back to anything else.
5. **Cost** (`common/offer-cost.ts`): the company cost per km (without
   tolls, in the company currency, read for the caller's company) × route km
   = `perKm`, + the toll. Without a toll quote the cost is without tolls
   (`OFFER_COST_WITHOUT_TOLLS`, `complete: false`). Without a company cost per
   km there is no cost: totals and cost per km are `null`,
   `OFFER_COST_RATE_MISSING`. There are no fuel fields or constants.
6. **Total** in PLN and EUR, cost per km in PLN and EUR, plus the EUR→PLN rate.
7. **Margin** (only with `freightRate` > 0) = rate − cost in the freight
   currency, plus margin %, price per km, and `complete` copied from the cost.
8. **Order and labels**: alternatives are sorted by total cost (without a
   company cost per km: by km, with no "Najtańsza" label). Labels
   (Polish text) are "Najtańsza", "Najszybsza", "Najkrótsza", combined where
   one route is several of these, otherwise "Trasa alternatywna N".
   Index 0 is always recommended.
9. **Saving**: only with `offerId`, the caller's company, and a complete
   toll from a provider. The recommended route is saved as a new
   `route_calculations` row: distance, toll in EUR and PLN, the breakdown,
   `tollSource`, the label, the axle class and whether it was assumed. Every
   calculation adds a row. `offers.toll_cost_estimate` (the dispatcher's
   manual toll) is never changed. LTL and negotiation read toll from these rows.
   After the row is saved the offer's cost, profit and margin are recomputed
   from it (`offers/offer-economics.ts`); without a toll provider no row is
   saved, so the offer keeps an upper-bound margin from its own km.

## Message codes

Returned as `{ code, params }`; the web app turns them into text
(`apps/web/src/lib/plan-messages.ts`).

- Raised here: `TOLL_PROVIDER_NOT_CONFIGURED`, `TOLL_PROVIDER_UNAVAILABLE`,
  `ROUTE_ESTIMATED` (a hub estimate, not saved), `ROUTE_UNAVAILABLE` (503).
- Passed on from `common/offer-cost.ts`: `OFFER_COST_WITHOUT_TOLLS`,
  `OFFER_COST_NO_DISTANCE`, `OFFER_COST_RATE_MISSING`.
- Passed on from `common/fx`: `FX_RATE_STATIC`,
  `CURRENCY_CONVERSION_UNAVAILABLE`.

## Tests

```bash
cd apps/api
npx jest test/unit/route-planner. test/unit/route-save test/unit/osrm-route-cache test/unit/planner-toll-provider test/unit/toll-provider-flow
```

| Test | Covers |
|---|---|
| `test/unit/route-planner.helpers.spec.ts` | Margin, rounding, duration format, restriction lookups, vignette and hub data |
| `test/unit/route-planner.alternatives.spec.ts` | Building one alternative, labels, recommendation text |
| `test/unit/planner-toll-provider.spec.ts` | No provider, a quote, currency without a rate, provider failure → 502 |
| `test/unit/route-save.spec.ts` | When a `route_calculations` row is saved and what it holds |
| `test/unit/osrm-route-cache.spec.ts` | Route cache and cache key; the route result has no toll amounts |
| `test/unit/toll-provider-flow.spec.ts` | A registered (fake) provider: planner → saved row → LTL and negotiation |
| `src/common/axle-class.spec.ts` | Axle class, including the planner default |

## Known limits

See also [docs/known-issues.md](../../../../docs/known-issues.md) ("Route
planner and distances").

- Routing uses the public OSRM demo server with the car profile. Vehicle
  height, width, length, weight and ADR do not affect the route.
- One route only: `maxAlternatives` is accepted but has no effect.
- Km per country are an approximation: each border is about ±3 km off, and a
  country lying wholly between two probes of the same country (the route
  clips it and comes back within one ~50 km piece) is not seen.
- A hub estimate is marked `ROUTE_ESTIMATED`, but the response does not say
  whether it came from the hub table or from haversine × 1.3.
- Vignette requirements are computed but dropped by the adapter, so they are
  not in the response.
- The axle count and emission class come from the form, not from the fleet.
- `recommendation.reason`, the route labels, the restriction texts and the
  `NotFound` message are Polish text, not codes.
- `formatDuration` can give "0h 60min"; `round` gives 1 for 1.005
  (pinned by tests).
