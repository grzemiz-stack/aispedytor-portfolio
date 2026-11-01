# matching — vehicle ↔ offer scoring

Scores how well a vehicle of the company fits a full-load offer (0–100), in
both directions, and suggests the best vehicle for the newest offers on the
dashboard. A vehicle known not to take the load — ADR (the same rule as
LTL), not a reefer for reefer cargo, payload below the cargo weight, a
document not valid on the day of loading — gets score 0 with the reason.

## Files

| File | What it does |
|---|---|
| `matching.service.ts` | Loading vehicles and offers, the five partial scores, ADR, recommendation text, suggestions. |
| `matching.controller.ts` | HTTP routes, all behind login (`JwtAuthGuard`), always scoped to the caller's company. |
| `matching.module.ts` | Nest module (needs only `PrismaModule`). |

## Endpoints

| Route | Returns |
|---|---|
| `GET /api/matching/vehicle-for-offer/:offerId` | Every vehicle record of the company, scored for this offer, highest score first. `404` when the offer is not in the caller's company. Used by the offer page. |
| `GET /api/matching/offers-for-vehicle/:vehicleId` | The 50 newest live offers with status `NEW` or `ASSIGNED` (dead ones left out, see below), scored for this vehicle, highest first. `404` when the vehicle is not in the caller's company. Used by the vehicle page. |
| `GET /api/matching/suggestions` | Up to 10 `{ offer, vehicle, matchScore, recommendation }` pairs, highest first. Used by the dashboard. |

**Dead offers** — the LTL rule (`deadReason` in
`ltl-matching/offer-compatibility.ts`): `EXPIRED` (`expiresAt` passed),
`TOO_OLD` (older than 7 days), `PICKUP_PASSED` (the loading day before today
in the pickup country's zone). The lists (offers for a vehicle, suggestions)
leave them out before the limit: the query filters with a margin (statuses,
`expiresAt`, loading at most 2 days back, `NEW` not older than 7 days, at
most 200 candidates), then `deadReason` decides exactly. `ASSIGNED` offers
have no age threshold (a dispatcher is working on them) — only a passed
loading day and `expiresAt`. One offer opened directly (the offer page) is
scored as usual, for reference; for `NEW`, `ASSIGNED` and status `EXPIRED`
every match gets `MATCH_OFFER_NOT_LIVE { reason }` in `warnings` (status
`EXPIRED` → `EXPIRED`). `ACCEPTED` and later carry no code — a job in
progress with a past loading day is not dead. The offer page shows the
sentence once, as a bar above the list.

Each scored item carries `matchScore`, `matchDetails` (the five parts below),
`recommendation` (Polish text), `blockedBy` and `warnings` (message codes).

## How the score works

Vehicles are loaded with their attached trailer records (`trailers`), so a
tractor with a reefer semi-trailer counts as a reefer.

| Part | Points | Rule |
|---|---|---|
| `typeMatch` | 30 | Reefer load (`isFrigo`, or only a temperature given — `common/reefer.ts`): reefer 30, other 0. Normal load: non-reefer 30, reefer 20. |
| `available` | 25 | `AVAILABLE` 25, or 10 when `availableFrom` is later than the pickup date; `RETURNING` 12; any other status 0. |
| `capacityOk` | 20 | Offer weight or vehicle `maxWeightKg` unknown → 0 (named in `MATCH_DATA_UNKNOWN`); payload ≥ weight → 20; payload below the weight is a block. |
| `locationMatch` | 15 | `currentCountry` equals the pickup country → 15, differs → 0, unknown → 0 (named in `MATCH_DATA_UNKNOWN`). |
| `docsValid` | 10 | Inspection, insurance and tachograph dates, proportionally: each known and valid on the pickup day (in the pickup country's time zone; the document's own stored date) = 1/3, rounded — 0 / 3 / 7 / 10; an unknown date = 0 and is named in `MATCH_DATA_UNKNOWN`. |

`matchScore` is the sum. **Blocks:** when the vehicle is known not to take
the load, `matchScore` is 0 whatever the other points, the reasons are in
`blockedBy`, and the recommendation says the vehicle is incompatible:
ADR (`common/adr.ts`); `MATCH_VEHICLE_NOT_REEFER`;
`MATCH_VEHICLE_CAPACITY_EXCEEDED` (`weightKg`, `maxWeightKg` — known payload
below known weight); `MATCH_VEHICLE_DOCUMENTS_EXPIRED` (inspection,
insurance or tachograph calibration not valid on the offer's pickup day: the
pickup day in the pickup country's time zone, as LTL counts it
(`common/country-timezone.ts`, `pickupDay`), against the document's stored
date (`dateOnlyDay` — a document valid "until X" is valid all of day X); no
pickup date — today in that zone. A pickup country outside the zone map takes
the company country's zone (then Warsaw) and says so with
`OFFER_PICKUP_TIMEZONE_ASSUMED` in `warnings`; the company is read only then.
Unknown data does not block.
Notes that do not block are in `warnings`: an ADR offer without a class, and
`MATCH_DATA_UNKNOWN { fields }` — the fields that are unknown, in a fixed
order (`weightKg`, `maxWeightKg`, `currentCountry`, `technicalInspectionTo`,
`insuranceTo`, `tachographLegalizationTo`).

Recommendation text by score: ≥ 80 excellent, ≥ 60 good, ≥ 40 average, else
weak.

**Suggestions**: for each of the 20 newest live `NEW`/`ASSIGNED` offers, the
best-scored vehicle, kept only when its score is at least 30 (so never an
ADR-blocked vehicle); at most 10, highest first.

## Message codes

Returned as `{ code, params }` in `blockedBy` / `warnings`, from
`common/adr.ts`; the web app turns them into text
(`apps/web/src/lib/plan-messages.ts`).

- Blocking: `OFFER_ADR_VEHICLE_NOT_CERTIFIED`, `OFFER_ADR_CLASS_NOT_ALLOWED`,
  `OFFER_ADR_CLASS_UNRECOGNIZED`, `OFFER_ADR_CLASSES_UNKNOWN`;
  `MATCH_VEHICLE_NOT_REEFER`, `MATCH_VEHICLE_CAPACITY_EXCEEDED`,
  `MATCH_VEHICLE_DOCUMENTS_EXPIRED`.
- Warning: `OFFER_ADR_CLASS_NOT_GIVEN`; `MATCH_DATA_UNKNOWN` (`fields`);
  `OFFER_PICKUP_TIMEZONE_ASSUMED` (`timeZone`, `pickupCountry`);
  `MATCH_OFFER_NOT_LIVE` (`reason`: `EXPIRED` | `TOO_OLD` | `PICKUP_PASSED`).

## Tests

```bash
cd apps/api
npx jest test/unit/matching-adr test/unit/matching-unusable test/unit/matching-unknown-data test/unit/reefer-detection test/unit/pickup-day test/unit/matching-dead-offers
```

| Test | Covers |
|---|---|
| `test/unit/matching-adr.spec.ts` | ADR in both directions and in suggestions; the Swagger texts say ADR is checked |
| `test/unit/matching-unusable.spec.ts` | A vehicle known not to take the load (not a reefer, payload below the weight, a document not valid on the loading day) scores 0 with the reason |
| `test/unit/pickup-day.spec.ts` | The loading day in the pickup country's zone: 10.10 22:30Z in PL (Warsaw 11.10) with a document valid until 10.10 → blocked, the same instant in GB → not; dates without a time stay the same day in PL, GB, IE, PT; a country outside the map → the company zone with the code |
| `test/unit/matching-unknown-data.spec.ts` | Unknown weight, payload, country or document date: 0 for that component, named in `MATCH_DATA_UNKNOWN`, no block; documents proportionally to the loading day |
| `test/unit/matching-dead-offers.spec.ts` | `deadReason` (each reason, `ignoreAge`); the lists drop dead offers before the limit (60 dead + 60 live → 50 live; 20 suggestion places), `ASSIGNED` without the age rule, the query pre-filter; one offer: `MATCH_OFFER_NOT_LIVE` for `NEW`/`ASSIGNED`/`EXPIRED`, none for `ACCEPTED`/`IN_TRANSIT` |
| `test/unit/reefer-detection.spec.ts` | Type score for reefers (also trailer records and temperature-only offers); vehicle queries include trailers |
| `test/unit/zero-on-read.spec.ts` | A price of 0 in a suggestion stays 0, a missing price stays `null` |

## Known limits

See also [docs/known-issues.md](../../../../docs/known-issues.md).

- `ASSIGNED` offers are scored and suggested too (without the age rule).
- Trailer records (vehicles with a `parentVehicleId`) are scored as vehicles
  of their own.
- Availability compares `availableFrom` with the pickup date as timestamps,
  not as calendar days in the pickup country's time zone (LTL does).
- Location is only "same country as the pickup or not" — no distance.
- The recommendation is Polish text, not a code; the 404 messages are Polish
  text too.
