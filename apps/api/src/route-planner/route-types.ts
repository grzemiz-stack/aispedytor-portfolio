/**
 * Shapes passed between the route provider and the planner.
 *
 * The route provider is the OSRM adapter (`osrm-adapter.service.ts`): it
 * returns one route with a single section and the km driven per country.
 * Toll amounts come from a separate TollProvider (src/tolls), not from here.
 */
export interface RouteRequest {
  origin: { lat: number; lng: number };
  destination: { lat: number; lng: number };
  waypoints?: { lat: number; lng: number }[];
  vehicle: {
    grossWeight: number;
    height: number;
    width: number;
    length: number;
    axleCount?: number;
    hasAdr: boolean;
    adrClass?: string;
    euroClass?: string;
  };
  alternatives?: number;
}

export interface PlannedRoute {
  distance: number;
  duration: number;
  polyline: string;
  sections: RouteSection[];
  /** Approximate km driven in each country — the input a toll provider needs. */
  countries: { countryCode: string; distanceKm: number }[];
  /** A hub-table estimate (OSRM or geocoding failed) — for viewing, never saved with an offer. */
  estimated?: boolean;
}

export interface RouteSection {
  id: string;
  type: string;
  distance: number;
  duration: number;
  polyline: string;
  countryCode?: string;
  notices?: { code: string; title: string }[];
}
