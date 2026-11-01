# exchange-publisher — posting a load on freight exchanges

Sends one load to Trans.eu (and to Timocom once you plug in an adapter),
returns what each exchange answered, and keeps a record of the successful
publications.

## Files

| File | What it does |
|---|---|
| `exchange-publisher.service.ts` | Builds the Trans.eu request body and sends it, hands Timocom to the adapter (if any), collects one result per exchange, saves the successful ones in the `PublishedOffer` table, lists them. |
| `exchange-adapter.ts` | The port for an exchange without a built-in implementation: `ExchangeAdapter` (`publish(input) → { offerId }`) and the injection token `TIMOCOM_ADAPTER`. |
| `exchange-publisher.controller.ts` | HTTP routes, behind login (`JwtAuthGuard`), always for the caller's company. Also holds the request body class `PublishOfferDto`. |
| `exchange-publisher.module.ts` | Nest module; imports `TransEuAuthModule` for the Trans.eu access token; the single registration point of the Timocom adapter (`{ provide: TIMOCOM_ADAPTER, useValue: null }`). |

## Endpoints

| Route | Body | Returns |
|---|---|---|
| `POST /api/exchange-publisher/publish` | `PublishOfferDto`: origin and destination (`…Country`, `…City`, optional `…PostalCode`, `…Street`), `loadingDateFrom`, `loadingDateTo`, optional `deliveryDateFrom`/`deliveryDateTo`, `weightKg`, optional `volumeM3`, `palletCount`, `loadingMeters`, `description`, `isAdr`, `adrClass`, `isRefrigerated`, `tempFrom`, `tempTo`, `vehicleType`, `truckBody`, `price`, `currency`, `isNegotiable`, and the flags `publishToTransEu`, `publishToTimocom`, `publishToPublicExchange` | An array with one `{ exchange, success, offerId?, error?, code? }` per exchange asked for (`TRANS_EU`, `TIMOCOM`); `[]` when neither flag is set |
| `GET /api/exchange-publisher/published` | — | The company's `PublishedOffer` rows, newest first, at most 100 |

A failure at an exchange does not fail the request: it comes back as
`success: false` with `error` (the exchange's HTTP status and response text,
or the exception message). The other exchange is still tried.

## How it works

1. **Which exchanges.** Only those whose flag is `true`, one after the other:
   Trans.eu first, then Timocom.
2. **Trans.eu.** Gets the company's access token from
   `TransEuAuthService.getValidAccessToken` (the account must be linked — see
   `trans-eu-auth`), needs `TRANS_EU_API_KEY`, and posts to
   `/ext/freights-api/v2/freights`. Body: capacity in tonnes
   (`weightKg / 1000`), a loading and an unloading spot, pallets as
   euro-pallets, `vehicle_size` `van` or `lorry`, truck body, ADR flag,
   temperature for reefers, price (fixed or negotiable) and description.
   `publishToPublicExchange` defaults to `true`. Without a delivery date the
   unloading window is set to `loadingDateTo`.
3. **Timocom.** No built-in implementation. Without an adapter the result is
   `{ exchange: 'TIMOCOM', success: false, code: 'TIMOCOM_NOT_IMPLEMENTED' }`
   and nothing is sent or saved. With one, the service calls
   `adapter.publish(input)` (the input carries the caller's `companyId`): its
   `offerId` makes a successful result, an error becomes `success: false`
   with the error's message.
4. **Mapping (Trans.eu).** Truck bodies are mapped to Trans.eu names; an
   unknown or missing body becomes curtainsider. `isRefrigerated` always asks
   for a reefer body. Price is sent in `currency`, or EUR when none is given.
5. **Record.** Every successful result with an offer id is saved in
   the `PublishedOffer` table (company, exchange, external offer id, cities,
   countries, weight). Failures are not saved.

Configuration (names only): `TRANS_EU_API_KEY` (plus the `trans-eu-auth`
settings). See `docs/DEPLOYMENT.md`. Nothing is read for Timocom; an
adapter brings its own configuration.

## Plugging in a Timocom adapter

1. Implement `ExchangeAdapter` from `exchange-adapter.ts`. Publish with the
   account of `input.companyId` — never with one account shared by every
   company: any visitor can register a company, so a shared account would be
   open to all of them. Follow Trans.eu: per-company credentials in
   the `ExchangeConnection` table (unique per company and exchange, `exchange =
   'TIMOCOM'`), stored encrypted with `EncryptionService` as
   `TransEuAuthService` does, linked and unlinked by that company's ADMIN.
   The columns of the `ExchangeConnection` table are shaped for OAuth tokens; for a
   login and password, add a migration (new nullable columns or a table).
2. A company without a linked account: throw an error with a readable
   message — the caller gets `success: false, error`, nothing is saved.
3. In `exchange-publisher.module.ts` replace `useValue: null` with
   `useClass: YourTimocomAdapter`. Document its settings in
   `docs/DEPLOYMENT.md`.
4. Saving successful results in the `PublishedOffer` table for the caller's company
   stays in the service; the adapter only publishes.
5. Extend `test/unit/exchange-publisher-timocom.spec.ts`: the adapter must
   use the account of the company in `companyId`, and another company's
   account never.

## Message codes

- `TIMOCOM_NOT_IMPLEMENTED` — in a Timocom result when no adapter is plugged
  in; nothing was sent.

Other errors are text in the `error` field of each result (partly Polish),
not `{ code, params }`.

## Tests

- `test/unit/exchange-publisher-timocom.spec.ts` — without an adapter: the
  code, nothing sent or saved, `TIMOCOM_*` in the environment changes nothing,
  the module registers no adapter, no source file reads `TIMOCOM_*` or calls
  `api.timocom.com`, Trans.eu still tried first. With an adapter: it gets the
  input with the caller's company, its offer id is saved for that company, its
  error comes back as `success: false`.

Trans.eu publishing has no tests.

## Known limits

See also [docs/known-issues.md](../../../../docs/known-issues.md) ("Integrations").

- No UI: the web app neither publishes nor shows published offers.
- The Trans.eu request body was not verified against the live API.
- Timocom has no implementation (above, "Plugging in a Timocom adapter").
- `publishToPublicExchange` only affects Trans.eu.
- `originStreet` / `destStreet` are accepted but sent to neither exchange.
- An unknown truck body is replaced by a default (curtainsider) instead of
  being reported.
- A price of `0` is not sent.
- Saved rows are never updated: `status` stays `ACTIVE` and `expiresAt` is
  not filled; nothing withdraws an offer from an exchange.
- `error` passes the exchange's raw response text to the caller.
- `PublishOfferDto` has no Swagger property annotations, so Swagger shows no
  body schema.
