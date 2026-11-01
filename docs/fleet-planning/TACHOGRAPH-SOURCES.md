# Plugging in a tachograph file or API

How to feed real driver activity into fleet planning. This codebase ships the
gateway (`DriverActivityProvider`), its contract test, a fake and
`statusFromHistory`. The adapter for your source, whether a card file parser
or a vendor API, is yours to write (SPEC §7 point 5). See also the module
README, "Gateway: `DriverActivityProvider`".

These notes come from a review made on 9–10 October 2026. Licences, versions
and APIs change, so check them again before you build on them. How each fact
was checked:

- **checked** — read at the source: the repository and its LICENSE, or the
  vendor's own documentation;
- **vendor** — vendor marketing or a FAQ only;
- **not verified** — could not be confirmed.

## The route that works with any vendor

1. Read the driver card download (`.ddd` / `.esm` / `.tgd`, Regulation (EU)
   2016/799 Annex 1C) or the vendor's activity list.
2. Map it to `DriverActivity`:
   - `DRIVE`, `WORK`, `AVAILABILITY` and `REST`, in UTC;
   - `country` from the places the driver enters at the start and end of a
     working day (Gen 2: GNSS and border crossings);
   - `cardWithdrawn` for periods with the card out.
3. Return it from `history()` with the period it covers. In `currentStatus()`,
   call `statusFromHistory(history, { establishmentCountry, asOf })` for the
   last 28 days.
4. Run the contract: `runDriverActivityProviderContract`.

Almost every tachograph program exports `.ddd` files, so this route does not
depend on a vendor. The rules engine then counts the remaining driving times
itself.

## Driver card parsers

| Parser | Language | Licence | Gen 1 / Gen 2 / Gen 2 v2 | Activity | Verdict |
|---|---|---|---|---|---|
| way-platform/tachograph-go | Go library + CLI | MIT — checked | yes / yes / yes (border crossings, GNSS places) — checked | v0.18.2, Aug 2026; one maintainer — checked | **Usable.** Run it as a separate process that outputs JSON, and keep its MIT notice. Risks: before 1.0, one maintainer |
| Syax89/DDDTachograph_Reader | Python | MIT — checked | per its README | active, Oct 2026 — checked | Useful to cross-check, and it has a generator of synthetic files (its output is not validated) |
| traconiq/tachoparser | Go | **AGPL-3.0** — checked | yes / yes / yes | active | **Not for proprietary code.** Whoever gets your code would get an AGPL component and its obligations |
| mbolaric/esm-parser | Rust / WASM | GPL-3.0 | Gen 1 + Gen 2 | 2026 | Not usable: linking it makes your code GPL |
| jugglingcats/tachograph-reader, readesm, readesm-js and others | C# / C++ / JS | GPL, unclear or missing | Gen 1 only | 2014–2020 | Not usable |

## Test files

- A real card download holds personal data: name, card and licence number,
  places. Keep it out of the repository. One public repository
  (valdepeace/tachograph-structure) contains a `.DDD` that looks like a real
  driver's, so do not copy it.
- Synthetic histories: `apps/api/test/fixtures/driver-history.ts` (28 days,
  invented), or tachograph-go's anonymised records (`internal/card/testdata/`,
  MIT; whether the activity patterns come from real downloads is not
  verified).
- The European Commission (JRC / ERCA) publishes only Gen 2 sample keys and
  certificates. Test cards are given on request to manufacturers. No public
  sample `.ddd` was found.

## What a 28-day history gives

| Status field | From the history |
|---|---|
| driving this week / last week, weekly rests and their type, recent weekly rests, 10-hour days, reduced daily rests | yes, exact from the first weekly rest in the window |
| weekly rest abroad | from the country of the places (entered by the driver) |
| compensation owed | known with at least 28 days of history. Compensation attached to a daily rest (art. 8(7)) is not recognised and stays owed |
| last rest at home | **no**: a tachograph does not record "home", so it stays unknown and the dispatcher confirms it. Gen 2 GNSS compared with the home or base address could approximate it; this is not built |
| driver chose to stay away, unavailability | no |
| on-duty counters | only when the download was taken during a duty |
| ferry / train (art. 9) | not modelled by the engine |

## Tachograph programs and APIs

| Product | API | Driver data | Checked |
|---|---|---|---|
| Webfleet (WEBFLEET.connect) | public docs, API key | `showWorkingTimes` (up to 1 month per call, 6 requests/min), `getRemainingDrivingTimesEU` (10 requests/min). Needs the Remaining Driving Times or Tachograph Manager Plus add-on. No separate "availability" state (Standby is closest) | checked |
| Samsara | public | tachograph activity history, live remaining times (beta), `.ddd` files | checked |
| Transics / ZF TX-CONNECT | partner (SOAP; operation list public) | remaining driving and rest times, tachograph readout files | checked (names only) |
| Geotab | public SDK | `TachographDriverActivity` | checked (fields only) |
| GBox (Inelo) | for customers, docs behind a login | working-time fields | not verified |
| 4Trans / TachoScan (Inelo) | no public API found | `.ddd` export | not verified |
| VDO TIS-Web | partner | "specific data sets" | vendor |
| Frotcom | public REST v2 | tachograph endpoints | not verified |
| OEM rFMS v4 / v5 | standard, through each OEM | only the current working state, no remaining times; a separate tachograph-files API gives `.ddd` files | checked |

If one API comes first, Webfleet is the obvious choice for Polish SME fleets.
You need a customer account with the add-on to test it.

## Rough effort for a card-file adapter

| Part | Hours |
|---|---|
| parser run as a separate process, JSON → `DriverActivity` | 8–12 |
| upload, stored activities with their coverage, contract test | 10–14 |
| synthetic fixtures, tests, mutations | 8–12 |
| docs and third-party notices | 4–6 |
