# AiSpedytor — Architecture

## 1. Overview

AiSpedytor is a multi-tenant SaaS platform supporting freight forwarders (spedytorzy) in the European TSL industry (Transport, Logistics, Shipping). The system automates the most time-consuming parts of a dispatcher's workflow: triaging e-mails sent to the app (pasted or posted to the API — there is no mailbox connector), evaluating offer profitability, scoring transport risk, calculating negotiation positions, and matching demands to available vehicles.

The product is built around a **decision intelligence engine** — a deterministic, rule-based core that handles the bulk of business reasoning — with **LLM components confined to high-value, low-frequency tasks** (currently: email classification). This architecture keeps operational AI costs in the 5–15 PLN/month per tenant range, an order of magnitude lower than "AI-first" competitors.

## 2. Tech Stack

### Backend (`apps/api`)
- **Framework:** NestJS 10.4 with TypeScript 5.9
- **ORM:** Prisma 5.22
- **Database:** PostgreSQL (15 models, 12 enums)
- **Auth:** JWT access tokens (15min) + refresh tokens (7d) via Passport
- **Validation:** class-validator + class-transformer
- **API Docs:** Swagger / OpenAPI (`@nestjs/swagger`)
- **Throttling:** `@nestjs/throttler` for rate limiting
- **Scheduling:** `@nestjs/schedule` for cron-like background tasks
- **Encryption:** AES-256-GCM for PII (custom module under `common/encryption`)
- **Error tracking:** Sentry (`@sentry/node`)
- **AI:** Anthropic SDK 0.78.0 (Claude Haiku for email triage)

### Frontend (`apps/web`)
- **Framework:** Next.js 15.5 (App Router)
- **UI:** React 19 + Tailwind CSS
- **State:** Zustand
- **Auth:** JWT access + refresh token in `localStorage` via `zustand/persist` (`store/auth.store.ts`)
- **TypeScript:** 5.9

### Monorepo Tooling
- **Turborepo** for caching and parallel build/dev tasks
- **npm workspaces** for cross-package dependencies

## 3. Monorepo Structure

```
aispedytor/
├── apps/
│   ├── api/                    Backend NestJS (port 3001)
│   │   ├── prisma/             Schema, migrations, seed
│   │   └── src/                feature modules (see Section 4)
│   └── web/                    Frontend Next.js (port 3000)
├── turbo.json                  Pipeline definitions
└── package.json                Root workspace config
```

## 4. Backend Modules (25 total)

22 feature modules below, plus the infrastructure directories `prisma`, `common` and `cli`.

### Core domain (8 modules)

| Module | Purpose |
|---|---|
| `auth` | Login, logout, token refresh, password hashing (bcrypt) |
| `users` | User CRUD, role management (ADMIN, DISPATCHER) |
| `companies` | Multi-tenant company entity: profile, settings (cost per km, currency), logo. Plan fields (`subscriptionPlan`, `maxDispatchers`) are written at registration and not enforced anywhere — subscription plans are out of scope |
| `offers` | Freight offer lifecycle: import (`POST /offers/import`), status transitions, assignment |
| `vehicles` | Fleet management: vehicle types, trailers, ADR classes, document expiry tracking |
| `contractors` | Counterparty database (carriers, shippers): payment rating 1–5, reliability 0–100 and the blacklist flag — entered by hand, not computed; the order count is computed on read |
| `demands` | Dispatcher demands — open requests for vehicle/route matching |
| `notifications` | In-app notifications only (list, mark read); nothing is sent by e-mail |

### Decision Intelligence Engine (5 modules)

| Module | Purpose |
|---|---|
| `negotiation` | Break-even price from the offer cost (`offerCost`), market position percentiles, price scenarios with a margin verdict, and arguments |
| `risk-analysis` | Offer risk checks: payment terms, penalties, ADR/reefer against the fleet, loading window, risk phrases |
| `ai-evaluation` | Heuristic offer score 1-10 from margin and price per km vs the company's average on the route (no model, name is historical) |
| `matching` | Vehicle ↔ offer scoring (type, capacity, location, documents on the loading day, ADR, reefer); dead offers are left out of the lists (demands are matched in `demands`) |
| `ltl-matching` | Part loads on a vehicle's route: compatibility, free space, detour and a profit ranking; a load plan for several loads (positions, cumulative weight and metres, reorder). No multi-stop milk-run routing |

### Optimization & Planning (3 modules)

| Module | Purpose |
|---|---|
| `route-planner` | Route planning via OSRM (`router.project-osrm.org`); toll from the registered `TollProvider` (`tolls/`); country restriction notes |
| `tolls` | The `TollProvider` port; no provider is registered here (toll shown as not calculated) |
| `fleet-planning` | Drivers, manual driver status, 561/2006 and 2002/15 rules (timeline validator, planner, availability), `DriverActivityProvider` gateway — stage 1 of `docs/fleet-planning/SPEC.md`; see the module README |

### Integrations (2 modules)

| Module | Purpose |
|---|---|
| `trans-eu-auth` | OAuth 2.0 dedicated module for Trans.eu API integration |
| `exchange-publisher` | Publishing own offers/demands to external exchanges |

### AI & Communication (1 module)

| Module | Purpose |
|---|---|
| `email-agent` | Inbox triage with Claude Haiku classifier + regex fallback. The only module making LLM API calls. |

### Analytics, Health & Geocoding (3 modules)

| Module | Purpose |
|---|---|
| `analytics` | KPI tracking, dashboard data aggregation |
| `geocoding` | Nominatim geocoding with a shared cache (`geocode_cache`) and a task every 5 minutes that fills offer coordinates; no routes |
| `health` | `GET /api/health` — public, static `{status:'ok'}` (process alive, no dependency checks); `GET /api/health/integrations` — behind login: database, the company's Trans.eu connection, cache and queue. No separate readiness probe |

### Infrastructure (`prisma` + `common` + `cli`)

- `prisma/` — Prisma client provider, database connection management
- `cli/` — operator scripts run on the server, not routes: `create-company.ts` (`npm run company:create`, the first company and its ADMIN while registration is off — `docs/DEPLOYMENT.md`, "First company")
- `common/` — Cross-cutting concerns:
  - `encryption/` — AES-256-GCM for PII
  - `cache/` — In-memory caching layer
  - `queue/` — Background job queue
  - `sentry/` — Error reporting integration
  - `tasks/` — Scheduled tasks
  - `config/` — secrets check at start, Swagger and registration switches, the start report
  - `decorators/`, `dto/`, `filters/`, `guards/`, `interceptors/`, `types/` — NestJS framework helpers
  - files at the root — shared rules: `offer-cost.ts` (the offer cost), `fx.ts` and `money.ts` (exchange rates, amounts in the company currency), `counterparty-risk.ts`, `country-timezone.ts` (the loading day), `adr.ts`, `reefer.ts`, `plan-messages.ts` (the message codes), `tax-id.ts`, `vehicle-category.ts`, `axle-class.ts`

## 5. Multi-Tenant Model

Tenant-scoped entities carry a `companyId` referencing the `Company` model — directly, or through their parent (a saved route through its offer). Multi-tenant isolation is enforced at three layers:

1. **Database level:** most company tables cascade on company deletion (`onDelete: Cascade`). The `ExchangeConnection` and `PublishedOffer` tables restrict it — a company with a Trans.eu connection or published offers cannot be deleted until those rows are; `route_calculations` has no foreign key to the company — its rows belong to an offer (`offer_id`, `ON DELETE CASCADE`) and are deleted with it, so with the company's offers too
2. **Service level:** every read and bulk write includes `where: { companyId }` — defense-in-depth, never trust just URL params
3. **Auth level:** JWT payload contains `companyId`, attached to request context via `JwtAuthGuard`; the company and role are re-read from the database on every request

Reads by id carry `companyId`. A single-row update or delete goes by `id` right after the same request found that row in the caller's company (`findOne(id, companyId)`). `test/unit/app-scope.spec.ts` checks both rules for the whole app (decisions §10).

## 6. AI Architecture Philosophy

AiSpedytor is built on a **cost-conscious AI architecture** with two clear tiers.

### Tier 1 — Deterministic Decision Engines

Where reasoning can be expressed as rules, formulas, or statistical analysis, we use deterministic code:

- **Negotiation:** break-even from the offer cost, market percentile from historical data
- **Risk Analysis:** thresholds on offer fields, phrase-list matching, ADR and reefer checks against the fleet
- **Evaluation:** statistical scoring against company's own historical price-per-km data

These engines are **fully deterministic** — same input always produces same output. This is critical for:

- **Audit trails:** every decision can be traced to specific rules
- **Regulatory compliance:** logic is auditable, not an opaque model
- **Operator trust:** dispatchers can verify why the system flagged something
- **Cost predictability:** zero per-request inference costs

### Tier 2 — LLM Components

Currently a single module: `email-agent/llm-classifier.service.ts`. Email classification is a probabilistic task (categorizing free-form text into 5+ categories with high accuracy), poorly suited to deterministic rules. Claude Haiku is the optimal cost/quality choice for high-volume, well-defined classification.

Volume: typically 50-200 calls per tenant per day → operational cost: **5-15 PLN per tenant per month**, roughly 20-50× lower than "AI-first" TMS competitors that route every interaction through an LLM.

### Extension Path

Adding new LLM features (contract auto-generation, custom report writing, smart inbox replies) is straightforward — each becomes a new service consuming the same Anthropic SDK setup. The deterministic core is not affected.

## 7. Decision Intelligence Engine — Detail

### Negotiation (`negotiation/`)

Inputs: offer details, contractor profile, the company's other offers on similar routes, the offer cost (`common/offer-cost.ts`: the company cost per km × route km + toll from a toll provider).

Outputs:

- **Break-even price:** the offer cost — no fuel or wage constants; without a cost per km or a distance there is no cost and a code says so
- **Sweet-spot range:** prices giving a 12–20 % margin over that cost
- **Market percentiles:** offer's price position vs comparable historical offers (p25/p50/p75)
- **Scenario verdicts** from the margin: excellent (≥ 20 %), good (≥ 12 %), acceptable (≥ 8 %), low (≥ 0), loss; `uncertain` when the cost has no toll and the margin is only an upper bound
- **Negotiation arguments:** points the dispatcher can use in conversation — Polish sentences built on the server (decisions §1)

### Risk Analysis (`risk-analysis/`)

Checks:

- **Offer terms:** long payment term, penalty clauses, required carrier's insurance, pallet exchange, short loading window
- **Dangerous and reefer loads:** every ADR load is flagged; also an ADR load with no ADR vehicle, or a reefer load with no reefer, in the fleet
- **International transport** between EU countries (cabotage and transport documents reminder)
- **Risk phrases:** 46 Polish phrases matched in the offer's free text, grouped by category

Vehicle documents are not checked here: an offer has no assigned vehicle. Expiring documents are listed per vehicle (`GET /vehicles/expiring`).

Outputs structured risk score with itemized issue list.

### Profitability Evaluation (`ai-evaluation/`)

A heuristic, not a model — no LLM call. Scores offers on a 1-10 scale:

- base from the offer's margin (`profitMarginPercent` thresholds);
- adjustment for its price per km against the average of the company's own
  offers on the same country pair.

Route popularity (number of earlier offers on the pair) only goes into the
recommendation text, not into the score. Contractor data is not used.

## 8. External Integrations

### Trans.eu

- OAuth 2.0 authentication module (`trans-eu-auth/`); `connect` and `disconnect` are ADMIN only; the signed one-time `state` is bound to the browser that started `connect` (an HttpOnly cookie on the callback path) — a forwarded login link fails in another browser with 400 `BROWSER_MISMATCH`
- Implemented in code: publishing own offers (`exchange-publisher` -> `POST api.platform.trans.eu/ext/freights-api/v2/freights`)
- The four `/api/integrations/transeu/*` routes have no caller in `apps/web`
- Whether production credentials are issued, and whether the integration was ever run against the live API, **cannot be established from this repository**

### Timocom

- **No built-in implementation.** Publishing with `publishToTimocom` answers `success: false`, `TIMOCOM_NOT_IMPLEMENTED`; nothing is sent. Only the port `ExchangeAdapter` (`exchange-publisher/exchange-adapter.ts`, token `TIMOCOM_ADAPTER`, `null` by default) remains; an adapter publishes with the account of the caller's company — see the module README, "Plugging in a Timocom adapter"
- Status of the commercial arrangement **cannot be established from this repository**

### OSRM + Nominatim

- Route geometry, distance and duration: public demo instance `router.project-osrm.org`
- Geocoding: public `nominatim.openstreetmap.org`
- Neither requires a key; both are used without an SLA

### Toll data

The repository contains **no toll amounts**. Toll comes from a `TollProvider`
(`apps/api/src/tolls/`) registered in `tolls.module.ts`; none is registered
here, so the planner, the LTL ranking and negotiation show toll as missing
(`TOLL_PROVIDER_NOT_CONFIGURED`) and mark costs as incomplete. See
[decisions.md](./decisions.md) §5 and the README section "Tolls — plugging in a
provider".

Static data that remains is descriptive only: country restrictions
(`truck-restrictions.data.ts` — dimensions, weekend bans, who charges toll),
vignette obligations (`vignette-requirements.data.ts`, no prices) and hub
distances for the routing fallback.

### Anthropic Claude

- Used exclusively in `email-agent/llm-classifier.service.ts`
- Model: Claude Haiku 4.5 (cost-optimized for high-volume classification)
- Fallback: regex-based classifier for offline/quota scenarios

---

For deployment, server configuration, and operational procedures, see [DEPLOYMENT.md](./DEPLOYMENT.md).
