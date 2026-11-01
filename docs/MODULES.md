# What each module does — read from the code

Written on 12 October 2026 from the source code of this repository, not from
the other documents. Every "does" or "works" names the file that does it, in
parentheses. Paths start at `apps/api/src/` (shown as `api/…`) or
`apps/web/src/` (`web/…`); constants and functions are named so they can be
found with a search — line numbers would go stale. Where a behaviour depends
on an outside service that was not called while writing this, it says
**not verified without** that service. Nothing below is described as working
unless the code does it.

The limits at the end of each section are one sentence each; the details are
in [known-issues.md](known-issues.md) and in [HANDOFF.md](../HANDOFF.md),
"Open after the October 2026 checking review".

Contents: [outside services](#outside-services) · [HERE](#here-what-exists-and-what-it-would-take) ·
[API modules](#api-modules) · [web screens](#web-screens) · [table](#table-module--outside-service)

---

## Outside services

What the code really talks to, how it is switched on and what changes. Only
these exist; there is nothing else (no Redis, no message broker, no live
exchange rates, no e-mail sending).

| Service | In the code | Switched on by | Without it | With it |
|---|---|---|---|---|
| **OSRM** (routes) | public demo server `https://router.project-osrm.org`, car profile `driving`, 15 s timeout (`api/route-planner/osrm-calculator.service.ts`, `OSRM_BASE`) | always on; the address is a constant — **an own OSRM server is a code change of that constant**, there is no variable | the planner falls back to a hub-table estimate (marked, never saved); see route-planner | real road distance and time for a **car**: vehicle weight, height, width, length and ADR are not sent to OSRM |
| **Nominatim** (places) | public `https://nominatim.openstreetmap.org`, in two places with separate queues: planner 1 per 1.1 s (`NOMINATIM_MIN_INTERVAL_MS`), geocoding 1 per 1 s (`api/geocoding/geocoding.service.ts`, `MIN_INTERVAL_MS`); the route planner page also calls it **from the browser** (`web/app/(dashboard)/route-planner/page.tsx`) | always on; `NOMINATIM_CONTACT_EMAIL` only adds a contact to the `User-Agent` (without it: a warning at start) | the planner returns no route (503 `ROUTE_UNAVAILABLE`), LTL search 422 `ROUTE_GEOCODING_FAILED` unless both places are cached, new offers wait for coordinates | place → coordinates; km per country of a route (`detectCountries`) |
| **Toll provider** | only the interface `TollProvider.quote()` (`api/tolls/toll-provider.ts`), registered as `null` (`api/tolls/tolls.module.ts`); the only implementation is a test fake (`apps/api/test/fakes/fixed-rate-toll-provider.ts`) | a class written by the buyer and registered in `tolls.module.ts` — no variable | toll is "not calculated" (`TOLL_PROVIDER_NOT_CONFIGURED`): costs and margins are marked as without toll, the planner saves no route with an offer, LTL leaves out the detour toll; a toll typed into the offer by hand is used everywhere | planner toll per country, routes saved with offers (so margins use real km and toll), LTL detour toll — **not verified without a provider** |
| **HERE** | **nothing** — no adapter, client or variable in the code (see the next section) | — | — | — |
| **Anthropic (LLM)** | e-mail classification only: model `claude-haiku-4-5-20251001`, 1024 tokens, 10 s timeout, through `@anthropic-ai/sdk` (`api/email-agent/llm-classifier.service.ts`) | `ANTHROPIC_API_KEY` | the rule-based classifier (keywords and patterns) | better category and priority, a short Polish summary and up to 24 extracted fields; the subject, sender and first 3000 characters of the body **leave the server**; on any error it falls back to the rules — **quality not verified without Anthropic** |
| **Mailbox** | **no connector** (no IMAP, POP3, Gmail, webhook); e-mails come in as JSON through `POST /api/email-agent/process` (`api/email-agent/email-agent.controller.ts`, which says so) | — | e-mails are pasted into the test panel or sent by another system to the endpoint | — |
| **Trans.eu** | OAuth sign-in (`api/trans-eu-auth/`) and publishing a freight (`POST https://api.platform.trans.eu/ext/freights-api/v2/freights`, `api/exchange-publisher/exchange-publisher.service.ts`) | `TRANS_EU_CLIENT_ID`, `TRANS_EU_CLIENT_SECRET`, `TRANS_EU_API_KEY`, `API_BASE_URL` (callback address; `https://` makes the cookie Secure) — in `apps/api/.env.example`, empty = off | `connect` answers 400, publishing answers `success: false`, health shows `not_configured` | an ADMIN can connect the company (tokens stored encrypted, refreshed 60 s before expiry) and freights can be published through the API; **the web app has no button for either**; request formats **not verified without Trans.eu** |
| **Timocom** | an interface registered as `null`; publishing answers `TIMOCOM_NOT_IMPLEMENTED` (`api/exchange-publisher/exchange-publisher.module.ts`, `exchange-publisher.service.ts`) | — | — | — |
| **Sentry** | API: only 5xx errors and requests slower than 3000 ms, with the request body, headers, cookies and query removed (`api/common/sentry/`); web: browser, server and edge; Session Replay (a screen recording, all text and inputs masked) is **off by default** — `REPLAY_RATES` 0 % / 0 % (`web/instrumentation-client.ts`, `web/lib/sentry-options.ts`) | API `SENTRY_DSN`; web `NEXT_PUBLIC_SENTRY_DSN`; source maps `SENTRY_AUTH_TOKEN` — all in the `.env.example` files | nothing is sent; 5xx errors still go to the server log | errors reach the Sentry project — **delivery not verified without Sentry**; turning Replay on is one change described in DEPLOYMENT (and belongs in a privacy notice) |
| **Driver activity / tachograph** | only the interface `DriverActivityProvider` and the manual source (`api/fleet-planning/activity/`); the file says nothing of a third party is implemented | a class written by the buyer, registered in `api/fleet-planning/fleet-planning.module.ts` | driver status is entered by hand | — |
| **Map tiles** (web) | OpenStreetMap tiles and the Leaflet stylesheet from unpkg, loaded by the browser (`web/app/(dashboard)/route-planner/route-map-client.tsx`) | always on | no map; nothing in the code handles the failure | the route on a map |
| **Exchange rates** | a fixed table in one file (`api/common/fx.ts`); every converted amount carries `FX_RATE_STATIC` | replace the source in that file | — | — |

---

## HERE: what exists and what it would take

**What exists:** nothing of HERE. A search of the code, the env templates and
the database schema finds no HERE adapter, client or variable; HERE is named
only in planning documents (`docs/fleet-planning/SPEC.md`).

**Two separate jobs, two different starting points:**

1. **Toll from HERE** — the port is ready. Add a class implementing
   `TollProvider.quote(TollRequest): Promise<TollQuote>` that throws only
   `TollProviderError(reason)` (`api/tolls/toll-provider.ts`), read its key
   through `ConfigService`, register it in `api/tolls/tolls.module.ts`
   (replace `useValue: null`), change the test that asserts `null`
   (`apps/api/test/unit/tolls-module.spec.ts`) and run the shared contract
   (`apps/api/test/contract/toll-provider.contract.ts`): a non-empty source,
   only countries of the request, amounts ≥ 0, ISO currency, at most one item
   per country, the request not modified, an empty route gives no items, a
   failure is a `TollProviderError`. One catch: the request carries the OSRM
   route (points, polyline, km per country), while HERE prices tolls on its
   own route — the adapter has to route on HERE again or match the polyline.
   **Estimate: about 2–4 developer days** with HERE access (the adapter, the
   mapping of HERE's answer to `TollQuote`, the contract and a test with a
   recorded answer).
2. **Truck routing from HERE** — no port exists. The planner depends on the
   concrete class `OsrmAdapterService` (`api/route-planner/route-planner.service.ts`).
   The quickest path is a class with the same method
   `calculateRoute(params): Promise<PlannedRoute[]>` registered in its place
   (`api/route-planner/route-planner.module.ts`). The adapter already receives
   the vehicle (weight, height, width, length, axles, ADR, Euro class) and the
   number of alternatives, which OSRM ignores today, and it must return km per
   country (the toll provider and the saved route need them). There is no
   contract test for a route source yet. **Estimate: about 4–7 developer
   days**, including a small route-source interface and tests; more if
   alternatives, restrictions and notices from HERE are to be shown on the
   screen. Both estimates are from the size of the code they touch, not from a
   built adapter.

---

## API modules

Shared by every module: every route is under `/api`; a valid JWT is needed
everywhere except login, refresh, register and `GET /api/health`
(`api/main.ts`); about 100 requests per minute per client, lower where noted
(`api/app.module.ts`); fields not in a request's schema answer 400
(`api/main.ts`, `ValidationPipe`); lists are 20 per page by default, at most
100 (`api/common/dto/pagination.dto.ts`); everything is scoped to the caller's
company. The cache and the task queue are in the process memory — one API
instance (`api/common/cache/`, `api/common/queue/`, at most 3 tasks at once).

### offers — transport offers

**Does**
- Lists offers with filters (status, person, source) and sort by date, price,
  distance, loading date, rate per km or margin; the list is cached 30 s and
  every offer carries a "blacklisted contractor" flag (`api/offers/offers.service.ts`).
- Creates an offer with checked values (weight 0.1–44 000 kg, price
  1–500 000, distance 1–10 000 km, toll up to 50 000, payment term up to 180
  days and more; `api/offers/dto/create-offer.dto.ts`); the currency defaults
  to EUR, the rate per km is computed by the API (`api/offers/price-per-km.ts`).
- Computes cost, profit and margin with one rule everywhere: company cost per
  km × km + toll, the toll typed in first, then the route toll; without a toll
  the margin is an upper bound (`api/common/offer-cost.ts`,
  `api/offers/offer-economics.ts`). The same endpoint previews the margin for
  the new-offer and the edit forms (`POST /offers/economics-preview`).
- Imports offers in bulk (`POST /offers/import`): each row checked on its own,
  bad rows reported with field and code, duplicates by company + source +
  external id skipped, dates `DD.MM.YYYY` read (`api/offers/import-row.ts`,
  `api/offers/raw-offer.ts`).
- Statuses: assigning to a person (`/assign/:userId`, only an active user of
  the company); entering accepted, in transit or completed with a blacklisted
  contractor is for an ADMIN only and logged; restoring a dead offer answers
  `OFFER_STILL_DEAD` (`api/offers/offers.service.ts`).
- Editing (`PATCH`) saves every field of its body; `null` clears a field
  (the flags ADR, reefer and pallet exchange become false); the source and the
  external id — the offer's origin and import key — answer 400
  `OFFER_FIELD_NOT_EDITABLE` when changed (`api/offers/offers.service.ts`).
- Once the offer is accepted, in transit or completed, the
  price, currency, distance, toll, loading and unloading dates, validity,
  cities and countries are for an ADMIN only (`OFFER_LOCKED_FIELDS`, logged
  from → to); a new city or country clears the coordinates.
- Expires offers every hour: a `NEW` offer whose validity has passed, whose
  loading day is past in the loading country's time zone, or which is older
  than 7 days (`api/common/tasks/offer-expiry.task.ts`, `MAX_OFFER_AGE_DAYS`).
- A new or imported offer is checked against active demands in the
  background (see demands).
- Statistics: counts by status and source, revenue from accepted, in-transit
  and completed offers in the company currency, average rate per km and margin
  (`GET /offers/stats`).

**Without outside services:** all of it. **With them:** a route saved by the
planner (OSRM + a toll provider) gives the margin real km and toll; a changed
place gets new coordinates from Nominatim.

**Limits:** there is no full status machine; the edit screen changes only
dates, money, the contractor and notes (cargo and places only through the
API); any user of the company can create,
change and delete offers; an import row without an external id is never a
duplicate; a new place keeps the old saved route until it is calculated
again; the recompute command for a company without a cost per km empties all
margins.

### contractors — business partners

**Does**
- Keeps contractors with contact data and ratings (rating 1–5, payment rating
  1–5, reliability 0–100, average payment days 0–365), sorted by name by
  default, cached 120 s (`api/contractors/`).
- Risk criteria shared by every screen: blacklist; payment rating ≤ 2;
  reliability below 40; a missing rating is not a risk
  (`api/common/counterparty-risk.ts`).
- The blacklist is set and cleared by an ADMIN only (403
  `CONTRACTOR_BLACKLIST_ADMIN_ONLY`, logged); a contractor with any offers
  cannot be deleted (409 `CONTRACTOR_HAS_OFFERS`) — deactivate it instead.

**Without outside services:** all of it; there is no tax-id or registry
lookup. **Limits:** ratings are entered by hand; the blacklist guards against
mistakes, not intent; its trace is a log line only; `contactEmail` is not
checked as an e-mail.

### companies — the company and its cost per km

**Does:** shows the company; an ADMIN edits its data, the **cost per km**
(more than 0, two decimals) and the company currency (PLN, EUR or GBP); a cost
or currency change recomputes the margins of new and assigned offers in the
background; an ADMIN uploads a logo (an image up to about 500 KB)
(`api/companies/`, `api/common/company-currency.ts`). At registration the
currency follows the country: GB → GBP, the euro area → EUR, otherwise PLN.

**Without outside services:** all of it. **Limits:** a logo as inline SVG is
accepted; plan and dispatcher limits are stored but not enforced.

### users and auth — accounts, login, roles

**Does**
- Two roles, ADMIN and DISPATCHER. An ADMIN lists, creates and deactivates
  users; the last active ADMIN cannot be deactivated (`api/users/`).
- Login with e-mail and password; access token 15 minutes by default
  (`JWT_EXPIRES_IN`), refresh token 7 days, stored only as a hash, rotated on
  every use, reuse revokes the whole family; 5 requests per minute on these
  routes (`api/auth/auth.service.ts`, `api/auth/auth.controller.ts`).
- Personal data (e-mail, names, phone) stored encrypted (AES-256-GCM, key
  `ENCRYPTION_KEY`), passwords with bcrypt (`api/common/encryption/`,
  `api/users/users.service.ts`).
- Registration of a new company is off unless `NODE_ENV=development|test` or
  `REGISTRATION_ENABLED=true`; the first company on a server is created with
  `npm run company:create` (`api/common/config/registration.ts`,
  `api/cli/create-company.ts`); a Polish tax id is checked with its check
  digit.
- A user changes their own password (other sessions are logged out).

**Without outside services:** all of it — no single sign-on, no e-mail
verification, no password reset. **Limits:** no profile edit or role change
endpoint; the web app keeps tokens in `localStorage`; most write routes have
no role check.

### notifications

**Does:** stores in-app notifications — a demand matched a new offer, a
vehicle document is about to expire (within 30 days, critical at 7) — and
marks them read; read notifications older than 60 days are deleted every
Sunday (`api/notifications/`, `api/demands/demands.service.ts`,
`api/vehicles/vehicles.service.ts`, `api/common/tasks/data-retention.task.ts`).

**Without outside services:** all of it — nothing is sent by e-mail, push or
SMS. **Limits:** the web app does not show notifications; vehicle expiry
notifications are created only when someone opens the expiring-vehicles list.

### analytics

**Does:** price per km on a country pair (optionally postal prefixes) —
average, min, max, trend of the last 30 days against the 30 before (±3 %);
a market overview: the top 5 country pairs, average margin, revenue, offers
this and last month, 6 months of revenue; cached 5 minutes; amounts in the
company currency with the fixed rates (`api/analytics/analytics.service.ts`).

**Without outside services:** all of it; "market" means the company's own
offers. **Limits:** revenue is grouped by the offer's creation date; month
boundaries use the server's time zone; the cache is not cleared when offers
change.

### health

**Does:** `GET /api/health` answers `ok` without a login and without checking
the database (`api/main.ts`); `GET /api/health/integrations` checks the
database and shows the Trans.eu connection state, uptime, version, cache and
queue counters, cached 30 s (`api/health/health.controller.ts`).

### command-line tools

**Does:** `company:create` creates the first company and its ADMIN (password
from the standard input, optional cost per km) (`api/cli/create-company.ts`);
`offers:recompute-economics [--dry-run]` recomputes every offer's cost and
margin at today's company rate, in batches of 500, writing only what changes
(`api/cli/recompute-economics.ts`, `api/offers/recompute-economics.ts`). Both
need the built `dist/` and the database only.

### seed (demo data)

**Does:** one demo company (cost 4.20 PLN/km), an ADMIN and two dispatchers
with known passwords, 10 vehicles, 13 contractors, over 130 offers in every
status, an LTL demo (Poznań → Berlin) with places already in the geocoding
cache, a demand, 20 notifications and 4 drivers (`apps/api/prisma/seed.ts`).
It runs only with an explicit `NODE_ENV=development` or `test`
(`apps/api/prisma/seed-guard.ts`). The LTL demo needs no outside service.

### route-planner — route, cost and margin

**Does**
- `POST /route-planner/calculate`: a route between points (up to 3 stops) for
  a vehicle (weight 3.5–44 t, height 2–4.5 m, width 2–2.6 m, length 5–18.75 m,
  axles 2–7 — empty means 5+ and is flagged, Euro 3–6 — Euro 6 by default, ADR
  class), with a freight rate in PLN or EUR (`api/route-planner/dto/calculate-route.dto.ts`,
  `api/route-planner/route-planner.service.ts`, `api/common/axle-class.ts`).
- The answer: distance, driving time, km per country, cost (company cost per
  km × km + toll), toll per country from the toll provider, margin, a label
  (cheapest / fastest / shortest) and a recommendation in Polish; routes sorted
  by cost (by km without a company cost) (`route-planner.service.ts`).
- Km per country by the driven distance: a probe every ~50 km plus the start
  and the end, each border narrowed to about ±3 km (`SAMPLE_INTERVAL_KM`,
  `BORDER_RESOLUTION_KM`, `detectCountries` in `osrm-calculator.service.ts`).
- Routes cached 7 days in memory; after 3 OSRM failures the service waits 5
  minutes and uses the hub table meanwhile (`CACHE_TTL_MS`,
  `CIRCUIT_BREAKER_THRESHOLD`).
- Fallback: 30 hubs, 70 hub-to-hub distances, otherwise a straight line × 1.3
  at 70 km/h; marked `ROUTE_ESTIMATED` and never saved; no hub distance → 503
  `ROUTE_UNAVAILABLE`, never a guessed distance (`api/route-planner/hub-distances.data.ts`).
- Opened for an offer, it uses the offer's toll typed in first, and saves the
  route with the offer — only for a real (not estimated) route with a complete
  toll from a provider — which recomputes the offer's margin.
- Road rules of 20 countries (`GET /route-planner/restrictions[/:country]`,
  `truck-restrictions.data.ts`, with no check date in the file) and
  vignette/OBU requirements of 19 (`vignette-requirements.data.ts`, every row
  `lastVerified: '2025-01-15'`), as static tables.
- 20 requests per minute.

**Without outside services:** only the road-rules tables. With Nominatim but
without OSRM: a hub estimate. Without a toll provider: the route and the cost
per km, toll "not calculated", nothing saved with the offer. **With OSRM and
Nominatim:** real routes (car profile) — the first long route takes up to
about 80 s (Nominatim at 1 request per second; DEPLOYMENT: proxy timeout
≥ 120 s), a repeat comes from the cache. **With a toll provider:** toll per
country and saved routes — not verified without a provider.

**Limits:** one route only (alternatives have no effect); vehicle size,
weight and ADR do not shape the route; each border is about ±3 km off and a
country between two probes of the same country is missed; vignettes are
computed but not returned; the vehicle and emission class come from the form,
not the fleet; the toll hint "calculate the route" saves nothing without a
provider.

### tolls — the toll provider port

**Does:** defines what a toll source receives (route points, polyline, km per
country, axle class 2/3/4/5+, emission class, gross weight) and returns
(amounts per country in their currency, the provider's name), and the only
error allowed (`api/tolls/toll-provider.ts`); used by the planner, LTL and
negotiation. **No provider is registered** (`api/tolls/tolls.module.ts`).
Amounts in a currency without a rate make the quote incomplete. See
[HERE](#here-what-exists-and-what-it-would-take) for what an adapter needs.

### geocoding — places for offers

**Does:** turns "city, country" into coordinates through Nominatim, at most
one request per second, cached in the database (found places forever, "not
found" 7 days, errors not at all) (`api/geocoding/geocoding.service.ts`,
`NOT_FOUND_TTL_DAYS`); every 5 minutes fills missing coordinates of up to 20
new offers, never two runs at once (`api/geocoding/offer-geocoding.task.ts`,
`BATCH_SIZE`).

**Without Nominatim:** only places already cached; new offers wait for
coordinates. **Limits:** the queue is per process (several API instances
exceed Nominatim's limit); the planner has its own second geocoder.

### negotiation — price advice for one offer

**Does**
- Price range from the company's own offers on the same country pair, last 90
  days, distance within 100 km: minimum, maximum, average, median, quartiles;
  trend of the last 30 days against days 30–90 (±3 %); suggested price = median
  ± 3 % with the trend; without history 1.15 EUR/km or 4.95 PLN/km
  (`api/negotiation/negotiation.service.ts`, `SIMILAR_ROUTE_RADIUS_KM`,
  `FALLBACK_PER_KM`).
- Contractor profile: orders (accepted, in transit, completed) in total, in 30
  and in 90 days; "regular partner" at 5 or more in 30 days; contractor against
  the company's other offers on similar routes when there are at least 3 and 5
  of them (`MIN_CONTRACTOR_SAMPLE`, `MIN_MARKET_SAMPLE`).
- Up to 5 arguments in Polish (price against the market, trend, regular or new
  contractor, payment risk, a loading within 2 days, unknown cost, low margin,
  ADR, reefer); a blacklisted contractor always comes first.
- Simulation of a proposed price: break-even price, margin verdict (≥ 20 %
  excellent, ≥ 12 % good, ≥ 8 % acceptable — `MIN_ACCEPTABLE_MARGIN_PCT`),
  scenarios −5 % and −10 %.
- Cost and toll from the shared rule: the toll typed in, then the latest
  saved route, otherwise "unknown" (margins then upper bounds).
- 20 requests per minute.

**Without outside services:** all of it (database only); without a route the
distance is a straight line × 1.3. **Limits:** "market" means the company's
own offers; an offer without a distance shows a margin its saved economics
does not have; without history the suggested price can be 0.

### risk-analysis — risks of one offer

**Does:** lists risks with levels — penalty clauses (high), a loading window
under 60 min (high) or 120 min (medium), pallet exchange, ADR and whether the
fleet can carry it, reefer without a reefer in the fleet, an insurance
minimum, a payment term over 60 or 90 days, cross-border transport,
contractor blacklist / payment / reliability, and 46 Polish risk phrases in
the notes; total CRITICAL for a blacklisted contractor or 3 high risks;
"safe to accept" = no high risk; nothing is saved
(`api/risk-analysis/risk-analysis.service.ts`, `risk-keywords.data.ts`).

**Without outside services:** all of it. **Limits:** keyword rules match
parts of Polish words; vehicle documents are not checked.

### ai-evaluation — offer score (no AI)

**Does:** a score 1–10 from the margin and the price per km against the
company's average on the same country pair, a margin rating and a Polish
recommendation; the 30 newest new offers sorted by score; the code says it is
a heuristic with no model (`api/ai-evaluation/ai-evaluation.service.ts`). The
name is kept for compatibility.

**Without outside services:** all of it. **Limits:** an unknown margin scores
a neutral 5 but is rated "poor"; the rating and the recommendation use
different thresholds.

### ltl-matching — part loads along a vehicle's route

**Does**
- `POST /ltl/search`: for a vehicle, the load already on it (0–16 m, 0–44 t),
  a route "from → to" and a maximum detour (10–500 km, 100 by default), lists
  the company's new offers that fit — free loading metres and kg from the
  vehicle record (one euro pallet = 0.4 m), ADR and reefer rules, availability
  by day, the detour as a straight line × 1.25 — and ranks them by **profit**
  (price − detour km × company cost per km − detour toll) or, without a cost
  per km, by revenue (`api/ltl-matching/ltl-matching.service.ts`,
  `api/ltl-matching/offer-value.ts`, `ROAD_FACTOR`).
- Up to 20 offers with an amount and 10 without; blacklisted contractors last
  (up to 10); offers without dimensions, without coordinates and incompatible
  ones listed separately with reasons; a fit score 0–100 for information
  (`MAX_VALUED_MATCHES` … `MAX_UNMEASURABLE`).
- Dead offers left out exactly (validity passed, older than 7 days, loading
  day past in the loading country's zone) (`api/ltl-matching/offer-compatibility.ts`).
- A vehicle record without payload, loading metres, gross or curb weight
  answers 422 naming the missing fields — nothing is assumed.
- Load plan for chosen offers: positions from the doors, centre of gravity,
  totals, warnings for length, payload and gross weight; "optimize" puts the
  heaviest towards the middle; nothing is saved.

**Without outside services:** the load plan; the search needs both route
ends geocoded (Nominatim, or the cache — the demo has them). **With a toll
provider and saved routes:** the detour toll uses the offer route's rate per
km — not verified without a provider.

**Limits:** the detour is a straight line × 1.25; without a toll provider the
detour toll is left out; an offer heavier or longer than the free space
disappears without a reason; axle loads are not computed; dimensions come
from the tractor record, not the semi-trailer.

### matching — vehicle ↔ offer

**Does:** a score 0–100 for a vehicle and an offer — type 30 points (reefer
rules), availability 25, payload 20, same country as the loading 15, valid
documents on the loading day 10 — and hard blocks (ADR, reefer, payload,
expired documents) that set it to 0 with reasons; the best vehicles for an
offer, the 50 newest live offers for a vehicle, and suggestions (the best
vehicle for each of the 20 newest offers, score ≥ 30, top 10)
(`api/matching/matching.service.ts`).

**Without outside services:** all of it. **Limits:** no dimensions and no
distance (country only); availability compares exact times while LTL
compares days; recommendation texts are Polish sentences.

### demands — what a dispatcher is looking for

**Does:** stores demands (title, priority, pickup countries, maximum weight,
ADR, temperature, and more); searches the 500 newest new or assigned offers
and returns up to 50 matching by pickup country, weight, ADR and reefer
(unknown values are named, not rejected); with automatic notifications on, a
new offer that matches creates a notification for the demand's dispatcher
(`api/demands/demands.service.ts`, `api/demands/match-offer-to-demand.ts`,
`SEARCH_SCAN_LIMIT`, `SEARCH_RESULT_LIMIT`).

**Without outside services:** all of it. **Limits:** many demand fields are
stored but not used for matching (vehicle type, loading metres, dates,
regions, minimum rate); the dead-offer rule is not applied; a dispatcher can
open a colleague's demand by its id.

### vehicles — the fleet

**Does:** keeps vehicles with checked values (payload 500–44 000 kg, gross
weight up to 60 000 kg, loading metres 1–16, pallets 1–40, axles 2–7, length,
height, width, ADR classes, documents and their dates, fuel card);
categories tractor, rigid, semi-trailer, trailer and van, with the rule what
may be attached to what (`api/common/vehicle-category.ts`); lists documents
due within 30 days (critical at 7) (`api/vehicles/vehicles.service.ts`).

**Without outside services:** all of it. **Limits:** nothing updates the
vehicle's position; status and availability cannot be set in the web form;
expiry notifications appear only when the list is opened; vehicles have no
emission class.

### fleet-planning — drivers and driving time

**Does:** keeps drivers and assigns one driver to a power unit; a dispatcher
enters the driver's status by hand (last weekly rest, driving this and last
week, reduced rests, compensation owed, current duty); `GET
/drivers/:id/availability` returns the earliest legal departure, driving left
(until the break, today, this week, the fortnight), the latest daily and
weekly rest, compensation and the latest return home — under Regulation
561/2006 (as amended by 2020/1054) and Directive 2002/15 (4.5 h driving, 45 min
break, 9/10 h a day, 56 h a week, 90 h in two weeks, rests, the international
exception, return home every 28 days) (`api/fleet-planning/rules/limits.ts`,
`api/fleet-planning/rules/availability.ts`). Unknown values are taken at their
worst and flagged.

**Without outside services:** all of it, with the manual status. **With a
tachograph source:** none exists — the interface and a rule that rebuilds the
status from a 28-day history are in the code and tested, but only a test fake
uses them (`api/fleet-planning/activity/`,
`api/fleet-planning/rules/status-from-history.ts`).

**Limits:** no screen in the web app; planning a whole trip and checking a
timeline exist in the code but have no route; driving bans, cabotage, ferry
time and the 2002/15 weekly limits are not modelled; some interpretations are
marked for confirmation.

### email-agent — e-mails into offers

**Does**
- Receives an e-mail as JSON (`POST /email-agent/process`), classifies it
  (offer, inquiry, complaint, invoice, other), sets a priority and tags, reads
  places, weight, price and currency, date; keeps an inbox with filters and
  statistics; 20 requests per minute (`api/email-agent/`).
- Rule-based classification: Polish and English keywords, place labels
  ("załadunek", "pickup"…), "PL → NL", "z X do Y", 37 country codes; a
  confidence 40–95 (`api/email-agent/email-classifier.service.ts`).
- Creates an offer from an e-mail only when the pickup and delivery places,
  the loading date and the currency are known — nothing is filled in
  (400 `EMAIL_OFFER_FIELDS_MISSING`); a second offer from the same e-mail is
  409 (`api/email-agent/email-agent.service.ts`).

**Without outside services:** all of the above with the rules. **With
`ANTHROPIC_API_KEY`:** the LLM classifies first (see the services table) and
the offer gets more fields (ADR, temperatures, pallets, payment term, postal
codes, delivery date) — not verified without Anthropic.

**Limits:** no mailbox connector and no attachments; without labels the rules
take the first country named as the pickup country; e-mail offers have no
contractor until someone sets it.

### exchange-publisher and trans-eu-auth — Trans.eu

**Does:** an ADMIN connects the company to Trans.eu with OAuth (signed state,
10-minute expiry, bound to the browser by a cookie; tokens stored encrypted
and refreshed 60 s before expiry) (`api/trans-eu-auth/`); any user can publish
a freight to Trans.eu through `POST /exchange-publisher/publish` — capacity,
vehicle size, body, ADR, reefer temperatures, pallets, two places, price —
and list the last 100 publications (`api/exchange-publisher/`).

**Without Trans.eu:** connect 400, publish `success: false`. **With it:**
connecting and publishing through the API — the request format is not
verified without Trans.eu and has no test.

**Limits:** no web button for connecting or publishing; the "retry" button on
the offer list does nothing; publishing takes free fields, not an offer, and
nothing links the publication to an offer; the ADR class, volume, loading
metres and streets are not sent; an unknown body becomes curtainsider; one API
instance only (sign-ins in progress live in memory); Timocom is not
implemented.

---

## Web screens

The interface is in Polish. Every screen needs a login; the role is checked
in five places only (named below). Error codes from the API are shown as
sentences (`web/lib/api-error.ts`, `web/lib/plan-messages.ts`).

| Screen | What a user can do | Outside services |
|---|---|---|
| **Logowanie** `/login` | e-mail and password (`web/app/login/page.tsx`); no registration or password reset | — |
| **Pulpit** `/` | 6 figures (offers, new, accepted, average margin, average rate per km, revenue), the 3 most profitable of the 100 newest offers, 5 recommendations ("ocena heurystyczna"), 3 vehicle–offer suggestions, the e-mail summary, recent offers (`web/app/(dashboard)/page.tsx`) | — |
| **Oferty** `/offers` | filter by status (8) and source, sort by loading date, freight, rate per km, margin; per offer: next status, assign to me, score, negotiation panel; accepting from a blacklisted contractor only for an ADMIN (`web/app/(dashboard)/offers/page.tsx`) | — |
| **Panel negocjacji** (from the list) | price range and trend, contractor, up to 5 arguments to copy, toll, a price slider with scenarios (`web/components/negotiation-panel.tsx`) | — |
| **Nowa oferta** `/offers/new` | the full offer form with checks; rate history of the country pair; the margin preview computed by the API (= what will be saved); a contractor list with the blacklist marked (`web/app/(dashboard)/offers/new/page.tsx`) | — |
| **Oferta** `/offers/:id` | details, status buttons, score and risk analysis on opening, the 5 best vehicles, links to the route planner and to editing (`web/app/(dashboard)/offers/[id]/page.tsx`) | — |
| **Edytuj ofertę** `/offers/:id/edit` | loading date, validity, price, currency, distance, toll, contractor, notes; only changes are sent; the margin preview as saved; after acceptance a non-ADMIN sees money and dates read-only (`web/app/(dashboard)/offers/[id]/edit/page.tsx`, `web/lib/offer-edit.ts`) | — |
| **Flota** `/fleet`, `/fleet/new`, `/fleet/:id`, `/fleet/:id/edit` | list by category with document deadlines (red ≤ 7 days, amber ≤ 30); add and edit a vehicle with checks, ADR classes, attaching a semi-trailer or trailer; on a vehicle: deadlines and the 5 best offers (`web/app/(dashboard)/fleet/`) | — |
| **Kontrahenci** `/contractors`, `/contractors/:id` | list, add, edit, activate/deactivate; the blacklist switch only for an ADMIN (`web/app/(dashboard)/contractors/`, `web/lib/blacklist-toggle.ts`) | — |
| **Zapotrzebowania** `/demands` | create a demand, search offers for it, switch automatic notifications (`web/app/(dashboard)/demands/page.tsx`) | — |
| **Poczta AI** `/email` | inbox with categories, read, star, notes, create an offer from an e-mail; a test panel with 3 sample e-mails to classify or save; the screen says there is no mailbox connector (`web/app/(dashboard)/email/page.tsx`) | the LLM on the server (badge "LLM" or "Regex") |
| **Doładunki LTL** `/ltl-matching` | choose a vehicle that can carry, set the load already on it, the route and the detour, search; accept an offer (blacklist rule as above); a load plan by drag and drop with automatic ordering (`web/app/(dashboard)/ltl-matching/page.tsx`) | Nominatim on the server (route ends) |
| **Planowanie trasy** `/route-planner` | points with up to 3 stops, vehicle and freight rate; routes with cost, toll per country, margin and a recommendation on a map (`web/app/(dashboard)/route-planner/`) | **Nominatim from the browser**, OSM map tiles and the Leaflet stylesheet from unpkg; OSRM and the toll provider on the server |
| **Analityka** `/analytics` | margin, revenue, offers this and last month, 6 months of revenue, top 5 routes (`web/app/(dashboard)/analytics/page.tsx`) | — |
| **Ustawienia** `/settings` | account, company, cost per km and currency (ADMIN only), logo, password change, system status (database, Trans.eu, cache, queue) (`web/app/(dashboard)/settings/page.tsx`) | Trans.eu status only — no button to connect |

**Role checks in the web app:** accepting an offer from a blacklisted
contractor, the money and date fields of an accepted offer, the blacklist
switch, the cost per km in settings (`web/lib/blacklist-accept.ts`,
`web/lib/offer-edit.ts`, `web/lib/blacklist-toggle.ts`,
`web/app/(dashboard)/settings/page.tsx`); everything else is the same for
both roles. The route guard checks only that a token is present
(`web/components/layout/AuthGuard.tsx`).

**Limits of the screens:** the offer page has no "in transit" / "completed"
buttons and shows those statuses as codes (the list has them); the rate
column says "€/km" for every currency; "Zaproponuj te cene (wkrotce)" in the
negotiation panel is a disabled placeholder; nothing is deleted from the web app (offers, vehicles,
contractors, demands); vehicle status and position cannot be set; contractor
search covers only the current page; notifications are not shown; there are
no screens for fleet planning (drivers) or Trans.eu.

---

## Table: module × outside service

"—" = the module does not use the service. "needs" = the module does not work
without it. "better" = it works without it and does more with it.

| Module | OSRM | Nominatim | Toll provider | LLM | Trans.eu | Mailbox | Sentry | Tachograph |
|---|---|---|---|---|---|---|---|---|
| offers | better (via saved routes) | better (coordinates) | better (via saved routes) | — | — | — | better | — |
| contractors, companies, users, auth | — | — | — | — | — | — | better | — |
| notifications, analytics, health, tools, seed | — | — | — | — | status only (health) | — | better | — |
| route-planner | better (hub estimate without it) | **needs** | better (no toll, nothing saved without it) | — | — | — | better | — |
| tolls | — | — | **is the slot** (empty) | — | — | — | — | — |
| geocoding | — | **needs** (cache only without it) | — | — | — | — | better | — |
| negotiation | — | — | better (only "is one registered") | — | — | — | better | — |
| risk-analysis, ai-evaluation, matching, demands, vehicles | — | — | — | — | — | — | better | — |
| ltl-matching | — | **needs** for search (cache only without it); load plan without | better (detour toll) | — | — | — | better | — |
| fleet-planning | — | — | — | — | — | — | better | better (no adapter exists; manual status without) |
| email-agent | — | — | — | better | — | not supported (HTTP endpoint instead) | better | — |
| exchange-publisher, trans-eu-auth | — | — | — | — | **needs** | — | better | — |
| web: route planner screen | via API | **needs** (browser) | via API | — | — | — | better | — |
| web: other screens | via API | via API | via API | via API | — | — | better | — |
