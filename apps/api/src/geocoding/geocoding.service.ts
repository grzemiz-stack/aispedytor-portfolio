import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

export interface Coords {
  lat: number;
  lng: number;
}

/**
 * The result of one lookup. Three states, not two: "no such address" and
 * "the lookup failed" lead to different decisions — the first may be
 * cached, the second may not.
 */
export type GeocodeResult =
  | { status: 'found'; coords: Coords }
  | { status: 'not_found' }
  | { status: 'error' };

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';

/**
 * Nominatim usage policy: at most 1 request per second. Going over it gets the
 * IP address blocked, so the interval is enforced in code, not left to how
 * often someone clicks "Search".
 */
export const MIN_INTERVAL_MS = 1000;

/** An address unknown to Nominatim is remembered for a week, then looked up again. */
export const NOT_FOUND_TTL_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class GeocodingService {
  private readonly logger = new Logger(GeocodingService.name);
  private readonly userAgent: string;

  /** Queue: each request waits for the previous one + MIN_INTERVAL_MS. */
  private lastCallAt = Number.NEGATIVE_INFINITY;
  private queue: Promise<unknown> = Promise.resolve();

  /** Clock and sleep as fields — tests replace them instead of waiting. */
  now: () => number = () => Date.now();
  sleep: (ms: number) => Promise<void> = ms => new Promise(r => setTimeout(r, ms));

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    // The Nominatim usage policy requires the app to identify itself with a contact.
    const contact = config.get<string>('NOMINATIM_CONTACT_EMAIL');
    if (!contact) {
      this.logger.warn(
        'NOMINATIM_CONTACT_EMAIL is not set — Nominatim requests go without a contact, ' +
          'against the usage policy of the service.',
      );
    }
    this.userAgent = contact ? `AiSpedytor/1.0 (${contact})` : 'AiSpedytor/1.0';
  }

  /** Cache key: " Poznań,  PL" and "poznań, pl" are the same query. */
  static normalize(query: string): string {
    return query.trim().toLowerCase().replace(/\s+/g, ' ');
  }

  /** Coordinates or `null` — for callers that do not need to know why. */
  async geocode(query: string): Promise<Coords | null> {
    const result = await this.lookup(query);
    return result.status === 'found' ? result.coords : null;
  }

  /**
   * Cache first, then Nominatim (at most 1 request/s). Caches both a hit and
   * a miss; an error (network, HTTP status, unreadable answer) is not cached.
   */
  async lookup(query: string): Promise<GeocodeResult> {
    const key = GeocodingService.normalize(query ?? '');
    if (!key) return { status: 'not_found' };

    const cached = await this.prisma.geocodeCache.findUnique({ where: { query: key } });
    if (cached) {
      if (cached.found && cached.lat != null && cached.lng != null) {
        return { status: 'found', coords: { lat: cached.lat, lng: cached.lng } };
      }
      const ageMs = this.now() - cached.fetchedAt.getTime();
      if (!cached.found && ageMs < NOT_FOUND_TTL_DAYS * DAY_MS) {
        return { status: 'not_found' };
      }
    }

    const result = await this.fetchThrottled(key);
    if (result.status === 'error') return result;

    const coords = result.status === 'found' ? result.coords : null;
    const data = {
      lat: coords?.lat ?? null,
      lng: coords?.lng ?? null,
      found: coords != null,
      fetchedAt: new Date(this.now()),
    };
    await this.prisma.geocodeCache.upsert({
      where: { query: key },
      create: { query: key, ...data },
      update: data,
    });
    return result;
  }

  /** Runs requests one after another, at least MIN_INTERVAL_MS apart. */
  private fetchThrottled(query: string): Promise<GeocodeResult> {
    const task = this.queue.then(async () => {
      const wait = MIN_INTERVAL_MS - (this.now() - this.lastCallAt);
      if (wait > 0) await this.sleep(wait);
      this.lastCallAt = this.now();
      return this.fetchOnce(query);
    });
    // A failed request must not break the queue for the ones after it.
    this.queue = task.catch(() => undefined);
    return task;
  }

  private async fetchOnce(query: string): Promise<GeocodeResult> {
    const url = `${NOMINATIM_URL}?q=${encodeURIComponent(query)}&format=json&limit=1`;
    try {
      const res = await fetch(url, { headers: { 'User-Agent': this.userAgent } });
      if (!res.ok) {
        this.logger.warn(`Nominatim answered ${res.status} for "${query}"`);
        return { status: 'error' };
      }
      const data = await res.json();
      if (!Array.isArray(data) || data.length === 0) return { status: 'not_found' };
      const lat = parseFloat(data[0].lat);
      const lng = parseFloat(data[0].lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        this.logger.warn(`Nominatim returned unreadable coordinates for "${query}"`);
        return { status: 'error' };
      }
      return { status: 'found', coords: { lat, lng } };
    } catch (err) {
      this.logger.warn(`Geocoding "${query}" failed: ${(err as Error).message}`);
      return { status: 'error' };
    }
  }
}
