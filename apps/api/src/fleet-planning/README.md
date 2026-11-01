# fleet-planning — drivers, working time, the week plan

Plans the working week of a fleet (tractor + trailer + driver), from the
departure after a weekly rest to the return for the next one. The source of
truth is [docs/fleet-planning/SPEC.md](../../../../docs/fleet-planning/SPEC.md).

**Stage 1 (this code):** drivers, the manual driver status, and the rules of
Regulation (EC) 561/2006 (with the Mobility Package) and Directive 2002/15.
For each driver it answers: *can depart from…, driving left…, must be home by…*.

The dispatcher decides (SPEC §2). The module never blocks a plan that breaks a
rule. It shows each violation as a message code. Nothing is sent to a driver or
a customer.

## What it does

- Keeps drivers of the company. Single crew: one driver per vehicle, and only a
  power unit, never a trailer.
- Keeps the **manual driver status** (SPEC §6) as an append-only history: who
  entered it and when. The newest entry is the current one.
- **Checks any timeline** against the rules (`rules/check-timeline.ts`). This
  covers a planned timeline and one the dispatcher approved by hand.
- **Plans a timeline** (`rules/plan-timeline.ts`) from the driver's state and an
  ordered list of tasks (driving, other work, availability):
  - it inserts the breaks and rests the rules require;
  - it returns the ETA;
  - it hands the finished timeline to the validator, and the result's
    violations come from there.
- **Driver availability** (`rules/availability.ts`):
  - can depart from;
  - driving left until the break, today, today with a 10-hour day, in the week
    and in two weeks;
  - latest start of the daily and of the weekly rest, and whether the next
    weekly rest may be reduced;
  - compensation owed;
  - must be home by.

## What it does not do (yet)

| Not done | Where it belongs |
|---|---|
| Truck driving bans (weekends, public holidays), cabotage limits, ferry/train time as rest | stage 4 — they need the route and the countries |
| Directive 2002/15 weekly limit (60 h, average 48 h) and night work | not planned yet |
| Double crew (other limits) | later (SPEC §6) |
| Trailer swaps — the unit is a tractor with its trailer | later (SPEC §6) |
| Orders, the week board, service calendar, exchanges | stages 2–7 |
| A screen in the web app | not in stage 1 |
| Reading tachograph data | a buyer adapter behind `DriverActivityProvider` (stage 5) |

## Files

| File | What it does |
|---|---|
| `fleet-planning.module.ts` | The module; **the single place** where the driver activity provider is chosen. |
| `drivers.controller.ts`, `drivers.service.ts` | HTTP routes and their logic. Everything is scoped to the caller's company. |
| `dto/` | Request bodies and the availability query, validated by the global `ValidationPipe`. |
| `activity/driver-activity-provider.ts` | The gateway: interface, token, types, `DriverActivityProviderError`. |
| `activity/manual-driver-activity.provider.ts` | The default provider: the manual status from the database. |
| `rules/limits.ts` | Every number of the rules, with its article. |
| `rules/fixed-week.ts` | Fixed week, Monday 00:00 – Sunday 24:00, **in UTC** (tachograph time). |
| `rules/driver-state.ts` | Driver status → the state the engine starts from. |
| `rules/timeline.ts` | Timeline segments; gaps count as rest, adjacent rests merge. |
| `rules/tracker.ts` | The rules ledger: counters and violations while walking a timeline. |
| `rules/check-timeline.ts` | The validator. |
| `rules/plan-timeline.ts` | The planner. |
| `rules/availability.ts` | Driver availability. |
| `rules/status-from-history.ts` | Driver status from an activity history, replayed by the rules ledger — for adapters that have activities but no status. |
| `rules/applicability.ts` | Does 561/2006 apply to a vehicle on a transport (> 3.5 t; > 2.5 t international from 1 July 2026). **Not called yet** — only its tests use it; nothing in the module checks the vehicle mass, so the rules apply to every driver. |

## Endpoints

All require login (`JwtAuthGuard`) and work only on the caller's company. A
driver or vehicle of another company answers exactly like an unknown one (404).
Both roles (ADMIN, DISPATCHER) may use them.

| Route | Body / query | Returns |
|---|---|---|
| `GET /api/drivers` | `?active=true\|false` | Drivers by last name, with the assigned vehicle |
| `POST /api/drivers` | `CreateDriverDto`: `firstName`, `lastName`, optional `phone`, `email`, `homeCity`, `homeCountry` (ISO 3166-1 alpha-2), `active` | 201, the driver |
| `GET /api/drivers/:id` | | The driver |
| `PATCH /api/drivers/:id` | `UpdateDriverDto` (any field of the above) | The driver |
| `DELETE /api/drivers/:id` | | `{ id, deleted: true }`; the status history goes too, the vehicle stays |
| `PUT /api/drivers/:id/vehicle` | `{ vehicleId }`, `null` unassigns | The driver; 404 `DRIVER_VEHICLE_NOT_FOUND`, 422 `DRIVER_VEHICLE_NOT_A_POWER_UNIT`, 409 `DRIVER_VEHICLE_ALREADY_ASSIGNED` |
| `POST /api/drivers/:id/status` | `CreateDriverStatusDto` (below) | 201, the stored status; 400 `DRIVER_STATUS_INVALID { field }` |
| `GET /api/drivers/:id/status` | | `{ current, history }`, newest first, at most 50 |
| `GET /api/drivers/:id/availability` | `?at=` ISO 8601 (default now), `?strategy=standard\|earliest` | Availability (above), `source` of the status, and `violations`, `warnings`, `notices`; 409 `DRIVER_STATUS_MISSING`; 409 `DRIVER_STATUS_INCOMPLETE` (`field`) when a provider's status lacks a value the engine cannot derive; 502 `DRIVER_ACTIVITY_PROVIDER_FAILED` (`reason`) when the provider fails |

Any of them can return 404 `DRIVER_NOT_FOUND`.

### The manual status (`CreateDriverStatusDto`)

All instants are ISO 8601 and stored in UTC. All durations are whole minutes.

Example bodies — resting, and on duty (state `onDuty` explicitly: omitted
means unknown, and availability then takes the worst case):

```json
{
  "asOf": "2026-10-07T08:00:00Z",
  "weeklyRestEndedAt": "2026-10-05T06:00:00Z",
  "weeklyRestType": "REGULAR",
  "weeklyRestAtHome": true,
  "drivingThisWeekMinutes": 900,
  "drivingLastWeekMinutes": 2400,
  "extendedDrivingDaysUsed": 1,
  "reducedDailyRestsUsed": 1,
  "compensationOwedMinutes": 0,
  "lastHomeRestEndedAt": "2026-10-05T06:00:00Z",
  "onDuty": false
}
```

```json
{
  "asOf": "2026-10-07T10:00:00Z",
  "weeklyRestEndedAt": "2026-10-05T06:00:00Z",
  "weeklyRestType": "REGULAR",
  "drivingThisWeekMinutes": 1020,
  "drivingLastWeekMinutes": 2400,
  "compensationOwedMinutes": 0,
  "lastHomeRestEndedAt": "2026-10-05T06:00:00Z",
  "onDuty": true,
  "dailyRestEndedAt": "2026-10-07T05:00:00Z",
  "drivingSinceDailyRestMinutes": 120,
  "drivingSinceBreakMinutes": 30,
  "workSinceBreakMinutes": 60
}
```

| Field | Meaning |
|---|---|
| `asOf` | The moment the counters describe (default: now). |
| `weeklyRestEndedAt`, `weeklyRestType` (`REGULAR` / `REDUCED`), `weeklyRestAbroad`, `weeklyRestAtHome` | The last weekly rest. It may end in the future while it runs. The end is required. An omitted type means unknown and is taken as reduced. `weeklyRestAtHome` is stored but **no rule reads it yet**. |
| `recentWeeklyRests` | Optional. Up to three most recent weekly rests `{ type, endedAt, abroad }`, newest first. The first one is the rest above. It is needed for the exception of two reduced weekly rests abroad. |
| `drivingThisWeekMinutes`, `drivingLastWeekMinutes` | Driving in the fixed week of `asOf` and in the week before. Required: a missing one is 400 naming the field. |
| `extendedDrivingDaysUsed` | 10-hour days used in the week of `asOf`. Omitted means unknown and is taken as both used. |
| `reducedDailyRestsUsed` | Reduced daily rests since the last weekly rest. Omitted means unknown and is taken as all three used. |
| `compensationOwedMinutes`, `compensationDueBy` | Compensation owed for reduced weekly rests; 0 means nothing owed. The deadline is required when anything is owed and allowed only with the amount. A provider that leaves it out: derived only when the last weekly rest is reduced and at most 21 h is owed (the rest started 45 h − amount before its end; the deadline is the end of the third week after the week it started in); otherwise availability answers 409 `DRIVER_STATUS_INCOMPLETE`. Omitted means unknown: 21 h for every reduced weekly rest of known date (the last one and the reduced ones in `recentWeeklyRests`), each by the earliest deadline (a reduced rest is shorter than 45 h, so it started at the earliest 45 h − 1 min before its end; the deadline is the end of the third week after the week it started in). A missed deadline is not assumed, but a rest is dropped only once even its latest possible deadline has passed (it started at the latest 24 h before its end): in between it is still owed, by the latest deadline. |
| `lastHomeRestEndedAt` | End of the last regular weekly rest (or one over 45 h with compensation) at home or base. Omitted means unknown: the rest at home is taken as due at `asOf` (`HOME_RETURN_LATE` from the start) until a rest at home on the timeline. |
| `driverChoseToStayAway` | The company offered the return; the driver chose to stay elsewhere. |
| `onDuty` | On duty at `asOf` (`true`), resting (`false`). Omitted means unknown: taken as on duty with the day's driving, the break and work used up, since as long ago as a regular daily rest still fits the 24-hour window (not before the weekly rest ended) — so no driving before a daily rest (`DRIVER_STATE_ASSUMED`, field `onDuty`). While the weekly rest still runs the driver is resting. |
| `dailyRestEndedAt` + `drivingSinceDailyRestMinutes`, `drivingSinceBreakMinutes`, `workSinceBreakMinutes` | Only with `onDuty: true`, and then required. All four or none. |
| `unavailableUntil` + `unavailableReason` (`LEAVE`, `SICKNESS`, `DRIVER_REQUEST`, `OTHER`) | The driver cannot start before then. Both or neither. |

The bounds are physical, not legal. A status may describe a driver who already
broke a rule; availability then reports the violation.

## How the rules work

Rules checked (`rules/limits.ts` has each number with its article; all to be
confirmed against the consolidated texts before release, SPEC §4):

- **Break** (561 art. 7): 45 min after 4.5 h of driving, or 15 + 30 in this
  order. Availability and other work are not a break.
- **Daily driving** (art. 6(1)): 9 h, or 10 h at most twice in the fixed week.
  It counts between two rests, not per calendar day.
- **Weekly and fortnightly driving** (art. 6(2)–(3)): 56 h in the fixed week,
  90 h in two consecutive weeks. Driving across Sunday 24:00 UTC is counted in
  both weeks.
- **Daily rest** (art. 8(2), (4)):
  - 11 h, or split 3 h + 9 h, or reduced 9 h;
  - at most three reduced ones between weekly rests;
  - it must fit in the 24 hours after the end of the previous rest.
- **Weekly rest** (art. 8(6)):
  - it starts at the latest six 24-hour periods after the previous one;
  - a reduced one (≥ 24 h) must be followed by a regular one (≥ 45 h).
- **The exception for two consecutive reduced weekly rests abroad**
  (art. 8(6), third subparagraph):
  - **applied only when the status has `recentWeeklyRests`;**
  - without the list it is not applied, and the result says so
    (`WEEKLY_REST_EXCEPTION_UNVERIFIABLE`);
  - interpretation: both reduced rests are abroad, the two rests before them
    are regular, and the ends of the four rests lie within 28 days;
  - the next weekly rest must then be preceded by both compensations.
- **Compensation** (art. 8(7)):
  - taken en bloc, attached to a rest of at least 9 h;
  - completed before the end of the third week after the week of the
    reduction;
  - the block may open the rest it is attached to.
- **Where the weekly rest is taken** (art. 8(8)):
  - a regular weekly rest, or one over 45 h with compensation, may not be taken
    in the cab: `WEEKLY_REST_IN_CAB` is a violation when the timeline plans it
    there;
  - away from home it is legal, with accommodation as a cost
    (`WEEKLY_REST_ACCOMMODATION_REQUIRED`, a notice).
- **Return home** (art. 8(8a)):
  - the company must make it possible within 4 weeks (3 after two consecutive
    reduced weekly rests);
  - counted from the end of the last home rest to the latest start of the next
    one;
  - it is the company's obligation and the driver may choose otherwise, so it
    is a **warning** (`HOME_RETURN_LATE`), or a notice when
    `driverChoseToStayAway` (`HOME_RETURN_DECLINED`);
  - the 8-week vehicle return obligation was annulled by the CJEU (4 Oct 2024)
    and is **not** enforced.
- **Breaks in working time** (2002/15 art. 5):
  - no more than 6 h of work in a row without a break;
  - 30 min in total over 6 h of work, 45 min over 9 h;
  - parts of at least 15 min count;
  - driving and other work count as work; availability does not.

Rest classification (after subtracting compensation taken in the rest):

| Length | Rest |
|---|---|
| ≥ 24 h | weekly (≥ 45 h regular, else reduced) |
| 9–24 h | daily |
| 3–9 h | first part of a split daily rest |
| ≥ 15 min | break |

Gaps in a timeline count as rest, as a tachograph would. At the start of a
timeline, a rest of a driver who is not on duty continues the rest the status
describes. It is not counted as a new rest unless it is at least 24 h long.

**Unknown is never favourable.** A count the status does not give is taken as
used up (`DRIVER_STATE_ASSUMED`, with the field and the value taken). With the
last weekly rest reduced and the earlier ones unknown, the 3-week return
period is assumed. An unknown weekly rest type is reduced; an unknown last
rest at home makes it due at `asOf`; unknown compensation is 21 h per reduced
rest of known date (docs/decisions.md §11). Driving this week and last week
and the end of the last weekly rest have no usable worst case and are
required. A status older than
7 days is flagged (`DRIVER_STATUS_STALE`). The engine assumes nothing happened
between `asOf` and the moment asked about, apart from rest.

### The planner

It is greedy and deterministic. Before each step it asks the ledger what is
left and inserts the rest the first limit reached requires:

- the weekly rest when its deadline comes, or when the week's driving is used
  up (then it lasts at least until Monday 00:00);
- otherwise the daily rest when the day's driving or the 24-hour window ends.
  It takes the weekly rest instead when the daily rest would run past the weekly
  deadline;
- otherwise the break.

Driving is split as needed. Other work and availability are never split. A
task that cannot fit legally is placed anyway and reported
(`TASK_CANNOT_FIT_LEGALLY`).

Compensation goes on the next weekly rest, or on a daily rest when it cannot
wait that long.

| Strategy | Uses |
|---|---|
| `standard` (default) | 9 h driving days, 11 h daily rests, regular weekly rests |
| `earliest` | also 10-hour days, 9 h daily rests and 24 h weekly rests (with the compensation owed) — legal, not always the earliest possible (greedy) |

## Gateway: `DriverActivityProvider`

Where the driver's working time comes from. Today it is the dispatcher's manual
status. Later it can be a tachograph program export or a telematics API. Those
are adapters the buyer writes; this codebase implements no third-party format
or API.

| | |
|---|---|
| Interface | `activity/driver-activity-provider.ts` |
| Token | `DRIVER_ACTIVITY_PROVIDER` |
| Default | `ManualDriverActivityProvider`: current status = the newest `DriverStatus` row; `history` is always empty with **no coverage** (a manual status is not an activity log) |
| Fake | `test/fakes/fake-driver-activity-provider.ts` (in memory; `failing: true` for the error path; `statusFromHistory` computes the status from its history, like an adapter with only activities) |
| Contract test | `test/contract/driver-activity-provider.contract.ts` |
| Error | `DriverActivityProviderError(reason)` is the only error a provider may throw for its source (`reason`: e.g. `timeout`, `unauthorized`, `bad_response`). A provider that builds its status with `statusFromHistory` may also pass on its `DriverStatusError` (a required value the history does not give): availability answers 409 `DRIVER_STATUS_INCOMPLETE` with the field. The provider failing for its source (`DriverActivityProviderError`) → availability answers 502 `DRIVER_ACTIVITY_PROVIDER_FAILED` with its `reason` |
| Not configured | There is always a provider (the manual one). A driver without a status → `DRIVER_STATUS_MISSING`; nothing is invented. |

What an adapter must return:

- **`source`:** a non-empty name. It is shown in the availability answer.
- **`history(driverId, from, to)`** returns `{ source, activities, coveredFrom, coveredTo }`:
  - `activities` (`DRIVE`, `WORK`, `AVAILABILITY`, `REST` with UTC `start` /
    `end`) are sorted, not overlapping, inside `[from, to]` and inside the
    coverage;
  - `country` (optional): ISO 3166-1 alpha-2 of where the activity took place
    (for a rest: where it was taken) — from the places the driver enters at
    the start and end of a working day, or GNSS; null or omitted = not known;
  - `cardWithdrawn` (optional, `REST` only): the driver card was not in a
    tachograph. It counts as rest, as the tachograph counts it;
  - `coveredFrom` / `coveredTo` give the part of the period the source has data
    for. Inside the coverage a period with no activity is rest. Outside it
    nothing is known; both null means no history, and callers must not read
    "no activity" as rest;
  - an unknown driver or an empty period gives an empty history, not an error;
  - the dates passed in must not be changed.
- **`currentStatus(driverId)`** returns the `DriverStatusSnapshot` the rules
  engine starts from (`rules/driver-state.ts`), or `null` for an unknown driver:
  - minutes are whole and not negative;
  - driving this week and last week and the end of the last weekly rest are
    always given;
  - the weekly rest type, the last rest at home and the compensation owed may
    be `null` (unknown — the engine takes the worst case), never a made-up
    value;
  - compensation owed comes with its deadline (a missing one is derived only
    for a single reduced rest; otherwise `DRIVER_STATUS_INCOMPLETE`); unknown
    compensation has none;
  - `recentWeeklyRests`, when present, has at most three entries and starts with
    the last weekly rest.

### Plugging in a provider

1. Write the adapter, e.g. `MyTachographProvider implements DriverActivityProvider`.
2. Next to its tests, run the contract:

   ```ts
   import { runDriverActivityProviderContract } from '../contract/driver-activity-provider.contract';
   runDriverActivityProviderContract('MyTachographProvider', {
     make: async () => ({ provider: new MyTachographProvider(config), knownDriverId: 'a driver your source knows' }),
     failing: () => new MyTachographProvider({ ...config, apiKey: 'invalid' }),
   });
   ```

3. In `fleet-planning.module.ts` replace `useClass: ManualDriverActivityProvider`
   with your class. It is the only place to change.
4. `npx jest test/contract` and the full check (`tools/bramka.sh`).

### A provider with only activities: status from history

A source that has the activity log but no status (a driver card file, a
tachograph program, telematics) can build `currentStatus` with
`statusFromHistory(history, { establishmentCountry, asOf })`
(`rules/status-from-history.ts`). The history is replayed by the same rules
ledger that checks a plan:

- the replay starts at `coveredFrom` with every count used up. The first
  weekly rest in the window resets what the rules reset, so from there on
  the counters are exact, and the worst case of the start never reaches the
  result. A history with no weekly rest is refused;
- driving this week and last week must be fully covered. If not, the status
  is refused (`DriverStatusError`; availability answers 409
  `DRIVER_STATUS_INCOMPLETE`);
- a rest is abroad when its `country` is known and differs from the company's
  Member State. An unknown country is not abroad, so the exception for rests
  abroad is not opened;
- compensation is taken as paid only when a rest of at least 45 h is longer
  by whole owed amounts (en bloc). The amount owed is known once the history
  reaches the end of the third full fixed week after the week it starts in
  (21–28 days, depending on the weekday it starts); before that it is
  unknown, because a reduced rest before the window may still be owed;
- a history that starts inside a weekly rest classifies only the covered
  part of that rest — under 45 h it counts as reduced (the worst case for
  the start of the window);
- the rest at home is never in a tachograph, so it is unknown (due now,
  `HOME_RETURN_LATE`). The dispatcher confirms it.

The test `status-from-history.spec.ts` checks it against a status entered by
hand: 28 synthetic days (`test/fixtures/driver-history.ts`) give the same
counters and the same availability.

### Plugging in a tachograph file or API

What we found when looking at sources (October 2026). Check the licences and
versions again before you use them. The full notes, with what was checked
at the source: [docs/fleet-planning/TACHOGRAPH-SOURCES.md](../../../../docs/fleet-planning/TACHOGRAPH-SOURCES.md).

- **Driver card files** (`.ddd`, `.esm`, `.tgd`; Regulation (EU) 2016/799
  Annex 1C):
  - `way-platform/tachograph-go` (Go library and CLI, **MIT**) reads Gen 1,
    Gen 2 and Gen 2 v2 (border crossings, GNSS places), verifies signatures and
    can anonymise. Run it as a separate process that outputs JSON, and keep its
    MIT notice. It has one maintainer and is before 1.0;
  - `traconiq/tachoparser` (Go) is **AGPL-3.0**. Whoever gets your code
    would get an AGPL component and its obligations. Do not embed it;
  - `mbolaric/esm-parser` (Rust) is GPL-3.0, so linking it makes your code
    GPL. Most other readers only handle Gen 1 or have no clear licence.
- **Test files:** a real card download holds personal data (name, card and
  licence number, places). Do not put one in the repository. Use synthetic
  histories such as `test/fixtures/driver-history.ts`, or files that have
  been anonymised.
- **APIs:**
  - Webfleet (WEBFLEET.connect) has public documentation: working times and
    remaining EU driving times. They need a paid add-on, and the request
    limits are low;
  - Samsara has a public API: tachograph activity history, live remaining
    times and `.ddd` files;
  - Transics, VDO TIS-Web and GBox (Inelo) have partner APIs, with
    documentation after an agreement;
  - OEM rFMS gives only the current working state, not remaining times; its
    separate tachograph-files API gives `.ddd` files.
- **The cheapest route that works with any vendor:** almost every program
  exports `.ddd` files. Parse them into `DriverActivity`, set `country` from
  the places, and build the status with `statusFromHistory`. The rules engine
  then counts the remaining times itself.

## Message codes

Returned as `{ code, params }`. The web app turns them into text
(`apps/web/src/lib/plan-messages.ts`, PL and EN).

- Violations (561/2006, 2002/15): `BREAK_MISSING`, `DAILY_DRIVING_EXCEEDED`,
  `WEEKLY_DRIVING_EXCEEDED`, `FORTNIGHT_DRIVING_EXCEEDED`, `DAILY_REST_LATE`,
  `REDUCED_DAILY_RESTS_EXCEEDED`, `WEEKLY_REST_LATE`,
  `CONSECUTIVE_REDUCED_WEEKLY_RESTS`, `COMPENSATION_OVERDUE`,
  `COMPENSATION_INVALID`, `COMPENSATION_NOT_BEFORE_WEEKLY_REST`,
  `WEEKLY_REST_IN_CAB`, `WTD_BREAK_MISSING`.
- Warnings: `HOME_RETURN_LATE`.
- Notices: `WEEKLY_REST_ACCOMMODATION_REQUIRED`, `WEEKLY_REST_EXCEPTION_APPLIED`,
  `WEEKLY_REST_EXCEPTION_UNVERIFIABLE`, `HOME_RETURN_DECLINED`,
  `DRIVER_STATE_ASSUMED`, `DRIVER_STATUS_STALE`.
- Planner: `TASK_CANNOT_FIT_LEGALLY`.
- API errors: `DRIVER_NOT_FOUND`, `DRIVER_VEHICLE_NOT_FOUND`,
  `DRIVER_VEHICLE_NOT_A_POWER_UNIT`, `DRIVER_VEHICLE_ALREADY_ASSIGNED`,
  `DRIVER_STATUS_INVALID`, `DRIVER_STATUS_MISSING`, `DRIVER_STATUS_INCOMPLETE`,
  `DRIVER_ACTIVITY_PROVIDER_FAILED`.

## Tests

```bash
cd apps/api
npx jest test/unit/fleet-planning test/contract
```

| Test | Covers |
|---|---|
| `test/unit/fleet-planning/check-timeline.spec.ts` | The validator on hand-built timelines: every rule above, at its boundaries |
| `test/unit/fleet-planning/plan-timeline.spec.ts` | Where the planner puts breaks and rests, both strategies; a property test over 3000 seeded random inputs: the validator accepts every planned timeline |
| `test/unit/fleet-planning/availability.spec.ts` | Can depart from, driving left, deadlines |
| `test/unit/fleet-planning/driver-state.spec.ts` | Status → engine start: aged counters, worst case for unknown values, staleness |
| `test/unit/fleet-planning/fixed-week.spec.ts` | The UTC fixed week |
| `test/unit/fleet-planning/applicability.spec.ts` | Scope of 561/2006 by mass, transport and date |
| `test/unit/fleet-planning/drivers.service.spec.ts` | Company scope, assignment, status, availability through the gateway |
| `test/unit/fleet-planning/drivers-dto.spec.ts` | Request validation |
| `test/unit/fleet-planning/manual-driver-activity-provider.spec.ts` | The manual provider: newest status, mapping, malformed JSON |
| `test/unit/fleet-planning/fleet-planning-module.spec.ts` | The module assembles; the manual provider is the default |
| `test/unit/fleet-planning/status-from-history.spec.ts` | Status from 28 days of synthetic history = the status entered by hand; compensation, places, the start and end of the window, on duty, refusals |
| `test/contract/fake-driver-activity-provider.contract.spec.ts` | The contract on the fake, also with the status computed from its history |
| `test/contract/manual-driver-activity-provider.contract.spec.ts` | The contract on the manual provider (stubbed Prisma) |
| `test/integration/fleet-planning-db.int-spec.ts` | The tables on PostgreSQL: CHECKs, one driver per vehicle, deletes (run by `tools/demo-test.sh`) |
| `test/integration/fleet-planning-provider.int-spec.ts` | The contract on the manual provider with PostgreSQL |

## Known limits

- The rules and their interpretations here are to be confirmed against the
  current consolidated texts before release (SPEC §4). The interpretations:
  - the four-week condition of the art. 8(6) exception;
  - the return-home period counted to the start of the next home rest;
  - a 10-hour day counted in the week its duty period started;
  - a compensation block that may open the rest it is attached to.
- Unknown compensation counts only reduced weekly rests of known date. When
  `recentWeeklyRests` is unknown, the rest before the last one is assumed
  reduced for the return home, but its compensation is not added — its date
  is not known.
- Status from history: compensation is recognised only in a rest of 45 h or
  more that is longer by whole owed amounts. Art. 8(7) lets it be attached to
  any rest of at least 9 h, so a daily rest of, say, 23 h (9 h + 14 h attached)
  pays it in law. The history alone cannot tell that from a long daily rest,
  so the amount stays owed. This is the cautious side: the plan asks for the
  compensation again. Test: `status-from-history.spec.ts`, "compensation
  attached to a daily rest". The dispatcher can correct it in the manual
  status. A merged rest is abroad if any part of it is.
- On-duty start: the 2002/15 totals are counted from the work since the last
  break, because earlier breaks of that duty are not in the status.
- A manual status describes one moment. Between `asOf` and the moment asked
  about the engine assumes only rest; `DRIVER_STATUS_STALE` flags a status
  older than 7 days.
- The planner is greedy: its timelines are legal, but `earliest` is not
  guaranteed to give the earliest possible ETA.
- The availability's `drivingLeft.today` is for the standard 9 h day;
  `todayExtended` shows the 10-hour day when one is left.
- Validation messages of the DTOs are class-validator's default English texts,
  not codes.
