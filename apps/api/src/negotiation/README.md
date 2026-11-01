# negotiation — price negotiation support for one offer

For one offer of the caller's company: a price range from the company's own
history on the same country pair, a contractor profile, negotiation
arguments, and price scenarios with their margin. Toll is never computed
here. It is either entered by hand or taken from a provider-computed
`route_calculations` row.

## Files

| File | What it does |
|---|---|
| `negotiation.service.ts` | Analysis (`analyzeOffer`), simulation (`simulateNegotiation`), price history, contractor profile, arguments, toll source (`resolveTollCost`). |
| `negotiation.controller.ts` | HTTP routes. All need a login (`JwtAuthGuard`), are limited to 20 requests per minute, and only see the caller's company. |
| `dto/negotiation.dto.ts` | `PriceSimulationDto` (the simulate body), checked by the global `ValidationPipe`. |
| `negotiation.module.ts` | Nest module; exports `NegotiationService`. |

## Endpoints

| Route | Body | Returns |
|---|---|---|
| `POST /api/negotiation/analyze/:offerId` | — | `offer`, `priceSuggestion`, `contractorProfile`, `arguments` (at most 5), `simulation` (for the offer price, or the suggested price when the offer has none), `marketPosition`, `marketPositionPct`, `tollCost` |
| `POST /api/negotiation/simulate` | `PriceSimulationDto`: `offerId`, `proposedPrice` (1–500000), optional `currency` (accepted, not used) | `NegotiationSimulation`: `available`, `scenarios`, `breakEvenPrice`, `sweetSpotRange`, `estimatedCosts`, `tollCost`, `unavailable`, `rateToPLN` |

Errors: `404` when the offer does not exist in the caller's company; `400`
when the body fails validation (the messages are Polish text).

## How it works

1. **Distance**: `Offer.distanceKm`. If it is missing, the straight line
   between the coordinates × 1.3, or `null` without coordinates.
2. **Toll** (`tollCost`), taken in this order and never computed here
   (docs/decisions.md §5):
   - `manual`: `Offer.tollCostEstimate`, the dispatcher's entry, in the offer
     currency — converted to PLN through `common/fx` (no rate → no PLN
     amount). It always wins, and `0` counts as a value. When a calculation
     exists too, its amount and the difference are returned as well.
   - `calculated`: the latest `route_calculations` row of the offer.
     `tollTotalEur` is converted to PLN through `common/fx`. The
     `tollTotalPln` column is not read.
   - `unknown`: no manual entry and no row.
3. **Price suggestion**: up to 200 offers of the same company from the last
   90 days, on the same pickup → delivery country pair, with a price. Offers
   more than 100 km longer or shorter are left out. Prices are converted to
   the offer's currency through `common/fx`; a price without a rate is left
   out and counted. The result has min, max, average, median, p25/p75 and
   price per km. The trend compares the last 30 days with days 30–90 (both
   need at least 3 offers; ±3 % → rising/falling). Optimal price = median,
   +3 % when rising and −3 % when falling. With no history at all, the
   suggestion is distance × 1.15 EUR/km or 4.95 PLN/km. Other currencies get
   1.15 EUR converted; a currency without a rate gets 0, with a code.
4. **Contractor profile**: orders = the contractor's offers in the revenue
   statuses (accepted, in transit, completed), counted on read — in total
   (`totalOrders`), in the last 30 and 90 days, and "regular" (5 or more in
   30 days); the average
   rate per km. **Contractor vs market**: the average rate PLN/km on similar
   routes — the same pickup and delivery countries, the distance within
   100 km of the offer's; the contractor's offers (without the current one)
   against the company's other offers from 90 days (without this
   contractor's). The "market" is the company's other offers in the system
   (mostly imported from exchanges), not outside market data. Below 3
   contractor offers or 5 market offers — or without the offer's distance —
   there is no comparison: `priceVsMarket` and `priceVsMarketPct` are `null`
   with `NEGOTIATION_SAMPLE_TOO_SMALL`. Amounts are in PLN through `common/fx`.
5. **Arguments**, sorted by strength (top 5). The `title` and `text` are
   Polish sentences built on the server. A contractor on this company's
   blacklist puts "Kontrahent na czarnej liście firmy — nie przyjmuj bez
   decyzji kierownika" (do not accept without a manager's decision) first,
   outside the strength order; the 4 strongest others follow:
   - price vs market;
   - market trend;
   - regular or new contractor;
   - payment risk (`counterpartyRisk` → `PAYMENT`, i.e. payment rating ≤ 2);
   - urgency (pickup within 2 days — calendar days in the pickup country's
     time zone: 0 "dzisiaj", 1 "jutro", 2 "2 dni");
   - cost:
     - the cost comes from `common/offer-cost.ts`: the company cost per km
       (without tolls, in the company currency) × km + toll;
     - without a cost (no company cost per km, no distance) an argument that
       the margin could not be estimated, with the reason;
     - otherwise a "Niska marża" (low margin) argument when the cost leaves
       less than 15 %; it names the parts (rate × km, toll) and where km and
       toll come from. A cost without tolls gives the argument always, as
       "co najwyżej X %" (an upper bound; "Marża niepewna — bez myta" at 15 %
       or more) — with no toll provider it says toll is not computed;
   - ADR;
   - temperature-controlled transport.
6. **Simulation**:
   - When the offer's currency has no rate, nothing is computed
     (`currency_unconvertible`).
   - Without a cost nothing is computed (`cost_unknown`, the code
     `OFFER_COST_RATE_MISSING` with the action `set_cost_per_km`, or
     `OFFER_COST_NO_DISTANCE` with `calculate_route`) — never an assumed
     distance.
   - Otherwise the cost in PLN is the company cost per km × km (from the
     latest planner route, else from the offer — `OFFER_COST_ESTIMATED`) +
     toll (the manual one first, else the route's). Without any toll the cost
     is without tolls (`OFFER_COST_WITHOUT_TOLLS`, also with no toll
     provider): `costIsLowerBound` is true, margins are upper bounds and a
     margin of 8 % or more gets the verdict `uncertain` instead of
     excellent / good / acceptable. `estimatedCosts` = `{ perKmPLN, tollPLN,
     totalPLN, source, withoutTolls, messages }`.

     The scenarios are the contractor price, −5 %, −10 %, the optimal market
     price, the minimum acceptable price (8 % margin) and the proposed price
     when it differs. Each gets a margin in PLN and a verdict:
     - ≥ 20 % excellent;
     - ≥ 12 % good;
     - ≥ 8 % acceptable;
     - ≥ 0 low;
     - below 0 loss.

     The response also gives the break-even price, the price range for a
     12–20 % margin, and `rateToPLN` (the panel uses it for its slider).
7. **Market position**: the offer price against the average of the
   suggestion (±5 %).

## Message codes

Returned as `{ code, params }`. The web app turns them into text
(`apps/web/src/lib/plan-messages.ts`).

- Emitted here: `TOTAL_EXCLUDES_UNCONVERTED`, `NEGOTIATION_SAMPLE_TOO_SMALL`
  (`contractorOffers`, `marketOffers`, `minContractorOffers`, `minMarketOffers`).
- Passed on from `common/offer-cost.ts`: `OFFER_COST_ESTIMATED`,
  `OFFER_COST_WITHOUT_TOLLS`, `OFFER_COST_NO_DISTANCE`, `OFFER_COST_RATE_MISSING`.
- Passed on from `common/fx`: `FX_RATE_STATIC`,
  `CURRENCY_CONVERSION_UNAVAILABLE`.

The argument texts, the `unavailable.message` and action labels, and the
scenario labels are Polish sentences, not codes.

## Tests

```bash
cd apps/api
npx jest test/unit/negotiation test/unit/fx-sources
```

| Test | Covers |
|---|---|
| `test/unit/negotiation-toll-cost.spec.ts` | Toll source order (manual → calculated → unknown), difference, the cost argument |
| `test/unit/negotiation-manual-toll-currency.spec.ts` | The manual toll in the offer currency: EUR, GBP, PLN, 0, no rate, the difference, the simulation costs |
| `test/unit/negotiation-simulation-toll.spec.ts` | Simulation with a known or unknown toll, the `unavailable` reasons and actions |
| `test/unit/fx-sources.characterization.spec.ts` | Characterization: every amount through `common/fx` (EUR, PLN, GBP, a currency without a rate) |
| `test/unit/negotiation-distance.spec.ts` | Distance from coordinates (× 1.3) |
| `test/unit/negotiation-contractor-market.spec.ts` | `totalOrders`, the 30/90-day counts and "regular" from the offers in the revenue statuses; contractor vs market on the rate per km on similar routes, the sample sizes |
| `test/unit/negotiation-payment-risk.spec.ts` | The payment risk argument (payment rating only) |

## Known limits

See also [docs/known-issues.md](../../../../docs/known-issues.md)
("Negotiation", "three road factors").

- With no price history the estimate is 1.15 EUR/km or 4.95 PLN/km.
- A distance estimated from coordinates uses × 1.3; LTL uses × 1.25.
- Without a distance and without price history the price suggestion is 0.
- The latest `route_calculations` row is used whatever its axle class
  (negotiation does not know the vehicle).
- `needsVerification` comes from the row; the route planner currently always
  writes `false`.
- The argument texts, unavailability messages and scenario labels are Polish
  sentences built on the server, not codes (compare docs/decisions.md §1).
- `PriceSimulationDto.currency` is accepted and ignored.
