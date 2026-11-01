# risk-analysis — rule-based risk check of one offer

Reads one offer and the company's fleet and lists what could go wrong if
the company accepts it: penalty clauses, a short loading window, pallet
exchange, ADR or reefer cargo the fleet cannot carry, an insurance minimum,
a long payment term, cross-border EU transport, and Polish risk phrases in
the offer's free text. Fixed rules and thresholds; no model is involved and
nothing is saved.

## Files

| File | What it does |
|---|---|
| `risk-analysis.service.ts` | The rules (a–j), the contractor check, the keyword scan and the overall score. Runs through the in-process task queue (`common/queue`, at most 3 tasks at once). |
| `risk-keywords.data.ts` | 46 Polish risk phrases in 8 categories, each with a level and a Polish message. They are data: they match Polish offer text. |
| `risk-analysis.controller.ts` | The HTTP route, behind login (`JwtAuthGuard`), scoped to the caller's company. |
| `risk-analysis.module.ts` | Nest module (Prisma; the task queue comes from the global `QueueModule`). |

## Endpoints

| Route | Body / query | Returns |
|---|---|---|
| `POST /api/risk-analysis/analyze/:offerId` | none | `offerId`, `risks[]` (`type`, `level` HIGH / MEDIUM / LOW, `message`, optional `details`), `totalRiskScore`, `safeToAccept`, `analyzedAt` (ISO) |

The route answers `200` (it creates nothing; `@HttpCode`, `http-status-codes.spec.ts`).
Errors: `404` when the offer does not exist in the caller's company
(message `Oferta nie znaleziona`). The web app calls it from the offer
detail page (`apps/web/src/app/(dashboard)/offers/[id]/page.tsx`), once on
load and again from a button.

## How it works

The offer is read with `findFirst({ id, companyId })`; the fleet is every
vehicle of the company (`vehicleType`, `trailerType`, `hasAdr`, `adrClasses`; no
status filter). Then each rule adds at most one risk — except the contractor
rule, which adds one per criterion met (blacklist, payment, reliability: up
to three) — in this order:

| Rule | Field | Risk `type` | Level |
|---|---|---|---|
| a) penalty clauses | `penaltyClauses` not blank | `PENALTY_CLAUSES` | HIGH; `details` = the text, cut to 200 characters + `…` |
| b) loading window | `loadingTimeWindow` (minutes) | `SHORT_LOADING_WINDOW` | < 60 HIGH, 60–119 MEDIUM, ≥ 120 none; `0` is a value (HIGH), `NULL` is no risk |
| c) pallet exchange | `palletExchange` true | `PALLET_EXCHANGE` | MEDIUM; type and count added to the message when known |
| d) ADR | `isAdr` true, or an `adrClass` given | `ADR_CARGO` (HIGH, with `adrClass` when given); plus `NO_ADR_VEHICLE` (HIGH) when no vehicle passes `adrCompatibility` (`common/adr.ts`: `hasAdr` required, classes must allow the offer class) | HIGH |
| e) reefer | `requiresReefer(offer)` (`common/reefer.ts`: `isFrigo` or any temperature) | `NO_FRIGO_VEHICLE` when no fleet record `isReefer` | HIGH; temperatures in the message only when both are given |
| f) insurance | `requiredInsuranceMin` > 0 | `INSURANCE_REQUIREMENT` | MEDIUM (amount shown in EUR); `0` and `NULL` are no requirement |
| g) payment term | `paymentTermDays` | `LONG_PAYMENT_TERM` | > 90 HIGH, 61–90 MEDIUM, ≤ 60 none |
| h) international | pickup ≠ delivery country, both in the EU (codes upper-cased) | `INTERNATIONAL_TRANSPORT` | LOW (reminder about cabotage rules and transport documents) |
| i) contractor | the offer's `contractorId`, looked up in the caller's company, through `counterpartyRisk` (`common/counterparty-risk.ts` — the same rule as the LTL card and negotiation) | `CONTRACTOR_BLACKLISTED` (blacklist), `CONTRACTOR_PAYMENT_RISK` (payment rating ≤ 2), `CONTRACTOR_RELIABILITY_RISK` (reliability < 40) | HIGH, HIGH, MEDIUM; no ratings (NULL) is no risk |
| j) keywords | `notes`, `specialRequirements`, `penaltyClauses` | `KEYWORD_<category>` | see below |

**Keyword scan.** The three text fields are joined and lower-cased; each
phrase of `RISK_KEYWORDS` is looked for as a substring, in list order. All
phrases found in one category make one risk with `details` = `Wykryte frazy: …`.
The category takes the level and message of its first phrase found; a later
phrase of a higher level raises it: the category ends at the highest level
found (LOW < MEDIUM < HIGH), with the message of the first phrase at that
level. Categories: `PENALTY_RISK`, `DELAY_PENALTY`, `TIME_WINDOW`,
`PAYMENT_RISK`, `PALLET_EXCHANGE`, `LIABILITY`, `DOCUMENTS`,
`SPECIAL_REQUIREMENTS`.

**Overall score.** A contractor on the company blacklist → `CRITICAL`
whatever the rest; otherwise 3 or more HIGH → `CRITICAL`; 1–2 HIGH →
`HIGH`; any MEDIUM → `MEDIUM`; otherwise `LOW`. `safeToAccept` is true when
there is no HIGH risk.

The blacklist is a block elsewhere too: accepting such an offer (every move
into a revenue status) is for an ADMIN only (`OFFER_CONTRACTOR_BLACKLISTED`),
the LTL card keeps the offer last and blocked (`blockedBy`), and negotiation
names it in the first argument — see decisions §3b.

## Message codes

None. This module does not use `msg('CODE')`: every `message` and `details`
is a Polish sentence built on the server (see decisions §1 and known limits).

## Tests

```bash
cd apps/api
npx jest test/unit/risk-analysis
```

| Test | Covers |
|---|---|
| `test/unit/risk-analysis.service.spec.ts` | Every rule a–h and j with its thresholds and NULL handling, the keyword scan (including raising a category to HIGH), the overall score, that only the offer and the fleet are read for an offer without a contractor |
| `test/unit/risk-analysis-contractor.spec.ts` | The contractor check: blacklist → CRITICAL, payment rating ≤ 2 → HIGH, reliability < 40 → MEDIUM, no ratings no risk, the lookup scoped to the company |
| `test/unit/risk-analysis-adr.spec.ts` | The fleet ADR check with the shared rule: `hasAdr`, classes, unknown classes, one fitting vehicle, a class with `isAdr=false` |

## Known limits

See also [docs/known-issues.md](../../../../docs/known-issues.md)
(`risk-analysis`).

- Messages and `details` are Polish text, not `{ code, params }`; the
  English interface cannot translate them.
- Keyword rules match substrings of Polish phrases (e.g. `slot`, `rampa`
  also match inside longer words); offers written in other languages are
  not scanned in any useful way.
- Does not check vehicle documents: an offer has no assigned vehicle.
  Expiring inspection, insurance and tachograph dates are listed per vehicle
  by `GET /vehicles/expiring`.
- The driver's ADR licence is not checked (decisions §6).
- The fleet checks (ADR, reefer) look at every vehicle of the company,
  whatever its status or availability on the pickup date.
- The international rule fires only for two different EU countries; a
  transport to or from a non-EU country (e.g. UA, GB, CH) gets no risk.
- The insurance amount is always shown as EUR; the offer has no currency
  for it.
