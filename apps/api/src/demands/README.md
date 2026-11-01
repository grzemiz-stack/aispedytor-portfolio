# demands — what a dispatcher is looking for

A demand describes the loads a dispatcher wants (pickup countries, maximum
weight, ADR, reefer and more). The module stores demands, finds offers that
match one, and can notify the dispatcher when a new offer matches.

## Files

| File | What it does |
|---|---|
| `demands.service.ts` | CRUD, the list's `matchCount`, manual search (`searchOffers`), subscription toggle, and the check of a new offer against subscribed demands (`checkNewOfferAgainstDemands`, called by `offers`). |
| `match-offer-to-demand.ts` | `matchOfferToDemand`: the one predicate that decides whether an offer matches a demand. Pure function. |
| `matchable-offer-status.ts` | Which offer statuses can match (`NEW`, `ASSIGNED`). |
| `demands.controller.ts` | HTTP routes, all behind login (`JwtAuthGuard`), always scoped to the caller's company. |
| `dto/` | Request bodies, validated by the global `ValidationPipe`. |

## Endpoints

| Route | Body / query | Returns |
|---|---|---|
| `GET /api/demands` | `page`, `limit` (default 20) | Paginated demands, newest first, each with a computed `matchCount`. A user with role `DISPATCHER` sees only their own demands. |
| `GET /api/demands/:id` | — | One demand of the caller's company; `404` if not found |
| `POST /api/demands` | `CreateDemandDto`: `title` (2–200 chars), optional `description`, `priority` (`LOW`/`MEDIUM`/`HIGH`/`URGENT`, default `MEDIUM`), `neededBy` (ISO 8601, strictly; an unreadable date is 400), `vehicleType`, `trailerType`, `minLoadingMeters` (1–16), `maxWeight` in tonnes (0.1–44), `temperatureRequired`, `temperatureMin`/`temperatureMax` (−30–30), `adrRequired`, `adrClass`, `preferredCountries[]`, `regions[]` | The created demand; the caller becomes its dispatcher |
| `PATCH /api/demands/:id` | `UpdateDemandDto`: any field above, plus `status` (`OPEN`/`IN_PROGRESS`/`FULFILLED`/`CANCELLED`) | The updated demand |
| `DELETE /api/demands/:id` | — | The deleted demand (hard delete) |
| `POST /api/demands/:id/search` | — | `demandId`, `matchCount`, `offers` (each with `matchUnknownCriteria`), `unknownCriteriaSummary`, `scanned`, `scanLimitReached` |
| `POST /api/demands/:id/subscribe` | — | `{ autoNotify }` — turns new-offer notifications on or off |

Every `:id` route returns `404` for an unknown demand id or one from another
company. `POST /demands` returns `201`; `search` and `subscribe` create no
resource and return `200` (`http-status-codes.spec.ts`).

## How matching works

1. **One predicate** (`matchOfferToDemand`) is used by the manual search, the
   list's `matchCount` and the new-offer notifications, so the same offer and
   demand always give the same answer.
2. **Four criteria**, each used only when the demand sets it:
   - `pickupCountry` — the offer's pickup country is in `preferredCountries`
     (an empty list means no country filter);
   - `weight` — offer `weightKg` ≤ demand `maxWeight` × 1000;
   - `adr` — when `adrRequired`, the offer must have `isAdr = true`;
   - `temperature` — when `temperatureRequired`, the offer must have
     `isFrigo = true`.
3. **Missing offer data does not reject.** If the demand sets a criterion but
   the offer has no value for it, the offer still matches and the criterion is
   listed in `unknownCriteria` (`matchUnknownCriteria` in the API). `0` and
   `false` are values, not missing data (docs/decisions.md §2).
4. **Status range**: only offers with status `NEW` or `ASSIGNED` match; an
   offer without a status does not.
5. **Manual search** (`POST /demands/:id/search`) loads the 500 newest
   offers of the company in that status range, evaluates them in memory and
   returns at most 50 matches. It also sets `lastSearchAt`, moves an `OPEN`
   demand to `IN_PROGRESS` and, when anything matched, creates a
   `DEMAND_MATCH` notification for the caller.
6. **List count** (`GET /demands`): `matchCount` is computed on read over the
   same 500 newest offers, once per page; it is not stored and not capped at 50.
7. **New-offer notifications**: when `offers` creates or imports an offer, it
   queues `checkNewOfferAgainstDemands`. Every demand of the company with
   `autoNotify`, `isActive` and status `OPEN` or `IN_PROGRESS` that matches
   gets a `DEMAND_MATCH` notification for its dispatcher. A failure is logged
   with the offer id; it does not fail the offer request.

## Message codes

None. The module returns no `{ code, params }` messages; notification titles
and texts are Polish sentences built on the server.

## Tests

```bash
cd apps/api
npx jest test/unit/demands test/unit/match-offer-to-demand test/unit/notifications.contract
```

| Test | Covers |
|---|---|
| `test/unit/match-offer-to-demand.spec.ts` | The predicate: each criterion, missing data, zero/false, known limits, purity |
| `test/unit/demands.parity.spec.ts` | Manual search and new-offer notifications give the same offers (PostgreSQL NULL semantics in the mock) |
| `test/unit/demands.service.spec.ts` | SQL scope, scan and result limits, `unknownCriteria` in the response, the list's `matchCount` |
| `test/unit/notifications.contract.spec.ts` | `DEMAND_MATCH` exists in the schema enum; matching errors are logged by `OffersService` |

## Known limits

See also [docs/known-issues.md](../../../../docs/known-issues.md) ("demands", "notifications").

- Most demand fields (vehicle and trailer type, loading metres, temperature
  range, ADR class, `neededBy`, regions, minimum rate and margin, pickup
  radius) are stored but not used for matching.
- The country criterion looks only at the pickup country and is
  case-sensitive (`pl` ≠ `PL`).
- ADR and reefer are one-sided: an ADR or reefer offer also matches a demand
  that does not require it.
- Only the 500 newest offers are scanned; `scanLimitReached` says when the
  limit was hit.
- Only `GET /demands` is limited to the dispatcher's own demands; the `:id`
  routes accept any demand of the company.
- An offer update does not re-run the new-offer check (only create and import do).
- Notifications are created but the web app does not show them.
- Validation and not-found messages and notification texts are Polish text,
  not codes.
