# contractors — the company's business partners

Keeps the company's contractors (the companies it does business with): contact
details, ratings and notes. Other modules read the ratings: the counterparty
risk on the LTL card and in negotiation (`common/counterparty-risk.ts`), and
offers can point to a contractor (`Offer.contractorId`).

## Files

| File | What it does |
|---|---|
| `contractors.service.ts` | List (sorting, pagination, cache), details, create, update, delete. |
| `contractors.controller.ts` | HTTP routes, all behind login (`JwtAuthGuard`), always scoped to the caller's company. |
| `dto/` | Request bodies, validated by the global `ValidationPipe`. `UpdateContractorDto` = every `CreateContractorDto` field optional. |

## Endpoints

| Route | Body / query | Returns |
|---|---|---|
| `GET /api/contractors` | `PaginationDto`: `page`, `limit` (1–100, default 20), `sortBy` (`name`, `rating`, `reliabilityScore`, `createdAt`; anything else → `name`), `sortOrder` (`asc` / `desc`, default `desc`) | Paginated list (`data`, `meta`) |
| `GET /api/contractors/:id` | — | The contractor |
| `POST /api/contractors` | `CreateContractorDto`: `name` (2–200 characters) required; optional `taxId` (5–20), `country`, `city`, `address`, `contactPerson`, `contactEmail`, `contactPhone`, `rating` (1–5), `paymentRating` (1–5), `reliabilityScore` (0–100), `avgPaymentDays` (0–365), `notes`, `isActive`, `isBlacklisted` (ADMIN only) | The created contractor |
| `PATCH /api/contractors/:id` | `UpdateContractorDto` | The updated contractor |
| `DELETE /api/contractors/:id` | — | The deleted contractor (only one without offers) |

Errors: `404` when the contractor is not in the caller's company; `400` for
validation errors (Polish text); fields not in the DTO are refused with `400`;
`403 CONTRACTOR_BLACKLIST_ADMIN_ONLY` when a non-ADMIN changes
`isBlacklisted`; `409 CONTRACTOR_HAS_OFFERS { offers }` when deleting a
contractor that has offers.

## How it works

- **Company scope.** Every query filters by the caller's `companyId`; update
  and delete first look the contractor up in that company (404 otherwise).
- **Ratings are whole numbers** (`Int` columns): `rating` and `paymentRating`
  1–5, `reliabilityScore` 0–100, `avgPaymentDays` 0–365. Strings are converted
  to numbers; fractions are refused.
- **Create** saves every DTO field; `isActive` defaults to `true`,
  `isBlacklisted` to `false`.
- **The blacklist** (`isBlacklisted`) is set and cleared by an ADMIN only (there
  is no other manager role); another role gets `403
  CONTRACTOR_BLACKLIST_ADMIN_ONLY`. Sending the current value passes (a form may
  send everything). An ADMIN's change is logged as a warning (who, when, which
  contractor) — in the process log only. The flag blocks whether the contractor
  is active or not: deactivating does not lift it
  ([decisions §3b](../../../../docs/decisions.md)).
- **Update** writes only the fields present in the body; an explicit `null`
  clears a nullable field.
- **Cache.** List results are cached in process for 120 seconds per company and
  query; create, update and delete clear the company's entries.
- **Delete** is a hard delete, only for a contractor without offers. One with
  any offers → `409 CONTRACTOR_HAS_OFFERS { offers }` — deleting would clear
  the offers' contractor (`ON DELETE SET NULL`) and the blacklist block with
  it; deactivate it instead.
- **Risk.** `paymentRating` ≤ 2 → `PAYMENT`, `reliabilityScore` below 40 →
  `RELIABILITY`, `isBlacklisted` → `BLACKLIST` (`common/counterparty-risk.ts`);
  a missing rating is not a risk. This module only stores the values.

## Message codes

Returned as `{ code, params }`; the web app turns them into text.

- `CONTRACTOR_BLACKLIST_ADMIN_ONLY` — 403: only an ADMIN changes the blacklist.
- `CONTRACTOR_HAS_OFFERS` — 409 (`offers`: how many): a contractor with offers
  cannot be deleted.

The `404` message and the validation messages are Polish text.

## Tests

```bash
cd apps/api
npx jest test/unit/contractor-ratings test/unit/blacklist-h3
```

| Test | Covers |
|---|---|
| `test/unit/contractor-ratings.spec.ts` | Create and update save `paymentRating` and `reliabilityScore` (and the resulting risk); update leaves them when not sent and clears them with `null`; rating validation (range, whole numbers) |
| `test/unit/cross-tenant-references.spec.ts` | An offer may only point to a contractor of the same company (offers module) |
| `test/unit/blacklist-h3.spec.ts` | `isBlacklisted` accepted by the DTOs, changed by an ADMIN only (403 for others, the same value passes, logged), the role from the token; delete with offers → 409, without → deleted; the blacklist blocks an inactive contractor (with the offers module) |

## Known limits

See also [docs/known-issues.md](../../../../docs/known-issues.md) ("API correctness", "Security").

- No role check besides the blacklist: any user of the company can create,
  change, deactivate or delete (without offers) contractors.
- `contactEmail` has no e-mail validation.
- The web app has no delete button.
- An explicit `null` for `name` passes validation and reaches the database,
  where `name` is required.
- The list cache is in process (one API process only).
- Validation messages and the 404 message are Polish text, not codes.
