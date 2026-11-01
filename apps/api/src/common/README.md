# common — shared helpers of the API

Rules and infrastructure used by more than one module: message codes,
exchange rates, ADR and reefer compatibility, vehicle categories and axle
classes, secrets, Swagger, the in-process cache and queue, encryption,
guards, scheduled tasks and Sentry. Most of the domain files are pure
functions with no Nest dependency.

## Files

| File | What it does |
|---|---|
| `plan-messages.ts` | The list of message codes (`PLAN_MESSAGE_CODES`), `msg()`, `dedupeMessages()`. |
| `fx.ts` | The only exchange-rate table; `convert()`. |
| `money.ts` | Sums and averages in the company's currency (`MoneyInCompanyCurrency`, `companyCurrency()`). |
| `adr.ts` | ADR rule: `parseAdrClasses()`, `adrCompatibility()`. |
| `reefer.ts` | Reefer rule: `isReefer()`, `requiresReefer()`. |
| `axle-class.ts` | Toll axle class: `axleClassForCount()`, `plannerAxleClass()`, `combinationAxleClass()`. |
| `vehicle-category.ts` | Vehicle categories and the attachment rule (`attachmentProblem()`). |
| `counterparty-risk.ts` | `counterpartyRisk()` — blacklist, payment, reliability. |
| `country-timezone.ts` | Country → time zone map, pickup-day zone, `calendarDate()`. |
| `company-currency.ts` | Company currencies, euro-area list, `currencyForCountry()`. |
| `config/secrets.ts` | `JWT_SECRET` / `ENCRYPTION_KEY` checks; `validateEnv()` for `ConfigModule`. |
| `db-limits.ts` | `DECIMAL_10_2_MAX` (99,999,999.99) and `fitsMoneyColumn()` — an amount from outside is checked before it reaches a DECIMAL(10,2) column. |
| `dto/is-iso-date-or-empty.decorator.ts` | `IsIsoDateOrEmpty()`: an ISO 8601 date checked strictly, or `''` (clears a date). |
| `config/node-env.ts` | `isExplicitDevOrTest()` (only an explicit `NODE_ENV=development\|test`), `flagOn()` (only `true`). |
| `config/swagger.ts` | `swaggerEnabled()`, `setupSwagger()` (called from `main.ts`). |
| `config/registration.ts` | `registrationEnabled()` and `RegistrationEnabledGuard` on `POST /api/auth/register`. |
| `offer-cost.ts` | `offerCost()` / `costIn()`: the offer cost = the company cost per km × km + toll, for negotiation and the route planner; the codes below when it is an estimate, without tolls or not there. |
| `config/startup-report.ts` | `startupReport()` / `logStartupReport()` (called from `main.ts` after `listen`): the environment, Swagger and registration on/off with the reason; a warning for `NODE_ENV=development` with a non-localhost `FRONTEND_URL`. |
| `config/body-limits.ts` | `allowLargeLogoBody()` (called from `main.ts`): a 1 MB JSON limit for the logo route only; other routes keep Nest's 100 kB. |
| `cache/` | `MemoryCacheService` — global in-process key/value cache with TTL. |
| `queue/` | `TaskQueueService` — global in-process task queue. |
| `encryption/` | `EncryptionService` — AES-256-GCM and HMAC-SHA256. |
| `guards/` | `RolesGuard` (with `decorators/roles.decorator.ts`). |
| `tasks/` | Cron jobs: `OfferExpiryTask`, `DataRetentionTask`. |
| `sentry/` | `initSentry()`, `SentryGlobalFilter`, `SentryPerformanceInterceptor`. |
| `interceptors/api-logging.interceptor.ts` | One log line per request: method, URL, status, time, user, company. |
| `filters/throttle-exception.filter.ts` | 429 response for the rate limiter. |
| `decorators/current-user.decorator.ts` | `@CurrentUser()` — the user, or one field of it, from the request. |
| `types/authenticated-request.ts` | `JwtUser`, `AuthenticatedRequest`, `MaybeAuthenticatedRequest`. |
| `dto/pagination.dto.ts` | `PaginationDto` (`page` ≥ 1, `limit` 1–100, `sortBy`, `sortOrder`) and `buildPaginatedResponse()`. |

## Endpoints

None. `common` has no controller; it is used by the other modules and by
`main.ts` / `app.module.ts`.

## The helpers

### fx — exchange rates

`convert(amount, from, to)` uses a static table of EUR rates (EUR, PLN, CZK,
HUF, CHF, GBP, DKK, SEK, NOK, BGN, RON). Currency codes are trimmed and
upper-cased. Same currency → rate 1, no message. Otherwise the result carries
`FX_RATE_STATIC { from, to, rate }` (rate rounded to 4 decimals in the
message only). A currency not in the table → `ok: false` with
`CURRENCY_CONVERSION_UNAVAILABLE { from, to }` — no amount, never 0.
Used by LTL, dashboard/analytics (through `money.ts`), the route planner,
negotiation and the offer score (docs/decisions.md §4).

### money — totals in the company's currency

`companyCurrency(prisma, companyId)` reads `Company.costCurrency` (PLN when
there is none). `MoneyInCompanyCurrency` converts each row through `fx.ts`;
`sum()` and `average()` leave out empty values and rows without a rate.
`summary()` returns `{ currency, codes, unconverted }`: `FX_RATE_STATIC` once
per currency pair, and for skipped rows one
`TOTAL_EXCLUDES_UNCONVERTED { count, from, to }` (a row skipped in both the
sum and the average counts once).

### plan-messages — codes, not sentences

The API returns `{ code, params }`; the web app builds the sentence
(`apps/web/src/lib/plan-messages.ts`, a test there fails when a code has no
translation). `msg()` drops empty `params`; `dedupeMessages()` removes
duplicates by content (code + params), keeping the order. Every code the API
may return must be in `PLAN_MESSAGE_CODES` (docs/decisions.md §1).

### adr — ADR compatibility

`parseAdrClasses()` reads free text ("3", "Klasa 3", "kl. 4.1", "3, 8",
"3/8", "4,1") into classes 1–9 (with 4.1–4.3, 5.1–5.2, 6.1–6.2); divisions
1.x and 2.x count as 1 and 2; a bare "4", "5", "6" and "1,3" / "2,3" are
unrecognized. `adrCompatibility(offer, vehicle)`:

- not ADR (`isAdr` false and no class) → nothing;
- vehicle without `hasAdr` → `OFFER_ADR_VEHICLE_NOT_CERTIFIED`;
- ADR offer without a class → warning `OFFER_ADR_CLASS_NOT_GIVEN` (not a block);
- class not readable → `OFFER_ADR_CLASS_UNRECOGNIZED`;
- vehicle has ADR but no readable classes → `OFFER_ADR_CLASSES_UNKNOWN`;
- an offer class outside the vehicle's → `OFFER_ADR_CLASS_NOT_ALLOWED`.

A class given with `isAdr = false` is treated as ADR. Used by LTL and
`matching` (docs/decisions.md §6).

### reefer

`isReefer(vehicle)`: `vehicleType === 'REFRIGERATED'` or `trailerType ===
'REEFER'` on the record or on an attached unit. `requiresReefer(offer)`:
`isFrigo`, or any `temperatureMin` / `temperatureMax` (0 °C counts). Used by
LTL, `matching` and `risk-analysis`.

### axle-class

Buckets `2 | 3 | 4 | 5+` (fewer than 3 axles → `2`).
`plannerAxleClass(count)` — no count → `5+` with `defaulted: true`.
`combinationAxleClass(vehicle)` — axles of the record plus attached units;
`null` with a reason instead of a guess: `TOWED_UNIT` (the record is a
semi-trailer/trailer), `TRACTOR_WITHOUT_TRAILER` (also when the category is
empty — the database default is `TRUCK`), `AXLE_COUNT_MISSING`. The planner
uses the first, LTL the second (docs/decisions.md §7).

### vehicle-category

`VEHICLE_CATEGORIES`: `TRUCK` (tractor), `RIGID`, `SEMI_TRAILER`, `TRAILER`
(drawbar trailer), `VAN`; the database `CHECK` has the same list (tested).
A `SEMI_TRAILER` may be attached only under a `TRUCK`, a `TRAILER` only under
a `RIGID` or `VAN`. `attachmentProblem(child, parent)` returns `null` or
`VEHICLE_ATTACH_NOT_TOWED` / `VEHICLE_ATTACH_WRONG_PARENT`. The vehicles
service uses it on every write.

### counterparty-risk

`counterpartyRisk(contractor)` returns the criteria that fire:
`BLACKLIST` (`isBlacklisted`), `PAYMENT` (`paymentRating` ≤ 2),
`RELIABILITY` (`reliabilityScore` < 40). Missing values are not a risk; 0 is
a value. The LTL card shows `PAYMENT` and `RELIABILITY` as warnings and blocks
the offer on `BLACKLIST` (`blockedBy`); negotiation names the blacklist in its
first argument and reacts to `PAYMENT`; accepting a blacklisted contractor's
offer is for an ADMIN only (offers module).

### country-timezone

`COUNTRY_TIMEZONES` maps 31 European country codes to IANA zones (mainland
only). `resolvePickupTimeZone(pickup, company)` → the pickup country's zone,
else the company country's, else `Europe/Warsaw`, with `assumed: true` when
the pickup country was not in the map. `calendarDate(instant, zone)` →
`YYYY-MM-DD` in that zone. Used by LTL for "pickup day passed" and
availability.

### company-currency

`COMPANY_CURRENCIES` = PLN, EUR, GBP (same as the database `CHECK`).
`currencyForCountry(country)`: GB → GBP, euro-area members (21, Bulgaria
included) → EUR, everything else (including CH, CZ, empty) → PLN. Used at
registration; migration `20261001090000` backfills with the same list (tested).

### config/secrets

`validateEnv()` runs in `ConfigModule.forRoot({ validate })`; any problem
stops the start with all problems listed and the `openssl` commands to
generate secrets. `JWT_SECRET`: set, not one of the known placeholder
values listed in `config/secrets.ts`, at least 32 characters. `ENCRYPTION_KEY`: 64 hex characters, not all zeros.
`requireJwtSecret()` / `requireEncryptionKey()` apply the same rule outside
`ConfigModule` (`EncryptionService`, `JwtStrategy`). The problem texts are
English.

### config/swagger

`swaggerEnabled()`: on with an explicit `NODE_ENV=development` or `test`;
otherwise — also with no `NODE_ENV` — only with `SWAGGER_ENABLED=true`
(case-insensitive). `setupSwagger(app)` then serves
`/api/docs`, `/api/docs-json` and `/api/docs-yaml` with no key; otherwise
these routes do not exist (404). Tag descriptions are set here.

### config/registration

`registrationEnabled()`: the same rule with `REGISTRATION_ENABLED`.
`RegistrationEnabledGuard` sits on `POST /api/auth/register`: off → 403
`REGISTRATION_DISABLED`, before body validation and before any database
access; the environment is read on every request. The first company on a
server: `npm run company:create` (`src/cli/create-company.ts`).

### cache

`MemoryCacheService` (global, `CacheModule`): `get`, `set(key, value,
ttlSeconds)`, `has`, `delete`, `deleteByPrefix`, `clear`, `getStats()` (size,
hits, misses, hit rate), `buildKey()`, `hashQuery()`. Expired entries are
removed on read and by a sweep every 60 s. In-process only.

### queue

`TaskQueueService` (global, `QueueModule`): `enqueue(fn, priority)` returns
the task's promise; higher priority first; at most 3 tasks at a time; a
failed task is retried once. `getStats()` gives pending / active / processed
/ failed. In-process only; queued tasks are lost on restart.

### encryption

`EncryptionService` (global): `encrypt()` / `decrypt()` with AES-256-GCM
(`iv:authTag:data` in hex, random 12-byte IV), `hash()` = HMAC-SHA256 of the
lower-cased text with the same key (used to look up users by encrypted
e-mail). The key comes from `ENCRYPTION_KEY`; without a valid key the service
throws. Changing the key makes existing encrypted data unreadable.

### guards

- `RolesGuard` + `@Roles(...)`: a route with roles requires `req.user.role`
  to be one of them (403 otherwise); a route without `@Roles` passes. Used on
  `users` and `companies` (ADMIN).
- The company of a request comes only from the token (`req.user.companyId`):
  no route takes `companyId` from the path, query or body
  (`test/unit/company-from-token.spec.ts`).

### tasks

Registered in `app.module.ts` (`@nestjs/schedule`):

- `OfferExpiryTask`, every hour: `NEW` offers that are dead by the LTL rule
  (`deadReason` in `ltl-matching/offer-compatibility.ts`) → `EXPIRED` — a
  passed `expiresAt`, older than 7 days, or the loading day before today in
  the pickup country's zone (a country outside the map → the company
  country). The query reads candidates with no gaps (`expiresAt` ≤ now, the
  age, or a loading instant before now), 1000 per page by id; the write is
  guarded by status `NEW`, so an offer assigned meanwhile does not expire.
  `ASSIGNED` offers are left alone. No notifications and no reason stored in
  the database; the log line counts by reason
  (`[OfferExpiry] Expired N offers (EXPIRED a, TOO_OLD b, PICKUP_PASSED c)`);
  the offer list cache of each affected company is cleared.
- `DataRetentionTask`, Sundays 02:00: deletes refresh tokens created more than
  30 days ago and read notifications older than 60 days.

### sentry

`initSentry()` (start of `main.ts`) is a no-op without `SENTRY_DSN`;
otherwise 20 % trace sampling, 401/404 dropped, `sendDefaultPii: false`, no
request bodies recorded, console breadcrumbs off, and `scrubRequest` on every
event and transaction (no body, headers, cookies or query; addresses and span
data without the query); breadcrumbs keep their address without the query
(`scrubBreadcrumb`). Checked on the real SDK with a local receiver
(`test/unit/sentry-real-sdk.spec.ts`). `SentryGlobalFilter` (global) reports
only 5xx, with endpoint, user id, company id and the field NAMES of the body
and query (never their values — `sentry-no-request-data.spec.ts`), and answers
with the exception's response (or 500). `SentryPerformanceInterceptor`
sends a warning for requests slower than 3 s.

### Other global pieces

`main.ts` registers `SentryGlobalFilter` and `ThrottleExceptionFilter`
(429 with a Polish message; the limit is 100 requests per 60 s from
`app.module.ts`), and the interceptors `SentryPerformanceInterceptor` and
`ApiLoggingInterceptor` (logs no bodies; `sanitize()` exists but is unused).

## Message codes

Emitted by `common` files:

- ADR (`adr.ts`): `OFFER_ADR_VEHICLE_NOT_CERTIFIED`,
  `OFFER_ADR_CLASS_NOT_GIVEN`, `OFFER_ADR_CLASS_UNRECOGNIZED`,
  `OFFER_ADR_CLASSES_UNKNOWN`, `OFFER_ADR_CLASS_NOT_ALLOWED`.
- Rates (`fx.ts`, `money.ts`): `FX_RATE_STATIC`,
  `CURRENCY_CONVERSION_UNAVAILABLE`, `TOTAL_EXCLUDES_UNCONVERTED`.
- Attachment (`vehicle-category.ts`): `VEHICLE_ATTACH_NOT_TOWED`,
  `VEHICLE_ATTACH_WRONG_PARENT`.
- Registration (`config/registration.ts`): `REGISTRATION_DISABLED`.
- Import rows and amounts (the codes are listed in `plan-messages.ts`, returned by `offers` and `email-agent`): `IMPORT_ROW_FIELD_INVALID`, `IMPORT_ROW_DATE_INVALID`, `OFFER_VALUE_OUT_OF_RANGE`.
- Offer cost (`offer-cost.ts`): `OFFER_COST_ESTIMATED`, `OFFER_COST_WITHOUT_TOLLS`, `OFFER_COST_NO_DISTANCE`, `OFFER_COST_RATE_MISSING`.

The full list of codes any module may return is `PLAN_MESSAGE_CODES` in
`plan-messages.ts`.

## Tests

```bash
cd apps/api
npx jest src/common test/unit/fx test/unit/counterparty-risk test/unit/company-currency \
  test/unit/vehicle-attachment test/unit/vehicle-category-check test/unit/seed-vehicles \
  test/unit/app-start-secrets test/unit/swagger-production test/unit/registration-enabled test/unit/startup-report test/unit/api-logging \
  test/unit/transeu-token-encryption test/unit/admin-messages-english \
  test/unit/reserved-domains test/unit/offer-expiry-task
```

| Test | Covers |
|---|---|
| `src/common/plan-messages.spec.ts` | Unique codes, `msg()`, `dedupeMessages()` |
| `test/unit/sentry-real-sdk.spec.ts` | The real Sentry SDK with a local receiver: an error event and transactions arrive; no password, refresh token, Bearer token, cookie, OAuth code/state, outgoing query or console line in any envelope |
| `test/unit/security-headers.spec.ts` | Over HTTP: helmet headers on an API route (strict CSP, HSTS, nosniff, no `X-Powered-By`); Swagger UI still loads without CSP; `main.ts` applies them |
| `test/unit/offer-expiry-task.spec.ts` | The expiry task: each dead reason → `EXPIRED`, a loading today stays; the pickup-country day and the company country outside the map; the candidate query (only `NEW`); the write guarded by `NEW`; the log by reason and the cache; paging by id. On Postgres: `test/integration/offer-expiry.int-spec.ts` (in `test:demo`) |
| `src/common/axle-class.spec.ts` | Buckets, planner default, combination class; the class the planner saves |
| `test/unit/fx.spec.ts` | Conversion, code normalisation, missing rate |
| `test/unit/counterparty-risk.spec.ts` | Risk criteria and their thresholds |
| `test/unit/company-currency.spec.ts` | `currencyForCountry()`, currency at registration |
| `test/unit/company-currency-check.spec.ts` | Currency `CHECK` and migration backfill vs the code |
| `test/unit/vehicle-category-check.spec.ts` | Category `CHECK` vs `VEHICLE_CATEGORIES` |
| `test/unit/vehicle-attachment.spec.ts` | Attachment rule, also through `VehiclesService` |
| `test/unit/seed-vehicles.spec.ts` | Seed vehicles: axle classes, reefer, complete records |
| `test/unit/app-start-secrets.spec.ts` | The app does not start without valid secrets (child process); setup files |
| `test/unit/swagger-production.spec.ts` | Swagger on/off over HTTP, also with no `NODE_ENV` |
| `test/unit/input-dates-and-amounts.spec.ts` | Every service date field rejects an unreadable date with 400 (and `''` still clears a vehicle date); `profitEstimate` within DECIMAL(10,2) |
| `test/unit/offer-cost.spec.ts` | The cost formula: route km and toll, the offer km estimate, the manual toll first, no toll, no rate, no distance, other currencies |
| `test/unit/startup-report.spec.ts` | The start log lines and the development warning; `main.ts` logs them after `listen` |
| `test/unit/registration-enabled.spec.ts` | Registration on/off by environment; 403 `REGISTRATION_DISABLED` over HTTP before validation; the guard only on the register route |
| `test/unit/api-logging.interceptor.spec.ts` | User and company id in the log line |
| `test/unit/transeu-token-encryption.spec.ts` | Trans.eu tokens encrypted with `EncryptionService` |
| `test/unit/admin-messages-english.spec.ts` | Admin messages are English: Logger/console and thrown `Error` texts in `src` and `prisma`, `tools/*.sh`, the secrets startup errors, the seed refusal — no Polish letters, no word from `tools/polish-words-without-diacritics.json` or from the common-word list in the test |
| `test/unit/reserved-domains.spec.ts` | E-mail addresses in the seed, tests, DTOs and web screens only in reserved domains (RFC 2606), exceptions only with a reason; the OSRM user agent is AiSpedytor's |

ADR, reefer and time-zone rules are tested through LTL
(`src/ltl-matching/offer-compatibility.spec.ts`, `test/unit/ltl-compat.spec.ts`).

## Known limits

See also [docs/known-issues.md](../../../../docs/known-issues.md)
("Infrastructure").

- Exchange rates are static; there is no live source.
- Cache and queue live in one process: queued tasks are lost on restart and
  several API instances would not share them.
- `DataRetentionTask` has no tests. An offer older than 7 days expires even
  if its pickup is in the future (the age rule, shared with LTL).
- The 429 message and the guard messages are Polish text, not codes (the
  secret-check messages are English).
- The country → time-zone map has 31 countries; others fall back to the
  company's country (`OFFER_PICKUP_TIMEZONE_ASSUMED`).
