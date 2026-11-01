# analytics — price statistics and an overview of the company's offers

Two read-only reports computed from the caller's company's own offers (not
from an external market): statistics for one route, and an overview with top
routes, margin and revenue. Every amount is in the company's currency
(`Company.costCurrency`, PLN when not set), converted through `common/money.ts`.

## Files

| File | What it does |
|---|---|
| `analytics.service.ts` | `getRouteStats`, `getMarketOverview` and the monthly revenue; results cached for 300 s per company and query. |
| `analytics.controller.ts` | HTTP routes, all behind login (`JwtAuthGuard`), always scoped to the caller's company. |
| `analytics.module.ts` | Nest module (Prisma; the cache service comes from the global cache module). |

## Endpoints

| Route | Query | Returns |
|---|---|---|
| `GET /api/analytics/route-stats` | `pickupCountry`, `deliveryCountry`, optional `pickupPostal`, `deliveryPostal` | `avgPricePerKm`, `minPricePerKm`, `maxPricePerKm`, `avgPrice`, `totalOffers`, `lastOfferDate`, `trend` (`up` / `down` / `stable`), `money` |
| `GET /api/analytics/market-overview` | — | `topRoutes[]` (`pickupCountry`, `deliveryCountry`, `offerCount`, `avgPricePerKm`), `avgMargin`, `marginUpperBoundOffers`, `totalRevenue`, `offersThisMonth`, `offersLastMonth`, `monthlyRevenue[]` (`month`, `revenue`, `offers`), `money` |

`money` is `{ currency, codes, unconverted }` from `MoneyInCompanyCurrency.summary()`.

Callers in the web app: the new-offer form (`route-stats`, shown only when
`totalOffers > 0`) and the analytics page (`market-overview`).

## How it works

**Route statistics**

1. Offers of the company with the given countries **and a `pricePerKm`**.
   A postal code narrows the set to offers whose postal code starts with the
   same first 2 characters.
2. `avgPricePerKm`, `minPricePerKm`, `maxPricePerKm` from `pricePerKm`;
   `avgPrice` from `price` of the same offers. All converted to the company
   currency in code, not with database `_avg/_min/_max` (that would mix
   currencies).
3. A value is `null` only when there is no amount after conversion; `0` is a
   value.
4. `trend`: average price per km of the last 30 days vs the 30 days before;
   more than +3 % → `up`, less than −3 % → `down`, otherwise `stable`. When
   either period has no amount (or an average of 0) → `stable`.
5. `totalOffers` and `lastOfferDate` count the same filtered offers.

**Overview**

1. `topRoutes`: the 5 country pairs with the most offers (any status), each
   with the converted average price per km of its offers.
2. `avgMargin`: database average of `profitMarginPercent` over offers with a
   full margin (`marginWithoutTolls` false — a percentage, no currency); `null`
   when none has it. `marginUpperBoundOffers`: offers with only an upper bound
   (no toll), outside the average.
3. `totalRevenue`: sum of `price` of the jobs taken on — `ACCEPTED`, `IN_TRANSIT`, `COMPLETED` (`REVENUE_STATUSES`, `common/money.ts`) — converted.
4. `offersThisMonth` / `offersLastMonth`: offers created in the calendar month
   (server time zone), any status.
5. `monthlyRevenue`: the last 6 calendar months; `revenue` from the jobs taken on
   (same statuses) created in that month, `offers` = all offers created in that month.
   `month` is a Polish short label (`pl-PL`, e.g. "wrz 26").

## Message codes

None of its own. `money.codes` comes from
`common/money.ts`: `FX_RATE_STATIC` (once per currency pair converted with a
static rate) and `TOTAL_EXCLUDES_UNCONVERTED` (`count`, `from`, `to`) when
offers in a currency without a rate were left out; `money.unconverted` is
their number. The web app turns them into text
(`apps/web/src/lib/plan-messages.ts`).

## Tests

```bash
cd apps/api
npx jest test/unit/analytics test/unit/dashboard-money
```

| Test | Covers |
|---|---|
| `test/unit/analytics.zero.spec.ts` | 0 as a result, not missing data: average/min/max rate, average price, average margin, per-route average; empty set → `null` |
| `test/unit/dashboard-money.spec.ts` | Amounts converted to the company currency in both reports; an offer without a rate is left out and counted, with its code |

Both use `test/unit/helpers/offer-db-fake.ts`, a fake offer table that
computes `where`, `groupBy`, `aggregate` and `count` like the database.

## Known limits

See also [docs/known-issues.md](../../../../docs/known-issues.md) ("analytics").

- Query parameters have no DTO and no validation. Without `pickupCountry` /
  `deliveryCountry` the filter is simply not applied, although Swagger marks
  them required.
- Revenue and months are grouped by `createdAt`, not by a delivery date.
- Route statistics only include offers with a `pricePerKm`; `avgPrice` and
  `totalOffers` are over that same subset.
- The postal filter uses only the first 2 characters.
- "Market" means the company's own offers only.
- Month boundaries use the server time zone; month labels are Polish.
- Results are cached in process for 5 minutes (`common/cache`), so a new offer
  can take up to 5 minutes to show.
- `monthlyRevenue` runs one count query per month, and `topRoutes` one query
  per route.
