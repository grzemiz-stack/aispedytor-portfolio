# Fleet Planning — module specification

Status: draft v1, 2026-10-07. Source of truth for the fleet planning module.
Language: everything in this module (code, identifiers, comments, tests, README, API texts, error codes) is in English from the first line.

## 1. Purpose

Plan the working week of a fleet (tractor + trailer + driver), from departure after the weekly rest to the return for the next weekly rest, using:

1. the driver's working time (when they can start, how much driving is left, when they must be home);
2. vehicle capacity (loading metres, payload, ADR, reefer) and the existing LTL (part-load) module;
3. vehicle service: inspections, tachograph calibration, insurance, planned repairs.

## 2. Principles (non-negotiable)

- **Agents do the work, the dispatcher decides.** Every plan element produced by an agent is a *draft*. The dispatcher approves, changes or rejects it. Agents never accept a freight, never send anything to a customer or driver, and never change an element the dispatcher approved or pinned.
- **Dispatcher changes win.** A re-plan never overwrites a manual change. If the dispatcher approves a plan that breaks the rules, the system does not block it; it shows the violation clearly.
- **External tools only through gateways.** Tachograph software, telematics, freight exchanges, truck routing (HERE/PTV), optional solvers: each behind an interface, with a fake implementation, contract tests and a README section on how to plug a provider in. Nothing of a third party is implemented in this codebase (no DDD parser, no solver). Same pattern as `TollProvider`.
- **The module works end to end without any external agreement**: manual driver status, manual orders, file import, demo data.
- **Accepted orders first, exchanges later.** Planning starts from orders the company already has (e-mail, manual entry, file import). Freight exchanges come last, only to fill gaps in an existing plan.
- **Every module and every gateway has a README**: full description, what it does and does not do, which external tools must be connected, what its gateways are (interface, what an adapter must return, fake, contract test, error codes, behaviour when no provider is connected). The README is written in the same stage as the code and kept in sync by `module-readmes.spec.ts`.

## 3. Agents

| Agent | Does on its own | Dispatcher approves or changes |
| --- | --- | --- |
| Orders | Collects accepted orders: e-mail, manual entry, file import (CSV/Excel). Removes duplicates. Flags uncertain data (e.g. country read from an e-mail). Later: exchange offers via gateway. | Confirms flagged data; adds orders from regular customers. |
| Working time | Reads driver activity through the gateway (daily). Computes earliest departure, remaining driving (day / week / two weeks), latest date the driver must be home. | Corrects: leave, sickness, driver request, data error. |
| Service | Watches deadlines (by date and by km). Blocks the vehicle. Proposes an inspection window when the vehicle is near the base. | Confirms the workshop date; enters repairs and VOR. |
| Assignment | For each accepted order: which units can do it — legality, empty km, free space for LTL part-loads. Later: scores exchange offers for plan gaps. | Picks the unit or changes the assignment; only the dispatcher accepts an exchange offer. |
| Week plan | Before the week starts, drafts the plan for the whole fleet from accepted orders. After every change, re-plans the rest around the dispatcher's decisions. | Approves, moves orders, changes the driver, pins elements the agent may not touch. |

Plan element status: `DRAFT` (agent) → `APPROVED` (dispatcher) → optional `PINNED`. Change history records who changed what (agent or user).

Agents are ordinary logic triggered by schedule, new order or user change. A language model is used only where the input is text (e-mail), and only through the existing gateway.

## 4. Rules the planner must check

Own planner logic (core of the module, not an external tool). Checked on proposals, not on the past.

**Regulation (EC) 561/2006 (UK retained version is the same):**

- driving: 9 h per day (twice a week 10 h), 56 h per week, 90 h in two consecutive weeks;
- break 45 min after 4.5 h of driving (may be split 15 + 30);
- daily rest 11 h (up to three reduced to 9 h between two weekly rests);
- weekly rest: in two consecutive weeks two regular (45 h) or one regular and one reduced (min. 24 h); a reduction must be compensated en bloc, attached to another rest of at least 9 h;
- international transport: two consecutive reduced weekly rests abroad allowed if in any four consecutive weeks there are at least four weekly rests, two of them regular; the next weekly rest must then be preceded by the compensation;
- regular weekly rest and any compensating rest over 45 h may not be taken in the cab (cost: hotel or base/home);
- since 1 July 2026 the rules also cover vehicles over 2.5 t in international transport and cabotage (vans).

**Mobility Package:** the driver must be able to return to the operational centre or home every 4 weeks (every 3 weeks after two consecutive reduced weekly rests). The 8-week vehicle return obligation was annulled by the CJEU (October 2024) and must **not** be enforced.

**Working Time Directive 2002/15:** 30 min break after 6 h of work (loading, waiting count as work).

**Two levels:** week (is the plan legal) and a 3–4 week horizon (when the driver must be home, how much compensation is owed).

**Other constraints:**

- **Truck driving bans** on weekends and public holidays (DE, FR, IT, AT and others). Stored as data (country, days, hours, exceptions, holiday calendar), maintained by the buyer — not hard-coded.
- **Cabotage:** max. 3 operations within 7 days after an international unloading, then a 4-day cooling-off period with that vehicle in that country. An exchange freight between two orders inside one country is cabotage.
- **Ferry/train time** may count as break/rest.

All rules to be confirmed against the current consolidated texts before release.

## 5. Gateways

| Gateway | Methods | Default implementation |
| --- | --- | --- |
| `DriverActivityProvider` | `history(driverId, from, to)` → activities (drive, work, availability, rest, with times; country; card withdrawn) and the period covered; `currentStatus(driverId)` → the driver status — an adapter with only activities builds it with `statusFromHistory` (the rules engine replays the history) | `ManualDriverActivityProvider` (status entered by the dispatcher) |
| `FreightExchangeProvider` | search freights by pickup area, delivery area, time window | none (fake for tests); stage 7 |
| `RouteCalculator` (existing) | distance/time matrix | OSRM (car profile — times underestimated for trucks; safety margin + README note; truck routing via HERE is a buyer adapter) |
| `PlanningSolver` (optional) | full-week draft from an external solver | none |

Each gateway: interface, fake, contract tests (`test/contract/`), README section "Plugging in a provider", and a defined behaviour when not configured (explicit code, never invented data).

## 6. Starting assumptions

- Fixed unit: tractor + trailer planned as one. Trailer swaps later (today trailers are counted as separate vehicles — known issue to fix along the way).
- Manual driver status, not a full activity log: weekly rest ended at…, type of that rest, driving used this week and last week, compensation owed, last rest at home.
- Orders from e-mail always go to the dispatcher for confirmation before entering the plan (rule-based extraction is known to fail on some formats).
- Single crew first; double crew later (different limits).

## 7. Stages

1. **Drivers + rules check + manual status.** Output per driver: can depart from…, driving left…, must be home by…
2. **Service calendar as constraints** (extends `vehicles`): deadlines by date and km, blocks, VOR.
3. **Accepted orders in one queue:** manual, e-mail (confirmed), file import.
4. **Week board with assignment:** the agent proposes a unit for each accepted order and inserts breaks and rests; the dispatcher approves or moves. LTL part-load hints in plan gaps.
   Input from an earlier trip model (part-load work, September 2026; rejected as a separate model on 10 Oct 2026): a unit's week as a sequence of stops, with free LDM and kg on every leg, unload order deciding positions (LIFO for a closed body, side access for a curtain-sider), and part-load search per leg (time and capacity). Rebuilt on this module's foundations, not ported; axle loads stay out ([decisions](../decisions.md)).
5. **Activity gateway adapters:** file export of a tachograph program first, then the first API provider (adapter work belongs to the buyer; we ship the gateway, fake and contract test).
6. **Full-week draft** from accepted orders, for approval. External solver only through `PlanningSolver`, if needed.
7. **Exchanges for plan gaps** (through `FreightExchangeProvider`):
   - departure from base toward a confirmed pickup later in the week;
   - between two confirmed orders;
   - return toward the base for the weekly rest.

   Search radius around where the truck will be and around the next confirmed point (configurable, e.g. 100 / 150 km). The confirmed order always wins: arrival is computed with breaks and rests plus a time margin; an offer that endangers a confirmed order is never shown. Result is shown against the empty run (how much the freight adds over the cost of driving empty). If no full load: combine LTL part-loads along the corridor. Cabotage limits apply.

Each stage ships usable on its own, with tests, mutations, README and gate green.

## 8. Acceptance scenarios

Before the planning logic is written: 5–10 real weeks described by the product owner (dispatcher with 15 years in international transport). Each scenario becomes a test: the planner's proposal must be one the dispatcher accepts as sensible.

Scenario format (times in UTC — the engine counts in UTC, [decisions §11](../decisions.md); a local time is fine when its zone is given, the test converts it; places as "City, CC"):

```
Scenario N — <short name, e.g. "back home for the weekend from Spain">
Fleet: base; units (tractor + trailer: type, GCW, ADR / reefer); drivers
Driver: end of the last weekly rest (date, time, place, reduced or regular),
  the weekly rest before it (reduced or regular), compensation owed (h, due by),
  driving this week / last week (h), 10-hour days used this week,
  reduced daily rests since the last weekly rest,
  end of the last regular weekly rest at home (date)
Service: deadlines in the week (date and/or km; current odometer)
Orders: City, CC → City, CC; pickup and delivery windows (date, time);
  weight / LDM; ADR / reefer
What happened: traffic, waiting at the ramp, breakdown, changed order…
What the dispatcher did and why:
What the system should have suggested:
Pitfall: what is easy to miss — break, 9 h / 10 h, home return, cabotage, weekend ban
Must never happen:
```

"Pitfall" describes the trap; "Must never happen" becomes an assertion in the test.

The product owner writes the scenarios in Polish, in their own words; the test rewrites each one into this format and into code, and keeps the original text next to it.

### Unknown values

A field may be "don't know", except the three required ones and the consistency rules below. The test then uses the worst case and checks the `DRIVER_STATE_ASSUMED` notice ([decisions §11](../decisions.md), "Unknown is never favourable"). What the engine assumes (`apps/api/src/fleet-planning/rules/driver-state.ts`, `tracker.ts`):

| Field | "Don't know" is taken as |
|---|---|
| 10-hour days used this week | both used (2) |
| reduced daily rests since the last weekly rest | all three used — every daily rest must be a regular 11 h |
| compensation due by | the earliest possible deadline: the end of the third week after the week the reduced rest started (for a known amount the rest's length follows from it; otherwise refused) |
| the weekly rests before the last one | reduced, when the last one was reduced: the rest at home is due within 3 weeks instead of 4. The exception of two reduced weekly rests abroad is not applied (`WEEKLY_REST_EXCEPTION_UNVERIFIABLE`) |
| on duty now: driving since the daily rest / since the break, work since the break | the limit reached (9 h / 4.5 h / 6 h) |
| whether the driver is on duty (`onDuty`) | on duty with those limits used up, since as long ago as a regular daily rest still fits the 24-hour window — no driving before a daily rest |
| type of the last weekly rest | reduced — the next one must be regular, compensation may be owed |
| last regular weekly rest at home | the rest at home is due now (at the moment of the status): `HOME_RETURN_LATE` from the start, until a rest at home in the plan |
| compensation owed | 21 h for every reduced weekly rest of known date (the last one, and the reduced ones among the earlier rests when they are given), each by the earliest deadline (the rest started at the earliest 45 h − 1 min before its end); a deadline already passed is not assumed missed |

Required — "don't know" is not accepted, the status is refused (400 naming the field): driving this week, driving last week, the end of the last weekly rest. Also refused: an inconsistent duty block — `onDuty: true` without the end of the daily rest, the duty counters without `onDuty: true`, or a daily rest without its three counters (400 naming the field); compensation owed without a due date (400), and an owed amount whose deadline cannot be derived from the rests given (409 `DRIVER_STATUS_INCOMPLETE`). Their worst case would ground the driver for days (Scenario 0: no driving left, or the weekly rest at once), so the dispatcher gives the value. A scenario with "don't know" in one of these needs the value estimated before it becomes a test. Service fields (stage 2) get their worst case in stage 2.

### Example (invented, not a real week)

```
Scenario 0 — EXAMPLE, invented — back home for the weekend from Spain
Fleet: base Poznań, PL; one unit: tractor + curtainsider semi-trailer, 40 t GCW,
  no ADR, no reefer; driver A, lives in Poznań
Driver A: last weekly rest reduced (26 h), ended Mon 12.10.2026 05:00 UTC in Lyon, FR;
  the weekly rest before it: don't know;
  compensation owed 19 h, due by: don't know;
  driving this week 0 h, last week 52 h; 10-hour days used this week: 0;
  reduced daily rests since the last weekly rest: don't know;
  last regular weekly rest at home ended Mon 28.09.2026 05:00 UTC
Service: none this week
Orders:
  1. Lyon, FR → Zaragoza, ES; pickup Mon 12.10 08:00–10:00, delivery Tue 13.10
     12:00–16:00; 22 t / 13.6 LDM (about 9 h of driving)
  2. Zaragoza, ES → Poznań, PL; pickup Wed 14.10 07:00–09:00, delivery Fri 16.10
     10:00–15:00; 20 t / 13.6 LDM (about 27 h of driving)
What happened: on Wednesday the loading in Zaragoza ended 5 h late, at 14:00.
What the dispatcher did and why: moved the delivery in Poznań to Saturday 08:00
  (the consignee works on Saturdays). After unloading, driver A starts the
  regular weekly rest at home with the 19 h compensation attached (45 + 19 h).
What the system should have suggested: on Wednesday at 14:00, the new arrival
  computed with breaks and rests: Friday 17:15, after the window. The
  fortnight: 52 + 9 + 27 = 88 h of 90 h, 2 h left. Home: the rest at home must
  start by Mon 19.10 05:00 (21 days — the rest before the last one is unknown,
  so taken as reduced). The compensation can be attached to that rest.
  Notices: DRIVER_STATE_ASSUMED for the reduced daily rests (3), for the
  compensation deadline (Mon 2.11 00:00 — the 26 h rest started on Sunday 11.10,
  so the week of 5.10 counts) and for the weekly rest before the last one
  (taken as reduced, so the rest at home is due within 3 weeks).
Pitfall: with the reduced daily rests unknown, every daily rest is 11 h. With
  9 h rests and two 10-hour days driver A would arrive at 14:45 and the Friday
  window would look reachable.
Must never happen: an extra load on Friday or Saturday that takes the fortnight
  over 90 h or starts the rest at home after Mon 19.10 05:00; a 9 h daily rest
  while the count of reduced daily rests is unknown.
```

The times above are the planner's (`planTimeline`, 9 October 2026): status at Wed 14.10 14:00 with 9 h driven this week, 27 h of driving, rests abroad. `standard` gives 17:15; `earliest` with the reduced daily rests known as 0 gives 14:45.

## 9. Out of scope (this codebase)

Deployment, servers, customer data; agreements with exchanges, telematics, tachograph software, HERE/PTV; adapters for specific providers; keeping driving-ban tables up to date. All of these belong to the buyer.
