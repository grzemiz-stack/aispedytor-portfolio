import { Injectable, Logger } from '@nestjs/common';
import {
  getOrEstimateDistance,
  findNearestHub,
  type HubDistance,
} from './hub-distances.data';
import {
  getRouteVignetteRequirements,
} from './vignette-requirements.data';

// ─── GeoJSON (inline to avoid external @types/geojson dependency) ────

interface GeoJsonLineString {
  type: 'LineString';
  coordinates: Array<[number, number]>; // [lon, lat]
}

// ─── Public Types ────────────────────────────────────────────────────

export interface Coordinates {
  lat: number;
  lon: number;
}

export interface VignetteInfo {
  country: string;
  systemName: string;
  systemType: string;
  required: boolean;
  obuDevice?: string;
}

export interface RouteResult {
  origin: string;
  destination: string;
  distanceKm: number;
  durationMinutes: number;
  countries: string[];
  /** Approximate km driven in each country (from sampled points along the geometry). */
  countryDistances: Array<{ code: string; distanceKm: number }>;
  vignetteRequirements: VignetteInfo[];
  geometry?: GeoJsonLineString;
  source: 'osrm' | 'cache' | 'fallback';
  cachedAt?: string;
}

// ─── Internal Types ──────────────────────────────────────────────────

interface CacheEntry {
  result: RouteResult;
  timestamp: number;
}

interface NominatimResult {
  lat: string;
  lon: string;
  display_name: string;
}

interface OsrmRoute {
  distance: number;
  duration: number;
  geometry: GeoJsonLineString;
  legs: Array<{
    steps: Array<{
      geometry: GeoJsonLineString;
      distance: number;
      duration: number;
    }>;
  }>;
}

interface OsrmResponse {
  code: string;
  routes: OsrmRoute[];
}

interface NominatimReverseResult {
  address?: {
    country_code?: string;
  };
}

// ─── Constants ───────────────────────────────────────────────────────

const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org';
const OSRM_BASE = 'https://router.project-osrm.org';
/** The Nominatim usage policy asks for a contact — the same one as geocoding.service.ts. */
const userAgent = () => {
  const contact = process.env.NOMINATIM_CONTACT_EMAIL;
  return contact ? `AiSpedytor/1.0 (${contact})` : 'AiSpedytor/1.0';
};

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const NOMINATIM_MIN_INTERVAL_MS = 1100; // >1 req/s
const CIRCUIT_BREAKER_THRESHOLD = 3;
const CIRCUIT_BREAKER_RESET_MS = 5 * 60 * 1000; // 5 minutes
const SAMPLE_INTERVAL_KM = 50;
/** A border is searched down to a stretch this long (50 / 8 km) — its middle is ±~3 km off. */
const BORDER_RESOLUTION_KM = SAMPLE_INTERVAL_KM / 8;

/** Great-circle km between two [lon, lat] points. */
function haversineKm(a: number[], b: number[]): number {
  const toRad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * toRad;
  const dLon = (b[0] - a[0]) * toRad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * toRad) * Math.cos(b[1] * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}


// ─── Cache key ───────────────────────────────────────────────────────

/**
 * JSON with keys sorted at every level and without `undefined` fields —
 * the same object written in a different key order gives the same string.
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.keys(value as Record<string, unknown>)
    .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`);
  return `{${entries.join(',')}}`;
}

/**
 * Route cache key.
 *
 * Built from origin and destination (lower-cased, trimmed) and the WHOLE
 * `options` object, not from a hand-written list of fields: an option added
 * later (e.g. a vehicle parameter) becomes part of the key by itself, where a
 * hand-written list could miss it.
 */
export function routeCacheKey(origin: string, destination: string, options?: object): string {
  return stableStringify({
    origin: origin.toLowerCase().trim(),
    destination: destination.toLowerCase().trim(),
    options: options ?? {},
  });
}

// ─── Service ─────────────────────────────────────────────────────────

@Injectable()
export class RouteCalculatorService {
  private readonly logger = new Logger(RouteCalculatorService.name);

  // Cache
  private readonly cache = new Map<string, CacheEntry>();

  // Rate limiter for Nominatim
  private lastNominatimCall = 0;
  private readonly nominatimQueue: Array<{
    resolve: (v: unknown) => void;
    reject: (e: unknown) => void;
    fn: () => Promise<unknown>;
  }> = [];
  private processingQueue = false;

  // Circuit breaker
  private failureCount = 0;
  private circuitOpenUntil = 0;

  // ─── Public API ──────────────────────────────────────────────────

  /**
   * Geocode a place name to coordinates using Nominatim.
   */
  async geocode(placeName: string): Promise<Coordinates | null> {
    try {
      const result = await this.nominatimThrottled<NominatimResult[]>(
        `${NOMINATIM_BASE}/search?q=${encodeURIComponent(placeName)}&format=json&limit=1`,
      );
      if (result && result.length > 0) {
        return { lat: parseFloat(result[0].lat), lon: parseFloat(result[0].lon) };
      }
      return null;
    } catch (err) {
      this.logger.warn(`Geocode failed for "${placeName}": ${err}`);
      return null;
    }
  }

  /**
   * Calculate a route between origin and destination: distance, duration,
   * km per country, vignette requirements. No toll amounts — those come from
   * the TollProvider (src/tolls).
   */
  async calculateRoute(
    origin: string,
    destination: string,
    options?: {
      waypoints?: Coordinates[];
    },
  ): Promise<RouteResult | null> {
    const cacheKey = routeCacheKey(origin, destination, options);

    // Check cache
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      this.logger.debug(`Cache hit: ${cacheKey}`);
      return { ...cached.result, source: 'cache', cachedAt: new Date(cached.timestamp).toISOString() };
    }

    // Check circuit breaker
    if (this.isCircuitOpen()) {
      this.logger.warn('Circuit breaker open — using fallback');
      return this.fallbackRoute(origin, destination);
    }

    try {
      // 1. Geocode origin and destination
      const [originCoords, destCoords] = await Promise.all([
        this.geocode(origin),
        this.geocode(destination),
      ]);

      if (!originCoords || !destCoords) {
        this.logger.warn(`Geocoding failed for ${!originCoords ? origin : destination} — using fallback`);
        return this.fallbackRoute(origin, destination);
      }

      // 2. OSRM routing (with optional waypoints)
      const osrmResult = await this.fetchOsrmRoute(originCoords, destCoords, options?.waypoints);
      if (!osrmResult) {
        this.recordFailure();
        return this.fallbackRoute(origin, destination);
      }

      this.resetCircuitBreaker();

      const distanceKm = Math.round(osrmResult.distance / 1000);
      const durationMinutes = Math.round(osrmResult.duration / 60);

      // 3. Sample points from geometry → detect countries
      const countries = await this.detectCountries(osrmResult.geometry, distanceKm);

      // 4. Vignette requirements (which countries require one — no prices)
      const vignetteRequirements = this.getVignetteInfo(countries.map((c) => c.code));

      const result: RouteResult = {
        origin,
        destination,
        distanceKm,
        durationMinutes,
        countries: countries.map((c) => c.code),
        countryDistances: countries,
        vignetteRequirements,
        geometry: osrmResult.geometry,
        source: 'osrm',
      };

      // Cache result
      this.cache.set(cacheKey, { result, timestamp: Date.now() });
      this.cleanupCache();

      return result;
    } catch (err) {
      this.logger.error(`Route calculation failed: ${err}`);
      this.recordFailure();
      return this.fallbackRoute(origin, destination);
    }
  }

  // ─── OSRM Integration ───────────────────────────────────────────

  private async fetchOsrmRoute(
    origin: Coordinates,
    destination: Coordinates,
    waypoints?: Coordinates[],
  ): Promise<OsrmRoute | null> {
    // Build coordinate string: origin;wp1;wp2;...;destination
    const points = [
      `${origin.lon},${origin.lat}`,
      ...(waypoints ?? []).map((wp) => `${wp.lon},${wp.lat}`),
      `${destination.lon},${destination.lat}`,
    ].join(';');

    const url =
      `${OSRM_BASE}/route/v1/driving/${points}` +
      `?overview=full&geometries=geojson&steps=true`;

    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': userAgent() },
        signal: AbortSignal.timeout(15_000),
      });

      if (!response.ok) {
        this.logger.warn(`OSRM returned ${response.status}`);
        return null;
      }

      const data = (await response.json()) as OsrmResponse;
      if (data.code !== 'Ok' || !data.routes?.length) {
        this.logger.warn(`OSRM code: ${data.code}`);
        return null;
      }

      return data.routes[0];
    } catch (err) {
      this.logger.warn(`OSRM fetch failed: ${err}`);
      return null;
    }
  }

  // ─── Country Detection ──────────────────────────────────────────

  /**
   * Km per country from the route geometry — by the DRIVEN distance (decisions.md
   * §5a). Probes (one Nominatim request each) at the start, the end and the
   * middle of every ~50 km piece along the line. Where two neighbouring probes
   * are in different countries, the stretch between them is halved until it is
   * at most BORDER_RESOLUTION_KM long; the border is put in its middle (about
   * ±3 km). A probe that finds a third country (a narrow strip between two
   * others) gets its own borders the same way, so the strip gets its km.
   * Before: every N-th POINT was sampled and each sample got an equal share —
   * dense geometry (towns, bends) got too many km, motorways too few (Warsaw →
   * Madrid: ES 810 km instead of about 470). Left: a strip that lies between two
   * probes of the SAME country is not seen. A probe whose country is unknown is
   * skipped — its neighbours share the stretch (the total stays the route
   * distance).
   */
  private async detectCountries(
    geometry: GeoJsonLineString,
    distanceKm: number,
  ): Promise<Array<{ code: string; distanceKm: number }>> {
    const coords = geometry.coordinates;
    if (coords.length === 0) return [];

    // Cumulative length along the line (great circle between points).
    const cumulative = [0];
    for (let i = 1; i < coords.length; i++) cumulative.push(cumulative[i - 1] + haversineKm(coords[i - 1], coords[i]));
    const lineKm = cumulative[cumulative.length - 1];
    if (lineKm <= 0) {
      const only = await this.reverseGeocodeCountry(coords[0][1], coords[0][0]);
      return only ? [{ code: only.toUpperCase(), distanceKm }] : [];
    }

    type Probe = { km: number; code: string | null };
    const probe = async (km: number): Promise<Probe> => {
      // The segment p → p+1 holding `km` (binary search), then the point on it.
      let lo = 0;
      let hi = cumulative.length - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (cumulative[mid] <= km) lo = mid;
        else hi = mid;
      }
      const segment = cumulative[hi] - cumulative[lo];
      const t = segment > 0 ? (km - cumulative[lo]) / segment : 0;
      const lon = coords[lo][0] + (coords[hi][0] - coords[lo][0]) * t;
      const lat = coords[lo][1] + (coords[hi][1] - coords[lo][1]) * t;
      const country = await this.reverseGeocodeCountry(lat, lon);
      return { km, code: country ? country.toUpperCase() : null };
    };
    // Probes between a and b (different countries), down to BORDER_RESOLUTION_KM.
    const refine = async (a: Probe, b: Probe): Promise<Probe[]> => {
      if (b.km - a.km <= BORDER_RESOLUTION_KM) return [];
      const mid = await probe((a.km + b.km) / 2);
      if (!mid.code) return [];
      const left = mid.code !== a.code ? await refine(a, mid) : [];
      const right = mid.code !== b.code ? await refine(mid, b) : [];
      return [...left, mid, ...right];
    };

    const pieces = Math.max(1, Math.ceil(lineKm / SAMPLE_INTERVAL_KM));
    const pieceKm = lineKm / pieces;
    const positions = [0, ...Array.from({ length: pieces }, (_, n) => (n + 0.5) * pieceKm), lineKm];
    const known: Probe[] = [];
    for (const km of positions) {
      const found = await probe(km);
      if (found.code) known.push(found);
    }
    if (known.length === 0) return [];
    const probes: Probe[] = [known[0]];
    for (let i = 1; i < known.length; i++) {
      if (known[i].code !== known[i - 1].code) probes.push(...(await refine(known[i - 1], known[i])));
      probes.push(known[i]);
    }

    // The stretch between two probes: one country — all of it; two — split in the middle.
    const countryKm = new Map<string, number>();
    const add = (code: string, km: number) => countryKm.set(code, (countryKm.get(code) ?? 0) + km);
    add(probes[0].code!, probes[0].km);
    add(probes[probes.length - 1].code!, lineKm - probes[probes.length - 1].km);
    for (let i = 1; i < probes.length; i++) {
      const [a, b] = [probes[i - 1], probes[i]];
      if (a.code === b.code) add(a.code!, b.km - a.km);
      else { add(a.code!, (b.km - a.km) / 2); add(b.code!, (b.km - a.km) / 2); }
    }

    // Scale to the route distance (OSRM's, not the straight segments'); round so the total stays exact.
    const scaled = Array.from(countryKm.entries())
      .filter(([, km]) => km > 0)
      .map(([code, km]) => ({ code, km: (km / lineKm) * distanceKm }));
    const rounded = scaled.map((c) => ({ code: c.code, distanceKm: Math.floor(c.km) }));
    let rest = distanceKm - rounded.reduce((sum, c) => sum + c.distanceKm, 0);
    const byFraction = scaled.map((c, i) => ({ i, f: c.km - Math.floor(c.km) })).sort((a, b) => b.f - a.f);
    for (const { i } of byFraction) { if (rest <= 0) break; rounded[i].distanceKm += 1; rest--; }
    return rounded.sort((a, b) => b.distanceKm - a.distanceKm);
  }

  private async reverseGeocodeCountry(lat: number, lon: number): Promise<string | null> {
    try {
      const result = await this.nominatimThrottled<NominatimReverseResult>(
        `${NOMINATIM_BASE}/reverse?lat=${lat}&lon=${lon}&format=json&zoom=3&addressdetails=1`,
      );
      return result?.address?.country_code ?? null;
    } catch {
      return null;
    }
  }

  // ─── Vignette Info ──────────────────────────────────────────────

  private getVignetteInfo(countryCodes: string[]): VignetteInfo[] {
    const required = getRouteVignetteRequirements(countryCodes);
    return required.map((v) => ({
      country: v.countryCode,
      systemName: v.systemName,
      systemType: v.systemType,
      required: v.required,
      obuDevice: v.obuDevice,
    }));
  }

  // ─── Fallback (hub distances) ───────────────────────────────────

  private async fallbackRoute(
    origin: string,
    destination: string,
  ): Promise<RouteResult | null> {
    this.logger.warn(`Using fallback route: ${origin} → ${destination}`);

    // Try to find nearest hubs
    const originCoords = await this.geocode(origin);
    const destCoords = await this.geocode(destination);

    let hubDistance: HubDistance | undefined;
    let countries: string[] = [];

    if (originCoords && destCoords) {
      const originHub = findNearestHub(originCoords.lat, originCoords.lon);
      const destHub = findNearestHub(destCoords.lat, destCoords.lon);
      hubDistance = getOrEstimateDistance(originHub.code, destHub.code) ?? undefined;
      countries = hubDistance?.tollCountries ?? [originHub.country, destHub.country];
    }

    // No hub distance — no route, not a guessed 500 km. The same hub at both
    // ends gives 0 km — also a guessed distance, not a measured one.
    if (!hubDistance || hubDistance.distanceKm <= 0) return null;
    const distanceKm = hubDistance.distanceKm;
    const durationMinutes = hubDistance.estimatedDrivingMinutes ?? Math.round((distanceKm / 70) * 60);

    // km per country: equal split (hub distance has no per-country breakdown)
    const countryDistances = countries.map((code) => ({
      code,
      distanceKm: Math.round(distanceKm / Math.max(countries.length, 1)),
    }));

    const vignetteRequirements = this.getVignetteInfo(countries);

    return {
      origin,
      destination,
      distanceKm,
      durationMinutes,
      countries,
      countryDistances,
      vignetteRequirements,
      source: 'fallback',
    };
  }

  // ─── Nominatim Rate Limiter ─────────────────────────────────────

  private nominatimThrottled<T>(url: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.nominatimQueue.push({
        resolve: resolve as (v: unknown) => void,
        reject,
        fn: () => this.fetchJson<T>(url),
      });
      this.processNominatimQueue();
    });
  }

  private async processNominatimQueue(): Promise<void> {
    if (this.processingQueue) return;
    this.processingQueue = true;

    while (this.nominatimQueue.length > 0) {
      const now = Date.now();
      const waitMs = Math.max(0, this.lastNominatimCall + NOMINATIM_MIN_INTERVAL_MS - now);
      if (waitMs > 0) {
        await new Promise((r) => setTimeout(r, waitMs));
      }

      const item = this.nominatimQueue.shift();
      if (!item) break;

      this.lastNominatimCall = Date.now();
      try {
        const result = await item.fn();
        item.resolve(result);
      } catch (err) {
        item.reject(err);
      }
    }

    this.processingQueue = false;
  }

  // ─── Circuit Breaker ───────────────────────────────────────────

  private isCircuitOpen(): boolean {
    if (this.failureCount >= CIRCUIT_BREAKER_THRESHOLD) {
      if (Date.now() < this.circuitOpenUntil) return true;
      // Reset after timeout
      this.failureCount = 0;
    }
    return false;
  }

  private recordFailure(): void {
    this.failureCount++;
    if (this.failureCount >= CIRCUIT_BREAKER_THRESHOLD) {
      this.circuitOpenUntil = Date.now() + CIRCUIT_BREAKER_RESET_MS;
      this.logger.warn(
        `Circuit breaker opened after ${this.failureCount} failures. Reset at ${new Date(this.circuitOpenUntil).toISOString()}`,
      );
    }
  }

  private resetCircuitBreaker(): void {
    if (this.failureCount > 0) {
      this.failureCount = 0;
      this.logger.debug('Circuit breaker reset');
    }
  }

  // ─── Fetch Helper ──────────────────────────────────────────────

  private async fetchJson<T>(url: string): Promise<T> {
    const response = await fetch(url, {
      headers: { 'User-Agent': userAgent() },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return response.json() as Promise<T>;
  }

  // ─── Cache Cleanup ─────────────────────────────────────────────

  private cleanupCache(): void {
    if (this.cache.size <= 500) return;
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (now - entry.timestamp > CACHE_TTL_MS) {
        this.cache.delete(key);
      }
    }
  }
}
