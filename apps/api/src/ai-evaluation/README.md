# ai-evaluation — heuristic offer score (no AI model)

Gives an offer a score from 1 to 10 and a short recommendation. It is a
**heuristic**: margin thresholds, adjusted by the offer's price per km against
the average of the company's own other offers on the same country pair. There
is no model and no LLM call (docs/decisions.md §9). The module name and the
`/api/ai-evaluation/...` paths are historical and kept so API clients do not
break.

## Files

| File | What it does |
|---|---|
| `ai-evaluation.service.ts` | `evaluateOffer` (one offer), `batchEvaluate` (newest offers), the score (`calcScore`) and the recommendation text. |
| `ai-evaluation.controller.ts` | HTTP routes, all behind login (`JwtAuthGuard`), always scoped to the caller's company; at most 20 requests per minute. |
| `ai-evaluation.module.ts` | Nest module (Prisma; the in-process task queue comes from `common/queue`). |

## Endpoints

| Route | Body / query | Returns |
|---|---|---|
| `POST /api/ai-evaluation/evaluate/:offerId` | — | One `EvaluationResult` (below). `404` when the offer does not exist in the caller's company. |
| `GET /api/ai-evaluation/batch` | — | `EvaluationResult[]` for up to 30 newest offers with status `NEW`, highest score first. |

`EvaluationResult`: `offerId`, `pickupCity`, `pickupCountry`, `deliveryCity`,
`deliveryCountry`, `price` (in the offer currency, `null` without a price),
`currency`, `route` (**deprecated** — `PL→DE`, country codes only; kept for
older clients, marked `deprecated` in Swagger), `score`
(1–10), `priceVsMarket` (% against the average, one decimal, or `null`),
`marginRating` (`excellent | good | fair | poor | uncertain`), `pricePerKmRating`
(`above | at | below | unknown`), `routePopularity` (number of the company's
other offers on the country pair with a price per km), `recommendation`
(Polish text), `calculatedAt`, `messages` (currency codes).

The web app calls both routes from the dashboard and the offer list/detail
pages.

## How the score works

1. **History**: the company's other offers with the same pickup and delivery
   country and a `pricePerKm` (any status, any age; the evaluated offer itself
   is left out). Their count is `routePopularity`.
2. **Average** price per km of that history, converted to the offer's currency
   through `common/money.ts` / `common/fx.ts` (static rates, `FX_RATE_STATIC`).
   A rate in a currency without an exchange rate is left out and counted
   (`TOTAL_EXCLUDES_UNCONVERTED`). If the offer's own currency has no rate, only
   history in the same currency counts.
3. **priceVsMarket** = (offer price per km − average) / average × 100. `null`
   when the offer has no price per km, there is no history, or the average is
   0. `0` is a value, never "no data" (decisions §2).
4. **pricePerKmRating**: above +5 % → `above`, below −5 % → `below`, otherwise
   `at`; `unknown` without a comparison.
5. **Base from the margin** (`Offer.profitMarginPercent`, as stored on the
   offer): > 20 → 9, ≥ 15 → 8, ≥ 10 → 7, ≥ 5 → 5, ≥ 0 → 3, below 0 → 1; unknown
   margin → 5 (neutral).
6. **Adjustment** from priceVsMarket: > 15 % → +1, > 5 % → +0.5, < −10 % → −1.5,
   < −5 % → −0.5. The score is `round(base + adjustment)`, clamped to 1–10.
7. **marginRating**: > 20 `excellent`, ≥ 10 `good`, ≥ 5 `fair`, otherwise (or
   unknown) `poor`. A margin without a toll (`marginWithoutTolls`, an upper
   bound) of 10 % or more is `uncertain` and scored like an unknown margin;
   below 10 % the number is used (the real margin is at most that).
8. **Recommendation** (Polish text): route and price, comparison with the
   average, margin, how often the country pair appears, and a verdict by score
   (≥ 8 accept, ≥ 6 worth accepting, ≥ 4 negotiate, otherwise reject or
   renegotiate).

`batchEvaluate` runs the evaluations through the in-process task queue (at
most 3 at a time) and sorts by score.

## Message codes

None of its own (the module calls no `msg()`). Passed on in `messages` as
`{ code, params }`, built by `common/money.ts`:

- `FX_RATE_STATIC` — once per currency pair used to convert the history.
- `TOTAL_EXCLUDES_UNCONVERTED` — history rates left out for lack of a rate
  (`count`, `from`, `to`).

## Tests

```bash
cd apps/api
npx jest test/unit/ai-evaluation
```

| Test | Covers |
|---|---|
| `test/unit/ai-evaluation.service.spec.ts` | Score thresholds and adjustment, ratings, zero vs missing values, division by zero, recommendation fragments, batch order; pins the known flaws listed below |
| `test/unit/ai-evaluation-currency.spec.ts` | The average in the offer's currency through fx, codes, rates without an exchange rate |
| `test/unit/screens.spec.ts` | The result carries the places and the price with its currency; `route` is deprecated in Swagger on both routes |
| `test/unit/ai-evaluation-honest.spec.ts` | Swagger calls it a heuristic with no AI model; the module source does not reference an LLM client |

## Known limits

See also [docs/known-issues.md](../../../../docs/known-issues.md).

- "Market" means the company's own offers on the same country pair — not
  market data. All statuses and all dates count; there is no time window and
  no city-level route match.
- The margin is the value stored on the offer; the module does not compute it.
- The recommendation is a Polish sentence built on the server, not codes
  (unlike decisions §1).
- Rounding: `Math.round` of x.5 rounds up, so the −0.5 penalty never changes
  the score, the +0.5 bonus always does, and −1.5 acts as −1. The scores are
  biased upwards.
- Exactly +5 % / −5 % can land in `above` / `below` because of floating-point
  error (e.g. 1.05 vs 1.0 gives 5.000000000000004).
- `marginRating` and the recommendation text use different thresholds: a 12 %
  margin is `good` while the text calls it average; 7 % is `fair` while the
  text calls it poor.
- An unknown margin gives a neutral score of 5 but `marginRating: poor`.
- `batch` runs one history query per offer (up to 30).
- Exchange rates are static (`common/fx.ts`).
- The 404 message (`Oferta nie znaleziona`) is Polish text, not a code.
