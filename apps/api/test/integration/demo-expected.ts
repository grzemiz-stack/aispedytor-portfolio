/**
 * Expected result of the LTL demo scenario — shared by the "today" and the
 * "+30 days" runs (the amounts do not depend on the date). Worked out in
 * demo-ltl.int-spec.ts.
 */
import { DEMO_ROUTE } from '../../prisma/seed-demo-ltl';

/** The screen's request body with default sliders (ltl-matching/page.tsx, handleSearch). */
export const SCREEN_BODY = {
  vehicleId: DEMO_ROUTE.vehicleId,
  currentLoadMeters: 0,
  currentLoadWeight: 0,
  routeFrom: DEMO_ROUTE.from,
  routeTo: DEMO_ROUTE.to,
  maxDetourKm: 100,
} as any;

/** [externalId, profit PLN, km cost, toll] in list order. */
export const EXPECTED_MATCHES = [
  // No toll provider in the demo (src/tolls): detour toll null wherever there is a detour.
  ['LTLDEMO-03-GBP', 5723.75, 26.25, null],
  ['LTLDEMO-02-EUR', 5217.39, 0, 0],
  ['LTLDEMO-07-DETOUR', 3612.87, 300.18, null],
  ['LTLDEMO-05-RISK', 1250, 0, 0],
  ['LTLDEMO-01-PLN', 1200, 0, 0],
  ['LTLDEMO-04-NOPRICE', null, 12.99, null],
];
