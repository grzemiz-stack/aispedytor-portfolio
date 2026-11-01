# prisma — database schema, migrations and seed

The PostgreSQL schema (Prisma 5), its migration history and the seed that
fills a development database with demo data. The NestJS side is
`src/prisma/`: `PrismaService` (a `PrismaClient` that connects when the
module starts and disconnects when it is destroyed) and the global
`PrismaModule` that provides it to every module.

## Files

| File | What it does |
|---|---|
| `schema.prisma` | Models, enums, column names (`@map`), indexes. The client is generated for the native platform and for Linux (musl and Debian, OpenSSL 3). |
| `migrations/` | Migration history, applied in order by `prisma migrate deploy`. Some contain `CHECK` constraints that Prisma cannot express (see below). |
| `seed.ts` | The seed: demo company, accounts, vehicles, contractors, offers, notifications. Run by `npm run db:seed` / `prisma db seed` (`tsx prisma/seed.ts`). |
| `seed-guard.ts` | Lets the seed run only with an explicit `NODE_ENV=development` or `test`; anything else, or no `NODE_ENV`, is refused (exit code 1). |
| `seed-cities.ts` | Coordinates of every city the seed uses; every seed offer gets coordinates. |
| `seed-vehicles.ts` | Extra seed vehicles: tractors with attached semi-trailers, a rigid truck, a van. Definitions only. |
| `seed-demo-ltl.ts` | The LTL demo scenario (Poznań, PL → Berlin, DE), recreated on every run. |
| `../src/prisma/prisma.service.ts`, `prisma.module.ts` | The Prisma client as a NestJS provider. |

## Endpoints

None. `src/prisma` only provides `PrismaService` (the database client) to the other modules.

## Message codes

None.

## Schema overview

Every business table carries `companyId`; the API scopes every query by the
caller's company (docs/decisions.md §8).

| Model (table) | What it holds |
|---|---|
| `Company` (`companies`) | Company data, logo, `settings`, `costPerKm` and `costCurrency` (the basis of the LTL ranking, docs/decisions.md §3). `subscriptionPlan` and `maxDispatchers` are stored but nothing is enforced. |
| `User` (`users`) | Accounts. E-mail, names and phone are stored AES-256-GCM encrypted; login looks users up by `emailHash` (HMAC-SHA256). Roles `ADMIN`, `DISPATCHER`. |
| `RefreshToken` (`refresh_tokens`) | Refresh tokens as SHA-256 (`token_hash`) — the token itself is only with the client; `family_id` and `used_at` detect the reuse of a rotated token (the whole family is revoked). |
| `Vehicle` (`vehicles`) | Fleet records. `vehicleCategory` is TEXT with a `CHECK` (`TRUCK`, `RIGID`, `SEMI_TRAILER`, `TRAILER`, `VAN`); a semi-trailer or trailer points to its towing vehicle through `parentVehicleId`. `axleCount` is the axles of that record only. `grossVehicleWeightKg` / `curbWeightKg` are optional in the schema but required by LTL. |
| `Offer` (`offers`) | Transport offers: route with optional coordinates, cargo, ADR/reefer, price, cost estimates, status. Unique on (`companyId`, `source`, `externalId`). |
| `GeocodeCache` (`geocode_cache`) | Nominatim results shared by all companies; "not found" is remembered for 7 days, network errors are not stored. |
| `RouteCalculation` (`route_calculations`) | A route planner result saved with an offer — only with a complete toll from a toll provider, named in `tollSource`; `axleClass` (`2`/`3`/`4`/`5+`) and `axleClassDefaulted` decide whether LTL may use it for a detour toll. Separate from `Offer.tollCostEstimate` (the dispatcher's manual value). |
| `Contractor` (`contractors`) | Counterparties with payment rating (1–5), reliability (0–100), blacklist flag. |
| `DispatcherDemand` (`dispatcher_demands`) | A dispatcher's demand for loads; most fields are stored but not used for matching (known issues). |
| `Notification` (`notifications`) | Notifications per user; created by `demands` and `vehicles`. |
| `EmailMessage` (`email_messages`) | E-mails classified by the e-mail module, with extracted fields and the LLM result. |
| `Driver` (`drivers`) | Fleet planning: the company's drivers, optionally attached to one vehicle. |
| `DriverStatus` (`driver_statuses`) | Fleet planning: the manual driver status (rests, driving and work counters), append-only — the newest row is current; unknown values are `NULL` and taken at their worst. |
| `ExchangeConnection`, `PublishedOffer` | Trans.eu / Timocom OAuth connections (tokens encrypted) and the history of offers published on exchanges. |

Constraints added in SQL, not visible in `schema.prisma`:

- `companies`: `cost_per_km > 0`, `cost_currency IN ('PLN', 'EUR', 'GBP')`
  (must equal `COMPANY_CURRENCIES`, checked by `test/unit/company-currency-check.spec.ts`);
- `vehicles`: the category list (must equal `VEHICLE_CATEGORIES`, checked by
  `test/unit/vehicle-category-check.spec.ts`);
- `geocode_cache`: "found" has both coordinates, "not found" none; latitude
  and longitude ranges;
- `route_calculations`: `axle_class IN ('2', '3', '4', '5+')`; a defaulted
  class requires a class.

## Migrations

```bash
cd apps/api
npx prisma migrate deploy        # or: npm run db:migrate:deploy
npx prisma generate              # or: npm run db:generate
```

- Use `migrate deploy` on any shared or production database; `prisma migrate
  dev` (`npm run db:migrate`) only on your own development database.
- The API `start` script runs `migrate deploy` itself, after marking
  `20260312000000_vehicle_category_trailers` as rolled back — a leftover
  workaround listed in docs/known-issues.md, to be removed before production.
- **Back up before migrating.** These migrations remove or rewrite data on
  purpose:

| Migration | What it removes or changes |
|---|---|
| `20260507062331_remove_orphan_cmrbox_models` | Drops 5 tables (`dispatch_logs`, `transport_documents`, `document_batches`, `dispatch_configs`, `drivers`) and 7 enum types of a module that is no longer part of this codebase (`IF EXISTS … CASCADE`). |
| `20260903010000_drop_demand_match_count` | Drops `dispatcher_demands.match_count`; the count is now computed on read. Irreversible. |
| `20260904000000_drop_exchange_scraping_columns` | Drops `offers.raw_data`, `offers.source_url`, `offers.scraped_at`, `contractors.source_platform`. |
| `20260904100000_drop_offer_search_radius` | Drops `offers.search_radius`. |
| `20260930090000_swap_trailer_category_codes` | Swaps the stored values `TRAILER` ↔ `SEMI_TRAILER` (codes now carry their English meaning). |
| `20261001090000_company_cost_per_km` | Sets `cost_currency` of every existing company from its country (GB → GBP, euro area → EUR, otherwise PLN). |
| `20261005120000_route_calculations_toll_source` | Deletes **all** rows of `route_calculations` (their toll did not come from a provider), then adds `toll_source`. |
| `20261005130000_drop_trial_and_ai_limit` | Drops `companies.trial_ends_at`, `ai_calls_today`, `ai_calls_date`, `ai_calls_limit`. |
| `20261005140000_drop_offer_analysis` | Drops the `offer_analyses` table. |
| `20261010120000_driver_status_on_duty` | Adds `driver_statuses.on_duty`, set from whether a daily rest ended (no data lost). |
| `20261010130000_refresh_token_family` | Adds `family_id` and `used_at`; every existing token becomes its own family (nobody is logged out). |
| `20261010140000_refresh_token_hash` | Stores the SHA-256 of every refresh token, then **drops the plain `token` column**. Needs PostgreSQL 11+ (`sha256()`); the whole history needs 12 (DEPLOYMENT). |
| `20261011120000_contractor_total_orders_on_read` | Drops `contractors.total_orders` — the count is now computed on read. Irreversible. |
| `20261011150000_offer_margin_without_tolls` | Adds `offers.margin_without_tolls`; existing margins get `false`. Run `offers:recompute-economics` right after (docs/DEPLOYMENT.md). |

## Seed

```bash
npm run db:seed                  # from the repository root, or in apps/api: npx prisma db seed
```

Needs `DATABASE_URL` and `ENCRYPTION_KEY` (the same key as the API — the seed
encrypts users' personal data with it and has no fallback value).

**Everything the seed creates is test data.** It creates one company
(`SpedycjaPlus Sp. z o.o.`, cost 4.20 PLN/km) and these accounts with public
passwords:

| E-mail | Password | Role |
|---|---|---|
| admin@spedytor.example.com | Admin1234! | ADMIN |
| jan.kowalski@spedytor.example.com | Disp1234! | DISPATCHER |
| anna.nowak@spedytor.example.com | Disp1234! | DISPATCHER |

plus vehicles (tractors with semi-trailers, a rigid truck, a van — all with
gross and curb weight), 13 contractors, sample, demo, 100 bulk and 15 LTL
offers (all with coordinates), one dispatcher demand and 20 notifications.

**The seed runs only with an explicit `NODE_ENV=development` or `test`**
(`seed-guard.ts`): with `production`, any other value or no `NODE_ENV` it
prints the refusal and exits with code 1 as its first statement, before it
connects to the database or reads the encryption key. There is no override;
a production database starts empty.

Running it again is safe: accounts are upserted, most blocks are skipped
when their data exists, coordinates and vehicle weights are refreshed, and
the LTL demo offers (`LTLDEMO-*`) are deleted and recreated with pickup dates
from today+1 to today+5. `SEED_NOW` (an ISO date) moves the demo clock.

## Tests

| Test | Covers |
|---|---|
| `test/unit/seed-production-guard.spec.ts` | The refusal in production, run as a real process; the guard is the first statement |
| `test/unit/seed-cities.spec.ts` | Every city in the seed has coordinates; coordinates are plausible |
| `test/unit/seed-vehicles.spec.ts` | Seed vehicles: complete records, curb weight + payload ≤ gross weight, axle classes |
| `test/unit/seed-demo-ltl.spec.ts` | Demo scenario definitions and geocode cache keys |
| `test/unit/company-currency-check.spec.ts`, `test/unit/vehicle-category-check.spec.ts` | SQL `CHECK` lists equal the lists in code |
| `test/unit/no-fake-offer-analysis.spec.ts` | `OfferAnalysis` is gone from schema and seed |
| `test/integration/demo-ltl.int-spec.ts`, `test/integration/demo-ltl-today.int-spec.ts` | Migrations + seed + LTL search on a real PostgreSQL (`tools/demo-test.sh`) |

## Known limits

See also [docs/known-issues.md](../../../docs/known-issues.md).

- Cargo dimensions and weights of seed vehicles sit on the tractor record,
  not on the attached semi-trailer (this is also where LTL reads them).
- `route_calculations.toll_needs_verification` is always written as `false`
  and `toll_unresolved` is always empty for new rows; the columns stay for
  older readers.
- Seed texts (company, cargo, notifications, console output) are Polish.
- Bulk and LTL seed prices are generated with a fixed 4.5 PLN/EUR, not with
  `common/fx.ts`; LTL seed offers use `Math.random()`, so their prices differ
  between databases.
- No toll provider is registered, so the demo ranks without detour toll.
