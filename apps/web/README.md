# web — the Next.js front end

The browser application for forwarders: dashboard, offers, fleet, demands,
contractors, e-mail classification, route planner, LTL part loads, analytics
and settings. Next.js 15.5 (App Router), React 19, Tailwind, Zustand, axios,
Leaflet (map) and Recharts (charts). The interface is in Polish on purpose;
only the messages that come from the API also have an English dictionary.

## Structure

| Path | What it holds |
|---|---|
| `src/app/login/page.tsx` | Login form (`POST /auth/login`). |
| `src/app/(dashboard)/layout.tsx` | Every screen except login: `AuthGuard` + `Sidebar`. |
| `src/app/(dashboard)/page.tsx` | Dashboard: KPIs, most profitable of the 100 newest offers, heuristic recommendations ("Planuj trasę" from the result's cities and price, `src/lib/recommendation-link.ts`), matching suggestions, e-mail widget. |
| `src/app/(dashboard)/offers/` | Offer list (with the negotiation panel), offer detail (heuristic score, risk analysis, matching vehicles), new offer form (route rate history). |
| `src/app/(dashboard)/fleet/` | Vehicle list, detail, create and edit (`_components/vehicle-form.tsx`), attaching semi-trailers / trailers. |
| `src/app/(dashboard)/demands/page.tsx` | Transport demands: create, search (the first 10 found under the demand, the total, the scan-limit note — `src/lib/demand-search.ts`), subscribe; a list error is shown as an error, not as an empty list. |
| `src/app/(dashboard)/contractors/` | Contractor list and detail, including risk ratings. |
| `src/app/(dashboard)/email/page.tsx` | E-mails pasted in the test panel or sent to the API: classification, notes, creating an offer; the list in pages of 20. It reads no mailbox. |
| `src/app/(dashboard)/route-planner/` | Route planner form and results; `route-map-client.tsx` draws the routes with Leaflet. |
| `src/app/(dashboard)/ltl-matching/page.tsx` | LTL search along a vehicle's route and the load plan; offers without weight or dimensions in a collapsed section (the full number, the 20 nearest, "i jeszcze N"). |
| `src/app/(dashboard)/analytics/page.tsx` | Market overview and monthly revenue. |
| `src/app/(dashboard)/settings/page.tsx` | Company data and logo, cost per km and its currency, password change, integration status. |
| `src/components/` | `layout/AuthGuard.tsx`, `layout/Sidebar.tsx`, `negotiation-panel.tsx`, `pagination.tsx`. |
| `src/lib/` | Logic without React, all of it tested: API client, message dictionary, formatting, money, load plan, LTL search view, vehicle categories, paginated lists, form helpers. |
| `src/store/auth.store.ts` | Logged-in user and tokens (Zustand, persisted in `localStorage` under `ai-spedytor-auth`). |
| `sentry.*.config.ts` | Sentry, active only when `NEXT_PUBLIC_SENTRY_DSN` is set. |

## How to run

From the repository root (dependencies are installed there, not in
`apps/web`):

```bash
cp apps/web/.env.example apps/web/.env.local
npm run dev                          # API and web together (Turborepo)
npm run dev --workspace=apps/web     # web only, http://localhost:3000
npm run build --workspace=apps/web
npm test --workspace=apps/web
```

Environment:

| Variable | Default | Meaning |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `http://localhost:3001/api` | Base URL of the API. |
| `NEXT_PUBLIC_SENTRY_DSN` | empty | Sentry DSN; without it Sentry is off and the Next config is not wrapped. |

## Login and tokens

`src/lib/api-client.ts` is the one axios instance. It adds
`Authorization: Bearer <access token>` to every request. On a `401` it calls
`POST /auth/refresh` once (parallel requests in the tab wait for that one
refresh), stores **both** new tokens — the API rotates the refresh token, so
the old one stops working — and repeats the request. If the refresh is
refused (401/403) or there is no refresh token, it logs out, goes to
`/login`, and every waiting request gets the error. A `429` (the rate limit
is per address — an office behind one NAT shares it), a `5xx` or a network
error does not log out: the request fails and the next one tries again. `AuthGuard` sends a visitor without an access token to `/login`.

- A `401` from `/auth/login`, `/auth/register` or `/auth/refresh` does not
  start a refresh: a wrong password stays a message on the login form.
- No refresh token stored → no call to `/auth/refresh` (logout and `/login`).
- **Several tabs.** The API treats a second use of the same refresh token as
  theft and deletes the whole family (every tab of that login is logged out).
  So the refresh runs under the Web Locks API (`navigator.locks`, lock
  `ai-spedytor-token-refresh`), and under the lock the tokens are read again
  from `localStorage` (`ai-spedytor-auth`). If another tab already refreshed
  (the stored access token differs from the one that got the `401`), the tab
  takes that pair instead of refreshing again. If that token has expired too,
  one real refresh follows with its refresh token; after a real refresh there
  is no further try (no loop).
- Browsers have `navigator.locks` only in a secure context — HTTPS or
  `localhost`. Without it (plain `http` on another address) the client works
  as in one tab, and two tabs refreshing at once log each other out —
  [known issues](../../docs/known-issues.md), `auth`.

## How API messages become text

The API does not compose sentences. Warnings, reasons and errors arrive as
`{ code, params }` (list `PLAN_MESSAGE_CODES` in
`apps/api/src/common/plan-messages.ts`; see
[docs/decisions.md §1](../../docs/decisions.md)).

- `src/lib/plan-messages.ts` holds the dictionary `MESSAGES` with a Polish
  and an English template for every code. `messageText(message, language)`
  builds the sentence with the number and date formatting of the language
  (`src/lib/formatting.ts`: `28 000 kg` / `28,000 kg`, `40,5 t` / `40.5 t`).
  An unknown code returns the code itself; an unknown language falls back to
  Polish.
- `messagesToText(list, language)` turns a list of messages into a list of
  sentences, so a screen never renders an API object directly.
- `src/lib/api-error.ts` — `apiErrorText(data, fallback, language)` turns an
  error body into one sentence: a `code` goes through the dictionary, a DTO
  validation `message` array is joined, a plain `message` is shown as is, and
  with no body (network error) the screen's fallback text is shown.
- The screens call these with the default language (`pl`); the English
  dictionary exists and is tested, but there is no language switch in the
  interface.

A test reads the code list from the API source: a code without a
translation, a translation for a code that no longer exists, an empty
sentence or identical PL/EN text fails it.

## Tests

`npm test --workspace=apps/web` runs Jest (`ts-jest`, Node environment)
on `src/lib/*.test.ts`. There are no component rendering tests; besides the
pure logic, several tests read the source of a screen and check that it uses
the shared helper (for example that the LTL screen builds load-plan items
only through `loadPlanItem`).

| Test | What it checks |
|---|---|
| `src/lib/env-example.test.ts` | Every key of `.env.example` is read by the web code or the Next configuration, and every variable that code reads is in the example. |
| `src/lib/offer-edit.test.ts` | The edit screen: the lock per status and role as in the API; the form from the offer; the body only from changes (cleared → `null`, the validity as an ISO moment, locked fields left out); the preview body with `offerId`; the API refusals as sentences; the page wiring and the link on the offer page. |
| `src/lib/offer-still-dead.test.ts` | `OFFER_STILL_DEAD` sentences (PL/EN): PICKUP_PASSED and EXPIRED point to "Edytuj ofertę", none says "only through the API"; the link exists on the offer page. |
| `src/lib/plan-messages.test.ts` | The dictionary covers exactly the API codes in PL and EN; values and formatting inside the sentences. |
| `src/lib/api-error.test.ts` | `apiErrorText`: codes, DTO messages, fallback. |
| `src/lib/api-client.test.ts` | Two refreshes in a row work with rotated tokens; a refused refresh logs out. |
| `src/lib/api-client-refresh.test.ts` | Logout only on a refused refresh (401/403), not on 429, 5xx or a network error; A wrong password does not refresh or reload; no refresh token, no refresh; a refused refresh rejects every waiting request; the refresh runs under `navigator.locks` and takes a pair another tab already refreshed (no second use of a refresh token); without `navigator.locks` it still works, with one refresh for parallel `401`s (`localStorage` and `navigator.locks` substituted). |
| `src/lib/silent-catch.test.ts` | No empty `catch` in `src/app` and `src/components` without a stated reason; error states are rendered. |
| `src/lib/vehicle-label.test.ts` | The LTL vehicle label shows only the vehicle record (no invented length or payload). |
| `src/lib/ui-polish-text.test.ts` | Polish UI texts keep their diacritics (code without comments); the word list is `tools/polish-words-without-diacritics.json`, shared with the API admin message test. |
| `src/sentry-setup.test.ts` | Sentry on the Next 15 / Sentry 10 layout: `src/instrumentation.ts` loads the server / Edge config and sets `onRequestError`; `src/instrumentation-client.ts` uses the SDK only under a direct DSN check (out of the bundle without a DSN); `withSentryConfig` from `@sentry/nextjs/config`, only with a DSN; `@sentry/nextjs` ≥ 10.73. |
| `src/sentry-options.test.ts` | Sentry in the browser, the Next server and Edge: events and transactions scrubbed (no body, headers, cookies, query), breadcrumb addresses without the query, no console breadcrumbs, Replay masks text and inputs and blocks media — with or without a DSN Session Replay is off by default (0 % / 0 %). |
| `src/next-config.test.ts` | Image optimizer off; security headers (nosniff, `X-Frame-Options: DENY`, CSP `frame-ancestors 'none'`, referrer policy), no `X-Powered-By` |
| `src/lib/vehicle-space.test.ts` | The LTL screen takes the cargo space only from the vehicle record; a missing value shows a notice to complete it in Fleet instead of sliders and the trailer drawing. |
| `src/lib/paginated.test.ts` | `pageItems` reads `{ data, meta }` and fails on any other shape; dashboard and e-mail use it. |
| `src/lib/load-plan.test.ts` | No invented weight or length in the load plan; `0` is a value. |
| `src/lib/ltl-search.test.ts` | An LTL search result or error replaces the whole previous view. |
| `src/lib/margin.test.ts` | The margin text ("≤ X%" for an upper bound without a toll), the order (full, upper bounds, empty), the note under an average; the shared badge on the list, the dashboard, the offer page and analytics. |
| `src/lib/blacklist-accept.test.ts` | The accept button for a blacklisted contractor: disabled with the code's sentence for a non-ADMIN, active with a warning for an ADMIN — LTL, the offer list, the offer page; `hiddenBlocked` in the LTL view. |
| `src/lib/blacklist-toggle.test.ts` | The blacklist switch on the contractor page: shown to an ADMIN only (as the API); it sets the opposite value. |
| `src/lib/contractor-options.test.ts` | The contractor list in the new-offer form: every page (not only the first 100), active only, the blacklist marked; the chosen contractor is sent as `contractorId`. |
| `src/lib/screens.test.ts` | LTL offers without weight/dimensions (the view, "i jeszcze N", the section); the demand search result (10 shown, the total, the price with its currency, unknown criteria, the scan note, errors from the API); the dashboard "Planuj trasę" link from cities and the price with its currency. |
| `src/lib/vehicle-categories.test.ts` | Category list and attachment rule equal the API source; `ltlCarriers`. |
| `src/lib/money.test.ts` | Amounts carry the currency from the API; no hardcoded € / EUR; rate notes shown. |
| `src/lib/toll-provider.test.ts` | Route planner shows a missing toll as missing, not 0. |
| `src/lib/company-cost.test.ts` | Cost per km form: parsing, sending only changed fields, error sentences. |
| `src/lib/contractor-ratings.test.ts` | Contractor risk ratings: `0` is a rating; both forms send both ratings. |
| `src/lib/email-offer.test.ts` | Offer from an e-mail: missing fields named, link to an existing offer on `409`. |
| `src/lib/forms.test.ts` | "Przypisz do mnie" uses the assign route with the logged-in user (both offer screens); the new-offer body has no computed fields and the pickup date is checked; the vehicle edit sends `null` for cleared fields (a new vehicle leaves them out), required fields cleared → a form error. |
| `src/lib/email-inbox.test.ts` | Inbox prices with the currency from the API ("waluta nieznana" without one, no hard-coded EUR in the list, the detail and the test tab); the shared `Pagination`, `page` sent, a filter change back to page 1. |
| `src/lib/change-password.test.ts` | Password change calls the API endpoint and keeps the session with the returned tokens. |
| `src/lib/adr-classes.test.ts` | The vehicle form's ADR class list equals the API source; ticking keeps the order, entries from outside the list stay; the body: chosen classes, `null` when cleared in edit, left out for a new vehicle; the edit page loads the saved classes. |
| `src/lib/matching-adr.test.ts` | Match cards show ADR reasons and warnings from the API. |
| `src/lib/honest-names.test.ts` | The heuristic offer score is not called "AI"; e-mail screen says it reads no mailbox. |
| `src/lib/no-credentials.test.ts` | No seed login or password in the web source. |

`npx tsc --noEmit -p apps/web/tsconfig.json` reports no errors (checked
11.10.2026).

## Known limits

- Tokens are kept in `localStorage`; `AuthGuard` only checks that a token is
  present, not that it is valid (see [docs/known-issues.md](../../docs/known-issues.md)).
- Only `src/lib` is tested; no component tests. `jest` and `ts-jest` are not
  declared in `apps/web/package.json` — they resolve from the workspace root.
- The interface is Polish only; the English dictionary covers API messages.
- The route planner geocodes in the browser through the public Nominatim
  service and the map loads OpenStreetMap tiles and the Leaflet CSS from
  `unpkg.com` — the browser needs internet access to these services.
- "Most profitable offers" on the dashboard picks from the 100 newest offers
  (API page limit) and says so.
- The "Ponów" (retry) button for a failed Trans.eu publication on the offer
  list does nothing yet.
- Notifications created by the API (`demands`, `vehicles`) are not shown.
