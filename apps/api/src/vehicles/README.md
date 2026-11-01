# vehicles — the company's fleet

Keeps the company's vehicle records (tractors, rigid trucks, semi-trailers,
trailers, vans), checks which record may be attached to which, and lists
documents that are about to expire.

## Files

| File | What it does |
|---|---|
| `vehicles.service.ts` | List (filters, pagination, cache), details, create, update, delete, expiring documents and their notifications, the attaching rule on every write. |
| `vehicles.controller.ts` | HTTP routes, all behind login (`JwtAuthGuard`), always scoped to the caller's company. |
| `dto/` | Request bodies and the list query, validated by the global `ValidationPipe`. `UpdateVehicleDto` = every `CreateVehicleDto` field optional, plus status, position and free space. |

Categories and the attaching rule live in `common/vehicle-category.ts`
(see [docs/decisions.md](../../../../docs/decisions.md) §7).

## Endpoints

| Route | Body / query | Returns |
|---|---|---|
| `GET /api/vehicles/expiring` | — | Vehicles with at least one document expiring within 30 days or already expired, each with `expiryWarnings`. Also creates notifications (see below). |
| `GET /api/vehicles` | `VehicleQueryDto`: `page`, `limit` (1–100, default 20), `sortBy` (`createdAt`, `plateNumber`, `brand`, `status`; anything else → `createdAt`), `sortOrder`, optional `status`, `dispatcherId`, `vehicleCategory`, `parentFor` | Paginated list |
| `GET /api/vehicles/:id` | — | The vehicle with its attached units (`trailers`) and its `parentVehicle` |
| `POST /api/vehicles` | `CreateVehicleDto` (`plateNumber`, `vehicleType` required) | The created vehicle |
| `PATCH /api/vehicles/:id` | `UpdateVehicleDto` | The updated vehicle |
| `DELETE /api/vehicles/:id` | — | The deleted vehicle |

Errors: `404` when the vehicle is not in the caller's company; `400` for
validation errors (Polish text) and for the message codes below.

## How it works

- **Company scope.** Every query filters by the caller's `companyId`. A
  dispatcher given on create must be a user of the same company
  (`VEHICLE_DISPATCHER_NOT_FOUND`).
- **Attaching.** On every write of `parentVehicleId` the parent is looked up
  only in the caller's company (not found, or the record itself →
  `VEHICLE_ATTACH_PARENT_NOT_FOUND`), then the pair is checked by
  `attachmentProblem`: semi-trailer → tractor only, trailer → rigid or van
  only. On update the pair is rechecked when either the parent or the
  category changes; changing a parent's category is refused if an attached
  record would no longer fit (`VEHICLE_CATEGORY_BREAKS_ATTACHMENT`). An empty
  `parentVehicleId` detaches.
- **Defaults on create.** Category `TRUCK`, `hasAdr`/`hasGps` false, no ADR
  classes, no parent (`NULL`); date strings become `Date`, a missing date is
  `NULL`. Dates must be ISO 8601 (checked strictly — `2026-02-31` or `jutro`
  is 400 naming the field); an empty string clears the date, as the form sends
  it.
- **Update** writes only the fields present in the body; an explicit `null`
  clears a field, `0` is kept as `0`. `adrClasses: null` stores an empty list
  (the column is a list and refuses null).
- **ADR classes** (`adrClasses`) are what matching compares with an offer's
  class (`common/adr.ts`); the web form offers the 13 classes of `ADR_CLASSES`
  when the ADR certificate is ticked ([decisions §7](../../../../docs/decisions.md)).
- **List filter `parentFor`** (`SEMI_TRAILER` or `TRAILER`) returns only the
  vehicles that category may be attached to; the web form uses it.
- **Cache.** List results are cached in process for 60 seconds per company and
  query; create, update and delete clear the company's entries.
- **Expiring documents.** Checked fields: `technicalInspectionTo`,
  `insuranceTo`, `tachographLegalizationTo`, `plannedMaintenanceDate`,
  `fuelCardExpiry`. Days left are rounded up; ≤ 7 days (or already expired) =
  `critical`, ≤ 30 = `warning`, more than 30 is not listed.
- **Notifications** are created for the calling user, one per vehicle and
  document type: a `critical` warning at most once per calendar day, a
  `warning` at most once per week (from Sunday). The duplicate check matches
  type and a message containing the plate number. Titles and messages are
  Polish text.
- **Delete** is a hard delete; the database detaches attached units
  (`ON DELETE SET NULL`).

## Message codes

Returned as `{ code, params }` in a 400; the web app turns them into text.

- `VEHICLE_DISPATCHER_NOT_FOUND`
- `VEHICLE_ATTACH_PARENT_NOT_FOUND`
- `VEHICLE_ATTACH_NOT_TOWED`, `VEHICLE_ATTACH_WRONG_PARENT` (from
  `attachmentProblem` in `common/vehicle-category.ts`)
- `VEHICLE_CATEGORY_BREAKS_ATTACHMENT`

## Tests

```bash
cd apps/api
npx jest test/unit/vehicle test/unit/cross-tenant-references
```

| Test | Covers |
|---|---|
| `test/unit/vehicles.service.spec.ts` | Expiry days and severity, notifications and their deduplication, create defaults, update field mapping, list filters, sorting, pagination, cache |
| `test/unit/vehicles-expiring.spec.ts` | `GET /vehicles/expiring` through the controller: the notification gets the caller's `userId` and `companyId` |
| `test/unit/vehicle-attachment.spec.ts` | The attaching rule on create and update, both sides of a pair |
| `test/unit/vehicle-parent-company.spec.ts` | The parent vehicle only from the caller's company |
| `test/unit/vehicle-category-check.spec.ts` | The database `CHECK` lists the same categories as `VEHICLE_CATEGORIES` |
| `test/unit/vehicle-adr-classes.spec.ts` | `adrClasses` saved, `null` → `[]`, untouched when not sent; every form class read by the matching rule as itself; the saved classes decide matching. On Postgres: `test/integration/vehicle-adr-classes.int-spec.ts` (the column refuses null; the service stores `[]`) |
| `test/unit/vehicle-update-fields.spec.ts` | `PATCH` saves dimensions, ADR classes and the dispatcher (same company only); every update-DTO field is saved or listed as an exception |
| `test/unit/cross-tenant-references.spec.ts` | `dispatcherId` from another company is refused (with other modules) |

## Known limits

See also [docs/known-issues.md](../../../../docs/known-issues.md) ("API correctness", "Security").

- Nobody updates the vehicle position: the `current_lat` / `current_lng`
  columns exist, but no API field writes them and nothing reads them; where
  the position should come from is a product decision.
- `GET /vehicles/expiring` creates notifications (a side effect of a GET),
  reads all the company's vehicles without pagination, and has no caller in
  the web app (the fleet page works out expiring dates itself).
- Hard delete without checking attached units; no web caller for `DELETE`.
- No role check: any user of the company can create, change or delete vehicles.
- When both `vehicleCategory` and `parentFor` are given, `parentFor` wins.
- Validation messages and the 404 message are Polish text, not codes;
  notification texts are Polish.
- The list cache is in process (one API process only).
