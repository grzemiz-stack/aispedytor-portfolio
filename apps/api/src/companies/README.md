# companies — the caller's own company

Reads and updates the data of the logged-in user's company (name, tax and
address data, contact, cost per km and currency) and its logo.

## Files

| File | What it does |
|---|---|
| `companies.service.ts` | Read, update (allow-listed fields only, currency-change check), logo upload and removal. |
| `companies.controller.ts` | HTTP routes, all behind login (`JwtAuthGuard`), always on the caller's own company (`req.user.companyId`); writes need the `ADMIN` role (`RolesGuard` + `@Roles('ADMIN')`). |
| `dto/update-company.dto.ts` | `UpdateCompanyDto` (the request body of `PATCH /api/companies/me`) and `UPDATABLE_COMPANY_FIELDS`, the list of keys the service writes. |
| `companies.module.ts` | Nest module; exports `CompaniesService`. |

## Endpoints

| Route | Role | Body | Returns |
|---|---|---|---|
| `GET /api/companies/me` | any logged-in user | — | The company record (`404` if it does not exist) |
| `PATCH /api/companies/me` | `ADMIN` | `UpdateCompanyDto`: any of `name`, `taxId`, `regon`, `street`, `city`, `postalCode`, `country`, `billingEmail`, `phone`, `website`, `costPerKm`, `costCurrency` | The updated company |
| `PATCH /api/companies/me/logo` | `ADMIN` | `{ logoBase64 }` — a `data:image/...` URI | The updated company |
| `DELETE /api/companies/me/logo` | `ADMIN` | — | The updated company (`logoBase64: null`) |

Errors: `401` without a valid token; `403` for a non-ADMIN on the write
routes; `400` for validation errors (Polish text), for a field that is not
on the list, and for `COMPANY_CURRENCY_CHANGE_WITHOUT_COST`.

## How it works

- **Allow-list, two layers.** The global `ValidationPipe` (`whitelist` +
  `forbidNonWhitelisted`, `main.ts`) rejects any field not declared in
  `UpdateCompanyDto` with a 400. The service then copies only the keys in
  `UPDATABLE_COMPANY_FIELDS`, so a caller that bypasses the controller still
  cannot write `subscriptionPlan`, `maxDispatchers`, `settings`, `logoBase64`
  or `id`.
- **Update** writes only fields present in the body and not `undefined`; an
  explicit `null` clears an optional field.
- **Validation** (`UpdateCompanyDto`): `name` may be changed but not emptied
  or set to `null`; `country` is a two-letter upper-case code; `billingEmail`
  must be an e-mail; `costPerKm` is a positive number with at most 2
  decimals, at most 99,999,999.99 (the `DECIMAL(10,2)` column), or `null`
  (= not given); `costCurrency` is one of `COMPANY_CURRENCIES` (PLN, EUR,
  GBP) and cannot be `null`. Lengths are capped (`MaxLength`).
- **Cost per km and currency.** `costPerKm` is an amount in `costCurrency`
  and feeds the LTL ranking (profit instead of revenue; see
  [docs/decisions.md](../../../../docs/decisions.md) §3). Changing only
  `costCurrency` while a cost is stored and the currency differs is refused
  with `COMPANY_CURRENCY_CHANGE_WITHOUT_COST { costPerKm, fromCurrency,
  toCurrency }` and nothing is saved; sending `costPerKm` (a number or
  `null`) together with the new currency is accepted without a lookup.
  A change of `costPerKm` or `costCurrency` queues a recompute of the
  company's open offers (NEW, ASSIGNED — their cost, profit and margin) in the
  background; the PATCH does not wait for it, and a failure is logged as a
  warning (company id, the number of open offers) with the rate kept —
  `npm run offers:recompute-economics` fixes it (docs/DEPLOYMENT.md).
- **Logo.** Stored as the data URI itself in `Company.logoBase64`. The
  service rejects a string longer than 700,000 characters (about 500 KB of
  image) or one that does not start with `data:image/` (Polish messages).
  The web app shows it in the sidebar and on the settings page.

## Message codes

Returned as `{ code, params }` in a 400; the web app turns them into text.

- `COMPANY_CURRENCY_CHANGE_WITHOUT_COST`

## Tests

```bash
cd apps/api
npx jest test/unit/company-
```

| Test | Covers |
|---|---|
| `test/unit/company-roles.spec.ts` | Roles through a real Nest app over HTTP: logo upload/removal and `PATCH /me` are ADMIN only, `GET /me` is for everyone, no token → 401 |
| `test/unit/logo-body-limit.spec.ts` | Over HTTP: the logo route accepts 700,000 characters (1 MB body limit), other routes keep 100 kB and still parse JSON |
| `test/unit/recompute-economics.spec.ts` | The recompute of all offers (counts, idempotent, `--dry-run` writes nothing, the latest route, a route without a toll stays "no toll", each company's rate); a rate change queues the open offers only, the PATCH returns before it runs and survives its failure (a warn with the company and the count) |
| `test/unit/company-update-whitelist.spec.ts` | The DTO through the same `ValidationPipe` as `main.ts`, the service's allow-list, the currency-change rule, the controller's body type |
| `test/unit/company-currency.spec.ts`, `test/unit/company-currency-check.spec.ts` | (related, `common/company-currency.ts`) currency from the country at registration; the database CHECK matches `COMPANY_CURRENCIES` |

## Known limits

See also [docs/known-issues.md](../../../../docs/known-issues.md) ("Security").

- `PATCH /me/logo` accepts `data:image/svg+xml` (inline SVG risk, not
  verified).
- The logo is stored in the company row and returned by `GET /me` with all
  other data.
- Validation and exception messages (`dto/`, `Firma nie znaleziona`, logo
  errors) are Polish text, not codes.
