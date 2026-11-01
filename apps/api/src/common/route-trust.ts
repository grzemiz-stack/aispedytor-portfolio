import type { Prisma } from '@prisma/client';

/**
 * Which saved planner routes may be taken for an offer's cost.
 *
 * Before, the planner also saved a fallback route with an offer: when
 * geocoding or OSRM failed, a hub-table estimate, and without hubs a flat
 * 500 km; an adapter error gave a 0 km route. The table has no source column,
 * so only what can be recognised for sure is recognised:
 *  - 0 km — not a route;
 *  - exactly 500 km and an empty toll breakdown — the flat 500 km (without
 *    coordinates there were no countries, so no toll); a real 500 km route
 *    through tolled countries has a breakdown.
 * A hub-table estimate cannot be told from a real route (the saved toll
 * items carry no km per country, and there is no source) — known-issues.
 * A fallback route is no longer saved at all.
 */
export const SUSPECT_FLAT_FALLBACK_KM = 500;

export const TRUSTED_ROUTE: Prisma.RouteCalculationWhereInput = {
  distanceKm: { gt: 0 },
  NOT: { distanceKm: SUSPECT_FLAT_FALLBACK_KM, tollBreakdown: { equals: [] } },
};
