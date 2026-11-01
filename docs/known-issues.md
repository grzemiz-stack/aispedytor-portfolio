# Known issues

Open defects, gaps and accepted approximations, checked against the code
of this repository. Decisions behind the accepted ones are in
[decisions.md](./decisions.md).

Legend: **defect** — behaves wrongly today; **gap** — missing, nothing
breaks; **approximation** — accepted on purpose, with its limit stated.

---

## Security

| Kind | Where | What |
|---|---|---|
| defect | `apps/web/src/store/auth.store.ts` | The access and refresh tokens are persisted in `localStorage` (zustand `persist`). Any script on the page can read the 7-day refresh token. Direction: refresh token in an `httpOnly` + `Secure` + `SameSite` cookie set by the API, access token in memory only. |
| gap | `apps/web` headers | No full Content Security Policy for the web app's scripts — only `frame-ancestors 'none'` (plus nosniff, `X-Frame-Options: DENY`, a referrer policy). A script CSP needs nonces (or `'unsafe-inline'`), the Sentry and API origins, and checks on every screen; with the tokens in `localStorage` it is what would limit an XSS. The API has a strict CSP (helmet). |
| gap | `apps/web` `AuthGuard` | Checks only that a token is present, not that it is valid. |
| defect | `companies` logo | `data:image/svg+xml` is accepted (inline SVG risk — not verified). |
| gap | roles | Most write endpoints (offers, contractors, vehicles) have no role check; any dispatcher can delete a contractor. |
| gap | `/health/integrations` | The whole answer (database too) is cached for 30 s per company; cache and queue statistics are application-wide and visible to any logged-in user. |
| approximation | registration | `POST /api/auth/register` answers 409 `REGISTER_EMAIL_TAKEN` for a taken e-mail, which tells the caller that an account exists — a deliberate trade-off: a B2B sign-up where a clear answer matters more, with the limit of 5 requests per minute on `/auth`. |

### Dependency advisories (`npm audit --omit=dev`, checked 06.10.2026)

> **Update 08.10.2026 — Next 15.5.27 + React 19.3.0**
> ([NEXT15-ESTIMATE.md](NEXT15-ESTIMATE.md)). Every `next` row below is
> fixed, the RSC group included — the only one that applied to the
> deployment. Of `next` only its internal `postcss` 8.4.31 remains (XSS in
> stringify, file read through `sourceMappingURL`): it runs during
> `next build` on the project's own CSS, so it does not apply (the "build
> tools" row). `npm audit --omit=dev` from the lockfile: before 1 critical /
> 15 high / 44, after **0 critical / 15 high / 44** (`next` from critical to
> moderate). `test/unit/security-deps.spec.ts` keeps `next` ≥ 15.5.24;
> `test/unit/single-react.spec.ts` keeps one copy of `react`, `react-dom`,
> `@types/react` and `@types/react-dom` in the lockfile (a plain
> `npm install` left React 18 at the workspace root). The image optimizer
> stays off. The table below is the 06.10.2026 state on Next 14.
>
> **Update 08.10.2026 — Sentry 10.76.1** (`@sentry/nextjs`, for
> `@sentry/nextjs/config`; the API's `@sentry/node` moves with it, one copy
> in the lockfile). Every `@sentry/*` and `@opentelemetry/*` row is gone (the
> "through Sentry" row below). `npm audit --omit=dev` from the lockfile:
> 44 → **30** (0 critical, 14 high, 12 moderate, 4 low).

`npm ci` prints the audit of **all** dependencies, development tools included — 83 advisories, 1 critical on 12.10.2026 (`handlebars`, only through `ts-jest` in the API tests; not in the running application). The counts above are the production dependencies (`npm audit --omit=dev`): 30, 0 critical, the same on 12.10.2026.

Raised without a major version change: `axios` 1.20.0 and `proxy-addr`
2.0.8 (minimum versions kept by `test/unit/security-deps.spec.ts`). The
Next image optimizer is off (`images.unoptimized` in `apps/web/next.config.js`;
Next 14 then answered 404 on `/_next/image` before processing anything —
`apps/web/src/next-config.test.ts`). That left, on 06.10.2026 with Next 14:
1 critical, 15 high, 44 in total — the current counts are in the updates
above; the table keeps the 06.10.2026 assessment. Assessed against the deployment in `docs/DEPLOYMENT.md`, "Hosting, proxy and
HTTPS" (Linux, nginx, `next start`, `node dist/main.js`):

| Package | Advisories | Applies here? | Fix |
|---|---|---|---|
| `next` 14.2.35 | RCE through AVIF, DoS and cache growth in the image optimizer | **no** — `/_next/image` answers 404 | — |
| `next` | RCE on Windows-hosted servers | **no** — Linux | Next ≥ 15.5.24 |
| `next` | Server Actions (DoS, SSRF, endpoint disclosure, Edge payload) | **no** — no `'use server'` | Next 15.5 |
| `next` | middleware/proxy (Pages Router i18n bypass, redirect cache poisoning), rewrites (smuggling, SSRF) | **no** — no middleware, Pages Router or rewrites | Next 15.5 |
| `next` | XSS with CSP nonces and `beforeInteractive` | **no** — not used | Next 15.5 |
| `next` | SSRF with WebSocket upgrades | **unlikely** — the app uses no WebSockets; not checked whether `next start` handles upgrades itself | Next 15.5 |
| `next` | **React Server Components: DoS (3×), RSC cache poisoning, response confusion for requests with a body** | **yes** — the App Router renders pages through RSC, `'use client'` pages included | **Next 15.5+ only** |
| `qs` 6.14.2 (Express query parser) | array-limit bypass with commas, DoS through `isBuffer` | **not in this configuration** — the first needs the `comma` / `throwOnLimitExceeded` options, which Express does not use; the second was tried with a live request (`a[constructor][isBuffer]=1…` → 200, no crash) | open: the fixed `qs` needs express 4.22.3, NestJS 10.4.22 (the last 10.x) pins express to exactly 4.22.1, and npm 11 ignores `overrides` in a workspace monorepo with an existing lock. Comes with NestJS 11. |
| `multer`, `file-type` (through NestJS) | multipart and file DoS | **no** — no `FileInterceptor` / `ParseFilePipe`; NestJS does not parse multipart without them | NestJS 11+ |
| `body-parser` (low) | an invalid `limit` disables the size check | **no** — the limits are valid values | NestJS 12 |
| `@nestjs/core` (moderate) | "improper neutralization of output" | **not assessed** — the advisory is too general | NestJS 12 |
| `js-yaml`, `lodash` (through `@nestjs/swagger`, `@nestjs/config`) | YAML DoS, `_.template` injection | **no** — YAML only from the app's own Swagger document; `lodash` gets no outside input | NestJS 12 |
| `uuid` | missing buffer bounds check in v3/v5/v6 | **no** — only `v4()` without a buffer | uuid 11+ |
| `@opentelemetry/*` (through Sentry) | memory with the baggage header, database user name in traces | only with `SENTRY_DSN`; traces go to your own Sentry | no major needed |
| build tools: `tailwindcss`, `postcss`, `braces`, `micromatch`, `chokidar`, `fast-glob`, `picomatch`, `brace-expansion`, `browserslist`, `nanoid`, `source-map-js`, `postcss-selector-parser`, `webpack`, `esbuild`, `@babel/core`, `ajv`, `fflate`, `baseline-browser-mapping` | DoS, file read through source maps | **not at run time** — they process the project's own code during `next build`, never user data | some without a major; `tailwindcss` 4 and `postcss` through Next are majors |

What really applied: the Next RSC group — fixed on 08.10.2026 by Next 15.5 + React 19 (above).

## API correctness

| Kind | Where | What |
|---|---|---|
| defect | `offers:recompute-economics` | Run for a company without a cost per km it empties the cost, profit, margin and flag of **every** offer, accepted ones too (`recompute-economics.ts`, `offer-economics.ts` `NO_ECONOMICS`); setting the rate later recomputes only `NEW` and `ASSIGNED` (`companies.service.ts`) — set the rate first (DEPLOYMENT, "After the margin migration"). A recompute in the background does not clear the offer list cache (up to 30 s of old margins). |
| gap | `offers.service.ts` `update` | The source and the external id cannot be changed (400 `OFFER_FIELD_NOT_EDITABLE`); status changes have no full state machine (only `ASSIGNED`, a revenue status for a blacklisted contractor and restoring a dead offer are checked). Offers from e-mail and import have no contractor until someone sets it through `PATCH /offers/:id` — the blacklist and contractor risk do not see them until then. The edit screen does not change places, cargo or contact (only through `PATCH /offers/:id`). |
| gap | `contractors` DTO | `contactEmail` has no e-mail validation; delete is a hard delete without checking references. |
| gap | `vehicles` | Nobody updates the vehicle position (`current_lat/lng` columns exist, no API field writes them, nothing reads them) — the position source is a product decision. `GET /vehicles/expiring` creates notifications (a side effect of a GET); hard delete without checking attached units. |
| gap | `users` | No profile edit; `maxDispatchers` is stored but not enforced. |
| gap | `demands` | Most demand fields (minimum rate, margin, vehicle type, dates, regions, radius) are stored but not used for matching — stated in `match-offer-to-demand.ts`. |
| gap | `analytics` | Single query parameters without validation (the countries of `route-stats` are not checked — without them the filter is not applied); monthly revenue is grouped by the offer's `createdAt`, not by its loading (or delivery) date — an offer created in March for an April loading counts in March. |
| approximation | dates with a time but no zone | An offer date with a time but without a zone (`2026-10-10T23:30`, from the import or the API) is read in the **server's** time zone. On a UTC server a late-evening Polish time lands on the next day in the pickup country's zone, so matching checks documents and liveness against the next day. Dates without a time (and `DD.MM.YYYY` import dates, whose time is dropped) and e-mail dates (date only) stay on their day. |
| approximation | days in the server zone | Vehicles: "expires in N days" is a difference of instants rounded up (`vehicles.service.ts` `daysLeft`), and the once-a-day/once-a-week expiry notifications count the day and week in the server's time zone; analytics months (this month, last month, the 6-month revenue) also start in the server's zone. They match the users only when the server runs in their zone (e.g. `TZ=Europe/Warsaw`) — not tested here. |
| gap | changes for existing clients | Fields removed from request bodies now answer `400` (unknown fields are rejected): the computed offer fields `pricePerKm`, `totalCostEstimate`, `profitEstimate`, `profitMarginPercent` (the API computes them) and the fuel fields of the route calculation (`vehicle.fuelConsumption`, `fuelPricePLN` — the cost is the company cost per km). A client written against an older version must drop them. |
| gap | blacklist trace | An ADMIN's acceptance of an offer from a blacklisted contractor, a blacklist change and detaching a blacklisted contractor from an offer are recorded only as `warn` lines in the process log (who, when, offer, contractor), not in the database — keep the logs, or add an audit table. |
| gap | `analytics` | Route statistics use only offers with a `pricePerKm` (also for `avgPrice` and `totalOffers`); month labels are Polish (`pl-PL`) and month boundaries use the server time zone. |
| gap | API messages | Part of the API messages — validation messages in DTOs and some exception messages — are Polish text, not codes. Newer modules return codes with Polish and English texts (decisions §1). |
| gap | `risk-analysis` | Keyword rules match substrings (Polish keywords). Fleet checks (ADR, reefer) ignore vehicle status. |
| gap | `risk-analysis` | Does not check vehicle documents: an offer has no assigned vehicle. Expiring inspection, insurance and tachograph dates are listed per vehicle by `GET /vehicles/expiring`. |
| gap | offers import / create | An import row without `externalId` is never a duplicate (importing twice stores it twice) — let the source assign one (e.g. file name + row number); no key is derived from route, date and price, because regular lanes carry identical offers; a missing currency defaults to EUR, against decisions §2. |
| gap | `demands` | Demands do not use the dead-offer rule: the search, the counter and `DEMAND_MATCH` notifications include offers whose loading has passed or that are too old, and dead offers take places in the 500 limit (`demands.service.ts`). |
| gap | `demands` | A dispatcher is limited to own demands only on `GET /demands`; `:id`, `search` and `subscribe` accept any demand of the company. Matching: country = pickup country only (case-sensitive); ADR/reefer offers also match demands that do not require them; only the 500 newest offers are scanned; an offer update does not re-match. |
| gap | `vehicles` expiry notifications | Deduplicated by a message containing the plate number, so `WA 1` can suppress a notification for `WA 12`. |
| gap | `contractors` | `PATCH` with `name: null` passes validation (database error); the default sort is descending. The blacklist is a guard against mistakes, not against intent: a dispatcher can add the same offer again without a contractor. |
| gap | `email-agent` | The rule-based classifier reads the place after a pickup / delivery label ("City, PL", "City CODE (PL)", "Country, City", "PL-60-001 City"). Without labels it takes the pickup country from the first country name in the text and does not guess the delivery country; cities after "z"/"do" stay inflected ("z Poznania" → "Poznania"). Offers from e-mail are confirmed by the dispatcher. |
| gap | `ai-evaluation` | An unknown margin scores a neutral 5 but is rated `poor`; rounding makes −0.5 adjustments vanish and +0.5 always count; `marginRating` and the recommendation text use different thresholds; "vs market" means the company's own offers. |
| gap | `matching` | `ASSIGNED` offers with a passed loading day stay `ASSIGNED` (the expiry task leaves them alone; the lists hide them); trailer records are scored as vehicles of their own; availability compares timestamps, not the pickup-country calendar day. |
| gap | `auth` | Two browser tabs refreshing with the same token at once log both out (reuse deletes the family) when the web app is served over plain `http` on an address other than `localhost` — the cross-tab lock (`navigator.locks`) exists only in a secure context (HTTPS or `localhost`; [web README](../apps/web/README.md), "Login and tokens"); `RegisterCompanyDto` has no `@ApiProperty` (no body in Swagger); the web app has no registration screen (registration is off on a server by default — `REGISTRATION_ENABLED`). |
| gap | `notifications` | `NotificationsService.create()` is unused (demands and vehicles write through Prisma); the list ignores `sortBy` / `sortOrder`. |

## Route planner and distances

| Kind | Where | What |
|---|---|---|
| approximation | saved fallback routes | Before this version the planner could save a hub-table estimate (OSRM or geocoding down) with an offer. Rows of 0 km or a flat 500 km without a toll breakdown are recognised and skipped (`common/route-trust.ts`); a saved hub-table estimate cannot be told from a real route (no source column, the toll items carry no km per country), so it may still be an offer's latest route — recalculate the route for offers planned while the routing service was failing. New estimates are never saved. |
| approximation | `osrm-calculator.service.ts` | Routes come from the public OSRM demo server (`router.project-osrm.org`): car profile, no SLA, rate-limited. A production deployment needs its own routing service. |
| approximation | km per country (`osrm-calculator.service.ts`, `detectCountries`) | Measured by the driven distance with each border found by bisection ([decisions §5a](decisions.md)): each border is about ±3 km off; a country lying wholly between two probes of the same country (the route clips it and comes back within one ~50 km piece) gets no km. Measured 12.10.2026 — Warsaw → Madrid 2859 km: FR 1023, DE 703, PL 471, ES 471, BE 191 km (reference every 10 km: 1020, 710, 470, 470, 190); Munich → Zurich via Bregenz 314 km: DE 177, CH 109, AT 28 (reference every 2 km: 178, 112, 24); Trieste → Rijeka 75 km: SI 33, HR 30, IT 12 (reference: 30, 32, 14). The toll provider receives these km. |
| approximation | three road factors | Straight line → road distance: LTL × 1.25, negotiation × 1.3, hub distances × 1.3 — to be unified. |
| gap | planner | Does not take a vehicle from the fleet; the axle count comes from the form (empty = 5+, flagged as defaulted). |
| gap | `Vehicle` | No emission class; the planner takes it from the form (default Euro 6). |
| gap | geocoding | The planner has its own geocoder next to `geocoding/` (two caches). |
| gap | `osrm-adapter.service.ts` | Vignette requirements are computed but not passed to the response; a section without a detected country gets `countryCode` `PL`; `maxAlternatives` has no effect (one route). |
| approximation | first calculation of a long route | Up to about 80 s (Warsaw → Madrid: 78 s, 72 Nominatim requests at 1 per second — about one per 50 km plus three per border); a repeat comes from the cache. The proxy timeout must allow it (DEPLOYMENT, "Hosting, proxy and HTTPS"). |
| gap | saved routes after a place change | `PATCH /offers/:id` with a new city or country clears the coordinates but keeps the saved planner routes; the margin, the recompute, negotiation and LTL go on using the old route until the route is calculated again (`offers.service.ts` `update`, `offer-economics.ts` `trustedRoute`). The edit screen does not change places. |
| gap | planner response | A hub estimate is marked `ROUTE_ESTIMATED`, but the response does not say whether it came from the hub table or from a straight line × 1.3. Vehicle size, weight and ADR do not affect routing (OSRM car profile). |

## LTL (part loads)

| Kind | Where | What |
|---|---|---|
| approximation | detour distance | Straight line × 1.25 for the whole detour; the detour toll uses the average per-km toll of the offer's own route. |
| approximation | detour toll | Without a toll provider — or when the offer's route was not calculated — profit excludes the detour toll, so such an offer can rank above an identical one whose toll is known. The card says why (`TOLL_PROVIDER_NOT_CONFIGURED`, `DETOUR_TOLL_NOT_INCLUDED`). |
| defect | `ltl-matching.service.ts` | An offer heavier or longer than the free capacity disappears silently instead of being listed as incompatible with the reason. |
| gap | `awaitingLocation` | Not filtered by country: offers far from the route are listed while waiting for coordinates. |
| gap | load data | Cargo dimensions and weights are read from the tractor record, not from the attached semi-trailer. |
| gap | test | The load-plan length check (`LOAD_PLAN_LENGTH_EXCEEDED`, `ltl-matching.service.ts`) has no test; the code is correct today. |
| gap | load plan routes | `POST /ltl/load-plan` and `/load-plan/simulate` do the same and save nothing; `/load-plan/optimize` only reorders by weight (heaviest towards the middle), with no axle-load calculation. `GET /ltl/capacity/:vehicleId` has no caller in the web app. |

## Negotiation

| Kind | Where | What |
|---|---|---|
| approximation | constants | Without price history the estimate is 1.15 EUR/km or 4.95 PLN/km. |
| approximation | offer without a distance | Negotiation estimates the distance as a straight line × 1.3 and shows a cost and margin, while the offer's saved economics has no cost (`OFFER_COST_NO_DISTANCE`) — two pictures of one offer, typical for e-mail offers (`negotiation.service.ts`, the road factor near the end). |
| gap | test | The contractor sample (at least 3 offers) is meant to leave out the offer being negotiated; no test checks it — removing `id: { not: offer.id }` keeps every test green (`negotiation.service.ts`, `getContractorAnalysis`). |
| defect | missing data | Without price history the suggested price is 0 without a code; an unknown currency gives a per-km estimate of 0 (decisions §2). |
| gap | no cost per km | A company without a cost per km (`company:create` without `--cost-per-km`, which says so in its output) sees no offer cost or margin in negotiation and the route planner — the screens show `OFFER_COST_RATE_MISSING` until an ADMIN sets it in the company settings ("Koszt kilometra") or with `PATCH /api/companies/me`. |
| gap | toll advice | "≤ X %" suggests calculating the route or entering the toll (`lib/margin.ts` `UPPER_BOUND_HINT`): the toll can be entered on "Edytuj ofertę" (not by a non-ADMIN once the offer is accepted), but without a toll provider the planner saves no route, so "calculate the route" changes nothing (`route-planner.service.ts`). The latest route calculation is used whatever its axle class. |

## Integrations

| Kind | Where | What |
|---|---|---|
| gap | `trans-eu-auth`, `exchange-publisher` | No UI. The Trans.eu request structures were not verified against the live API. |
| gap | `exchange-publisher` | Timocom has no implementation: `publishToTimocom` answers `success: false`, `TIMOCOM_NOT_IMPLEMENTED`, nothing is sent. The former one used one account from the environment for every company, against an unconfirmed endpoint, and was removed. Plug in an adapter with an account per company — module README, "Plugging in a Timocom adapter". |
| gap | `trans-eu-auth` | Issued OAuth nonces live in process memory: one API instance only; a restart between connect and callback fails the callback (400). |
| gap | `trans-eu-auth` | `connect` is a `GET` behind a Bearer token that answers with a redirect — a plain browser link cannot carry the token, and with the web app and the API on different domains a `fetch` cannot set the binding cookie (SameSite=Lax from a cross-site response may be dropped). Recommended for a screen: `POST connect-ticket` with the Bearer token (ADMIN) → a one-time, short-lived URL → the browser **navigates** to `GET /connect?ticket=…`, which sets the cookie and redirects to Trans.eu. |
| gap | `trans-eu-auth` | A token refresh answered with any non-2xx status — also a Trans.eu outage (5xx) — marks the connection `EXPIRED` (connect again); a network error before an answer gives a `500` and leaves it `ACTIVE`. |
| gap | `notifications` | Created by `demands` and `vehicles`; the web app does not show them. |
| gap | `email-agent` | No mailbox connector (IMAP, Gmail) — out of the product's scope. |
| gap | `exchange-publisher` | No tests of Trans.eu publishing. An unknown truck body becomes curtainsider (a made-up default, decisions §2); a price of 0 is dropped; street fields are not sent; the raw exchange response is returned. |

## Infrastructure

| Kind | Where | What |
|---|---|---|
| approximation | `common/cache`, `common/queue` | In-process cache and queue (not Redis): queued tasks are lost on restart; one process only. |
| gap | exchange rates | The rates in `common/fx.ts` are static. Where they come from (a central bank, a provider, the company's own rate) is the buyer's choice: replace the source in that one file — the callers do not change, and every converted amount already carries `FX_RATE_STATIC`, so a new source shows in the results. |
| gap | scheduled tasks | The data retention task has no tests (offer expiry has: `offer-expiry-task.spec.ts`, and on Postgres `offer-expiry.int-spec.ts` in `test:demo`). |
| gap | `test:demo` alone | Run on its own after a code change without `npm run build`, it uses the old `dist/` for `company:create` (the gate builds first, so the gate is right). |
| gap | `package-lock.json` | Not regenerated as a whole: a full regeneration changes 162 packages (express 4→5 among them) — a separate decision. The missing platform binaries were added on their own (every platform package the parents declare); `lock-platforms.spec.ts` keeps them complete. Only `@unrs/resolver-binding-wasm32-wasi` is left out (it has its own dependencies; wasm32 only). |
| defect | `apps/api/package.json` `start` | Marks migration `20260312000000_vehicle_category_trailers` as rolled back on every start before `migrate deploy` — a workaround for an old problem, harmless today, to be removed before a production deployment. |
| gap | `common/tasks` | Data retention deletes every refresh token older than 30 days (expired or not). Offer expiry uses the LTL dead-offer rule, so an offer older than 7 days expires even with a pickup in the future; `ASSIGNED` offers never expire. |
| gap | `geocoding` | The 1 request/s queue and the single-run guard live in process memory (several API instances exceed the Nominatim limit); cached hits never expire; an LTL search with uncached route ends waits behind a running background batch. |
| gap | `prisma` | Migration SQL comments are in Polish — left unchanged so applied migrations keep their checksums. Leftover columns `toll_needs_verification` / `toll_unresolved`; `subscription_plan` kept although plans are out of scope; the seed uses a fixed 4.5 PLN/EUR and `Math.random()` for some demo rows. |

## Code quality

| Kind | Where | What |
|---|---|---|
| gap | lint | Both apps lint with zero errors and zero warnings, checked by the gate. The web app uses the light `next/core-web-vitals` configuration plus one `@typescript-eslint` rule: unused variables are an error in `.ts`/`.tsx`, with the API options (a leading `_` and rest siblings allowed). There is no `any` check as in the API (54 findings with `next/typescript`); `<img>` is allowed on purpose (the Next image optimizer is off). The web app lints with the ESLint CLI (`eslint --max-warnings 0 .`), not the deprecated `next lint`. |
| gap | `apps/api/tsconfig.json` | `strictNullChecks` and `noImplicitAny` are off. Turning them on gives 33 errors in `src` (25 in `ltl-matching`, 5 in `common`, 2 in `offers`, 1 in `companies`; measured 11.10.2026) — `npx tsc --noEmit -p tsconfig.build.json --strictNullChecks --noImplicitAny`. |
| gap | test coverage | API (11.10.2026): 90.6 % of lines, 71.7 % of branches (`npx jest --coverage`). Below 50 %: `osrm-calculator.service.ts` 39 %, `osrm-adapter.service.ts` 45 %, `cli/recompute-economics.ts` 25 % (its run is checked on Postgres in `test:demo`), and two untested pieces — the 429 filter and the Sentry performance interceptor. The web screens (`app/`, `components/`: 28 files, 10,723 lines) have no tests; only `src/lib` is tested. |
| gap | size | 15 source files over 500 lines and 44 functions over 80 lines (counted with the TypeScript parser, 11.10.2026). The largest: `LtlMatchingPage` (`apps/web/src/app/(dashboard)/ltl-matching/page.tsx`, 1,415 lines) is one 1,222-line component; `NegotiationPanel` 742, `RoutePlannerPage` 658; `negotiation.service.ts` is 1,166 lines. |

## Fleet planning

| Kind | Where | What |
|---|---|---|
| gap | rules | Not in stage 1: truck driving bans, cabotage, ferry/train time as rest, the 2002/15 weekly limit (60 h, average 48 h) and night work, double crew, trailer swaps. No screen in the web app. |
| approximation | rules | Interpretations to confirm against the consolidated texts:<br>- the four-week condition of the art. 8(6) exception;<br>- the return-home period counted to the start of the next home rest;<br>- a 10-hour day counted in the week its duty started;<br>- a compensation block that may open the rest it is attached to. |
| approximation | planner | Greedy: legal timelines, but `earliest` is not guaranteed to give the earliest possible ETA. |
| approximation | driver status | Unknown values are taken at their worst (docs/decisions.md §11), including whether the driver is on duty. Unknown compensation counts only reduced weekly rests of known date, and a deadline already passed is not assumed missed — a status without `recentWeeklyRests` may owe more than the engine assumes. |
| approximation | status from history | The rest at home is not in a tachograph, so it is unknown (due now). Compensation attached to a daily rest (art. 8(7)) is not recognised and stays owed. Until the history reaches the end of the third full week after its first week (21–28 days) the compensation owed is unknown. A history that starts inside a weekly rest counts only its covered part, so that rest may count as reduced. A merged rest is abroad if any part of it is. |
| approximation | manual status | Describes one moment; between it and the moment asked about, only rest is assumed (a status over 7 days old is flagged). On-duty 2002/15 totals start from the work since the last break. |

## Front end

| Kind | Where | What |
|---|---|---|
| gap | tests | Only `src/lib` is tested (logic and source checks); no component rendering tests. |
| gap | `apps/web/package.json` | `jest` / `ts-jest` are not declared there; they resolve from the workspace root. |
| gap | i18n | The interface is in Polish; only API messages have an English dictionary. |
| approximation | dashboard | "Most profitable offers" picks from the 100 newest offers (API page limit) and says so. |
| gap | offers list | The retry button for a failed Trans.eu publication does nothing. |
| defect | offers list | The rate column and every rate say "€/km", also for offers in PLN or another currency (`offers/page.tsx`). |
| gap | route planner page | Geocodes in the browser through public Nominatim; map tiles from OpenStreetMap and Leaflet CSS from unpkg. |
