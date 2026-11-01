import { Injectable, Logger } from '@nestjs/common';
import { RouteCalculatorService } from './osrm-calculator.service';
import type { PlannedRoute, RouteSection } from './route-types';

/**
 * Adapter: turns the RouteCalculatorService (OSRM) result into PlannedRoute,
 * the shape route-planner.service.ts works with.
 */
@Injectable()
export class OsrmAdapterService {
  private readonly logger = new Logger(OsrmAdapterService.name);

  constructor(private readonly osrm: RouteCalculatorService) {}

  async calculateRoute(params: {
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
  }): Promise<PlannedRoute[]> {

    const originStr = params.origin.lat + ',' + params.origin.lng;
    const destStr = params.destination.lat + ',' + params.destination.lng;

    try {
      // RouteCalculatorService takes a place name or a "lat,lon" string (both are geocoded through Nominatim)
      const waypointCoords = (params.waypoints || []).map(w => ({ lat: w.lat, lon: w.lng }));
      const result = await this.osrm.calculateRoute(originStr, destStr, { waypoints: waypointCoords });
      // Neither a route nor a hub estimate — no route (the planner: ROUTE_UNAVAILABLE).
      if (!result) return [];

      // Convert the GeoJSON geometry to a simplified "lat,lon;lat,lon" polyline (not an encoded polyline)
      const polyline = this.geoJsonToPolyline(result.geometry);

      // One section for the whole route
      const sections: RouteSection[] = [{
        id: 'section-0',
        type: 'vehicle',
        distance: result.distanceKm * 1000,
        duration: result.durationMinutes * 60,
        polyline,
        countryCode: result.countries[0] || 'PL',
        notices: [],
      }];

      const planned: PlannedRoute = {
        distance: result.distanceKm * 1000,
        duration: result.durationMinutes * 60,
        polyline,
        sections,
        countries: result.countryDistances.map(c => ({ countryCode: c.code, distanceKm: c.distanceKm })),
        // A hub estimate, not an OSRM route — the planner does not save it with the offer.
        estimated: result.source === 'fallback',
      };

      this.logger.log('OSRM route: ' + result.distanceKm + 'km, ' + result.durationMinutes + 'min, source: ' + result.source);

      return [planned];

    } catch (err) {
      this.logger.error('OSRM adapter error: ' + (err instanceof Error ? err.message : String(err)));
      // An error — no route (before: a 0 km route).
      return [];
    }
  }

  /**
   * Converts a GeoJSON LineString to a simplified polyline string.
   * Format: "lat1,lon1;lat2,lon2;..."
   * The front end (Leaflet) can use this format directly.
   */
  private geoJsonToPolyline(geometry?: { type: string; coordinates: number[][] }): string {
    if (!geometry || !geometry.coordinates || geometry.coordinates.length === 0) {
      return '';
    }
    return geometry.coordinates
      .map(([lon, lat]) => lat.toFixed(6) + ',' + lon.toFixed(6))
      .join(';');
  }

}