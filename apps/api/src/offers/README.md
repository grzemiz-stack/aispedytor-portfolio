# offers — freight offers of a company

Stores the freight offers a company works with: create, list, search, import,
assign to a dispatcher, change status, delete, and the statistics shown on the
dashboard. Every query is scoped to the caller's company.

## Files

| File | What it does |
|---|---|
| `offers.service.ts` | All operations, the import path, statistics, the 30-second list cache and queueing of demand matching. |
| `offers.controller.ts` | HTTP routes, all behind login (`JwtAuthGuard`), always scoped to the caller's company. |
| `raw-offer.ts` | The raw offer accepted by the import, its normalisation (`normalizeRawOffer`) and the `source` key mapping (`resolveSourceKey`). Pure functions. |
| `dto/` | `CreateOfferDto`, `UpdateOfferDto` (all fields optional), `OfferQueryDto` (pagination + filters), `UpdateOfferStatusDto`. Validated by the global `ValidationPipe`. |
| `offers.module.ts` | Wires the service to `DemandsModule` (demand matching). |

## Endpoints

| Route | Body / query | Returns |
|---|---|---|
| `GET /api/offers/stats` | — | Totals, counts by status and source, revenue of the jobs taken on (`ACCEPTED`, `IN_TRANSIT`, `COMPLETED` — `REVENUE_STATUSES` in `common/money.ts`) and average price per km in the company currency (`money`), average margin (full margins only) and `marginUpperBoundOffers` (offers with only an upper bound), the 5 newest offers |
| `GET /api/offers/search` | `country` (exact pickup country), `postal` (pickup postal code prefix) | Flat array, pickup date ascending, at most 100, no pagination |
| `POST /api/offers/import` | `{ source, offers[] }` (JSON, see `RawOffer`) | `{ imported, duplicates, rejected }` — `rejected`: `{ row, field, code }` per bad row; 400 only for a bad request structure |
| `GET /api/offers` | `page`, `limit` (1–100, default 20), `sortBy` (`OFFER_SORT_COLUMNS`: `createdAt`, `price`, `distanceKm`, `pickupDate`, `pricePerKm`, `profitMarginPercent`; anything else → `createdAt`; empty values last in both directions; by margin: full ones, then upper bounds, then empty), `sortOrder`, `status`, `assignedToId`, `source` | `{ data, meta }` |
| `GET /api/offers/:id` | — | The offer with its contractor name and country; 404 if not in the company |
| `POST /api/offers/economics-preview` | `price`, `currency`, `distanceKm`, `tollCostEstimate` (the `CreateOfferDto` rules); optional `offerId` | `200` `{ totalCostEstimate, profitEstimate, profitMarginPercent, marginWithoutTolls, messages }` — exactly what saving would store: without `offerId` as `create` (the same function and defaults, no route); with `offerId` (the company's offer, otherwise 404) as `PATCH /offers/:id` (missing fields from the offer, its saved route). Without a manual toll the margin is an upper bound. Used by the new-offer and the edit forms |
| `POST /api/offers` | `CreateOfferDto` (no `pricePerKm`, `totalCostEstimate`, `profitEstimate`, `profitMarginPercent` — computed or not stored, below) | The created offer |
| `PATCH /api/offers/:id` | `UpdateOfferDto` | The updated offer; for an accepted / in-transit / completed offer the money, date and place fields are for an ADMIN only (`403 OFFER_FIELDS_ADMIN_ONLY`) |
| `PATCH /api/offers/:id/assign/:userId` | — | The offer, assigned, with status `ASSIGNED` |
| `PATCH /api/offers/:id/status` | `{ status }` (any `OfferStatus` but `ASSIGNED`) | The offer with the new status |
| `DELETE /api/offers/:id` | — | The deleted offer |

Errors: `404` unknown offer (or one of another company — same answer);
`400 OFFER_CONTRACTOR_NOT_FOUND` when `contractorId` is not a contractor of the
caller's company; `404 OFFER_ASSIGNEE_NOT_FOUND` when `userId` is not an active
user of the caller's company (a foreign id and an unknown id give the same
answer); `400 OFFER_ASSIGN_VIA_ASSIGN` when `/status` gets `ASSIGNED`;
`400 OFFER_CONTRACTOR_BLACKLISTED` when `/status` moves an offer from a
contractor on the caller's company blacklist into a revenue status
(`ACCEPTED`, `IN_TRANSIT`, `COMPLETED`) from another status and the caller is
not an ADMIN; `403 CONTRACTOR_BLACKLIST_ADMIN_ONLY` when a non-ADMIN's
`PATCH /offers/:id` detaches or replaces a blacklisted contractor; `400 OFFER_STILL_DEAD { reason }` when `/status` gets `NEW`
for an `EXPIRED` or `REJECTED` offer that is still dead (`PICKUP_PASSED`,
`EXPIRED`, `TOO_OLD` — see "How it works");
`400` from validation of the create/update/status bodies (a computed field in
the body is a field outside the schema).

## How it works

- **Create**: missing `source` → `MANUAL`, missing `currency` → `EUR`,
  `isAdr`/`isFrigo`/`palletExchange` → `false`. `pricePerKm` = price ÷
  distance (`price-per-km.ts`; a price of 0 is a rate of 0, no price or no
  positive distance → none). The total cost, profit and margin are not
  request fields: `offer-economics.ts` computes them on save through
  `offerCost` (the company cost per km × km + toll, in the offer currency;
  without a toll the margin is an upper bound, `marginWithoutTolls: true`).
  Manual fuel and toll entries are stored. After the write
  `afterOfferCreated` queues the offer for matching against active demands
  (`DemandsService`) and clears the offer cache. An offer created from an
  e-mail goes through the same method (`email-agent`, after its transaction).
- **Update**: only part of the DTO is stored (cities, countries, postal codes,
  pickup/delivery dates, cargo type, weight, volume, price, currency, rate,
  distance, fuel and toll estimates, notes, client, contact). A new price or
  distance recomputes `pricePerKm`; a new price, currency, distance or manual
  toll recomputes the cost, profit and margin (with the planner route when
  there is one); otherwise they stay.
- **Assigning and status**: `assign` saves the person and `ASSIGNED`;
  `/status` refuses `ASSIGNED` (`OFFER_ASSIGN_VIA_ASSIGN` — the status without
  a person would be untrue). Back to `NEW` clears the person; later statuses
  keep it.
- **The blacklist on acceptance**: every move into a revenue status
  (`ACCEPTED`, `IN_TRANSIT`, `COMPLETED`) from a non-revenue one, for an offer
  from a contractor on the caller's company blacklist (looked up in that company — a contractor
  of another company does not count) is refused unless the role is `ADMIN`
  (the database knows `ADMIN` and `DISPATCHER`; there is no manager role).
  An ADMIN's acceptance is logged as a warning: the offer, the contractor
  (id and name), the user id and the time. The trace is in the process log
  only, not in the database — keep the logs or add an audit table. Offers
  accepted before stay. The list and the offer page carry
  `contractorBlacklisted` (only a contractor of the offer's own company) so the
  screens can disable the button. Moves between revenue statuses are not
  checked (the offer is already taken). There are no other transition rules.
- **The offer's contractor** (`PATCH /offers/:id`, `contractorId`): a contractor
  of the caller's company (`400 OFFER_CONTRACTOR_NOT_FOUND` otherwise); `null`
  or empty — none. Detaching or replacing a blacklisted contractor is for an
  ADMIN only (`403 CONTRACTOR_BLACKLIST_ADMIN_ONLY`, logged) — otherwise
  "detach, then accept" would get round the block. The new-offer form has a
  contractor list ([decisions §3b](../../../../docs/decisions.md)).
- **Import** (`importOffers`):
  1. `source` is mapped case-insensitively (`manual`, `api`, `email`,
     `generic`); any other key becomes `GENERIC`.
  2. Each row is checked on its own (`import-row.ts`, `checkImportRow`): it is
     an object; its fields follow `RawOfferDto` (required fields, types,
     numbers from strings, nothing outside the schema); it is normalised
     (`normalizeRawOffer`: city names trimmed, two-letter country codes and the
     currency upper-cased, `DD.MM.YYYY` and `DD/MM/YYYY` dates turned into
     `YYYY-MM-DD`); its dates are readable; the price and the rate (given or
     computed) fit DECIMAL(10,2). A bad row goes to `rejected` as
     `{ row, field, code }` — `row` is the index in `offers` from 0, `field`
     the field (`null` = not an object), `code` one of
     `IMPORT_ROW_FIELD_INVALID`, `IMPORT_ROW_DATE_INVALID`,
     `OFFER_VALUE_OUT_OF_RANGE`; the other rows continue. A missing currency
     becomes EUR; nothing else is filled in.
  3. `pricePerKm` is computed as price ÷ distance (`price-per-km.ts`, as on
     create) only when the source gave no rate, a price is known and the
     distance is above 0.
  4. `0` is a value: numeric columns use `??` / `!= null`, so a weight, price or distance of 0,
     a rate of 0 and 0°C are stored as 0, not NULL (docs/decisions.md §2).
  5. `createMany({ skipDuplicates: true })` against the unique
     `(companyId, source, externalId)`; `duplicates` = prepared − inserted.
  6. The inserted rows are read back by their shared `importedAt` stamp, and
     only those rows (with their database `id`) are queued for demand
     matching.
- **Demand matching** is queued (`common/queue`) and does not block the write;
  a failure is logged with the offer id, not swallowed.
- **Statistics**: amounts are converted to `Company.costCurrency` through
  `common/money.ts` / `common/fx.ts` (not `_sum`/`_avg` in the database); an
  amount in a currency without a rate is left out and counted
  (`TOTAL_EXCLUDES_UNCONVERTED`, `FX_RATE_STATIC` per rate used).
- **Restoring** (`EXPIRED` or `REJECTED` → `NEW`, "Przywróć (Nowa)"): only a
  live offer — a dead one (`deadReason`, the full rule with the age
  threshold) would silently go back to `EXPIRED` on the next run of the
  expiry task (`common/tasks`), so it gets `400 OFFER_STILL_DEAD { reason }`
  and nothing is written. `ASSIGNED` → `NEW` (unassigning) is not blocked.
  After the loading date or `expiresAt` is changed with `PATCH /offers/:id`
  (`expiresAt`: a date or `null` = no deadline), restoring goes through; an
  offer older than 7 days cannot be restored — add it again. The sentences
  point to "Edytuj ofertę" on the offer page, where both dates are changed.
- **Editing an accepted offer**: in `ACCEPTED`, `IN_TRANSIT` and `COMPLETED`
  the price, currency, distance, manual toll, loading and unloading dates,
  validity, cities and countries (`OFFER_LOCKED_FIELDS`) are changed by an
  ADMIN only; another role → `403 OFFER_FIELDS_ADMIN_ONLY { fields }`, nothing
  written. An ADMIN's change is logged (who, when, field, from → to). Notes,
  contact, cargo, weight and postal codes — anyone. "A change" = a value
  different from the offer's, by the same rules as saving (a form may send
  everything). Other statuses — anyone edits everything.
- **The edit screen** (`/offers/:id/edit`, "Edytuj ofertę" on the offer page):
  loading date, validity, price, currency, distance, manual toll, contractor,
  notes; it sends only the changed fields (cleared → `null`), shows the locked
  fields read-only to a non-ADMIN and the margin preview of `economics-preview`
  with `offerId` ([decisions §3a](../../../../docs/decisions.md)).
- **Cache**: list pages are cached for 30 s per company and query; every write
  in this module clears the company's offer cache.

## Message codes

Returned as `{ code, params }`; the web app turns them into text
(`apps/web/src/lib/plan-messages.ts`).

- `OFFER_CONTRACTOR_NOT_FOUND`, `OFFER_ASSIGNEE_NOT_FOUND`.
- `OFFER_CONTRACTOR_BLACKLISTED` — 400: only an ADMIN may move an offer from
  a blacklisted contractor into a revenue status; in LTL the same code blocks
  the card.
- `CONTRACTOR_BLACKLIST_ADMIN_ONLY` — 403: only an ADMIN detaches or replaces a
  blacklisted contractor on an offer.
- `OFFER_FIELD_NOT_EDITABLE` — 400 (`field`: `source` | `externalId`): the
  offer's origin and import key are not edited.
- `OFFER_FIELDS_ADMIN_ONLY` — 403 (`fields`: the changed locked fields): an
  accepted / in-transit / completed offer's money, dates and places are for an
  ADMIN only.
- `OFFER_ASSIGN_VIA_ASSIGN` — 400: the `ASSIGNED` status is set only by
  assigning a person.
- `OFFER_STILL_DEAD` — 400 (`reason`: `PICKUP_PASSED` | `EXPIRED` |
  `TOO_OLD`): restoring a dead offer to `NEW`.

The statistics carry the money codes of `common/money.ts`
(`FX_RATE_STATIC`, `TOTAL_EXCLUDES_UNCONVERTED`).

## Tests

```bash
cd apps/api
npx jest test/unit/offers.import test/unit/import-rejected-rows test/unit/zero-is-a-value test/unit/cross-tenant-references test/unit/dashboard-money test/unit/no-fake-offer-analysis test/unit/notifications.contract test/unit/offer-still-dead
```

| Test | Covers |
|---|---|
| `test/unit/offer-economics.spec.ts` | The cost, profit and margin through `offerCost` (route, manual toll, upper bound without a toll, no rate/distance/price/rate of exchange, price 0, column range); where they are computed (create, edit, import, e-mail, the planner); the averages and the margin sort; the heuristic `uncertain` |
| `test/unit/offer-update-fields.spec.ts` | Every field of the update DTO (walked from its metadata) is saved or answers 400 — a new field breaks the test until decided; `source`/`externalId` refused unless unchanged; `null` clears, the flags become `false`; the cargo fields are free after acceptance; the list cache is cleared and matching, LTL and negotiation have no cache |
| `test/unit/offer-edit-h4b.spec.ts` | Every revenue status × every locked field for a DISPATCHER → 403 naming the field, nothing written; ADMIN saved and logged (who, field, from → to); notes and contact free; the same values free; non-revenue statuses free; the real controller with a DISPATCHER token; the edit preview = what `PATCH` saves (4 cases), the saved route counts, another company's offer 404 |
| `test/unit/blacklist-h3.spec.ts` | Every non-revenue → revenue move for DISPATCHER (400) and ADMIN (logged), moves inside revenue statuses free; the real controllers with a DISPATCHER token; `contractorId` in `PATCH` (own company, `null`/empty, a blacklisted one only by an ADMIN); an inactive blacklisted contractor still blocks |
| `test/unit/blacklist-consistent.spec.ts` | Accepting from a blacklisted contractor: DISPATCHER 400, ADMIN passes and is logged, another company's contractor does not count, other statuses free; `contractorBlacklisted` on the list and the page; LTL last, blocked, own limit; the negotiation argument first |
| `test/unit/offers-forms.spec.ts` | `/status` refuses `ASSIGNED`, back to `NEW` clears the person, later statuses keep it; the computed fields refused in the create and edit body; the rate per km on create and on a price/distance change (the old margin, profit and cost cleared); the vehicle edit's `null` values pass validation and clear the columns |
| `test/unit/offer-still-dead.spec.ts` | Restoring `EXPIRED`/`REJECTED` → `NEW`: each dead reason → 400 `OFFER_STILL_DEAD`, nothing written; the pickup-country day (and the company country outside the map); live offers and `ASSIGNED` → `NEW` pass; `PATCH` saves `expiresAt` (a date, `null`, untouched when not sent); after moving the loading date, restoring passes |
| `test/unit/offers.import.spec.ts` | Import: matching only for inserted rows, with database ids; counts, rejected rows, cache |
| `test/unit/import-rejected-rows.spec.ts` | Every bad row comes back as `{ row, field, code }` (missing field, wrong type, unknown field, unreadable date, amount over DECIMAL(10,2), also the computed rate), the valid rows are saved |
| `test/integration/import-dedup.int-spec.ts` | On PostgreSQL in `tools/demo-test.sh`: re-import of the same `externalId`s doubles nothing, another source is another offer, a bad row does not break the batch; a row without `externalId` is doubled (known) |
| `test/unit/zero-is-a-value.spec.ts` | 0 survives the import (temperatures, weight, volume, price, rate, distance) and its effect in risk analysis and LTL |
| `test/unit/dto-classes.spec.ts` | Import body and rows validated: a missing required field or a field outside the schema → 400; numbers sent as strings converted |
| `test/unit/offer-update-coordinates.spec.ts` | A changed pickup or delivery place clears its coordinates and `coordsCheckedAt`; the same place written differently does not |
| `test/unit/cross-tenant-references.spec.ts` | Assignee and contractor only from the caller's company |
| `test/unit/dashboard-money.spec.ts` | `GET /offers/stats` amounts in the company currency through fx |
| `test/unit/no-fake-offer-analysis.spec.ts` | No `OfferAnalysis` in schema, seed or offer responses |
| `test/unit/notifications.contract.spec.ts` | A demand-matching failure is logged, not swallowed |

## Known limits

See also [docs/known-issues.md](../../../../docs/known-issues.md)
("API correctness", "Security").

- An imported offer without `externalId` is never a duplicate (NULLs are
  distinct in the unique index), so importing it twice stores it twice.
  Recommended: the source assigns `externalId` (e.g. file name + row
  number). No key is derived from route, date and price — regular lanes
  carry identical offers.
- `update` saves every field of its body except the source and the external
  id — the offer's origin and its import key — which answer
  `400 OFFER_FIELD_NOT_EDITABLE { field }` when changed (the same value
  passes). `null` clears a field; the flags `isAdr`, `isFrigo` and
  `palletExchange` become `false`. A changed city or country clears that end's
  coordinates, so the offer waits for geocoding again.
- `PATCH /offers/:id/status` accepts any status from any status, except
  `ASSIGNED` (only by assigning), a revenue status for a blacklisted
  contractor (ADMIN only) and restoring a dead offer to `NEW`.
- Offers from e-mail and import have no contractor until someone sets it
  (the edit screen or `PATCH /offers/:id`).
- Role checks only for the blacklist and for the locked fields of an accepted
  offer: otherwise any user of the company can create, change or delete offers.
- `search` matches the country exactly (case-sensitive) and the postal code by
  prefix; it is not a radius search.
- Validation messages (`dto/create-offer.dto.ts`) and the `404` text are
  Polish text, not codes.
