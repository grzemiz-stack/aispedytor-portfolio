# Decision log

What was decided and why. Each entry states the rule as it holds in the
code today, the reason, and the limits that were accepted on purpose.
Known defects and open items are in [known-issues.md](./known-issues.md).

---

## 1. Messages are codes; sentences are built by the front end

The API does not compose user-facing sentences for warnings, reasons and
errors: they are returned as `{ code, params }` (`apps/api/src/common/plan-messages.ts`,
list `PLAN_MESSAGE_CODES`); the web app turns them into Polish or English
text (`apps/web/src/lib/plan-messages.ts`). A test fails if an API code has
no translation.

Errors follow one shape: `400/409/422 { statusCode, code, params, message: code }`;
the web app shows them through `apiErrorText()` (`apps/web/src/lib/api-error.ts`).

Exceptions, older than this rule and listed in known-issues ("API
messages"): the negotiation arguments and scenario labels and the risk
analysis messages are Polish sentences built on the server, and some
validation and exception messages are Polish text.

**Why:** vehicle labels stored without Polish diacritics ended up inside
server-built sentences. Not building sentences on the server removes the
whole class of problems, not one symptom.

## 2. Missing data is missing — never a made-up value

Anywhere a value is unknown, the result says so with a code instead of
substituting a default that looks real:

- an offer without weight or dimensions does not enter the load plan
  (no "0 kg / 2.4 m");
- an offer created from an e-mail that lacks a city, a country or a pickup
  date is refused with `EMAIL_OFFER_FIELDS_MISSING { fields }` (no "Unknown",
  no PL→DE, no "today", no EUR);
- an offer without coordinates is not ranked by an invented detour; it goes
  to the `awaitingLocation` list (`OFFER_AWAITING_LOCATION`);
- an amount in a currency without a rate is left out and counted, never
  added as is (§4);
- `0` is a value, not "no data" (`!= null`, never a truthiness test).

**Why:** a plausible-looking default is worse than a gap — it flows into
rankings, statistics and decisions without anyone noticing.

## 3. LTL ranking: profit in the company's currency

`apps/api/src/ltl-matching/offer-value.ts`.

- With `Company.costPerKm` set: **profit** = price − detour km × costPerKm
  − detour toll (only from a provider-computed route, §5), in
  `Company.costCurrency`. Without it: **revenue** = price.
- Order by the exact amount (no rounding before sorting); ties → fewer
  detour km, then `id`.
- Offers without an amount (no price, no exchange rate) go to the end with
  a code; separate limits (20 with an amount, 10 without) and a count of
  hidden ones.
- `fitScore` 0–100 (metres, weight, detour, contractor) is information
  about fit only — it does not decide the order.
- Detour distance: straight line × 1.25 (known approximation, see
  known issues).
- Company currency: PLN / EUR / GBP; a new company gets it from its country
  (GB → GBP, euro-area members → EUR, otherwise PLN). Changing the currency
  while a cost per km is set requires sending the cost too
  (`COMPANY_CURRENCY_CHANGE_WITHOUT_COST`), otherwise 4.20 PLN would silently
  become 4.20 GBP.
- Counterparty risk (`common/counterparty-risk.ts`): blacklist, payment
  rating ≤ 2, reliability < 40 — one definition for the LTL card and
  negotiation. Missing ratings are not a risk.

## 3a. The offer cost: the company cost per km × km + toll

Negotiation (the margin argument and the simulation) and the route planner
compute an offer's cost with one function, `common/offer-cost.ts`, the same
way LTL counts its detour: **the company `costPerKm` × km + toll**. The cost
per km is without tolls, in the company currency.

- Km and toll come from a planner route; without a route, the km come from
  the offer (`OFFER_COST_ESTIMATED`) and the toll from a manual entry on the
  offer, if any. The manual toll goes before the route's toll.
- Without any toll (no route, no manual toll, or no toll provider) the cost is
  without tolls (`OFFER_COST_WITHOUT_TOLLS`): margins are upper bounds
  ("co najwyżej X %"), the verdicts excellent / good / acceptable become
  `uncertain`, the break-even is a lower bound.
- Without the company cost per km (`OFFER_COST_RATE_MISSING`) or without a
  distance (`OFFER_COST_NO_DISTANCE`) there is no cost — no fuel constants,
  no assumed 500 km (both existed before).
- The route planner request has no fuel fields any more
  (`vehicle.fuelConsumption`, `fuelPricePLN` are rejected as fields outside
  the schema).
- The offer form does not send a computed rate, cost, profit or margin (they
  are no longer request fields; an old client gets a 400). The API computes
  the rate per km from the price and the distance.
- **The margin is computed when an offer is saved** (`offers/offer-economics.ts`,
  on `offerCost`): on create (form, e-mail, import — the company rate once per
  batch), on a change of price, currency, distance or manual toll, and after
  the planner saves a route for the offer (the manual toll is never changed).
  Cost in the offer currency, profit = price − cost, margin = profit / price.
  No price, company rate, distance or exchange rate → nothing; a price of 0 →
  no margin; a margin outside DECIMAL(5,2) → none instead of a 500. The seed
  uses the same function.
- **Without a toll the margin is an upper bound** — `margin_without_tolls`
  (`true`; full `false`; no margin NULL). In this copy that is also the case
  without a toll provider: the planner saves no route then, so the margin
  comes from the offer km without a toll. The averages (dashboard,
  `/offers/stats`, analytics) use full margins only, with the count of offers
  with only an upper bound; sorting by margin puts full ones first, then
  upper bounds, empty last; screens write "≤ X%"; the heuristic score rates an
  upper bound of 10 % or more `uncertain`.
- **Offers saved before** kept the margin the form computed from fuel and
  toll (flag `false`, so it counted as full). `npm run
  offers:recompute-economics [-- --dry-run]` recomputes **all** offers with the
  same rule, accepted and completed ones too (an old margin "from fuel" is a
  wrong number, not history). **After the recompute, older offers carry the
  cost at today's company rate**, not the rate of the day they were accepted.
  It is idempotent (it writes only differences — a second run changes 0);
  `--dry-run` writes nothing and gives the same counts (offers, full / upper
  bound / no margin, changed). Deployment order (docs/DEPLOYMENT.md): the
  migration `20261011150000_offer_margin_without_tolls`, right after it the
  recompute. Checked on PostgreSQL in `tools/demo-test.sh` (step 7).
- **A company rate change** (cost per km or its currency, `PATCH
  /companies/me`) recomputes the company's open offers (NEW, ASSIGNED) **in the
  background, not inside the request** (the task queue): the PATCH returns at
  once. A recompute error → a warning in the log (company id, the number of
  open offers), the rate stays saved; the command above fixes it. From
  ACCEPTED on the margin stays as it was.

- The new-offer form shows the margin the API computes with the same function
  as saving (`POST /api/offers/economics-preview`); without a manual toll it
  is an upper bound. The form has no fuel field (fuel is not part of the cost).
- `PATCH /offers/:id` saves every field of its body except the source and the
  external id (the origin and the import key — `OFFER_FIELD_NOT_EDITABLE`);
  before, it accepted and silently dropped 17 of them.
- Editing (October 2026 checking review): the "Edytuj ofertę" screen changes
  the loading date, validity, price, currency, distance, manual toll,
  contractor and notes through `PATCH /offers/:id`, sending only what changed;
  its margin preview is the same endpoint with `offerId`, computed as the save
  (missing fields from the offer, its saved route). Once an offer is accepted,
  in transit or completed, money, dates and places are for an ADMIN only
  (`OFFER_FIELDS_ADMIN_ONLY`, logged with from → to); notes, contact, cargo,
  weight and postal codes stay open to anyone.
- The planner opened for an offer uses the offer's manual toll first, as the
  saved margin and negotiation do. An estimated (hub-table) route or a 0 km
  route is never saved with an offer; without a route or an estimate the
  planner answers 503 `ROUTE_UNAVAILABLE` — never an assumed distance. Saved
  fallback rows (0 km, a flat 500 km without a toll breakdown) are skipped by
  every reader of saved routes.

## 3b. The contractor profile: orders from the offers, the market on the rate per km

- The number of a contractor's orders is counted on read: their offers in the
  revenue statuses (accepted, in transit, completed) — the total, the last 30
  and 90 days and "regular partner" (5 or more in 30 days) alike; the 30/90-day
  counts used to take offers in any status ("0 orders in total, 7 this month"). There is no stored
  counter (the old `total_orders` column was never written; the migration
  `20261011120000_contractor_total_orders_on_read` drops it).
- "Contractor vs market" compares the average rate PLN/km on similar routes
  (the same countries, the distance within 100 km of the offer's): the
  contractor's offers against the company's other offers from 90 days. The
  "market" is the company's other offers in the system (mostly imported from
  exchanges), not outside market data. Below 3 contractor offers or 5 market
  offers there is no comparison (`NEGOTIATION_SAMPLE_TOO_SMALL`).
- Contractor risk has one definition (`common/counterparty-risk.ts`:
  blacklist, payment rating ≤ 2, reliability < 40); each screen reacts in its
  own way. Offer risk analysis: the blacklist → HIGH and a CRITICAL total,
  the payment rating → HIGH (not "safe to accept"), reliability → MEDIUM.
- The blacklist is a block, not only a warning: accepting an offer from a
  contractor on the company blacklist is for an ADMIN only (others get
  `OFFER_CONTRACTOR_BLACKLISTED`; an ADMIN's acceptance is logged); LTL keeps
  such an offer, last and blocked; negotiation names it in the first
  argument. The other criteria (payment, reliability) stay warnings on the
  LTL card; negotiation also reacts to the payment rating.
- No loopholes (October 2026 checking review): the block applies to every move
  into a revenue status (`ACCEPTED`, `IN_TRANSIT`, `COMPLETED`) from another
  status, not only to `ACCEPTED`; the flag `isBlacklisted` is set and cleared
  by an ADMIN only (`CONTRACTOR_BLACKLIST_ADMIN_ONLY`, logged); an offer's
  contractor can be set with `PATCH /offers/:id` and the new-offer form, but
  detaching or replacing a blacklisted one is for an ADMIN only (otherwise
  "detach, then accept"); a contractor with offers cannot be deleted
  (`CONTRACTOR_HAS_OFFERS` — deleting cleared the link and the block); an
  inactive contractor stays blocked. Offers from e-mail and import have no
  contractor until someone sets it.

## 4. One source of exchange rates

`apps/api/src/common/fx.ts` is the only place with rates; they are static
and every converted amount carries `FX_RATE_STATIC { from, to, rate }`.
Fetching live rates (e.g. from a central bank) is deliberately not done
(10 October 2026): the source of rates belongs to the buyer, who replaces it
in this one file (known issues, "exchange rates").
Used by the LTL ranking, dashboard and analytics (`common/money.ts`), the
route planner (fuel, toll in PLN, margin), negotiation (including the rate
the negotiation panel uses for its slider — the front end has no rate of its
own) and the offer score.

- A currency without a rate → no amount with
  `CURRENCY_CONVERSION_UNAVAILABLE`; in sums and averages the item is left
  out and counted (`TOTAL_EXCLUDES_UNCONVERTED { count, from, to }`).
- The planner margin is computed in the freight's currency.
- Negotiation reads toll from `route_calculations.tollTotalEur` and converts
  it, so rows saved at different times count at the same rate.

**Why:** there used to be five rate sources (4.30, 1/0.86, 0.23, …) giving
the same EUR offer different PLN values in different screens. The change
was made with a characterization test first, so every changed number is
visible as "before → after" (`fx-sources.characterization.spec.ts`).

**Not done:** live rates (e.g. the Polish central bank) — `fx.ts` is the
single place to switch the source.

## 5. Toll amounts come only from a toll provider

The application does not estimate toll. Amounts come from a `TollProvider`
(`apps/api/src/tolls/toll-provider.ts`) registered in one place,
`apps/api/src/tolls/tolls.module.ts`. None is registered in this repository.

- **Input:** route points, geometry, km per country, axle class of the
  combination, emission class, gross weight. **Output:** per country an
  amount and its currency, plus the provider name. Failures are a
  `TollProviderError(reason)`.
- **No provider:** the route planner returns toll as `null` with
  `TOLL_PROVIDER_NOT_CONFIGURED`; total cost and margin exclude toll and are
  marked `complete: false`. LTL computes profit without the detour toll
  (offers stay; the code is on each card and once above the list).
  Negotiation offers only a manually entered toll.
- **Provider failure:** the planner answers 502 `TOLL_PROVIDER_UNAVAILABLE
  { reason }` and saves nothing — no fallback to another source.
- **route_calculations:** a row is saved only with a complete toll from a
  provider and records it in `tollSource`; LTL and negotiation read toll
  only from such rows.
- **Contract:** every implementation must pass
  `apps/api/test/contract/toll-provider.contract.ts`; a test-only fake
  (`test/fakes/fixed-rate-toll-provider.ts`) passes it and shows the whole
  flow (`toll-provider-flow.spec.ts`).

**Why:** the previous internal per-km tables were static, older than twelve
months and unverifiable; a number that looks computed is worse than a
visible gap.

## 5a. Km per country: by the driven distance, the border by bisection

The toll provider gets km per country, so they must follow the road, not the
geometry. `detectCountries` (`route-planner/osrm-calculator.service.ts`):

1. Probes (one Nominatim request each) at the start of the route, at the end
   and in the middle of every ~50 km piece along the line (length from the
   distances between geometry points).
2. Where two neighbouring probes are in different countries, the stretch
   between them is halved until it is at most 6.25 km (50 / 8, usually three
   requests); the border goes in its middle — about ±3 km.
3. A bisection probe that finds a third country (a narrow strip between two
   others) gets its own borders the same way, so the strip gets its km; the
   start and end probes catch a strip at either end.
4. A stretch between two probes of one country goes to that country, between
   two countries half to each. A probe without a country is skipped (its
   neighbours share the stretch). The total is scaled to the OSRM distance.

**Why:** the earlier code took every N-th POINT of the geometry and gave each
an equal share. Geometry is dense in towns and bends and sparse on motorways,
so km followed the point count. Measured on 12.10.2026 (the same OSRM routes,
the real service and its 1 request/s Nominatim queue):

| Route | before (every N-th point) | by distance, 50 km | with bisection | reference |
|---|---|---|---|---|
| Warsaw → Madrid, 2859 km | FR 953, ES 810, DE 572, PL 381, BE 143 | FR 986, DE 690, PL 493, ES 493, BE 197 | FR 1023, DE 703, PL 471, ES 471, BE 191 | FR 1020, DE 710, PL 470, ES 470, BE 190 (every 10 km) |
| requests / time | 60 / 65.0 s | 58 / 62.8 s | 72 / 78.3 s | |
| Munich → Zurich via Bregenz, 314 km | CH 157, DE 118, AT 39 | DE 179, CH 90, AT 45 | DE 177, CH 109, AT 28 | DE 178, CH 112, AT 24 (every 2 km) |
| requests / time | 8 / 7.7 s | 7 / 6.6 s | 15 / 15.8 s | |
| Trieste → Rijeka, 75 km | IT 25, SI 25, HR 25 | SI 38, HR 37, **IT 0** | SI 33, HR 30, IT 12 | IT 14, SI 30, HR 32 (every 2 km) |
| requests / time | 3 / 2.2 s | 2 / 1.1 s | 9 / 9.5 s | |

Without bisection the 14 km of Italy got no km, and on short routes (few
pieces) the half-piece border error was worse than the old split. Bisection
costs about three requests per border plus two (start, end): 8–16 s more on
these routes, the first time; then the route is cached. The 10 km reference
for Warsaw → Madrid is itself about ±5 km per border, so differences up to
about 7 km there are within its own error.

**Left:** each border about ±3 km; a country lying wholly between two probes
of the same country is not seen (bisection starts only where neighbouring
probes differ); an unanswered request — the probe is skipped and the border
sits in the middle of a longer stretch.

## 6. Compatibility filters (LTL and vehicle matching)

`apps/api/src/ltl-matching/offer-compatibility.ts`, `common/adr.ts`,
`common/reefer.ts`.

- "Today" for a pickup date is the calendar day in the pickup country's
  time zone. Vehicle matching (the document block and points) and the
  negotiation "Pilny termin" use the same loading day
  (`common/country-timezone.ts`, `pickupDay`); a document's own date is its
  stored day (`dateOnlyDay`) — valid "until X" is valid all of day X. Dates
  without a time (00:00Z) stay the same day in Europe.
- Dead offers (pickup in the past, past `expiresAt`, older than 7 days)
  disappear; offers incompatible with the vehicle (ADR, reefer,
  availability) are returned with the reason.
- Vehicle matching uses the same rule (`deadReason`, which names the
  reason: `EXPIRED`, `TOO_OLD`, `PICKUP_PASSED`): the lists (offers for a
  vehicle, dashboard suggestions) leave dead offers out before their limit;
  an `ASSIGNED` offer has no age threshold — a dispatcher is working on it,
  so only a passed loading day or `expiresAt` makes it dead. One offer
  opened directly is still scored, for reference, with
  `MATCH_OFFER_NOT_LIVE { reason }` (`NEW`, `ASSIGNED`, status `EXPIRED`);
  `ACCEPTED` and later — a job in progress — carry no code.
- The hourly expiry task uses the same rule: a dead `NEW` offer → `EXPIRED`
  (`ASSIGNED` left alone; no notifications; counts by reason in the log).
  Restoring an `EXPIRED` or `REJECTED` offer to `NEW` is refused while it is
  dead (`OFFER_STILL_DEAD { reason }`) — otherwise it would silently expire
  again within the hour. Older than 7 days cannot be restored (the age does
  not change); a passed loading date or `expiresAt` can be changed first on
  the "Edytuj ofertę" screen.
- ADR: `hasAdr` is the source of truth, `adrClasses` narrows it; an
  unrecognized class is unknown, not allowed. The same rule is used by LTL
  and by vehicle↔offer matching (incompatible = score 0 with the reason in
  `blockedBy`).
- Reefer: a reefer is also a tractor with a `REEFER` trailer record; a
  reefer load is also an offer with only a temperature.

Accepted limits: the driver's ADR licence is not checked; limited-quantity
and exempt ADR loads are treated as full ADR (stricter than the law);
vehicles have no temperature range, so a temperature is "unverified".

## 7. Vehicles, axles and combinations

- `Vehicle.axleCount` = axles of that record, not of the whole combination.
- Categories (`common/vehicle-category.ts`): `TRUCK` tractor, `RIGID`,
  `SEMI_TRAILER`, `TRAILER`, `VAN`; the database `CHECK` and the DTO use the
  same list. Codes carry the English meaning (`SEMI_TRAILER` = semi-trailer).
- Attaching: semi-trailer → tractor only; trailer → rigid or van only;
  checked on every write, parent searched only within the company.
- Combination axle class (`common/axle-class.ts`) = record axles + attached
  units, bucketed 2/3/4/5+; never guessed (tractor without a semi-trailer,
  missing `axleCount` → no class).
- Load capacity reads `grossVehicleWeightKg` and `curbWeightKg` of the
  record; an incomplete record is a 422 (`IncompleteVehicleRecord`).
- ADR classes (October 2026 checking review): the vehicle form offers the 13
  classes of `ADR_CLASSES` (`common/adr.ts`) when the certificate is ticked and
  sends them in the form matching reads; before, the form had no field, so a
  certified vehicle had no classes and every ADR offer with a class was
  refused. Cleared in edit → `null` → stored as an empty list (the column is a
  list without null). Entries saved earlier outside the list stay.

## 8. Security baseline

- `JWT_SECRET` and `ENCRYPTION_KEY` are required; without them the API does
  not start (no fallback values). CI and the Docker test generate random
  secrets per run; nothing is stored in the repository.
- A `POST` that creates a resource answers 201; one that creates nothing
  (login, refresh, logout, analyses, simulations, searches, the load plan, the
  route calculation) answers 200 — every POST route is on one of the two lists
  in `http-status-codes.spec.ts`.
- Request bodies and query objects are validated classes — no interface
  (`dto-classes.spec.ts`); a missing required field or a field outside the
  schema is 400.
- Every query is scoped by the caller's `companyId`, taken only from the token
  — no route accepts `companyId` from the client (`company-from-token.spec.ts`);
  references to users,
  contractors and dispatchers from another company are rejected.
- Trans.eu OAuth `state` is HMAC-signed with a nonce and expiry and bound to
  the browser that started `connect` (an HttpOnly cookie on the callback path;
  another browser → 400 `BROWSER_MISMATCH`); `connect` and `disconnect` are
  ADMIN only; tokens are stored encrypted.
- No exchange account is shared by all companies: Timocom has no built-in
  implementation (the former one used one account from the environment for
  every company while registration is open); an adapter must publish with the
  account of the caller's company (`TIMOCOM_NOT_IMPLEMENTED` without one).
- `/health` publicly says only "alive"; dependency checks are behind login.
- Swagger and registration are on only with an explicit
  `NODE_ENV=development|test` or their flag (`SWAGGER_ENABLED`,
  `REGISTRATION_ENABLED` = `true`); no `NODE_ENV` counts as production. Off
  registration answers 403 `REGISTRATION_DISABLED`; the first company on a
  server comes from `npm run company:create` (same rules, password from stdin,
  no tokens printed).
- Sentry gets no request values. `sendDefaultPii: false` alone is not enough:
  the SDK (v10) still attached the request body, headers (the Bearer token),
  cookies and query to 5xx events and sampled transactions. Now the API
  records no request bodies (`httpIntegration({ maxIncomingRequestBodySize:
  'none' })`), and `beforeSend` / `beforeSendTransaction` (`scrubRequest`)
  drop the body, headers, cookies and query, and the query from every
  address and span (also outgoing requests); breadcrumbs keep their address
  without the query; console breadcrumbs are off (not cleaned). On a 5xx our
  filter adds only the field names. The web app does the same in the browser,
  the Next server and Edge (`src/lib/sentry-options.ts`), whether a DSN is set
  or not; Replay masks all text and inputs and blocks media, and is off by
  default (0 % of sessions, 0 % with an error — `REPLAY_RATES`): recording a
  user's screen is a deployment decision. Checked on the
  real SDK with a local receiver (`sentry-real-sdk.spec.ts`).
- Security headers: helmet on the API (CSP `default-src 'none';
  frame-ancestors 'none'`, HSTS, nosniff, no `X-Powered-By`; Swagger UI without
  CSP); the web app sends nosniff, `X-Frame-Options: DENY`, CSP
  `frame-ancestors 'none'`, a referrer policy and no `X-Powered-By`. A full
  CSP for the web app's scripts is not set (known-issues).
- The web app logs out only when the server refuses the refresh token
  (401/403) or there is none; a 429 (the limit per address), 5xx or network
  error keeps the session.
- Password change ends all sessions and returns a new token pair for the
  current one; the front end stores the rotated refresh token.
- Refresh tokens live in families (one per login): a refresh marks the used
  token; using it again deletes the whole family (403, a warning in the log).
  The database keeps only the SHA-256 of each refresh token (`token_hash`).
  The web app refreshes under a cross-tab lock and takes a pair another tab
  already refreshed, so tabs do not trip the reuse detection (needs HTTPS or
  `localhost`); a `401` from login does not refresh
  ([web README](../apps/web/README.md), "Login and tokens").
- Deactivating a user deletes all their refresh tokens in the same
  transaction, and `/auth/refresh` refuses an inactive user (403);
  `DELETE /users/:id` returns the decrypted user, never hashes. The last
  active ADMIN of a company cannot be deactivated (409 `LAST_ACTIVE_ADMIN`);
  the API has no role change (`no-role-change.spec.ts`).
- The seed runs only with an explicit `NODE_ENV=development|test` (no
  `NODE_ENV`, staging or production → refused); its demo accounts are test
  data. `tools/demo-test.sh` sets `NODE_ENV=test` for every seed run; the
  `db:seed` script deliberately sets none (it would let the seed through in
  production).

## 9. Honest names

Descriptions say what the code does:

- the offer score (`ai-evaluation`) is a heuristic — margin thresholds
  adjusted by price per km against the company's own history on the
  country pair; no model is involved (the module name and API paths are
  historical);
- the e-mail module classifies e-mails pasted in the test panel or sent to
  the API; it does not read a mailbox;
- the only module that calls an LLM is `email-agent` (classification, with
  a rule-based fallback).

## 10. How changes are checked

- One gate script: `tools/bramka.sh` — API and web lint (zero errors, zero
  warnings), API tests, the same API tests with the clock at +5 years
  (`npm run test:future`), API build, the Docker
  scenario test (`tools/demo-test.sh`: real Postgres, migrations, seed,
  LTL search on the demo route), web tests, web build. CI runs the same
  script.
- Changes to numbers start with a characterization test that pins today's
  values; the change then shows up as edited expectations.
- Tests are checked by mutation: the guarded line is broken on purpose and
  the test must fail.
- Company scope is guarded for the whole app by `test/unit/app-scope.spec.ts`:
  the real `AppModule` with a real token of a company-A user and a fake
  database that records every query. Every read and bulk write on company
  data must filter by the company, a single-row write may go only to a row
  the same request first found in company A, and every cache key carries the
  company. A mutation sweep (each one-line `companyId` filter removed in
  turn) caught 74 of 96 filters on 11 October 2026; the checking review of
  12 October 2026 swept 100 filters against `app-scope.spec.ts` and
  `ltl-vehicle-scope.spec.ts` and caught 76 (the count depends on which lines
  are taken as filters; not recounted after that review's fixes). The kinds
  not caught are known — on 11 October the 21 were: 13
  single-row writes right after a scoped `findOne` (the found row is
  already the company's — the second filter is defence in depth), 6 paths
  the fake cannot reach without more data (a toll provider's quote, Trans.eu
  HTTP answers, an e-mail with extracted offer data), and 2 where the
  remaining filter is narrower than the company (the user's own id). One
  filter could not be mutated by the script.
- A test that depends on "now" uses a fake clock
  (`jest.useFakeTimers().setSystemTime(NOW)`) or an injected "now"
  (`LtlMatchingService.now`), never a hardcoded date that is "in the future"
  today: the matching lists drop offers whose loading day has passed, so such
  a test would break when the calendar reaches the date (the first one would
  have on 9 January 2030), and a test expecting an empty result would pass
  for the wrong reason. `test:future` (`jest.future.config.js`,
  `test/setup/clock-shift.ts`: only `Date` is faked, 5 years ahead; a file
  that sets its own clock wins) catches a new one at once. A test with an
  empty expected result also checks a positive control (the same offer shows
  up when nothing blocks it).

## 11. Fleet planning, stage 1 (`apps/api/src/fleet-planning`)

- The specification `docs/fleet-planning/SPEC.md` is the source of truth;
  the module README describes the rules, the gateway and the limits.
- Every instant and the fixed week are in **UTC** (tachograph time).
- **Unknown is never favourable.** A count the driver status does not give
  is taken as used up, and the result says so (`DRIVER_STATE_ASSUMED`, with
  the field and the value taken). Decided on 9–10 October 2026:
  - **required**, a missing one is 400 naming the field: driving this week and
    last week, the end of the last weekly rest — their worst case would ground
    the driver for days;
  - weekly rest type unknown → reduced;
  - last rest at home unknown → due at the moment of the status
    (`HOME_RETURN_LATE` from the start), until a rest at home in the plan;
  - compensation unknown → 21 h for every reduced weekly rest of known date
    (the last one, the reduced ones in `recentWeeklyRests`), each by the
    earliest deadline — a reduced rest is shorter than 45 h, so it started at
    the earliest 45 h − 1 min before its end (10 October 2026; the first
    version took 24 h, the latest start, a week too favourable); `0` means
    nothing owed; a deadline without the amount
    is refused. A deadline already passed is not assumed missed (that would be
    a violation nobody knows happened). Without `recentWeeklyRests` the rest
    before the last one is taken as reduced for the return home only — its
    compensation is not added, its date is not known;
  - a known compensation without its deadline (only from a provider that
    breaks the contract): the end of the third week after the week the
    reduced rest **started** (art. 8(6)), derived only for one reduced rest
    of at most 21 h (it started 45 h − amount before its end). Otherwise the
    status is refused: 409 `DRIVER_STATUS_INCOMPLETE` (`compensationDueBy`).
    A deadline "now" was rejected — every plan would show a made-up
    `COMPENSATION_OVERDUE`;
  - **on duty or not** is explicit (`onDuty`, 10 October 2026): `true` (the
    end of the daily rest and the counters required), `false` (resting),
    unknown → on duty with the day's driving, the break and work used up,
    since as long ago as a regular daily rest still fits the 24-hour window
    (not before the weekly rest ended) — so no driving before a daily rest.
    Before, a status without the duty block counted as fully rested;
  - a driver activity provider failing for its source answers 502
    `DRIVER_ACTIVITY_PROVIDER_FAILED` with its `reason`, not a bare 500.
- **The dispatcher decides.** Nothing is blocked: a timeline that breaks a
  rule is shown with its violations. The validator checks a planned and a
  hand-approved timeline the same way, and the planner's result carries the
  validator's verdict, not its own.
- **Return home** (561 art. 8(8a)) is the company's obligation and the driver
  may choose otherwise, so it is a warning (`HOME_RETURN_LATE`), or a notice
  when the driver chose to stay away (`HOME_RETURN_DECLINED`). It is counted
  as the latest start of the next home rest: 4 weeks, or 3 after two
  consecutive reduced weekly rests. The annulled 8-week vehicle return is not
  enforced.
- A regular weekly rest away from home is legal (accommodation is a cost:
  `WEEKLY_REST_ACCOMMODATION_REQUIRED`); in the cab it is a violation
  (`WEEKLY_REST_IN_CAB`).
- **The exception for two consecutive reduced weekly rests abroad**
  (art. 8(6)) is applied only when the status lists the recent weekly rests.
  Without the list it is not applied (`WEEKLY_REST_EXCEPTION_UNVERIFIABLE`).
- Directive 2002/15: 30 min of breaks over 6 h of work, 45 min over 9 h.
  The weekly limit (60 h, average 48 h) and night work are not in stage 1.
- The planner is `standard` by default (9 h days, 11 h daily rests, regular
  weekly rests). `earliest` also uses 10-hour days and reduced rests.
- Driver activity comes through `DriverActivityProvider`. The default is the
  dispatcher's manual status. Tachograph or telematics adapters are the
  buyer's, behind the contract in `test/contract/`.
- **Status from an activity history** (10 October 2026). The code contains no
  parser, no binary and no real driver card file (personal data); file and
  API adapters are the buyer's (SPEC §7 point 5). What is provided:
  - the history contract: driving / work / availability / rest, the country
    (ISO alpha-2 or unknown), "card withdrawn" (on a rest only, counted as
    rest, as a tachograph counts it) and the period covered. Inside the
    coverage no activity is rest; outside it nothing is known;
  - `statusFromHistory`: the rules ledger replays the history. The start of
    the window is the worst case; the first weekly rest in it resets what the
    rules reset, so from there the counters are exact and the start never
    reaches the result. No weekly rest in the window, or last week not fully
    covered: refused (a required value);
  - the rest at home is not in a tachograph → unknown. Compensation is known
    with at least 28 days of history (no reduced rest before it can still be
    owed), otherwise unknown. It counts as paid only when a rest of 45 h or
    more is longer by whole owed amounts; attached to a daily rest (allowed by
    art. 8(7)) it is not recognised and stays owed — the cautious side;
  - abroad only for a known country other than the company's; an unknown one
    does not open the exception for two reduced rests abroad;
  - sources (parsers, licences, APIs):
    [fleet-planning/TACHOGRAPH-SOURCES.md](fleet-planning/TACHOGRAPH-SOURCES.md).
