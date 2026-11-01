# Deployment

A generic guide: what has to run, how to configure it and how to apply
database changes. Nothing in this repository is deployed anywhere, and it
does not prescribe a hosting provider.

## What runs

| Part | Technology | Default port | Notes |
|---|---|---|---|
| API | NestJS (`apps/api`) | 3001 (`PORT`) | All routes under `/api`; Swagger at `/api/docs` — off unless `NODE_ENV` is `development`/`test` or `SWAGGER_ENABLED=true`. |
| Web | Next.js (`apps/web`) | 3000 | Talks to the API at `NEXT_PUBLIC_API_URL`. |
| Database | PostgreSQL 16 (minimum 12) | 5432 | Schema managed by Prisma migrations (`apps/api/prisma/migrations`). Tested on 16 (the gate's `postgres:16`); the oldest version the migrations need is **12** — `ALTER TYPE … ADD VALUE` inside a transaction (`20260310000002_expand_models`; `20260903000000_notification_demand_match` and `20260908000000_notification_fuel_card_expiry` say so themselves). On 11 `migrate deploy` stops at the third migration. |

Run **one API instance**. Cache and task queue live in the process
(`common/cache`, `common/queue`), not in Redis — see
[known-issues.md](./known-issues.md).

External services the API calls:

- OSRM (routing) — the public demo server `router.project-osrm.org`. It has
  no SLA and is rate-limited; production needs its own routing service.
- Nominatim (geocoding) — the public OpenStreetMap server. Its usage policy
  asks for a contact in the `User-Agent`: set `NOMINATIM_CONTACT_EMAIL` to
  your own address. Both callers send it — geocoding and the route planner.
- Optional: an LLM API for e-mail classification (a rule-based fallback is
  used without it), Trans.eu / Timocom, Sentry.

Tolls are computed only by a toll provider you register (README, "Tolls —
plugging in a provider"). Without one the application runs and says toll
was not calculated.

## Docker

The repository ships **no application images**. Docker is used for
PostgreSQL — locally and in the gate (`tools/demo-test.sh` starts
`postgres:16`, migrates, seeds and runs a scenario against it). For example:

```bash
docker run -d --name aispedytor-db \
  -e POSTGRES_PASSWORD=<password> -e POSTGRES_DB=aispedytor \
  -p 127.0.0.1:5432:5432 -v aispedytor-db:/var/lib/postgresql/data \
  postgres:16
```

To containerize the API and web app, the image needs to do what the gate
does on a clean machine:

```bash
npm ci                 # from the repository root (npm workspaces)
npm run build          # turbo: prisma generate + nest build, next build
# API:  cd apps/api && npx prisma migrate deploy && node dist/main.js
# Web:  cd apps/web && npx next start -p 3000
```

`package-lock.json` lists the native binaries (Next SWC, esbuild, rollup,
Sentry CLI, the resolver) for every platform their packages declare, so
`npm ci` installs the right one on Linux and macOS and the build downloads
nothing.

## Configuration and secrets

Configuration comes from environment variables. The templates are
`apps/api/.env.example` and `apps/web/.env.example`. Real values are never
committed: `.env` files are ignored by git. In production, inject them from
your platform's secret store.

### API

| Variable | Required | What it is |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL connection string. |
| `JWT_SECRET` | yes | At least 32 characters. Generate with `openssl rand -hex 32`. The API refuses to start without it or with a known placeholder. |
| `ENCRYPTION_KEY` | yes | 64 hex characters (AES-256). Generate with `openssl rand -hex 32`; all zeros is rejected. Encrypts personal data and integration tokens. **Changing it on an existing database makes that data unreadable** — keep it with the database backups. The seed needs the same key. |
| `JWT_EXPIRES_IN` | no | Access token lifetime (default in the template: `15m`). |
| `PORT` | no | API port (3001). |
| `FRONTEND_URL` | yes in production | Allowed CORS origin — the web app's address. |
| `NODE_ENV` | yes | `production` on a server. Only an explicit `development` or `test` lets the seed run and turns Swagger and registration on without their flags; unset counts as production. At start the API logs the environment and whether Swagger and registration are on (and why); it warns when `NODE_ENV=development` and `FRONTEND_URL` is not localhost. |
| `SWAGGER_ENABLED` | no | `true` turns Swagger (`/api/docs`, the JSON/YAML spec) on outside development/test — all of it, without a key. Leave unset on a public server. |
| `REGISTRATION_ENABLED` | no | `true` turns `POST /api/auth/register` (a new company with its ADMIN, no invitation) on outside development/test; otherwise it answers 403 `REGISTRATION_DISABLED`. Leave unset; create the first company with `company:create` (below). |
| `NOMINATIM_CONTACT_EMAIL` | recommended | Your contact for the Nominatim usage policy, sent in the `User-Agent` by geocoding and by the route planner; without it the API logs a warning. |
| `API_BASE_URL` | for Trans.eu | Public API address; used to build the OAuth callback URL. |
| `TRANS_EU_CLIENT_ID`, `TRANS_EU_CLIENT_SECRET`, `TRANS_EU_API_KEY` | for Trans.eu | Integration credentials. |
| `ANTHROPIC_API_KEY` | no | E-mail classification; without it rules are used. |
| `SENTRY_DSN` | no | Error reporting: 5xx errors and requests slower than 3 s, without request data. |

### Web

| Variable | Required | What it is |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | yes | API address including `/api`. `NEXT_PUBLIC_*` values are built into the bundle — set them **before** `next build`. |
| `NEXT_PUBLIC_SENTRY_DSN` | no | Error reporting in the browser and on the Next server side (`src/instrumentation.ts`, `src/instrumentation-client.ts`). Without it Sentry is off and its SDK is left out of the browser bundle. Built in at `next build`. Session Replay (a recording of the user's screen) is off; to turn it on, set the two rates in `REPLAY_RATES` (`apps/web/src/lib/sentry-options.ts`), rebuild, and name it in your privacy notice. |
| `SENTRY_AUTH_TOKEN` | no | Only at `next build`, with `NEXT_PUBLIC_SENTRY_DSN`: uploads source maps to Sentry. Without it no upload. The upload also needs `SENTRY_ORG` and `SENTRY_PROJECT` — the Sentry build plugin reads them from the environment; `next.config.js` does not set them. |
| `NEXT_RUNTIME` | — | Set by Next itself (`nodejs` or `edge`); `src/instrumentation.ts` reads it to load the matching Sentry config. Do not set it. |

## Database migrations

- Apply with `npx prisma migrate deploy` (in `apps/api`, or
  `npm run db:migrate:deploy`) **before** starting a new API version. Never
  use `prisma migrate dev` against a shared or production database.
- The API `start` script also runs `migrate deploy`. Before that it marks one
  old migration as rolled back — a leftover workaround, listed in known
  issues, to be removed before a production deployment.
- Back up the database before migrating. These migrations remove data on
  purpose (what each one removes: the table in
  [apps/api/prisma/README.md](../apps/api/prisma/README.md)):
  - `20260507062331_remove_orphan_cmrbox_models` — 5 tables;
  - `20260903010000_drop_demand_match_count`;
  - `20260904000000_drop_exchange_scraping_columns`;
  - `20260904100000_drop_offer_search_radius`;
  - `20261005120000_route_calculations_toll_source` — every saved route
    calculation;
  - `20261005130000_drop_trial_and_ai_limit`;
  - `20261005140000_drop_offer_analysis` — the `offer_analyses` table;
  - `20261010140000_refresh_token_hash` — the plain refresh tokens (their
    SHA-256 stays; nobody is logged out);
  - `20261011120000_contractor_total_orders_on_read` — `contractors.total_orders`
    (now counted on read).

  Others rewrite values without losing data (same table).

### After the margin migration: recompute the offer economics once

Order matters. Right after `migrate deploy` applies
`20261011150000_offer_margin_without_tolls` (it only adds a column), recompute
the cost, profit and margin of **all** offers with the current rule
(docs/decisions.md §3a). Until then the old margins (computed by the form from
fuel and toll) carry the flag `false` and count as full margins in the
averages.

```
cd apps/api
npm run build                                    # the command runs dist/
npm run offers:recompute-economics -- --dry-run  # counts only, nothing written
npm run offers:recompute-economics               # writes; safe to run again
```

- It prints how many offers, how many with a full margin, an upper bound (no
  toll — also without a toll provider) and no margin, and how many changed. A
  second run changes 0.
- **Set each company's cost per km first** (`PATCH /api/companies/me` or
  `company:create --cost-per-km`): for a company without one the command
  blanks the cost, profit and margin of all its offers, accepted ones too
  (no rate — no cost); setting the rate later recomputes only `NEW` and
  `ASSIGNED`, so run the command again.
- Saved fallback routes are skipped: a row of 0 km, or exactly 500 km with an
  empty toll breakdown (the old flat fallback), never counts towards a cost;
  the output says `suspected fallback routes ignored: N`. Hub-table estimates
  saved before this version cannot be told from real routes (known-issues).
- The cost uses **today's company cost per km** — also for accepted and
  completed offers (their old margin "from fuel" was a wrong number, not
  history).
- From then on a change of the company cost per km (or its currency)
  recomputes the company's open offers (NEW, ASSIGNED) by itself, in the
  background (the task queue, not inside the request). If that fails, the API
  logs a warning with the company id and the number of open offers — the rate
  stays saved; run `offers:recompute-economics` to fix the margins.

## Seed and demo accounts

`npm run db:seed` creates demo companies, accounts with known passwords and
test data. It is for development and demos only and runs only with an
explicit `NODE_ENV=development` or `test` (`apps/api/prisma/seed-guard.ts`);
with `production`, any other name or no `NODE_ENV` it refuses before it
touches the database. Locally `NODE_ENV="development"` comes from
`apps/api/.env`. A production database starts empty.

## First company

Registration is off on a server (`REGISTRATION_ENABLED` unset). Create the
first company and its ADMIN once, with the same `.env` as the API.

**Needs the built `dist/`:** `company:create` runs
`node dist/cli/create-company.js`, so run `npm run build` in `apps/api` first —
without it Node stops with `Cannot find module …/dist/cli/create-company.js`.
Also after `npx prisma migrate deploy`.

```bash
cd apps/api
read -rs PW && printf '%s\n' "$PW" | npm run company:create -- \
  --company-name "Example Haulage Ltd" --tax-id GB123456789 --country GB \
  --email admin@haulage.example.com --first-name Anna --last-name Nowak
```

- The same rules as `POST /api/auth/register` (the fields of
  `RegisterCompanyDto`, the Polish tax ID check for `PL`, e-mail not taken —
  else exit code 1 with the code). Optional: `--country` (PL by default),
  `--city`, `--street`, `--postal-code`, `--regon`, `--billing-email`,
  `--phone`, `--website`.
- The password is read from stdin only (never an argument: shell history,
  process list). The script prints the company and user ids — no tokens.
- Optional `--cost-per-km 4,20`: the company cost per km **without tolls**, in
  the company currency (from the country). Negotiation and the route planner
  compute an offer's cost as this rate × km + toll; without it they show no
  cost (`OFFER_COST_RATE_MISSING`). The ADMIN can set or change it later in
  the company settings (`PATCH /api/companies/me`).
- Further users of the company: its ADMIN adds them (`POST /api/users`).

## Hosting, proxy and HTTPS

The guide assumes Linux with a reverse proxy (for example nginx) that
terminates TLS in front of `next start` (web, 3000) and `node dist/main.js`
(API, 3001). The dependency advisories in
[known-issues.md](./known-issues.md) are assessed against this setup.

- **Serve the web app over HTTPS** (or on `localhost`). Browsers give
  `navigator.locks` only to a secure context; without it two browser tabs
  that refresh the session at the same moment use one refresh token twice,
  which revokes the whole token family — both tabs are logged out.
- **One proxy hop.** The API trusts exactly one proxy (`trust proxy 1` in
  `main.ts`): the client address — and so the rate limit of 100 requests per
  minute per address — comes from that proxy's `X-Forwarded-For`. With more
  hops (a CDN in front of nginx) change the setting, or every client shares
  one address.
- The API and the web app send their own security headers (helmet on the
  API: strict CSP, HSTS, nosniff; Next: no framing, nosniff, referrer
  policy) — the proxy does not need to add them; HSTS takes effect only over
  https.
- `FRONTEND_URL` is the exact web origin (CORS, with credentials).
- `API_BASE_URL` on `https://` makes the Trans.eu sign-in cookie `Secure`.
- **Proxy timeout for the API ≥ 120 s** (nginx: `proxy_read_timeout 120s;`,
  other proxies their equivalent). The first calculation of a long route
  asks Nominatim about once per 50 km plus about three times per border at
  1 request per second: Warsaw → Madrid took 78 s (72 requests); a repeat
  comes from the cache. The web app sets no shorter timeout of its own and
  Node's default request timeout is 300 s — the proxy is the only limit.
- **Set `TZ` for the API process** (for example `TZ=Europe/Warsaw`, the
  company's zone). The loading day of an offer uses the zone of the loading
  country, but some days and months are counted in the server's zone: vehicle
  "expires in N days" and the daily/weekly tasks, route statistics by month,
  and an offer date with a time but without a zone (known issues, "days in the
  server zone"). A server on UTC shifts those by one or two hours.

## Health checks

- `GET /api/health` — public, answers only that the process is alive. Use it
  for load-balancer and container checks.
- `GET /api/health/integrations` — behind login; database, Trans.eu
  connection, cache and queue state.

## Before going to production

Open items that matter for a real deployment, all described in
[known-issues.md](./known-issues.md):

- HTTPS for the web app and one proxy hop (above);
- own routing service instead of the public OSRM server;
- a toll provider, if toll should be part of costs and margins;
- refresh token storage in the browser (`localStorage`) and a script CSP for
  the web app;
- the `start` script migration workaround;
- single-instance cache and queue.
