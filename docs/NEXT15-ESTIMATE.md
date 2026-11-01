# Next 15.5 + React 19 — estimate

> **Done.** The upgrade landed on 8 October 2026 (Next 15.5, React 19 — see
> "Done" below and docs/known-issues.md). This page stays as the record of
> the estimate and of the lockfile trap.

State: 8 October 2026. **An estimate only — no code changes.** Everything
below was measured on a trial upgrade of the original repository in a
throwaway working copy, not taken from the Next.js release notes. The web
app here has the same dependencies; its sources differ in comment language
and in the toll provider (no HERE). The upgrade itself is re-checked on this
repository when it is ported.

## In three sentences

1. The upgrade is small: **no application source file needs a change** —
   what changes is `apps/web/package.json`, the lockfile,
   `apps/web/tsconfig.json` (Next adds `target` itself) and the
   dependency documentation and tests.
2. The one real trap is the **lockfile**: a plain `npm install` leaves
   React 18 and `@types/react` 18 at the workspace root — `next`, `recharts`
   and `zustand` then see React 18 and `tsc` reports 16 errors in the charts.
   The fix is known (below) and should be guarded by a test.
3. **Estimate: 5–7 hours** including the port (2 h of it is buffer).

## Done (08.10.2026) — a correction to the lockfile advice

During the upgrade **`npm dedupe` turned out to be the wrong advice**: it
moved React 19 to the root but left `@types/react` 19 in
`apps/web/node_modules` (the type errors stayed), and it also took the root
`typescript` back from 5.9.3 to 5.7.2 and `rxjs` from 7.8.2 to 7.8.1
(aligning them with `@nestjs/cli`). In the trial the errors went away only
after regenerating the whole lockfile — not from `dedupe` itself.

What worked: remove the old lockfile entries `node_modules/react`,
`react-dom`, `@types/react`, `@types/react-dom` and `scheduler`, then a
plain `npm install` with the new versions in `apps/web/package.json`.
Result: 28 changed packages, all in the Next, React and
`eslint-config-next` tree; nothing outside it went back.
`apps/api/test/unit/single-react.spec.ts` keeps one copy of each of the four
packages.

## What was checked

Targets: `next` 15.5.27 (latest 15.5; the critical advisories are fixed
from 15.5.24), `react`/`react-dom` 19.3.0, `@types/react(-dom)` 19.3.0,
`eslint-config-next` 15.5.27.

| Check | Next 14 (today) | Next 15.5 + React 19 |
|---|---|---|
| Next 15 codemods (`next-async-request-api`, `app-dir-runtime-config-experimental-edge`, `built-in-next-font`, `next-og-import`, `next-image-to-legacy-image`; `--dry`) | — | 0 of 65 files to change |
| `next-request-geo-ip` | — | does not apply: no middleware, nothing reads `geo`/`ip` |
| `tsc --noEmit` in `apps/web` | 3 errors (old, `vehicle-categories.test.ts`, ES5 target) | **0** (correct lockfile; the ES2017 target clears those 3 too) |
| web tests (`jest`) | all pass | all pass, same count |
| `next lint` | clean | clean (+ notice: `next lint` is deprecated and goes away in Next 16) |
| `next build` | OK | OK; identical route table (19 entries, same static ○ / dynamic ƒ) |
| `next build` with `NEXT_PUBLIC_SENTRY_DSN` | OK | OK (Sentry warnings — risk 4) |
| live: API + seeded database, `next start`, Chrome, login and 16 screens | 0 page errors, 0 console warnings, 0 HTTP ≥ 400, charts drawn | **identical** |
| lockfile platform-binary test and `security-deps.spec.ts` on the new lock | pass | pass (all 8 `@next/swc-*` 15.5.27 binaries present) |
| `npm audit` (original repository) | 95 (1 critical, 56 high) | 74 (0 critical, 51 high) — of `next` only its internal `postcss` 8.4.31 remains (below) |

### The points looked at

- **Async `params` / `cookies()` / `headers()`** — do not apply. Every
  `[id]` page is a client component reading its id with `useParams()`;
  nothing imports `next/headers`; the only server components are the two
  layouts, which take no `params`.
- **`fetch` cache default (`no-store` in Next 15), GET route handlers,
  router cache `staleTimes` 0** — do not apply. The only `fetch`
  (geocoding in `route-planner/page.tsx`) runs in the browser; page data
  comes through `axios` in `useEffect`; there are no `route.ts` files or
  Server Actions.
- **Dependencies with a React 18 peer** — there is **no** `react-leaflet`
  (the map is plain `leaflet` in `useEffect`, loaded with
  `dynamic(..., { ssr: false })` from a client component — allowed in
  Next 15). `recharts` 2.15.4 accepts React 19 since 2.15.0; `zustand`
  4.5.7 `>=16.8`; `@sentry/nextjs` 10 accepts `next ^15`. No peer conflicts.
- **React 19 types** (`useRef` needs an argument, `JSX` under `React`,
  `ref` callbacks) — `tsc` is clean; the code already meets them.
- **APIs removed in React 19** (`propTypes`, `defaultProps` on functions,
  string refs, `findDOMNode`, `ReactDOM.render`, legacy context) — not used.
- **Web tests** — pure logic in a `node` environment, no DOM, no React;
  unchanged.

## Can it be done without React 19?

**No.** Next 15 formally accepts `react` 18 (peer `^18.2.0 || ^19`), but
that is for the Pages Router. This app uses only the App Router (there is no
`src/pages`), and the App Router **always** runs the React bundled inside
Next, not the one in `package.json`:

- today (Next 14.2.35) the browser bundles contain
  `18.3.0-canary-178c267a4e-20241218`, not the installed `18.3.1`;
- on Next 15.5.27 they contain `19.2.0-canary-0bdb9206-20250818` — **also
  when `package.json` keeps React 18.**

Keeping React 18 would give React 19 at run time and React 18 types in the
code (in the trial with React 18 in `package.json` the build failed on
types). The only way to React 18 is rewriting the 17 pages (`page.tsx`) for
the Pages Router — pointless when React 19 needs no source changes.

## Changes per file (for the upgrade)

| File | Change |
|---|---|
| `apps/web/package.json` | `next` `^15.5.27`; `react`, `react-dom` `^19.3.0`; `@types/react`, `@types/react-dom` `^19.3.0`; `eslint-config-next` `15.5.27` |
| `package-lock.json` | update the web part; React 18 and `@types/react` 18 must not stay at the root — how: the "Done" section (not `npm dedupe`) |
| `apps/web/tsconfig.json` | Next adds `"target": "ES2017"` (and reformats the file) — accept it |
| `apps/api/test/unit/security-deps.spec.ts` | `next: '15.5.24'` in `MINIMUM` |
| new test | exactly one `react`, `react-dom` and `@types/react` version in the lockfile |
| `apps/web/src/next-config.test.ts` | comment: the sentence about Next 14 → state after 15.5 (test unchanged) |
| `docs/known-issues.md` ("Dependency advisories") | `next` rows fixed; `images.unoptimized` stays (no `next/image`, smaller surface) |
| `docs/ARCHITECTURE.md`, `README.md` | versions: Next.js 15.5, React 19 |
| `package.json` (root) | `engines.node` `>=18.18.0` (Next 15 minimum; CI uses Node 24) |

## Risks

1. **Lockfile (high, verified, easy to control).** Without the lockfile fix
   the install looks fine, yet two Reacts run inside and `tsc` reports 16
   `'Bar' cannot be used as a JSX component` errors in
   `analytics/page.tsx` plus `<style jsx>` in `negotiation-panel.tsx`.
   Guard: the "Done" section, `npm ls react @types/react` shows one version, a test
   for one React in the lockfile.
2. **The route planner map was not checked live.** It is drawn only after a
   route is calculated, which calls Nominatim and OSRM over the network. The
   map code touches nothing React 19 changes (plain `leaflet` in
   `useEffect`), but one route must be checked by hand before merging.
3. **`next lint` is deprecated.** It works in 15.5 and goes away in Next 16
   (`npx @next/codemod next-lint-to-eslint-cli`). Not part of the upgrade.
   **Done (9 October 2026):** `apps/web` lints with
   `eslint --max-warnings 0 .` on the same rules.
4. **Sentry: a deprecated file layout.** Sentry 10 wants `instrumentation.ts`
   and `instrumentation-client.ts`; the build warns about
   `sentry.server.config.ts`, `sentry.edge.config.ts` and the missing
   instrumentation file, and importing `withSentryConfig` from
   `@sentry/nextjs` goes away in v11.
   **Correction (08.10.2026):** this point used to say that Sentry did not
   start on the server side. That was wrong. Checked live (a fake DSN, a
   local capturing server) on the old layout: a server route error sent an
   event, because the Sentry webpack plugin injects `sentry.server.config.ts`
   itself. The warnings were about a deprecated layout, not about missing
   reports. The move to the new layout is done (HANDOFF, "Done").
5. **Advisories left after the upgrade.** `next` brings its own `postcss`
   8.4.31 (XSS in stringify, file read through `sourceMappingURL`) — used
   only at build time on our own CSS, so it does not apply to the
   deployment; `eslint-config-next` 15 → `fast-glob` — a development tool
   only.
6. **Next 15 behaviour changes without test coverage** (caching, hydration
   order, React 19 dev warnings) — the 16-screen check showed no
   difference, but there are no screen tests (known issues). Repeat the live
   check after the upgrade, also under `next dev`.

## Hours

| Step | h |
|---|---|
| raise dependencies, lockfile fix, one-React check, lockfile test | 1 |
| `security-deps` (`next` ≥ 15.5.24), known issues, ARCHITECTURE, README, `engines` | 1 |
| gate, live check of 16 screens, the route planner map and Sentry with a DSN by hand | 1 |
| port to this repository (its lockfile, known issues, HANDOFF, gate) | 1 |
| buffer for the lockfile and surprises | 1–3 |
| **total** | **5–7** |

Out of scope: `instrumentation.ts` for Sentry (risk 4), `next lint` → ESLint
CLI (risk 3), Next 16.
