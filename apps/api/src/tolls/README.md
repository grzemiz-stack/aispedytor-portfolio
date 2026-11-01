# tolls — the toll provider port

The application does not compute toll. This module defines the interface a
toll provider must implement (`TollProvider`) and the one place where a
provider is registered. None is registered in this repository, so by default
every toll is reported as not calculated (`TOLL_PROVIDER_NOT_CONFIGURED`).
See also the main README, "Tolls — plugging in a provider", and
[docs/decisions.md](../../../../docs/decisions.md) §5.

## Files

| File | What it does |
|---|---|
| `toll-provider.ts` | The port: `TollProvider` (`quote(request)`), `TollRequest`, `TollQuote`, `TollItem`, `EmissionClass`, the error `TollProviderError(reason)` and the injection symbol `TOLL_PROVIDER`. |
| `tolls.module.ts` | Global Nest module and the single registration point: `{ provide: TOLL_PROVIDER, useValue: null }`. |
| `test/contract/toll-provider.contract.ts` (in `apps/api`) | `runTollProviderContract(name, { make, failing, request? })` — the tests every implementation must pass. |
| `test/fakes/fixed-rate-toll-provider.ts` (in `apps/api`) | `FixedRateTollProvider`: a test-only fake with arbitrary per-km rates (PL, DE, FR). Never registered in the application. |

## Endpoints

None. The module has no controller.

## How it works

1. **Request.** `TollRequest` carries the route — points (origin, waypoints,
   destination), geometry as `"lat,lng;lat,lng;…"` (may be empty), total km,
   km per country (ISO 3166-1 alpha-2) — and the vehicle: axle class of the
   whole combination, emission class (`EURO_0` … `EURO_VI`), gross weight in
   tonnes or `null`.
2. **Quote.** `TollQuote` is `source` (non-empty provider name, saved with the
   route as `tollSource`) and `items`: at most one per country, each with an
   `amount` ≥ 0, an ISO 4217 `currency` and optionally the toll `system`. A
   country without a charge may be left out.
3. **Failure.** A provider throws only `TollProviderError(reason)`, where
   `reason` is short and machine-readable (`timeout`, `unauthorized`, …).
4. **Registration.** `TollsModule` is global and exports `TOLL_PROVIDER`. To
   plug a provider in, replace `useValue: null` with
   `useClass: MyTollProvider`. Its configuration belongs to the
   implementation: read it from the environment and document it in
   `docs/DEPLOYMENT.md`.
5. **Who uses it.** The route planner (`route-planner.service.ts`) is the
   only caller of `quote()`. Without a provider it returns toll as `null` and
   marks costs incomplete. With one, each item is converted to EUR through
   `common/fx.ts`; an item in a currency without a rate goes to `unresolved`
   and the cost is incomplete. Any error from the provider ends the request
   with `502 TOLL_PROVIDER_UNAVAILABLE { reason }` (`unexpected_error` when it
   is not a `TollProviderError`) and nothing is saved. LTL matching and
   negotiation only check whether a provider is registered; they read toll
   from saved `route_calculations` rows.

## Message codes

None emitted here. The codes about this port are emitted by its users:
`TOLL_PROVIDER_NOT_CONFIGURED` (route planner, LTL, negotiation) and
`TOLL_PROVIDER_UNAVAILABLE` (route planner).

## Tests

```bash
cd apps/api
npx jest test/contract test/unit/tolls-module test/unit/readme test/unit/toll-provider-flow
```

| Test | Covers |
|---|---|
| `test/contract/toll-provider.contract.ts` | The contract (not a spec itself): non-empty source; countries only from the request; finite amounts ≥ 0; three-letter currencies; one item per country; the request is not modified; no items for a route with no countries; a failure is a `TollProviderError` with a reason |
| `test/contract/fixed-rate-toll-provider.contract.spec.ts` | Runs the contract against the fake, so the contract runs on every test run |
| `test/unit/tolls-module.spec.ts` | Default registration is `null`; `TollProviderError` name, reason and message |
| `test/unit/toll-provider-flow.spec.ts` | With the fake registered: the planner saves its toll and source, LTL counts the detour toll, negotiation uses the same row |
| `test/unit/readme.spec.ts` | The main README's tolls section names the contract, the registration point and how to run the contract tests, and names no provider |

To check your own implementation, add a spec in `test/contract/` that calls
`runTollProviderContract('MyTollProvider', { make, failing })` — `make`
returns a working provider, `failing` one whose calls must fail.

## Known limits

See also [docs/known-issues.md](../../../../docs/known-issues.md) ("LTL").

- No provider is included: toll, total cost and margin are incomplete until
  one is registered.
- Only one provider at a time, and no fallback to another source when it
  fails.
- The contract checks the shape of a quote, not whether its amounts are
  correct.
- The fake's rates are arbitrary test numbers, not toll rates.
