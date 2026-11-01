# AiSpedytor

### Intelligent Freight Forwarding & Logistics Automation Platform

AiSpedytor is a modular logistics platform designed for freight forwarders,
dispatchers and transport companies. It combines transport offer management,
route planning, profitable part-load matching, fleet operations, pricing
analysis and AI-assisted email processing.

The project focuses on practical transport workflows: finding additional
loads along an existing route, evaluating their profitability, checking
vehicle compatibility and supporting dispatch decisions.

## Core modules

| Module | Capabilities |
|---|---|
| **Route Planning** | International route calculation, distance and driving-time estimates, country-level distances, transport costs and margin analysis. |
| **LTL Load Matching** | Search for additional loads along a vehicle's route, considering available loading metres, payload, ADR, refrigeration requirements, dates and detour profitability. |
| **Load Planning** | Interactive load placement, weight and length checks, centre-of-gravity estimates and automatic ordering. |
| **Fleet Management** | Vehicles, trailers, technical parameters, document expiry tracking and vehicle-to-offer matching. |
| **Driver Availability** | Driving-time and rest-period calculations based on manually entered driver activity and European transport rules. |
| **Freight & Demand Matching** | Matching transport offers to vehicles and dispatcher-defined transport requirements. |
| **AI Email Processing** | Classification of transport-related emails, structured data extraction and conversion into transport offers. |
| **Negotiation Support** | Break-even calculations, suggested price ranges, margin scenarios and negotiation arguments based on company data. |
| **Risk Assessment** | Contractor risk, payment conditions, penalty clauses, ADR compatibility and transport-specific risk indicators. |
| **Transport Exchange Integration** | Trans.eu OAuth and freight-publication API integration code, pending external verification. |
| **Analytics** | Revenue, margins, freight rates, route statistics and historical trends based on company data. |

## Routing architecture: HERE and OSRM

The route-planning module was originally developed with a HERE Routing API
adapter supporting truck-specific parameters, vehicle dimensions, ADR-related
restrictions, alternative-route requests and toll information.

The historical HERE adapter was subsequently removed from the active codebase.
The current development and demonstration version uses OSRM to avoid recurring
routing API costs during testing.

**Important:** The current OSRM configuration uses a car-routing profile and
does not enforce truck-specific road restrictions. Reintroducing a suitable
truck-routing provider, such as HERE, is a future integration task.

## Technology stack

- **Backend:** TypeScript, NestJS, Prisma, PostgreSQL
- **Frontend:** Next.js 15, React 19, Tailwind CSS, Zustand
- **Architecture:** npm workspaces, Turborepo, modular REST API
- **AI:** Anthropic Claude Haiku for email classification, with rule-based fallback
- **Mapping:** OSRM, OpenStreetMap, Nominatim, Leaflet
- **Testing:** Jest, integration scenarios, Docker-based PostgreSQL checks, CI

## Engineering approach

The platform combines deterministic logistics calculations with targeted
LLM functionality. Load matching, pricing, risk scores and recommendations
are based on explicit rules and company data rather than being presented
as AI-generated decisions.

The repository includes automated tests, deployment documentation,
architecture notes and explicit descriptions of external-service
dependencies and known limitations.

---

## Technical documentation

A web application for freight forwarders and small carriers: transport
offers, fleet, contractors, route costing, part-load (LTL) matching along a
vehicle's route, price negotiation support and offer risk checks. The user
interface is in Polish; API messages are codes with Polish and English
texts.

```
aispedytor/
├── apps/
│   ├── api/   NestJS + Prisma + PostgreSQL (port 3001, routes under /api)
│   └── web/   Next.js 15.5 App Router + React 19 + Tailwind + Zustand (port 3000)
├── docs/      architecture, decisions, known issues, deployment
└── tools/     bramka.sh (the full check), demo-test.sh
```

Monorepo: npm workspaces + Turborepo. Packages: `aispedytor`,
`@aispedytor/api`, `@aispedytor/web`.

## Quick start

Requirements: Node.js 18.18 or newer (`engines` in `package.json`; CI uses 24), npm, Docker (for
PostgreSQL and for the full check).

```bash
# 1. Dependencies — always from the repository root
npm ci

# 2. PostgreSQL 16, matching DATABASE_URL in apps/api/.env.example
#    (port 5432 taken by a local PostgreSQL? use another one here and in .env)
docker run -d --name aispedytor-db \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=ai_spedytor \
  -p 127.0.0.1:5432:5432 postgres:16

# 3. Configuration
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
# Secrets — before migrating and seeding. The API does not start without
# them and the seed cannot encrypt data (there are no fallback values):
sed -i.bak "s|^JWT_SECRET=.*|JWT_SECRET=\"$(openssl rand -hex 32)\"|; s|^ENCRYPTION_KEY=.*|ENCRYPTION_KEY=\"$(openssl rand -hex 32)\"|" apps/api/.env && rm apps/api/.env.bak

# 4. Database schema, Prisma client and demo data
npm run db:migrate:deploy --workspace=apps/api
npm run db:generate --workspace=apps/api
npm run db:seed

# 5. API and web app together
npm run dev
```

Open http://localhost:3000. API documentation (Swagger):
http://localhost:3001/api/docs.

### Demo accounts

**These are test data.** Only the seed creates them, together with sample
offers, vehicles and contractors; the passwords are public because they are
meant for local work and tests. The seed **runs only with an explicit
`NODE_ENV=development` or `test`** (`apps/api/prisma/seed-guard.ts`): with
`production`, another environment name or **no `NODE_ENV`** it refuses before
it touches the database, so it will not create these accounts on a server.
Locally `NODE_ENV="development"` comes from `apps/api/.env` (copied from
`.env.example`); scripts and tests set `NODE_ENV=test` themselves.

**Registering a new company** (`POST /api/auth/register`) works only with an
explicit `NODE_ENV=development|test` or `REGISTRATION_ENABLED=true`; with no
`NODE_ENV` it is off (403 `REGISTRATION_DISABLED`), and so is Swagger. The
first company on a server is created by `npm run company:create` —
`docs/DEPLOYMENT.md`, "First company".

The addresses are in a reserved domain (`*.example.com`, RFC 2606). Until
9 October 2026 the seed created `@spedytor.pl` accounts. The seed adds
accounts and never rewrites existing ones, so on an older database the new
logins would appear next to the old ones — **after the address change, seed
from an empty database** (for example `npx prisma migrate reset` locally,
never in production).

| E-mail | Password | Role |
|---|---|---|
| admin@spedytor.example.com | Admin1234! | ADMIN |
| jan.kowalski@spedytor.example.com | Disp1234! | DISPATCHER |
| anna.nowak@spedytor.example.com | Disp1234! | DISPATCHER |

## Tests and the full check

```bash
./tools/bramka.sh                      # the full check — run before every commit
npm test --workspace=apps/api          # API unit tests (integration tests: tools/demo-test.sh, part of the full check)
npm test --workspace=apps/web          # web tests (src/lib)
```

`tools/bramka.sh` is the definition of "done": API and web lint (zero errors,
zero warnings), API tests, the API tests again with the clock 5 years ahead
(`test:future` — no test may rely on a hardcoded date being in the future),
API build, a
scenario test on a real PostgreSQL in Docker (`tools/demo-test.sh`:
migrations, seed, an LTL search on the demo route, and the parts that need a
real database — fleet planning, refresh token families and hashing, offer
import, `company:create`, `offers:recompute-economics`, the offer expiry
task), web tests, web build.
Every check runs to the end and the script fails if any of them failed. CI
(`.github/workflows/bramka.yml`) runs the same script with random secrets
generated for the run.

How tests are written and checked (a characterization test first for changes
to numbers, mutations to prove a test guards its line):
[docs/decisions.md §10](docs/decisions.md#10-how-changes-are-checked).

## Tolls — plugging in a provider

The application does not estimate toll. Toll amounts come only from a
**toll provider**, and none is included. Without one the application works
and says so: the route planner shows toll as not calculated
(`TOLL_PROVIDER_NOT_CONFIGURED`) and marks cost and margin as incomplete;
LTL ranks offers by profit without the detour toll, with the code on each
card and once above the list; negotiation offers a manually entered toll.

**The contract** — `apps/api/src/tolls/toll-provider.ts`:

```ts
interface TollProvider {
  quote(request: TollRequest): Promise<TollQuote>;
}
```

- `TollRequest` — the route (points, encoded geometry, total km, km per
  country) and the vehicle (axle class of the whole combination, emission
  class, gross weight in tonnes or `null`).
- `TollQuote` — `source` (the provider's name, saved with the route) and
  `items`: one per country, `amount` ≥ 0 and `currency` (ISO 4217). Amounts
  are converted through `common/fx.ts`; an item in a currency without a rate
  is reported as unresolved, never added as is.
- Failures: throw `TollProviderError(reason)`. The planner answers
  `502 TOLL_PROVIDER_UNAVAILABLE { reason }` and saves nothing; there is no
  fallback to another source.

**Where to register it** — one place, `apps/api/src/tolls/tolls.module.ts`:

```ts
providers: [{ provide: TOLL_PROVIDER, useClass: MyTollProvider }],
```

Configuration (credentials, endpoints) belongs to your implementation: read
it from the environment and describe it in `docs/DEPLOYMENT.md`.

**Run the contract tests** against your implementation. Add a spec next to
the existing one:

```ts
// apps/api/test/contract/my-toll-provider.contract.spec.ts
import { runTollProviderContract } from './toll-provider.contract';
import { MyTollProvider } from '../../src/tolls/my-toll-provider';

runTollProviderContract('MyTollProvider', {
  make: () => new MyTollProvider(/* working configuration */),
  failing: () => new MyTollProvider(/* configuration that must fail */),
});
```

```bash
cd apps/api && npx jest test/contract
```

The contract checks the source name, countries taken only from the request,
finite non-negative amounts, three-letter currencies, one item per country,
that the request is not modified, no items for an empty route, and that a
failure is a `TollProviderError` with a reason. A test-only fake
(`apps/api/test/fakes/fixed-rate-toll-provider.ts`) passes it, and
`apps/api/test/unit/toll-provider-flow.spec.ts` shows the planner, LTL
ranking and negotiation using a registered provider end to end.

## Scope

Out of scope — not implemented and not planned in this codebase:

- **plans, usage limits and billing** (no trial, no per-company quotas, no
  payments);
- **a mailbox connector** (IMAP, Gmail): the e-mail module classifies e-mails
  pasted in its test panel or sent to `POST /api/email-agent/process`;
- **toll estimation** — see the section above;
- **live exchange rates**: `apps/api/src/common/fx.ts` holds static rates and
  every converted amount says so (`FX_RATE_STATIC`); it is the single place
  to switch the source.

## How it decides

Rankings, scores and risks are deterministic — rules, statistics on the
company's own data and domain heuristics; the same input gives the same
output:

- **LTL matching** (`ltl-matching/`) — offers that fit the free space on a
  vehicle's route, ranked by profit in the company's currency (price −
  detour km × cost per km − detour toll from a provider).
- **Route planner** (`route-planner/`) — route, toll (from a provider), cost
  and margin; OSRM for routing.
- **Offer cost** (`common/offer-cost.ts`) — one formula for negotiation and
  the route planner: **the company cost per km × km + toll**. The cost per km
  is **without tolls**, in the **company currency**; an ADMIN sets it in the
  company settings (`PATCH /api/companies/me`) or with
  `company:create --cost-per-km`. Without it there is no cost
  (`OFFER_COST_RATE_MISSING`); without a toll the margin is an upper bound
  (`OFFER_COST_WITHOUT_TOLLS`); without a distance there is no cost
  (`OFFER_COST_NO_DISTANCE`). No fuel constants and no assumed distance.
- **Negotiation** (`negotiation/`) — break-even price, a target range,
  market percentiles from the company's history, price scenarios and
  arguments.
- **Risk analysis** (`risk-analysis/`) — payment terms, penalty clauses,
  insurance requirements, pallet exchange, ADR and reefer loads against the
  fleet, loading window, international transport, and 46 Polish risk
  phrases in the offer text.
- **Offer score** (`ai-evaluation/`) — margin thresholds adjusted by price
  per km against the company's own offers on the same country pair. A
  heuristic: no model is involved; the module name and API paths are
  historical.

The only module that calls an LLM is **e-mail classification**
(`email-agent/llm-classifier.service.ts`, Claude Haiku). Without an API key,
or when the call fails, a rule-based classifier is used.

## Documentation

- [HANDOFF.md](HANDOFF.md) — where the work stands and what comes next.
- [docs/MODULES.md](docs/MODULES.md) — what each module and screen does, read from
  the code, and what changes with each outside service.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — modules and data flow.
- [docs/decisions.md](docs/decisions.md) — what was decided and why.
- [docs/known-issues.md](docs/known-issues.md) — open defects, gaps and
  accepted approximations.
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — what runs, configuration,
  secrets, migrations.
- [docs/fleet-planning/SPEC.md](docs/fleet-planning/SPEC.md) — the fleet planning module
  (stages 1–7); stage 1 is in [apps/api/src/fleet-planning](apps/api/src/fleet-planning/README.md):
  drivers, the manual status and the driving-time rules (561/2006, 2002/15).

## License

All rights reserved — see [LICENSE](LICENSE).
